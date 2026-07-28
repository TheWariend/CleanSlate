/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CleanSlateTool, CleanSlateToolContext } from './types.js';

/**
 * Tool: get_open_files
 */
export const getOpenFilesTool: CleanSlateTool = {
    name: 'get_open_files',
    description: 'Returns list of open files. No input required.',
    category: "context",
    parametersSchema: {},
    async run(_input: any, context: CleanSlateToolContext): Promise<any> {
        const ctx = await context.contextService.getContext();
        const openFilePaths = ctx.openFiles.map(file => file.uri.fsPath);
        return {
            files: [ctx.activeFile?.uri.fsPath, ...openFilePaths].filter((path): path is string => typeof path === 'string' && path.length > 0)
        };
    }
};
