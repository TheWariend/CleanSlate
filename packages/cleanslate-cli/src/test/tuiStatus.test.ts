/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatActivityStatus, formatHeaderModeLabel } from '../tui.js';

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
