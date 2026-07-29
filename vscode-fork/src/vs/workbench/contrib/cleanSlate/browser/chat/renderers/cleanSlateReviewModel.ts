/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isEqualOrParent } from '../../../../../../base/common/resources.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { ISCMService } from '../../../../scm/common/scm.js';
import type { ICleanSlateMainService } from '../../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { CleanSlateDiffService } from '@cleanslate/sdk/services/cleanSlateDiffService.js';

const MAX_EAGER_REVIEW_DIFF_CELLS = 500_000;
const CLEANSLATE_GIT_REVIEW_TIMEOUT_MS = 15_000;

export interface ICleanSlateReviewChange {
	readonly uri: URI;
	readonly added: number;
	readonly deleted: number;
	readonly diff: string;
	readonly beforeContent: string;
	readonly afterContent: string;
}

/**
 * What the git-backed review compares:
 * - working:  working tree vs HEAD (staged + unstaged) — the default
 * - unstaged: working tree vs index
 * - staged:   index vs HEAD
 * - branch:   working tree vs the merge-base with the upstream/default branch
 * The 'turn' scope (agent session edits only) is handled by the caller and
 * never reaches the git collector.
 */
export type CleanSlateReviewScopeMode = 'working' | 'unstaged' | 'staged' | 'branch';

/** The scopes the review UI offers; 'turn' = only the agent session's edits. */
export type CleanSlateReviewDisplayScopeMode = CleanSlateReviewScopeMode | 'turn';

export interface ICleanSlateReviewScope {
	readonly roots?: readonly URI[];
	readonly mode?: CleanSlateReviewScopeMode;
}

export function mergeCleanSlateReviewChanges(
	primaryChanges: readonly ICleanSlateReviewChange[],
	secondaryChanges: readonly ICleanSlateReviewChange[]
): ICleanSlateReviewChange[] {
	const merged = new Map<string, ICleanSlateReviewChange>();
	for (const change of primaryChanges) {
		merged.set(normalizeCleanSlateReviewUriKey(change.uri), change);
	}
	for (const change of secondaryChanges) {
		const key = normalizeCleanSlateReviewUriKey(change.uri);
		if (!merged.has(key)) {
			merged.set(key, change);
		}
	}
	return Array.from(merged.values());
}

export function hasSCMReviewChanges(scmService: ISCMService, scope: ICleanSlateReviewScope = {}): boolean {
	const roots = normalizeReviewScopeRoots(scope.roots);
	for (const repository of scmService.repositories) {
		for (const group of repository.provider.groups) {
			if (group.resources.some(resource => isReviewResourceInScope(resource.sourceUri, roots))) {
				return true;
			}
		}
	}
	return false;
}

export async function collectSCMReviewChanges(
	scmService: ISCMService,
	fileService: IFileService,
	scope: ICleanSlateReviewScope = {}
): Promise<ICleanSlateReviewChange[]> {
	const changes: ICleanSlateReviewChange[] = [];
	const seen = new Set<string>();
	const roots = normalizeReviewScopeRoots(scope.roots);
	for (const repository of scmService.repositories) {
		for (const group of repository.provider.groups) {
			for (const resource of group.resources) {
				const uri = resource.sourceUri;
				if (!isReviewResourceInScope(uri, roots)) {
					continue;
				}
				const key = normalizeCleanSlateReviewUriKey(uri);
				if (seen.has(key)) {
					continue;
				}
				seen.add(key);
				const originalUri = await repository.provider.getOriginalResource(uri).catch(() => null);
				const beforeContent = originalUri ? await readReviewFile(fileService, originalUri) : '';
				const afterContent = await readReviewFile(fileService, uri);
				if (beforeContent === afterContent) {
					continue;
				}
				const { added, deleted, diff } = buildSCMReviewDiff(uri, beforeContent, afterContent);
				changes.push({
					uri,
					added,
					deleted,
					diff,
					beforeContent,
					afterContent
				});
			}
		}
	}
	return changes;
}

export async function collectGitReviewChanges(
	mainService: ICleanSlateMainService,
	fileService: IFileService,
	scope: ICleanSlateReviewScope = {}
): Promise<ICleanSlateReviewChange[]> {
	const changes: ICleanSlateReviewChange[] = [];
	const seen = new Set<string>();
	const mode = scope.mode ?? 'working';
	for (const root of normalizeReviewScopeRoots(scope.roots)) {
		if (!root.fsPath) {
			continue;
		}
		const cwd = root.fsPath;
		const insideWorkTree = await runGitReviewCommand(mainService, cwd, 'git rev-parse --is-inside-work-tree');
		if (insideWorkTree.trim() !== 'true') {
			continue;
		}

		const trackedOutput = await collectTrackedGitPaths(mainService, cwd, mode);
		for (const relativePath of parseGitNulList(trackedOutput.paths)) {
			const diff = await collectTrackedGitDiff(mainService, cwd, mode, trackedOutput.branchBase, relativePath);
			if (!diff.trim()) {
				continue;
			}
			const uri = toReviewChildUri(root, relativePath);
			const key = normalizeCleanSlateReviewUriKey(uri);
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			changes.push({
				uri,
				...countUnifiedDiffLines(diff),
				diff,
				beforeContent: '',
				afterContent: ''
			});
		}

		// The index-vs-HEAD scope has no notion of untracked files.
		const untrackedOutput = mode === 'staged'
			? ''
			: await runGitReviewCommand(mainService, cwd, 'git ls-files --others --exclude-standard -z -- .');
		for (const relativePath of parseGitNulList(untrackedOutput)) {
			const uri = toReviewChildUri(root, relativePath);
			const key = normalizeCleanSlateReviewUriKey(uri);
			if (seen.has(key)) {
				continue;
			}
			const afterContent = await readReviewFile(fileService, uri);
			if (!afterContent) {
				continue;
			}
			seen.add(key);
			const { added, deleted, diff } = buildSCMReviewDiff(uri, '', afterContent);
			changes.push({
				uri,
				added,
				deleted,
				diff,
				beforeContent: '',
				afterContent
			});
		}
	}
	return changes;
}

async function collectTrackedGitPaths(
	mainService: ICleanSlateMainService,
	cwd: string,
	mode: CleanSlateReviewScopeMode
): Promise<{ readonly paths: string; readonly branchBase: string }> {
	switch (mode) {
		case 'unstaged':
			return { paths: await runGitReviewCommand(mainService, cwd, 'git diff --name-only -z -- .'), branchBase: '' };
		case 'staged':
			return { paths: await runGitReviewCommand(mainService, cwd, 'git diff --name-only -z --cached -- .'), branchBase: '' };
		case 'branch': {
			const branchBase = await resolveGitBranchBase(mainService, cwd);
			if (branchBase) {
				return { paths: await runGitReviewCommand(mainService, cwd, `git diff --name-only -z ${branchBase} -- .`), branchBase };
			}
			// No upstream/default branch to compare against — fall through to working.
			break;
		}
	}
	const paths = await runGitReviewCommand(mainService, cwd, 'git diff --name-only -z HEAD -- .')
		|| joinGitNulLists(
			await runGitReviewCommand(mainService, cwd, 'git diff --name-only -z -- .'),
			await runGitReviewCommand(mainService, cwd, 'git diff --name-only -z --cached -- .')
		);
	return { paths, branchBase: '' };
}

async function collectTrackedGitDiff(
	mainService: ICleanSlateMainService,
	cwd: string,
	mode: CleanSlateReviewScopeMode,
	branchBase: string,
	relativePath: string
): Promise<string> {
	const pathspec = quoteGitPathspec(relativePath);
	switch (mode) {
		case 'unstaged':
			return runGitReviewCommand(mainService, cwd, `git diff --no-ext-diff --no-color -- ${pathspec}`);
		case 'staged':
			return runGitReviewCommand(mainService, cwd, `git diff --no-ext-diff --no-color --cached -- ${pathspec}`);
		case 'branch':
			if (branchBase) {
				return runGitReviewCommand(mainService, cwd, `git diff --no-ext-diff --no-color ${branchBase} -- ${pathspec}`);
			}
			break;
	}
	return await runGitReviewCommand(mainService, cwd, `git diff --no-ext-diff --no-color HEAD -- ${pathspec}`)
		|| await runGitReviewCommand(mainService, cwd, `git diff --no-ext-diff --no-color -- ${pathspec}`)
		|| await runGitReviewCommand(mainService, cwd, `git diff --no-ext-diff --no-color --cached -- ${pathspec}`);
}

async function resolveGitBranchBase(mainService: ICleanSlateMainService, cwd: string): Promise<string> {
	for (const candidate of ['@{upstream}', 'origin/HEAD', 'origin/main', 'origin/master', 'main', 'master']) {
		const base = (await runGitReviewCommand(mainService, cwd, `git merge-base HEAD ${quoteGitPathspec(candidate)}`)).trim();
		if (/^[0-9a-f]{7,40}$/i.test(base)) {
			return base;
		}
	}
	return '';
}

async function runGitReviewCommand(mainService: ICleanSlateMainService, cwd: string, command: string): Promise<string> {
	try {
		const result = await mainService.executeCommand({
			command,
			cwd,
			timeoutMs: CLEANSLATE_GIT_REVIEW_TIMEOUT_MS
		});
		return result.success ? result.stdout : '';
	} catch {
		return '';
	}
}

function parseGitNulList(output: string): string[] {
	return output.split('\0').filter(path => path.length > 0);
}

function joinGitNulLists(...outputs: readonly string[]): string {
	const seen = new Set<string>();
	const paths: string[] = [];
	for (const output of outputs) {
		for (const path of parseGitNulList(output)) {
			if (seen.has(path)) {
				continue;
			}
			seen.add(path);
			paths.push(path);
		}
	}
	return paths.length ? `${paths.join('\0')}\0` : '';
}

function quoteGitPathspec(path: string): string {
	return `'${path.replace(/'/g, `'\\''`)}'`;
}

function toReviewChildUri(root: URI, relativePath: string): URI {
	return URI.joinPath(root, ...relativePath.split('/').filter(segment => segment.length > 0));
}

function normalizeReviewScopeRoots(roots: readonly URI[] | undefined): URI[] {
	if (!roots?.length) {
		return [];
	}
	const seen = new Set<string>();
	const normalized: URI[] = [];
	for (const root of roots) {
		const key = normalizeCleanSlateReviewUriKey(root);
		if (!key || seen.has(key)) {
			continue;
		}
		seen.add(key);
		normalized.push(root);
	}
	return normalized;
}

function isReviewResourceInScope(uri: URI, roots: readonly URI[]): boolean {
	if (!roots.length) {
		return true;
	}
	return roots.some(root => isEqualOrParent(uri, root, true));
}

function buildSCMReviewDiff(uri: URI, beforeContent: string, afterContent: string): { added: number; deleted: number; diff: string } {
	const beforeLines = splitReviewLines(beforeContent);
	const afterLines = splitReviewLines(afterContent);
	const cellCount = (beforeLines.length + 1) * (afterLines.length + 1);
	if (cellCount <= MAX_EAGER_REVIEW_DIFF_CELLS) {
		const edits = CleanSlateDiffService.computeDiff(beforeContent, afterContent);
		const diff = CleanSlateDiffService.renderUnifiedDiff(uri.fsPath || uri.path || uri.toString(), beforeContent, edits);
		return { ...countUnifiedDiffLines(diff), diff };
	}

	const changedSpan = computeChangedLineSpan(beforeLines, afterLines);
	return {
		added: changedSpan.addedLines.length,
		deleted: changedSpan.deletedLines.length,
		diff: renderChangedSpanUnifiedDiff(uri.fsPath || uri.path || uri.toString(), changedSpan)
	};
}

function computeChangedLineSpan(beforeLines: readonly string[], afterLines: readonly string[]): {
	readonly oldStartLine: number;
	readonly newStartLine: number;
	readonly deletedLines: readonly string[];
	readonly addedLines: readonly string[];
} {
	let prefix = 0;
	while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) {
		prefix++;
	}

	let beforeSuffix = beforeLines.length - 1;
	let afterSuffix = afterLines.length - 1;
	while (beforeSuffix >= prefix && afterSuffix >= prefix && beforeLines[beforeSuffix] === afterLines[afterSuffix]) {
		beforeSuffix--;
		afterSuffix--;
	}

	return {
		oldStartLine: prefix + 1,
		newStartLine: prefix + 1,
		deletedLines: beforeLines.slice(prefix, beforeSuffix + 1),
		addedLines: afterLines.slice(prefix, afterSuffix + 1)
	};
}

function renderChangedSpanUnifiedDiff(
	fileName: string,
	span: {
		readonly oldStartLine: number;
		readonly newStartLine: number;
		readonly deletedLines: readonly string[];
		readonly addedLines: readonly string[];
	}
): string {
	const oldLength = Math.max(1, span.deletedLines.length);
	const newLength = Math.max(1, span.addedLines.length);
	const lines = [
		`--- ${fileName} (original)`,
		`+++ ${fileName} (updated)`,
		`@@ -${span.oldStartLine},${oldLength} +${span.newStartLine},${newLength} @@`
	];
	for (const line of span.deletedLines) {
		lines.push(`-${line}`);
	}
	for (const line of span.addedLines) {
		lines.push(`+${line}`);
	}
	return `${lines.join('\n')}\n`;
}

function splitReviewLines(content: string): string[] {
	return content.length === 0 ? [] : content.split(/\r\n|\r|\n/);
}

function normalizeCleanSlateReviewUriKey(uri: URI): string {
	return (uri.fsPath || uri.path || uri.toString()).replace(/\\/g, '/').trim().toLowerCase();
}

async function readReviewFile(fileService: IFileService, uri: URI): Promise<string> {
	try {
		const content = await fileService.readFile(uri);
		return content.value.toString();
	} catch {
		return '';
	}
}

function countUnifiedDiffLines(diff: string): { added: number; deleted: number } {
	let added = 0;
	let deleted = 0;
	for (const line of diff.split(/\r?\n/)) {
		if (line.startsWith('+') && !line.startsWith('+++')) {
			added++;
		} else if (line.startsWith('-') && !line.startsWith('---')) {
			deleted++;
		}
	}
	return { added, deleted };
}
