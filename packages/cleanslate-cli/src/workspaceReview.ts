/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

export class CliWorkspaceReview {
	private readonly root: string;

	constructor(root: string) {
		this.root = path.resolve(root);
	}

	summary(): string {
		const branch = this.git(['branch', '--show-current']) || 'detached HEAD';
		const status = this.git(['status', '--short']);
		return status
			? `Branch: ${branch}\n\n${status}`
			: `Branch: ${branch}\n\nWorking tree clean.`;
	}

	diff(): string {
		const unstaged = this.git(['diff', '--no-ext-diff', '--no-color', '--', '.']);
		const staged = this.git(['diff', '--cached', '--no-ext-diff', '--no-color', '--', '.']);
		const sections = [
			staged ? `Staged changes\n\n${staged}` : '',
			unstaged ? `Unstaged changes\n\n${unstaged}` : ''
		].filter(Boolean);
		return sections.join('\n\n') || 'No tracked file changes.';
	}

	private git(args: string[]): string {
		const result = spawnSync('git', ['-C', this.root, ...args], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
			maxBuffer: 4 * 1024 * 1024
		});
		return result.status === 0 ? result.stdout.trimEnd() : '';
	}
}
