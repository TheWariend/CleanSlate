/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ICliTranscriptEntry } from '../sessions.js';
import {
	diffSyntaxTokens,
	formatActivityStatus,
	formatElapsedTime,
	markdownSegments,
	normalizeTurnProse,
	stripMarkdownHeading,
	padTranscriptViewportLines,
	transcriptToolItemIds,
	transcriptViewportLines,
	visibleTranscriptLines
} from '../tui.js';

function entry(id: string, kind: ICliTranscriptEntry['kind'], content: string): ICliTranscriptEntry {
	return { id, kind, content, timestamp: 0 };
}

test('TUI wraps transcript content into physical terminal rows', () => {
	const transcript = [
		entry('user', 'user', 'inspect this repository and explain the architecture'),
		entry('assistant', 'assistant', Array.from({ length: 80 }, (_, index) => `word-${index}`).join(' '))
	];
	const lines = transcriptViewportLines(transcript, 32);

	assert.ok(lines.length > transcript.length);
	assert.ok(lines.every(line => line.text.length <= 32));
	assert.match(lines.at(-1)?.text ?? '', /word-79/);
});

test('TUI uses compact turn markers without speaker labels', () => {
	const lines = transcriptViewportLines([
		entry('user', 'user', 'hello'),
		entry('assistant', 'assistant', 'Hi! What can I help with?')
	], 80);
	const visibleText = lines.map(line => line.text).filter(Boolean);

	assert.deepEqual(visibleText, ['❯ hello', '↳ Hi! What can I help with?']);
	assert.equal(visibleText.some(line => /^(?:you|cleanslate)\b/i.test(line)), false);
	assert.notEqual(lines[0]?.kind, 'blank');
});

test('TUI renders each tool call in sequence like the IDE transcript', () => {
	const tools: ICliTranscriptEntry[] = [
		{ ...entry('search-1', 'tool', 'completed'), toolName: 'search_workspace', status: 'completed' },
		{ ...entry('search-2', 'tool', 'completed'), toolName: 'grep_search', status: 'completed' },
		{ ...entry('read-1', 'tool', 'lib/main.dart'), toolName: 'read_file', status: 'completed', detail: { input: { path: 'lib/main.dart' }, result: { success: true } } },
		{ ...entry('read-2', 'tool', 'too large'), toolName: 'read_file', status: 'failed', detail: { input: { path: 'lib/large.dart' }, result: { success: false } } },
		{
			...entry('edit-1', 'tool', 'completed'),
			toolName: 'apply_edit',
			status: 'completed',
			detail: {
				input: { file_path: '/workspace/lib/main.dart' },
				result: {
					success: true,
					path: '/workspace/lib/main.dart',
					added: 2,
					deleted: 1,
					diff: [
						'--- a/lib/main.dart',
						'+++ b/lib/main.dart',
						'@@ -1,2 +1,3 @@',
						'-const oldValue = true;',
						'+const newValue = true;',
						'+const enabled = true;'
					].join('\n')
				}
			}
		},
		{ ...entry('lints-1', 'tool', 'clean'), toolName: 'read_lints', status: 'completed' }
	];

	const compact = transcriptViewportLines(tools, 100);
	assert.deepEqual(compact.map(line => line.text), [
		'  ✓ › Searched',
		'  ✓ › Searched',
		'  ✓ › Read(lib/main.dart)',
		'  × › Read(lib/large.dart)',
		'  ✓ › Updated(/workspace/lib/main.dart)',
		'  main.dart  +2 -1',
		'  @@ -1,2 +1,3 @@',
		'     1 - const oldValue = true;',
		'     1 + const newValue = true;',
		'     2 + const enabled = true;',
		'  ✓ › Checked lints(clean)'
	]);
	assert.deepEqual(compact.map(line => line.toolItemId), [
		'search-1',
		'search-2',
		'read-1',
		'read-2',
		'edit-1',
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		'lints-1'
	]);

	const expandedAll = transcriptViewportLines(tools, 100, true);
	assert.equal(new Set(expandedAll.map(line => line.key)).size, expandedAll.length);
	assert.equal(expandedAll.some(line => /Read\(lib\/main\.dart\)/.test(line.text)), true);
	assert.equal(expandedAll.filter(line => /× ⌄ Read\(lib\/large\.dart\)/.test(line.text)).length, 1);
	assert.equal(expandedAll.some(line => /Updated\(\/workspace\/lib\/main\.dart\)/.test(line.text)), true);
	assert.equal(expandedAll.some(line => line.text.includes('└ Input: lib/main.dart')), true);
	assert.equal(expandedAll.filter(line => line.kind === 'diffDeletion').length >= 1, true);

	const expandedOne = transcriptViewportLines(tools, 100, new Set(['read-1']));
	assert.equal(expandedOne.filter(line => line.text.includes('└')).length, 1);
});

test('TUI keeps interleaved tool and answer order intact without grouping', () => {
	const transcript: ICliTranscriptEntry[] = [
		{ ...entry('old-read', 'tool', 'old.dart'), toolName: 'read_file', status: 'completed' },
		entry('answer', 'assistant', 'Done with the first task.'),
		{ ...entry('new-read', 'tool', 'new.dart'), toolName: 'read_file', status: 'completed' }
	];

	const lines = transcriptViewportLines(transcript, 100).map(line => line.text);
	assert.equal(lines.filter(line => /✓ [⌄›] Read/.test(line)).length, 2);
	assert.deepEqual(lines, [
		'  ✓ › Read(old.dart)',
		'',
		'↳ Done with the first task.',
		'  ✓ › Read(new.dart)'
	]);
});

test('TUI expands individual tool rows independently', () => {
	const tools: ICliTranscriptEntry[] = [
		{ ...entry('search', 'tool', '2 matches'), toolName: 'grep_search', status: 'completed' },
		{ ...entry('read', 'tool', 'lib/main.dart'), toolName: 'read_file', status: 'completed', detail: { input: { path: 'lib/main.dart' }, result: { success: true } } }
	];
	const expandedOne = transcriptViewportLines(tools, 100, new Set(['read']), undefined, new Set(['read']));

	assert.deepEqual(transcriptToolItemIds(tools), ['search', 'read']);
	assert.equal(expandedOne.some(line => line.text.includes('└ Input: lib/main.dart')), true);
});

test('TUI formats elapsed labels and tokenizes code in diffs', () => {
	assert.equal(formatElapsedTime(12_400), 'Worked for 12s');
	assert.equal(formatElapsedTime(65_000), 'Worked for 1m 5s');
	const timedAnswer = transcriptViewportLines([
		{ ...entry('answer', 'assistant', 'Done.'), durationMs: 12_400 }
	], 80);
	assert.equal(timedAnswer.at(-1)?.text, '  Worked for 12s');
	const tokens = diffSyntaxTokens('+ const answer = "done"; // saved');
	assert.equal(tokens.some(token => token.kind === 'keyword' && token.text === 'const'), true);
	assert.equal(tokens.some(token => token.kind === 'string' && token.text === '"done"'), true);
	assert.equal(tokens.some(token => token.kind === 'comment'), true);
});

test('TUI styles inline markdown and strips heading markers', () => {
	assert.deepEqual(markdownSegments('plain text'), [{ text: 'plain text' }]);
	assert.deepEqual(markdownSegments('a **bold** b'), [
		{ text: 'a ' },
		{ text: 'bold', bold: true },
		{ text: ' b' }
	]);
	assert.deepEqual(markdownSegments('use `npm run build` now'), [
		{ text: 'use ' },
		{ text: 'npm run build', code: true },
		{ text: ' now' }
	]);

	// A span split across wrapped rows cannot be paired, so it is left verbatim
	// rather than guessed at.
	assert.deepEqual(markdownSegments('an **unclosed span'), [{ text: 'an **unclosed span' }]);

	assert.deepEqual(stripMarkdownHeading('## Mind_Sort'), { text: 'Mind_Sort', isHeading: true });
	assert.deepEqual(stripMarkdownHeading('### Core Features'), { text: 'Core Features', isHeading: true });
	assert.deepEqual(stripMarkdownHeading('not # a heading'), { text: 'not # a heading', isHeading: false });
	assert.deepEqual(stripMarkdownHeading('#nospace'), { text: '#nospace', isHeading: false });
});

// Regression: a streamed turn collects newlines from the model's own text AND from
// LiveTurnBuffer's phase-change separator, so 3-4 consecutive newlines were common and every
// one past the first rendered as an empty row — a visible gap mid-answer.
test('TUI collapses blank-line runs inside a turn to one paragraph break', () => {
	assert.equal(normalizeTurnProse('a\n\n\n\nb'), 'a\n\nb');
	assert.equal(normalizeTurnProse('a\n\nb'), 'a\n\nb', 'a single paragraph break is preserved');
	assert.equal(normalizeTurnProse('a\nb'), 'a\nb', 'a plain line break is preserved');
	assert.equal(normalizeTurnProse('\n\na\n\n'), 'a', 'leading and trailing blanks are trimmed');
	assert.equal(normalizeTurnProse('a\r\n\r\n\r\nb'), 'a\n\nb', 'CRLF is normalised first');

	const rendered = transcriptViewportLines(
		[{ id: 'live', kind: 'assistant', content: 'first para\n\n\n\nsecond para', timestamp: 0 }],
		90
	);
	assert.equal(rendered.filter(line => line.text.trim() === '').length, 1);
});

test('TUI shows Working while tools run and Thinking otherwise', () => {
	assert.equal(formatActivityStatus('running apply_edit'), 'Working…');
	assert.equal(formatActivityStatus('running write_file'), 'Working…');
	assert.equal(formatActivityStatus('running read_file'), 'Working…');
});

test('TUI viewport never renders more rows than its content budget', () => {
	const transcript = [
		entry('assistant', 'assistant', Array.from({ length: 200 }, (_, index) => `token-${index}`).join(' '))
	];
	const visible = visibleTranscriptLines(transcript, 48, 15);
	const scrolled = visibleTranscriptLines(transcript, 48, 15, 10);

	assert.equal(visible.length, 15);
	assert.equal(scrolled.length, 15);
	assert.match(visible.at(-1)?.text ?? '', /token-199/);
	assert.notDeepEqual(scrolled, visible);
});

test('TUI repaints vacated transcript rows when expanded content collapses', () => {
	const visible = transcriptViewportLines([entry('answer', 'assistant', 'Done.')], 80);
	const padded = padTranscriptViewportLines(visible, 6);

	assert.equal(padded.length, 6);
	assert.equal(padded[0]?.text, '↳ Done.');
	assert.equal(padded.slice(1).every(line => line.kind === 'blank'), true);
});
