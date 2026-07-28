/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { CliConfigStore, CliCredentialStore } from '../config.js';

test('configuration and fallback credentials persist with owner-only permissions', () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-config-test-'));
	try {
		const config = new CliConfigStore(home);
		config.save({ version: 1, provider: 'anthropic', model: 'claude-test' });
		assert.equal(config.load().model, 'claude-test');

		const credentials = new CliCredentialStore(home, 'linux');
		credentials.set('anthropic', 'secret-key');
		assert.equal(credentials.get('anthropic'), 'secret-key');
		assert.equal(fs.statSync(path.join(home, 'credentials.json')).mode & 0o777, 0o600);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test('macOS credentials use the system Keychain command', () => {
	const calls: string[][] = [];
	const runProcess = ((_command: string, args: readonly string[]) => {
		calls.push([...args]);
		if (args[0] === 'find-generic-password') {
			return { status: 0, stdout: 'keychain-secret\n', stderr: '' };
		}
		return { status: 0, stdout: '', stderr: '' };
	}) as any;
	const credentials = new CliCredentialStore('/unused', 'darwin', runProcess);

	credentials.set('openai', 'keychain-secret');
	assert.equal(credentials.get('openai'), 'keychain-secret');
	assert.equal(calls[0]?.[0], 'add-generic-password');
	assert.equal(calls[1]?.[0], 'find-generic-password');
});
