/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import { basename, isAbsolute, resolve } from 'path';
import type { CleanSlateStreamPart } from '../agent/cleanSlateAgentTypes.js';
import {
	CLEANSLATE_HOSTED_AGENT_OWNER,
	type ICleanSlateHostedAgentRunRequest,
	type ICleanSlateHostedApproval,
	type ICleanSlateHostedArtifact,
	type ICleanSlatePersistedSession,
	type ICleanSlateThreadSessionUpdate
} from '../protocol/cleanSlateAI.js';
import type { CleanSlateNodeAgentRuntime } from './cleanSlateNodeAgentRuntime.js';
import type { AgentDefinition } from '../composer/registry/agentSchema.js';
import type { ICleanSlateChildAgentEvent } from '../services/cleanSlateAgentCoordinator.js';

export type HostedAgentRuntime = Pick<CleanSlateNodeAgentRuntime,
	'run' | 'plan' | 'approvePlan' | 'rejectPlan' | 'resumePendingQuestion' | 'getPendingQuestion' |
	'getSessionSnapshot' | 'restoreSessionSnapshot' | 'configureRun' | 'dispose'> & Partial<Pick<CleanSlateNodeAgentRuntime, 'cancelChildAgent'>>;

export interface IHostedAgentHooks {
	approveCommand(request: { command: string; cwd?: string; reason?: string }): Promise<boolean>;
	getImages(): readonly string[];
	onArtifact(artifact: ICleanSlateHostedArtifact): void;
	onAgentEvent(event: ICleanSlateChildAgentEvent): void;
	onBrowserState(state: { viewId: string; url: string; title: string }): void;
}

interface IHostedEntry {
	runtime: HostedAgentRuntime;
	request: ICleanSlateHostedAgentRunRequest;
	session: ICleanSlatePersistedSession;
	controller: AbortController;
	runId: string;
	running: boolean;
	completion?: Promise<void>;
	timer?: ReturnType<typeof setTimeout>;
	approvals: Map<string, { request: ICleanSlateHostedApproval; resolve: (approved: boolean) => void }>;
	transcript: HostedTranscript;
	artifacts: Map<string, ICleanSlateHostedArtifact>;
	childAgentEvents: { sequence: number; event: ICleanSlateChildAgentEvent }[];
	browser?: { viewId: string; url: string; title: string };
	surface?: 'ide' | 'agentManager';
	transportStatus?: Extract<CleanSlateStreamPart, { type: 'transport_status' }>['status'];
}

/** Owns execution, cancellation and checkpoints. Subscribing or detaching a view
 * has no effect on a run's AbortController or async iterator. */
export class CleanSlateHostedAgentRuntime {
	private readonly entries = new Map<string, IHostedEntry>();
	private disposed = false;

	constructor(
		private readonly createRuntime: (request: ICleanSlateHostedAgentRunRequest, hooks: IHostedAgentHooks) => HostedAgentRuntime,
		private readonly onUpdate: (update: ICleanSlateThreadSessionUpdate) => void
	) { }

	async start(request: ICleanSlateHostedAgentRunRequest): Promise<ICleanSlateThreadSessionUpdate> {
		if (this.disposed) {
			throw new Error('The agent host has shut down.');
		}
		const id = request.session.id;
		if (!id || (!request.text.trim() && request.action !== 'approvePlan')) {
			throw new Error('An agent run requires a session and a message.');
		}
		let entry = this.entries.get(id);
		if (entry?.running) {
			throw new Error('This chat already has a running agent.');
		}
		if (!entry) {
			const runtime = this.createRuntime(request, {
				approveCommand: command => this.requestApproval(id, command),
				getImages: () => this.entries.get(id)?.request.images ?? [],
				onAgentEvent: event => {
					const target = this.entries.get(id);
					if (!target || event.agent.parentAgentId !== id) { return; }
					const item = { sequence: target.childAgentEvents.length + 1, event: structuredClone(event) };
					target.childAgentEvents.push(item);
					const snapshot = this.snapshot(target);
					this.onUpdate({ ...snapshot, live: { ...snapshot.live!, childAgentEvents: [item] } });
				},
				onBrowserState: state => {
					const target = this.entries.get(id);
					if (target) { target.browser = state; this.scheduleUpdate(target); }
				},
				onArtifact: artifact => {
					const target = this.entries.get(id);
					if (target) {
						target.artifacts.set(artifact.type, artifact);
						this.scheduleUpdate(target);
					}
				}
			});
			runtime.restoreSessionSnapshot({
				version: 1, sessionId: id,
				agent: request.session.agentRuntimeState ?? {
					version: 1,
					messages: (request.session.transcript?.length ? request.session.transcript : request.session.history)
						.filter(message => !message.isInternalState && (message.role === 'user' || message.role === 'assistant'))
						.map(message => ({ role: message.role as 'user' | 'assistant', content: message.content || message.renderPayload || '' }))
						.filter(message => message.content.trim())
				},
				task: request.session.taskState as ReturnType<HostedAgentRuntime['getSessionSnapshot']>['task'],
				threadHistory: request.session.history
			});
			entry = {
				runtime, request, session: request.session, controller: new AbortController(),
				runId: randomUUID(), running: false, approvals: new Map(), transcript: new HostedTranscript(request.session.workDir), artifacts: new Map(), childAgentEvents: []
			};
			this.entries.set(id, entry);
		}
		entry.request = request;
		entry.surface = request.surface;
		// The host owns native state; the caller only contributes the visible user
		// message which its composer has just added to the transcript.
		const userMessage = request.session.transcript?.at(-1);
		const previous = entry.session.transcript ?? entry.session.history;
		const transcript = [...previous];
		if (userMessage?.role === 'user' && userMessage.id !== transcript.at(-1)?.id) {
			transcript.push(userMessage);
		} else if (transcript.at(-1)?.role !== 'user' && request.action !== 'approvePlan') {
			transcript.push({ id: randomUUID(), role: 'user', content: request.text, images: request.images ? [...request.images] : undefined });
		}

		entry.session = { ...entry.session, planMode: request.session.planMode, reasoningLevel: request.session.reasoningLevel,
			agent: request.session.agent, transcript };
		entry.runId = randomUUID();
		entry.controller = new AbortController();
		entry.transcript = new HostedTranscript(entry.session.workDir);
		entry.running = true;
		const accepted = this.snapshot(entry);
		this.onUpdate(accepted);
		// Start in the host; returning/losing the IPC request never cancels this work.
		entry.completion = this.execute(entry);
		return accepted;
	}

	getSnapshot(sessionId: string): ICleanSlateThreadSessionUpdate | undefined {
		const entry = this.entries.get(sessionId);
		return entry ? this.snapshot(entry, true) : undefined;
	}

	setPresentationSurface(sessionId: string, surface: 'ide' | 'agentManager'): void {
		const entry = this.entries.get(sessionId);
		if (entry) { entry.surface = surface; }
	}

	whenSettled(sessionId: string): Promise<void> {
		return this.entries.get(sessionId)?.completion ?? Promise.resolve();
	}

	handleRequest(update: ICleanSlateThreadSessionUpdate): boolean {
		const entry = this.entries.get(update.session.id);
		if (!entry) {
			return false;
		}
		if (update.request === 'sync' && update.surface) { entry.surface = update.surface; }
		if (update.request === 'cancelChild' && update.childAgentId) {
			entry.runtime.cancelChildAgent?.(update.childAgentId);
		} else if (update.request === 'stop') {
			entry.controller.abort();
			this.resolveApprovals(entry, false);
		} else if (update.request === 'rejectPlan' && !entry.running) {
			entry.runtime.rejectPlan();
		} else if ((update.request === 'approve' || update.request === 'reject') && update.approvalId) {
			const approval = entry.approvals.get(update.approvalId);
			if (approval) {
				entry.approvals.delete(update.approvalId);
				approval.resolve(update.request === 'approve');
			}
		}
		this.onUpdate(this.snapshot(entry, update.request === 'sync'));
		return true;
	}

	remove(sessionId: string): void {
		const entry = this.entries.get(sessionId);
		if (entry) {
			this.entries.delete(sessionId);
			entry.controller.abort();
			this.resolveApprovals(entry, false);
			clearTimeout(entry.timer);
			entry.runtime.dispose();
		}
	}

	dispose(): void {
		this.disposed = true;
		for (const id of this.entries.keys()) {
			this.remove(id);
		}
	}

	private async execute(entry: IHostedEntry): Promise<void> {
		try {
			await entry.runtime.configureRun(entry.request.configuration, entry.session.agent as AgentDefinition | undefined);
			const signal = entry.controller.signal;
			signal.throwIfAborted();
			const stream = entry.request.action === 'approvePlan' ? entry.runtime.approvePlan(signal)
				: entry.runtime.getPendingQuestion() ? entry.runtime.resumePendingQuestion(entry.request.text, signal)
					: entry.session.planMode ? entry.runtime.plan(entry.request.text, signal)
						: entry.runtime.run(entry.request.text, signal);
			let previousPartType: CleanSlateStreamPart['type'] | undefined;
			for await (const part of stream) {
				if (part.type === 'transport_status') { entry.transportStatus = part.status; }
				entry.transcript.accept(part);
				// Publish activity boundaries immediately, as the editor stream did.
				// Coalescing a tool start with its result loses the active animation;
				// coalescing reasoning with completion loses its expanded live body.
				const repeatedTextDelta = previousPartType === part.type && (part.type === 'reasoning'
					|| part.type === 'chat_text' && part.kind !== 'model_terminated_pause');
				if (part.type === 'tool_progress' || part.type === 'text' || repeatedTextDelta) {
					this.scheduleUpdate(entry);
				} else {
					clearTimeout(entry.timer);
					entry.timer = undefined;
					if (this.entries.get(entry.session.id) === entry) {
						this.onUpdate(this.snapshot(entry));
					}
				}
				previousPartType = part.type;
			}
		} catch (error) {
			if (!entry.controller.signal.aborted) {
				entry.transcript.fail(error instanceof Error ? error.message : String(error));
			}
		} finally {
			entry.running = false;
			entry.transportStatus = undefined;
			entry.transcript.settle(entry.controller.signal.aborted);
			this.resolveApprovals(entry, false);
			clearTimeout(entry.timer);
			entry.timer = undefined;
			if (this.entries.get(entry.session.id) === entry) {
				const final = this.snapshot(entry);
				entry.session = final.session;
				entry.transcript = new HostedTranscript(entry.session.workDir);
				this.onUpdate(final);
			}
		}
	}

	private scheduleUpdate(entry: IHostedEntry): void {
		if (!entry.timer) {
			entry.timer = setTimeout(() => {
				entry.timer = undefined;
				if (this.entries.get(entry.session.id) === entry) {
					this.onUpdate(this.snapshot(entry));
				}
			}, 50);
		}
	}

	private requestApproval(sessionId: string, command: { command: string; cwd?: string; reason?: string }): Promise<boolean> {
		const entry = this.entries.get(sessionId);
		if (!entry || entry.controller.signal.aborted) {
			return Promise.resolve(false);
		}
		if (entry.request.configuration.editMode === 'auto') {
			return Promise.resolve(true);
		}
		return new Promise(resolve => {
			const request = { ...command, id: randomUUID(), sessionId, createdAt: Date.now() };
			entry.approvals.set(request.id, { request, resolve });
			this.onUpdate(this.snapshot(entry));
		});
	}

	private resolveApprovals(entry: IHostedEntry, approved: boolean): void {
		for (const approval of entry.approvals.values()) {
			approval.resolve(approved);
		}
		entry.approvals.clear();
	}

	private snapshot(entry: IHostedEntry, includeChildren = false): ICleanSlateThreadSessionUpdate {
		const runtime = entry.runtime.getSessionSnapshot();
		const transcript = [...(entry.session.transcript ?? entry.session.history)];
		const response = entry.transcript.getResponse([...entry.approvals.values()].map(approval => approval.request));
		if (response) {
			transcript.push({ id: `hosted-${entry.runId}`, role: 'assistant', content: '', renderPayload: JSON.stringify(response) });
		}
		if (entry.transcript.error) {
			transcript.push({ id: `hosted-error-${entry.runId}`, role: 'assistant', content: entry.transcript.error });
		}
		// One immutable transport checkpoint, including native state, lets a new
		// renderer recover without replaying tools or restarting a provider request.
		return JSON.parse(JSON.stringify({
			originId: CLEANSLATE_HOSTED_AGENT_OWNER,
			live: { ownerId: CLEANSLATE_HOSTED_AGENT_OWNER, isRunning: entry.running, runId: entry.runId, transportStatus: entry.transportStatus,
				childAgentEvents: includeChildren ? entry.childAgentEvents : undefined,
				approvals: [...entry.approvals.values()].map(approval => approval.request), artifacts: [...entry.artifacts.values()], browser: entry.browser, surface: entry.surface },
			session: { ...entry.session, updatedAt: Date.now(), status: entry.running ? 'running' : 'detached',
				isGenerating: entry.running, history: runtime.threadHistory, transcript, transcriptVersion: 1,
				agentRuntimeState: runtime.agent, taskState: runtime.task }
		})) as ICleanSlateThreadSessionUpdate;
	}
}

/** Portable transcript projection. It never touches a DOM or an editor service. */
class HostedTranscript {
	error: string | undefined;
	private readonly timeline: Array<Record<string, any>> = [];
	private textBlock: Record<string, any> | undefined;
	private reasoningBlock: Record<string, any> | undefined;
	private turnId: string | undefined;
	private planningQuestion: unknown;
	private structuredText = '';
	private structuredResponse: Record<string, unknown> = {};
	private status: 'completed' | 'interrupted' | undefined;
	private readonly inputs = new Map<string, any>();
	private readonly discoveryCalls = new Map<string, { block: Record<string, any>; detailIndex: number; isRead: boolean; toolName: string }>();
	private readonly discoveryTools = new Set([
		'list_dir', 'find_by_name', 'grep_search', 'search_workspace', 'semantic_search', 'search_codebase',
		'get_open_files', 'read_symbols', 'get_definitions', 'find_references', 'read_reference', 'read_lints',
		'read_browser_page', 'read_url_content', 'read_file', 'read_file_range'
	]);

	constructor(private readonly workDir?: string) { }

	accept(part: CleanSlateStreamPart): void {
		switch (part.type) {
			case 'assistant_turn_start':
				this.turnId = part.turnId;
				this.textBlock = undefined;
				this.reasoningBlock = undefined;
				this.structuredText = '';
				break;
			case 'text':
				this.structuredText += part.content;
				try {
					const parsed = JSON.parse(this.structuredText);
					if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
						this.structuredResponse = parsed;
						this.planningQuestion = parsed.planning_question ?? this.planningQuestion;
					}
				} catch { /* Structured responses can arrive in partial chunks. */ }
				break;
			case 'context_usage':
			case 'transport_status':
				// Budgeting stays in the SDK; retry state travels in the live envelope.
				break;
			case 'task_complete': {
				const summary = part.result?.completionSummary?.summary ?? part.result?.finishSummary?.summary;
				if (typeof summary === 'string' && summary.trim() && !this.timeline.some(block => block.type === 'assistant_text' && block.content?.trim())) {
					this.add('assistant_text').content = summary;
				}
				break;
			}
			case 'chat_text':
				if (!this.textBlock) { this.textBlock = this.add('assistant_text'); }
				this.textBlock.content += part.content;
				break;
			case 'context_compaction_start':
				Object.assign(this.add('file', `context-compaction-${part.turnId}`), { status: 'Compacting context...' });
				break;
			case 'context_compaction_complete': {
				const index = this.timeline.findIndex(block => block.id === `context-compaction-${part.turnId}`);
				if (index >= 0) {
					if (!part.compacted) { this.timeline.splice(index, 1); }
					else { Object.assign(this.timeline[index], { status: 'Context compacted', isStreaming: false }); }
				}
				break;
			}
			case 'tool_progress': {
				const block = [...this.timeline].reverse().find(block => part.toolCallId ? block.toolCallId === part.toolCallId : block.toolName === part.toolName && block.toolStatus === 'running');
				if (block && part.progress?.type === 'mutation_stats') {
					Object.assign(block, { type: 'file', path: part.progress.path, status: part.progress.status ?? 'Editing...', added: part.progress.added, deleted: part.progress.deleted });
				} else if (block?.type === 'terminal') {
					if (typeof part.progress?.data === 'string') { block.output = part.progress.data.slice(-20000); }
					if (typeof part.progress?.status === 'string') { block.status = part.progress.status; }
				}
				break;
			}
			case 'reasoning':
				if (!this.reasoningBlock) {
					this.reasoningBlock = this.add('reasoning', `reasoning-${this.turnId ?? randomUUID()}`);
					Object.assign(this.reasoningBlock, { reasoningDurationMs: 0, reasoningSegments: [{ id: this.turnId ?? 'active', content: '' }] });
				}
				this.reasoningBlock.content += part.content;
				this.reasoningBlock.reasoningSegments[0].content = this.reasoningBlock.content;
				this.reasoningBlock.reasoningSegments[0].startedAt ??= Date.now();
				this.reasoningBlock.reasoningStartedAt = this.reasoningBlock.reasoningSegments[0].startedAt;
				this.reasoningBlock.isStreaming = true;
				break;
			case 'chat_text_reset':
				if (this.textBlock) { this.textBlock.content = ''; }
				break;
			case 'reasoning_reset':
				if (this.reasoningBlock) {
					const index = this.timeline.indexOf(this.reasoningBlock);
					if (index >= 0) { this.timeline.splice(index, 1); }
					this.reasoningBlock = undefined;
				}
				break;
			case 'tool_start': {
				this.completeReasoning();
				if (this.textBlock) { this.textBlock.isStreaming = false; }
				this.textBlock = undefined;
				if (this.discoveryTools.has(part.toolName)) {
					const isRead = part.toolName.startsWith('read_file') || part.toolName === 'get_open_files';
					const input = part.input ?? {};
					const rawPath = part.toolName === 'get_open_files' ? 'open files' : input.path ?? input.SearchPath ?? input.Url ?? '.';
					const query = typeof (input.pattern ?? input.query) === 'string' ? (input.pattern ?? input.query).trim() : '';
					const display = query || (rawPath === 'open files' ? rawPath : basename(rawPath) || rawPath);
					const start = input.startLine ?? input.start_line;
					const end = input.endLine ?? input.end_line;
					const range = part.toolName === 'read_file_range' && start ? `${start}-${end ?? start}` : undefined;
					const detail = isRead ? `Reading ${display}${range ? ` #${range}` : ''}` : query ? `Exploring ${query}` : `Exploring ${rawPath}`;
					const previous = this.timeline.at(-1);
					// This prefix is part of the existing file renderer's activity-group
					// contract. Ordinary file blocks without a path are intentionally hidden.
					const block = previous?.id?.startsWith('group-activity-block-') ? previous : this.add('file', `group-activity-block-${randomUUID()}`);
					block.fileCount = (block.fileCount ?? 0) + (isRead ? 1 : 0);
					block.searchCount = (block.searchCount ?? 0) + (isRead ? 0 : 1);
					block.details ??= [];
					block.detailMetadata ??= [];
					const detailIndex = block.details.length;
					block.details.push(detail);
					const absolutePath = typeof rawPath === 'string' && rawPath !== 'open files'
						? (isAbsolute(rawPath) ? rawPath : resolve(this.workDir ?? '.', rawPath)) : undefined;
					block.detailMetadata.push({ label: detail, path: absolutePath, range, query: query || undefined, type: isRead ? 'read' : 'explore' });
					Object.assign(block, { status: block.fileCount > 0 ? 'Analyzing...' : 'Exploring...', isStreaming: true });
					const callId = part.toolCallId ?? `discovery-${randomUUID()}`;
					this.discoveryCalls.set(callId, { block, detailIndex, isRead, toolName: part.toolName });
					break;
				}
				const terminal = part.toolName === 'execute_command' || part.toolName === 'start_background_command';
				const browser = part.toolName.startsWith('browser_');
				const file = ['read_file', 'read_file_range', 'list_dir', 'write_file', 'apply_edit', 'create_and_write_file'].includes(part.toolName);
				const block = this.add(terminal ? 'terminal' : browser ? 'browser' : file ? 'file' : 'tool', part.toolCallId);
				this.inputs.set(block.id, part.input);
				Object.assign(block, { toolName: part.toolName, toolStatus: 'running', status: 'Running',
					toolCallId: part.toolCallId, command: terminal ? part.input?.command : undefined,
					content: part.input?.command ?? part.input?.file_path ?? part.input?.path ?? '' });
				if (browser) {
					Object.assign(block, { browserToolName: part.toolName, browserStatus: 'running', browserUrl: part.input?.url,
						browserAction: part.toolName === 'browser_open' ? 'Opening browser' : part.toolName.replace(/^browser_/, '').replace(/_/g, ' '),
						details: part.input?.url ? [part.input.url] : [] });
				}
				if (file) { Object.assign(block, { path: part.input?.file_path ?? part.input?.path, status: part.toolName.startsWith('read') || part.toolName === 'list_dir' ? 'Reading' : 'Editing' }); }
				break;
			}
			case 'tool_result': {
				const discoveryEntry = part.toolCallId
					? [part.toolCallId, this.discoveryCalls.get(part.toolCallId)] as const
					: [...this.discoveryCalls.entries()].reverse().find(([, call]) => call.toolName === part.toolName);
				const discovery = discoveryEntry?.[1];
				if (discovery) {
					const detail = discovery.block.details?.[discovery.detailIndex];
					if (typeof detail === 'string') {
						discovery.block.details[discovery.detailIndex] = detail.replace(/^Reading /, 'Read ').replace(/^Exploring /, 'Explored ');
						discovery.block.detailMetadata[discovery.detailIndex].label = discovery.block.details[discovery.detailIndex];
					}
					this.discoveryCalls.delete(discoveryEntry![0]);
					const stillRunning = [...this.discoveryCalls.values()].some(call => call.block === discovery.block);
					Object.assign(discovery.block, {
						isStreaming: stillRunning,
						status: stillRunning ? (discovery.block.fileCount > 0 ? 'Analyzing...' : 'Exploring...')
							: discovery.block.fileCount > 0 ? 'Analyzed' : 'Explored'
					});
					break;
				}
				const block = [...this.timeline].reverse().find(block => part.toolCallId ? block.id === part.toolCallId : block.toolName === part.toolName);
				if (block) { Object.assign(block, { isStreaming: false, toolStatus: part.result?.success === false ? 'failed' : 'completed',
					status: part.result?.success === false ? 'Failed' : 'Completed',
					output: typeof part.result?.output === 'string' ? part.result.output.slice(-20000) : undefined,
					exitCode: part.result?.exitCode, details: [part.result?.summary || part.result?.message || part.result?.error].filter(Boolean) }); }
				if (block?.type === 'browser') {
					Object.assign(block, { browserStatus: part.result?.success === false ? 'failed' : 'completed',
						browserUrl: part.result?.url ?? block.browserUrl, browserTitle: part.result?.title,
						browserAction: part.toolName === 'browser_open' ? (part.result?.success === false ? 'Open browser' : 'Opened browser') : block.browserAction });
				}
				if (block?.type === 'file') {
					const mutation = !part.toolName.startsWith('read') && part.toolName !== 'list_dir';
					Object.assign(block, { path: part.result?.path ?? block.path,
						status: part.result?.success === false ? 'Failed' : mutation ? 'Modified' : 'Read',
						added: part.result?.added, deleted: part.result?.deleted, diff: part.result?.diff,
						beforeContent: part.result?.beforeContent, afterContent: part.result?.afterContent });
				}
				if (block && part.toolName === 'submit_artifact' && part.result?.success !== false) {
					const content = this.inputs.get(block.id)?.content;
					if (typeof content === 'string') { this.add('assistant_text').content = content; }
				}
				if (part.toolName === 'ask_question' && part.result?.success !== false) {
					this.planningQuestion = part.result?.planning_question ?? part.result?.question;
				}
				break;
			}
			case 'assistant_turn_complete':
				this.completeReasoning();
				if (this.textBlock) { this.textBlock.isStreaming = false; }
				break;
		}
	}

	fail(message: string): void {
		this.error = message;
		this.status = 'interrupted';
	}

	settle(cancelled: boolean): void {
		this.completeReasoning();
		this.status ??= cancelled ? 'interrupted' : 'completed';
		for (const block of this.timeline) {
			block.isStreaming = false;
			if (block.toolStatus === 'running') { block.toolStatus = 'failed'; block.status = 'Interrupted'; }
		}
	}

	getResponse(approvals: readonly ICleanSlateHostedApproval[] = []): unknown {
		const timeline = this.timeline.map(block => {
			const approval = approvals.find(request => block.type === 'terminal' && block.command === request.command && block.toolStatus === 'running');
			return approval ? { ...block, id: approval.id, awaitingApproval: true, status: 'Awaiting approval' } : block;
		});
		return timeline.length || Object.keys(this.structuredResponse).length || this.planningQuestion
			? { ...this.structuredResponse, timeline, lastToolName: [...timeline].reverse().find(block => block.toolStatus === 'running')?.toolName,
				planning_question: this.planningQuestion, transcriptStatus: this.status } : undefined;
	}

	private add(type: string, id: string = randomUUID()): Record<string, any> {
		const block = { id, type, content: '', isStreaming: true };
		this.timeline.push(block);
		return block;
	}

	private completeReasoning(): void {
		const block = this.reasoningBlock;
		if (!block) { return; }
		for (const segment of block.reasoningSegments ?? []) {
			if (typeof segment.startedAt === 'number') {
				segment.durationMs = (segment.durationMs ?? 0) + Math.max(0, Date.now() - segment.startedAt);
				segment.startedAt = undefined;
			}
		}
		block.isStreaming = false;
		block.reasoningStartedAt = undefined;
		block.reasoningDurationMs = (block.reasoningSegments ?? []).reduce((total: number, segment: { durationMs?: number }) => total + (segment.durationMs ?? 0), 0);
	}
}
