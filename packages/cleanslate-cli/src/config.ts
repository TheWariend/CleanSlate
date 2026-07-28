/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CliProvider } from './argv.js';

export interface ICliConfig {
	version: 1;
	provider?: CliProvider;
	model?: string;
	baseUrl?: string;
	reasoningLevel?: 'none' | 'low' | 'medium' | 'high';
	maxTurns?: number;
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
