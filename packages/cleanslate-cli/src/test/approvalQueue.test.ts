/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { ApprovalQueue } from '../approvalQueue.js';

test('aborting a turn releases queued approvals and rejects already cancelled requests', async () => {
	const queue = new ApprovalQueue<string>(() => {});
	const controller = new AbortController();
	const first = queue.request('first', controller.signal);
	const second = queue.request('second', controller.signal);
	controller.abort();
	assert.deepEqual(await Promise.all([first, second]), [false, false]);
	assert.equal(await queue.request('late', controller.signal), false);
});

test('concurrent parent and worker approvals are presented and resolved in order', async () => {
	const shown: Array<string | undefined> = [];
	const queue = new ApprovalQueue<string>(request => shown.push(request));
	const parent = queue.request('parent command');
	const worker = queue.request('worker command');
	const edit = queue.request('worker edit');
	assert.deepEqual(shown, ['parent command']);
	queue.decide(true);
	assert.equal(await parent, true);
	assert.equal(shown.at(-1), 'worker command');
	queue.decide(false);
	assert.equal(await worker, false);
	assert.equal(shown.at(-1), 'worker edit');
	queue.decide(true);
	assert.equal(await edit, true);
	assert.equal(shown.at(-1), undefined);
});

test('cancellation settles every pending request without approving commands', async () => {
	const queue = new ApprovalQueue<string>(() => {});
	const first = queue.request('first');
	const second = queue.request('second');
	queue.cancel();
	assert.deepEqual(await Promise.all([first, second]), [false, false]);
	const next = queue.request('next');
	queue.decide(true);
	assert.equal(await next, true);
});
