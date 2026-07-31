/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import {
	clearInteractiveScreen,
	enterInteractiveScreen,
	isTerminalMouseEvent,
	suppressEngineLogs,
	terminalMouseEvent,
	terminalMouseWheelDirection
} from '../terminalScreen.js';

// Regression: the chat TUI renders WITHOUT the alternate screen so the terminal keeps its native
// scrollback. Engine-log suppression used to be bundled inside enterInteractiveScreen, so dropping
// that call let `[CleanSlateAgent] …` writes land mid-frame and corrupt Ink's layout.
test('engine logs can be suppressed without entering the alternate screen', () => {
	const realLog = console.log;
	const realWarn = console.warn;
	const seen: string[] = [];
	const spyLog = (...data: unknown[]) => { seen.push(String(data[0])); };
	const spyWarn = (...data: unknown[]) => { seen.push(String(data[0])); };
	console.log = spyLog;
	console.warn = spyWarn;

	try {
		const restore = suppressEngineLogs();
		assert.notEqual(console.log, spyLog, 'suppression must wrap the active console.log');

		console.log('[CleanSlateAgent] [EXECUTION] Starting query turn 1...');
		console.warn('[CleanSlateAgent] noisy warning');
		console.log('a message the user should still see');
		restore();

		assert.deepEqual(seen, ['a message the user should still see']);
		// Restoring puts back whatever was installed when suppression began.
		assert.equal(console.log, spyLog);
		assert.equal(console.warn, spyWarn);
	} finally {
		console.log = realLog;
		console.warn = realWarn;
	}
});

test('interactive TUI preserves mouse selection while using an alternate screen', () => {
	let output = '';
	const events = new EventEmitter();
	const stream = Object.assign(events, {
		isTTY: true as const,
		write: (value: string) => {
			output += value;
			return true;
		}
	}) as NodeJS.WriteStream;
	const originalLog = console.log;
	const leave = enterInteractiveScreen(stream);

	assert.match(output, /\u001b\[\?1049h/);
	assert.match(output, /\u001b\[\?1007h/);
	assert.doesNotMatch(output, /\u001b\[\?1000h/);
	assert.doesNotMatch(output, /\u001b\[\?1006h/);
	assert.match(output, /\u001b\[\?1000l/);
	assert.match(output, /\u001b\[\?1006l/);
	assert.notEqual(console.log, originalLog);
	clearInteractiveScreen(stream);
	assert.match(output, /\u001b\[2J\u001b\[H/);
	const clearsBeforeResize = output.match(/\u001b\[2J\u001b\[H/g)?.length ?? 0;
	stream.emit('resize');
	assert.equal(output.match(/\u001b\[2J\u001b\[H/g)?.length, clearsBeforeResize + 1);

	leave();
	const outputAfterLeave = output;
	stream.emit('resize');
	assert.equal(output, outputAfterLeave);
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

test('terminal mouse clicks retain coordinates and press state', () => {
	assert.deepEqual(terminalMouseEvent('[<0;42;17M'), {
		button: 0,
		x: 42,
		y: 17,
		action: 'press',
		wheelDirection: 0
	});
	assert.equal(terminalMouseEvent('[<0;42;17m')?.action, 'release');
	assert.equal(terminalMouseEvent('hello'), undefined);
});
