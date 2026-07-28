/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { apiKeyFromEnvironment, CliPermissionMode, CliProvider } from './argv.js';

export interface ICliConfig {
	version: 1;
	provider?: CliProvider;
	model?: string;
	baseUrl?: string;
	reasoningLevel?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
	maxTurns?: number;
	permissionMode?: CliPermissionMode;
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

export function getCleanSlateWorkspaceStorageHome(env: NodeJS.ProcessEnv = process.env): string {
	return path.join(getCleanSlateHome(env), 'workspaceStorage');
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

interface IStoredApiCredential {
	type: 'api';
	key: string;
}

export class CliCredentialStore {
	private readonly authPath: string;
	private readonly legacyPath: string;
	private readonly migrateMacKeychain: boolean;

	constructor(homePath?: string) {
		const resolvedHome = homePath ?? getCleanSlateHome();
		this.authPath = path.join(resolvedHome, 'auth.json');
		this.legacyPath = path.join(resolvedHome, 'credentials.json');
		this.migrateMacKeychain = homePath === undefined && process.platform === 'darwin';
	}

	get(provider: CliProvider): string | undefined {
		try {
			const values = JSON.parse(fs.readFileSync(this.authPath, 'utf8'));
			const credential = values?.[provider];
			const value = credential?.type === 'api' ? credential.key : credential;
			if (typeof value === 'string' && value.trim()) {
				return value;
			}
		} catch { /* no current credential file */ }
		try {
			const legacy = JSON.parse(fs.readFileSync(this.legacyPath, 'utf8'));
			const value = legacy?.[provider];
			if (typeof value === 'string' && value.trim()) {
				this.set(provider, value);
				return value;
			}
		} catch { /* no legacy credential */ }
		if (this.migrateMacKeychain) {
			const result = spawnSync('/usr/bin/security', [
				'find-generic-password',
				'-s', 'com.wariend.cleanslate.cli',
				'-a', provider,
				'-w'
			], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
			const value = result.status === 0 ? result.stdout.trim() : '';
			if (value) {
				this.set(provider, value);
				return value;
			}
		}
		return undefined;
	}

	resolve(
		provider: CliProvider,
		explicitCredential: string | undefined,
		credentialSpecified: boolean,
		env: NodeJS.ProcessEnv = process.env
	): string | undefined {
		if (credentialSpecified && explicitCredential) {
			this.set(provider, explicitCredential);
			return explicitCredential;
		}
		return this.get(provider) ?? apiKeyFromEnvironment(provider, env);
	}

	set(provider: CliProvider, credential: string): void {
		const value = credential.trim();
		if (!value) {
			return;
		}
		let values: Record<string, IStoredApiCredential> = {};
		try {
			const stored = JSON.parse(fs.readFileSync(this.authPath, 'utf8'));
			if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
				values = stored;
			}
		} catch { /* first credential */ }
		values[provider] = { type: 'api', key: value };
		fs.mkdirSync(path.dirname(this.authPath), { recursive: true, mode: 0o700 });
		const temporary = `${this.authPath}.${process.pid}.tmp`;
		fs.writeFileSync(temporary, `${JSON.stringify(values, null, 2)}\n`, { mode: 0o600 });
		fs.renameSync(temporary, this.authPath);
		fs.chmodSync(this.authPath, 0o600);
	}

	list(): CliProvider[] {
		try {
			const values = JSON.parse(fs.readFileSync(this.authPath, 'utf8'));
			return Object.keys(values).filter((provider): provider is CliProvider =>
				['cleanslate', 'openai', 'azureOpenAI', 'anthropic', 'gemini', 'grok', 'nvidia', 'openrouter', 'custom', 'bedrock'].includes(provider)
			);
		} catch {
			return [];
		}
	}

	remove(provider: CliProvider): boolean {
		let removed = false;
		try {
			const values = JSON.parse(fs.readFileSync(this.authPath, 'utf8')) as Record<string, IStoredApiCredential>;
			if (values?.[provider]) {
				delete values[provider];
				const temporary = `${this.authPath}.${process.pid}.tmp`;
				fs.writeFileSync(temporary, `${JSON.stringify(values, null, 2)}\n`, { mode: 0o600 });
				fs.renameSync(temporary, this.authPath);
				fs.chmodSync(this.authPath, 0o600);
				removed = true;
			}
		} catch { /* no current credential */ }
		try {
			const legacy = JSON.parse(fs.readFileSync(this.legacyPath, 'utf8')) as Record<string, string>;
			if (legacy?.[provider]) {
				delete legacy[provider];
				const temporary = `${this.legacyPath}.${process.pid}.tmp`;
				fs.writeFileSync(temporary, `${JSON.stringify(legacy, null, 2)}\n`, { mode: 0o600 });
				fs.renameSync(temporary, this.legacyPath);
				fs.chmodSync(this.legacyPath, 0o600);
				removed = true;
			}
		} catch { /* no legacy credential */ }
		if (this.migrateMacKeychain) {
			const result = spawnSync('/usr/bin/security', [
				'delete-generic-password',
				'-s', 'com.wariend.cleanslate.cli',
				'-a', provider
			], { stdio: 'ignore' });
			removed ||= result.status === 0;
		}
		return removed;
	}
}
