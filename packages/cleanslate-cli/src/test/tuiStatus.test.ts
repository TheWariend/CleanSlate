/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'ink';
import { test } from 'node:test';
import { commandPaletteSelection, estimateCliContextWindowUsage, formatActivityStatus, formatHeaderModeLabel, formatModelTerminationMessage, ModelTerminationNotice, nextInteractiveMode, runtimeModeForInteractiveMode } from '../tui.js';

test('TUI activity status stays concise and hides internal turn details', () => {
	assert.equal(formatActivityStatus('thinking'), 'Thinking…');
	assert.equal(formatActivityStatus('running terminal.execute'), 'Working…');
	assert.equal(formatActivityStatus('provider'), 'Working…');
	assert.equal(formatActivityStatus('cancelling'), 'Cancelling…');
	assert.doesNotMatch(formatActivityStatus('thinking'), /turn|context/i);
});

test('TUI header exposes the active interactive mode', () => {
	assert.equal(formatHeaderModeLabel('planning'), 'PLAN');
	assert.equal(formatHeaderModeLabel('accept-edits'), 'ACCEPT EDITS');
	assert.equal(formatHeaderModeLabel('manual'), 'MANUAL');
});

test('CLI context usage follows the IDE composer calculation', () => {
	const usage = estimateCliContextWindowUsage([
		{ role: 'user', content: 'hi' },
		{ role: 'assistant', content: 'Hello!', renderPayload: { visible: true } }
	], 'next question', 968_000);

	const expectedChars = 'user'.length + 'hi'.length
		+ 'assistant'.length + 'Hello!'.length + JSON.stringify({ visible: true }).length
		+ 'next question'.length;
	assert.equal(usage.usedTokens, Math.ceil(expectedChars / 4));
	assert.equal(usage.maxTokens, 968_000);
	assert.equal(Math.round(usage.percentage), 0);
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

test('Shift+Tab cycles planning, accept-edits, and manual modes', () => {
	assert.equal(nextInteractiveMode('planning'), 'accept-edits');
	assert.equal(nextInteractiveMode('accept-edits'), 'manual');
	assert.equal(nextInteractiveMode('manual'), 'planning');
	assert.equal(runtimeModeForInteractiveMode('planning'), 'planning');
	assert.equal(runtimeModeForInteractiveMode('accept-edits'), 'execution');
	assert.equal(runtimeModeForInteractiveMode('manual'), 'execution');
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
