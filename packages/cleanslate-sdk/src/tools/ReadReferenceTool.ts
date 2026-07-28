/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CleanSlateTool, CleanSlateToolContext } from './types.js';

/**
 * Tool: read_reference
 */
export const readReferenceTool: CleanSlateTool = {
    name: 'read_reference',
    description: 'Retrieves the full content of a "sniped" tool result using its Reference ID. Input: { referenceId: string }. Returns: { content: string }',
    parametersSchema: {
        referenceId: "string - The Unique ID provided in the previous tool output placeholder (e.g. REF-123)"
    },
    category: "system",
    async run(input: { referenceId: string }, _context: CleanSlateToolContext): Promise<any> {
        // The implementation is handled in CleanSlateAgent by looking up its internal referenceBuffer
        return { 
            success: true, 
            isReferenceRequest: true,
            referenceId: input.referenceId 
        };
    }
};
