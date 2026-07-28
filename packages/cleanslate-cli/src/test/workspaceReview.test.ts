/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import type { ICliTranscriptEntry } from '../sessions.js';
import { CliWorkspaceReview, cliTurnDiffReviews } from '../workspaceReview.js';

function git(root: string, args: string[]): void {
	const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr);
}

test('workspace review separates staged and unstaged changes without mutating Git state', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-review-test-'));
	try {
		git(root, ['init', '-q']);
		git(root, ['config', 'user.email', 'test@example.com']);
		git(root, ['config', 'user.name', 'CleanSlate Test']);
		fs.writeFileSync(path.join(root, 'tracked.txt'), 'base\n');
		git(root, ['add', 'tracked.txt']);
		git(root, ['commit', '-qm', 'base']);

		fs.writeFileSync(path.join(root, 'tracked.txt'), 'staged\n');
		git(root, ['add', 'tracked.txt']);
		fs.appendFileSync(path.join(root, 'tracked.txt'), 'unstaged\n');
		fs.writeFileSync(path.join(root, 'new.txt'), 'new\n');

		const review = new CliWorkspaceReview(root);
		const summary = review.summary();
		const diff = review.diff();
		const structured = review.review();
		assert.match(summary, /tracked\.txt/);
		assert.match(diff, /Staged changes/);
		assert.match(diff, /Unstaged changes/);
		assert.match(diff, /staged/);
		assert.match(diff, /unstaged/);
		assert.equal(structured.label, 'Current changes');
		assert.equal(structured.files.length, 3);
		assert.deepEqual(structured.files.map(file => file.scope), ['staged', 'unstaged', 'untracked']);
		assert.ok(structured.additions > 0);
		assert.ok(structured.deletions > 0);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('workspace review reconstructs per-turn edit diffs from saved tool results', () => {
	const entries: ICliTranscriptEntry[] = [
		{ id: 'user', kind: 'user', content: 'remove the footer', timestamp: 1 },
		{
			id: 'edit',
			kind: 'tool',
			content: 'completed',
			timestamp: 2,
			status: 'completed',
			toolName: 'apply_edit',
			detail: {
				input: { file_path: '/workspace/settings.dart' },
				result: {
					success: true,
					path: '/workspace/settings.dart',
					added: 0,
					deleted: 1,
					diff: [
						'--- a/settings.dart',
						'+++ b/settings.dart',
						'@@ -2,1 +2,0 @@',
						'-Developed by The Wariend'
					].join('\n')
				}
			}
		}
	];

	const reviews = cliTurnDiffReviews(entries);
	assert.equal(reviews.length, 1);
	assert.match(reviews[0].label, /remove the footer/);
	assert.equal(reviews[0].deletions, 1);
	assert.equal(reviews[0].files[0].lines.at(-1)?.kind, 'deletion');
});
