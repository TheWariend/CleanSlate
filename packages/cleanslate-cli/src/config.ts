/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { CliProvider } from './argv.js';

export interface ICliConfig {
	version: 1;
	provider?: CliProvider;
	model?: string;
	baseUrl?: string;
	reasoningLevel?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
	maxTurns?: number;
	bedrockRegion?: string;
	bedrockProfile?: string;
	azureEndpoint?: string;
	azureApiVersion?: string;
}

export function getCleanSlateHome(env: NodeJS.ProcessEnv = process.env): string {
	const configured = env['CLEANSLATE_HOME']?.trim();
	if (configured) {
		return path.resolve(configured);
	}
	const stateHome = env['XDG_STATE_HOME']?.trim();
	return stateHome
		? path.join(path.resolve(stateHome), 'cleanslate')
		: path.join(os.homedir(), '.cleanslate');
}

export class CliConfigStore {
	private readonly filePath: string;

	constructor(homePath: string = getCleanSlateHome()) {
		this.filePath = path.join(homePath, 'config.json');
	}

	load(): ICliConfig {
		try {
			const value = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
			return value?.version === 1 ? value : { version: 1 };
		} catch {
			return { version: 1 };
		}
	}

	save(config: ICliConfig): void {
		fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
		const temporary = `${this.filePath}.${process.pid}.tmp`;
		fs.writeFileSync(temporary, `${JSON.stringify({ ...config, version: 1 }, null, 2)}\n`, { mode: 0o600 });
		fs.renameSync(temporary, this.filePath);
	}
}

const KEYCHAIN_SERVICE = 'com.wariend.cleanslate.cli';

export class CliCredentialStore {
	private readonly fallbackPath: string;

	constructor(
		homePath: string = getCleanSlateHome(),
		private readonly platform: NodeJS.Platform = process.platform,
		private readonly runProcess: typeof spawnSync = spawnSync
	) {
		this.fallbackPath = path.join(homePath, 'credentials.json');
	}

	get(provider: CliProvider): string | undefined {
		if (this.platform === 'darwin') {
			const result = this.runProcess('/usr/bin/security', [
				'find-generic-password',
				'-s', KEYCHAIN_SERVICE,
				'-a', provider,
				'-w'
			], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
			const value = result.status === 0 ? result.stdout.trim() : '';
			return value || undefined;
		}
		try {
			const values = JSON.parse(fs.readFileSync(this.fallbackPath, 'utf8'));
			const value = values?.[provider];
			return typeof value === 'string' && value.trim() ? value : undefined;
		} catch {
			return undefined;
		}
	}

	set(provider: CliProvider, credential: string): void {
		const value = credential.trim();
		if (!value) {
			return;
		}
		if (this.platform === 'darwin') {
			const result = this.runProcess('/usr/bin/security', [
				'add-generic-password',
				'-U',
				'-s', KEYCHAIN_SERVICE,
				'-a', provider,
				'-w', value
			], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] });
			if (result.status !== 0) {
				throw new Error(`Could not save the API key in macOS Keychain: ${result.stderr.trim()}`);
			}
			return;
		}
		let values: Record<string, string> = {};
		try {
			values = JSON.parse(fs.readFileSync(this.fallbackPath, 'utf8'));
		} catch { /* first credential */ }
		values[provider] = value;
		fs.mkdirSync(path.dirname(this.fallbackPath), { recursive: true, mode: 0o700 });
		const temporary = `${this.fallbackPath}.${process.pid}.tmp`;
		fs.writeFileSync(temporary, `${JSON.stringify(values, null, 2)}\n`, { mode: 0o600 });
		fs.renameSync(temporary, this.fallbackPath);
	}
}
