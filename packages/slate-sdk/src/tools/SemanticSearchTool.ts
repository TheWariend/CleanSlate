/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CleanSlateTool, CleanSlateToolContext } from './types.js';

export interface ISemanticSearchInput {
    query: string;
    limit?: number;
    threshold?: number;
}

export async function runSemanticSearch(input: ISemanticSearchInput, context: CleanSlateToolContext): Promise<any[]> {
    const query = typeof input.query === 'string' ? input.query.trim() : '';
    if (!query) {
        throw new Error('semantic_search requires a "query" parameter');
    }

    const limit = Number.isFinite(input.limit)
        ? Math.max(1, Math.min(20, Math.floor(input.limit!)))
        : 8;
    const threshold = Number.isFinite(input.threshold)
        ? Math.max(-1, Math.min(1, Number(input.threshold)))
        : 0.2;

    const results = await context.indexService.search(query, limit, threshold) as any[];
    return results.map((result: any) => ({
        path: result.uri.fsPath,
        content: result.content,
        score: result.score,
        range: result.range
    }));
}

/**
 * Tool: semantic_search (Manual RAG / Foraging)
 */
export const semanticSearchTool: CleanSlateTool = {
    name: 'semantic_search',
    description: 'Manually performs semantic RAG search across the indexed codebase when the injected snippets are insufficient. Input: { query: string, limit?: number, threshold?: number }. Defaults to the top 8 chunks.',
    parametersSchema: {
        query: 'string',
        limit: 'number',
        threshold: 'number'
    },
    category: 'discovery',
    planningHint: 'Use before read_file when you need more relevant code areas than the current turn snippets provide.',

    async run(input: ISemanticSearchInput, context: CleanSlateToolContext): Promise<any> {
        try {
            return await runSemanticSearch(input, context);
        } catch (error) {
            throw new Error(`Semantic search failed: ${error}`);
        }
    }
};
