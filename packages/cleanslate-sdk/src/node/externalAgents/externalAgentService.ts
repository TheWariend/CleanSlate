/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk';
import { mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Emitter, Event } from '../../core/event.js';
import { Disposable } from '../../core/lifecycle.js';
import { randomUUID as generateUuid } from 'node:crypto';
import {
	IExternalAgentDescriptor,
	IExternalAgentEvent,
	IExternalAgentPermissionResponse,
	IExternalAgentPromptRequest,
	IExternalAgentSessionInfo,
	IExternalAgentStartRequest
} from '../../externalAgents/externalAgentTypes.js';
import { ExternalAgentRegistry } from './externalAgentRegistry.js';
import { ExternalAgentSession } from './externalAgentSession.js';
import { createHostToolsBridge } from './hostToolsBridge.js';
import { readCodexAppServerUsage } from './externalAgentUsage.js';

interface IPendingPermission {
	readonly cleanSlateSessionId: string;
	readonly request: RequestPermissionRequest;
	readonly resolve: (response: RequestPermissionResponse) => void;
}

export class ExternalAgentService extends Disposable {
	constructor(private readonly registry = new ExternalAgentRegistry(), private readonly createHostTools?: (sessionId: string, cwd: string) => Promise<import('./externalAgentSession.js').IExternalAgentHostTools>) { super(); }
	private readonly sessions = new Map<string, ExternalAgentSession>();
	private readonly starting = new Map<string, Promise<IExternalAgentSessionInfo>>();
	private readonly permissions = new Map<string, IPendingPermission>();
	private readonly cancelledStarts = new Set<string>();
	private readonly prompting = new Set<string>();
	private readonly eventOwners = new Map<string, symbol>();
	private disposed = false;
	private readonly hostRequests = new Map<string, { sessionId: string; ownerId: string; resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
	private readonly hostOwners = new Map<string, string>();
	private readonly _onDidEmitEvent = this._register(new Emitter<IExternalAgentEvent>());
	readonly onDidEmitEvent: Event<IExternalAgentEvent> = this._onDidEmitEvent.event;

	getUsage(agentId: string): Promise<import('../../externalAgents/externalAgentTypes.js').IExternalAgentUsage> {
		const usage = this.registry.resolveUsage(agentId);
		return usage
			? readCodexAppServerUsage(usage.executable, usage.args, usage.runAsNode)
			: Promise.resolve({ detail: 'Account limits are not exposed by this agent. Check usage with its provider.', windows: [] });
	}

	listAgents(env?: NodeJS.ProcessEnv): IExternalAgentDescriptor[] {
		return this.registry.list(env);
	}
	registerAgent(value: import('../../externalAgents/externalAgentTypes.js').IExternalAgentRegistration): void { this.registry.register(value); }

	async startSession(request: IExternalAgentStartRequest, env?: NodeJS.ProcessEnv): Promise<IExternalAgentSessionInfo> {
		if (this.disposed) { throw new Error('External agent service is disposed.'); }
		const pending = this.starting.get(request.cleanSlateSessionId);
		if (pending) {
			return pending.then(info => request.modelSelection || info.config.agentId !== request.config.agentId ? this.startSession(request, env) : info);
		}
		this.cancelledStarts.delete(request.cleanSlateSessionId);
		const starting = this.createOrUpdateSession(request, env).finally(() => this.starting.delete(request.cleanSlateSessionId));
		this.starting.set(request.cleanSlateSessionId, starting);
		return starting;
	}

	private async createOrUpdateSession(request: IExternalAgentStartRequest, env?: NodeJS.ProcessEnv): Promise<IExternalAgentSessionInfo> {
		const requestedCwd = request.cwd?.trim();
		const cwd = requestedCwd
			? (requestedCwd.startsWith('file:') ? fileURLToPath(requestedCwd) : requestedCwd)
			: path.join(tmpdir(), 'cleanslate-external-agents', request.cleanSlateSessionId);
		if (!path.isAbsolute(cwd)) {
			throw new Error('External agents require an absolute project path.');
		}
		if (!requestedCwd) {
			await mkdir(cwd, { recursive: true, mode: 0o700 });
		}
		const existing = this.sessions.get(request.cleanSlateSessionId);
		if (this.prompting.has(request.cleanSlateSessionId) && (request.modelSelection
			|| existing?.config.agentId !== request.config.agentId || existing.cwd !== cwd
			|| request.hostTools && this.hostOwners.get(request.cleanSlateSessionId) !== request.hostTools.ownerId)) {
			throw new Error('Stop the current response before changing its agent, model, workspace, or IDE owner.');
		}
		if (existing && existing.config.agentId === request.config.agentId && existing.cwd === cwd
			&& (!request.hostTools || this.hostOwners.get(request.cleanSlateSessionId) === request.hostTools.ownerId)) {
			if (request.modelSelection) { await existing.selectModel(request.modelSelection.configId, request.modelSelection.value); }
			return { cleanSlateSessionId: request.cleanSlateSessionId, externalSessionId: existing.externalSessionId, config: existing.config, models: existing.models, controls: existing.controls };
		}
		await this.disposeSession(request.cleanSlateSessionId);
		const launch = this.registry.resolve(request.config.agentId, env);
		const eventOwner = Symbol();
		this.eventOwners.set(request.cleanSlateSessionId, eventOwner);
		if (request.hostTools) { this.hostOwners.set(request.cleanSlateSessionId, request.hostTools.ownerId); }
		let session: ExternalAgentSession | undefined;
		session = await ExternalAgentSession.create(
			request.cleanSlateSessionId,
			request.config,
			cwd,
			launch,
			{
				createHostTools: request.hostTools ? () => createHostToolsBridge(request.hostTools!.tools.map(tool => ({
					definition: { ...tool, inputSchema: { ...tool.inputSchema, type: 'object' as const } },
					call: async input => {
						const result = await this.requestHostTool(request.cleanSlateSessionId, request.hostTools!.ownerId, tool.name, input);
						return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? null) }] };
					}
				})), async () => { this.cancelHostRequests(request.cleanSlateSessionId); })
					: this.createHostTools ? () => this.createHostTools!(request.cleanSlateSessionId, cwd) : undefined,
				onEvent: event => {
					if (this.disposed || this.eventOwners.get(request.cleanSlateSessionId) !== eventOwner) { return; }
					this._onDidEmitEvent.fire(event);
					if (event.type === 'status' && event.status !== 'running') {
						this.cancelPermissions(request.cleanSlateSessionId);
						this.cancelHostRequests(request.cleanSlateSessionId);
					}
					if (event.type === 'status' && event.status === 'failed' && session && this.sessions.get(request.cleanSlateSessionId) === session) {
						this.sessions.delete(request.cleanSlateSessionId);
						this.eventOwners.delete(request.cleanSlateSessionId);
						this.cancelPermissions(request.cleanSlateSessionId);
						void session.dispose();
					}
				},
				requestPermission: permission => this.disposed || this.eventOwners.get(request.cleanSlateSessionId) !== eventOwner
					? Promise.resolve({ outcome: { outcome: 'cancelled' } })
					: this.requestPermission(request.cleanSlateSessionId, permission)
			},
			request.externalSessionId
		);
		if (this.disposed) {
			await session.dispose();
			throw new Error('External agent service is disposed.');
		}
		this.sessions.set(request.cleanSlateSessionId, session);
		if (request.modelSelection) { await session.selectModel(request.modelSelection.configId, request.modelSelection.value); }
		return { cleanSlateSessionId: request.cleanSlateSessionId, externalSessionId: session.externalSessionId, config: request.config, models: session.models, controls: session.controls };
	}

	async prompt(request: IExternalAgentPromptRequest): Promise<void> {
		if (this.cancelledStarts.delete(request.cleanSlateSessionId)) {
			this._onDidEmitEvent.fire({ type: 'status', cleanSlateSessionId: request.cleanSlateSessionId, status: 'cancelled' });
			return;
		}
		const session = this.sessions.get(request.cleanSlateSessionId);
		if (!session) {
			throw new Error('External agent session is not active.');
		}
		if (this.prompting.has(request.cleanSlateSessionId)) { throw new Error('This agent already has a running response.'); }
		this.prompting.add(request.cleanSlateSessionId);
		try { await session.prompt(request.prompt, request.images); }
		finally { this.prompting.delete(request.cleanSlateSessionId); }
	}

	async cancel(cleanSlateSessionId: string): Promise<void> {
		this.cancelHostRequests(cleanSlateSessionId);
		if (this.starting.has(cleanSlateSessionId) && !this.prompting.has(cleanSlateSessionId)) { this.cancelledStarts.add(cleanSlateSessionId); }
		this.cancelPermissions(cleanSlateSessionId);
		await this.sessions.get(cleanSlateSessionId)?.cancel();
	}

	respondToPermission(response: IExternalAgentPermissionResponse): void {
		const pending = this.permissions.get(response.requestId);
		if (!pending) {
			return;
		}
		this.permissions.delete(response.requestId);
		const validOption = pending.request.options.find(option => option.optionId === response.optionId);
		pending.resolve(validOption
			? { outcome: { outcome: 'selected', optionId: validOption.optionId } }
			: { outcome: { outcome: 'cancelled' } });
	}

	async closeSession(cleanSlateSessionId: string): Promise<void> {
		await this.starting.get(cleanSlateSessionId)?.catch(() => undefined);
		await this.disposeSession(cleanSlateSessionId);
		this.cancelledStarts.delete(cleanSlateSessionId);
	}

	private async disposeSession(cleanSlateSessionId: string): Promise<void> {
		this.cancelHostRequests(cleanSlateSessionId);
		this.hostOwners.delete(cleanSlateSessionId);
		this.eventOwners.delete(cleanSlateSessionId);
		this.cancelPermissions(cleanSlateSessionId);
		const session = this.sessions.get(cleanSlateSessionId);
		if (!session) {
			return;
		}
		this.sessions.delete(cleanSlateSessionId);
		this.cancelPermissions(cleanSlateSessionId);
		await session.dispose();
	}

	private cancelPermissions(cleanSlateSessionId: string): void {
		for (const [requestId, pending] of this.permissions) {
			if (pending.cleanSlateSessionId === cleanSlateSessionId) {
				this.permissions.delete(requestId);
				pending.resolve({ outcome: { outcome: 'cancelled' } });
			}
		}
	}

	private requestHostTool(sessionId: string, ownerId: string, name: string, input: Record<string, unknown>): Promise<unknown> {
		if (this.disposed || !this.prompting.has(sessionId)) { return Promise.reject(new Error('No active agent response.')); }
		const requestId = generateUuid();
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.hostRequests.delete(requestId);
				this._onDidEmitEvent.fire({ type: 'host_tool_cancel', cleanSlateSessionId: sessionId, ownerId, requestId });
				reject(new Error('The IDE did not answer this tool request.'));
			}, 120000);
			this.hostRequests.set(requestId, { sessionId, ownerId, resolve, reject, timer });
			this._onDidEmitEvent.fire({ type: 'host_tool', cleanSlateSessionId: sessionId, ownerId, requestId, name, input });
		});
	}

	respondToHostTool(response: import('../../externalAgents/externalAgentTypes.js').IExternalAgentHostToolResponse): void {
		const request = this.hostRequests.get(response.requestId);
		if (!request || request.ownerId !== response.ownerId) { return; }
		this.hostRequests.delete(response.requestId);
		clearTimeout(request.timer);
		if (response.error) { request.reject(new Error(response.error)); }
		else { request.resolve(response.result); }
	}

	private cancelHostRequests(sessionId: string): void {
		for (const [id, request] of this.hostRequests) {
			if (request.sessionId !== sessionId) { continue; }
			this.hostRequests.delete(id);
			this._onDidEmitEvent.fire({ type: 'host_tool_cancel', cleanSlateSessionId: sessionId, ownerId: request.ownerId, requestId: id });
			clearTimeout(request.timer);
			request.reject(new Error('The agent tool request was cancelled.'));
		}
	}

	private requestPermission(cleanSlateSessionId: string, request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
		const requestId = generateUuid();
		return new Promise(resolve => {
			this.permissions.set(requestId, { cleanSlateSessionId, request, resolve });
			this._onDidEmitEvent.fire({
				type: 'permission', cleanSlateSessionId, requestId,
				title: request.toolCall.title ?? 'Permission required',
				options: request.options.map(option => ({ id: option.optionId, name: option.name, kind: option.kind }))
			});
		});
	}

	override dispose(): void {
		this.disposed = true;
		this.eventOwners.clear();
		for (const sessionId of [...this.sessions.keys()]) {
			void this.closeSession(sessionId);
		}
		super.dispose();
	}
}
