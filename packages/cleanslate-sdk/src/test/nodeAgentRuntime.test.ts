/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Emitter } from '../core/event.js';
import { CleanSlateNodeAgentRuntime, createNodeProviderConfiguration } from '../node/cleanSlateNodeAgentRuntime.js';
import { getCleanSlateContextDefaults } from '../protocol/cleanSlateModelCapabilities.js';

describe('CleanSlateNodeAgentRuntime', () => {
	test('uses the same model context defaults as the IDE configuration', () => {
		const configuration = createNodeProviderConfiguration({
			provider: 'cleanslate',
			model: 'deepseek-v4-flash',
			reasoningLevel: 'low'
		});
		const expected = getCleanSlateContextDefaults({
			provider: 'cleanslate',
			model: 'deepseek-v4-flash',
			planMode: false,
			reasoningLevel: 'low'
		});

		assert.equal(configuration.modelContextWindow, 1_000_000);
		assert.equal(configuration.contextWindow, expected.contextWindowTokens);
		assert.equal(configuration.modelContextWindow, expected.modelContextWindowTokens);
		assert.equal(configuration.maxInputTokens, expected.maxInputTokens);
		assert.equal(configuration.autoCompactReserveTokens, expected.autoCompactReserveTokens);
		assert.equal(configuration.fileTruncation, expected.fileTruncationChars);
		assert.equal(configuration.globalContextBudget, expected.globalContextBudgetChars);
	});

	test('loads CleanSlate managed models and persists a refreshed account token', async () => {
		const requests: string[] = [];
		let refreshedToken: string | undefined;
		const fetcher = (async (input: string | URL | Request) => {
			const url = String(input);
			requests.push(url);
			if (url.endsWith('/auth/refresh')) {
				return new Response(JSON.stringify({ token: 'fresh-token' }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			}
			const entitlementAttempt = requests.filter(value => value.endsWith('/entitlements')).length;
			return new Response(entitlementAttempt === 1
				? JSON.stringify({ message: 'expired' })
				: JSON.stringify({ data: { models: [{ id: 'managed-model', name: 'Managed Model' }] } }), {
				status: entitlementAttempt === 1 ? 401 : 200,
				headers: { 'Content-Type': 'application/json' }
			});
		}) as typeof fetch;
		const configuration = createNodeProviderConfiguration({
			provider: 'cleanslate',
			model: 'managed-model',
			apiKey: 'expired-token'
		});
		assert.equal(configuration.ragEnabled, false);
		assert.equal(configuration.embeddingProvider, undefined);
		const runtime = new CleanSlateNodeAgentRuntime({
			rootPath: process.cwd(),
			configuration,
			fetcher,
			onManagedTokenRefresh: token => { refreshedToken = token; }
		});

		assert.deepEqual(await runtime.getModels(), ['managed-model']);
		assert.equal(refreshedToken, 'fresh-token');
		assert.equal(requests.some(url => url.endsWith('/auth/refresh')), true);
		runtime.dispose();
	});

	test('the Node host refuses commands when no approval policy is supplied', async () => {
		const configuration = createNodeProviderConfiguration({
			provider: 'openai',
			model: 'gpt-4o',
			apiKey: 'test'
		});
		assert.equal(configuration.ragEnabled, true);
		assert.equal(configuration.embeddingProvider, 'openai');
		assert.equal(configuration.embeddingModel, 'text-embedding-3-small');
		const runtime = new CleanSlateNodeAgentRuntime({
			rootPath: process.cwd(),
			configuration
		});
		const context = (runtime as any).headlessRuntime.getToolContext();
		assert.equal(await context.requestCommandApproval({ command: 'echo unsafe' }), false);
		runtime.dispose();
	});

	test('runs the existing agent loop with the complete tool registry', async () => {
		const runtime = new CleanSlateNodeAgentRuntime({
			rootPath: process.cwd(),
			configuration: createNodeProviderConfiguration({
				provider: 'openai',
				model: 'gpt-4o',
				apiKey: 'test'
			})
		});
		(runtime as any).mainService.openAICompatibleChatStream = () => {
			const emitter = new Emitter<any>();
			setTimeout(() => {
				emitter.fire('data: {"type":"text","content":"All done.","phase":"final_answer"}\n\n');
				emitter.fire(null);
			}, 0);
			return emitter.event;
		};

		const parts: any[] = [];
		for await (const part of runtime.run('Answer without changing files.')) {
			parts.push(part);
		}

		assert.equal(runtime.getAvailableToolCount(), 59);
		assert.equal(parts.some(part => part.type === 'chat_text' && part.content === 'All done.' && part.kind === 'final_answer'), true);
		assert.equal(parts.some(part => part.type === 'task_complete'), true);
		runtime.dispose();
	});

	test('keeps native provider history across turns and snapshot restore', async () => {
		const createRuntime = () => new CleanSlateNodeAgentRuntime({
			rootPath: process.cwd(),
			sessionId: 'persistent-test',
			configuration: createNodeProviderConfiguration({
				provider: 'openai',
				model: 'gpt-4o',
				apiKey: 'test'
			})
		});
		const runtime = createRuntime();
		const requests: any[] = [];
		let response = 'First answer.';
		(runtime as any).mainService.openAICompatibleChatStream = (options: any) => {
			requests.push(options);
			const emitter = new Emitter<any>();
			setTimeout(() => {
				emitter.fire(`data: {"type":"text","content":${JSON.stringify(response)}}\n\n`);
				emitter.fire(null);
			}, 0);
			return emitter.event;
		};

		for await (const _part of runtime.run('First question')) { /* consume */ }
		response = 'Second answer.';
		for await (const _part of runtime.run('Second question')) { /* consume */ }

		assert.equal(requests.length, 2);
		assert.equal(requests[1].messages.some((message: any) =>
			message.role === 'assistant' && JSON.stringify(message.content).includes('First answer.')), true);
		assert.equal(requests[1].messages.some((message: any) =>
			message.role === 'user' && JSON.stringify(message.content).includes('Second question')), true);

		const snapshot = runtime.getSessionSnapshot();
		runtime.dispose();
		const restored = createRuntime();
		restored.restoreSessionSnapshot(snapshot);
		assert.equal(restored.getSessionSnapshot().agent?.messages.length, snapshot.agent?.messages.length);
		assert.equal(restored.getSessionSnapshot().threadHistory.at(-1)?.content, 'Second answer.');
		restored.dispose();
	});

	test('runs the native planning phase with write tools filtered', async () => {
		const runtime = new CleanSlateNodeAgentRuntime({
			rootPath: process.cwd(),
			configuration: createNodeProviderConfiguration({
				provider: 'openai',
				model: 'gpt-4o',
				apiKey: 'test'
			})
		});
		let request: any;
		(runtime as any).mainService.openAICompatibleChatStream = (options: any) => {
			request = options;
			const emitter = new Emitter<any>();
			setTimeout(() => {
				emitter.fire('data: {"type":"text","content":"Plan ready."}\n\n');
				emitter.fire(null);
			}, 0);
			return emitter.event;
		};
		for await (const _part of runtime.plan('Plan a safe refactor')) { /* consume */ }
		const names = request.options.tools.map((tool: any) => tool.name);
		assert.equal(names.includes('write_file'), false);
		assert.equal(names.includes('apply_edit'), false);
		assert.equal(names.includes('submit_artifact'), true);
		runtime.dispose();
	});

	test('injects deterministic host context and enforces the host tool policy', async () => {
		const runtime = new CleanSlateNodeAgentRuntime({
			rootPath: process.cwd(),
			configuration: createNodeProviderConfiguration({
				provider: 'openai',
				model: 'gpt-4o',
				apiKey: 'test'
			}),
			additionalContext: task => `Project rule for: ${task}`,
			resolveAttachments: () => [{ type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } }],
			approveTool: request => request.toolName !== 'list_dir'
		});
		let request: any;
		(runtime as any).mainService.openAICompatibleChatStream = (options: any) => {
			request = options;
			const emitter = new Emitter<any>();
			setTimeout(() => {
				emitter.fire('data: {"type":"text","content":"Done."}\n\n');
				emitter.fire(null);
			}, 0);
			return emitter.event;
		};
		for await (const _part of runtime.run('Inspect safely')) { /* consume */ }
		assert.equal(request.messages.some((message: any) =>
			JSON.stringify(message.content).includes('Project rule for: Inspect safely')), true);
		assert.equal(request.messages.some((message: any) =>
			JSON.stringify(message.content).includes('headless Node workspace')), false);
		assert.equal(request.messages.some((message: any) =>
			JSON.stringify(message.content).includes('data:image/png;base64,iVBORw0KGgo=')), true);

		const denied: any[] = [];
		for await (const part of (runtime as any).headlessRuntime.executeTool('list_dir', { path: '.' }, 'call-1')) {
			denied.push(part);
		}
		assert.equal(denied[0].result.code, 'permission_denied');
		runtime.dispose();
	});
});
