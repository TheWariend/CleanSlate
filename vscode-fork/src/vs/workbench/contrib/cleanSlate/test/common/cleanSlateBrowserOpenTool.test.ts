/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { browserClickTool, browserDiagnosticsTool, browserFillTool, browserOpenTool, browserSnapshotTool, browserTabsTool } from '@cleanslate/sdk/tools/BrowserAutomationTools.js';
import { CleanSlateToolContext } from '@cleanslate/sdk/tools/types.js';

suite('CleanSlateBrowserOpenTool', () => {
	const workspaceContextService = {
		getWorkspace: () => ({ id: 'test-workspace', folders: [] })
	};

	test('requires a URL', async () => {
		const context = {
			workspaceContextService,
			browserAutomationService: {
				open: async () => {
					throw new Error('should not open without a URL');
				}
			},
			commandExecutionService: {
				listBackgroundCommands: async () => []
			}
		} as unknown as CleanSlateToolContext;

		const result = await browserOpenTool.run({}, context);

		assert.strictEqual(result.success, false);
		assert.strictEqual(result.error, 'browser_open requires a URL.');
	});

	test('rejects about blank', async () => {
		const context = {
			workspaceContextService,
			browserAutomationService: {
				open: async () => {
					throw new Error('should not open about:blank');
				}
			},
			commandExecutionService: {
				listBackgroundCommands: async () => []
			}
		} as unknown as CleanSlateToolContext;

		const result = await browserOpenTool.run({ url: 'about:blank' }, context);

		assert.strictEqual(result.success, false);
		assert.match(result.error, /not about:blank/);
	});

	test('opens active localhost background URL when requested port is stale', async () => {
		const openedUrls: string[] = [];
		const context = {
			workspaceContextService,
			browserAutomationService: {
				open: async (url: string) => {
					openedUrls.push(url);
					return {
						success: true,
						viewId: 'browser',
						url,
						title: '',
						loading: false
					};
				}
			},
			commandExecutionService: {
				listBackgroundCommands: async () => [
					{
						success: true,
						processId: 'cmd-1',
						command: 'npm run dev',
						status: 'ready',
						pid: 123,
						url: 'http://localhost:4181/',
						stdout: '',
						stderr: '',
						output: 'Local: http://localhost:4181/',
						durationMs: 50
					}
				]
			}
		} as unknown as CleanSlateToolContext;

		const result = await browserOpenTool.run({
			url: 'http://localhost:4180/dashboard?tab=theme#preview'
		}, context);

		assert.deepStrictEqual(openedUrls, [
			'http://localhost:4181/dashboard?tab=theme#preview'
		]);
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.url, 'http://localhost:4181/dashboard?tab=theme#preview');
		assert.strictEqual(result.requestedUrl, 'http://localhost:4180/dashboard?tab=theme#preview');
		assert.strictEqual(result.resolvedUrl, 'http://localhost:4181/dashboard?tab=theme#preview');
	});

	test('uses localhost URL from background output when command url is missing', async () => {
		const openedUrls: string[] = [];
		const context = {
			workspaceContextService,
			browserAutomationService: {
				open: async (url: string) => {
					openedUrls.push(url);
					return {
						success: true,
						viewId: 'browser',
						url,
						title: '',
						loading: false
					};
				}
			},
			commandExecutionService: {
				listBackgroundCommands: async () => [
					{
						success: true,
						processId: 'cmd-1',
						command: 'project dev',
						status: 'ready',
						pid: 123,
						stdout: '',
						stderr: '',
						output: 'Port 4180 is in use, using 4181 instead\nLocal: http://localhost:4181/',
						durationMs: 50
					}
				]
			}
		} as unknown as CleanSlateToolContext;

		const result = await browserOpenTool.run({ url: 'http://localhost:4180/' }, context);

		assert.deepStrictEqual(openedUrls, ['http://localhost:4181/']);
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.url, 'http://localhost:4181/');
		assert.strictEqual(result.requestedUrl, 'http://localhost:4180/');
		assert.strictEqual(result.resolvedUrl, 'http://localhost:4181/');
	});

	test('opens active localhost URL when it matches the managed background URL', async () => {
		const openedUrls: string[] = [];
		const context = {
			workspaceContextService,
			browserAutomationService: {
				open: async (url: string) => {
					openedUrls.push(url);
					return {
						success: true,
						viewId: 'browser',
						url,
						title: '',
						loading: false
					};
				}
			},
			commandExecutionService: {
				listBackgroundCommands: async () => [
					{
						success: true,
						processId: 'cmd-1',
						command: 'npm run dev',
						status: 'ready',
						pid: 123,
						url: 'http://localhost:4180/',
						stdout: '',
						stderr: '',
						output: 'Local: http://localhost:4180/',
						durationMs: 50
					}
				]
			}
		} as unknown as CleanSlateToolContext;

		const result = await browserOpenTool.run({ url: 'http://localhost:4180/' }, context);

		assert.deepStrictEqual(openedUrls, ['http://localhost:4180/']);
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.url, 'http://localhost:4180/');
	});

	test('opens explicit localhost when no managed background URL is available', async () => {
		const openedUrls: string[] = [];
		const context = {
			workspaceContextService,
			browserAutomationService: {
				open: async (url: string) => {
					openedUrls.push(url);
					return {
						success: true,
						viewId: 'browser',
						url,
						title: '',
						loading: false
					};
				}
			},
			commandExecutionService: {
				listBackgroundCommands: async () => []
			}
		} as unknown as CleanSlateToolContext;

		const result = await browserOpenTool.run({ url: 'http://localhost:4180/' }, context);

		assert.deepStrictEqual(openedUrls, ['http://localhost:4180/']);
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.url, 'http://localhost:4180/');
		assert.match(result.warning, /explicit localhost URL/);
	});

	test('opens non-local URL without managed background command', async () => {
		const openedUrls: string[] = [];
		const context = {
			browserAutomationService: {
				open: async (url: string) => {
					openedUrls.push(url);
					return {
						success: true,
						viewId: 'browser',
						url,
						title: '',
						loading: false
					};
				}
			},
			commandExecutionService: {
				listBackgroundCommands: async () => []
			}
		} as unknown as CleanSlateToolContext;

		const result = await browserOpenTool.run({ url: 'https://thewariend.com/' }, context);

		assert.deepStrictEqual(openedUrls, ['https://thewariend.com/']);
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.url, 'https://thewariend.com/');
	});

	test('routes browser_open to Agent Manager surface', async () => {
		const openedUrls: string[] = [];
		const context = {
			surface: 'agentManager',
			browserAutomationService: {
				open: async () => {
					throw new Error('should not open IDE browser for Agent Manager context');
				},
				openInAgentManager: async (url: string) => {
					openedUrls.push(url);
					return {
						success: true,
						surface: 'agentManager',
						viewId: 'agent-browser',
						url,
						title: '',
						loading: false
					};
				}
			},
			commandExecutionService: {
				listBackgroundCommands: async () => []
			}
		} as unknown as CleanSlateToolContext;

		const result = await browserOpenTool.run({ url: 'https://thewariend.com/' }, context);

		assert.deepStrictEqual(openedUrls, ['https://thewariend.com/']);
		assert.strictEqual(result.surface, 'agentManager');
		assert.strictEqual(result.viewId, 'agent-browser');
	});

	test('routes browser actions by tool context surface', async () => {
		const surfaces: string[] = [];
		const context = {
			surface: 'agentManager',
			browserAutomationService: {
				snapshot: async (surface: string, options: { limit?: number }) => {
					surfaces.push(`${surface}:${options.limit}`);
					return {
						success: true,
						surface,
						viewId: 'agent-browser',
						url: 'https://thewariend.com/',
						title: '',
						loading: false,
						viewport: { width: 1, height: 1, devicePixelRatio: 1 },
						bodyText: '',
						elements: []
					};
				}
			}
		} as unknown as CleanSlateToolContext;

		const result = await browserSnapshotTool.run({ limit: 3 }, context);

		assert.deepStrictEqual(surfaces, ['agentManager:3']);
		assert.strictEqual(result.surface, 'agentManager');
	});

	test('forwards semantic locators to the live browser surface without reducing them to coordinates', async () => {
		const calls: Array<{ surface: string; input: unknown }> = [];
		const context = {
			surface: 'agentManager',
			sessionId: 'session-7',
			browserAutomationService: {
				click: async (surface: string, input: unknown) => {
					calls.push({ surface, input });
					return { success: true, surface, action: 'click' };
				},
				fill: async (surface: string, input: unknown) => {
					calls.push({ surface, input });
					return { success: true, surface, action: 'fill' };
				}
			}
		} as unknown as CleanSlateToolContext;

		await browserClickTool.run({ role: 'button', name: 'Save', exact: true }, context);
		await browserFillTool.run({ label: 'Email', value: 'person@example.com' }, context);

		assert.deepStrictEqual(calls, [
			{ surface: 'agentManager:session-7', input: { role: 'button', name: 'Save', exact: true } },
			{ surface: 'agentManager:session-7', input: { label: 'Email', value: 'person@example.com' } }
		]);
	});

	test('reads tabs and diagnostics from the same bound browser surface', async () => {
		const surfaces: string[] = [];
		const context = {
			surface: 'ide',
			browserAutomationService: {
				listTabs: async (surface: string) => {
					surfaces.push(`tabs:${surface}`);
					return { success: true, tabs: [{ id: 'tab-1', url: 'https://example.com/', title: 'Example', active: true }] };
				},
				getDiagnostics: async (surface: string) => {
					surfaces.push(`diagnostics:${surface}`);
					return { success: true, console: [], network: [], downloads: [] };
				}
			}
		} as unknown as CleanSlateToolContext;

		const tabs = await browserTabsTool.run({}, context);
		const diagnostics = await browserDiagnosticsTool.run({}, context);

		assert.strictEqual(tabs.tabs[0].active, true);
		assert.deepStrictEqual(diagnostics.downloads, []);
		assert.deepStrictEqual(surfaces, ['tabs:ide', 'diagnostics:ide']);
	});
});
