/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CleanSlateAgentHistoryBuilder } from '../../browser/agent/cleanSlateAgentHistoryBuilder.js';
import { CleanSlateAgentSession } from '../../browser/agent/cleanSlateAgentSession.js';
import { CleanSlateExecutionEditPolicy } from '../../browser/agent/cleanSlateExecutionEditPolicy.js';
import { CleanSlateToolDispatcher } from '../../browser/agent/cleanSlateToolDispatcher.js';
import { CleanSlateAgentManagerSessionMapper } from '../../browser/agentManager/cleanSlateAgentManagerSessionMapper.js';
import { CleanSlateChatSessionSnapshotCodec } from '../../browser/chat/providers/cleanSlateChatSessionSnapshotCodec.js';
import { CleanSlateVerificationTargetTracker } from '../../browser/core/cleanSlateVerificationTargetTracker.js';
import { CleanSlateProviderSchemaNormalizer } from '../../../../services/cleanSlate/node/core/cleanSlateProviderSchemaNormalizer.js';

suite('CleanSlate refactored boundaries', () => {
	test('history builder removes the current echo and strips ephemeral context', () => {
		const builder = new CleanSlateAgentHistoryBuilder();
		const history = builder.prepareBudgetedDialogueHistory([
			{ role: 'user', content: 'Original objective' },
			{ role: 'assistant', content: 'Working on it' },
			{ role: 'user', content: '[CONTEXT]\nsecret state\n\nUser Request: Continue' }
		], 'Continue', 'Continue', 20_000);

		assert.deepStrictEqual(history, [
			{ role: 'user', content: 'Original objective', toolCallId: undefined, toolName: undefined, toolCalls: undefined },
			{ role: 'assistant', content: 'Working on it', toolCallId: undefined, toolName: undefined, toolCalls: undefined }
		]);
		assert.strictEqual(builder.stripEphemeralContextFromText('[CONTEXT]\nprivate\n\nUser Request: Visible'), 'Visible');
	});

	test('edit policy extracts mutation paths and scopes implicit lint reads', () => {
		const policy = new CleanSlateExecutionEditPolicy();
		const toolCall = {
			toolName: 'multi_file_replace',
			input: { edits: [
				{ file_path: 'src/a.ts', old_string: 'a', new_string: 'A' },
				{ file_path: 'src/b.ts', old_string: 'b', new_string: 'B' }
			] }
		};
		assert.deepStrictEqual(policy.collectMutationPaths(toolCall, { affectedFiles: ['src/c.ts'] }), ['src/c.ts', 'src/a.ts', 'src/b.ts']);
		assert.deepStrictEqual(policy.withScopedReadLintsInput(
			{ toolName: 'read_lints', input: {} },
			{ mutatedPaths: new Set(['src/a.ts']), touchedPaths: new Set(['src/b.ts']) }
		).input, { paths: ['src/a.ts'] });
	});

	test('provider schema normalizer preserves object shape and adapts shorthand properties', () => {
		const normalizer = new CleanSlateProviderSchemaNormalizer();
		assert.deepStrictEqual(normalizer.normalizeJsonObjectSchema({ path: 'string', count: 'number - optional count' }), {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'string' },
				count: { type: 'number', description: 'optional count' }
			},
			required: ['path']
		});
	});

	test('session snapshot codec deep-clones mutable state', () => {
		const codec = new CleanSlateChatSessionSnapshotCodec();
		const source = { nested: { values: ['one'] } };
		const clone = codec.cloneObject(source)!;
		clone.nested.values.push('two');
		assert.deepStrictEqual(source, { nested: { values: ['one'] } });
	});

	test('agent runtime session restores a suspended question as the original tool result', () => {
		const session = new CleanSlateAgentSession();
		session.start([
			{ role: 'user', content: 'Implement the feature' },
			{
				role: 'assistant',
				content: '',
				toolCalls: [{ id: 'question-1', toolName: 'ask_question', input: { question: 'Which API?' } }]
			}
		], { objective: 'Implement the feature', mode: 'Execution', phase: 'EXECUTION' });
		session.pauseForQuestion(
			{ id: 'question-1', toolName: 'ask_question', input: { question: 'Which API?' } },
			{ success: true, planning_question: { question: 'Which API?' } }
		);

		const restored = new CleanSlateAgentSession();
		restored.restore(session.getSnapshot());
		assert.strictEqual(restored.hasPendingQuestion(), true);
		restored.resumePendingQuestion('Use the stable API');

		const messages = restored.getMutableMessages();
		assert.strictEqual(messages[messages.length - 1].role, 'tool');
		assert.strictEqual(messages[messages.length - 1].toolCallId, 'question-1');
		assert.strictEqual(messages.some(message => message.role === 'user' && message.content === 'Use the stable API'), false);
		assert.match(String(messages[messages.length - 1].content), /Use the stable API/);
	});

	test('agent runtime session appends mode reminders without replacing native history', () => {
		const session = new CleanSlateAgentSession();
		session.start([
			{ role: 'system', content: 'stable cached prefix' },
			{ role: 'user', content: 'Plan the change' },
			{ role: 'assistant', content: '', toolCalls: [{ id: 'read-1', toolName: 'read_file', input: { path: 'src/app.ts' } }] },
			{ role: 'tool', content: '{"success":true}', toolCallId: 'read-1', toolName: 'read_file' }
		]);

		session.continueWithTurn([
			{ role: 'system', content: '[MODE REMINDER]\n<execution_mode>' },
			{ role: 'user', content: 'Implement it' }
		], { mode: 'Execution', phase: 'EXECUTION' });

		const messages = session.getMutableMessages();
		assert.strictEqual(messages[0].content, 'stable cached prefix');
		assert.strictEqual(messages[3].toolCallId, 'read-1');
		assert.strictEqual(messages[4].role, 'system');
		assert.strictEqual(messages[5].content, 'Implement it');
	});

	test('agent runtime transcript survives GUI session persistence', () => {
		const mapper = new CleanSlateAgentManagerSessionMapper();
		const persisted = mapper.toPersistedSession({
			id: 'session-1',
			title: 'Migration',
			savedAt: 1,
			history: [{ role: 'user', content: 'Continue the migration' }],
			planMode: false,
			reasoningLevel: 'low',
			agentRuntimeState: {
				version: 1,
				messages: [
					{ role: 'assistant', content: '', toolCalls: [{ id: 'call-1', toolName: 'read_file', input: { path: 'src/app.ts' } }] },
					{ role: 'tool', content: '{"success":true}', toolCallId: 'call-1', toolName: 'read_file' }
				]
			}
		});

		const restored = mapper.toSessionSnapshot(persisted);
		assert.strictEqual(restored?.agentRuntimeState?.messages.length, 2);
		assert.strictEqual(restored?.agentRuntimeState?.messages[1].toolCallId, 'call-1');
	});

	test('strict tool dispatcher rejects malformed native arguments before resolution can run', () => {
		const tool = {
			name: 'find_by_name',
			description: 'Find a file',
			parametersSchema: { path: 'string' },
			run: async () => ({ success: true })
		};
		const dispatcher = new CleanSlateToolDispatcher(() => [tool]);

		const parseFailure = dispatcher.prepare('find_by_name', {
			__cleanSlateArgumentsParseError: 'Unexpected token at position 8',
			rawArguments: '{"path":'
		});
		assert.strictEqual(parseFailure.ok, false);
		assert.strictEqual(parseFailure.error.code, 'invalid_tool_arguments');

		const debrisFailure = dispatcher.prepare('find_by_name', {
			path: 'lib}}]} to=multi_tool_use.parallel code execution failed: invalid JSON'
		});
		assert.strictEqual(debrisFailure.ok, false);
		assert.strictEqual(debrisFailure.error.code, 'invalid_tool_arguments');

		const valid = dispatcher.prepare('functions.find_by_name', { path: 'lib' });
		assert.strictEqual(valid.ok, true);
	});

	test('tool dispatcher preserves legacy create-and-write calls through write_file', () => {
		const writeTool = {
			name: 'write_file',
			description: 'Write a complete file',
			parametersSchema: {
				type: 'object',
				additionalProperties: false,
				properties: {
					file_path: { type: 'string' },
					content: { type: 'string' }
				},
				required: ['file_path', 'content']
			},
			run: async () => ({ success: true })
		};
		const dispatcher = new CleanSlateToolDispatcher(() => [writeTool]);
		const prepared = dispatcher.prepare('create_and_write_file', {
			path: '/workspace/src/app.ts',
			content: 'export const value = 1;\n'
		});

		assert.strictEqual(prepared.ok, true);
		if (prepared.ok) {
			assert.strictEqual(prepared.toolName, 'write_file');
			assert.deepStrictEqual(prepared.input, {
				file_path: '/workspace/src/app.ts',
				content: 'export const value = 1;\n'
			});
		}
	});

	test('verification tracker derives route targets and accepts matching browser evidence', () => {
		const tracker = new CleanSlateVerificationTargetTracker();
		const registered = tracker.register([], ['src/app/settings/page.tsx'], 'update settings');
		assert.strictEqual(registered.targets[0].routeHints[0], '/settings');
		const verified = tracker.recordBrowserEvidence(registered.targets, {
			id: 'evidence-1',
			timestamp: Date.now(),
			kind: 'browser',
			phase: 'CHAT',
			status: 'EXECUTING' as any,
			toolName: 'browser_snapshot',
			url: 'http://localhost:3000/settings'
		});
		assert.strictEqual(verified.targets[0].status, 'verified');
	});
});
