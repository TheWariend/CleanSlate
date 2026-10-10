/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { CancellationToken } from '../core/cancellation.js';
import { IChatMessage } from '../protocol/cleanSlateAI.js';
import { CleanSlateService } from '../protocol/cleanSlateService.js';
import { CleanSlateTranscriptIntegrityError, prepareCleanSlateProviderMessages } from '../protocol/cleanSlateTranscriptIntegrity.js';
import { CleanSlateAgentSession } from '../agent/cleanSlateAgentSession.js';
import { NodeCleanSlateMainService } from '../node/cleanSlateNodeMainService.js';
import { CleanSlateAnthropicMessageAdapter } from '../node/cleanSlateAnthropicMessageAdapter.js';
import { CleanSlateOpenAIMessageAdapter } from '../node/cleanSlateOpenAIMessageAdapter.js';
import { CleanSlateProviderSchemaNormalizer } from '../node/cleanSlateProviderSchemaNormalizer.js';
import { createNodeProviderConfiguration } from '../node/cleanSlateNodeAgentRuntime.js';

const call = { id: 'call-read', toolName: 'read_file', input: { path: '  index.html  ', empty: '' }, providerMetadata: { gemini: { thoughtSignature: 'signed-call' } } };
const other = { id: 'call-list', toolName: 'list_dir', input: {} };
const user: IChatMessage = { role: 'user', content: 'Build the game.' };
const assistant: IChatMessage = { role: 'assistant', content: '', toolCalls: [call] };
const result: IChatMessage = { role: 'tool', toolCallId: call.id, toolName: call.toolName, content: '  <html></html>\n' };

test('valid tool-only history preserves text, arguments, signatures and caller-owned objects', () => {
	const input = [user, assistant, result];
	const before = structuredClone(input);
	assert.deepEqual(prepareCleanSlateProviderMessages(input), before);
	assert.deepEqual(input, before);
	assert.equal(prepareCleanSlateProviderMessages(input)[1], assistant);
});

test('legacy null assistant text keeps its call/result pair through provider conversion', () => {
	const session = new CleanSlateAgentSession();
	session.restore({ version: 1, messages: [user, { ...assistant, content: null }, result] } as any);
	session.continueWithTurn([{ role: 'user', content: 'Open in browser.' }]);
	const messages = prepareCleanSlateProviderMessages(session.getSnapshot()!.messages);
	const adapter = new CleanSlateAnthropicMessageAdapter(new CleanSlateProviderSchemaNormalizer());
	const body = adapter.toMessagesRequest({ apiKey: 'test', model: 'test', messages });
	assert.equal(body.messages[1].content[0].id, call.id);
	assert.equal(body.messages[2].content[0].tool_use_id, call.id);
	assert.equal(body.messages[3].content[0].text, 'Open in browser.');
});

test('missing results become explicit unknown outcomes before the next turn without changing saved history', () => {
	const input: IChatMessage[] = [user, { ...assistant, toolCalls: [call, other] }, result, { role: 'user', content: 'Continue.' }];
	const before = structuredClone(input);
	const reported: string[] = [];
	const prepared = prepareCleanSlateProviderMessages(input, id => reported.push(id));
	assert.deepEqual(input, before);
	assert.deepEqual(reported, [other.id]);
	assert.deepEqual(prepared.map(message => message.role), ['user', 'assistant', 'tool', 'tool', 'user']);
	assert.equal(prepared[3].toolCallId, other.id);
	const missing = JSON.parse(prepared[3].content as string);
	assert.equal(missing.success, false);
	assert.equal(missing.code, 'tool_result_missing');
	assert.match(missing.message, /status is unknown/);
	assert.match(missing.message, /Do not assume success or repeat/);
	assert.deepEqual(prepareCleanSlateProviderMessages(prepared), prepared, 'Preparation must be idempotent across retries.');
	const anthropic = new CleanSlateAnthropicMessageAdapter(new CleanSlateProviderSchemaNormalizer()).toMessagesRequest({ apiKey: 'test', model: 'test', messages: prepared });
	assert.deepEqual(anthropic.messages[2].content.map((part: any) => part.tool_use_id), [call.id, other.id]);
	const openAI = new CleanSlateOpenAIMessageAdapter().toResponsesInput(prepared);
	assert.deepEqual(openAI.filter(item => item.type === 'function_call_output').map(item => item.call_id), [call.id, other.id]);
});

const invalid: Array<[string, IChatMessage[], RegExp]> = [
	['orphan result', [user, result], /no immediately preceding call/],
	['result from a different call group', [user, { ...assistant, toolCalls: [other] }, result], /does not belong/],
	['duplicate call within a group', [user, { ...assistant, toolCalls: [call, call] }, result], /duplicate tool call ID/],
	['duplicate call across turns', [user, assistant, result, user, assistant, result], /duplicate tool call ID/],
	['duplicate result', [user, assistant, result, result], /duplicate tool result ID/],
	['missing call ID', [user, { ...assistant, toolCalls: [{ ...call, id: undefined }] }], /missing its stable ID/],
	['missing result ID', [user, assistant, { ...result, toolCallId: undefined }], /missing its stable ID/],
	['mismatched tool name', [user, assistant, { ...result, toolName: 'write_file' }], /different tool name/],
	['non-adjacent result', [user, assistant, user, result], /no immediately preceding call/],
	['tool call on a user message', [{ ...user, toolCalls: [call] }], /only assistant/],
	['malformed call array', [{ ...assistant, toolCalls: {} as any }], /must be an array/]
];
for (const [name, messages, reason] of invalid) {
	test(`rejects ${name} with an actionable local error`, () => {
		assert.throws(() => prepareCleanSlateProviderMessages(messages), error => error instanceof CleanSlateTranscriptIntegrityError
			&& error.code === 'invalid_tool_history' && reason.test(error.message));
	});
}

test('a result elsewhere in the transcript is never replaced or silently reassigned', () => {
	const input = [user, assistant, user, result];
	let reported = false;
	assert.throws(() => prepareCleanSlateProviderMessages(input, () => { reported = true; }), CleanSlateTranscriptIntegrityError);
	assert.equal(reported, false, 'No recovery diagnostic should be emitted for a rejected prompt.');
});

for (const [provider, method] of [
	['cleanslate', 'chatCleanSlateManaged'], ['openai', 'chatOpenAI'], ['azureOpenAI', 'chatAzureOpenAI'],
	['anthropic', 'chatAnthropic'], ['gemini', 'chatGemini'], ['bedrock', 'chatBedrock'],
	['grok', 'chatGrok'], ['nvidia', 'chatNvidia'], ['openrouter', 'chatOpenRouter'], ['custom', 'chatCustom']
] as const) {
	test(`${provider} shared service rejects corruption before dispatch and forwards explicit missing results`, async () => {
		const config = createNodeProviderConfiguration({ provider, model: 'test', apiKey: 'test' });
		let metadataRequests = 0;
		const logger: any = { info() {}, warn() {}, error() {}, debug() {}, trace() {} };
		const service = new CleanSlateService({ getResolvedConfiguration: async () => config } as any,
			{ getModelsDevModelMetadata: async () => { metadataRequests++; } } as any, logger);
		let forwarded: IChatMessage[] | undefined;
		(service as any)[method] = async (messages: IChatMessage[]) => {
			forwarded = messages;
			return (async function* () {})();
		};
		await assert.rejects(service.chat([user, result]), CleanSlateTranscriptIntegrityError);
		assert.equal(forwarded, undefined);
		assert.equal(metadataRequests, 0, 'Invalid history must be rejected before any external lookup.');
		await service.chat([user, assistant, user]);
		assert.deepEqual(forwarded!.map(message => message.role), ['user', 'assistant', 'tool', 'user']);
		assert.equal(JSON.parse(forwarded![2].content as string).code, 'tool_result_missing');
	});
}

for (const provider of ['anthropic', 'gemini', 'bedrock', 'custom'] as const) {
	test(`${provider} rejects IDs that collide after provider conversion without retrying a local history error`, async () => {
		const config = createNodeProviderConfiguration({ provider, model: provider === 'custom' ? 'mistral-large-latest' : 'test', apiKey: 'test', baseUrl: 'https://provider.test/v1', bedrockRegion: 'test' });
		let providerRequests = 0;
		const rejectDispatch = () => { providerRequests++; throw new Error('Provider must not be reached.'); };
		const host: any = { anthropicMessagesStream: rejectDispatch, geminiGenerateContentStream: rejectDispatch, bedrockConverseStream: rejectDispatch, openAICompatibleChatStream: rejectDispatch };
		const logger: any = { info() {}, warn() {}, error() {}, debug() {}, trace() {} };
		const service = new CleanSlateService({ getResolvedConfiguration: async () => config, getConfiguration: () => config } as any, host, logger);
		const calls = [{ ...call, id: 'tool/502' }, { ...other, id: 'tool:502' }];
		const messages: IChatMessage[] = [user, { ...assistant, toolCalls: calls }, ...calls.map(item => ({ role: 'tool' as const, toolCallId: item.id, toolName: item.toolName, content: '{}' }))];
		assert.doesNotThrow(() => prepareCleanSlateProviderMessages(messages), 'The original IDs are distinct.');
		await assert.rejects(async () => {
			for await (const _part of await service.chat(messages, { tools: [{ name: call.toolName, description: 'Read a file', parametersSchema: { type: 'object' } }] })) {
				assert.fail('A local integrity error must not emit a retry frame.');
			}
		}, error => error instanceof CleanSlateTranscriptIntegrityError && /duplicate tool call ID/.test(error.message));
		assert.equal(providerRequests, 0);
	});
}

for (const method of ['openAICompatibleChatStream', 'openAIResponsesStream', 'anthropicMessagesStream', 'geminiGenerateContentStream', 'bedrockConverseStream'] as const) {
	test(`${method} direct Node callers receive the local error and never create a provider client`, async () => {
		const service = new NodeCleanSlateMainService('/tmp', () => undefined);
		let clientCreations = 0;
		(service as any).importExternalModule = async () => { clientCreations++; throw new Error('Provider must not be reached.'); };
		(service as any).createOpenAICompatibleClient = async () => { clientCreations++; throw new Error('Provider must not be reached.'); };
		(service as any).createAnthropicClient = async () => { clientCreations++; throw new Error('Provider must not be reached.'); };
		(service as any).createGeminiClient = async () => { clientCreations++; throw new Error('Provider must not be reached.'); };
		const options: any = { providerName: 'test', apiKey: 'test', model: 'test', modelId: 'test', region: 'test', messages: [user, result] };
		const frames = await new Promise<Array<string | null>>((resolve, reject) => {
			const parts: Array<string | null> = [];
			const timer = setTimeout(() => reject(new Error('The validation error was lost before subscription.')), 1000);
			const subscription = service[method](options, CancellationToken.None)(frame => {
				if (typeof frame === 'string' || frame === null) parts.push(frame);
				if (frame === null) { clearTimeout(timer); subscription.dispose(); resolve(parts); }
			});
		});
		assert.match(frames[0]!, /ERROR: \[invalid_tool_history\]/);
		assert.equal(frames.at(-1), null);
		assert.equal(clientCreations, 0);
	});
}

for (const method of ['openAICompatibleChatStream', 'openAIResponsesStream', 'anthropicMessagesStream', 'geminiGenerateContentStream', 'bedrockConverseStream'] as const) {
	test(`${method} sends paired unknown-outcome results without rewriting the original transcript`, async () => {
		const service = new NodeCleanSlateMainService('/tmp', () => undefined);
		let captured: any;
		const empty = async function* () {};
		const create = async (body: any) => { captured = body; return empty(); };
		(service as any).createOpenAICompatibleClient = async () => ({ chat: { completions: { create } }, responses: { create } });
		(service as any).createAnthropicClient = async () => ({ messages: { create } });
		(service as any).createGeminiClient = async () => ({ models: { generateContentStream: create } });
		(service as any).createBedrockClientConfig = async () => ({ region: 'test' });
		(service as any).importExternalModule = async () => ({
			ConverseStreamCommand: class { constructor(readonly input: any) {} },
			BedrockRuntimeClient: class {
				async send(command: any) { captured = command.input; return { stream: empty() }; }
			}
		});
		const messages: IChatMessage[] = [user, assistant, { role: 'user', content: 'Continue.' }];
		const before = structuredClone(messages);
		const options: any = { providerName: 'test', apiKey: 'test', model: 'test', modelId: 'test', region: 'test', messages };
		if (method === 'openAICompatibleChatStream') options.bodyOptions = { messages: [{ role: 'tool', tool_call_id: 'forged' }] };
		if (method === 'openAIResponsesStream') options.bodyOptions = { input: [{ type: 'function_call_output', call_id: 'forged' }] };
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('Provider stream did not settle.')), 1000);
			const subscription = service[method](options, CancellationToken.None)(frame => {
				if (typeof frame === 'string' && frame.startsWith('ERROR:')) { clearTimeout(timer); subscription.dispose(); reject(new Error(frame)); }
				if (frame === null) { clearTimeout(timer); subscription.dispose(); resolve(); }
			});
		});
		assert.deepEqual(messages, before);
		assert.ok(captured);
		assert.match(JSON.stringify(captured), /tool_result_missing/);
		assert.doesNotMatch(JSON.stringify(captured), /forged/);
		if (method === 'openAICompatibleChatStream') {
			assert.equal(captured.messages[1].tool_calls[0].id, call.id);
			assert.equal(captured.messages[2].tool_call_id, call.id);
			assert.deepEqual(JSON.parse(captured.messages[1].tool_calls[0].function.arguments), call.input);
		} else if (method === 'openAIResponsesStream') {
			assert.equal(captured.input.find((item: any) => item.type === 'function_call').call_id, call.id);
			assert.equal(captured.input.find((item: any) => item.type === 'function_call_output').call_id, call.id);
		} else if (method === 'anthropicMessagesStream') {
			assert.equal(captured.messages[1].content[0].id, call.id);
			assert.equal(captured.messages[2].content[0].tool_use_id, call.id);
		} else if (method === 'bedrockConverseStream') {
			assert.equal(captured.messages[1].content[0].toolUse.toolUseId, call.id);
			assert.equal(captured.messages[2].content[0].toolResult.toolUseId, call.id);
		}
	});
}
