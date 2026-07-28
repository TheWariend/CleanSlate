/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Event } from '../core/event.js';
import { URI } from '../core/uri.js';
import { ICleanSlateIndexService, ISearchResult } from '../protocol/cleanSlateAI.js';

interface IChunk {
	path: string;
	content: string;
	startLine: number;
	endLine: number;
	tokens: Set<string>;
}

const EXCLUDED = new Set([
	'.git', '.hg', '.svn', '.cleanslate', 'node_modules', 'dist', 'build', 'out',
	'.next', '.nuxt', 'coverage', 'vendor', 'target', '.venv', 'venv'
]);
const TEXT_EXTENSIONS = new Set([
	'.c', '.cc', '.cpp', '.cs', '.css', '.dart', '.go', '.h', '.hpp', '.html',
	'.java', '.js', '.json', '.jsx', '.kt', '.kts', '.lua', '.md', '.mjs', '.php',
	'.py', '.rb', '.rs', '.scss', '.sh', '.sql', '.svelte', '.swift', '.toml',
	'.ts', '.tsx', '.txt', '.vue', '.xml', '.yaml', '.yml', '.zsh'
]);

export class CleanSlateNodeIndexService implements ICleanSlateIndexService {
	declare readonly _serviceBrand: undefined;
	readonly onDidStatusChange = Event.None;
	isIndexing = false;
	private chunks: IChunk[] = [];
	private indexedAt = 0;

	constructor(private readonly rootPath: string) { }

	async indexWorkspace(): Promise<void> {
		this.isIndexing = true;
		try {
			const chunks: IChunk[] = [];
			for (const file of this.files(this.rootPath)) {
				try {
					const stat = fs.statSync(file);
					if (stat.size > 2 * 1024 * 1024) {
						continue;
					}
					const content = fs.readFileSync(file, 'utf8');
					if (content.includes('\0')) {
						continue;
					}
					const lines = content.split(/\r?\n/);
					for (let start = 0; start < lines.length; start += 100) {
						const selected = lines.slice(start, start + 120);
						if (!selected.some(line => line.trim())) {
							continue;
						}
						const chunkContent = selected.join('\n');
						chunks.push({
							path: file,
							content: chunkContent,
							startLine: start + 1,
							endLine: start + selected.length,
							tokens: this.tokens(`${path.relative(this.rootPath, file)} ${chunkContent}`)
						});
					}
				} catch { /* a concurrently removed or unreadable file is skipped */ }
			}
			this.chunks = chunks;
			this.indexedAt = Date.now();
		} finally {
			this.isIndexing = false;
		}
	}

	async search(query: string, limit = 8, threshold = 0.2): Promise<ISearchResult[]> {
		if (this.chunks.length === 0 || Date.now() - this.indexedAt > 60_000) {
			await this.indexWorkspace();
		}
		const queryTokens = this.tokens(query);
		const normalizedQuery = query.toLowerCase().trim();
		return this.chunks
			.map(chunk => {
				let overlap = 0;
				for (const token of queryTokens) {
					if (chunk.tokens.has(token)) {
						overlap++;
					}
				}
				const recall = queryTokens.size > 0 ? overlap / queryTokens.size : 0;
				const precision = chunk.tokens.size > 0 ? overlap / Math.min(chunk.tokens.size, Math.max(12, queryTokens.size * 4)) : 0;
				const phraseBoost = normalizedQuery && chunk.content.toLowerCase().includes(normalizedQuery) ? 0.35 : 0;
				const pathBoost = normalizedQuery && path.relative(this.rootPath, chunk.path).toLowerCase().includes(normalizedQuery) ? 0.25 : 0;
				return { chunk, score: Math.min(1, recall * 0.7 + precision * 0.3 + phraseBoost + pathBoost) };
			})
			.filter(result => result.score >= Math.max(0, threshold))
			.sort((a, b) => b.score - a.score)
			.slice(0, Math.min(20, Math.max(1, limit)))
			.map(({ chunk, score }) => ({
				uri: URI.file(chunk.path),
				content: chunk.content,
				score,
				range: { startLineNumber: chunk.startLine, endLineNumber: chunk.endLine }
			}));
	}

	private *files(directory: string): Iterable<string> {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(directory, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.isSymbolicLink() || EXCLUDED.has(entry.name)) {
				continue;
			}
			const absolute = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				yield* this.files(absolute);
			} else if (entry.isFile() && (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) || !path.extname(entry.name))) {
				yield absolute;
			}
		}
	}

	private tokens(value: string): Set<string> {
		const expanded = value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
		return new Set((expanded.match(/[a-z_][a-z0-9_]{1,}/g) ?? [])
			.flatMap(token => this.splitIdentifier(token))
			.filter(token => token.length > 1));
	}

	private splitIdentifier(value: string): string[] {
		return [value, ...value.split('_'), ...value.replace(/([a-z])([A-Z])/g, '$1 $2').split(/\s+/)]
			.map(token => token.toLowerCase());
	}
}
