/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Range } from '../core/range.js';
import { URI } from '../core/uri.js';
import { SymbolKind } from '../host/symbols.js';

const EXCLUDED = new Set(['.git', '.cleanslate', 'node_modules', 'dist', 'build', 'out', 'coverage', 'vendor', 'target']);
const SOURCE = new Set(['.c', '.cc', '.cpp', '.cs', '.dart', '.go', '.h', '.hpp', '.java', '.js', '.jsx', '.kt', '.php', '.py', '.rb', '.rs', '.swift', '.ts', '.tsx', '.vue']);

export class CleanSlateNodeLanguageCommands {
	constructor(private readonly rootPath: string) { }

	async executeCommand(command: string, ...args: any[]): Promise<any[]> {
		switch (command) {
			case '_executeDocumentSymbolProvider':
				return this.symbols(this.toPath(args[0]));
			case '_executeDefinitionProvider':
				return this.locationsForWord(this.toPath(args[0]), args[1], true);
			case '_executeReferenceProvider':
				return this.locationsForWord(this.toPath(args[0]), args[1], false);
			default:
				throw new Error(`Unsupported headless language command: ${command}`);
		}
	}

	private symbols(file: string): any[] {
		const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
		const symbols: any[] = [];
		const patterns: Array<{ regex: RegExp; kind: SymbolKind }> = [
			{ regex: /^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: SymbolKind.Class },
			{ regex: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: SymbolKind.Interface },
			{ regex: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: SymbolKind.Function },
			{ regex: /^\s*(?:def|fn|func)\s+([A-Za-z_$][\w$]*)/, kind: SymbolKind.Function },
			{ regex: /^\s*(?:export\s+)?(?:const|let|var|type|enum|struct)\s+([A-Za-z_$][\w$]*)/, kind: SymbolKind.Variable },
			{ regex: /^\s*(?:public\s+|private\s+|protected\s+|static\s+|async\s+)*(?:[A-Za-z_$][\w$<>,.[\]?| ]+\s+)?([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*(?:\{|=>|:)/, kind: SymbolKind.Method }
		];
		for (let index = 0; index < lines.length; index++) {
			for (const pattern of patterns) {
				const match = lines[index].match(pattern.regex);
				if (!match?.[1] || ['if', 'for', 'while', 'switch', 'catch'].includes(match[1])) {
					continue;
				}
				const column = Math.max(1, lines[index].indexOf(match[1]) + 1);
				const range = new Range(index + 1, 1, index + 1, Math.max(1, lines[index].length + 1));
				symbols.push({
					name: match[1],
					kind: pattern.kind,
					range,
					selectionRange: new Range(index + 1, column, index + 1, column + match[1].length),
					children: []
				});
				break;
			}
		}
		return symbols;
	}

	private locationsForWord(file: string, position: { lineNumber?: number; column?: number }, definitionsOnly: boolean): any[] {
		const content = fs.readFileSync(file, 'utf8');
		const lines = content.split(/\r?\n/);
		const line = lines[Math.max(0, (position?.lineNumber ?? 1) - 1)] ?? '';
		const offset = Math.max(0, (position?.column ?? 1) - 1);
		const word = this.wordAt(line, offset);
		if (!word) {
			return [];
		}
		const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const definition = new RegExp(`\\b(?:class|interface|function|def|fn|func|const|let|var|type|enum|struct)\\s+${escaped}\\b|\\b${escaped}\\s*[:=]\\s*(?:function|async\\s*\\(|\\()`);
		const occurrence = new RegExp(`\\b${escaped}\\b`, 'g');
		const locations: any[] = [];
		for (const candidate of this.files(this.rootPath)) {
			let candidateLines: string[];
			try {
				candidateLines = fs.readFileSync(candidate, 'utf8').split(/\r?\n/);
			} catch {
				continue;
			}
			for (let lineIndex = 0; lineIndex < candidateLines.length; lineIndex++) {
				const value = candidateLines[lineIndex];
				if (definitionsOnly) {
					if (!definition.test(value)) {
						continue;
					}
					const column = Math.max(0, value.indexOf(word));
					locations.push({
						uri: URI.file(candidate),
						range: new Range(lineIndex + 1, column + 1, lineIndex + 1, column + word.length + 1)
					});
				} else {
					for (const match of value.matchAll(occurrence)) {
						locations.push({
							uri: URI.file(candidate),
							range: new Range(lineIndex + 1, match.index + 1, lineIndex + 1, match.index + word.length + 1)
						});
					}
				}
				if (locations.length >= 500) {
					return locations;
				}
			}
		}
		return locations;
	}

	private wordAt(line: string, offset: number): string | undefined {
		for (const match of line.matchAll(/[A-Za-z_$][\w$]*/g)) {
			if (offset >= match.index && offset <= match.index + match[0].length) {
				return match[0];
			}
		}
		return undefined;
	}

	private toPath(value: unknown): string {
		const candidate = value instanceof URI ? value.fsPath : typeof (value as any)?.fsPath === 'string' ? (value as any).fsPath : '';
		const resolved = path.resolve(candidate);
		const relative = path.relative(this.rootPath, resolved);
		if (!candidate || (relative.startsWith('..') || path.isAbsolute(relative))) {
			throw new Error('Language feature path is outside the workspace.');
		}
		return resolved;
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
			} else if (entry.isFile() && SOURCE.has(path.extname(entry.name).toLowerCase())) {
				yield absolute;
			}
		}
	}
}
