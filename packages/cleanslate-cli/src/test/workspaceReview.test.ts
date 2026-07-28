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
import { CliWorkspaceReview } from '../workspaceReview.js';

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

		const review = new CliWorkspaceReview(root);
		const summary = review.summary();
		const diff = review.diff();
		assert.match(summary, /tracked\.txt/);
		assert.match(diff, /Staged changes/);
		assert.match(diff, /Unstaged changes/);
		assert.match(diff, /staged/);
		assert.match(diff, /unstaged/);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
