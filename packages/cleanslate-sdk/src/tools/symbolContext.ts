/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SymbolKind } from '../host/symbols.js';

export interface CleanSlateSymbolRange {
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
}

export interface CleanSlateSymbolContextEntry {
	id: string;
	name: string;
	kind: number;
	kindLabel: string;
	nodeType?: string;
	path: string[];
	kindPath: string[];
	pathLabel: string;
	depth: number;
	range: CleanSlateSymbolRange;
	selectionRange: CleanSlateSymbolRange;
}

export interface CleanSlateLineOwnerRange {
	startLine: number;
	endLine: number;
	ownerPath: string[];
	ownerKindPath: string[];
	ownerLabel: string;
	deepestSymbol?: string;
}

export interface CleanSlateSymbolContextMap {
	symbols: CleanSlateSymbolContextEntry[];
	lineOwnerRanges: CleanSlateLineOwnerRange[];
}

export function buildSymbolContext(symbols: any[], lineCount: number): CleanSlateSymbolContextMap {
	const entries: CleanSlateSymbolContextEntry[] = [];
	collectSymbolContextEntries(symbols, [], [], 0, entries);
	const sortedEntries = entries.sort((a, b) => {
		const startDelta = a.range.startLine - b.range.startLine;
		if (startDelta !== 0) {
			return startDelta;
		}
		return a.range.startColumn - b.range.startColumn;
	});

	return {
		symbols: sortedEntries,
		lineOwnerRanges: buildLineOwnerRanges(sortedEntries, Math.max(1, lineCount))
	};
}

export function getOwnerHierarchyForLine(lineNumber: number, entries: CleanSlateSymbolContextEntry[]): CleanSlateSymbolContextEntry[] {
	return entries
		.filter(entry => entry.range.startLine <= lineNumber && entry.range.endLine >= lineNumber)
		.sort((a, b) => {
			const depthDelta = a.depth - b.depth;
			if (depthDelta !== 0) {
				return depthDelta;
			}
			const aSpan = a.range.endLine - a.range.startLine;
			const bSpan = b.range.endLine - b.range.startLine;
			return bSpan - aSpan;
		});
}

export function symbolKindToLabel(kind: number | undefined): string {
	switch (kind) {
		case SymbolKind.File: return 'file';
		case SymbolKind.Module: return 'module';
		case SymbolKind.Namespace: return 'namespace';
		case SymbolKind.Package: return 'package';
		case SymbolKind.Class: return 'class';
		case SymbolKind.Method: return 'method';
		case SymbolKind.Property: return 'property';
		case SymbolKind.Field: return 'field';
		case SymbolKind.Constructor: return 'constructor';
		case SymbolKind.Enum: return 'enum';
		case SymbolKind.Interface: return 'interface';
		case SymbolKind.Function: return 'function';
		case SymbolKind.Variable: return 'variable';
		case SymbolKind.Constant: return 'constant';
		case SymbolKind.String: return 'string';
		case SymbolKind.Number: return 'number';
		case SymbolKind.Boolean: return 'boolean';
		case SymbolKind.Array: return 'array';
		case SymbolKind.Object: return 'object';
		case SymbolKind.Key: return 'key';
		case SymbolKind.Null: return 'null';
		case SymbolKind.EnumMember: return 'enumMember';
		case SymbolKind.Struct: return 'struct';
		case SymbolKind.Event: return 'event';
		case SymbolKind.Operator: return 'operator';
		case SymbolKind.TypeParameter: return 'typeParameter';
		default: return 'unknown';
	}
}

export function symbolKindToNodeType(kind: number | undefined): string | undefined {
	switch (kind) {
		case SymbolKind.Class: return 'class';
		case SymbolKind.Enum: return 'enum';
		case SymbolKind.Interface: return 'interface';
		case SymbolKind.Struct: return 'struct';
		case SymbolKind.Method: return 'method';
		case SymbolKind.Function: return 'function';
		case SymbolKind.Constructor: return 'constructor';
		case SymbolKind.Property: return 'property';
		case SymbolKind.Field: return 'field';
		case SymbolKind.Variable: return 'variable';
		case SymbolKind.Constant: return 'constant';
		case SymbolKind.Module: return 'module';
		case SymbolKind.Namespace: return 'namespace';
		case SymbolKind.Package: return 'package';
		case SymbolKind.TypeParameter: return 'typeParameter';
		default: return undefined;
	}
}

function collectSymbolContextEntries(
	symbols: any[],
	parentPath: string[],
	parentKindPath: string[],
	depth: number,
	entries: CleanSlateSymbolContextEntry[]
): void {
	for (const symbol of symbols) {
		if (!symbol?.range || !symbol?.selectionRange || typeof symbol.name !== 'string') {
			continue;
		}

		const kindLabel = symbolKindToLabel(symbol.kind);
		const path = [...parentPath, symbol.name];
		const kindPath = [...parentKindPath, kindLabel];
		const entry: CleanSlateSymbolContextEntry = {
			id: `${path.join('>')}:${symbol.range.startLineNumber}:${symbol.range.startColumn}`,
			name: symbol.name,
			kind: typeof symbol.kind === 'number' ? symbol.kind : -1,
			kindLabel,
			nodeType: symbolKindToNodeType(symbol.kind),
			path,
			kindPath,
			pathLabel: path.join(' > '),
			depth,
			range: toSymbolRange(symbol.range),
			selectionRange: toSymbolRange(symbol.selectionRange)
		};
		entries.push(entry);

		if (Array.isArray(symbol.children)) {
			collectSymbolContextEntries(symbol.children, path, kindPath, depth + 1, entries);
		}
	}
}

function buildLineOwnerRanges(entries: CleanSlateSymbolContextEntry[], lineCount: number): CleanSlateLineOwnerRange[] {
	const ranges: CleanSlateLineOwnerRange[] = [];
	let current: CleanSlateLineOwnerRange | undefined;
	let currentKey = '';

	for (let line = 1; line <= lineCount; line++) {
		const owners = getOwnerHierarchyForLine(line, entries);
		const ownerPath = owners.map(owner => owner.name);
		const ownerKindPath = owners.map(owner => owner.kindLabel);
		const key = `${ownerPath.join('>')}|${ownerKindPath.join('>')}`;
		if (current && key === currentKey) {
			current.endLine = line;
			continue;
		}

		current = {
			startLine: line,
			endLine: line,
			ownerPath,
			ownerKindPath,
			ownerLabel: owners.map(owner => `${owner.kindLabel}:${owner.name}`).join(' > '),
			deepestSymbol: owners[owners.length - 1]?.pathLabel
		};
		ranges.push(current);
		currentKey = key;
	}

	return ranges;
}

function toSymbolRange(range: any): CleanSlateSymbolRange {
	return {
		startLine: range.startLineNumber,
		startColumn: range.startColumn,
		endLine: range.endLineNumber,
		endColumn: range.endColumn
	};
}
