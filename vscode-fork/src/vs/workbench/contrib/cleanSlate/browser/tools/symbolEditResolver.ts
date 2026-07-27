/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Range } from '../../../../../editor/common/core/range.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { CleanSlateEditService, CleanSlateStructuredEdit } from '../core/cleanSlateEditService.js';
import { CleanSlateToolContext } from './types.js';
import { buildCleanSlateSymbolIndex, CleanSlateSymbolIndexEntry } from './symbolIndex.js';

type SymbolCandidate = CleanSlateSymbolIndexEntry;

export async function resolveSymbolStructuredEdits(
    path: string,
    model: ITextModel,
    edits: CleanSlateStructuredEdit[],
    context: CleanSlateToolContext
): Promise<{ ok: true; edits: CleanSlateStructuredEdit[] } | { ok: false; failure: any }> {
    if (!edits.some(edit => edit.mode === 'replace_symbol')) {
        return { ok: true, edits };
    }

    const symbolIndex = await buildCleanSlateSymbolIndex(model, context);
    const allCandidates = symbolIndex.entries;
    console.info(`[CleanSlateEdit] replace_symbol: indexed ${allCandidates.length} symbol candidate(s) for ${path}.`);

    if (allCandidates.length === 0) {
        console.info(`[CleanSlateEdit] replace_symbol: no LSP/tree-sitter symbol candidates after firing language features.`);
        return {
            ok: false,
            failure: {
                success: false,
                path,
                code: 'symbol_provider_unavailable',
                diagnostics: [],
                recoveryHint: 'The language server did not provide symbols after activation. Re-open the Dart file or restart the Dart extension host, then call read_symbols again before retrying replace_symbol.',
                currentVersionId: model.getVersionId(),
                message: `No structural symbol resolver is available for ${path}.`
            }
        };
    }

    const resolvedEdits: CleanSlateStructuredEdit[] = [];
    for (let index = 0; index < edits.length; index++) {
        const edit = edits[index];
        if (edit.mode !== 'replace_symbol') {
            resolvedEdits.push(edit);
            continue;
        }

        if (typeof edit.symbolName !== 'string' || edit.symbolName.trim().length === 0 || typeof edit.replacementText !== 'string') {
            return {
                ok: false,
                failure: {
                    success: false,
                    path,
                    code: 'invalid_input',
                    diagnostics: [],
                    attemptedEdits: edits.length,
                    currentVersionId: model.getVersionId(),
                    message: 'replace_symbol requires symbolName and replacementText.'
                }
            };
        }

        const matches = findSymbolMatches(allCandidates, edit);
        console.info(`[CleanSlateEdit] replace_symbol "${edit.symbolName}": ${matches.length} raw symbol match(es).`);
        if (matches.length === 0) {
            return {
                ok: false,
                failure: {
                    success: false,
                    path,
                    code: 'symbol_not_found',
                    diagnostics: [],
                    attemptedEdits: edits.length,
                    currentVersionId: model.getVersionId(),
                    recoveryHint: 'Call read_symbols to inspect the current symbol tree, then retry with an exact symbolName or symbolPath. If needed, fall back to replace_range with expectedVersionId.',
                    message: `No symbol named "${edit.symbolName}" was found in ${path}.`
                }
            };
        }

        let narrowedMatches = narrowMatchesFromReplacement(matches, edit);
        console.info(`[CleanSlateEdit] replace_symbol "${edit.symbolName}": ${narrowedMatches.length} match(es) after structural narrowing.`);
        if (narrowedMatches.length > 1 && typeof edit.originalText === 'string' && edit.originalText.length > 0) {
            // String anchor beats symbol ambiguity: the unique old-string
            // match IS the resolution. If exactly one of
            // the candidates contains the provided originalText, that is the
            // intended target — no retry turn needed.
            const normalizedSnippet = CleanSlateEditService.normalizeQuotes(edit.originalText.replace(/\r\n/g, '\n'));
            const anchored = narrowedMatches.filter(candidate => {
                const candidateContent = CleanSlateEditService.normalizeQuotes(model.getValueInRange(candidate.range).replace(/\r\n/g, '\n'));
                return candidateContent.includes(normalizedSnippet);
            });
            if (anchored.length === 1) {
                console.info(`[CleanSlateEdit] replace_symbol "${edit.symbolName}": originalText anchor disambiguated ${narrowedMatches.length} candidates.`);
                narrowedMatches = anchored;
            }
        }
        if (narrowedMatches.length > 1) {
            const candidateSummaries = narrowedMatches.slice(0, 8).map(match =>
                `${match.path.join(' > ')} (${match.nodeType ?? match.source}, lines ${match.range.startLineNumber}-${match.range.endLineNumber})`
            );
            return {
                ok: false,
                failure: {
                    success: false,
                    path,
                    code: 'ambiguous_symbol',
                    diagnostics: narrowedMatches.slice(0, 8).map(match => ({
                        symbolPath: match.path.join(' > '),
                        lines: `${match.range.startLineNumber}-${match.range.endLineNumber}`,
                        source: match.source,
                        nodeType: match.nodeType
                    })),
                    attemptedEdits: edits.length,
                    currentVersionId: model.getVersionId(),
                    recoveryHint: 'Pick the intended candidate from the list and retry ONCE with replace_range on its exact lines plus originalText, or use symbolPath to name the owner hierarchy.',
                    message: `Symbol "${edit.symbolName}" matched ${narrowedMatches.length} locations in ${path}: ${candidateSummaries.join('; ')}.`
                }
            };
        }

        const match = narrowedMatches[0];
        let targetRange = match.range;
        let targetOriginalText = model.getValueInRange(match.range);

        // Scoped Precision Matching: If originalText is provided, find it INSIDE the symbol
        if (typeof edit.originalText === 'string' && edit.originalText.length > 0) {
            const symbolContent = targetOriginalText;
            const normalizedSymbolContent = CleanSlateEditService.normalizeQuotes(symbolContent.replace(/\r\n/g, '\n'));
            const normalizedSnippet = CleanSlateEditService.normalizeQuotes(edit.originalText.replace(/\r\n/g, '\n'));

            const snippetIndexes = findAllIndexes(normalizedSymbolContent, normalizedSnippet);
            console.info(`[CleanSlateEdit] replace_symbol "${edit.symbolName}" scoped snippet: ${snippetIndexes.length} match(es) inside symbol.`);
            if (snippetIndexes.length === 1) {
                const snippetIndex = snippetIndexes[0];
                const symbolStartOffset = model.getOffsetAt(match.range.getStartPosition());
                const snippetStartOffset = symbolStartOffset + snippetIndex;
                const snippetEndOffset = snippetStartOffset + normalizedSnippet.length;

                const snippetStart = model.getPositionAt(snippetStartOffset);
                const snippetEnd = model.getPositionAt(snippetEndOffset);

                targetRange = new Range(snippetStart.lineNumber, snippetStart.column, snippetEnd.lineNumber, snippetEnd.column);
                targetOriginalText = model.getValueInRange(targetRange);
            } else if (snippetIndexes.length > 1) {
                return {
                    ok: false,
                    failure: {
                        success: false,
                        path,
                        code: 'ambiguous_symbol_snippet',
                        diagnostics: [],
                        attemptedEdits: edits.length,
                        currentVersionId: model.getVersionId(),
                        recoveryHint: `The snippet appears multiple times inside "${edit.symbolName}". Add more surrounding lines to originalText or target a narrower symbolPath.`,
                        message: `The originalText matched ${snippetIndexes.length} locations within symbol "${edit.symbolName}".`
                    }
                };
            } else {
                // Snippet not found within the specific symbol. 
                // Return a failure to prevent the agent from accidentally overwriting the whole symbol genericizing it.
                return {
                    ok: false,
                    failure: {
                        success: false,
                        path,
                        code: 'symbol_snippet_not_found',
                        diagnostics: [],
                        attemptedEdits: edits.length,
                        currentVersionId: model.getVersionId(),
                        recoveryHint: `The snippet you provided was not found inside the symbol "${edit.symbolName}". Re-read the symbol and provide the exact originalText to change.`,
                        message: `The originalText was not found within the boundaries of symbol "${edit.symbolName}".`
                    }
                };
            }
        }

        console.info(`[CleanSlateEdit] replace_symbol "${edit.symbolName}" resolved to replace_range ${targetRange.startLineNumber}:${targetRange.startColumn}-${targetRange.endLineNumber}:${targetRange.endColumn}.`);
        resolvedEdits.push({
            mode: 'replace_range',
            startLine: targetRange.startLineNumber,
            startColumn: targetRange.startColumn,
            endLine: targetRange.endLineNumber,
            endColumn: targetRange.endColumn,
            structuralOrigin: 'symbol',
            originalText: targetOriginalText,
            replacementText: typeof edit.originalText === 'string' ? CleanSlateEditService.preserveQuoteStyle(edit.originalText, targetOriginalText, edit.replacementText) : edit.replacementText
        });
    }

    return { ok: true, edits: resolvedEdits };
}

function findSymbolMatches(candidates: SymbolCandidate[], edit: CleanSlateStructuredEdit): SymbolCandidate[] {
    const requestedPath = Array.isArray(edit.symbolPath)
        ? edit.symbolPath.filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
        : [];

    if (requestedPath.length > 0) {
        return candidates.filter(candidate => pathsEqual(candidate.path, requestedPath));
    }

    return candidates.filter(candidate => candidate.name === edit.symbolName);
}

function narrowMatchesFromReplacement(matches: SymbolCandidate[], edit: CleanSlateStructuredEdit): SymbolCandidate[] {
    if (matches.length <= 1 || typeof edit.replacementText !== 'string') {
        return matches;
    }

    const structuralKind = inferStructuralKind(edit.replacementText, edit.symbolName);
    if (!structuralKind) {
        return matches;
    }

    const filtered = matches.filter(match => candidateMatchesStructuralKind(match, structuralKind));
    return filtered.length > 0 ? filtered : matches;
}

function inferStructuralKind(replacementText: string, symbolName: string | undefined): 'class' | 'enum' | 'interface' | 'type' | 'constructor' | 'method' | undefined {
    const trimmed = replacementText.trimStart();
    if (/^(abstract\s+)?class\b/.test(trimmed)) {
        return 'class';
    }
    if (/^enum\b/.test(trimmed)) {
        return 'enum';
    }
    if (/^(interface|mixin)\b/.test(trimmed)) {
        return 'interface';
    }
    if (/^(typedef|type)\b/.test(trimmed)) {
        return 'type';
    }
    if (symbolName && new RegExp(`^${escapeRegExp(symbolName)}\\s*\\(`).test(trimmed)) {
        return 'constructor';
    }
    // Detect methods, overrides, getters and setters (common in Dart/Flutter widgets)
    if (/^(@\w+\s+)*(static\s+|final\s+|const\s+)*(void|Widget|String|int|double|bool|dynamic|Future|Stream|List|Map|Set|Object|BuildContext|\w+\??)\s+\w+\s*[(<]/.test(trimmed)
        || /^(@\w+\s+)*get\s+\w+/.test(trimmed)
        || /^(@\w+\s+)*set\s+\w+/.test(trimmed)) {
        return 'method';
    }
    return undefined;
}

function candidateMatchesStructuralKind(candidate: SymbolCandidate, structuralKind: 'class' | 'enum' | 'interface' | 'type' | 'constructor' | 'method'): boolean {
    const nodeType = candidate.nodeType?.toLowerCase() ?? '';
    if (!nodeType) {
        return true; // If we don't know the type, assume it's a match to avoid over-filtering
    }
    switch (structuralKind) {
        case 'class':
            return nodeType.includes('class');
        case 'enum':
            return nodeType.includes('enum');
        case 'interface':
            return nodeType.includes('interface') || nodeType.includes('mixin');
        case 'type':
            return nodeType.includes('type') || nodeType.includes('typedef') || nodeType.includes('alias');
        case 'constructor':
            return nodeType.includes('constructor') || nodeType === 'method' || nodeType === 'function'; // Constructors are often typed as methods
        case 'method':
            return nodeType.includes('method') || nodeType.includes('function') || nodeType.includes('getter') || nodeType.includes('setter');
    }
}

function pathsEqual(actualPath: string[], requestedPath: string[]): boolean {
    if (actualPath.length !== requestedPath.length) {
        return false;
    }
    return actualPath.every((part, index) => part === requestedPath[index]);
}

function findAllIndexes(content: string, searchText: string): number[] {
    if (!searchText.length) {
        return [];
    }

    const indexes: number[] = [];
    let index = content.indexOf(searchText);
    while (index !== -1) {
        indexes.push(index);
        index = content.indexOf(searchText, index + Math.max(searchText.length, 1));
    }
    return indexes;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
