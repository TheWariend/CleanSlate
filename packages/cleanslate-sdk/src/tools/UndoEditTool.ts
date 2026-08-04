/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CleanSlateTool, CleanSlateToolContext } from './types.js';
import { PathOutsideWorkspaceError, buildPathOutsideWorkspaceResult, isUriInIdeWorkspace, resolvePathToUriForMutationAsync } from './utils.js';
import { CleanSlateFileHistory } from '../services/cleanSlateFileHistory.js';
import { URI } from '../core/uri.js';

export const undoEditTool: CleanSlateTool = {
    name: 'undo_edit',
    description: 'Undo the last edit to a specific file. Use this if your change introduced syntax errors that you cannot easily fix.',
    parametersSchema: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Path to the file relative to the workspace root.' }
        },
        required: ['path']
    },
    async run(input: any, context: CleanSlateToolContext) {
        let uri;
        try {
            uri = await resolvePathToUriForMutationAsync(input.path, context);
        } catch (error) {
            if (error instanceof PathOutsideWorkspaceError) {
                return buildPathOutsideWorkspaceResult(input.path, error);
            }
            throw error;
        }

        try {
            // Only the visual, editor-based undo may reveal the file. For a
            // cross-project Agent Manager session the editor services are global
            // workbench singletons, so opening the file here would surface it as a
            // tab in a DIFFERENT project's window. Those sessions fall through to
            // the headless history rewind below instead.
            const revealInEditor = isUriInIdeWorkspace(context, uri);
            if (revealInEditor) {
                let model = context.modelService.getModel(uri);
                if (!model) {
                    await context.editorService.openEditor({ resource: uri });
                    model = context.modelService.getModel(uri);
                }

                const activeEditor = context.codeEditorService.getActiveCodeEditor();
                if (!activeEditor || activeEditor.getModel()?.uri.toString() !== uri.toString()) {
                    await context.codeEditorService.openCodeEditor({ resource: uri }, activeEditor);
                }

                const didUndo = context.editorDecorationHost?.undoLastTrackedEdit(uri) ?? false;
                if (didUndo) {
                    await context.textFileService.save(uri);
                    return { success: true, message: `Successfully undid the last edit to ${input.path}.` };
                }
            }

            const workspaceId = context.workspaceContextService.getWorkspace().id;
            const storageRoot = context.environmentService ? URI.joinPath(context.environmentService.workspaceStorageHome, workspaceId) : undefined;
            const historyResult = await CleanSlateFileHistory.rewind({
                workspaceRoot: context.workspaceContextService.getWorkspaceFolder(uri)?.uri,
                storageRoot,
                resource: uri,
                fileService: context.fileService,
                modelService: context.modelService,
                textFileService: context.textFileService
            });
            return {
                success: historyResult.success,
                historyEntryId: historyResult.entry?.id,
                message: historyResult.success
                    ? historyResult.message
                    : `No tracked CleanSlate edit was found for ${input.path}.`
            };
        } catch (error) {
            return { success: false, message: `Failed to undo: ${String(error)}` };
        }
    }
};
