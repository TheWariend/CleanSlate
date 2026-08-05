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
	transcriptToolGroupIds,
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

test('TUI keeps compact tool activity inline and expands every call on demand', () => {
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
		'● › Searched ×2 · Read ×2 · Edited main.dart +2 -1 · Checked lints · 1 failed',
		'  main.dart  +2 -1',
		'  @@ -1,2 +1,3 @@',
		'     1 - const oldValue = true;',
		'     1 + const newValue = true;',
		'     2 + const enabled = true;'
	]);
	assert.deepEqual(compact.slice(1).map(line => line.kind), [
		'diffHeader',
		'diffHunk',
		'diffDeletion',
		'diffAddition',
		'diffAddition'
	]);

	const expanded = transcriptViewportLines(tools, 100, true);
	assert.equal(expanded.length, 30);
	assert.equal(new Set(expanded.map(line => line.key)).size, expanded.length);
	assert.equal(expanded.some(line => /Read\(lib\/main\.dart\)/.test(line.text)), true);
	assert.equal(expanded.some(line => /× ⌄ Read\(lib\/large\.dart\)/.test(line.text)), true);
	assert.equal(expanded.some(line => /Update\(\/workspace\/lib\/main\.dart\)/.test(line.text)), true);
	assert.equal(expanded.filter(line => line.kind === 'diffDeletion').length >= 1, true);
});

test('TUI details mode expands tool groups without reordering the transcript', () => {
	const transcript: ICliTranscriptEntry[] = [
		{ ...entry('old-read', 'tool', 'old.dart'), toolName: 'read_file', status: 'completed' },
		entry('answer', 'assistant', 'Done with the first task.'),
		{ ...entry('new-read', 'tool', 'new.dart'), toolName: 'read_file', status: 'completed' }
	];

	const expanded = transcriptViewportLines(transcript, 100, true).map(line => line.text);
	assert.equal(expanded.filter(line => /✓ [⌄›] Read/.test(line)).length, 2);
	assert.equal(expanded[0], '● ⌄ Read');
	assert.equal(expanded[3], '');
	assert.equal(expanded[4], '↳ Done with the first task.');
	assert.equal(expanded[5], '● ⌄ Read');
});

test('TUI expands tool groups and individual tool results independently', () => {
	const tools: ICliTranscriptEntry[] = [
		{ ...entry('search', 'tool', '2 matches'), toolName: 'grep_search', status: 'completed' },
		{ ...entry('read', 'tool', 'lib/main.dart'), toolName: 'read_file', status: 'completed', detail: { input: { path: 'lib/main.dart' }, result: { success: true } } }
	];
	const groups = new Set(['group:search']);
	const groupOnly = transcriptViewportLines(tools, 100, groups, 'read');
	const withRead = transcriptViewportLines(tools, 100, groups, undefined, new Set(['read']));

	assert.deepEqual(transcriptToolGroupIds(tools), ['group:search']);
	assert.deepEqual(transcriptToolItemIds(tools, groups), ['group:search', 'search', 'read']);
	assert.equal(groupOnly.some(line => line.text.includes('└ lib/main.dart')), false);
	assert.equal(withRead.some(line => line.text.includes('└ lib/main.dart')), false);
	assert.equal(withRead.some(line => line.toolItemId === 'read'), true);
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

test('TUI exposes active edit tools as editing activity', () => {
	assert.equal(formatActivityStatus('running apply_edit'), 'Editing…');
	assert.equal(formatActivityStatus('running write_file'), 'Editing…');
	assert.equal(formatActivityStatus('running read_file'), 'Reading…');
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
