/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearInteractiveScreen, enterInteractiveScreen } from '../terminalScreen.js';

test('interactive TUI uses an alternate screen and restores terminal state', () => {
	let output = '';
	const stream = {
		isTTY: true,
		write: (value: string) => {
			output += value;
			return true;
		}
	} as NodeJS.WriteStream;
	const originalLog = console.log;
	const leave = enterInteractiveScreen(stream);

	assert.match(output, /\u001b\[\?1049h/);
	assert.notEqual(console.log, originalLog);
	clearInteractiveScreen(stream);
	assert.match(output, /\u001b\[2J\u001b\[H/);

	leave();
	assert.equal(console.log, originalLog);
	assert.match(output, /\u001b\[\?1049l/);
});
