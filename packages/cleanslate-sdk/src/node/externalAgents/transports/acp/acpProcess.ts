/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { IExternalAgentLaunchConfiguration } from '../../externalAgentRegistry.js';

const inheritedEnvironmentKeys = [
	'PATH', 'HOME', 'USER', 'SHELL', 'TMPDIR', 'TEMP', 'TMP',
	'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME',
	'CODEX_HOME', 'OPENCODE_CONFIG', 'OPENCODE_CONFIG_DIR',
	'LANG', 'LC_ALL', 'TERM', 'COLORTERM'
] as const;

export function createAgentEnvironment(source: NodeJS.ProcessEnv, runAsNode = false): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = {};
	for (const key of inheritedEnvironmentKeys) {
		if (source[key] !== undefined) {
			environment[key] = source[key];
		}
	}
	if (runAsNode) {
		environment.ELECTRON_RUN_AS_NODE = '1';
	}
	return environment;
}

export class AcpProcess {
	readonly child: ChildProcessWithoutNullStreams;
	private stopping = false;
	private stderr = '';

	constructor(configuration: IExternalAgentLaunchConfiguration & { executable: string }, cwd: string) {
		this.child = spawn(configuration.executable, [...configuration.args], {
			cwd,
			env: { ...createAgentEnvironment(process.env, configuration.runAsNode), ...configuration.env },
			stdio: ['pipe', 'pipe', 'pipe'],
			shell: false,
			windowsHide: true
		});
		this.child.stderr.setEncoding('utf8');
		this.child.stderr.on('data', chunk => {
			this.stderr = `${this.stderr}${String(chunk)}`.slice(-4000);
		});
	}

	get isStopping(): boolean { return this.stopping; }

	get errorDetail(): string | undefined {
		const detail = this.stderr.trim();
		return detail || undefined;
	}

	async stop(): Promise<void> {
		this.stopping = true;
		if (this.child.exitCode !== null || this.child.killed) {
			return;
		}
		this.child.kill('SIGTERM');
		await Promise.race([
			new Promise<void>(resolve => this.child.once('exit', () => resolve())),
			new Promise<void>(resolve => setTimeout(resolve, 2_000))
		]);
		if (this.child.exitCode === null) {
			this.child.kill('SIGKILL');
		}
	}
}
