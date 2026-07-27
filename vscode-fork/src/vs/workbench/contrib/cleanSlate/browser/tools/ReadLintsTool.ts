/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MarkerSeverity } from '../../../../../platform/markers/common/markers.js';
import { CleanSlateTool, CleanSlateToolContext } from './types.js';
import { resolvePathToUri } from './utils.js';

/**
 * Tool: read_lints
 */
export const readLintsTool: CleanSlateTool = {
    name: 'read_lints',
    description: 'Reads diagnostics (errors, warnings, hints) from the VS Code marker service. Input: { path?: string, paths?: string[] }. If path or paths are provided, returns lints for those files. If omitted, returns lints for the whole workspace.',
    parametersSchema: {
        path: "string (optional)",
        paths: "string[] (optional) - Preferred after multi-file edits; scopes diagnostics to these files."
    },
    category: "discovery",
    planningHint: "Use after edits to verify there are no new syntax or compiler errors.",

    async run(input: { path?: string; paths?: string[] }, context: CleanSlateToolContext): Promise<any> {
        const requestedPaths = [
            ...(typeof input.path === 'string' && input.path.trim().length > 0 ? [input.path] : []),
            ...(Array.isArray(input.paths) ? input.paths.filter((path): path is string => typeof path === 'string' && path.trim().length > 0) : [])
        ];
        const uniquePaths = [...new Set(requestedPaths)];

        const resources = [];
        for (const path of uniquePaths) {
            try {
                resources.push(resolvePathToUri(path, context));
            } catch (error) {
                return { success: false, message: `Invalid path: ${path}` };
            }
        }

        const markers = resources.length > 0
            ? resources.flatMap(resource => context.markerService.read({ resource }))
            : context.markerService.read({});

        // Filter to errors and warnings only, or include all?
        // Let's include everything but label them.
        const results = markers.map(marker => {
            // Broadcast focus lines for each significant diagnostic
            if (context.recentFocusLines && marker.resource) {
                const uriStr = marker.resource.toString();
                if (!context.recentFocusLines.has(uriStr)) {
                    context.recentFocusLines.set(uriStr, new Set());
                }
                const focusSet = context.recentFocusLines.get(uriStr)!;
                for (let i = marker.startLineNumber; i <= marker.endLineNumber; i++) {
                    focusSet.add(i);
                }
            }

            return {
                severity: MarkerSeverity.toString(marker.severity),
                message: marker.message,
                startLineNumber: marker.startLineNumber,
                startColumn: marker.startColumn,
                endLineNumber: marker.endLineNumber,
                endColumn: marker.endColumn,
                source: marker.source,
                code: marker.code,
                resource: marker.resource?.fsPath ?? marker.resource?.toString()
            };
        });

        if (results.length === 0) {
            const target = uniquePaths.length === 1
                ? uniquePaths[0]
                : uniquePaths.length > 1
                    ? `${uniquePaths.length} files`
                    : 'workspace';
            return {
                success: true,
                message: `No lints found in ${target}.`,
                errors: []
            };
        }

        // Group by resource for easier reading if it's a workspace search
        return {
            success: true,
            scopedPaths: uniquePaths,
            errors: results
        };
    }
};
