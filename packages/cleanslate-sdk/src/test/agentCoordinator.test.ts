/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CleanSlateAgentCoordinator } from '../services/cleanSlateAgentCoordinator.js';
import { spawnWorkerTool, waitWorkerTool } from '../tools/SpawnWorkerTool.js';
import { CleanSlateAgentExecutionPhase } from '../agent/cleanSlateAgentExecutionPhase.js';
import { AgentPhase } from '../agent/cleanSlatePrompts.js';

describe('CleanSlateAgentCoordinator', () => {
	test('owns identity, progress and completion for a child agent', async () => {
		const events: string[] = [];
		let release!: () => void;
		const gate = new Promise<void>(resolve => release = resolve);
		const coordinator = new CleanSlateAgentCoordinator(async (request, context) => {
			assert.equal(request.prompt, 'Inspect the parser');
			context.emitProgress('Reading parser');
			await gate;
			return 'Parser is correct.';
		}, { createId: () => 'agent-1', now: () => 42 });
		coordinator.onDidChangeAgent(event => events.push(event.type));

		const result = await coordinator.spawnAgent({
			description: 'Parser audit',
			prompt: 'Inspect the parser',
			parentAgentId: 'root'
		});

		assert.deepEqual(events, ['created', 'started', 'progress']);
		assert.equal(result.id, 'agent-1');
		assert.equal(result.parentAgentId, 'root');
		assert.equal(result.prompt, 'Inspect the parser');
		assert.equal(result.status, 'running');
		assert.equal(coordinator.getAgent(result.id)?.output, 'Reading parser');
		release();
		const completed = await coordinator.waitForAgent(result.id);
		assert.equal(completed.status, 'completed');
		assert.equal(completed.output, 'Parser is correct.');
		assert.deepEqual(events, ['created', 'started', 'progress', 'completed']);
	});

	test('cancels a child when its parent is aborted', async () => {
		const parent = new AbortController();
		const coordinator = new CleanSlateAgentCoordinator((_request, context) => new Promise((_resolve, reject) => {
			context.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
		}), { createId: () => 'agent-cancelled' });

		const spawned = await coordinator.spawnAgent({ description: 'Wait', prompt: 'Wait for input' }, parent.signal);
		parent.abort();
		assert.equal(coordinator.getAgent(spawned.id)?.status, 'cancelled');
		const result = await coordinator.waitForAgent(spawned.id);

		assert.equal(result.status, 'cancelled');
		assert.equal(coordinator.getAgent(result.id)?.status, 'cancelled');
	});

	test('publishes explicit cancellation immediately and ignores late executor output', async () => {
		const events: string[] = [];
		let release!: () => void;
		const gate = new Promise<void>(resolve => release = resolve);
		const coordinator = new CleanSlateAgentCoordinator(async (_request, context) => {
			await gate;
			context.emitProgress('late progress');
			context.emitStreamPart({ type: 'chat_text', content: 'late answer', kind: 'final_answer' });
			return 'late result';
		}, { createId: () => 'agent-explicit-cancel' });
		coordinator.onDidChangeAgent(event => events.push(event.type));

		const spawned = await coordinator.spawnAgent({ description: 'Slow command', prompt: 'Run slowly' });
		const waiting = coordinator.waitForAgent(spawned.id);
		assert.equal(coordinator.cancelAgent(spawned.id), true);
		assert.equal(coordinator.getAgent(spawned.id)?.status, 'cancelled');
		assert.equal((await waiting).status, 'cancelled');

		release();
		await new Promise<void>(resolve => setImmediate(resolve));
		assert.equal(coordinator.getAgent(spawned.id)?.status, 'cancelled');
		assert.equal(coordinator.getAgent(spawned.id)?.output, undefined);
		assert.deepEqual(events, ['created', 'started', 'cancelled']);
	});

	test('forwards native worker events without flattening tool activity', async () => {
		const streamTypes: string[] = [];
		const coordinator = new CleanSlateAgentCoordinator(async (_request, context) => {
			context.emitStreamPart({ type: 'tool_start', toolName: 'read_file', input: { path: 'src/a.ts' }, toolCallId: 'tool-1' });
			context.emitStreamPart({ type: 'chat_text', content: 'Done.', kind: 'final_answer' });
			return 'Done.';
		}, { createId: () => 'agent-stream' });
		coordinator.onDidChangeAgent(event => {
			if (event.streamPart) {
				streamTypes.push(event.streamPart.type);
			}
		});

		const spawned = await coordinator.spawnAgent({ description: 'Read one file', prompt: 'Inspect src/a.ts' });
		const completed = await coordinator.waitForAgent(spawned.id);

		assert.deepEqual(streamTypes, ['tool_start', 'chat_text']);
		assert.equal(completed.output, 'Done.');
	});

	test('spawn_worker delegates to the host coordinator', async () => {
		const progress: string[] = [];
		let release!: () => void;
		const gate = new Promise<void>(resolve => release = resolve);
		const coordinator = new CleanSlateAgentCoordinator(async (_request, context) => {
			context.emitProgress('halfway');
			await gate;
			return 'done';
		}, { createId: () => 'agent-tool' });
		const result = await spawnWorkerTool.run({
			description: 'Small task',
			prompt: 'Do it'
		}, {
			agentCoordinator: coordinator,
			sessionId: 'parent',
			onProgress: (event: { eventType: string }) => progress.push(event.eventType),
			requestCommandApproval: async () => false
		} as any);

		assert.deepEqual(result, { success: true, agentId: 'agent-tool', status: 'running', description: 'Small task' });
		assert.deepEqual(progress, ['created', 'started', 'progress']);
		release();
		const waited = await waitWorkerTool.run({ agent_id: 'agent-tool' }, {
			agentCoordinator: coordinator,
			sessionId: 'parent',
			requestCommandApproval: async () => false
		} as any);
		assert.deepEqual(waited, { success: true, agentId: 'agent-tool', status: 'completed', result: 'done' });
	});

	test('allows root delegation while keeping child runtimes non-nesting', () => {
		const rootPhase = new CleanSlateAgentExecutionPhase({
			getTools: () => [{ name: 'spawn_worker' }]
		} as any);
		const childPhase = new CleanSlateAgentExecutionPhase({
			getTools: () => []
		} as any);

		assert.equal(rootPhase.validateToolCallForPhase(AgentPhase.EXECUTION, 'spawn_worker', {}), undefined);
		assert.equal(
			childPhase.validateToolCallForPhase(AgentPhase.EXECUTION, 'spawn_worker', {}),
			'Nested worker spawning is disabled inside child agents.'
		);
	});
});
