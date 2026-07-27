/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CleanSlateService } from '../../../../services/cleanSlate/common/core/cleanSlateService.js';

suite('CleanSlateService provider capabilities', () => {
	test('declares Gemini capable of native tool execution through the provider bridge', async () => {
		let capturedOptions: any;
		const service = new CleanSlateService(
			{
				getConfiguration: () => ({ provider: 'gemini', providers: { gemini: { model: 'gemini-3-flash', apiKey: 'test-key' } } }),
				getResolvedConfiguration: async () => ({ provider: 'gemini', providers: { gemini: { model: 'gemini-3-flash', apiKey: 'test-key' } } })
			} as any,
			{
				geminiGenerateContentStream(options: any) {
					capturedOptions = options;
					return (listener: (value: string | null) => void) => {
						setTimeout(() => listener(null), 0);
						return { dispose() { } };
					};
				}
			} as any,
			{ info() { }, error() { } } as any
		);

		const capabilities = service.getProviderCapabilities('gemini');
		assert.strictEqual(capabilities.nativeToolCalls, true);

		const stream = await service.chat(
			[{ role: 'user', content: 'Use a tool.' }],
			{ tools: [{ name: 'read_file', description: 'Read a file', parametersSchema: { type: 'object', properties: {} } }] }
		);
		for await (const _part of stream) {
			// Drain the stream so the provider request is produced.
		}
		assert.strictEqual(capturedOptions.model, 'gemini-3-flash');
		assert.strictEqual(capturedOptions.temperature, 1);
		assert.strictEqual(capturedOptions.topP, 0.95);
		assert.strictEqual(capturedOptions.topK, 64);
		assert.deepStrictEqual(capturedOptions.thinkingConfig, { includeThoughts: true, thinkingLevel: 'minimal' });
		assert.strictEqual(capturedOptions.maxOutputTokens, 32000);
		assert.strictEqual(capturedOptions.options.tools[0].name, 'read_file');
	});

	test('does not retry Gemini quota exhaustion as a transient transport failure', async () => {
		let requestCount = 0;
		const quotaPayload = JSON.stringify({
			error: {
				code: 429,
				message: 'You exceeded your current quota. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests. Please retry in 46.7s.',
				status: 'RESOURCE_EXHAUSTED',
				details: [
					{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure' },
					{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '46s' }
				]
			}
		});
		const service = new CleanSlateService(
			{
				getConfiguration: () => ({ provider: 'gemini', providers: { gemini: { model: 'gemini-3.5-flash', apiKey: 'test-key' } } }),
				getResolvedConfiguration: async () => ({ provider: 'gemini', providers: { gemini: { model: 'gemini-3.5-flash', apiKey: 'test-key' } } })
			} as any,
			{
				geminiGenerateContentStream() {
					requestCount++;
					return (listener: (value: string | null) => void) => {
						setTimeout(() => listener(`ERROR: ${JSON.stringify({ error: { message: quotaPayload, code: 429, status: 'Too Many Requests' } })}`), 0);
						return { dispose() { } };
					};
				}
			} as any,
			{ info() { }, error() { }, debug() { }, warn() { } } as any
		);

		const emitted: any[] = [];
		await assert.rejects(
			async () => {
				const stream = await service.chat([{ role: 'user', content: 'Use a tool.' }]);
				for await (const part of stream) {
					emitted.push(part);
				}
			},
			/error.*RESOURCE_EXHAUSTED|current quota/i
		);
		assert.strictEqual(requestCount, 1);
		assert.deepStrictEqual(emitted, []);
	});

	test('declares OpenAI and Anthropic capable of native tool execution', () => {
		const service = new CleanSlateService(
			{
				getConfiguration: () => ({ provider: 'openai', providers: { openai: { model: 'gpt-5.4', apiKey: 'sk-test' } } }),
				getResolvedConfiguration: async () => ({ provider: 'openai', providers: { openai: { model: 'gpt-5.4', apiKey: 'sk-test' } } })
			} as any,
			{} as any,
			{ info() { }, error() { } } as any
		);

		assert.strictEqual(service.getProviderCapabilities('openai').nativeToolCalls, true);
		assert.strictEqual(service.getProviderCapabilities('anthropic').nativeToolCalls, true);
	});

	test('routes NVIDIA NIM through the OpenAI-compatible bridge without a hardcoded base URL', async () => {
		let capturedOptions: any;
		const service = new CleanSlateService(
			{
				getConfiguration: () => ({ provider: 'nvidia', providers: { nvidia: { model: 'openai/gpt-oss-120b', apiKey: 'nvapi-test' } } }),
				getResolvedConfiguration: async () => ({ provider: 'nvidia', providers: { nvidia: { model: 'openai/gpt-oss-120b', apiKey: 'nvapi-test' } } })
			} as any,
			{
				openAICompatibleChatStream(options: any) {
					capturedOptions = options;
					return (listener: (value: string | null) => void) => {
						setTimeout(() => listener(null), 0);
						return { dispose() { } };
					};
				}
			} as any,
			{ info() { }, error() { }, debug() { } } as any
		);

		assert.strictEqual(service.getProviderCapabilities('nvidia').nativeToolCalls, true);

		const stream = await service.chat(
			[{ role: 'user', content: 'Use a tool.' }],
			{ tools: [{ name: 'read_file', description: 'Read a file', parametersSchema: { type: 'object', properties: {} } }] }
		);
		for await (const _part of stream) {
			// Drain the stream so the provider request is produced.
		}

		assert.strictEqual(capturedOptions.providerName, 'NVIDIA NIM');
		assert.strictEqual(capturedOptions.model, 'openai/gpt-oss-120b');
		assert.strictEqual(capturedOptions.baseUrl, undefined);
		assert.strictEqual(capturedOptions.useMaxCompletionTokens, true);
		assert.strictEqual(capturedOptions.suppressReasoningContent, true);
		assert.strictEqual(capturedOptions.options.tools[0].name, 'read_file');
	});

	test('declares NVIDIA Nemotron capable of native tool execution', async () => {
		let capturedOptions: any;
		const service = new CleanSlateService(
			{
				getConfiguration: () => ({ provider: 'nvidia', providers: { nvidia: { model: 'nvidia/nemotron-3-ultra-550b-a55b', apiKey: 'nvapi-test' } } }),
				getResolvedConfiguration: async () => ({ provider: 'nvidia', providers: { nvidia: { model: 'nvidia/nemotron-3-ultra-550b-a55b', apiKey: 'nvapi-test' } } })
			} as any,
			{
				openAICompatibleChatStream(options: any) {
					capturedOptions = options;
					return (listener: (value: string | null) => void) => {
						setTimeout(() => listener(null), 0);
						return { dispose() { } };
					};
				}
			} as any,
			{ info() { }, error() { }, debug() { } } as any
		);

		assert.strictEqual(service.getProviderCapabilities('nvidia').nativeToolCalls, true);

		const stream = await service.chat(
			[{ role: 'user', content: 'Use a tool.' }],
			{ tools: [{ name: 'read_file', description: 'Read a file', parametersSchema: { type: 'object', properties: {} } }] }
		);
		for await (const _part of stream) {
			// Drain the stream so the provider request is produced.
		}

		assert.strictEqual(capturedOptions.providerName, 'NVIDIA NIM');
		assert.strictEqual(capturedOptions.model, 'nvidia/nemotron-3-ultra-550b-a55b');
		assert.strictEqual(capturedOptions.useMaxCompletionTokens, false);
		assert.strictEqual(capturedOptions.suppressReasoningContent, true);
		assert.strictEqual(capturedOptions.options.tools[0].name, 'read_file');
	});

	test('keeps unknown NVIDIA NIM model names on the OpenAI-compatible tool adapter', async () => {
		let capturedOptions: any;
		const service = new CleanSlateService(
			{
				getConfiguration: () => ({ provider: 'nvidia', providers: { nvidia: { model: 'nvidia/future-agentic-model-2027', apiKey: 'nvapi-test' } } }),
				getResolvedConfiguration: async () => ({ provider: 'nvidia', providers: { nvidia: { model: 'nvidia/future-agentic-model-2027', apiKey: 'nvapi-test' } } })
			} as any,
			{
				openAICompatibleChatStream(options: any) {
					capturedOptions = options;
					return (listener: (value: string | null) => void) => {
						setTimeout(() => listener(null), 0);
						return { dispose() { } };
					};
				}
			} as any,
			{ info() { }, error() { }, debug() { } } as any
		);

		assert.strictEqual(service.getProviderCapabilities('nvidia').nativeToolCalls, true);

		const stream = await service.chat(
			[{ role: 'user', content: 'Use a tool.' }],
			{ tools: [{ name: 'read_file', description: 'Read a file', parametersSchema: { type: 'object', properties: {} } }] }
		);
		for await (const _part of stream) {
			// Drain the stream so the provider request is produced.
		}

		assert.strictEqual(capturedOptions.providerName, 'NVIDIA NIM');
		assert.strictEqual(capturedOptions.model, 'nvidia/future-agentic-model-2027');
		assert.strictEqual(capturedOptions.useMaxCompletionTokens, false);
		assert.strictEqual(capturedOptions.suppressReasoningContent, true);
		assert.strictEqual(capturedOptions.options.tools[0].name, 'read_file');
	});

	test('routes OpenRouter gpt-oss as a suppressed OpenAI-compatible reasoning model', async () => {
		let capturedOptions: any;
		const service = new CleanSlateService(
			{
				getConfiguration: () => ({ provider: 'openrouter', providers: { openrouter: { model: 'openai/gpt-oss-120b', apiKey: 'sk-or-test' } } }),
				getResolvedConfiguration: async () => ({ provider: 'openrouter', providers: { openrouter: { model: 'openai/gpt-oss-120b', apiKey: 'sk-or-test' } } })
			} as any,
			{
				openAICompatibleChatStream(options: any) {
					capturedOptions = options;
					return (listener: (value: string | null) => void) => {
						setTimeout(() => listener(null), 0);
						return { dispose() { } };
					};
				}
			} as any,
			{ info() { }, error() { }, debug() { } } as any
		);

		assert.strictEqual(service.getProviderCapabilities('openrouter').nativeToolCalls, true);

		const stream = await service.chat([{ role: 'user', content: 'hello' }]);
		for await (const _part of stream) {
			// Drain the stream so the provider request is produced.
		}

		assert.strictEqual(capturedOptions.providerName, 'OpenRouter');
		assert.strictEqual(capturedOptions.model, 'openai/gpt-oss-120b');
		assert.strictEqual(capturedOptions.useMaxCompletionTokens, true);
		assert.strictEqual(capturedOptions.includeSamplingParameters, false);
		assert.strictEqual(capturedOptions.suppressReasoningContent, true);
	});

		test('applies high-reasoning Anthropic thinking controls before provider request', async () => {
		let capturedOptions: any;
		const service = new CleanSlateService(
			{
					getConfiguration: () => ({ provider: 'anthropic', providers: { anthropic: { model: 'claude-sonnet-4-5', apiKey: 'sk-ant-test' } }, planMode: true, reasoningLevel: 'high' }),
					getResolvedConfiguration: async () => ({ provider: 'anthropic', providers: { anthropic: { model: 'claude-sonnet-4-5', apiKey: 'sk-ant-test' } }, planMode: true, reasoningLevel: 'high' })
			} as any,
			{
				anthropicMessagesStream(options: any) {
					capturedOptions = options;
					return (listener: (value: string | null) => void) => {
						setTimeout(() => listener(null), 0);
						return { dispose() { } };
					};
				}
			} as any,
			{ info() { }, error() { }, debug() { }, warn() { } } as any
		);

		const stream = await service.chat([{ role: 'user', content: 'hi' }]);
		for await (const _part of stream) {
			// Drain the stream so the Anthropic bridge request is produced.
		}

		assert.strictEqual(capturedOptions.model, 'claude-sonnet-4-5');
		assert.deepStrictEqual(capturedOptions.thinking, { type: 'enabled', budgetTokens: 16000 });
		assert.strictEqual(capturedOptions.maxOutputTokens, 32000);
	});

	test('sends native tool-call and tool-result messages through the OpenAI provider bridge', async () => {
		let capturedOptions: any;
		const service = new CleanSlateService(
			{
				getConfiguration: () => ({ provider: 'openai', providers: { openai: { model: 'gpt-5.4', apiKey: 'sk-test' } } }),
				getResolvedConfiguration: async () => ({ provider: 'openai', providers: { openai: { model: 'gpt-5.4', apiKey: 'sk-test' } } })
			} as any,
			{
				openAIResponsesStream(options: any) {
					capturedOptions = options;
					return (listener: (value: string | null) => void) => {
						setTimeout(() => listener(null), 0);
						return { dispose() { } };
					};
				}
			} as any,
			{ info() { }, error() { } } as any
		);

		const stream = await service.chat(
			[
				{ role: 'user', content: 'Read package.json.' },
				{
					role: 'assistant',
					content: '',
					toolCalls: [{ id: 'call-read-1', toolName: 'read_file', input: { path: 'package.json' } }]
				},
				{
					role: 'tool',
					toolCallId: 'call-read-1',
					toolName: 'read_file',
					content: '{"success":true,"content":"{}"}'
				}
			],
			{ tools: [{ name: 'read_file', description: 'Read a file', parametersSchema: { type: 'object', properties: {} } }] }
		);

		for await (const _part of stream) {
			// Drain the stream so the provider request is produced.
		}

		assert.strictEqual(capturedOptions.model, 'gpt-5.4');
		assert.strictEqual(capturedOptions.messages[1].role, 'assistant');
		assert.strictEqual(capturedOptions.messages[1].toolCalls[0].id, 'call-read-1');
		assert.strictEqual(capturedOptions.messages[1].toolCalls[0].toolName, 'read_file');
		assert.strictEqual(capturedOptions.messages[2].role, 'tool');
		assert.strictEqual(capturedOptions.messages[2].toolCallId, 'call-read-1');
	});

	test('does not send OpenAI reasoning-only parameters to Azure-hosted Grok deployments', async () => {
		let capturedOptions: any;
		const service = new CleanSlateService(
			{
					getConfiguration: () => ({
						provider: 'azureOpenAI',
						reasoningLevel: 'medium',
						providers: {
						azureOpenAI: {
							endpoint: 'https://cleanslate-resource.services.ai.azure.com',
							deploymentName: 'grok-4-1-fast-reasoning',
							apiKey: 'azure-key'
						}
					},
					maxOutputTokens: 16384
				}),
					getResolvedConfiguration: async () => ({
						provider: 'azureOpenAI',
						reasoningLevel: 'medium',
						providers: {
						azureOpenAI: {
							endpoint: 'https://cleanslate-resource.services.ai.azure.com',
							deploymentName: 'grok-4-1-fast-reasoning',
							apiKey: 'azure-key'
						}
					},
					maxOutputTokens: 16384
				})
			} as any,
			{
				openAICompatibleChatStream(options: any) {
					capturedOptions = options;
					return (listener: (value: string | null) => void) => {
						setTimeout(() => listener(null), 0);
						return { dispose() { } };
					};
				}
			} as any,
			{ info() { }, error() { } } as any
		);

		const stream = await service.chat([{ role: 'user', content: 'hi' }]);
		for await (const _part of stream) {
			// Drain the stream so the provider request is produced.
		}

		assert.strictEqual(capturedOptions.providerName, 'Azure AI Foundry');
		assert.strictEqual(capturedOptions.baseUrl, 'https://cleanslate-resource.services.ai.azure.com/openai/v1/');
		assert.strictEqual(capturedOptions.model, 'grok-4-1-fast-reasoning');
		assert.strictEqual(capturedOptions.useMaxCompletionTokens, false);
		assert.strictEqual(capturedOptions.includeSamplingParameters, false);
		assert.strictEqual(capturedOptions.reasoningEffort, undefined);
		assert.strictEqual(capturedOptions.parallelToolCalls, undefined);
		assert.strictEqual(capturedOptions.maxOutputTokens, 16384);
		assert.strictEqual(capturedOptions.azure, undefined);
	});

	test('routes Azure OpenAI resource hosts through the v1 OpenAI-compatible endpoint', async () => {
		let capturedOptions: any;
		const service = new CleanSlateService(
			{
					getConfiguration: () => ({
						provider: 'azureOpenAI',
						reasoningLevel: 'medium',
						providers: {
						azureOpenAI: {
							endpoint: 'https://cleanslate-resource.openai.azure.com',
							deploymentName: 'grok-4-20-non-reasoning',
							apiKey: 'azure-key'
						}
					}
				}),
					getResolvedConfiguration: async () => ({
						provider: 'azureOpenAI',
						reasoningLevel: 'medium',
						providers: {
						azureOpenAI: {
							endpoint: 'https://cleanslate-resource.openai.azure.com',
							deploymentName: 'grok-4-20-non-reasoning',
							apiKey: 'azure-key'
						}
					}
				})
			} as any,
			{
				openAICompatibleChatStream(options: any) {
					capturedOptions = options;
					return (listener: (value: string | null) => void) => {
						setTimeout(() => listener(null), 0);
						return { dispose() { } };
					};
				}
			} as any,
			{ info() { }, error() { } } as any
		);

		const stream = await service.chat([{ role: 'user', content: 'hi' }]);
		for await (const _part of stream) {
			// Drain the stream so the provider request is produced.
		}

		assert.strictEqual(capturedOptions.providerName, 'Azure AI Foundry');
		assert.strictEqual(capturedOptions.baseUrl, 'https://cleanslate-resource.openai.azure.com/openai/v1/');
		assert.strictEqual(capturedOptions.model, 'grok-4-20-non-reasoning');
		assert.strictEqual(capturedOptions.azure, undefined);
		assert.strictEqual(capturedOptions.useMaxCompletionTokens, false);
		assert.strictEqual(capturedOptions.includeSamplingParameters, false);
		assert.strictEqual(capturedOptions.maxOutputTokens, 30000);
	});

	test('applies CleanSlate sampling defaults to Azure Foundry Qwen deployments', async () => {
		let capturedOptions: any;
		const service = new CleanSlateService(
			{
				getConfiguration: () => ({
					provider: 'azureOpenAI',
					providers: {
						azureOpenAI: {
							endpoint: 'https://cleanslate-resource.services.ai.azure.com',
							deploymentName: 'qwen3-coder',
							apiKey: 'azure-key'
						}
					}
				}),
				getResolvedConfiguration: async () => ({
					provider: 'azureOpenAI',
					providers: {
						azureOpenAI: {
							endpoint: 'https://cleanslate-resource.services.ai.azure.com',
							deploymentName: 'qwen3-coder',
							apiKey: 'azure-key'
						}
					}
				})
			} as any,
			{
				openAICompatibleChatStream(options: any) {
					capturedOptions = options;
					return (listener: (value: string | null) => void) => {
						setTimeout(() => listener(null), 0);
						return { dispose() { } };
					};
				}
			} as any,
			{ info() { }, error() { } } as any
		);

		const stream = await service.chat([{ role: 'user', content: 'hi' }]);
		for await (const _part of stream) {
			// Drain the stream so the provider request is produced.
		}

		assert.strictEqual(capturedOptions.providerName, 'Azure AI Foundry');
		assert.strictEqual(capturedOptions.model, 'qwen3-coder');
		assert.strictEqual(capturedOptions.useMaxCompletionTokens, false);
		assert.strictEqual(capturedOptions.temperature, 0.55);
		assert.strictEqual(capturedOptions.topP, 1);
		assert.strictEqual(capturedOptions.maxOutputTokens, 32000);
	});

	test('sends OpenAI reasoning controls to Azure-hosted GPT deployments', async () => {
		let capturedOptions: any;
		const service = new CleanSlateService(
			{
				getConfiguration: () => ({
					provider: 'azureOpenAI',
					reasoningLevel: 'medium',
					providers: {
						azureOpenAI: {
							endpoint: 'https://cleanslate-resource.services.ai.azure.com/openai/v1',
							deploymentName: 'gpt-5.4-mini',
							apiKey: 'azure-key'
						}
					}
				}),
				getResolvedConfiguration: async () => ({
					provider: 'azureOpenAI',
					reasoningLevel: 'medium',
					providers: {
						azureOpenAI: {
							endpoint: 'https://cleanslate-resource.services.ai.azure.com/openai/v1',
							deploymentName: 'gpt-5.4-mini',
							apiKey: 'azure-key'
						}
					}
				})
			} as any,
			{
				openAIResponsesStream(options: any) {
					capturedOptions = options;
					return (listener: (value: string | null) => void) => {
						setTimeout(() => listener(null), 0);
						return { dispose() { } };
					};
				}
			} as any,
			{ info() { }, error() { }, debug() { } } as any
		);

		const stream = await service.chat(
			[{ role: 'user', content: 'hi' }],
			{ tools: [{ name: 'read_file', description: 'Read a file', parametersSchema: { type: 'object', properties: {} } }] }
		);
		for await (const _part of stream) {
			// Drain the stream so the provider request is produced.
		}

		assert.strictEqual(capturedOptions.providerName, 'Azure AI Foundry');
		assert.strictEqual(capturedOptions.model, 'gpt-5.4-mini');
		assert.strictEqual(capturedOptions.useResponsesApi, true);
		assert.strictEqual(capturedOptions.useMaxCompletionTokens, true);
		assert.strictEqual(capturedOptions.includeSamplingParameters, false);
		assert.strictEqual(capturedOptions.reasoningEffort, 'medium');
		assert.strictEqual(capturedOptions.parallelToolCalls, true);
		assert.strictEqual(capturedOptions.maxOutputTokens, 32000);
		assert.strictEqual(capturedOptions.azure, undefined);
	});

	test('routes Azure GPT-5.5 and GPT-5.4 pro deployments through Responses', async () => {
		for (const deploymentName of ['gpt-5.5', 'gpt-5.4-pro']) {
			let capturedOptions: any;
			const service = new CleanSlateService(
				{
					getConfiguration: () => ({
						provider: 'azureOpenAI',
						reasoningLevel: 'high',
						providers: {
							azureOpenAI: {
								endpoint: 'https://cleanslate-resource.services.ai.azure.com/openai/v1',
								deploymentName,
								apiKey: 'azure-key'
							}
						}
					}),
					getResolvedConfiguration: async () => ({
						provider: 'azureOpenAI',
						reasoningLevel: 'high',
						providers: {
							azureOpenAI: {
								endpoint: 'https://cleanslate-resource.services.ai.azure.com/openai/v1',
								deploymentName,
								apiKey: 'azure-key'
							}
						}
					})
				} as any,
				{
					openAIResponsesStream(options: any) {
						capturedOptions = options;
						return (listener: (value: string | null) => void) => {
							setTimeout(() => listener(null), 0);
							return { dispose() { } };
						};
					},
					openAICompatibleChatStream() {
						throw new Error('Azure GPT-5.5 and GPT-5.4 pro should use Responses.');
					}
				} as any,
				{ info() { }, error() { }, debug() { } } as any
			);

			const stream = await service.chat(
				[{ role: 'user', content: 'hi' }],
				{ tools: [{ name: 'read_file', description: 'Read a file', parametersSchema: { type: 'object', properties: {} } }] }
			);
			for await (const _part of stream) {
				// Drain the stream so the provider request is produced.
			}

			assert.strictEqual(capturedOptions.providerName, 'Azure AI Foundry');
			assert.strictEqual(capturedOptions.model, deploymentName);
			assert.strictEqual(capturedOptions.useResponsesApi, true);
			assert.strictEqual(capturedOptions.reasoningEffort, 'high');
			assert.strictEqual(capturedOptions.bodyOptions?.service_tier, undefined);
			assert.strictEqual(capturedOptions.azure, undefined);
		}
	});

	test('maps unsupported Azure GPT-5.4 pro none reasoning to the lowest pro effort', async () => {
		let capturedOptions: any;
		const service = new CleanSlateService(
			{
				getConfiguration: () => ({
					provider: 'azureOpenAI',
					reasoningLevel: 'none',
					providers: {
						azureOpenAI: {
							endpoint: 'https://cleanslate-resource.services.ai.azure.com/openai/v1',
							deploymentName: 'gpt-5.4-pro',
							apiKey: 'azure-key'
						}
					}
				}),
				getResolvedConfiguration: async () => ({
					provider: 'azureOpenAI',
					reasoningLevel: 'none',
					providers: {
						azureOpenAI: {
							endpoint: 'https://cleanslate-resource.services.ai.azure.com/openai/v1',
							deploymentName: 'gpt-5.4-pro',
							apiKey: 'azure-key'
						}
					}
				})
			} as any,
			{
				openAIResponsesStream(options: any) {
					capturedOptions = options;
					return (listener: (value: string | null) => void) => {
						setTimeout(() => listener(null), 0);
						return { dispose() { } };
					};
				}
			} as any,
			{ info() { }, error() { }, debug() { } } as any
		);

		const stream = await service.chat([{ role: 'user', content: 'hi' }]);
		for await (const _part of stream) {
			// Drain the stream so the provider request is produced.
		}

		assert.strictEqual(capturedOptions.providerName, 'Azure AI Foundry');
		assert.strictEqual(capturedOptions.model, 'gpt-5.4-pro');
		assert.strictEqual(capturedOptions.useResponsesApi, true);
		assert.strictEqual(capturedOptions.reasoningEffort, 'medium');
	});

	test('trims Azure endpoint and deployment name before sending provider requests', async () => {
		let capturedOptions: any;
		const service = new CleanSlateService(
			{
				getConfiguration: () => ({
					provider: 'azureOpenAI',
					providers: {
						azureOpenAI: {
							endpoint: ' https://cleanslate-resource.services.ai.azure.com/openai/v1/ ',
							deploymentName: ' grok-4-20-non-reasoning ',
							apiKey: 'azure-key'
						}
					}
				}),
				getResolvedConfiguration: async () => ({
					provider: 'azureOpenAI',
					providers: {
						azureOpenAI: {
							endpoint: ' https://cleanslate-resource.services.ai.azure.com/openai/v1/ ',
							deploymentName: ' grok-4-20-non-reasoning ',
							apiKey: 'azure-key'
						}
					}
				})
			} as any,
			{
				openAICompatibleChatStream(options: any) {
					capturedOptions = options;
					return (listener: (value: string | null) => void) => {
						setTimeout(() => listener(null), 0);
						return { dispose() { } };
					};
				}
			} as any,
			{ info() { }, error() { } } as any
		);

		const stream = await service.chat([{ role: 'user', content: 'hi' }]);
		for await (const _part of stream) {
			// Drain the stream so the provider request is produced.
		}

		assert.strictEqual(capturedOptions.baseUrl, 'https://cleanslate-resource.services.ai.azure.com/openai/v1/');
		assert.strictEqual(capturedOptions.model, 'grok-4-20-non-reasoning');
	});

	test('adds actionable Azure Foundry deployment diagnostics to provider 404s', async () => {
		const service = new CleanSlateService(
			{
				getConfiguration: () => ({
					provider: 'azureOpenAI',
					providers: {
						azureOpenAI: {
							endpoint: 'https://cleanslate-resource.services.ai.azure.com',
							deploymentName: 'grok-4-20-non-reasoning',
							apiKey: 'azure-key'
						}
					}
				}),
				getResolvedConfiguration: async () => ({
					provider: 'azureOpenAI',
					providers: {
						azureOpenAI: {
							endpoint: 'https://cleanslate-resource.services.ai.azure.com',
							deploymentName: 'grok-4-20-non-reasoning',
							apiKey: 'azure-key'
						}
					}
				})
			} as any,
			{
				openAICompatibleChatStream() {
					return (listener: (value: string | null) => void) => {
						setTimeout(() => {
							listener('ERROR: 404 The API deployment for this resource does not exist.');
							listener(null);
						}, 0);
						return { dispose() { } };
					};
				}
			} as any,
			{ info() { }, error() { } } as any
		);

		const stream = await service.chat([{ role: 'user', content: 'hi' }]);
		await assert.rejects(
			async () => {
				for await (const _part of stream) {
					// Drain to surface provider error.
				}
			},
			/Azure AI Foundry could not find deployment "grok-4-20-non-reasoning" on https:\/\/cleanslate-resource\.services\.ai\.azure\.com\/openai\/v1\//
		);
	});

	test('uses provider-aware low reasoning effort and output cap for OpenAI GPT-5 direct flow', async () => {
		let capturedOptions: any;
		const service = new CleanSlateService(
			{
					getConfiguration: () => ({ provider: 'openai', reasoningLevel: 'low', providers: { openai: { model: 'gpt-5.4-mini', apiKey: 'sk-test' } } }),
					getResolvedConfiguration: async () => ({ provider: 'openai', reasoningLevel: 'low', providers: { openai: { model: 'gpt-5.4-mini', apiKey: 'sk-test' } } })
			} as any,
			{
				openAIResponsesStream(options: any) {
					capturedOptions = options;
					return (listener: (value: string | null) => void) => {
						setTimeout(() => listener(null), 0);
						return { dispose() { } };
					};
				}
			} as any,
			{ info() { }, error() { } } as any
		);

		const stream = await service.chat([{ role: 'user', content: 'hi' }]);
		for await (const _part of stream) {
			// Drain the stream so the provider request is produced.
		}

		assert.strictEqual(capturedOptions.providerName, 'OpenAI');
		assert.strictEqual(capturedOptions.model, 'gpt-5.4-mini');
		assert.strictEqual(capturedOptions.useResponsesApi, true);
		assert.strictEqual(capturedOptions.useMaxCompletionTokens, true);
		assert.strictEqual(capturedOptions.includeSamplingParameters, false);
		assert.strictEqual(capturedOptions.reasoningEffort, 'low');
		assert.strictEqual(capturedOptions.reasoningSummary, 'auto');
		assert.deepStrictEqual(capturedOptions.bodyOptions, { service_tier: 'priority' });
		assert.strictEqual(capturedOptions.parallelToolCalls, undefined);
		assert.strictEqual(capturedOptions.store, false);
		assert.strictEqual(capturedOptions.maxOutputTokens, 32000);
	});

	test('keeps direct OpenAI GPT-5 planning profile on the original request shape', async () => {
		let capturedOptions: any;
		const service = new CleanSlateService(
			{
					getConfiguration: () => ({ provider: 'openai', reasoningLevel: 'medium', providers: { openai: { model: 'gpt-5.4-mini', apiKey: 'sk-test' } } }),
					getResolvedConfiguration: async () => ({ provider: 'openai', reasoningLevel: 'medium', providers: { openai: { model: 'gpt-5.4-mini', apiKey: 'sk-test' } } })
			} as any,
			{
				openAIResponsesStream(options: any) {
					capturedOptions = options;
					return (listener: (value: string | null) => void) => {
						setTimeout(() => listener(null), 0);
						return { dispose() { } };
					};
				}
			} as any,
			{ info() { }, error() { }, debug() { } } as any
		);

		const stream = await service.chat(
			[{ role: 'user', content: 'hi' }],
			{ tools: [{ name: 'read_file', description: 'Read a file', parametersSchema: { type: 'object', properties: {} } }] }
		);
		for await (const _part of stream) {
			// Drain the stream so the provider request is produced.
		}

		assert.strictEqual(capturedOptions.providerName, 'OpenAI');
		assert.strictEqual(capturedOptions.useResponsesApi, true);
		assert.strictEqual(capturedOptions.useMaxCompletionTokens, true);
		assert.strictEqual(capturedOptions.reasoningEffort, 'medium');
		assert.strictEqual(capturedOptions.reasoningSummary, 'auto');
		assert.deepStrictEqual(capturedOptions.bodyOptions, { service_tier: 'priority' });
		assert.strictEqual(capturedOptions.parallelToolCalls, undefined);
		assert.strictEqual(capturedOptions.store, false);
		assert.strictEqual(capturedOptions.maxOutputTokens, 32000);
	});
});
