/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CancellationToken } from '../core/cancellation.js';
import { Event } from '../core/event.js';
import { NodeCleanSlateMainService } from '../node/cleanSlateNodeMainService.js';

async function collectFrames(event: Event<unknown>): Promise<any[]> {
	return new Promise((resolve, reject) => {
		const parts: any[] = [];
		const subscription = event(value => {
			if (value === null) {
				subscription.dispose();
				resolve(parts);
				return;
			}
			if (typeof value !== 'string') {
				reject(new Error(`unexpected frame type: ${typeof value}`));
				return;
			}
			if (value.startsWith('ERROR:')) {
				reject(new Error(value));
				return;
			}
			parts.push(JSON.parse(value.slice('data: '.length)));
		});
	});
}

async function* stream(values: any[]): AsyncIterable<any> {
	for (const value of values) {
		yield value;
	}
}

describe('NodeCleanSlateMainService provider streams', () => {
	test('accumulates Anthropic tool input and separates reasoning', async () => {
		const service = new NodeCleanSlateMainService('/tmp');
		(service as any).createAnthropicClient = async () => ({
			messages: {
				create: async () => stream([
					{ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'checking' } },
					{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'done' } },
					{ type: 'content_block_start', content_block: { type: 'tool_use', id: 'tool-1', name: 'read_file' } },
					{ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"path":' } },
					{ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '"README.md"}' } },
					{ type: 'content_block_stop' }
				])
			}
		});

		const parts = await collectFrames(service.anthropicMessagesStream({
			apiKey: 'test',
			model: 'claude-test',
			messages: [{ role: 'user', content: 'work' }]
		}, CancellationToken.None));

		assert.deepEqual(parts, [
			{ type: 'reasoning', content: 'checking' },
			{ type: 'text', content: 'done' },
			{ type: 'tool_call', call: { id: 'tool-1', toolName: 'read_file', input: { path: 'README.md' } } }
		]);
	});

	test('accumulates OpenAI chat tool deltas and emits usage once', async () => {
		const service = new NodeCleanSlateMainService('/tmp');
		(service as any).createOpenAICompatibleClient = async () => ({
			chat: {
				completions: {
					create: async () => stream([
						{ choices: [{ delta: { reasoning_content: 'thinking' } }] },
						{ choices: [{ delta: { content: 'answer' } }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } },
						{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'read_file', arguments: '{"path":' } }] } }] },
						{ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"README.md"}' } }] }, finish_reason: 'tool_calls' }] }
					])
				}
			}
		});

		const parts = await collectFrames(service.openAICompatibleChatStream({
			apiKey: 'test',
			providerName: 'OpenAI',
			model: 'gpt-test',
			messages: [{ role: 'user', content: 'work' }]
		}, CancellationToken.None));

		assert.deepEqual(parts, [
			{ type: 'reasoning', content: 'thinking' },
			{ type: 'usage', usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } },
			{ type: 'text', content: 'answer' },
			{ type: 'tool_call', call: { id: 'call-1', toolName: 'read_file', input: { path: 'README.md' } } }
		]);
	});

	test('preserves Responses output phase and completed tool calls', async () => {
		const service = new NodeCleanSlateMainService('/tmp');
		(service as any).createOpenAICompatibleClient = async () => ({
			responses: {
				create: async () => stream([
					{ type: 'response.output_item.added', item_id: 'message-1', item: { type: 'message', id: 'message-1', phase: 'final_answer' } },
					{ type: 'response.output_text.delta', item_id: 'message-1', delta: 'finished' },
					{ type: 'response.output_item.added', item_id: 'call-1', item: { type: 'function_call', call_id: 'call-1', name: 'read_file' } },
					{ type: 'response.function_call_arguments.delta', item_id: 'call-1', delta: '{"path":"README.md"}' },
					{ type: 'response.function_call_arguments.done', item_id: 'call-1', name: 'read_file', arguments: '{"path":"README.md"}' }
				])
			}
		});

		const parts = await collectFrames(service.openAIResponsesStream({
			apiKey: 'test',
			providerName: 'OpenAI',
			model: 'gpt-test',
			messages: [{ role: 'user', content: 'work' }]
		}, CancellationToken.None));

		assert.deepEqual(parts, [
			{ type: 'text', content: 'finished', phase: 'final_answer' },
			{ type: 'tool_call', call: { id: 'call-1', toolName: 'read_file', input: { path: 'README.md' } } }
		]);
	});
});
