/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { CleanSlateCliAgentRuntime } from '../../../../services/cleanSlate/node/core/cleanSlateCliAgentRuntime.js';
import { CleanSlateCliAgentRuntimeClient } from '../../../../services/cleanSlate/node/core/cleanSlateCliAgentRuntimeClient.js';
import { CleanSlateCommandExecutionService } from '../../../../services/cleanSlate/node/core/cleanSlateCommandExecutionService.js';

suite('CleanSlateCliAgentRuntime', () => {
	test('executes a real shell command and streams output before result', async () => {
		const runtime = new CleanSlateCliAgentRuntime();
		const events: any[] = [];
		try {
			const result = await runtime.executeCommand({
				command: 'printf "hello\\n"'
			}, event => events.push(event));

			assert.strictEqual(result.success, true);
			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.output, 'hello\n');
			assert.strictEqual(events.some(event => event.type === 'started'), true);
			assert.strictEqual(events.some(event => event.type === 'stdout' && event.chunk === 'hello\n'), true);
		} finally {
			runtime.dispose();
		}
	});

	test('keeps long-running dev commands in a CLI-agent background session', async () => {
		const runtime = new CleanSlateCliAgentRuntime();
		try {
			const result = await runtime.startBackgroundCommand({
				command: 'printf "Local: http://localhost:4567\\n"; sleep 30',
				startupTimeoutMs: 1000
			});

			assert.strictEqual(result.success, true);
			assert.strictEqual(result.status, 'ready');
			assert.strictEqual(result.url, 'http://localhost:4567');
			assert.strictEqual(typeof result.processId, 'string');

			const listed = await runtime.listBackgroundCommands();
			assert.strictEqual(listed.some(command => command.processId === result.processId), true);

			const stopped = await runtime.stopBackgroundCommand(result.processId!);
			assert.strictEqual(stopped.success, true);
			assert.strictEqual(stopped.stopped, true);
		} finally {
			runtime.dispose();
		}
	});

	test('captures the reported fallback localhost URL from dev command output', async () => {
		const runtime = new CleanSlateCliAgentRuntime();
		try {
			const result = await runtime.startBackgroundCommand({
				command: 'printf "Port 4567 is in use, using 4568 instead\\nLocal: http://localhost:4568\\nNetwork: http://100.100.100.10:4568\\n"; sleep 30',
				startupTimeoutMs: 1000
			});

			assert.strictEqual(result.success, true);
			assert.strictEqual(result.status, 'ready');
			assert.strictEqual(result.url, 'http://localhost:4568');

			const stopped = await runtime.stopBackgroundCommand(result.processId!);
			assert.strictEqual(stopped.success, true);
		} finally {
			runtime.dispose();
		}
	});

	test('executes through the separate CLI-agent worker process', async () => {
		const client = new CleanSlateCliAgentRuntimeClient();
		const events: any[] = [];
		try {
			const result = await client.executeCommand({
				command: 'printf "agent\\n"'
			}, event => events.push(event));

			assert.strictEqual(result.success, true);
			assert.strictEqual(result.output, 'agent\n');
			assert.strictEqual(events.some(event => event.type === 'started'), true);
			assert.strictEqual(events.some(event => event.type === 'stdout' && event.chunk === 'agent\n'), true);
		} finally {
			client.dispose();
		}
	});

	test('command stream starts independently and replays early events to the first listener', async () => {
		let executed = false;
		const service = new CleanSlateCommandExecutionService({
			executeCommand: async (_options: any, onEvent?: (event: any) => void) => {
				executed = true;
				onEvent?.({
					type: 'started',
					command: 'printf service',
					pid: 123,
					startedAt: Date.now()
				});
				return {
					success: true,
					command: 'printf service',
					stdout: 'service\n',
					stderr: '',
					output: 'service\n',
					durationMs: 1,
					timedOut: false,
					exitCode: 0
				};
			},
			startBackgroundCommand: async () => { throw new Error('not used'); },
			stopBackgroundCommand: async () => { throw new Error('not used'); },
			getBackgroundCommand: async () => { throw new Error('not used'); },
			listBackgroundCommands: async () => { throw new Error('not used'); },
			dispose: () => undefined
		} as any);
		try {
			const events: any[] = [];
			const stream = service.executeCommandStream({ command: 'printf service' }, CancellationToken.None);
			assert.strictEqual(executed, false);

			await Promise.resolve();
			await Promise.resolve();
			assert.strictEqual(executed, true);

			await new Promise<void>(resolve => {
				stream(event => {
					events.push(event);
					if (event === null) {
						resolve();
					}
				});
			});

			assert.strictEqual(events[0].type, 'started');
			assert.strictEqual(events.some(event => event?.type === 'result'), true);
		} finally {
			service.dispose();
		}
	});

	test('finite execute commands are not promoted to background when output contains URLs', async () => {
		const runtime = new CleanSlateCliAgentRuntime();
		const events: any[] = [];
		try {
			const result = await runtime.executeCommand({
				command: 'printf "see https://nextjs.org/docs\\n"; exit 7'
			}, event => events.push(event));

			assert.strictEqual(result.success, false);
			assert.strictEqual(result.status, 'failed');
			assert.strictEqual(result.exitCode, 7);
			assert.strictEqual(result.promotedToBackground, undefined);
			assert.strictEqual(events.some(event => event.type === 'status' && event.status === 'ready'), false);
			assert.match(result.output, /https:\/\/nextjs\.org\/docs/);
		} finally {
			runtime.dispose();
		}
	});
});
