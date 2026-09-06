/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Emitter } from '../core/event.js';
import { CleanSlateHostedAgentRuntime, type HostedAgentRuntime } from '../node/cleanSlateHostedAgentRuntime.js';
import type { CleanSlateStreamPart } from '../agent/cleanSlateAgentTypes.js';
import { CleanSlateNodeAgentRuntime, createNodeProviderConfiguration } from '../node/cleanSlateNodeAgentRuntime.js';
import { NodeCleanSlateMainService } from '../node/cleanSlateNodeMainService.js';
import { CLEANSLATE_HOSTED_AGENT_OWNER, type ICleanSlateHostedAgentRunRequest, type ICleanSlateThreadSessionUpdate } from '../protocol/cleanSlateAI.js';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>(settle => { resolve = settle; });
	return { promise, resolve };
}

for (const cancel of [false, true]) {
	test(`real hosted worker ${cancel ? 'cancellation stops the parent without replacement' : 'completion releases the waiting parent'}`, { timeout: 10000 }, async () => {
		const configuration = createNodeProviderConfiguration({ provider: 'openai', model: 'gpt-4o', apiKey: 'test' });
		const mainService = new NodeCleanSlateMainService(process.cwd());
		let workerId = '';
		let parentCalls = 0;
		let spawned = 0;
		let finishChild: (() => void) | undefined;
		const waiting = deferred();
		const childReady = deferred();
		(mainService as any).openAICompatibleChatStream = (options: any, token: any) => {
			const emitter = new Emitter<any>();
			token.onCancellationRequested(() => emitter.fire(null));
			const send = (value: any) => emitter.fire('data: ' + JSON.stringify(value) + '\n\n');
			setTimeout(() => {
				if (options.options?.sessionId === workerId) {
					finishChild = () => { send({ type: 'text', content: 'Worker result.', phase: 'final_answer' }); emitter.fire(null); };
					childReady.resolve();
					return;
				}
				parentCalls++;
				if (parentCalls <= 2) {
					send({ type: 'tool_call', call: { id: `call-${parentCalls}`, toolName: parentCalls === 1 ? 'spawn_worker' : 'wait_worker',
						input: parentCalls === 1 ? { description: 'Inspect', prompt: 'Return one sentence.' } : { agent_id: workerId } } });
				} else { send({ type: 'text', content: 'Parent finished.', phase: 'final_answer' }); }
				// The model transport can remain open while a blocking worker runs.
				if (parentCalls !== 2) { emitter.fire(null); }
			}, 0);
			return emitter.event;
		};
		const host = new CleanSlateHostedAgentRuntime((request, hooks) => new CleanSlateNodeAgentRuntime({
			rootPath: process.cwd(), sessionId: request.session.id, mainService, configuration,
			onAgentEvent: event => {
				if (event.eventType === 'created') { workerId = event.agent.id; spawned++; }
				hooks.onAgentEvent({ type: event.eventType, agent: event.agent, delta: event.delta, streamPart: event.streamPart });
			}
		}), update => {
			if (update.session.transcript?.some(message => message.renderPayload && JSON.parse(message.renderPayload).lastToolName === 'wait_worker')) { waiting.resolve(); }
		});
		try {
			await host.start({ session: { id: 'waiting-parent', title: 'Wait', savedAt: 1, history: [] }, text: 'Spawn a worker and wait for its result.', configuration });
			await waiting.promise;
			await childReady.promise;
			assert.ok(finishChild);
			if (cancel) { host.handleRequest({ ...host.getSnapshot('waiting-parent')!, request: 'cancelChild', childAgentId: workerId }); }
			else { finishChild(); }
			await host.whenSettled('waiting-parent');
			assert.equal(host.getSnapshot('waiting-parent')!.live!.isRunning, false);
			assert.equal(spawned, 1);
			assert.equal(parentCalls, cancel ? 2 : 3);
		} finally { finishChild?.(); host.dispose(); }
	});
}

test('real spawn_worker keeps its parent identity through the Node tool context and hosted bridge', async () => {
	const updates: ICleanSlateThreadSessionUpdate[] = [];
	const completed = deferred();
	const configuration = createNodeProviderConfiguration({ provider: 'openai', model: 'gpt-4o', apiKey: 'test' });
	let requests = 0;
	const mainService = new NodeCleanSlateMainService(process.cwd());
	(mainService as any).openAICompatibleChatStream = () => {
		const emitter = new Emitter<any>();
		const requestNumber = ++requests;
		setTimeout(() => {
			if (requestNumber === 1) {
				emitter.fire('data: ' + JSON.stringify({ type: 'tool_call', call: { id: 'spawn', toolName: 'spawn_worker', input: { description: 'Read-only inspection', prompt: 'Report that inspection is complete without using tools.' } } }) + '\n\n');
			}
			emitter.fire('data: ' + JSON.stringify({ type: 'text', content: 'Inspection complete.', phase: 'final_answer' }) + '\n\n');
			emitter.fire(null);
		}, 0);
		return emitter.event;
	};
	const host = new CleanSlateHostedAgentRuntime((request, hooks) => new CleanSlateNodeAgentRuntime({
		rootPath: process.cwd(), sessionId: request.session.id, mainService, configuration,
		onAgentEvent: event => hooks.onAgentEvent({ type: event.eventType, agent: event.agent, delta: event.delta, streamPart: event.streamPart })
	}), update => {
		updates.push(update);
		if (update.live?.childAgentEvents?.some(item => item.event.type === 'completed')) { completed.resolve(); }
	});
	try {
		await host.start({ session: { id: 'real-parent', title: 'Spawn', savedAt: 1, history: [] }, text: 'Spawn a read-only worker and return immediately.', configuration });
		await host.whenSettled('real-parent');
		const created = updates.flatMap(update => update.live?.childAgentEvents ?? []).find(item => item.event.type === 'created');
		assert.ok(created, 'real spawn_worker did not reach Side Chat transport');
		assert.equal(created.event.agent.parentAgentId, 'real-parent');
		await completed.promise;
		const events = host.getSnapshot('real-parent')!.live!.childAgentEvents!;
		assert.ok(events.some(item => item.event.streamPart?.type === 'chat_text'));
		assert.ok(events.some(item => item.event.type === 'completed'));
	} finally { host.dispose(); }
});

test('hosted child events outlive the parent turn, replay on sync, and route cancellation', async () => {
	const updates: ICleanSlateThreadSessionUpdate[] = [];
	let hooks!: import('../node/cleanSlateHostedAgentRuntime.js').IHostedAgentHooks;
	const cancelled: string[] = [];
	const runtime = { configureRun: async () => {}, restoreSessionSnapshot() {}, getPendingQuestion() {},
		getSessionSnapshot: () => ({ version: 1, threadHistory: [] }), dispose() {}, async *run() {},
		cancelChildAgent(id: string) { cancelled.push(id); return true; }
	} as unknown as HostedAgentRuntime;
	const host = new CleanSlateHostedAgentRuntime((_request, callbacks) => { hooks = callbacks; return runtime; }, update => updates.push(update));
	try {
		await host.start({ session: { id: 'parent', title: 'Parent', savedAt: 1, history: [] }, text: 'spawn', configuration: {} as any });
		await host.whenSettled('parent');
		const agent = { id: 'worker', parentAgentId: 'parent', kind: 'worker' as const, description: 'Inspect', prompt: 'Inspect files', status: 'running' as const, createdAt: 1 };
		hooks.onAgentEvent({ type: 'created', agent });
		hooks.onAgentEvent({ type: 'progress', agent, streamPart: { type: 'chat_text', content: 'Inspecting files' } });
		assert.equal(updates.at(-1)!.live!.isRunning, false);
		assert.equal(updates.at(-1)!.live!.childAgentEvents!.length, 1, 'live packets carry only the new event');
		const snapshot = host.getSnapshot('parent')!;
		host.handleRequest({ ...snapshot, request: 'sync' });
		assert.deepEqual(updates.at(-1)!.live!.childAgentEvents!.map(item => item.sequence), [1, 2]);
		assert.equal(updates.at(-1)!.session.transcript!.some(message => message.content.includes('Inspecting files')), false);
		host.handleRequest({ ...snapshot, request: 'cancelChild', childAgentId: 'worker' });
		assert.deepEqual(cancelled, ['worker']);
		hooks.onAgentEvent({ type: 'completed', agent: { ...agent, status: 'completed', output: 'Done' } });
		assert.equal(host.getSnapshot('parent')!.live!.childAgentEvents!.at(-1)!.event.agent.output, 'Done');
	} finally { host.dispose(); }
});

test('fast streams publish live reasoning and tool boundaries without publishing every token', async () => {
	const updates: ICleanSlateThreadSessionUpdate[] = [];
	const runtime = { configureRun: async () => {}, restoreSessionSnapshot() {}, getPendingQuestion: () => undefined,
		getSessionSnapshot: () => ({ version: 1, threadHistory: [] }), dispose() {},
		async *run(): AsyncIterable<CleanSlateStreamPart> {
			yield { type: 'assistant_turn_start', turnId: 'fast', phase: 'execution' };
			for (let i = 0; i < 100; i++) { yield { type: 'reasoning', content: 'x' }; }
			yield { type: 'tool_start', toolName: 'list_dir', toolCallId: 'dir', input: { path: '.' } };
			yield { type: 'assistant_turn_complete', turnId: 'fast', phase: 'execution' };
			yield { type: 'tool_result', toolName: 'list_dir', toolCallId: 'dir', result: { success: true } };
		}
	} as unknown as HostedAgentRuntime;
	const host = new CleanSlateHostedAgentRuntime(() => runtime, update => updates.push(update));
	try {
		await host.start({ session: { id: 'fast', title: 'Inspect', savedAt: 1, history: [] }, text: 'inspect', configuration: {} as any });
		await host.whenSettled('fast');
		const timelines = updates.flatMap(update => (update.session.transcript ?? []).filter(message => message.renderPayload)
			.map(message => JSON.parse(message.renderPayload!).timeline as any[]));
		assert.ok(timelines.some(timeline => timeline.some(block => block.type === 'reasoning' && block.isStreaming)));
		const active = timelines.find(timeline => timeline.some(block => block.status === 'Exploring...' && block.isStreaming));
		assert.ok(active, 'tool start must reach the view before its result');
		assert.equal(active.find(block => block.type === 'reasoning').content, 'x'.repeat(100));
		assert.equal(active.find(block => block.type === 'reasoning').isStreaming, false);
		assert.ok(updates.length < 15, 'token bursts must remain coalesced');
		assert.equal(updates.at(-1)!.live!.isRunning, false);
	} finally { host.dispose(); }
});

test('distinct submitted messages survive empty turns even when their text repeats', async () => {
	const inputs: string[] = [];
	const runtime = { configureRun: async () => {}, restoreSessionSnapshot: () => {}, getPendingQuestion: () => undefined,
		getSessionSnapshot: () => ({ version: 1, threadHistory: [] }),
		run: async function* (text: string) { inputs.push(text); }, dispose: () => {} } as unknown as HostedAgentRuntime;
	const host = new CleanSlateHostedAgentRuntime(() => runtime, () => {});
	const session = { id: 'follow-up', title: 'Test', savedAt: 1, history: [],
		transcript: [{ id: 'first', role: 'user' as const, content: 'start' }] };
	try {
		for (const text of ['start', 'continue', 'continue']) {
			if (inputs.length) {
				session.transcript.push({ id: `submitted-${inputs.length}`, role: 'user', content: text });
			}
			const accepted = await host.start({ session, text, configuration: {} as any });
			assert.equal(accepted.session.transcript!.at(-1)!.content, text);
			await host.whenSettled(session.id);
		}
		const transcript = host.getSnapshot(session.id)!.session.transcript!;
		assert.deepEqual(transcript.map(message => message.content), ['start', 'continue', 'continue']);
		assert.equal(new Set(transcript.map(message => message.id)).size, 3);
		assert.deepEqual(inputs, ['start', 'continue', 'continue']);
		const current = { ...session, transcript: [...transcript, { id: 'next', role: 'user' as const, content: 'next' }] };
		await host.start({ session: current, text: 'next', configuration: {} as any });
		await host.whenSettled(session.id);
		assert.equal(host.getSnapshot(session.id)!.session.transcript!.filter(message => message.id === 'next').length, 1);
	} finally { host.dispose(); }
});

test('hosted projection preserves progress and emits errors separately for the existing UI cards', async () => {
	const updates: ICleanSlateThreadSessionUpdate[] = [];
	const stream = async function* (): AsyncIterable<CleanSlateStreamPart> {
		yield { type: 'transport_status', status: { state: 'retrying', attempt: 1, maxAttempts: 2, message: 'Reconnecting' } };
		await new Promise(resolve => setTimeout(resolve, 275));
		yield { type: 'context_compaction_start', turnId: 'turn' };
		yield { type: 'context_compaction_complete', turnId: 'turn', compacted: true };
		yield { type: 'tool_start', toolName: 'execute_command', toolCallId: 'cmd', input: { command: 'test' } };
		yield { type: 'tool_progress', toolName: 'execute_command', toolCallId: 'cmd', progress: { type: 'command_output', data: 'first output' } };
		throw new Error("429 You've reached your weekly usage limit. It resets 3 days from now, or add credits to keep going.");
	};
	const runtime = { configureRun: async () => {}, restoreSessionSnapshot: () => {}, getPendingQuestion: () => undefined,
		getSessionSnapshot: () => ({ version: 1, threadHistory: [] }), run: stream, dispose: () => {} } as unknown as HostedAgentRuntime;
	const host = new CleanSlateHostedAgentRuntime(() => runtime, update => updates.push(update));
	try {
		await host.start({ session: { id: 'failure', title: 'Test', savedAt: 1, history: [] }, text: 'test', configuration: {} as any });
		await host.whenSettled('failure');
		const transcript = updates.at(-1)!.session.transcript!;
		assert.match(transcript.at(-1)!.id!, /^hosted-error-/);
		assert.match(transcript.at(-1)!.content, /resets 3 days/);
		const timeline = JSON.parse(transcript.at(-2)!.renderPayload!).timeline;
		assert.equal(timeline.find((block: any) => block.id === 'cmd').output, 'first output');
		assert.equal(timeline.find((block: any) => block.id === 'context-compaction-turn').status, 'Context compacted');
		assert.equal(updates.at(-1)!.live!.isRunning, false);
		assert.ok(updates.some(update => update.live?.transportStatus?.state === 'retrying'));
		assert.equal(updates.at(-1)!.live!.transportStatus, undefined);
	} finally { host.dispose(); }
});

test('hosted projection preserves the Exploring tools disclosure UX', async () => {
	const updates: ICleanSlateThreadSessionUpdate[] = [];
	const stream = async function* (): AsyncIterable<CleanSlateStreamPart> {
		yield { type: 'tool_start', toolName: 'grep_search', toolCallId: 'search', input: { pattern: 'Agent', path: 'src' } };
		await new Promise(resolve => setTimeout(resolve, 275));
		yield { type: 'tool_result', toolName: 'grep_search', toolCallId: 'search', result: { success: true } };
		yield { type: 'tool_start', toolName: 'read_file_range', toolCallId: 'read', input: { path: 'src/app.ts', start_line: 4, end_line: 8 } };
		yield { type: 'tool_result', toolName: 'read_file_range', toolCallId: 'read', result: { success: true } };
	};
	const runtime = { configureRun: async () => {}, restoreSessionSnapshot: () => {}, getPendingQuestion: () => undefined,
		getSessionSnapshot: () => ({ version: 1, threadHistory: [] }), run: stream, dispose: () => {} } as unknown as HostedAgentRuntime;
	const host = new CleanSlateHostedAgentRuntime(() => runtime, update => updates.push(update));
	try {
		await host.start({ session: { id: 'explore', title: 'Test', savedAt: 1, workDir: '/workspace', history: [] }, text: 'inspect', configuration: {} as any });
		await host.whenSettled('explore');
		const liveTimeline = updates.map(update => update.session.transcript?.at(-1)?.renderPayload)
			.filter((payload): payload is string => typeof payload === 'string')
			.map(payload => JSON.parse(payload).timeline)
			.find(timeline => timeline?.[0]?.status === 'Exploring...');
		assert.equal(liveTimeline[0].details[0], 'Exploring Agent');
		assert.equal(liveTimeline[0].isStreaming, true);
		const timeline = JSON.parse(updates.at(-1)!.session.transcript!.at(-1)!.renderPayload!).timeline;
		assert.equal(timeline.length, 1);
		assert.equal(timeline[0].type, 'file');
		assert.equal(timeline[0].status, 'Analyzed');
		assert.equal(timeline[0].searchCount, 1);
		assert.equal(timeline[0].fileCount, 1);
		assert.deepEqual(timeline[0].details, ['Explored Agent', 'Read app.ts #4-8']);
		assert.equal(timeline[0].detailMetadata[1].path, '/workspace/src/app.ts');
		assert.equal(timeline[0].isStreaming, false);
	} finally { host.dispose(); }
});

async function fixture(approval = false) {
	const root = await mkdtemp(join(tmpdir(), 'cleanslate-host-'));
	const entered = deferred();
	const release = deferred();
	let providerCalls = 0;
	let creations = 0;
	const subscribers = new Set<(update: ICleanSlateThreadSessionUpdate) => void>();
	const transport = new NodeCleanSlateMainService(root);
	transport.getModelsDevModelMetadata = async () => undefined;
	transport.openAICompatibleChatStream = () => {
		providerCalls++;
		const call = providerCalls;
		const emitter = new Emitter<any>();
		setTimeout(() => {
			if (call === 1) {
				emitter.fire('data: {"type":"tool_call","call":{"id":"write-1","toolName":"host_test_write","input":{}}}\n\n');
			} else {
				emitter.fire('data: {"type":"text","content":"Work completed.","phase":"final_answer"}\n\n');
			}
			emitter.fire(null);
		}, 0);
		return emitter.event;
	};
	const request: ICleanSlateHostedAgentRunRequest = {
		session: { id: 'task', title: 'Write the result.', savedAt: Date.now(), workDir: root, history: [],
			transcript: [{ id: 'user-1', role: 'user', content: 'Write the result.' }] },
		text: 'Write the result.', configuration: {
			...createNodeProviderConfiguration({ provider: 'openai', model: 'test', apiKey: 'secret-must-stay-in-host' }),
			ragEnabled: false, editMode: 'manual'
		}
	};
	const host = new CleanSlateHostedAgentRuntime((run, hooks) => {
		creations++;
		return new CleanSlateNodeAgentRuntime({
			rootPath: root, sessionId: run.session.id, configuration: { ...run.configuration }, mainService: transport,
			approveCommand: hooks.approveCommand,
			tools: [{
				name: 'host_test_write', description: 'Write the requested result after waiting.', parametersSchema: {},
				run: async (_input: unknown, context: any) => {
					const allowed = approval ? context.requestCommandApproval({ command: 'write result', cwd: root }) : Promise.resolve(true);
					entered.resolve();
					const cancelled = new Promise<never>((_resolve, reject) => {
						context.signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
					});
					const approved = await Promise.race([allowed, cancelled]);
					if (!approved) { return { success: false, message: 'Denied' }; }
					await Promise.race([release.promise, cancelled]);
					await writeFile(join(root, 'result.txt'), 'finished in original project');
					return { success: true, summary: 'Result written' };
				}
			}]
		});
	}, update => { for (const subscriber of subscribers) { subscriber(update); } });
	return { host, root, request, entered, release, subscribers, counts: () => ({ providerCalls, creations }),
		cleanup: async () => { host.dispose(); await rm(root, { recursive: true, force: true }); } };
}

test('the real SDK loop keeps working with no renderer and reconnects without replaying tools', { timeout: 15000 }, async () => {
	const f = await fixture();
	try {
		const oldView: ICleanSlateThreadSessionUpdate[] = [];
		f.subscribers.add(update => oldView.push(update));
		const accepted = await f.host.start(f.request);
		await f.entered.promise;
		assert.equal(accepted.live?.ownerId, CLEANSLATE_HOSTED_AGENT_OWNER);
		await assert.rejects(f.host.start(f.request), /already has a running agent/);
		f.subscribers.clear(); // The old workspace renderer has been destroyed.
		f.release.resolve();
		await f.host.whenSettled('task');
		assert.equal(await readFile(join(f.root, 'result.txt'), 'utf8'), 'finished in original project');
		const reopened: ICleanSlateThreadSessionUpdate[] = [];
		f.subscribers.add(update => reopened.push(update));
		f.host.handleRequest({ originId: 'new-workspace-view', request: 'sync',
			session: { ...f.request.session, workDir: '/a/different/project', history: [] } });
		assert.equal(reopened.length, 1);
		const final = reopened[0];
		assert.equal(final.live?.runId, accepted.live?.runId);
		assert.equal(final.live?.isRunning, false);
		assert.equal(final.session.workDir, f.root);
		assert.equal(final.session.transcript?.filter(message => message.role === 'user').length, 1);
		assert.match(JSON.stringify(final.session.transcript), /Work completed/);
		assert.equal(final.session.agentRuntimeState?.messages.some(message => message.role === 'tool'), true);
		assert.equal(JSON.stringify(final).includes('secret-must-stay-in-host'), false);
		assert.deepEqual(f.counts(), { providerCalls: 2, creations: 1 });
		assert.equal(oldView.at(-1)?.live?.isRunning, true);
	} finally { await f.cleanup(); }
});

test('a command approval survives detachment and is resolved by the replacement view', { timeout: 15000 }, async () => {
	const f = await fixture(true);
	try {
		await f.host.start(f.request);
		await f.entered.promise;
		const waiting = f.host.getSnapshot('task')!;
		assert.equal(waiting.live?.isRunning, true);
		assert.equal(waiting.live?.approvals?.length, 1);
		const approval = waiting.live!.approvals![0];
		f.host.handleRequest({ originId: 'replacement-view', session: f.request.session, request: 'approve', approvalId: approval.id });
		f.release.resolve();
		await f.host.whenSettled('task');
		assert.equal(await readFile(join(f.root, 'result.txt'), 'utf8'), 'finished in original project');
		assert.deepEqual(f.host.getSnapshot('task')?.live?.approvals, []);
	} finally { await f.cleanup(); }
});

test('Stop from a replacement view cancels the original tool exactly once', { timeout: 15000 }, async () => {
	const f = await fixture();
	try {
		const accepted = await f.host.start(f.request);
		await f.entered.promise;
		f.host.handleRequest({ originId: 'replacement-view', session: f.request.session, request: 'stop' });
		await f.host.whenSettled('task');
		await assert.rejects(readFile(join(f.root, 'result.txt')), { code: 'ENOENT' });
		assert.equal(f.host.getSnapshot('task')?.live?.isRunning, false);
		assert.equal(f.host.getSnapshot('task')?.live?.runId, accepted.live?.runId);
		assert.equal(f.counts().creations, 1);
	} finally { await f.cleanup(); }
});

test('restores legacy conversation context before a short follow-up', async () => {
	const f = await fixture();
	try {
		const request: ICleanSlateHostedAgentRunRequest = { ...f.request, text: 'try now', session: { ...f.request.session, transcript: [
			{ role: 'user', content: 'Open Neon Strike in the IDE browser' },
			{ role: 'assistant', content: '', renderPayload: JSON.stringify({ timeline: [{ type: 'assistant_text', content: 'Retry shooting-game-3d.html when the browser is ready.' }] }) },
			{ role: 'user', content: 'try now' }
		] } };
		const accepted = await f.host.start(request);
		assert.match(JSON.stringify(accepted.session.agentRuntimeState?.messages), /Neon Strike/);
		assert.match(JSON.stringify(accepted.session.agentRuntimeState?.messages), /shooting-game-3d.html/);
		f.release.resolve();
		await f.host.whenSettled('task');
	} finally { await f.cleanup(); }
});
