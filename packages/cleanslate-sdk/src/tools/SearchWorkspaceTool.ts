/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CleanSlateTool, CleanSlateToolContext } from './types.js';
import { grepSearchTool } from './GrepSearchTool.js';

/**
 * Tool: search_workspace (Keyword Search)
 * Redundant legacy tool now mapped perfectly to ripgrep native search.
 */
export const searchWorkspaceTool: CleanSlateTool = {
    name: 'search_workspace',
    description: 'Searches for case-insensitive text across the ENTIRE workspace. Input: { query: string }. Returns: Array<{ path: string, matches: Array<{ line: number, text: string }> }>',
    parametersSchema: {
        query: "string"
    },
    category: "discovery",
    async run(input: { query: string }, context: CleanSlateToolContext): Promise<any> {
        return grepSearchTool.run({ query: input.query, caseSensitive: false, isRegex: false }, context);
    }
};
