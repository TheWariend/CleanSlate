/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../core/uri.js';
import { CleanSlateTool, CleanSlateToolContext } from './types.js';
import { resolvePathToUriAsync } from './utils.js';

/**
 * Tool: find_by_name
 */
export const findByNameTool: CleanSlateTool = {
    name: 'find_by_name',
    description: 'Finds files by matching their name against a pattern (simple includes). Input: { pattern: string, path?: string }. Also accepts alias { name } for compatibility. Returns: Array<string>',
    category: "discovery",
    parametersSchema: {
        pattern: "string",
        path: "string - Optional workspace-relative or absolute in-workspace directory/file scope",
        name: "string - Alias for pattern"
    },
    async run(input: { pattern?: string; name?: string; path?: string }, context: CleanSlateToolContext): Promise<any> {
        const pattern = input.pattern ?? input.name;
        if (!pattern) throw new Error('find_by_name requires a "pattern" parameter');

        // Simple implementation: search workspace for matches
        // We will scan the workspace folders and return files that include the pattern in their name.
        const results: string[] = [];
        const folders = context.workspaceContextService.getWorkspace().folders;

        // Max depth is configurable via config (defaults to 10 — covers deep monorepo structures)
        const maxDepth = Number.isFinite((context.configService.getConfiguration() as any).findMaxDepth)
            ? Math.max(1, Math.floor((context.configService.getConfiguration() as any).findMaxDepth))
            : 10;

        // Helper to crawl directory
        const crawl = async (uri: URI, depth: number) => {
            if (depth > maxDepth) return; // Configurable depth limit
            try {
                const stat = await context.fileService.resolve(uri);
                if (stat.children) {
                    for (const child of stat.children) {
                        if (child.isDirectory) {
                            await crawl(child.resource, depth + 1);
                        } else {
                            // Support for wildcards
                            const regexPattern = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex chars
                                .replace(/\*/g, '.*'); // convert * to .*
                            const regex = new RegExp(`^${regexPattern}$`, 'i');

                            if (regex.test(child.name) || child.name.toLowerCase().includes(pattern.replace(/\*/g, '').toLowerCase())) {
                                results.push(child.resource.fsPath);
                            }
                        }
                    }
                }
            } catch (err) {
                // Ignore access errors
            }
        };

        const scopedPath = input.path?.trim();
        if (scopedPath) {
            try {
                const scopedUri = await resolvePathToUriAsync(scopedPath, context);
                const stat = await context.fileService.resolve(scopedUri);
                if (stat.isDirectory) {
                    await crawl(scopedUri, 0);
                } else if (stat.name && (stat.name.toLowerCase().includes(pattern.replace(/\*/g, '').toLowerCase()) || new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i').test(stat.name))) {
                    results.push(scopedUri.fsPath);
                }
                return results;
            } catch {
                // Fall back to full workspace search if the scoped path could not be resolved.
            }
        }

        for (const folder of folders) {
            await crawl(folder.uri, 0);
        }

        return results;
    }
};
