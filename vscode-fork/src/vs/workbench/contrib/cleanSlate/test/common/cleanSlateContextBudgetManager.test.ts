/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CleanSlateContextBudgetManager } from '../../browser/agent/cleanSlateContextBudgetManager.js';
import { IChatMessage } from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';

suite('CleanSlateContextBudgetManager', () => {
	test('checks compaction by threshold instead of turn count', () => {
		const manager = new CleanSlateContextBudgetManager();
		const messages: IChatMessage[] = [
			{ role: 'system', content: 'system prompt' },
			{ role: 'user', content: '[CONTEXT]\nUser Request: inspect the app' },
			{ role: 'tool', toolName: 'read_file', content: 'x'.repeat(100) }
		];
		const charCount = manager.getMessagesCharCount(messages);

		assert.strictEqual(manager.shouldCompactMessages(messages, charCount + 1), false);
		assert.strictEqual(manager.shouldCompactMessages(messages, charCount), true);
	});

	test('does not budget projected provider context before the cap', () => {
		const manager = new CleanSlateContextBudgetManager();
		const largeToolResult = 'x'.repeat(5000);
		const messages: IChatMessage[] = [
			{ role: 'system', content: 'system prompt' },
			{ role: 'user', content: '[CONTEXT]\nUser Request: inspect the app' },
			{ role: 'assistant', content: 'calling browser', toolCalls: [{ id: 'call_1', toolName: 'browser_snapshot', input: {} }] },
			{ role: 'tool', toolCallId: 'call_1', toolName: 'browser_snapshot', content: largeToolResult }
		];

		const projection = manager.projectMessagesForProvider(messages, 20000);

		assert.notStrictEqual(projection.messages, messages);
		assert.notStrictEqual(projection.messages[3], messages[3]);
		assert.strictEqual(messages[3].content, largeToolResult);
		assert.strictEqual(projection.messages[3].content, largeToolResult);
		assert.strictEqual(projection.result.compacted, false);
		assert.strictEqual(projection.result.clampedToolResults, 0);
	});

	test('proactively prunes old tool output before the model context is full', () => {
		const manager = new CleanSlateContextBudgetManager();
		const messages: IChatMessage[] = [
			{ role: 'system', content: 'system prompt' },
			{ role: 'user', content: '[CONTEXT]\nUser Request: explain this project' }
		];

		for (let i = 1; i <= 8; i++) {
			messages.push({
				role: 'assistant',
				content: `reading file ${i}`,
				toolCalls: [{ id: `call_${i}`, toolName: 'read_file', input: { path: `file-${i}.ts` } }]
			});
			messages.push({
				role: 'tool',
				toolCallId: `call_${i}`,
				toolName: 'read_file',
				content: `result ${i}\n${'x'.repeat(35_000)}`
			});
		}

		const before = manager.getMessagesCharCount(messages);
		const result = manager.pruneOldToolOutputs(messages);
		const recent = messages.filter(message => message.role === 'tool').slice(-5);

		assert.strictEqual(result.pruned, true);
		assert.ok(result.reclaimedChars >= 80_000);
		assert.ok(result.afterChars < before);
		assert.ok(result.compactedToolResults > 0);
		for (const message of recent) {
			assert.doesNotMatch(String(message.content), /older tool result pruned/, 'the protected recent tail remains intact');
		}
	});

	test('does not proactively prune when the saving is below the minimum', () => {
		const manager = new CleanSlateContextBudgetManager();
		const messages: IChatMessage[] = [
			{ role: 'system', content: 'system prompt' },
			{ role: 'user', content: '[CONTEXT]\nUser Request: inspect one file' },
			{ role: 'assistant', content: 'reading', toolCalls: [{ id: 'call_1', toolName: 'read_file', input: { path: 'file.ts' } }] },
			{ role: 'tool', toolCallId: 'call_1', toolName: 'read_file', content: 'x'.repeat(30_000) }
		];

		const result = manager.pruneOldToolOutputs(messages);

		assert.strictEqual(result.pruned, false);
		assert.strictEqual(result.reclaimedChars, 0);
		assert.strictEqual(String(messages[3].content).length, 30_000);
	});

	test('projects over-budget provider context without mutating the live transcript', () => {
		const manager = new CleanSlateContextBudgetManager();
		const largeToolResult = 'x'.repeat(5000);
		const messages: IChatMessage[] = [
			{ role: 'system', content: 'system prompt' },
			{ role: 'user', content: '[CONTEXT]\nUser Request: inspect the app' },
			{ role: 'assistant', content: 'calling browser', toolCalls: [{ id: 'call_1', toolName: 'browser_snapshot', input: {} }] },
			{ role: 'tool', toolCallId: 'call_1', toolName: 'browser_snapshot', content: largeToolResult }
		];

		const projection = manager.projectMessagesForProvider(messages, 4000);

		assert.notStrictEqual(projection.messages, messages);
		assert.notStrictEqual(projection.messages[3], messages[3]);
		assert.strictEqual(messages[3].content, largeToolResult);
		assert.match(String(projection.messages[3].content), /tool result compacted for context budget/);
		assert.ok(projection.result.compacted);
		assert.strictEqual(projection.result.clampedToolResults, 1);
	});

	test('counts native tool-call inputs toward the provider context budget', () => {
		const manager = new CleanSlateContextBudgetManager();
		const messages: IChatMessage[] = [
			{ role: 'system', content: 'system prompt' },
			{ role: 'user', content: '[CONTEXT]\nUser Request: update files' },
			{
				role: 'assistant',
				content: '',
				toolCalls: [{ id: 'call_1', toolName: 'apply_edit', input: { newContent: 'x'.repeat(5000) } }]
			},
			{ role: 'tool', toolCallId: 'call_1', toolName: 'apply_edit', content: '{"success":true}' }
		];
		const textOnlyCharCount = messages.reduce((total, message) => total + message.role.length + String(message.content).length, 0);
		const fullCharCount = manager.getMessagesCharCount(messages);

		assert.ok(fullCharCount > textOnlyCharCount + 4000);
		assert.strictEqual(manager.shouldCompactMessages(messages, textOnlyCharCount + 1000), true);
	});

	test('drops oldest projected tool transcripts while keeping recent tool context', () => {
		const manager = new CleanSlateContextBudgetManager();
		const messages: IChatMessage[] = [
			{ role: 'system', content: 'system prompt' },
			{ role: 'user', content: '[CONTEXT]\nUser Request: implement dark mode' }
		];

		for (let i = 1; i <= 6; i++) {
			messages.push({
				role: 'assistant',
				content: `calling tool ${i}`,
				toolCalls: [{ id: `call_${i}`, toolName: 'read_file', input: { path: `file-${i}.ts` } }]
			});
			messages.push({
				role: 'tool',
				toolCallId: `call_${i}`,
				toolName: 'read_file',
				content: `result ${i}\n${'x'.repeat(5000)}`
			});
		}

		const projection = manager.projectMessagesForProvider(messages, 12000);
		const projectedToolIds = projection.messages
			.filter(message => message.role === 'tool')
			.map(message => message.toolCallId);

		assert.deepStrictEqual(projectedToolIds, ['call_3', 'call_4', 'call_5', 'call_6']);
		assert.strictEqual(messages.filter(message => message.role === 'tool').length, 6);
		assert.strictEqual(projection.result.droppedToolMessages, 4);
	});

	test('dropped tool groups leave a compacted-history digest instead of amnesia', () => {
		const manager = new CleanSlateContextBudgetManager();
		const messages: IChatMessage[] = [
			{ role: 'system', content: 'system prompt' },
			{ role: 'user', content: '[CONTEXT]\nUser Request: improve ux' }
		];

		for (let i = 1; i <= 6; i++) {
			messages.push({
				role: 'assistant',
				content: `calling tool ${i}`,
				toolCalls: [{ id: `call_${i}`, toolName: 'read_file', input: { path: `lib/screens/file-${i}.dart` } }]
			});
			messages.push({
				role: 'tool',
				toolCallId: `call_${i}`,
				toolName: 'read_file',
				content: i === 2 ? '{"success":false,"message":"missing"}' : `result ${i}\n${'x'.repeat(5000)}`
			});
		}

		const projection = manager.projectMessagesForProvider(messages, 12000);
		const digest = projection.messages.find(message =>
			message.role === 'system' && String(message.content).startsWith('[COMPACTED HISTORY]'));

		assert.ok(digest, 'a compacted-history digest message must exist after drops');
		const digestText = String(digest!.content);
		assert.ok(digestText.includes('- read_file lib/screens/file-1.dart'), 'digest names the dropped read target');
		assert.ok(digestText.includes('- read_file lib/screens/file-2.dart (failed)'), 'digest marks failed calls');
		// The digest sits right after the leading system prompt and survives
		// the system-drop pass.
		assert.strictEqual(projection.messages[1], digest);
		assert.ok(projection.result.droppedToolMessages > 0);
	});

	test('keeps recent tool results unclamped while compacting older ones', () => {
		const manager = new CleanSlateContextBudgetManager();
		const messages: IChatMessage[] = [
			{ role: 'system', content: 'system prompt' },
			{ role: 'user', content: '[CONTEXT]\nUser Request: improve ux' }
		];

		for (let i = 1; i <= 6; i++) {
			messages.push({
				role: 'assistant',
				content: `calling tool ${i}`,
				toolCalls: [{ id: `call_${i}`, toolName: 'read_file', input: { path: `file-${i}.ts` } }]
			});
			messages.push({
				role: 'tool',
				toolCallId: `call_${i}`,
				toolName: 'read_file',
				content: `result ${i}\n${'x'.repeat(5000)}`
			});
		}

		// Over budget, but recoverable by clamping/dropping OLD groups only. The
		// last MIN_RECENT_TOOL_GROUPS (4) tool results must keep their content —
		// clamping what the model just read forces re-read storms.
		const projection = manager.projectMessagesForProvider(messages, 26000);
		const recentToolMessages = projection.messages
			.filter(message => message.role === 'tool' && ['call_3', 'call_4', 'call_5', 'call_6'].includes(message.toolCallId ?? ''));

		assert.strictEqual(recentToolMessages.length, 4);
		for (const message of recentToolMessages) {
			assert.doesNotMatch(String(message.content), /compacted for context budget/, `recent tool result ${message.toolCallId} must not be clamped`);
			assert.ok(String(message.content).length > 4000, `recent tool result ${message.toolCallId} keeps full content`);
		}
		assert.ok(projection.result.compacted);
	});
});
