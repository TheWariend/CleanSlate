/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CleanSlateTool, CleanSlateToolContext } from './types.js';
import { isFileMatch, resultIsMatch } from '../../../../services/search/common/search.js';
import { resolvePathToUri } from './utils.js';
import { isStaleGeneratedDiagnosticPath } from './cleanSlateStaleDiagnosticPolicy.js';

/**
 * Tool: grep_search
 * Real exact/case-sensitive text search powered by VS Code search service.
 */
export const grepSearchTool: CleanSlateTool = {
    name: 'grep_search',
    description: 'Searches for EXACT text matches across workspace files (cross-platform, powered by ripgrep engine). Input: { query: string, path?: string, caseSensitive?: boolean, isRegex?: boolean }. Also accepts alias { pattern, SearchPath }. Returns matches with line numbers.',
    category: "discovery",
    parametersSchema: {
        query: "string",
        path: "string - Optional workspace-relative or absolute in-workspace file/directory scope",
        pattern: "string - Alias for query",
        SearchPath: "string - Alias for path",
        caseSensitive: "boolean (default: false)",
        isRegex: "boolean (default: false)"
    },
    async run(input: { query?: string; pattern?: string; path?: string; SearchPath?: string; caseSensitive?: boolean; isRegex?: boolean }, context: CleanSlateToolContext): Promise<any> {
        const query = input.query ?? input.pattern;
        const { caseSensitive = false, isRegex = false } = input;
        if (!query) throw new Error('grep_search requires a "query" parameter');
        
        if (!context.searchService) {
            return [{ system_warning: 'grep_search failed: searchService unavailable in this runtime.' }];
        }

        const workspaceFolders = context.workspaceContextService.getWorkspace().folders;
        if (workspaceFolders.length === 0) {
            return []; // No workspace, no search
        }

        const normalizedScope = (() => {
            const requestedScope = input.path?.trim() || input.SearchPath?.trim();
            if (!requestedScope) {
                return undefined;
            }
            try {
                return resolvePathToUri(requestedScope, context).fsPath.replace(/\\/g, '/').toLowerCase();
            } catch {
                return undefined;
            }
        })();

        const resultsMap = new Map<string, any[]>();

        try {
            await context.searchService.textSearch({
                type: 2, // QueryType.Text
                contentPattern: {
                    pattern: query,
                    isCaseSensitive: caseSensitive,
                    isRegExp: isRegex,
                    isWordMatch: false
                },
                folderQueries: workspaceFolders.map((f: any) => ({ folder: f.uri })),
                surroundingContext: 0 
            }, undefined, (progress) => {
                if (isFileMatch(progress)) {
                    const resourcePath = progress.resource.fsPath;
                    const normalizedResourcePath = resourcePath.replace(/\\/g, '/').toLowerCase();
                    if (normalizedScope && !(normalizedResourcePath === normalizedScope || normalizedResourcePath.startsWith(`${normalizedScope}/`))) {
                        return;
                    }
                    if (!resultsMap.has(resourcePath)) {
                        resultsMap.set(resourcePath, []);
                    }

                    if (progress.results) {
                        for (const result of progress.results) {
                            if (resultIsMatch(result)) {
                                resultsMap.get(resourcePath)!.push({
                                    line: result.rangeLocations[0].source.startLineNumber,
                                    text: result.previewText.trim()
                                });
                            }
                        }
                    }
                }
            });

            const results: any[] = [];
            for (const [path, matches] of resultsMap.entries()) {
                if (matches.length > 0 && !isStaleGeneratedDiagnosticPath(path)) {
                    results.push({ path, matches });
                }
            }

            return results;
        } catch (e: any) {
            return [{ system_warning: `grep_search failed: ${String(e?.message || e)}` }];
        }
    }
};
