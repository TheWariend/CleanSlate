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
	test('shares rotated credentials with simultaneous requests and existing/new side chats', async () => {
		let refreshes = 0;
		let valid = 'fresh-1';
		const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
			const token = new Headers(init?.headers).get('Authorization')?.slice(7);
			if (String(input).endsWith('/auth/refresh')) {
				refreshes++;
				await new Promise(resolve => setTimeout(resolve, 10));
				if (token === 'old' && refreshes === 1 || token === 'fresh-1' && valid === 'fresh-2') {
					return Response.json({ token: valid });
				}
				return Response.json({ message: 'revoked' }, { status: 401 });
			}
			return token === valid ? Response.json({ data: { models: [{ id: 'managed', name: 'Managed' }] } })
				: Response.json({ message: 'expired' }, { status: 401 });
		}) as typeof fetch;
		const configuration = createNodeProviderConfiguration({ provider: 'cleanslate', model: 'managed', apiKey: 'old' });
		const runtime = new CleanSlateNodeAgentRuntime({ rootPath: process.cwd(), configuration, fetcher });
		try {
			const existing = runtime.createSideChat({ id: 'before' }).runtime;
			const results = await Promise.all([runtime.getModels(), runtime.getModels(), existing.getModels()]);
			assert.deepEqual(results, [['managed'], ['managed'], ['managed']]);
			assert.equal(refreshes, 1);
			const later = runtime.createSideChat({ id: 'after' }).runtime;
			assert.deepEqual(await later.getModels(), ['managed']);
			valid = 'fresh-2';
			await Promise.all([runtime.getModels(), existing.getModels(), later.getModels()]);
			assert.equal(refreshes, 2);
			await runtime.configureRun(configuration);
			assert.deepEqual(await runtime.getModels(), ['managed']);
			assert.equal(refreshes, 2, 'stale host configuration must resolve the whole rotation chain');
		} finally { runtime.dispose(); }
	});

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
		const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			requests.push(url);
			if (url.endsWith('/auth/refresh')) {
				return new Response(JSON.stringify({ token: 'fresh-token' }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			}
			const rejected = new Headers(init?.headers).get('Authorization') === 'Bearer expired-token';
			return new Response(rejected
				? JSON.stringify({ message: 'expired' })
				: JSON.stringify({ data: { models: [{ id: 'managed-model', name: 'Managed Model' }] } }), {
				status: rejected ? 401 : 200,
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
		await runtime.configureRun(configuration);
		assert.deepEqual(await runtime.getModels(), ['managed-model']);
		assert.equal(requests.filter(url => url.endsWith('/auth/refresh')).length, 1,
			'a stale host snapshot must not overwrite the token refreshed by the headless runtime');
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

	test('creates and closes an isolated side-chat runtime', () => {
		const runtime = new CleanSlateNodeAgentRuntime({
			rootPath: process.cwd(),
			sessionId: 'parent-chat',
			configuration: createNodeProviderConfiguration({
				provider: 'openai',
				model: 'gpt-4o',
				apiKey: 'test'
			})
		});
		const side = runtime.createSideChat({ id: 'side-1', title: 'Quick question' });

		assert.equal(side.runtime === runtime, false);
		assert.deepEqual(runtime.listSideChats(), [{ id: 'side-1', title: 'Quick question', createdAt: side.createdAt }]);
		assert.equal(runtime.getSideChat('side-1')?.runtime, side.runtime);
		assert.equal(runtime.closeSideChat('side-1'), true);
		assert.deepEqual(runtime.listSideChats(), []);
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
		let request: any;
		(runtime as any).mainService.openAICompatibleChatStream = (options: any) => {
			request = options;
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

		assert.equal(runtime.getAvailableToolCount(), 63);
		assert.equal(request.options.tools.some((tool: any) => tool.name === 'prepare_pull_request'), true);
		assert.equal(parts.some(part => part.type === 'chat_text' && part.content === 'All done.' && part.kind === 'final_answer'), true);
		assert.equal(parts.some(part => part.type === 'task_complete'), true);
		runtime.dispose();
	});

	test('ends after a final answer accompanying successful read-only tool work', async () => {
		const runtime = new CleanSlateNodeAgentRuntime({
			rootPath: process.cwd(),
			configuration: createNodeProviderConfiguration({
				provider: 'openai',
				model: 'gpt-4o',
				apiKey: 'test'
			})
		});
		let requestCount = 0;
		(runtime as any).mainService.openAICompatibleChatStream = () => {
			requestCount++;
			const emitter = new Emitter<any>();
			setTimeout(() => {
				emitter.fire('data: {"type":"tool_call","call":{"id":"tool-1","toolName":"read_file","input":{"path":"package.json"}}}\n\n');
				emitter.fire('data: {"type":"text","content":"Inspection complete.","phase":"final_answer"}\n\n');
				emitter.fire(null);
			}, 0);
			return emitter.event;
		};

		const parts: any[] = [];
		for await (const part of runtime.run('Inspect package.json and report.')) {
			parts.push(part);
		}

		assert.equal(requestCount, 1);
		assert.equal(parts.some(part => part.type === 'tool_result' && part.toolName === 'read_file'), true);
		assert.equal(parts.some(part => part.type === 'task_complete'), true);
		runtime.dispose();
	});

	test('carries agent-authored pull request metadata through task completion', () => {
		const runtime = new CleanSlateNodeAgentRuntime({
			rootPath: process.cwd(),
			configuration: createNodeProviderConfiguration({
				provider: 'openai',
				model: 'gpt-4o',
				apiKey: 'test'
			})
		});
		const pullRequest = {
			title: 'Improve recommendation card accessibility',
			body: '## Summary\n\nImprove keyboard navigation.\n\n## Verification\n\n- Tests passed.'
		};
		const part = (runtime as any).queryRunner.enrichCompletion({ type: 'task_complete', result: {} }, {
			touchedPaths: ['src/card.tsx'],
			mutatedPaths: ['src/card.tsx'],
			mutationSummaries: [],
			terminalSummaries: [],
			proofSummaries: ['Tests passed'],
			completionSource: 'host_finalized',
			verificationIssueCount: 0,
			successfulMutationsInPhase: 1,
			pullRequest
		}, []);

		assert.deepEqual(part.result.completionSummary.pullRequest, pullRequest);
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
		// Denied tools still announce themselves before the refusal so UIs can show activity.
		assert.equal(denied[0].type, 'tool_start');
		assert.equal(denied[1].result.code, 'permission_denied');
		runtime.dispose();
	});
});
