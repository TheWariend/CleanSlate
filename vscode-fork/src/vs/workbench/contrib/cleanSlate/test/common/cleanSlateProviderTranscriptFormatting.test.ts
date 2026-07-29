/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { CleanSlateAnthropicMessageAdapter } from '@cleanslate/sdk/node/cleanSlateAnthropicMessageAdapter.js';
import { NodeCleanSlateMainService } from '../../../../services/cleanSlate/node/core/cleanSlateMainService.js';
import { CleanSlateProviderSchemaNormalizer } from '@cleanslate/sdk/node/cleanSlateProviderSchemaNormalizer.js';

suite('CleanSlate provider transcript formatting', () => {
	function createService(): any {
		const service = Object.create(NodeCleanSlateMainService.prototype);
		service.providerSchemaNormalizer = new CleanSlateProviderSchemaNormalizer();
		service.anthropicMessageAdapter = new CleanSlateAnthropicMessageAdapter(service.providerSchemaNormalizer);
		return service;
	}

	const parallelToolMessages = [
		{
			role: 'assistant',
			content: '',
			toolCalls: [
				{ id: 'call_read', toolName: 'read_file', input: { path: 'package.json' }, providerMetadata: { gemini: { thoughtSignature: 'read-signature' } } },
				{ id: 'call_search', toolName: 'grep_search', input: { query: 'CleanSlate' }, providerMetadata: { gemini: { thoughtSignature: 'search-signature' } } }
			]
		},
		{
			role: 'tool',
			toolCallId: 'call_read',
			toolName: 'read_file',
			content: '{"success":true,"content":"package"}'
		},
		{
			role: 'tool',
			toolCallId: 'call_search',
			toolName: 'grep_search',
			content: '{"success":true,"matches":2}'
		}
	];

	test('groups parallel Anthropic tool results into one user message', () => {
		const body = createService().anthropicMessageAdapter.toMessagesRequest({
			apiKey: 'sk-ant-test',
			model: 'claude-sonnet-4-5',
			messages: parallelToolMessages
		});

		assert.strictEqual(body.messages.length, 2);
		assert.strictEqual(body.messages[0].role, 'assistant');
		assert.strictEqual(body.messages[0].content.length, 2);
		assert.strictEqual(body.messages[1].role, 'user');
		assert.strictEqual(body.messages[1].content.length, 2);
		assert.deepStrictEqual(
			body.messages[1].content.map((part: any) => part.tool_use_id),
			['call_read', 'call_search']
		);
		assert.deepStrictEqual(
			body.messages[1].content.map((part: any) => part.type),
			['tool_result', 'tool_result']
		);
	});

	test('replays Gemini tool history as text instead of native function parts', () => {
		const { contents } = createService().toGeminiContents(parallelToolMessages);

		assert.strictEqual(contents.length, 2);
		assert.strictEqual(contents[0].role, 'model');
		assert.strictEqual(contents[0].parts.length, 2);
		assert.strictEqual(contents[1].role, 'user');
		assert.strictEqual(contents[1].parts.length, 2);
		assert.strictEqual(contents[0].parts.some((part: any) => !!part.functionCall), false);
		assert.strictEqual(contents[1].parts.some((part: any) => !!part.functionResponse), false);
		assert.deepStrictEqual(
			contents[0].parts.map((part: any) => typeof part.text === 'string' && part.text.includes('Tool call')),
			[true, true]
		);
		assert.deepStrictEqual(
			contents[1].parts.map((part: any) => typeof part.text === 'string' && part.text.includes('Tool result')),
			[true, true]
		);
	});

	test('does not replay Gemini function calls natively even when thought signatures are present', () => {
		const { contents } = createService().toGeminiContents([
			{
				role: 'assistant',
				content: '',
				toolCalls: [
					{
						id: 'call_read',
						toolName: 'read_file',
						input: { path: 'package.json' },
						providerMetadata: { gemini: { thoughtSignature: 'thought-signature-1' } }
					}
				]
			}
		]);

		assert.strictEqual(contents.length, 1);
		assert.strictEqual(contents[0].parts.some((part: any) => !!part.functionCall), false);
		assert.strictEqual(contents[0].parts[0].text.includes('Tool call (call_read): read_file'), true);
	});

	test('replays unsigned Gemini tool history as text instead of invalid native function calls', () => {
		const { contents } = createService().toGeminiContents([
			{
				role: 'assistant',
				content: '',
				toolCalls: [
					{
						id: 'call_list',
						toolName: 'list_dir',
						input: { path: '.' }
					}
				]
			},
			{
				role: 'tool',
				toolCallId: 'call_list',
				toolName: 'list_dir',
				content: '{"success":true,"entries":["src"]}'
			}
		]);

		assert.strictEqual(contents.length, 2);
		assert.strictEqual(contents[0].role, 'model');
		assert.strictEqual(contents[0].parts.some((part: any) => !!part.functionCall), false);
		assert.strictEqual(contents[0].parts[0].text.includes('Tool call (call_list): list_dir'), true);
		assert.strictEqual(contents[1].role, 'user');
		assert.strictEqual(contents[1].parts.some((part: any) => !!part.functionResponse), false);
		assert.strictEqual(contents[1].parts[0].text.includes('Tool result (call_list): list_dir'), true);
	});

	test('extracts Gemini function calls from raw candidate parts with thought signatures', () => {
		const calls = createService().extractGeminiFunctionCallParts({
			candidates: [
				{
					content: {
						parts: [
							{
								functionCall: {
									name: 'list_dir',
									args: { path: '.' }
								},
								thoughtSignature: 'thought-signature-2'
							}
						]
					}
				}
			]
		});

		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0].name, 'list_dir');
		assert.deepStrictEqual(calls[0].args, { path: '.' });
		assert.strictEqual(calls[0].thoughtSignature, 'thought-signature-2');
	});

	test('merges later Gemini streamed signatures into pending function calls', () => {
		const service = createService();
		const pending = new Map<string, any>();

		service.collectGeminiPendingToolCall(pending, { name: 'list_dir', args: { path: '.' } });
		service.collectGeminiPendingToolCall(pending, { name: 'list_dir', args: { path: '.' }, thoughtSignature: 'thought-signature-3' });

		const calls = [...pending.values()];
		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0].toolName, 'list_dir');
		assert.deepStrictEqual(calls[0].input, { path: '.' });
		assert.strictEqual(calls[0].thoughtSignature, 'thought-signature-3');
	});

	test('disables Gemini SDK automatic function calling for CleanSlate-managed tools', async () => {
		const service = createService();
		let capturedRequest: any;
		service.createGeminiClient = async () => ({
			models: {
				generateContentStream(request: any) {
					capturedRequest = request;
					return (async function* () { })();
				}
			}
		});
		service.importExternalModule = async () => ({
			FunctionCallingConfigMode: {
				AUTO: 'AUTO',
				ANY: 'ANY'
			}
		});
		service.createProviderAbortController = () => ({
			signal: undefined,
			touch() { },
			dispose() { }
		});

		const event = service.geminiGenerateContentStream({
			apiKey: 'test-key',
			model: 'gemini-3.5-flash',
			messages: [{ role: 'user', content: 'list files' }],
			options: {
				tools: [
					{ name: 'default_api:list_dir', description: 'List files', parametersSchema: { type: 'object', properties: {} } }
				],
				requiredToolName: 'default_api:list_dir'
			}
		}, CancellationToken.None);

		await new Promise<void>(resolve => {
			event((value: unknown) => {
				if (value === null) {
					resolve();
				}
			});
		});

		assert.deepStrictEqual(capturedRequest.config.automaticFunctionCalling, { disable: true, ignoreCallHistory: true });
		assert.strictEqual(capturedRequest.config.tools[0].functionDeclarations[0].name, 'default_api_list_dir');
		assert.deepStrictEqual(capturedRequest.config.toolConfig.functionCallingConfig.allowedFunctionNames, ['default_api_list_dir']);
	});

	test('groups parallel provider tool results into one user message', () => {
		const request = createService().toProviderConverseRequest({
			region: 'us-east-1',
			credentialMode: 'default',
			modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
			messages: parallelToolMessages
		});

		assert.strictEqual(request.messages.length, 2);
		assert.strictEqual(request.messages[0].role, 'assistant');
		assert.strictEqual(request.messages[0].content.length, 2);
		assert.strictEqual(request.messages[1].role, 'user');
		assert.strictEqual(request.messages[1].content.length, 2);
		assert.deepStrictEqual(
			request.messages[1].content.map((part: any) => part.toolResult.toolUseId),
			['call_read', 'call_search']
		);
	});
});
