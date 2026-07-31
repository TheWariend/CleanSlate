/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	CleanSlateStreamReveal,
	REVEAL_CEILING_CPS,
	REVEAL_FLOOR_CPS,
	revealCutPoint,
	revealRateForBacklog
} from '../agent/cleanSlateStreamReveal.js';

test('reveal rate rises with backlog but stays bounded', () => {
	assert.equal(revealRateForBacklog(0), REVEAL_FLOOR_CPS);
	assert.ok(revealRateForBacklog(500) > revealRateForBacklog(50), 'a bigger backlog drains faster');
	assert.ok(revealRateForBacklog(1_000_000) <= REVEAL_CEILING_CPS, 'never exceeds the ceiling');
	// Sub-linear: a 100x backlog must not give a 100x rate, or the text snaps to the end.
	assert.ok(revealRateForBacklog(10_000) < revealRateForBacklog(100) * 100);
});

test('the cut never lands inside a word, and never goes backwards', () => {
	const text = 'the quick brown fox jumps over the lazy dog';
	const cut = revealCutPoint(text, 0, 100);
	assert.ok(cut > 0 && cut <= text.length);
	// Either it consumed everything, or it stopped on whitespace.
	assert.ok(cut === text.length || /\s/.test(text[cut - 1]), `cut landed mid-word at ${cut}`);
	assert.equal(revealCutPoint(text, text.length, 100), text.length, 'caught up stays caught up');
});

// Regression: providers flush in bursts (measured: 24 of 27 deltas in the same millisecond),
// so a surface that renders each delta as it lands shows a paragraph appearing all at once.
test('a burst is revealed progressively, not all at once', () => {
	const burst = 'word '.repeat(120).trim();
	const reveal = new CleanSlateStreamReveal();

	const first = reveal.advance(burst);
	assert.ok(first.length > 0, 'something is revealed immediately');
	assert.ok(first.length < burst.length, 'but not the whole burst in one tick');
	assert.equal(reveal.hasCaughtUp(burst), false);

	// Successive ticks make progress and never regress.
	let previous = first.length;
	for (let i = 0; i < 5; i++) {
		const next = reveal.advance(burst).length;
		assert.ok(next >= previous, 'reveal never goes backwards');
		previous = next;
	}

	assert.equal(reveal.advance(burst, true), burst, 'flush reveals everything');
	assert.equal(reveal.hasCaughtUp(burst), true);
});

test('an edit rather than an append is detected so the caller can restart', () => {
	const reveal = new CleanSlateStreamReveal();
	assert.equal(reveal.isContinuationOf('hello world', 'hello'), true);
	assert.equal(reveal.isContinuationOf('goodbye', 'hello'), false);
});
