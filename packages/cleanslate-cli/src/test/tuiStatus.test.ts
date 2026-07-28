/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'ink';
import { test } from 'node:test';
import { commandPaletteSelection, formatActivityStatus, formatHeaderModeLabel, formatModelTerminationMessage, ModelTerminationNotice, nextInteractiveMode } from '../tui.js';

test('TUI activity status stays concise and hides internal turn details', () => {
	assert.equal(formatActivityStatus('thinking'), 'Thinking…');
	assert.equal(formatActivityStatus('running terminal.execute'), 'Working…');
	assert.equal(formatActivityStatus('provider'), 'Working…');
	assert.equal(formatActivityStatus('cancelling'), 'Cancelling…');
	assert.doesNotMatch(formatActivityStatus('thinking'), /turn|context/i);
});

test('TUI header only exposes planning mode', () => {
	assert.equal(formatHeaderModeLabel('execution'), '');
	assert.equal(formatHeaderModeLabel('planning'), 'PLAN');
});

test('command palette executes complete commands with one Enter and keeps argument commands editable', () => {
	assert.deepEqual(commandPaletteSelection({
		id: '/plan',
		label: 'Plan mode',
		description: 'Turn planning mode on'
	}), { value: '/plan', execute: true });
	assert.deepEqual(commandPaletteSelection({
		id: '/model',
		label: 'Set model',
		description: 'Switch model',
		requiresArguments: true
	}), { value: '/model ', execute: false });
});

test('Shift+Tab cycles into and out of planning mode', () => {
	assert.equal(nextInteractiveMode('execution'), 'planning');
	assert.equal(nextInteractiveMode('planning'), 'execution');
});

test('model termination is presented as a dedicated notification with a continuation action', () => {
	const raw = 'Paused EXECUTION after reaching the 8-turn agent safety limit. The task was not marked complete.';
	const output = renderToString(createElement(ModelTerminationNotice, { message: raw }));
	assert.match(output, /Model terminated/);
	assert.match(output, /Enter · Continue/);
	assert.match(output, /8-turn safety limit before finishing/);
	assert.doesNotMatch(output, /Paused EXECUTION/);
	assert.equal(formatModelTerminationMessage('Paused after the same tool call was repeated three times.'), 'The model paused after repeatedly calling the same tool.');
});
