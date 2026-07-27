/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as TreeSitter from '@vscode/tree-sitter-wasm';
import { Range } from '../../../../../editor/common/core/range.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { CleanSlateToolContext } from './types.js';
import { symbolKindToNodeType } from './symbolContext.js';
import { fireDocumentSymbolProvider } from './languageFeatureActivation.js';
import { cancellationTokenFromAbortSignal } from '../core/cleanSlateCancellation.js';

export interface CleanSlateSymbolIndexEntry {
	name: string;
	path: string[];
	range: Range;
	selectionRange: Range;
	source: 'lsp' | 'tree_sitter';
	nodeType?: string;
}

export interface CleanSlateSymbolIndex {
	entries: CleanSlateSymbolIndexEntry[];
	lspEntryCount: number;
	treeSitterEntryCount: number;
}

export async function buildCleanSlateSymbolIndex(model: ITextModel, context: CleanSlateToolContext): Promise<CleanSlateSymbolIndex> {
	const lspCandidates = await collectLanguageFeatureCandidates(model, context);
	const treeSitterCandidates = await collectTreeSitterCandidates(model, context);
	const entries = deduplicateCandidates([...lspCandidates, ...treeSitterCandidates]);

	console.info(
		`[CleanSlateEdit] symbol_index: ${entries.length} symbol(s), ${lspCandidates.length} from LSP, ${treeSitterCandidates.length} from Tree-sitter.`
	);

	return {
		entries,
		lspEntryCount: lspCandidates.length,
		treeSitterEntryCount: treeSitterCandidates.length
	};
}

async function collectLanguageFeatureCandidates(model: ITextModel, context: CleanSlateToolContext): Promise<CleanSlateSymbolIndexEntry[]> {
	if (!context.languageFeaturesService && !context.commandService) {
		return [];
	}

	const candidates: CleanSlateSymbolIndexEntry[] = [];
	const token = cancellationTokenFromAbortSignal(context.signal);

	const firedSymbols = await fireDocumentSymbolProvider(model.uri, context);
	if (Array.isArray(firedSymbols) && firedSymbols.length > 0) {
		console.info(`[CleanSlateEdit] symbol_index: LSP command returned ${firedSymbols.length} document symbol(s) for ${model.uri.fsPath}.`);
		collectSymbolCandidates(firedSymbols as any[], [], candidates);
	}

	// Retry loop for symbol providers after explicitly firing the language server.
	let providers = context.languageFeaturesService?.documentSymbolProvider.ordered(model) ?? [];
	let retries = 0;
	while (providers.length === 0 && retries < 4) {
		console.info(`[CleanSlateEdit] symbol_index: No provider yet for ${model.uri.fsPath} after LSP fire. Waiting 500ms (retry ${retries + 1}/4)...`);
		await new Promise(resolve => setTimeout(resolve, 500));
		providers = context.languageFeaturesService?.documentSymbolProvider.ordered(model) ?? [];
		retries++;
	}

	if (providers.length === 0) {
		return candidates;
	}

	for (const provider of providers) {
		// LSP enrichment is best-effort and must NEVER abort the edit: the
		// provider round-trips to the extension host, and a freshly resolved
		// headless model may not have synced there yet — extHostDocuments then
		// throws "Unable to retrieve document from URI". An uncaught rejection
		// here used to fail the whole apply_edit; the canonicalizer has a full
		// range/string fallback pipeline, so a failed provider is only a lost
		// enhancement.
		let symbols: Awaited<ReturnType<typeof provider.provideDocumentSymbols>> | undefined;
		try {
			symbols = await provider.provideDocumentSymbols(model, token);

			// Optional: second retry level for actual results if the provider exists but is silent
			if (!symbols || symbols.length === 0) {
				await new Promise(resolve => setTimeout(resolve, 300));
				symbols = await provider.provideDocumentSymbols(model, token);
			}
		} catch (error) {
			console.info(`[CleanSlateEdit] symbol_index: provider failed for ${model.uri.fsPath} (continuing without it): ${String(error)}`);
			continue;
		}

		if (symbols) {
			collectSymbolCandidates(symbols as any[], [], candidates);
		}
	}

	return candidates;
}

function collectSymbolCandidates(symbols: any[], parentPath: string[], candidates: CleanSlateSymbolIndexEntry[]): void {
	for (const symbol of symbols) {
		if (!symbol?.range || !symbol?.selectionRange || typeof symbol.name !== 'string') {
			continue;
		}
		const range = Range.lift(symbol.range);
		const selectionRange = Range.lift(symbol.selectionRange);
		if (!range || !selectionRange) {
			continue;
		}
		const currentPath = [...parentPath, symbol.name];
		candidates.push({
			name: symbol.name,
			path: currentPath,
			range,
			selectionRange,
			source: 'lsp',
			nodeType: symbolKindToNodeType(symbol.kind)
		});
		if (Array.isArray(symbol.children)) {
			collectSymbolCandidates(symbol.children, currentPath, candidates);
		}
	}
}

async function collectTreeSitterCandidates(model: ITextModel, context: CleanSlateToolContext): Promise<CleanSlateSymbolIndexEntry[]> {
	if (!context.treeSitterLibraryService) {
		return [];
	}

	const languageId = model.getLanguageId();
	if (!languageId) {
		return [];
	}

	let parser: TreeSitter.Parser | undefined;
	let tree: TreeSitter.Tree | null | undefined;

	try {
		const [ParserCtor, language] = await Promise.all([
			context.treeSitterLibraryService.getParserClass(),
			context.treeSitterLibraryService.getLanguagePromise(languageId)
		]);

		if (!language) {
			return [];
		}

		parser = new ParserCtor();
		parser.setLanguage(language);
		tree = parser.parse(model.getValue());
		if (!tree) {
			return [];
		}

		const candidates: CleanSlateSymbolIndexEntry[] = [];
		const stack: Array<{ node: TreeSitter.Node; ownerPath: string[] }> = [{
			node: tree.rootNode,
			ownerPath: []
		}];

		while (stack.length > 0) {
			const { node, ownerPath } = stack.pop()!;
			const declarationName = extractDeclarationName(node);
			const isStructuralDeclaration = declarationName !== undefined && isLikelyStructuralDeclaration(node);
			const nextOwnerPath = isStructuralDeclaration ? [...ownerPath, declarationName] : ownerPath;

			if (isStructuralDeclaration) {
				const nodeRange = toRange(node);
				candidates.push({
					name: declarationName,
					path: nextOwnerPath,
					range: nodeRange,
					selectionRange: toRange(findNameNode(node) ?? node),
					source: 'tree_sitter',
					nodeType: node.type
				});
			}

			for (let childIndex = node.namedChildren.length - 1; childIndex >= 0; childIndex--) {
				const child = node.namedChildren[childIndex];
				if (child) {
					stack.push({ node: child, ownerPath: nextOwnerPath });
				}
			}
		}

		return candidates;
	} catch {
		return [];
	} finally {
		tree?.delete();
		parser?.delete();
	}
}

function deduplicateCandidates(candidates: CleanSlateSymbolIndexEntry[]): CleanSlateSymbolIndexEntry[] {
	const deduplicated = new Map<string, CleanSlateSymbolIndexEntry>();
	for (const candidate of candidates) {
		const key = [
			candidate.name,
			candidate.path.join('>'),
			candidate.selectionRange.startLineNumber,
			candidate.selectionRange.startColumn,
			candidate.selectionRange.endLineNumber,
			candidate.selectionRange.endColumn
		].join(':');
		if (!deduplicated.has(key) || candidate.source === 'tree_sitter') {
			deduplicated.set(key, candidate);
		}
	}
	return Array.from(deduplicated.values());
}

function extractDeclarationName(node: TreeSitter.Node): string | undefined {
	const explicitNameNode = findNameNode(node);
	const explicitName = normalizeDeclarationName(explicitNameNode?.text);
	if (explicitName) {
		return explicitName;
	}

	for (const child of node.namedChildren) {
		if (!child) {
			continue;
		}
		const childType = child.type.toLowerCase();
		if (childType.includes('identifier') || childType.endsWith('name')) {
			const childName = normalizeDeclarationName(child.text);
			if (childName) {
				return childName;
			}
		}
	}

	return undefined;
}

function findNameNode(node: TreeSitter.Node): TreeSitter.Node | undefined {
	const directNameNode = node.childForFieldName('name');
	if (directNameNode) {
		return directNameNode;
	}

	for (const wrapperField of ['declarator', 'declaration']) {
		const wrapperNode = node.childForFieldName(wrapperField);
		if (wrapperNode) {
			const nestedNameNode = findNameNode(wrapperNode);
			if (nestedNameNode) {
				return nestedNameNode;
			}
		}
	}

	return undefined;
}

function normalizeDeclarationName(rawText: string | undefined): string | undefined {
	const normalized = rawText?.trim();
	return normalized && /^[A-Za-z_$][\w$]*$/.test(normalized) ? normalized : undefined;
}

function isLikelyStructuralDeclaration(node: TreeSitter.Node): boolean {
	const normalizedType = node.type.toLowerCase();
	if (
		normalizedType.includes('class')
		|| normalizedType.includes('function')
		|| normalizedType.includes('method')
		|| normalizedType.includes('constructor')
		|| normalizedType.includes('interface')
		|| normalizedType.includes('enum')
		|| normalizedType.includes('typedef')
		|| normalizedType.includes('alias')
		|| normalizedType.includes('struct')
		|| normalizedType.includes('trait')
		|| normalizedType.includes('component')
		|| normalizedType.includes('declaration')
		|| normalizedType.includes('definition')
	) {
		return true;
	}

	return node.childForFieldName('body') !== null || node.childForFieldName('parameters') !== null;
}

function toRange(node: TreeSitter.Node): Range {
	return new Range(
		node.startPosition.row + 1,
		node.startPosition.column + 1,
		node.endPosition.row + 1,
		node.endPosition.column + 1
	);
}
