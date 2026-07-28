/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LiveTurnBuffer } from '../liveTurn.js';

test('intermediate model narration is closed as working context before tools', () => {
	const buffer = new LiveTurnBuffer();
	buffer.appendReasoning('Inspecting the repository. ');
	buffer.appendText('I will read the relevant files.');

	assert.equal(
		buffer.flushWorking(),
		'Inspecting the repository. \n\nI will read the relevant files.'
	);
	assert.deepEqual(buffer.snapshot(), { reasoning: '', text: '' });
});

test('final answer chunks remain live and finish in the answer lane', () => {
	const buffer = new LiveTurnBuffer();
	assert.deepEqual(buffer.appendText('The fix '), { reasoning: '', text: 'The fix ' });
	assert.deepEqual(buffer.appendText('is complete.'), { reasoning: '', text: 'The fix is complete.' });
	assert.deepEqual(buffer.finish(), { reasoning: '', answer: 'The fix is complete.' });
});
