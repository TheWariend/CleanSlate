/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'ink';
import { test } from 'node:test';
import { commandPaletteSelection, estimateCliContextWindowUsage, executionInteractiveMode, formatActivityStatus, formatHeaderModeLabel, formatModelTerminationMessage, formatToolNameForDisplay, ModelTerminationNotice, nextInteractiveMode, runtimeModeForInteractiveMode, SHIMMER_FRAME_COUNT, shimmerSegments } from '../tui.js';

test('TUI activity status stays concise and hides internal turn details', () => {
	assert.equal(formatActivityStatus('thinking'), 'Thinking…');
	assert.equal(formatActivityStatus('running terminal.execute'), 'Working…');
	assert.equal(formatActivityStatus('provider'), 'Thinking…');
	assert.equal(formatActivityStatus('cancelling'), 'Cancelling…');
	assert.doesNotMatch(formatActivityStatus('thinking'), /turn|context/i);
});

test('TUI activity labels mirror the IDE working placeholder', () => {
	// Same formatting rules as the IDE's getWorkingPlaceholderLabel: mcp_ becomes “MCP”,
	// snake/kebab segments become title-cased words, and running tools read “Working…”.
	assert.equal(formatToolNameForDisplay('mcp_github_search'), 'MCP Github Search');
	assert.equal(formatToolNameForDisplay('read_file_range'), 'Read File Range');
	assert.equal(formatActivityStatus('running apply_edit'), 'Working…');
});

test('working label shimmers like the IDE placeholder while a turn streams', () => {
	const label = formatActivityStatus('thinking');
	const idle = shimmerSegments(label, 0);
	const mid = shimmerSegments(label, Math.floor(SHIMMER_FRAME_COUNT / 3));
	// The band is a contiguous run of lit characters that travels with the frame instead of
	// leaving the whole label one flat color.
	assert.ok(idle.some(segment => segment.lit));
	assert.notDeepEqual(
		idle.map(segment => segment.lit),
		mid.map(segment => segment.lit),
		'the highlight band should move between frames'
	);
	for (const segments of [idle, mid]) {
		assert.equal(segments.map(segment => segment.text).join(''), label);
	}
	// The animation loops seamlessly: the last frame matches the first.
	assert.deepEqual(
		shimmerSegments(label, SHIMMER_FRAME_COUNT).map(segment => segment.lit),
		idle.map(segment => segment.lit)
	);
});

test('TUI header exposes the active interactive mode', () => {
	assert.equal(formatHeaderModeLabel('planning'), 'PLAN');
	assert.equal(formatHeaderModeLabel('auto'), 'AUTO');
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

test('Shift+Tab cycles planning, auto, and manual modes', () => {
	assert.equal(nextInteractiveMode('planning'), 'auto');
	assert.equal(nextInteractiveMode('auto'), 'manual');
	assert.equal(nextInteractiveMode('manual'), 'planning');
	assert.equal(runtimeModeForInteractiveMode('planning'), 'planning');
	assert.equal(runtimeModeForInteractiveMode('auto'), 'execution');
	assert.equal(runtimeModeForInteractiveMode('manual'), 'execution');
	assert.equal(executionInteractiveMode('default'), 'manual');
	assert.equal(executionInteractiveMode('read-only'), 'manual');
	assert.equal(executionInteractiveMode('full'), 'auto');
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
