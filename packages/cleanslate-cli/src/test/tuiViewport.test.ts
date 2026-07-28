/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ICliTranscriptEntry } from '../sessions.js';
import { transcriptViewportLines, visibleTranscriptLines } from '../tui.js';

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
				result: { success: true, path: '/workspace/lib/main.dart', added: 2, deleted: 1 }
			}
		},
		{ ...entry('lints-1', 'tool', 'clean'), toolName: 'read_lints', status: 'completed' }
	];

	const compact = transcriptViewportLines(tools, 100);
	assert.deepEqual(compact.map(line => line.text), ['● Searched ×2 · Read ×2 · Edited main.dart +2 -1 · Checked lints · 1 failed']);

	const expanded = transcriptViewportLines(tools, 100, true);
	assert.equal(expanded.length, 6);
	assert.match(expanded[2].text, /read_file.*lib\/main\.dart/);
	assert.match(expanded[3].text, /× read_file.*lib\/large\.dart/);
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
