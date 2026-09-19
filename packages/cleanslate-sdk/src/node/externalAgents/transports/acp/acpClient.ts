/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk';
import { IExternalAgentEvent } from '../../../../externalAgents/externalAgentTypes.js';
import { IExternalAgentLaunchConfiguration } from '../../externalAgentRegistry.js';
import { AcpConnection } from './acpConnection.js';
import { mapAcpEvent } from './acpEventMapper.js';
import { AcpProcess } from './acpProcess.js';
import { ExternalFileSnapshots } from '../../externalFileSnapshots.js';

export interface IAcpClientHandlers {
	readonly onEvent: (event: IExternalAgentEvent) => void;
	readonly requestPermission: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>;
}

export class AcpClient {
	private readonly completedEdits = new Map<string, Extract<IExternalAgentEvent, { type: 'tool' }>>();
	private cancelRequested = false;
	private snapshot: ExternalFileSnapshots | undefined;
	private eventQueue: Promise<void> = Promise.resolve();

	private enqueueEvent(event: IExternalAgentEvent): void {
		this.eventQueue = this.eventQueue.then(async () => {
			if (event.type === 'tool') {
				const previous = this.completedEdits.get(event.toolCallId);
				if (event.kind === 'edit' || previous) {
					const edit = { ...previous, ...event, status: event.status ?? previous?.status, fileChanges: event.fileChanges ?? previous?.fileChanges, kind: event.kind ?? previous?.kind, locations: event.locations ?? previous?.locations };
					this.completedEdits.set(event.toolCallId, edit);
					if (edit.status === 'completed' && previous?.status !== 'completed') {
						const fileChanges = await this.snapshot?.changes(edit);
						event = { ...edit, fileChanges: edit.fileChanges ?? fileChanges };
					}
				}
			}
			this.handlers.onEvent(event);
		});
	}
	private constructor(
		private readonly cleanSlateSessionId: string,
		private readonly connection: AcpConnection,
		private readonly handlers: IAcpClientHandlers,
		private readonly cwd: string
	) { }

	static async create(cleanSlateSessionId: string, cwd: string, launch: IExternalAgentLaunchConfiguration & { executable: string }, handlers: IAcpClientHandlers): Promise<AcpClient> {
		const agentProcess = new AcpProcess(launch, cwd);
		let client: AcpClient | undefined;
		let connection: AcpConnection;
		const approvalSnapshots = new Map<string, RequestPermissionRequest['toolCall']>();
		try {
			connection = await AcpConnection.create(agentProcess, {
			onSessionUpdate: notification => {
				if (notification.sessionId !== client?.externalSessionId) {
					return;
				}
				let update = notification.update;
				if (update.sessionUpdate === 'tool_call_update' || update.sessionUpdate === 'tool_call') {
					const snapshot = approvalSnapshots.get(update.toolCallId);
					if (update.status === 'completed' || update.status === 'failed') { approvalSnapshots.delete(update.toolCallId); }
					if (snapshot && update.status === 'completed') {
						update = { ...snapshot, ...update, sessionUpdate: 'tool_call_update', content: [...(snapshot.content ?? []), ...(update.content ?? [])], rawInput: update.rawInput ?? snapshot.rawInput };
					}
				}
				const event = mapAcpEvent(cleanSlateSessionId, update, launch.thoughtPresentation ?? 'reasoning');
				if (notification.update.sessionUpdate === 'config_option_update' || notification.update.sessionUpdate === 'current_mode_update') {
					handlers.onEvent({ type: 'controls', cleanSlateSessionId, controls: client.controls, models: client.models });
				}
				if (event) {
					client.enqueueEvent(event);
				}
			},
			requestPermission: request => {
				if (request.sessionId !== client?.externalSessionId) {
					return Promise.resolve({ outcome: { outcome: 'cancelled' as const } });
				}
				// A proposed edit is not a completed edit. Preserve its snapshot
				// only for a later successful tool notification.
				approvalSnapshots.set(request.toolCall.toolCallId, request.toolCall);
				return handlers.requestPermission(request).then(response => {
					if (response.outcome.outcome === 'cancelled') { approvalSnapshots.delete(request.toolCall.toolCallId); }
					return response;
				});
			},
			onError: error => handlers.onEvent({ type: 'status', cleanSlateSessionId, status: 'failed', detail: error.message })
			});
		} catch (error) {
			await agentProcess.stop();
			throw error;
		}
		client = new AcpClient(cleanSlateSessionId, connection, handlers, cwd);
		return client;
	}

	externalSessionId: string | undefined;
	get models() { return this.connection.modelOptions; }
	get controls() { return this.connection.controls; }
	async selectModel(configId: string, value: string): Promise<void> {
		if (!this.externalSessionId) { throw new Error('Agent session is not ready.'); }
		await this.connection.selectModel(this.externalSessionId, configId, value);
	}

	async start(cwd: string, existingSessionId?: string, servers: import('@agentclientprotocol/sdk').McpServer[] = []): Promise<string> {
		if (existingSessionId) {
			try {
				// Loading may replay notifications before its response arrives.
				this.externalSessionId = existingSessionId;
				await this.connection.loadSession(existingSessionId, cwd, servers);
				await this.eventQueue;
				return existingSessionId;
			} catch { this.externalSessionId = undefined; }
		}
		const response = await this.connection.newSession(cwd, servers);
		this.externalSessionId = response.sessionId;
		return response.sessionId;
	}

	async prompt(text: string, images?: readonly string[]): Promise<void> {
		if (!this.externalSessionId) {
			throw new Error('External agent session has not started.');
		}
		this.handlers.onEvent({ type: 'status', cleanSlateSessionId: this.cleanSlateSessionId, status: 'running' });
		this.cancelRequested = false;
		try {
			this.completedEdits.clear();
			this.snapshot = await ExternalFileSnapshots.capture(this.cwd);
			if (this.cancelRequested) {
				this.handlers.onEvent({ type: 'status', cleanSlateSessionId: this.cleanSlateSessionId, status: 'cancelled' });
				return;
			}
			const response = await this.connection.prompt(this.externalSessionId, text, images);
			await this.eventQueue;
			const status = response.stopReason === 'cancelled' ? 'cancelled' : 'completed';
			this.handlers.onEvent({ type: 'status', cleanSlateSessionId: this.cleanSlateSessionId, status });
		} catch (error) {
			await this.eventQueue.catch(() => undefined);
			this.handlers.onEvent({ type: 'status', cleanSlateSessionId: this.cleanSlateSessionId, status: 'failed', detail: error instanceof Error ? error.message : String(error) });
			throw error;
		} finally { this.snapshot = undefined; this.completedEdits.clear(); this.eventQueue = Promise.resolve(); }
	}

	async cancel(): Promise<void> {
		this.cancelRequested = true;
		if (this.externalSessionId) {
			await this.connection.cancel(this.externalSessionId);
		}
	}

	dispose(): Promise<void> {
		return this.connection.dispose();
	}
}
