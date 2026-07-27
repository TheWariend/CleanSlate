/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CleanSlateNativeToolTranscript } from '../../browser/agent/cleanSlateNativeToolTranscript.js';

suite('CleanSlateNativeToolTranscript', () => {
	test('builds provider-native assistant and tool result messages', () => {
		const transcript = new CleanSlateNativeToolTranscript('test');
		const toolCall = transcript.parseToolCall({
			id: 'call-read',
			toolName: 'functions.read_file',
			input: { path: 'src/app.ts' }
		});

		assert.ok(toolCall);
		assert.strictEqual(toolCall.toolName, 'read_file');

		const assistantMessage = transcript.buildAssistantToolCallMessage('', [toolCall]);
		assert.strictEqual(assistantMessage.role, 'assistant');
		assert.strictEqual(assistantMessage.toolCalls?.[0].id, 'call-read');
		assert.strictEqual(assistantMessage.toolCalls?.[0].toolName, 'read_file');

		const toolMessage = transcript.buildToolResultMessage(toolCall, { success: true, content: 'ok' });
		assert.strictEqual(toolMessage.role, 'tool');
		assert.strictEqual(toolMessage.toolCallId, 'call-read');
		assert.strictEqual(toolMessage.toolName, 'read_file');
		assert.match(String(toolMessage.content), /success/);
	});

	test('attaches synthetic ids and preserves semantic keys separately from ids', () => {
		const transcript = new CleanSlateNativeToolTranscript('chat');
		const first = transcript.parseToolCall({ toolName: 'read_file', input: { path: 'a.ts' } });
		const second = transcript.parseToolCall({ toolName: 'read_file', input: { path: 'a.ts' } });

		assert.ok(first);
		assert.ok(second);
		assert.notStrictEqual(first.id, second.id);
		assert.strictEqual(transcript.getToolCallSemanticKey(first), transcript.getToolCallSemanticKey(second));
		assert.notStrictEqual(transcript.getToolCallKey(first), transcript.getToolCallKey(second));

		const part = transcript.attachToolCallId({ type: 'tool_result', toolName: 'read_file', result: { success: true } }, first.id);
		assert.strictEqual(part.type, 'tool_result');
		assert.strictEqual(part.toolCallId, first.id);
	});
});
