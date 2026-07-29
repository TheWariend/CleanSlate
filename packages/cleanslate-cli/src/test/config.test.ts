/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { CliConfigStore, CliCredentialStore, getCleanSlateWorkspaceStorageHome } from '../config.js';

test('workspace state is kept under CleanSlate private storage', () => {
	assert.equal(
		getCleanSlateWorkspaceStorageHome({ CLEANSLATE_HOME: '/private/cleanslate-home' }),
		path.join('/private/cleanslate-home', 'workspaceStorage')
	);
});

test('configuration and global credentials persist with owner-only permissions', () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-config-test-'));
	try {
		const config = new CliConfigStore(home);
		config.save({ version: 1, provider: 'anthropic', model: 'claude-test' });
		assert.equal(config.load().model, 'claude-test');

		const credentials = new CliCredentialStore(home);
		credentials.set('anthropic', 'secret-key');
		assert.equal(credentials.get('anthropic'), 'secret-key');
		assert.deepEqual(credentials.list(), ['anthropic']);
		assert.equal(credentials.remove('anthropic'), true);
		assert.equal(credentials.get('anthropic'), undefined);
		credentials.set('anthropic', 'secret-key');
		assert.equal(fs.statSync(path.join(home, 'auth.json')).mode & 0o777, 0o600);
		assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8')), {
			anthropic: { type: 'api', key: 'secret-key' }
		});
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test('legacy credentials migrate into the global auth file', () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-credential-migration-test-'));
	try {
		fs.writeFileSync(path.join(home, 'credentials.json'), JSON.stringify({ openai: 'legacy-secret' }), { mode: 0o600 });
		const credentials = new CliCredentialStore(home);
		assert.equal(credentials.get('openai'), 'legacy-secret');
		assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8')).openai.key, 'legacy-secret');
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test('logout removes legacy credentials as well as the global auth entry', () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-credential-removal-test-'));
	try {
		const legacyPath = path.join(home, 'credentials.json');
		fs.writeFileSync(legacyPath, JSON.stringify({ openai: 'legacy-secret', anthropic: 'keep-me' }), { mode: 0o600 });
		const credentials = new CliCredentialStore(home);
		assert.equal(credentials.remove('openai'), true);
		assert.equal(credentials.get('openai'), undefined);
		assert.equal(JSON.parse(fs.readFileSync(legacyPath, 'utf8')).anthropic, 'keep-me');
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test('explicit command-line credentials are saved and restored on the next run', () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-credential-test-'));
	try {
		const firstRun = new CliCredentialStore(home);
		assert.equal(firstRun.resolve('azureOpenAI', 'azure-secret', true, {}), 'azure-secret');

		const nextRun = new CliCredentialStore(home);
		assert.equal(nextRun.resolve('azureOpenAI', undefined, false, {}), 'azure-secret');
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});
