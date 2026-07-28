/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	clearInteractiveScreen,
	enterInteractiveScreen,
	isTerminalMouseEvent,
	terminalMouseWheelDirection
} from '../terminalScreen.js';

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
	assert.match(output, /\u001b\[\?1007h/);
	assert.match(output, /\u001b\[\?1000h/);
	assert.match(output, /\u001b\[\?1006h/);
	assert.notEqual(console.log, originalLog);
	clearInteractiveScreen(stream);
	assert.match(output, /\u001b\[2J\u001b\[H/);

	leave();
	assert.equal(console.log, originalLog);
	assert.match(output, /\u001b\[\?1006l/);
	assert.match(output, /\u001b\[\?1000l/);
	assert.match(output, /\u001b\[\?1007l/);
	assert.match(output, /\u001b\[\?1049l/);
});

test('terminal mouse wheel events are decoded for the TUI viewport', () => {
	assert.equal(isTerminalMouseEvent('[<64;20;10M'), true);
	assert.equal(isTerminalMouseEvent('\u001b[<65;20;10M'), true);
	assert.equal(terminalMouseWheelDirection('[<64;20;10M'), -1);
	assert.equal(terminalMouseWheelDirection('[<65;20;10M'), 1);
	assert.equal(terminalMouseWheelDirection('[<68;20;10M'), -1);
	assert.equal(terminalMouseWheelDirection('[<0;20;10M'), 0);
	assert.equal(terminalMouseWheelDirection('hello'), 0);
});
