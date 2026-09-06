/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../core/event.js';
import type { CleanSlateStreamPart } from '../agent/cleanSlateAgentTypes.js';

export type CleanSlateChildAgentKind = 'worker' | 'researcher';
export type CleanSlateChildAgentStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ICleanSlateSpawnAgentRequest {
	description: string;
	prompt: string;
	kind?: CleanSlateChildAgentKind;
	parentAgentId?: string;
}

export interface ICleanSlateChildAgentSnapshot {
	id: string;
	parentAgentId?: string;
	kind: CleanSlateChildAgentKind;
	description: string;
	prompt: string;
	status: CleanSlateChildAgentStatus;
	createdAt: number;
	startedAt?: number;
	completedAt?: number;
	output?: string;
	error?: string;
}

export interface ICleanSlateChildAgentEvent {
	type: 'created' | 'started' | 'progress' | 'completed' | 'failed' | 'cancelled';
	agent: ICleanSlateChildAgentSnapshot;
	delta?: string;
	/** Native runtime event used by hosts to render the child with their normal chat UI. */
	streamPart?: CleanSlateStreamPart;
}

export interface ICleanSlateChildAgentExecutionContext {
	id: string;
	signal: AbortSignal;
	emitProgress(delta: string): void;
	emitStreamPart(part: CleanSlateStreamPart): void;
}

export type CleanSlateChildAgentExecutor = (
	request: Readonly<ICleanSlateSpawnAgentRequest>,
	context: ICleanSlateChildAgentExecutionContext
) => Promise<string>;

export interface ICleanSlateAgentCoordinatorOptions {
	maxConcurrentAgents?: number;
	createId?: () => string;
	now?: () => number;
}

export interface ICleanSlateWaitForAgentOptions {
	timeoutMs?: number;
	signal?: AbortSignal;
}

/** Model-only completion envelope shared by every host runtime. */
export function formatCleanSlateChildAgentNotification(agent: ICleanSlateChildAgentSnapshot): string {
	const payload = JSON.stringify({
		agentId: agent.id,
		description: agent.description,
		status: agent.status,
		output: agent.output,
		error: agent.error
	});
	return `<child_agent_notification>${payload.slice(0, 12000)}</child_agent_notification>`;
}

/**
 * Host-independent lifecycle owner for child agents.
 *
 * The model-facing tool delegates here; the host only supplies the function
 * that actually runs a child. This keeps identities, cancellation and status
 * consistent across the editor, CLI and third-party SDK hosts.
 */
export class CleanSlateAgentCoordinator {
	private readonly agents = new Map<string, ICleanSlateChildAgentSnapshot>();
	private readonly controllers = new Map<string, AbortController>();
	private readonly completions = new Map<string, Promise<ICleanSlateChildAgentSnapshot>>();
	private readonly _onDidChangeAgent = new Emitter<ICleanSlateChildAgentEvent>();
	readonly onDidChangeAgent: Event<ICleanSlateChildAgentEvent> = this._onDidChangeAgent.event;

	private readonly maxConcurrentAgents: number;
	private readonly createId: () => string;
	private readonly now: () => number;

	constructor(
		private readonly executor: CleanSlateChildAgentExecutor,
		options: ICleanSlateAgentCoordinatorOptions = {}
	) {
		this.maxConcurrentAgents = Math.max(1, Math.floor(options.maxConcurrentAgents ?? 4));
		this.createId = options.createId ?? (() => `agent-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
		this.now = options.now ?? Date.now;
	}

	listAgents(parentAgentId?: string): ICleanSlateChildAgentSnapshot[] {
		return Array.from(this.agents.values())
			.filter(agent => parentAgentId === undefined || agent.parentAgentId === parentAgentId)
			.map(agent => ({ ...agent }))
			.sort((left, right) => left.createdAt - right.createdAt);
	}

	getAgent(id: string): ICleanSlateChildAgentSnapshot | undefined {
		const agent = this.agents.get(id);
		return agent ? { ...agent } : undefined;
	}

	async spawnAgent(request: ICleanSlateSpawnAgentRequest, parentSignal?: AbortSignal): Promise<ICleanSlateChildAgentSnapshot> {
		const normalized = this.normalizeRequest(request);
		if (this.runningCount() >= this.maxConcurrentAgents) {
			throw new Error(`Child agent limit reached (${this.maxConcurrentAgents}). Wait for an active agent to finish.`);
		}

		const id = this.createId();
		const created: ICleanSlateChildAgentSnapshot = {
			id,
			parentAgentId: normalized.parentAgentId,
			kind: normalized.kind ?? 'worker',
			description: normalized.description,
			prompt: normalized.prompt,
			status: 'queued',
			createdAt: this.now()
		};
		this.agents.set(id, created);
		this.fire('created', created);

		const controller = new AbortController();
		this.controllers.set(id, controller);
		const abortFromParent = () => {
			this.cancelAgent(id, this.abortReason(parentSignal?.reason, 'Cancelled by parent agent.'));
		};
		if (parentSignal?.aborted) {
			abortFromParent();
			this.controllers.delete(id);
			return this.getAgent(id) ?? created;
		} else {
			parentSignal?.addEventListener('abort', abortFromParent, { once: true });
		}

		const running = this.update(id, { status: 'running', startedAt: this.now() }, 'started');
		const completion = this.executeAgent(id, normalized, controller, parentSignal, abortFromParent);
		this.completions.set(id, completion);
		void completion.finally(() => this.completions.delete(id));
		return running;
	}

	async waitForAgent(id: string, options: ICleanSlateWaitForAgentOptions = {}): Promise<ICleanSlateChildAgentSnapshot> {
		const current = this.getAgent(id);
		if (!current) {
			throw new Error(`Unknown child agent: ${id}`);
		}
		if (this.isTerminal(current.status)) {
			return current;
		}
		const completion = this.completions.get(id);
		if (!completion) {
			return current;
		}
		const timeoutMs = Math.max(0, Math.floor(options.timeoutMs ?? 0));
		return new Promise<ICleanSlateChildAgentSnapshot>((resolve, reject) => {
			let settled = false;
			let timer: ReturnType<typeof setTimeout> | undefined;
			let listener: { dispose(): void } | undefined;
			const finish = (callback: () => void): void => {
				if (settled) {
					return;
				}
				settled = true;
				if (timer !== undefined) {
					clearTimeout(timer);
				}
				options.signal?.removeEventListener('abort', onAbort);
				listener?.dispose();
				callback();
			};
			const onAbort = () => finish(() => reject(options.signal?.reason ?? new Error('Waiting for child agent was cancelled.')));
			if (options.signal?.aborted) {
				onAbort();
				return;
			}
			options.signal?.addEventListener('abort', onAbort, { once: true });
			listener = this.onDidChangeAgent(event => {
				if (event.agent.id === id && this.isTerminal(event.agent.status)) {
					finish(() => resolve(event.agent));
				}
			});
			if (timeoutMs > 0) {
				timer = setTimeout(() => finish(() => resolve(this.getAgent(id) ?? current)), timeoutMs);
			}
			void completion.then(agent => finish(() => resolve(agent)), error => finish(() => reject(error)));
		});
	}

	private async executeAgent(
		id: string,
		request: ICleanSlateSpawnAgentRequest,
		controller: AbortController,
		parentSignal: AbortSignal | undefined,
		abortFromParent: () => void
	): Promise<ICleanSlateChildAgentSnapshot> {
		try {
			const output = await this.executor(request, {
				id,
				signal: controller.signal,
				emitProgress: delta => {
					if (typeof delta === 'string' && delta.length > 0) {
						const current = this.agents.get(id);
						if (!current || this.isTerminal(current.status)) {
							return;
						}
						const next = { ...current, output: `${current.output ?? ''}${delta}` };
						this.agents.set(id, next);
						this.fire('progress', next, delta);
					}
				},
				emitStreamPart: streamPart => {
					const delta = (streamPart.type === 'chat_text' || streamPart.type === 'text')
						? streamPart.content
						: undefined;
					const current = this.agents.get(id);
					if (!current || this.isTerminal(current.status)) {
						return;
					}
					const next = delta ? { ...current, output: `${current.output ?? ''}${delta}` } : current;
					if (next !== current) {
						this.agents.set(id, next);
					}
					this.fire('progress', next, delta, streamPart);
				}
			});
			if (controller.signal.aborted) {
				return this.markCancelled(id);
			}
			return this.update(id, { status: 'completed', completedAt: this.now(), output }, 'completed');
		} catch (error) {
			if (controller.signal.aborted) {
				return this.markCancelled(id);
			}
			return this.update(id, {
				status: 'failed',
				completedAt: this.now(),
				error: error instanceof Error ? error.message : String(error)
			}, 'failed');
		} finally {
			parentSignal?.removeEventListener('abort', abortFromParent);
			this.controllers.delete(id);
		}
	}

	cancelAgent(id: string, reason = 'Cancelled by host.'): boolean {
		const controller = this.controllers.get(id);
		const current = this.agents.get(id);
		if (!controller || !current || this.isTerminal(current.status)) {
			return false;
		}
		// Cancellation is a lifecycle transition, not merely a request to the
		// executor. Publish it synchronously so hosts can unlock their composers
		// even when an underlying command takes time to react to AbortSignal.
		this.markCancelled(id);
		controller.abort(reason);
		return true;
	}

	private markCancelled(id: string): ICleanSlateChildAgentSnapshot {
		const current = this.agents.get(id);
		if (!current) {
			throw new Error(`Unknown child agent: ${id}`);
		}
		if (this.isTerminal(current.status)) {
			return { ...current };
		}
		return this.update(id, { status: 'cancelled', completedAt: this.now() }, 'cancelled');
	}

	private abortReason(reason: unknown, fallback: string): string {
		if (reason instanceof Error && reason.message.trim()) {
			return reason.message;
		}
		return typeof reason === 'string' && reason.trim() ? reason : fallback;
	}

	private normalizeRequest(request: ICleanSlateSpawnAgentRequest): ICleanSlateSpawnAgentRequest {
		const description = request?.description?.trim();
		const prompt = request?.prompt?.trim();
		if (!description) {
			throw new Error('A child agent description is required.');
		}
		if (!prompt) {
			throw new Error('A child agent prompt is required.');
		}
		const kind = request.kind ?? 'worker';
		if (kind !== 'worker' && kind !== 'researcher') {
			throw new Error(`Unsupported child agent kind: ${String(kind)}`);
		}
		return { ...request, description, prompt, kind };
	}

	private runningCount(): number {
		return Array.from(this.agents.values()).filter(agent => agent.status === 'queued' || agent.status === 'running').length;
	}

	private isTerminal(status: CleanSlateChildAgentStatus): boolean {
		return status === 'completed' || status === 'failed' || status === 'cancelled';
	}

	private update(
		id: string,
		patch: Partial<ICleanSlateChildAgentSnapshot>,
		eventType: ICleanSlateChildAgentEvent['type']
	): ICleanSlateChildAgentSnapshot {
		const current = this.agents.get(id);
		if (!current) {
			throw new Error(`Unknown child agent: ${id}`);
		}
		const next = { ...current, ...patch };
		this.agents.set(id, next);
		this.fire(eventType, next);
		return { ...next };
	}

	private fire(
		type: ICleanSlateChildAgentEvent['type'],
		agent: ICleanSlateChildAgentSnapshot,
		delta?: string,
		streamPart?: CleanSlateStreamPart
	): void {
		this._onDidChangeAgent.fire({ type, agent: { ...agent }, delta, streamPart });
	}
}
