/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import { URI } from '../core/uri.js';
import {
	IFileMatch,
	ISearchComplete,
	ISearchHost,
	ISearchProgressItem,
	ITextQuery,
	ITextSearchResult
} from '../host/workspace.js';

const DEFAULT_MAX_RESULTS = 2_000;
const DEFAULT_MAX_FILE_SIZE = 2 * 1024 * 1024;
const EXCLUDED_DIRECTORIES = new Set([
	'.git', '.hg', '.svn', '.cleanslate', 'node_modules', 'dist', 'build', 'out',
	'.next', '.nuxt', 'coverage', 'vendor', 'target', '.venv', 'venv'
]);

interface ICancellationLike {
	readonly isCancellationRequested?: boolean;
	readonly aborted?: boolean;
}

/** Filesystem-backed exact text search for Node and terminal hosts. */
export class CleanSlateNodeSearchService implements ISearchHost {
	private readonly rootPath: string;

	constructor(rootPath: string) {
		this.rootPath = path.resolve(rootPath);
	}

	async textSearch(
		query: ITextQuery,
		token?: unknown,
		onProgress?: (item: ISearchProgressItem) => void
	): Promise<ISearchComplete> {
		const matcher = this.createMatcher(query);
		const maxResults = Math.max(1, query.maxResults ?? DEFAULT_MAX_RESULTS);
		const maxFileSize = Math.max(1, query.maxFileSize ?? DEFAULT_MAX_FILE_SIZE);
		const results: IFileMatch[] = [];
		let matchCount = 0;
		let limitHit = false;

		for (const searchRoot of this.searchRoots(query)) {
			for await (const filePath of this.files(searchRoot, token)) {
				if (this.isCancelled(token)) {
					return { results, limitHit };
				}

				let stat: fs.Stats;
				try {
					stat = await fs.promises.stat(filePath);
				} catch {
					continue;
				}
				if (!stat.isFile() || stat.size > maxFileSize) {
					continue;
				}

				let content: string;
				try {
					content = await fs.promises.readFile(filePath, 'utf8');
				} catch {
					continue;
				}
				if (content.includes('\0')) {
					continue;
				}

				const fileResults: ITextSearchResult[] = [];
				const lines = content.split(/\r?\n/);
				for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
					const line = lines[lineIndex];
					for (const match of matcher(line)) {
						const startColumn = match.index + 1;
						const endColumn = startColumn + Math.max(1, match.length);
						fileResults.push({
							previewText: line,
							rangeLocations: [{
								source: {
									startLineNumber: lineIndex + 1,
									startColumn,
									endLineNumber: lineIndex + 1,
									endColumn
								},
								preview: {
									startLineNumber: 1,
									startColumn,
									endLineNumber: 1,
									endColumn
								}
							}]
						});
						matchCount++;
						if (matchCount >= maxResults) {
							limitHit = true;
							break;
						}
					}
					if (limitHit) {
						break;
					}
				}

				if (fileResults.length > 0) {
					const fileMatch = { resource: URI.file(filePath), results: fileResults };
					results.push(fileMatch);
					onProgress?.(fileMatch);
				}
				if (limitHit) {
					return { results, limitHit };
				}
			}
		}

		return { results, limitHit };
	}

	/**
	 * Roots to crawl. An explicit `folderQuery` is honored as given, including one that
	 * points outside this workspace's root — that only happens when a tool has resolved and
	 * validated the path itself (e.g. grep_search's scope after `resolvePathToUriAsync`
	 * confirms it exists), not from an unvalidated model-supplied string. With no
	 * folderQueries at all, default to searching the whole workspace.
	 */
	private searchRoots(query: ITextQuery): string[] {
		if (query.folderQueries.length === 0) {
			return [this.rootPath];
		}
		const roots = new Set<string>();
		for (const folderQuery of query.folderQueries) {
			roots.add(path.resolve(folderQuery.folder.fsPath));
		}
		return [...roots];
	}

	private async *files(candidate: string, token?: unknown): AsyncIterable<string> {
		if (this.isCancelled(token)) {
			return;
		}
		let stat: fs.Stats;
		try {
			stat = await fs.promises.lstat(candidate);
		} catch {
			return;
		}
		if (stat.isSymbolicLink()) {
			return;
		}
		if (stat.isFile()) {
			yield candidate;
			return;
		}
		if (!stat.isDirectory()) {
			return;
		}

		let entries: fs.Dirent[];
		try {
			entries = await fs.promises.readdir(candidate, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (this.isCancelled(token)) {
				return;
			}
			if (entry.isSymbolicLink() || (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name))) {
				continue;
			}
			yield* this.files(path.join(candidate, entry.name), token);
		}
	}

	private createMatcher(query: ITextQuery): (line: string) => Array<{ index: number; length: number }> {
		const contentPattern = query.contentPattern;
		const source = contentPattern.isRegExp
			? contentPattern.pattern
			: this.escapeRegExp(contentPattern.pattern);
		const wordSource = contentPattern.isWordMatch ? `\\b(?:${source})\\b` : source;
		const expression = new RegExp(wordSource, contentPattern.isCaseSensitive ? 'g' : 'gi');

		return (line: string) => {
			const matches: Array<{ index: number; length: number }> = [];
			expression.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = expression.exec(line)) !== null) {
				matches.push({ index: match.index, length: match[0].length });
				if (match[0].length === 0) {
					expression.lastIndex++;
				}
			}
			return matches;
		};
	}

	private isCancelled(token: unknown): boolean {
		const cancellation = token as ICancellationLike | undefined;
		return cancellation?.isCancellationRequested === true || cancellation?.aborted === true;
	}

	private escapeRegExp(value: string): string {
		return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}
}
