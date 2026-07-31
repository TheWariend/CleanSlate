/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CleanSlateTool, CleanSlateToolContext } from './types.js';
import { resolvePathToUriAsync } from './utils.js';

/**
 * Tool: list_dir
 */
export const listDirTool: CleanSlateTool = {
    name: 'list_dir',
    description: 'Lists files and directories in a given path. Input: { path: string }. Returns: Array<{ name: string, type: "file" | "dir" }>',
    category: "discovery",
    parametersSchema: {
        path: "string"
    },
    async run(input: { path: string }, context: CleanSlateToolContext): Promise<any> {
        const { path } = input;
        if (!path) throw new Error('list_dir requires a "path" parameter');

        try {
            const uri = await resolvePathToUriAsync(path, context);
            const stat = await context.fileService.resolve(uri);
            if (!stat.children) return [];

            return stat.children.map((child: any) => ({
                name: child.name,
                type: child.isDirectory ? 'dir' : 'file'
            }));
        } catch (error) {
            // Return a structured error so the agent can pivot gracefully
            return {
                success: false,
                message: `Directory not found: "${path}". This path might not exist in the current workspace. Try listing the root directory "." to see the actual project structure.`
            };
        }
    }
};
