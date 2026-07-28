/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commandPaletteSelection, formatActivityStatus, formatHeaderModeLabel, nextInteractiveMode } from '../tui.js';

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
