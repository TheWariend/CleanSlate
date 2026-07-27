/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CleanSlateToolCallLedger } from '../../browser/agent/cleanSlateToolCallLedger.js';

suite('CleanSlateToolCallLedger', () => {
	test('normalizes tool aliases before execution', () => {
		const ledger = new CleanSlateToolCallLedger({
			availableToolNames: ['apply_edit', 'read_file']
		});

		const normalized = ledger.normalizeToolCall({
			id: 'call-1',
			toolName: 'functions.apply_patch',
			input: { file_path: 'src/app.ts', old_string: 'before', new_string: 'after' }
		});

		assert.strictEqual(normalized.toolName, 'apply_edit');
	});

	test('normalizes legacy create-and-write input for write_file', () => {
		const ledger = new CleanSlateToolCallLedger({
			availableToolNames: ['write_file']
		});

		const normalized = ledger.normalizeToolCall({
			id: 'call-write',
			toolName: 'create_and_write_file',
			input: { path: 'src/app.ts', content: 'replacement' }
		});

		assert.strictEqual(normalized.toolName, 'write_file');
		assert.deepStrictEqual(normalized.input, {
			file_path: 'src/app.ts',
			content: 'replacement'
		});
	});

	test('rejects three consecutive identical tool calls with a synthetic loop result', () => {
		const ledger = new CleanSlateToolCallLedger({
			availableToolNames: ['apply_edit'],
			loopThreshold: 3,
			validateToolCall: toolCall => {
				if (toolCall.toolName === 'apply_edit' && !toolCall.input?.file_path) {
					return 'apply_edit requires file_path';
				}
				return undefined;
			}
		});

		const malformedCall = { id: 'call-1', toolName: 'apply_edit', input: {} };
		const first = ledger.prepareForExecution(malformedCall);
		assert.strictEqual(first.accepted, false);
		assert.strictEqual(first.result.code, 'malformed_tool_call');
		ledger.recordResult(first.toolCall, first.result);

		const second = ledger.prepareForExecution(malformedCall);
		assert.strictEqual(second.accepted, false);
		assert.strictEqual(second.result.code, 'malformed_tool_call');
		ledger.recordResult(second.toolCall, second.result);

		const third = ledger.prepareForExecution(malformedCall);
		assert.strictEqual(third.accepted, false);
		assert.strictEqual(third.result.code, 'tool_call_loop_detected');
		assert.ok(third.result.recoveryHint.includes('Do not repeat'));
	});

	test('detects identical calls regardless of prior tool success', () => {
		const ledger = new CleanSlateToolCallLedger({
			availableToolNames: ['read_file'],
			loopThreshold: 3
		});
		const call = { toolName: 'read_file', input: { path: 'src/app.ts' } };

		for (let attempt = 0; attempt < 2; attempt++) {
			const decision = ledger.prepareForExecution(call);
			assert.strictEqual(decision.accepted, true);
			ledger.recordResult(decision.toolCall, { success: true });
		}

		const third = ledger.prepareForExecution(call);
		assert.strictEqual(third.accepted, false);
		assert.strictEqual(third.result.code, 'tool_call_loop_detected');
	});
});
