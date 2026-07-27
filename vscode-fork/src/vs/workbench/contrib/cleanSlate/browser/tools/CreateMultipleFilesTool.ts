/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CleanSlateTool, CleanSlateToolContext } from './types.js';
import { resolvePathToUri, isUriInIdeWorkspace } from './utils.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { CleanSlateFileHistory } from '../core/cleanSlateFileHistory.js';
import { URI } from '../../../../../base/common/uri.js';

/**
 * Tool: create_multiple_files
 */
export const createMultipleFilesTool: CleanSlateTool = {
    name: 'create_multiple_files',
    description: `
Use this tool to create several files at once — ideal for scaffolding small apps.

Input: { files: [{path: string, content: string}] }
`,
    category: "creation",
    parametersSchema: {
        files: "Array<{path: string, content: string}>"
    },

    async run(input: { files: Array<{ path: string; content: string }> }, context: CleanSlateToolContext) {
        if (!input?.files || !Array.isArray(input.files) || input.files.length === 0) {
            throw new Error("Input must contain a non-empty 'files' array");
        }

        const created: string[] = [];
        const results: Array<{ path: string; added: number; deleted: number; beforeContent: string; afterContent: string; created: boolean }> = [];
        const failed: string[] = [];
        const historyEntryIds: string[] = [];

        for (const file of input.files) {
            const { path, content } = file;
            if (!path || typeof content !== 'string') {
                failed.push(path || 'missing path');
                continue;
            }

            try {
                const uri = resolvePathToUri(path, context, { allowWorkspaceRootRelativeAbsolute: false });
                if (context.modelService.getModel(uri) || await context.fileService.exists(uri)) {
                    failed.push(path);
                    continue;
                }
                const workspaceId = context.workspaceContextService.getWorkspace().id;
                const storageRoot = context.environmentService ? URI.joinPath(context.environmentService.workspaceStorageHome, workspaceId) : undefined;
                const historyEntry = await CleanSlateFileHistory.trackEdit({
                    workspaceRoot: context.workspaceContextService.getWorkspaceFolder(uri)?.uri,
                    storageRoot,
                    resource: uri,
                    fileService: context.fileService,
                    modelService: context.modelService,
                    operation: 'create_multiple_files',
                    toolName: createMultipleFilesTool.name
                });
                await context.textFileService.create([{ resource: uri, value: content, options: { overwrite: false } }]);
                let mtime: number | undefined;
                try {
                    mtime = (await context.fileService.stat(uri)).mtime;
                } catch {
                    // Creation succeeded, but metadata may be unavailable for some providers.
                }
                context.readFileState?.set(uri.toString(), {
                    path: uri.fsPath,
                    uri: uri.toString(),
                    content,
                    currentVersionId: context.modelService.getModel(uri)?.getVersionId(),
                    mtime,
                    totalLines: content.length > 0 ? content.split('\n').length : 0,
                    isPartialView: false,
                    readAt: Date.now()
                });
                // Only register the global inline-diff session (which decorates / can surface the
                // file in the shared editor) when the file belongs to the project the IDE currently
                // has open. For a cross-project Agent Manager session the file is still created on
                // disk; it just must not leak into the other project's editor. Mirrors write_file.
                if (content.length > 0 && isUriInIdeWorkspace(context, uri)) {
                    const range = new Range(1, 1, 1, 1);
                    context.editorDecorationHost?.registerPostApplySession(
                        uri,
                        [{ range, text: content }],
                        [{ range, text: '', originalStartLine: 1 }],
                        ''
                    );
                }
	                created.push(uri.fsPath);
	                results.push({
	                    path: uri.fsPath,
	                    added: content.length > 0 ? content.split('\n').length : 0,
	                    deleted: 0,
	                    beforeContent: '',
	                    afterContent: content,
	                    created: true
	                });
	                if (historyEntry?.id) {
                    historyEntryIds.push(historyEntry.id);
                }
            } catch (err) {
                console.error(`[CleanSlate] Failed to create ${path}:`, err);
                failed.push(path);
            }
        }

        let totalAdded = 0;
        for (const file of input.files) {
            totalAdded += (file.content.split('\n').length);
        }

        return {
            success: failed.length === 0,
	            affectedFiles: created,
	            path: created[0],
	            results,
	            added: totalAdded,
            deleted: 0,
            historyEntryIds,
            created,
            failed: failed.length > 0 ? failed : undefined
        };
    }
};
