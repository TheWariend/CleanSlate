/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { executeCommandTool, readBackgroundCommandTool, startBackgroundCommandTool } from '../../browser/tools/ExecuteCommandTool.js';
import { CleanSlateToolContext } from '../../browser/tools/types.js';

suite('CleanSlateBackgroundCommandTool', () => {
	test('preserves timeout status from finite command results', async () => {
		const context = {
			workspaceContextService: {
				getWorkspace: () => ({ folders: [] })
			},
			requestCommandApproval: async () => true,
			commandExecutionService: {
				executeCommand: async () => ({
					success: false,
					command: 'npm run build',
					stdout: '',
					stderr: '',
					output: '',
					durationMs: 1000,
					timedOut: true,
					status: 'timeout',
					error: 'Command timed out after 1000ms.'
				})
			}
		} as unknown as CleanSlateToolContext;

		const result = await executeCommandTool.run({
			command: 'npm run build',
			reason: 'verify build',
			timeoutMs: 1000
		}, context);

		assert.strictEqual(result.success, false);
		assert.strictEqual(result.status, 'timeout');
		assert.strictEqual(result.timedOut, true);
	});

	test('streams finite command output through tool progress', async () => {
		const progressEvents: any[] = [];
		const context = {
			workspaceContextService: {
				getWorkspace: () => ({ folders: [] })
			},
			requestCommandApproval: async () => true,
			onProgress: (event: any) => progressEvents.push(event),
			commandExecutionService: {
				executeCommand: async () => {
					throw new Error('Buffered command path should not be used when streaming is available.');
				},
				executeCommandStream: () => {
					const emitter = new Emitter<any | null>();
					setTimeout(() => {
						emitter.fire({
							type: 'started',
							command: 'printf hello',
							startedAt: Date.now()
						});
						emitter.fire({
							type: 'stdout',
							command: 'printf hello',
							chunk: 'hello\n',
							stdout: 'hello\n',
							stderr: '',
							output: 'hello\n',
							durationMs: 8
						});
						emitter.fire({
							type: 'result',
							result: {
								success: true,
								command: 'printf hello',
								stdout: 'hello\n',
								stderr: '',
								output: 'hello\n',
								durationMs: 8,
								timedOut: false,
								exitCode: 0
							}
						});
						emitter.fire(null);
						emitter.dispose();
					}, 0);
					return emitter.event;
				}
			}
		} as unknown as CleanSlateToolContext;

		const result = await executeCommandTool.run({
			command: 'printf hello',
			reason: 'verify streaming',
			intent: 'verification',
			writesToWorkspace: false
		}, context);

		assert.strictEqual(result.success, true);
		assert.strictEqual(result.output, 'hello\n');
		assert.strictEqual(result.status, 'completed');
		assert.strictEqual(progressEvents.length, 2);
		assert.strictEqual(progressEvents[0].type, 'command_status');
		assert.strictEqual(progressEvents[0].status, 'running');
		assert.strictEqual(progressEvents[1].type, 'command_output');
		assert.strictEqual(progressEvents[1].data, 'hello\n');
		assert.strictEqual(progressEvents[1].chunk, 'hello\n');
	});

	test('returns user-cancelled result when finite command approval is rejected', async () => {
		let commandExecuted = false;
		const context = {
			workspaceContextService: {
				getWorkspace: () => ({ folders: [] })
			},
			requestCommandApproval: async () => false,
			commandExecutionService: {
				executeCommand: async () => {
					commandExecuted = true;
					return { success: true };
				}
			}
		} as unknown as CleanSlateToolContext;

		const result = await executeCommandTool.run({
			command: 'npm run build',
			reason: 'verify cancellation',
			intent: 'verification',
			writesToWorkspace: false
		}, context);

		assert.strictEqual(commandExecuted, false);
		assert.strictEqual(result.success, false);
		assert.strictEqual(result.code, 'user_cancelled');
		assert.strictEqual(result.status, 'cancelled');
		assert.strictEqual(result.userCancelled, true);
	});

	test('returns user-cancelled result when background command approval is rejected', async () => {
		let commandStarted = false;
		const context = {
			workspaceContextService: {
				getWorkspace: () => ({ folders: [] })
			},
			requestCommandApproval: async () => false,
			commandExecutionService: {
				startBackgroundCommand: async () => {
					commandStarted = true;
					return { success: true };
				}
			}
		} as unknown as CleanSlateToolContext;

		const result = await startBackgroundCommandTool.run({
			command: 'npm run dev',
			reason: 'start dev server'
		}, context);

		assert.strictEqual(commandStarted, false);
		assert.strictEqual(result.success, false);
		assert.strictEqual(result.code, 'user_cancelled');
		assert.strictEqual(result.status, 'cancelled');
		assert.strictEqual(result.userCancelled, true);
	});

	test('resumes finite command streaming after delayed approval', async () => {
		const progressEvents: any[] = [];
		let approve!: (approved: boolean) => void;
		let streamSubscribed = false;
		const context = {
			workspaceContextService: {
				getWorkspace: () => ({ folders: [] })
			},
			requestCommandApproval: async () => new Promise<boolean>(resolve => {
				approve = resolve;
			}),
			onProgress: (event: any) => progressEvents.push(event),
			commandExecutionService: {
				executeCommandStream: () => {
					streamSubscribed = true;
					const emitter = new Emitter<any | null>();
					setTimeout(() => {
						emitter.fire({
							type: 'started',
							command: 'printf delayed',
							pid: 123,
							startedAt: Date.now()
						});
						emitter.fire({
							type: 'stdout',
							command: 'printf delayed',
							chunk: 'delayed\n',
							stdout: 'delayed\n',
							stderr: '',
							output: 'delayed\n',
							durationMs: 10
						});
						emitter.fire({
							type: 'result',
							result: {
								success: true,
								command: 'printf delayed',
								stdout: 'delayed\n',
								stderr: '',
								output: 'delayed\n',
								durationMs: 10,
								timedOut: false,
								exitCode: 0
							}
						});
						emitter.fire(null);
						emitter.dispose();
					}, 0);
					return emitter.event;
				}
			}
		} as unknown as CleanSlateToolContext;

		const runPromise = executeCommandTool.run({
			command: 'printf delayed',
			reason: 'verify delayed approval',
			intent: 'verification',
			writesToWorkspace: false
		}, context);

		await Promise.resolve();
		assert.strictEqual(streamSubscribed, false);
		approve(true);
		const result = await runPromise;

		assert.strictEqual(streamSubscribed, true);
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.output, 'delayed\n');
		assert.strictEqual(progressEvents[0].type, 'command_status');
		assert.strictEqual(progressEvents[1].type, 'command_output');
	});

	test('reads one managed background command by processId', async () => {
		const calls: string[] = [];
		const context = {
			commandExecutionService: {
				getBackgroundCommand: async (processId: string) => {
					calls.push(`get:${processId}`);
					return {
						success: true,
						processId,
						command: 'npm run dev',
						status: 'ready',
						pid: 12345,
						url: 'http://localhost:3000/',
						stdout: 'ready - started server on 0.0.0.0:3000',
						stderr: '',
						output: 'ready - started server on 0.0.0.0:3000',
						durationMs: 42
					};
				},
				listBackgroundCommands: async () => {
					calls.push('list');
					return [];
				}
			}
		} as unknown as CleanSlateToolContext;

		const result = await readBackgroundCommandTool.run({ processId: ' cmd-1 ' }, context);

		assert.deepStrictEqual(calls, ['get:cmd-1']);
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.processId, 'cmd-1');
		assert.strictEqual(result.status, 'ready');
		assert.strictEqual(result.pid, 12345);
		assert.strictEqual(result.url, 'http://localhost:3000/');
	});

	test('lists retained managed background commands when processId is omitted', async () => {
		const calls: string[] = [];
		const context = {
			workspaceContextService: {
				getWorkspace: () => ({ id: 'test-workspace', folders: [] })
			},
			commandExecutionService: {
				getBackgroundCommand: async (processId: string) => {
					calls.push(`get:${processId}`);
					return { success: false, processId, error: 'Unexpected direct read.' };
				},
				listBackgroundCommands: async () => {
					calls.push('list');
					return [
						{
							success: true,
							processId: 'cmd-1',
							command: 'npm run dev',
							status: 'running',
							pid: 23456,
							url: 'http://localhost:3000/',
							stdout: '',
							stderr: '',
							output: '',
							durationMs: 7
						}
					];
				}
			}
		} as unknown as CleanSlateToolContext;

		const result = await readBackgroundCommandTool.run({}, context);

		assert.deepStrictEqual(calls, ['list']);
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.count, 1);
		assert.strictEqual(result.commands[0].processId, 'cmd-1');
		assert.strictEqual(result.commands[0].status, 'running');
	});
});
