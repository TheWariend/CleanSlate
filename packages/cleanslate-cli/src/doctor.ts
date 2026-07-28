/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { ICliArguments } from './argv.js';
import type { CliCredentialStore } from './config.js';
import { CliProjectContext } from './projectContext.js';

export function cliDoctorReport(args: ICliArguments, credentials: CliCredentialStore): string {
	const checks: Array<[string, boolean, string]> = [];
	checks.push(['Node.js', Number(process.versions.node.split('.')[0]) >= 20, process.version]);
	checks.push(['Workspace', fs.existsSync(args.cwd) && fs.statSync(args.cwd).isDirectory(), args.cwd]);
	checks.push(['Provider', !!args.provider, `${args.provider}/${args.model ?? 'model not set'}`]);
	const needsKey = args.provider !== 'bedrock' && args.provider !== 'custom';
	const credential = needsKey ? credentials.get(args.provider) : undefined;
	checks.push(['Credential', !needsKey || !!credential, needsKey ? (credential ? 'saved' : 'missing') : 'provider-managed']);
	if (args.provider === 'azureOpenAI') {
		checks.push(['Azure endpoint', !!args.azureEndpoint, args.azureEndpoint ?? 'missing']);
	}
	const git = spawnSync('git', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
	checks.push(['Git', git.status === 0, git.status === 0 ? git.stdout.trim() : 'not available']);
	const mcpPath = path.join(args.cwd, '.mcp.json');
	if (fs.existsSync(mcpPath)) {
		let valid = false;
		try {
			JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
			valid = true;
		} catch { /* reported below */ }
		checks.push(['MCP config', valid, valid ? '.mcp.json valid' : '.mcp.json is invalid JSON']);
	}
	const inventory = new CliProjectContext(args.cwd).inventory();
	checks.push(['Instructions', true, inventory.instructionFiles.length ? inventory.instructionFiles.join(', ') : 'none']);
	return checks.map(([label, ok, detail]) => `${ok ? '✓' : '×'} ${label}: ${detail}`).join('\n');
}
