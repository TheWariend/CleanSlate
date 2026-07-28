/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ICliTranscriptEntry } from '../sessions.js';
import { formatActivityStatus, padTranscriptViewportLines, toggleLatestToolGroup, transcriptViewportLines, visibleTranscriptLines } from '../tui.js';

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
		'▸ Searched ×2 · Read ×2 · Edited main.dart +2 -1 · Checked lints · 1 failed',
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

	const expanded = transcriptViewportLines(tools, 100, tools[0].id);
	assert.equal(expanded.length, 15);
	assert.match(expanded[0].text, /^▾ Searched/);
	assert.match(expanded[3].text, /Read\(lib\/main\.dart\)/);
	assert.match(expanded[5].text, /× Read\(lib\/large\.dart\)/);
	assert.match(expanded[7].text, /Update\(\/workspace\/lib\/main\.dart\)/);
	assert.equal(expanded[10].kind, 'diffDeletion');
});

test('TUI expands only the selected tool group', () => {
	const transcript: ICliTranscriptEntry[] = [
		{ ...entry('old-read', 'tool', 'old.dart'), toolName: 'read_file', status: 'completed' },
		entry('answer', 'assistant', 'Done with the first task.'),
		{ ...entry('new-read', 'tool', 'new.dart'), toolName: 'read_file', status: 'completed' }
	];

	const expanded = transcriptViewportLines(transcript, 100, 'new-read').map(line => line.text);
	assert.equal(expanded.filter(line => line.includes('✓ Read')).length, 1);
	assert.match(expanded[0], /^▸ Read/);
	assert.equal(expanded.some(line => line === '  ✓ Read'), true);
	assert.equal(toggleLatestToolGroup('old-read', transcript), undefined);
	assert.equal(toggleLatestToolGroup(undefined, transcript), 'new-read');
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
	assert.equal(padded.slice(0, 4).every(line => line.kind === 'blank'), true);
	assert.equal(padded.at(-1)?.text, '↳ Done.');
});
