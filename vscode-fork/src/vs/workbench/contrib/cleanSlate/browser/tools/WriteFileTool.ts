/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { CleanSlateTool, CleanSlateToolContext } from './types.js';
import { resolvePathToUri, isDocumentationFile, isUriInIdeWorkspace } from './utils.js';
import { InlineCleanSlateController } from '../../../../../editor/browser/cleanSlate/core/inlineCleanSlateController.js';
import { CleanSlateFileHistory } from '../core/cleanSlateFileHistory.js';
import { applyEditTool } from './ApplyEditTool.js';

/**
 * Tool: write_file
 */
export const writeFileTool: CleanSlateTool = {
    name: 'write_file',
    description: `Writes the complete contents of a file. Creates the file when it does not exist and replaces it when it does.
Use this for new files and intentional whole-file rewrites. Existing files must have been read in full first; stale or partial reads are rejected. Use apply_edit for localized changes.
Input: { file_path: string, content: string, open?: boolean }`,
    category: "edit",
    parametersSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            file_path: { type: 'string', description: 'The absolute path to create or replace.' },
            content: { type: 'string', description: 'The complete desired file contents.' },
            open: { type: 'boolean', description: 'Whether to reveal a newly created file. Defaults to true.' }
        },
        required: ['file_path', 'content']
    },

    async run(input: { file_path?: string; path?: string; content: string; open?: boolean }, context: CleanSlateToolContext): Promise<any> {
        const requestedPath = input.file_path ?? input.path;
        const { content } = input;

        if (!requestedPath) throw new Error('file_path is required');
        if (content === undefined || content === null) throw new Error('content is required (use empty string for empty files)');

        try {
            const uri = resolvePathToUri(requestedPath, context, { allowWorkspaceRootRelativeAbsolute: false });
            const exists = !!context.modelService.getModel(uri) || await context.fileService.exists(uri);
            if (exists) {
                const result = await applyEditTool.run({
                    path: requestedPath,
                    edits: [{ mode: 'full_file', content }],
                    historyOperation: 'write_file',
                    historyToolName: writeFileTool.name
                }, context);
                if (result?.success === false) {
                    return {
                        ...result,
                        recoveryHint: result.recoveryHint
                            ?? 'Read the complete current file, then retry write_file with the intended full content.'
                    };
                }

                const beforeContent = typeof result?.beforeContent === 'string'
                    ? result.beforeContent
                    : content;
                const afterContent = typeof result?.afterContent === 'string'
                    ? result.afterContent
                    : content;
                const changed = beforeContent !== afterContent;
                return {
                    ...result,
                    success: true,
                    persisted: true,
                    created: false,
                    updated: changed,
                    operation: changed ? 'updated' : 'unchanged',
                    path: uri.fsPath,
                    beforeContent,
                    afterContent,
                    message: changed
                        ? `Replaced the complete contents of ${uri.fsPath}.`
                        : `The file ${uri.fsPath} already has the requested contents.`
                };
            }

            // Production semantics: this tool must create the file with its actual content.
            // Preview-first behavior made the agent believe writes had landed when they had not.
            const isDoc = isDocumentationFile(requestedPath);
            const workspaceId = context.workspaceContextService.getWorkspace().id;
            const storageRoot = context.environmentService ? URI.joinPath(context.environmentService.workspaceStorageHome, workspaceId) : undefined;
            const historyEntry = await CleanSlateFileHistory.trackEdit({
                workspaceRoot: context.workspaceContextService.getWorkspaceFolder(uri)?.uri,
                storageRoot,
                resource: uri,
                fileService: context.fileService,
                modelService: context.modelService,
                operation: 'write_file',
                toolName: writeFileTool.name
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

            // 2. Reveal the new file in the editor only when it belongs to the project the IDE
            // currently has open. For a cross-project Agent Manager session the file is still
            // written to disk; it just must not leak into the other project's editor.
            const revealInEditor = input.open !== false && isUriInIdeWorkspace(context, uri);
            if (revealInEditor) {
                await context.codeEditorService.openCodeEditor({
                    resource: uri,
                    options: { pinned: true, preserveFocus: false }
                }, context.codeEditorService.getActiveCodeEditor());
            }

            const added = content.length > 0 ? content.split('\n').length : 0;
            const deleted = 0;

            if (revealInEditor && !isDoc && content.length > 0) {
                const range = new Range(1, 1, 1, 1);
                InlineCleanSlateController.registerPostApplySession(
                    context.codeEditorService,
                    uri,
                    [{ range, text: content }],
                    [{ range, text: '', originalStartLine: 1 }],
                    ''
                );
            }

            return {
                success: true,
                created: true,
                updated: false,
                persisted: true,
                operation: 'created',
                path: uri.fsPath,
                historyEntryId: historyEntry?.id,
                added,
                deleted,
                beforeContent: '',
                afterContent: content,
                message: isDoc
                    ? `Created documentation file: ${uri.fsPath}`
                    : `Created file and wrote content to disk: ${uri.fsPath}`
            };
        } catch (err) {
            throw new Error(`Failed to write ${requestedPath}: ${String(err)}`);
        }
    }
};
