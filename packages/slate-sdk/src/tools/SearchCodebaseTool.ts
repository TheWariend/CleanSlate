/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CleanSlateTool, CleanSlateToolContext } from './types.js';
import { runSemanticSearch } from './SemanticSearchTool.js';

/**
 * Tool: search_codebase (Semantic Search / RAG)
 */
export const searchCodebaseTool: CleanSlateTool = {
    name: 'search_codebase',
    description: 'Compatibility alias for semantic_search. Performs semantic search across the indexed codebase. Input: { query: string, limit?: number, threshold?: number }. Defaults to top 8 chunks.',
    parametersSchema: {
        query: "string",
        limit: "number",
        threshold: "number"
    },
    category: "discovery",
    async run(input: { query: string; limit?: number; threshold?: number }, context: CleanSlateToolContext): Promise<any> {
        const { query } = input;
        if (!query) throw new Error('search_codebase requires a "query" parameter');
        try {
            return await runSemanticSearch(input, context);
        } catch (error) {
            throw new Error(`Semantic search failed: ${error}`);
        }
    }
};
