/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { EventEmitter } from 'node:events';

/**
 * The hook itself needs a React renderer to exercise, which this package does
 * not carry for tests. What is worth pinning without one is the contract the
 * hook depends on and the bug it fixes: a resize has to be observable through
 * an event, because reading the dimensions during render cannot see the change.
 */

class FakeStdout extends EventEmitter {
	isTTY = true;
	columns = 80;
	rows = 24;

	resizeTo(columns: number, rows: number): void {
		this.columns = columns;
		this.rows = rows;
		this.emit('resize');
	}
}

describe('terminal resize contract', () => {
	test('a resize is observable through the resize event', () => {
		const stdout = new FakeStdout();
		const seen: string[] = [];
		stdout.on('resize', () => seen.push(`${stdout.columns}x${stdout.rows}`));

		stdout.resizeTo(136, 44);
		stdout.resizeTo(133, 48);

		assert.deepEqual(seen, ['136x44', '133x48']);
	});

	test('dimensions read once are stale after a resize', () => {
		// This is the failure the hook exists to prevent: a value captured at
		// render time keeps the old size, so the frame is laid out for a
		// viewport that no longer exists and the screen is left blank.
		const stdout = new FakeStdout();
		const capturedAtRender = stdout.columns;

		stdout.resizeTo(200, 60);

		assert.equal(capturedAtRender, 80);
		assert.equal(stdout.columns, 200);
		assert.notEqual(capturedAtRender, stdout.columns);
	});

	test('listeners are removable, so a re-render does not stack them', () => {
		const stdout = new FakeStdout();
		const onResize = () => undefined;
		stdout.on('resize', onResize);
		assert.equal(stdout.listenerCount('resize'), 1);
		stdout.off('resize', onResize);
		assert.equal(stdout.listenerCount('resize'), 0);
	});
});
