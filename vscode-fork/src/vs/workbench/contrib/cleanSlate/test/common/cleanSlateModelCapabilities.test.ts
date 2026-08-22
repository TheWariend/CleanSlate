/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { getCleanSlateContextDefaults, resolveCleanSlateEffectiveReasoningLevel, resolveCleanSlateModelCapabilities, resolveCleanSlateReasoningLevelOptions } from '@cleanslate/sdk/protocol/cleanSlateModelCapabilities.js';

suite('CleanSlate model capabilities', () => {
	test('uses models.dev limits and reasoning metadata for newly released models', () => {
		const gpt56 = resolveCleanSlateModelCapabilities({
			provider: 'openai',
			model: 'gpt-5.6-sol',
			reasoningLevel: 'high',
			modelsDevMetadata: {
				id: 'gpt-5.6-sol', provider: 'openai', releaseDate: '2026-07-09', reasoning: true,
				reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], toolCall: true, temperature: false,
				contextWindowTokens: 1_050_000, maxInputTokens: 922_000, maxOutputTokens: 128_000
			}
		});
		const fable = resolveCleanSlateModelCapabilities({
			provider: 'anthropic',
			model: 'claude-fable-5',
			modelsDevMetadata: {
				id: 'claude-fable-5', provider: 'anthropic', reasoning: true,
				reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], toolCall: true,
				contextWindowTokens: 1_000_000, maxOutputTokens: 128_000
			}
		});
		const gpt56ExtraHigh = resolveCleanSlateModelCapabilities({
			provider: 'openai',
			model: 'gpt-5.6-sol',
			reasoningLevel: 'xhigh'
		});
		const gpt56Max = resolveCleanSlateModelCapabilities({
			provider: 'openai',
			model: 'gpt-5.6-sol',
			reasoningLevel: 'max'
		});
		const gpt56Options = resolveCleanSlateReasoningLevelOptions({
			provider: 'openai',
			model: 'gpt-5.6-sol'
		});

		assert.strictEqual(gpt56.modelContextWindowTokens, 1_050_000);
		assert.strictEqual(gpt56.maxInputTokens, 922_000);
		assert.deepStrictEqual(gpt56.supportedReasoningEfforts, ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
		assert.strictEqual(gpt56ExtraHigh.reasoningEffort, 'xhigh');
		assert.strictEqual(gpt56Max.reasoningEffort, 'max');
		assert.deepStrictEqual(gpt56Options.filter(option => option.enabled).map(option => option.level), ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
		assert.strictEqual(fable.modelContextWindowTokens, 1_000_000);
		assert.strictEqual(fable.modelMaxOutputTokens, 128_000);
		assert.strictEqual(fable.nativeToolCalls, true);
	});

	test('keeps GPT-5.6 and Claude Fable 5 in the built-in fallback catalog', () => {
		const gpt56 = resolveCleanSlateModelCapabilities({ provider: 'openai', model: 'gpt-5.6-terra', reasoningLevel: 'high' });
		const fable = resolveCleanSlateModelCapabilities({ provider: 'anthropic', model: 'claude-fable-5', reasoningLevel: 'high' });

		assert.strictEqual(gpt56.modelContextWindowTokens, 1_050_000);
		assert.deepStrictEqual(gpt56.supportedReasoningEfforts, ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
		assert.strictEqual(gpt56.bodyOptions?.service_tier, 'priority');
		assert.strictEqual(fable.modelContextWindowTokens, 1_000_000);
		assert.strictEqual(fable.modelMaxOutputTokens, 128_000);
		assert.deepStrictEqual(fable.supportedReasoningEfforts, ['low', 'medium', 'high', 'xhigh', 'max']);
		assert.deepStrictEqual(fable.thinking, { type: 'adaptive' });
	});
	test('treats GPT-5 mini models as reasoning models with provider max-input defaults', () => {
		const capabilities = resolveCleanSlateModelCapabilities({
			provider: 'openai',
			model: 'gpt-5.4-mini',
			reasoningLevel: 'medium'
		});

		assert.strictEqual(capabilities.useMaxCompletionTokens, true);
		assert.strictEqual(capabilities.useResponsesApi, true);
		assert.strictEqual(capabilities.includeSamplingParameters, false);
		assert.strictEqual(capabilities.reasoningEffort, 'medium');
		assert.strictEqual(capabilities.reasoningSummary, 'auto');
		assert.deepStrictEqual(capabilities.bodyOptions, { service_tier: 'priority' });
		assert.strictEqual(capabilities.parallelToolCalls, undefined);
		assert.deepStrictEqual(capabilities.supportedReasoningEfforts, ['none', 'low', 'medium', 'high', 'xhigh']);
		assert.strictEqual(capabilities.store, false);
		assert.strictEqual(capabilities.maxOutputTokens, 32000);
		assert.strictEqual(capabilities.contextWindowTokens, 252000);
		assert.strictEqual(capabilities.modelContextWindowTokens, 400000);
		assert.strictEqual(capabilities.modelMaxOutputTokens, 128000);
		assert.strictEqual(capabilities.maxInputTokens, 272000);
		assert.strictEqual(capabilities.autoCompactReserveTokens, 20000);
	});

	test('uses CleanSlate GPT-5 release-date and version gates for reasoning efforts', () => {
		const originalGpt5 = resolveCleanSlateModelCapabilities({
			provider: 'openai',
			model: 'gpt-5'
		});
		const releaseGatedGpt5 = resolveCleanSlateModelCapabilities({
			provider: 'openai',
			model: 'gpt-5',
			modelReleaseDate: '2025-12-05'
		});
		const gpt51 = resolveCleanSlateModelCapabilities({
			provider: 'openai',
			model: 'gpt-5.1'
		});
		const gpt54 = resolveCleanSlateModelCapabilities({
			provider: 'openai',
			model: 'gpt-5.4'
		});
		const azureGpt55 = resolveCleanSlateModelCapabilities({
			provider: 'azureOpenAI',
			flavor: 'azureFoundry',
			model: 'gpt-5.5',
			reasoningLevel: 'high'
		});
		const azureGpt54Pro = resolveCleanSlateModelCapabilities({
			provider: 'azureOpenAI',
			flavor: 'azureFoundry',
			model: 'gpt-5.4-pro',
			reasoningLevel: 'high'
		});
		const azureGpt54 = resolveCleanSlateModelCapabilities({
			provider: 'azureOpenAI',
			flavor: 'azureFoundry',
			model: 'gpt-5.4',
			reasoningLevel: 'high'
		});

			assert.deepStrictEqual(originalGpt5.supportedReasoningEfforts, ['minimal', 'low', 'medium', 'high']);
			assert.strictEqual(originalGpt5.reasoningEffort, 'low');
			assert.deepStrictEqual(releaseGatedGpt5.supportedReasoningEfforts, ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
			assert.strictEqual(releaseGatedGpt5.reasoningEffort, 'low');
		assert.deepStrictEqual(gpt51.supportedReasoningEfforts, ['none', 'low', 'medium', 'high']);
		assert.strictEqual(gpt51.reasoningEffort, 'low');
		assert.deepStrictEqual(gpt51.bodyOptions, { service_tier: 'priority' });
		assert.deepStrictEqual(gpt54.supportedReasoningEfforts, ['none', 'low', 'medium', 'high', 'xhigh']);
		assert.strictEqual(gpt54.reasoningEffort, 'low');
		assert.strictEqual(gpt54.useResponsesApi, true);
		assert.strictEqual(azureGpt55.useResponsesApi, true);
		assert.strictEqual(azureGpt55.reasoningEffort, 'high');
		assert.strictEqual(azureGpt54Pro.useResponsesApi, true);
		assert.strictEqual(azureGpt54Pro.reasoningSummary, undefined);
		assert.strictEqual(azureGpt54Pro.include, undefined);
		// Azure gpt-5.4 must use the Responses API and request streamed reasoning
		// summaries — this is what fills the thought lane on Azure deployments.
		assert.strictEqual(azureGpt54.useResponsesApi, true);
		assert.strictEqual(azureGpt54.reasoningSummary, 'auto');
		assert.deepStrictEqual(azureGpt54.include, ['reasoning.encrypted_content']);
	});

	test('uses None as the enabled no-reasoning choice for non-reasoning models', () => {
		const options = resolveCleanSlateReasoningLevelOptions({
			provider: 'openai',
			model: 'gpt-4.1'
		});
		const enabled = options.filter(option => option.enabled).map(option => option.level);
		const effective = resolveCleanSlateEffectiveReasoningLevel({
			provider: 'openai',
			model: 'gpt-4.1',
			reasoningLevel: 'low'
		});

		assert.deepStrictEqual(enabled, ['none']);
		assert.strictEqual(effective, 'none');
	});

	test('sends explicit none only where OpenAI GPT-5 supports it and falls back for pro', () => {
		const gpt54None = resolveCleanSlateModelCapabilities({
			provider: 'openai',
			model: 'gpt-5.4-mini',
			reasoningLevel: 'none'
		});
		const gpt5ProNone = resolveCleanSlateModelCapabilities({
			provider: 'openai',
			model: 'gpt-5-pro',
			reasoningLevel: 'none'
		});
		const gpt54ProNone = resolveCleanSlateModelCapabilities({
			provider: 'azureOpenAI',
			flavor: 'azureFoundry',
			model: 'gpt-5.4-pro',
			reasoningLevel: 'none'
		});
		const gpt54ProOptions = resolveCleanSlateReasoningLevelOptions({
			provider: 'azureOpenAI',
			flavor: 'azureFoundry',
			model: 'gpt-5.4-pro'
		});
		const gpt54ProEffective = resolveCleanSlateEffectiveReasoningLevel({
			provider: 'azureOpenAI',
			flavor: 'azureFoundry',
			model: 'gpt-5.4-pro',
			reasoningLevel: 'none'
		});

		assert.strictEqual(gpt54None.reasoningEffort, 'none');
		assert.strictEqual(gpt54None.reasoningSummary, undefined);
		assert.strictEqual(gpt54None.include, undefined);
		assert.strictEqual(gpt54None.maxOutputTokens, 32000);
		assert.strictEqual(gpt54None.useResponsesApi, true);
		assert.strictEqual(gpt5ProNone.reasoningEffort, 'high');
		assert.strictEqual(gpt54ProNone.reasoningEffort, 'medium');
		assert.deepStrictEqual(gpt54ProOptions.filter(option => option.enabled).map(option => option.level), ['medium', 'high', 'xhigh']);
		assert.strictEqual(gpt54ProEffective, 'medium');
	});

	test('uses CleanSlate GPT-5 chat/pro/codex effort gates', () => {
		const chat = resolveCleanSlateModelCapabilities({
			provider: 'openai',
			model: 'gpt-5-chat-latest'
		});
		const versionedChat = resolveCleanSlateModelCapabilities({
			provider: 'openai',
			model: 'gpt-5.2-chat-latest',
			reasoningLevel: 'medium'
		});
		const pro = resolveCleanSlateModelCapabilities({
			provider: 'openai',
			model: 'gpt-5-pro',
			reasoningLevel: 'high'
		});
		const versionedPro = resolveCleanSlateModelCapabilities({
			provider: 'openai',
			model: 'gpt-5.4-pro',
			reasoningLevel: 'high'
		});
			const codex = resolveCleanSlateModelCapabilities({
				provider: 'openai',
				model: 'gpt-5.3-codex',
				reasoningLevel: 'high'
			});

		assert.deepStrictEqual(chat.supportedReasoningEfforts, []);
		assert.strictEqual(chat.reasoningEffort, undefined);
		assert.deepStrictEqual(versionedChat.supportedReasoningEfforts, ['medium']);
		assert.strictEqual(versionedChat.reasoningEffort, 'medium');
		assert.deepStrictEqual(pro.supportedReasoningEfforts, ['high']);
		assert.strictEqual(pro.reasoningEffort, 'high');
		assert.deepStrictEqual(versionedPro.supportedReasoningEfforts, ['medium', 'high', 'xhigh']);
		assert.strictEqual(versionedPro.reasoningEffort, 'high');
		assert.strictEqual(versionedPro.reasoningSummary, undefined);
		assert.strictEqual(versionedPro.include, undefined);
		assert.strictEqual(versionedPro.bodyOptions, undefined);
		assert.deepStrictEqual(codex.supportedReasoningEfforts, ['none', 'low', 'medium', 'high', 'xhigh']);
		assert.strictEqual(codex.reasoningEffort, 'high');
	});

	test('keeps bare higher-model labels on the reasoning path', () => {
			const capabilities = resolveCleanSlateModelCapabilities({
				provider: 'openai',
				model: '5.5 mini',
				reasoningLevel: 'high'
			});

		assert.strictEqual(capabilities.family, 'openai-reasoning');
		assert.strictEqual(capabilities.reasoningEffort, 'high');
		assert.strictEqual(capabilities.contextWindowTokens, 252000);
	});

	test('raises default context budgets for high-context models without overriding explicit settings', () => {
		const defaults = getCleanSlateContextDefaults({
			provider: 'openai',
			model: 'gpt-5.4',
			reasoningLevel: 'medium'
		});

		assert.strictEqual(defaults.contextWindowTokens, 902000);
		assert.strictEqual(defaults.modelContextWindowTokens, 1050000);
		assert.strictEqual(defaults.modelMaxOutputTokens, 128000);
		assert.strictEqual(defaults.maxInputTokens, 922000);
		assert.strictEqual(defaults.autoCompactReserveTokens, 20000);
		assert.strictEqual(defaults.globalContextBudgetChars, 120000);
		assert.strictEqual(defaults.fileTruncationChars, 12000);

		const explicit = getCleanSlateContextDefaults({
			provider: 'openai',
			model: 'gpt-5.4',
			reasoningLevel: 'medium',
			configuredContextWindowTokens: 32768,
			configuredGlobalContextBudgetChars: 24000,
			configuredFileTruncationChars: 6000
		});

		assert.strictEqual(explicit.contextWindowTokens, 32768);
		assert.strictEqual(explicit.maxInputTokens, 32768);
		assert.strictEqual(explicit.autoCompactReserveTokens, 0);
		assert.strictEqual(explicit.globalContextBudgetChars, 24000);
		assert.strictEqual(explicit.fileTruncationChars, 6000);
	});

	test('uses provider input and output reserves for Codex GPT-5 models', () => {
		const codex = resolveCleanSlateModelCapabilities({
			provider: 'openai',
			model: 'gpt-5.3-codex'
		});

		assert.strictEqual(codex.contextWindowTokens, 252000);
		assert.strictEqual(codex.modelContextWindowTokens, 400000);
		assert.strictEqual(codex.modelMaxOutputTokens, 128000);
		assert.strictEqual(codex.maxInputTokens, 272000);
		assert.strictEqual(codex.autoCompactReserveTokens, 20000);
	});

	test('keeps third-party model budgets provider-aware', () => {
		const deepseek = getCleanSlateContextDefaults({
			provider: 'openai',
			model: 'deepseek-chat'
		});
		const gemini = getCleanSlateContextDefaults({
			provider: 'gemini',
			model: 'gemini-2.5-pro'
		});
		const claude = getCleanSlateContextDefaults({
			provider: 'anthropic',
			model: 'claude-sonnet-4-5'
		});
		const qwen = getCleanSlateContextDefaults({
			provider: 'azureOpenAI',
			model: 'qwen3-max'
		});
		const grok = getCleanSlateContextDefaults({
			provider: 'grok',
			model: 'grok-4.20'
		});

		assert.strictEqual(deepseek.contextWindowTokens, 32000);
		assert.strictEqual(deepseek.modelContextWindowTokens, 64000);
		assert.strictEqual(gemini.contextWindowTokens, 1016576);
		assert.strictEqual(gemini.modelContextWindowTokens, 1048576);
		assert.strictEqual(claude.contextWindowTokens, 168000);
		assert.strictEqual(claude.modelContextWindowTokens, 200000);
		assert.strictEqual(qwen.contextWindowTokens, 230144);
		assert.strictEqual(qwen.modelContextWindowTokens, 262144);
		assert.strictEqual(qwen.maxInputTokens, 262144);
		assert.strictEqual(grok.contextWindowTokens, 1970000);
		assert.strictEqual(grok.modelContextWindowTokens, 2000000);
	});

	test('deepseek v4 models get the 1M-token context profile', () => {
		const v4Flash = getCleanSlateContextDefaults({
			provider: 'openai',
			model: 'deepseek-v4-flash'
		});
		const v4Pro = getCleanSlateContextDefaults({
			provider: 'openai',
			model: 'deepseek-v4-pro'
		});
		const legacy = getCleanSlateContextDefaults({
			provider: 'openai',
			model: 'deepseek-chat'
		});

		assert.strictEqual(v4Flash.modelContextWindowTokens, 1000000);
		assert.ok(v4Flash.contextWindowTokens > 900000);
		assert.strictEqual(v4Pro.modelContextWindowTokens, 1000000);
		assert.strictEqual(legacy.modelContextWindowTokens, 64000);
	});

	test('uses OpenAI reasoning defaults for Azure OpenAI GPT deployments', () => {
		const capabilities = resolveCleanSlateModelCapabilities({
			provider: 'azureOpenAI',
			model: 'gpt-5.4-mini',
			flavor: 'azureFoundry',
			reasoningLevel: 'medium'
		});
			const defaults = getCleanSlateContextDefaults({
				provider: 'azureOpenAI',
				model: 'gpt-5.4-mini',
				reasoningLevel: 'medium'
			});

		assert.strictEqual(capabilities.family, 'openai-reasoning');
		assert.strictEqual(capabilities.useMaxCompletionTokens, true);
		assert.strictEqual(capabilities.reasoningEffort, 'medium');
		assert.strictEqual(capabilities.parallelToolCalls, true);
		assert.strictEqual(defaults.globalContextBudgetChars, 80000);
		assert.strictEqual(defaults.fileTruncationChars, 8000);
	});

	test('keeps Grok high-context defaults and sends xAI reasoning controls', () => {
		const capabilities = resolveCleanSlateModelCapabilities({
			provider: 'grok',
			model: 'grok-4'
		});
		const defaults = getCleanSlateContextDefaults({
			provider: 'grok',
			model: 'grok-4'
		});

		assert.strictEqual(capabilities.useMaxCompletionTokens, false);
		assert.strictEqual(capabilities.reasoningEffort, 'low');
		assert.strictEqual(capabilities.parallelToolCalls, undefined);
		assert.strictEqual(defaults.globalContextBudgetChars, 80000);
		assert.strictEqual(defaults.fileTruncationChars, 8000);
	});

	test('applies CleanSlate sampling defaults for Gemini and Qwen families', () => {
		const gemini = resolveCleanSlateModelCapabilities({
			provider: 'gemini',
			model: 'gemini-3-flash',
			reasoningLevel: 'high'
		});
		const qwen = resolveCleanSlateModelCapabilities({
			provider: 'azureOpenAI',
			model: 'qwen3-coder',
			flavor: 'azureFoundry'
		});

		assert.strictEqual(gemini.temperature, 1);
		assert.strictEqual(gemini.topP, 0.95);
		assert.strictEqual(gemini.topK, 64);
		assert.deepStrictEqual(gemini.thinkingConfig, { includeThoughts: true, thinkingLevel: 'high' });
		assert.strictEqual(qwen.temperature, 0.55);
		assert.strictEqual(qwen.topP, 1);
		assert.strictEqual(qwen.useMaxCompletionTokens, false);
	});

	test('maps Mixtral model names to the Mistral family', () => {
		const mixtral8x7b = resolveCleanSlateModelCapabilities({
			provider: 'nvidia',
			model: 'mistralai/mixtral-8x7b-instruct-v0.1'
		});
		const mixtral8x22b = resolveCleanSlateModelCapabilities({
			provider: 'nvidia',
			model: 'mistralai/mixtral-8x22b-instruct'
		});

		assert.strictEqual(mixtral8x7b.family, 'mistral');
		assert.strictEqual(mixtral8x7b.nativeToolCalls, true);
		assert.strictEqual(mixtral8x7b.openAICompatibleThirdParty, true);
		assert.strictEqual(mixtral8x7b.modelContextWindowTokens, 32768);
		assert.strictEqual(mixtral8x7b.modelMaxOutputTokens, 16384);
		assert.strictEqual(mixtral8x22b.family, 'mistral');
		assert.strictEqual(mixtral8x22b.modelContextWindowTokens, 65536);
		assert.strictEqual(mixtral8x22b.modelMaxOutputTokens, 13108);
	});

	test('uses catalog-backed limits for NVIDIA Nemotron Ultra', () => {
		const capabilities = resolveCleanSlateModelCapabilities({
			provider: 'nvidia',
			model: 'nvidia/nemotron-3-ultra-550b-a55b'
		});

		assert.strictEqual(capabilities.family, 'nemotron');
		assert.strictEqual(capabilities.nativeToolCalls, true);
		assert.strictEqual(capabilities.modelContextWindowTokens, 1000000);
		assert.strictEqual(capabilities.modelMaxOutputTokens, 65536);
	});

	test('keeps OpenRouter and Custom API on the OpenAI-compatible tool adapter for unknown models', () => {
		const openrouter = resolveCleanSlateModelCapabilities({
			provider: 'openrouter',
			flavor: 'openrouter',
			model: 'provider/future-agentic-model'
		});
		const custom = resolveCleanSlateModelCapabilities({
			provider: 'custom',
			flavor: 'custom',
			model: 'local-model'
		});

		assert.strictEqual(openrouter.family, 'openai-compatible-chat');
		assert.strictEqual(openrouter.nativeToolCalls, true);
		assert.strictEqual(openrouter.openAICompatibleThirdParty, true);
		assert.strictEqual(custom.family, 'openai-compatible-chat');
		assert.strictEqual(custom.nativeToolCalls, true);
		assert.strictEqual(custom.openAICompatibleThirdParty, true);
	});

	test('sets Sarvam custom API output limit to 16K', () => {
		const capabilities = resolveCleanSlateModelCapabilities({
			provider: 'custom',
			flavor: 'custom',
			model: 'sarvam-105b'
		});

		assert.strictEqual(capabilities.family, 'openai-compatible-chat');
		assert.strictEqual(capabilities.nativeToolCalls, true);
		assert.strictEqual(capabilities.maxOutputTokens, 16_384);
		assert.strictEqual(capabilities.modelMaxOutputTokens, 16_384);
	});

	test('maps Sarvam reasoning levels to its documented low/medium/high efforts', () => {
		const low = resolveCleanSlateModelCapabilities({ provider: 'custom', flavor: 'custom', model: 'sarvam-105b', reasoningLevel: 'low' });
		const medium = resolveCleanSlateModelCapabilities({ provider: 'custom', flavor: 'custom', model: 'sarvam-105b', reasoningLevel: 'medium' });
		const high = resolveCleanSlateModelCapabilities({ provider: 'custom', flavor: 'custom', model: 'sarvam-105b', reasoningLevel: 'high' });
		const none = resolveCleanSlateModelCapabilities({ provider: 'custom', flavor: 'custom', model: 'sarvam-105b', reasoningLevel: 'none' });
		const minimal = resolveCleanSlateModelCapabilities({ provider: 'custom', flavor: 'custom', model: 'sarvam-105b', reasoningLevel: 'minimal' });
		const options = resolveCleanSlateReasoningLevelOptions({ provider: 'custom', flavor: 'custom', model: 'sarvam-105b' });

		assert.deepStrictEqual(low.supportedReasoningEfforts, ['low', 'medium', 'high']);
		assert.strictEqual(low.reasoningEffort, 'low');
		assert.strictEqual(medium.reasoningEffort, 'medium');
		assert.strictEqual(high.reasoningEffort, 'high');
		assert.strictEqual(none.reasoningEffort, undefined);
		assert.strictEqual(minimal.reasoningEffort, undefined);
		assert.deepStrictEqual(options.filter(option => option.enabled).map(option => option.level), ['none', 'low', 'medium', 'high']);
	});

	test('maps GLM-5.2 reasoning levels to the Z.ai effort interface and gates older releases', () => {
		const low = resolveCleanSlateModelCapabilities({ provider: 'openrouter', flavor: 'openrouter', model: 'zai/glm-5.2', reasoningLevel: 'low' });
		const medium = resolveCleanSlateModelCapabilities({ provider: 'openrouter', flavor: 'openrouter', model: 'zai/glm-5.2', reasoningLevel: 'medium' });
		const high = resolveCleanSlateModelCapabilities({ provider: 'openrouter', flavor: 'openrouter', model: 'zai/glm-5.2', reasoningLevel: 'high' });
		const xhigh = resolveCleanSlateModelCapabilities({ provider: 'openrouter', flavor: 'openrouter', model: 'zai/glm-5.2', reasoningLevel: 'xhigh' });
		const max = resolveCleanSlateModelCapabilities({ provider: 'openrouter', flavor: 'openrouter', model: 'zai/glm-5.2', reasoningLevel: 'max' });
		const none = resolveCleanSlateModelCapabilities({ provider: 'openrouter', flavor: 'openrouter', model: 'zai/glm-5.2', reasoningLevel: 'none' });
		const legacy = resolveCleanSlateModelCapabilities({ provider: 'openrouter', flavor: 'openrouter', model: 'zai/glm-4.6' });
		const bareGated = resolveCleanSlateModelCapabilities({
			provider: 'openrouter',
			flavor: 'openrouter',
			model: 'glm',
			modelReleaseDate: '2026-02-01'
		});
		const options = resolveCleanSlateReasoningLevelOptions({ provider: 'openrouter', flavor: 'openrouter', model: 'zai/glm-5.2' });

		assert.deepStrictEqual(high.supportedReasoningEfforts, ['low', 'medium', 'high', 'xhigh', 'max']);
		assert.strictEqual(low.reasoningEffort, 'low');
		assert.strictEqual(medium.reasoningEffort, 'medium');
		assert.strictEqual(high.reasoningEffort, 'high');
		assert.strictEqual(xhigh.reasoningEffort, 'xhigh');
		assert.strictEqual(max.reasoningEffort, 'max');
		assert.strictEqual(none.reasoningEffort, undefined);
		assert.deepStrictEqual(legacy.supportedReasoningEfforts, []);
		assert.strictEqual(legacy.reasoningEffort, undefined);
		assert.deepStrictEqual(bareGated.supportedReasoningEfforts, ['low', 'medium', 'high', 'xhigh', 'max']);
		assert.deepStrictEqual(options.filter(option => option.enabled).map(option => option.level), ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
	});

	test('uses managed model metadata and operational output caps', () => {
		const kimi = resolveCleanSlateModelCapabilities({
			provider: 'cleanslate',
			model: 'kimi-k2.6',
			configuredMaxOutputTokens: 32000,
			modelsDevMetadata: {
				id: 'kimi-k2.6',
				provider: 'cleanslate',
				contextWindowTokens: 262144,
				maxOutputTokens: 8192
			}
		});
		const grok = resolveCleanSlateModelCapabilities({
			provider: 'cleanslate',
			model: 'grok-4.3',
			configuredMaxOutputTokens: 32000,
			modelsDevMetadata: {
				id: 'grok-4.3',
				provider: 'cleanslate',
				contextWindowTokens: 1000000,
				maxOutputTokens: 30000
			}
		});

		assert.strictEqual(kimi.contextWindowTokens, 253952);
		assert.strictEqual(kimi.maxOutputTokens, 8192);
		assert.strictEqual(grok.maxOutputTokens, 30000);
	});

	test('treats gpt-oss as reasoning on OpenAI-compatible host providers', () => {
		for (const request of [
			{ provider: 'openrouter' as const, flavor: 'openrouter' as const, model: 'openai/gpt-oss-120b' },
			{ provider: 'azureOpenAI' as const, flavor: 'azureFoundry' as const, model: 'gpt-oss-120b' },
			{ provider: 'custom' as const, flavor: 'custom' as const, model: 'gpt-oss-120b' },
			{ provider: 'nvidia' as const, flavor: 'nvidia' as const, model: 'openai/gpt-oss-120b' }
		]) {
			const capabilities = resolveCleanSlateModelCapabilities(request);
			assert.strictEqual(capabilities.family, 'openai-reasoning', request.provider);
			assert.strictEqual(capabilities.useMaxCompletionTokens, true, request.provider);
			assert.strictEqual(capabilities.includeSamplingParameters, false, request.provider);
			assert.strictEqual(capabilities.suppressReasoningContent, true, request.provider);
		}
	});

		test('maps CleanSlate reasoning levels to CleanSlate-style Gemini thinking controls', () => {
			const low = resolveCleanSlateModelCapabilities({
				provider: 'gemini',
				model: 'gemini-2.5-pro',
				reasoningLevel: 'low'
			});
			const medium = resolveCleanSlateModelCapabilities({
				provider: 'gemini',
				model: 'gemini-2.5-pro',
				reasoningLevel: 'medium'
			});
			const high = resolveCleanSlateModelCapabilities({
				provider: 'gemini',
				model: 'gemini-2.5-pro',
				reasoningLevel: 'high'
			});

			assert.deepStrictEqual(low.thinkingConfig, { includeThoughts: true, thinkingBudget: 128 });
			assert.deepStrictEqual(medium.thinkingConfig, { includeThoughts: true });
			assert.deepStrictEqual(high.thinkingConfig, { includeThoughts: true, thinkingBudget: 16000 });
		});

		test('enables Anthropic extended thinking for high reasoning Claude models', () => {
			const medium = resolveCleanSlateModelCapabilities({
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				planMode: true,
				reasoningLevel: 'medium'
			});
			const high = resolveCleanSlateModelCapabilities({
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				planMode: true,
				reasoningLevel: 'high'
			});

			assert.strictEqual(medium.thinking, undefined);
			assert.deepStrictEqual(high.thinking, { type: 'enabled', budgetTokens: 16000 });
		});

		test('maps low and medium reasoning to native provider request params only when supported', () => {
			const openaiLow = resolveCleanSlateModelCapabilities({ provider: 'openai', model: 'gpt-5.4-mini', reasoningLevel: 'low' });
			const openaiNone = resolveCleanSlateModelCapabilities({ provider: 'openai', model: 'gpt-5.4-mini', reasoningLevel: 'none' });
			const openaiMedium = resolveCleanSlateModelCapabilities({ provider: 'openai', model: 'gpt-5.4-mini', reasoningLevel: 'medium' });
			const gpt41Medium = resolveCleanSlateModelCapabilities({ provider: 'openai', model: 'gpt-4.1', reasoningLevel: 'medium' });
			const gpt41None = resolveCleanSlateModelCapabilities({ provider: 'openai', model: 'gpt-4.1', reasoningLevel: 'none' });
			const geminiNone = resolveCleanSlateModelCapabilities({ provider: 'gemini', model: 'gemini-2.5-pro', reasoningLevel: 'none' });
			const geminiLow = resolveCleanSlateModelCapabilities({ provider: 'gemini', model: 'gemini-2.5-pro', reasoningLevel: 'low' });
			const geminiMedium = resolveCleanSlateModelCapabilities({ provider: 'gemini', model: 'gemini-2.5-pro', reasoningLevel: 'medium' });
			const claudeMedium = resolveCleanSlateModelCapabilities({ provider: 'anthropic', model: 'claude-sonnet-4-5', reasoningLevel: 'medium' });
			const grokLow = resolveCleanSlateModelCapabilities({ provider: 'grok', model: 'grok-4.20', reasoningLevel: 'low' });
			const grokMedium = resolveCleanSlateModelCapabilities({ provider: 'grok', model: 'grok-4.20', reasoningLevel: 'medium' });
			const bedrockLow = resolveCleanSlateModelCapabilities({ provider: 'bedrock', model: 'amazon.nova-pro-v1:0', reasoningLevel: 'low' });
			const bedrockMedium = resolveCleanSlateModelCapabilities({ provider: 'bedrock', model: 'amazon.nova-pro-v1:0', reasoningLevel: 'medium' });

			assert.strictEqual(openaiNone.reasoningEffort, 'none');
			assert.strictEqual(openaiLow.reasoningEffort, 'low');
			assert.strictEqual(openaiLow.maxOutputTokens, 32000);
			assert.strictEqual(openaiMedium.reasoningEffort, 'medium');
			assert.strictEqual(openaiMedium.maxOutputTokens, 32000);
			assert.strictEqual(gpt41Medium.reasoningEffort, undefined);
			assert.strictEqual(gpt41None.reasoningEffort, undefined);
			assert.strictEqual(geminiNone.thinkingConfig, undefined);
			assert.deepStrictEqual(geminiLow.thinkingConfig, { includeThoughts: true, thinkingBudget: 128 });
			assert.deepStrictEqual(geminiMedium.thinkingConfig, { includeThoughts: true });
			assert.strictEqual(claudeMedium.thinking, undefined);
			assert.strictEqual(grokLow.reasoningEffort, 'low');
			assert.strictEqual(grokMedium.reasoningEffort, 'medium');
			assert.deepStrictEqual(bedrockLow.additionalModelRequestFields, { reasoningConfig: { type: 'enabled', maxReasoningEffort: 'low' } });
			assert.strictEqual(bedrockMedium.additionalModelRequestFields, undefined);
		});
});
