/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CleanSlateAgentExtensionHost, type ICleanSlateAgentExtensionRun } from '../agent/cleanSlateAgentExtensions.js';

const run: ICleanSlateAgentExtensionRun = {
	sessionId: 'session', runId: 'run', entryPoint: 'run', task: 'test', startedAt: 1
};

test('agent extensions receive only explicitly granted capabilities', async () => {
	const calls: string[] = [];
	const host = new CleanSlateAgentExtensionHost([{
		apiVersion: 1,
		id: 'example',
		permissions: ['context:read', 'stream:read'],
		provideContext: () => { calls.push('context'); return 'remember this'; },
		onRunStart: () => { calls.push('start'); }
	}], { grantedPermissions: { example: ['context:read'] } });

	assert.equal(await host.provideContext(run), 'remember this');
	await host.start(run);
	assert.deepEqual(calls, ['context']);
});

test('stream lifecycle is ordered and extension failures do not stop the run', async () => {
	const calls: string[] = [];
	const errors: string[] = [];
	const host = new CleanSlateAgentExtensionHost([{
		apiVersion: 1,
		id: 'observer',
		permissions: ['stream:read'],
		onRunStart: () => { calls.push('start'); },
		onStreamPart: (_run, part) => { calls.push(part.type); throw new Error('offline'); },
		onRunEnd: (_run, outcome) => { calls.push(outcome.status); }
	}], {
		grantedPermissions: { observer: ['stream:read'] },
		onError: event => errors.push(`${event.extensionId}:${event.hook}`)
	});

	await host.start(run);
	await host.stream(run, { type: 'chat_text', content: 'hello' });
	await host.end(run, { status: 'completed', endedAt: 2 });
	assert.deepEqual(calls, ['start', 'chat_text', 'completed']);
	assert.deepEqual(errors, ['observer:onStreamPart']);
});

test('rejects unsupported versions and duplicate IDs', () => {
	assert.throws(() => new CleanSlateAgentExtensionHost([
		{ apiVersion: 2 as 1, id: 'future', permissions: [] }
	], { grantedPermissions: {} }), /Unsupported/);
	assert.throws(() => new CleanSlateAgentExtensionHost([
		{ apiVersion: 1, id: 'same', permissions: [] },
		{ apiVersion: 1, id: 'same', permissions: [] }
	], { grantedPermissions: {} }), /unique/);
});
