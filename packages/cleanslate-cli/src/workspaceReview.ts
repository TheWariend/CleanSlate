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
	oldLine?: number;
	newLine?: number;
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

function minimizeReplacementBlock(deletions: ICliDiffLine[], additions: ICliDiffLine[]): ICliDiffLine[] {
	if (deletions.length === 0 || additions.length === 0 || deletions.length * additions.length > 250_000) {
		return [...deletions, ...additions];
	}
	const oldLines = deletions.map(line => line.text.slice(1));
	const newLines = additions.map(line => line.text.slice(1));
	const lengths = Array.from({ length: oldLines.length + 1 }, () => new Uint32Array(newLines.length + 1));
	for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex--) {
		for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex--) {
			lengths[oldIndex][newIndex] = oldLines[oldIndex] === newLines[newIndex]
				? lengths[oldIndex + 1][newIndex + 1] + 1
				: Math.max(lengths[oldIndex + 1][newIndex], lengths[oldIndex][newIndex + 1]);
		}
	}
	const result: ICliDiffLine[] = [];
	let oldIndex = 0;
	let newIndex = 0;
	while (oldIndex < oldLines.length && newIndex < newLines.length) {
		if (oldLines[oldIndex] === newLines[newIndex]) {
			result.push({ kind: 'context', text: ` ${oldLines[oldIndex]}` });
			oldIndex++;
			newIndex++;
		} else if (lengths[oldIndex + 1][newIndex] >= lengths[oldIndex][newIndex + 1]) {
			result.push(deletions[oldIndex++]);
		} else {
			result.push(additions[newIndex++]);
		}
	}
	result.push(...deletions.slice(oldIndex), ...additions.slice(newIndex));
	return result;
}

function minimizeReplacementBlocks(lines: ICliDiffLine[]): ICliDiffLine[] {
	const result: ICliDiffLine[] = [];
	for (let index = 0; index < lines.length;) {
		if (lines[index].kind !== 'deletion') {
			result.push(lines[index++]);
			continue;
		}
		const deletions: ICliDiffLine[] = [];
		while (lines[index]?.kind === 'deletion') {
			deletions.push(lines[index++]);
		}
		const additions: ICliDiffLine[] = [];
		while (lines[index]?.kind === 'addition') {
			additions.push(lines[index++]);
		}
		result.push(...minimizeReplacementBlock(deletions, additions));
	}
	return result;
}

export function parseCliDiffFile(filePath: string, scope: CliDiffScope, rawDiff: string): ICliDiffFile {
	const lines: ICliDiffLine[] = minimizeReplacementBlocks(rawDiff.split('\n').map(text => ({ kind: diffLineKind(text), text })));
	let oldLine: number | undefined;
	let newLine: number | undefined;
	for (const line of lines) {
		if (line.kind === 'hunk') {
			const match = line.text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
			oldLine = match ? Number(match[1]) : undefined;
			newLine = match ? Number(match[2]) : undefined;
			continue;
		}
		if (oldLine === undefined || newLine === undefined || line.kind === 'header') {
			continue;
		}
		if (line.kind === 'deletion') {
			line.oldLine = oldLine++;
		} else if (line.kind === 'addition') {
			line.newLine = newLine++;
		} else {
			line.oldLine = oldLine++;
			line.newLine = newLine++;
		}
	}
	return {
		path: filePath,
		scope,
		additions: lines.filter(line => line.kind === 'addition').length,
		deletions: lines.filter(line => line.kind === 'deletion').length,
		lines
	};
}

export function formatCliDiffLine(line: ICliDiffLine): string {
	if (line.kind === 'hunk' || line.kind === 'header') {
		return line.text;
	}
	const number = line.kind === 'deletion' ? line.oldLine : line.newLine;
	const marker = line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '-' : ' ';
	const content = /^[ +\-]/.test(line.text) ? line.text.slice(1) : line.text;
	return `${number === undefined ? '    ' : String(number).padStart(4)} ${marker} ${content}`;
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
