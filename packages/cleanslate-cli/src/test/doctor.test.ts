/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { parseArguments } from '../argv.js';
import { CliCredentialStore } from '../config.js';
import { cliDoctorReport } from '../doctor.js';

test('doctor reports credentials, project instructions, and invalid MCP configuration', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-doctor-workspace-'));
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-doctor-home-'));
	try {
		fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Rules\n');
		fs.writeFileSync(path.join(root, '.mcp.json'), '{ nope');
		const credentials = new CliCredentialStore(home);
		credentials.set('openai', 'secret');
		const args = parseArguments([
			'--cwd', root,
			'--provider', 'openai',
			'--model', 'test-model'
		], {});
		const report = cliDoctorReport(args, credentials);
		assert.match(report, /✓ Credential: saved/);
		assert.match(report, /× MCP config: \.mcp\.json is invalid JSON/);
		assert.match(report, /✓ Instructions: AGENTS\.md/);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
	}
});
