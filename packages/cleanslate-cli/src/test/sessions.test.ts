/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { CliSessionStore, transcriptEntry } from '../sessions.js';

test('workspace sessions round-trip transcript and runtime state', () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-session-test-'));
	try {
		const workspace = path.join(home, 'repo');
		fs.mkdirSync(workspace);
		const store = new CliSessionStore(workspace, home);
		const session = store.create('openai', 'gpt-test', 'Fix the build');
		session.transcript.push(transcriptEntry('user', 'Fix the build'));
		session.runtimeSnapshot = {
			version: 1,
			sessionId: session.id,
			threadHistory: []
		};
		store.save(session);

		const loaded = store.load(session.id);
		assert.equal(loaded?.title, 'Fix the build');
		assert.equal(loaded?.transcript[0]?.content, 'Fix the build');
		assert.equal(loaded?.runtimeSnapshot?.sessionId, session.id);
		assert.equal(store.latest()?.id, session.id);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test('sessions are isolated by workspace', () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-session-test-'));
	try {
		const first = new CliSessionStore(path.join(home, 'one'), home);
		const second = new CliSessionStore(path.join(home, 'two'), home);
		first.save(first.create('anthropic', 'test'));
		assert.equal(second.list().length, 0);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});
