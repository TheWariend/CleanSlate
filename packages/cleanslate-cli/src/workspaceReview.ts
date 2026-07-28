/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import type { ICliTranscriptEntry } from './sessions.js';

export type CliDiffLineKind = 'header' | 'hunk' | 'context' | 'addition' | 'deletion';
export type CliDiffScope = 'staged' | 'unstaged' | 'untracked' | 'turn';

export interface ICliDiffLine {
	kind: CliDiffLineKind;
	text: string;
}

export interface ICliDiffFile {
	path: string;
	scope: CliDiffScope;
	additions: number;
	deletions: number;
	lines: ICliDiffLine[];
}

export interface ICliDiffReview {
	label: string;
	branch?: string;
	files: ICliDiffFile[];
	additions: number;
	deletions: number;
}

function diffLineKind(line: string): CliDiffLineKind {
	if (line.startsWith('@@')) {
		return 'hunk';
	}
	if (line.startsWith('+') && !line.startsWith('+++')) {
		return 'addition';
	}
	if (line.startsWith('-') && !line.startsWith('---')) {
		return 'deletion';
	}
	if (line.startsWith('diff --git')
		|| line.startsWith('index ')
		|| line.startsWith('---')
		|| line.startsWith('+++')
		|| line.startsWith('new file ')
		|| line.startsWith('deleted file ')
		|| line.startsWith('similarity index ')
		|| line.startsWith('rename from ')
		|| line.startsWith('rename to ')
		|| line.startsWith('Binary files ')) {
		return 'header';
	}
	return 'context';
}

export function parseCliDiffFile(filePath: string, scope: CliDiffScope, rawDiff: string): ICliDiffFile {
	const lines = rawDiff.split('\n').map(text => ({ kind: diffLineKind(text), text }));
	return {
		path: filePath,
		scope,
		additions: lines.filter(line => line.kind === 'addition').length,
		deletions: lines.filter(line => line.kind === 'deletion').length,
		lines
	};
}

function createReview(label: string, files: ICliDiffFile[], branch?: string): ICliDiffReview {
	return {
		label,
		branch,
		files,
		additions: files.reduce((total, file) => total + file.additions, 0),
		deletions: files.reduce((total, file) => total + file.deletions, 0)
	};
}

function toolResult(entry: ICliTranscriptEntry): any {
	if (!entry.detail || typeof entry.detail !== 'object') {
		return undefined;
	}
	const detail = entry.detail as { result?: unknown };
	return detail.result && typeof detail.result === 'object' ? detail.result : entry.detail;
}

export function cliTurnDiffReviews(entries: readonly ICliTranscriptEntry[]): ICliDiffReview[] {
	const turns: Array<{ number: number; task: string; files: ICliDiffFile[] }> = [];
	let current: { number: number; task: string; files: ICliDiffFile[] } | undefined;
	let turnNumber = 0;

	for (const entry of entries) {
		if (entry.kind === 'user') {
			turnNumber++;
			current = { number: turnNumber, task: entry.content.replace(/\s+/g, ' ').trim(), files: [] };
			turns.push(current);
			continue;
		}
		if (!current || entry.kind !== 'tool' || entry.status !== 'completed') {
			continue;
		}
		const result = toolResult(entry);
		if (typeof result?.diff !== 'string' || !result.diff.trim()) {
			continue;
		}
		const input = (entry.detail as { input?: any })?.input;
		const filePath = String(result.path ?? input?.file_path ?? input?.path ?? entry.toolName ?? 'changed file');
		const parsed = parseCliDiffFile(filePath, 'turn', result.diff);
		if (Number.isFinite(result.added)) {
			parsed.additions = Number(result.added);
		}
		if (Number.isFinite(result.deleted)) {
			parsed.deletions = Number(result.deleted);
		}
		current.files.push(parsed);
	}

	return turns
		.filter(turn => turn.files.length > 0)
		.reverse()
		.map(turn => createReview(
			`Turn ${turn.number}: ${turn.task.length > 48 ? `${turn.task.slice(0, 47)}…` : turn.task}`,
			turn.files
		));
}

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

	review(): ICliDiffReview {
		const branch = this.git(['branch', '--show-current']) || 'detached HEAD';
		const files: ICliDiffFile[] = [];
		for (const filePath of this.names(['diff', '--cached', '--name-only', '-z', '--', '.'])) {
			const diff = this.git(['diff', '--cached', '--no-ext-diff', '--no-color', '--', filePath]);
			if (diff) {
				files.push(parseCliDiffFile(filePath, 'staged', diff));
			}
		}
		for (const filePath of this.names(['diff', '--name-only', '-z', '--', '.'])) {
			const diff = this.git(['diff', '--no-ext-diff', '--no-color', '--', filePath]);
			if (diff) {
				files.push(parseCliDiffFile(filePath, 'unstaged', diff));
			}
		}
		for (const filePath of this.names(['ls-files', '--others', '--exclude-standard', '-z', '--', '.'])) {
			const diff = this.git(['diff', '--no-index', '--no-color', '--', '/dev/null', filePath], [0, 1]);
			if (diff) {
				files.push(parseCliDiffFile(filePath, 'untracked', diff));
			}
		}
		return createReview('Current changes', files, branch);
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

	private names(args: string[]): string[] {
		return this.git(args).split('\0').filter(Boolean);
	}

	private git(args: string[], acceptedStatuses: number[] = [0]): string {
		const result = spawnSync('git', ['-C', this.root, ...args], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
			maxBuffer: 4 * 1024 * 1024
		});
		return acceptedStatuses.includes(result.status ?? -1) ? result.stdout.trimEnd() : '';
	}
}
