/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../core/uri.js';
import { Position } from '../core/position.js';
import { ISlateTextModel } from '../host/textModel.js';
import { CleanSlateToolContext } from './types.js';
import { isUriInIdeWorkspace } from './utils.js';

export async function resolveBackgroundLanguageFeatureModel(
    uri: URI,
    context: CleanSlateToolContext
): Promise<ISlateTextModel | undefined> {
    let model = context.modelService.getModel(uri);
    if (model) {
        return model;
    }

    try {
        await context.textFileService.files.resolve(uri);
    } catch (error) {
        console.info(`[CleanSlateEdit] lsp_fire: file resolve failed for ${uri.fsPath}: ${String(error)}`);
    }
    model = context.modelService.getModel(uri);
    if (model) {
        return model;
    }

    // Only fall back to opening a real editor when the file belongs to the
    // workspace the IDE currently has open. `editorService`/`codeEditorService`
    // are the global workbench singletons, so for a cross-project Agent Manager
    // session an openEditor here would surface the session's file as a tab in a
    // DIFFERENT project's window (the file "leak"). Keep LSP warm-up headless in
    // that case; the file resolve above already loaded the model if it could.
    if (!isUriInIdeWorkspace(context, uri)) {
        return context.modelService.getModel(uri) ?? undefined;
    }

    try {
        await context.editorService.openEditor({
            resource: uri,
            options: {
                preserveFocus: true,
                pinned: false,
                inactive: true,
                revealIfVisible: false,
                revealIfOpened: false
            }
        });
    } catch (error) {
        console.info(`[CleanSlateEdit] lsp_fire: background open failed for ${uri.fsPath}: ${String(error)}`);
    }

    return context.modelService.getModel(uri) ?? undefined;
}

export async function fireLanguageServerForUri(
    uri: URI,
    context: CleanSlateToolContext,
    command?: { id: string; args: unknown[] }
): Promise<unknown[] | undefined> {
    const model = await resolveBackgroundLanguageFeatureModel(uri, context);

    if (!context.commandService || !command) {
        return undefined;
    }

    // ── Synchronization Buffer for Large Files ────────────────────────────────
    // In large files (> 500 lines), the Language Server (LSP) re-indexes in the background
    // after a mutation. If we fire a command immediately, we get stale coordinates.
    if (model && model.getLineCount() > 500) {
        console.info(`[CleanSlateSync] Large file detected (${model.getLineCount()} lines). Waiting for LSP to stabilize...`);
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    try {
        const result = await context.commandService.executeCommand(command.id, ...command.args);
        return normalizeLanguageFeatureCommandResult(result);
    } catch (error) {
        console.info(`[CleanSlateEdit] lsp_fire: ${command.id} failed for ${uri.fsPath}: ${String(error)}`);
        return undefined;
    }
}

export async function fireDocumentSymbolProvider(
    uri: URI,
    context: CleanSlateToolContext
): Promise<unknown[] | undefined> {
    return fireLanguageServerForUri(uri, context, {
        id: '_executeDocumentSymbolProvider',
        args: [uri]
    });
}

export async function fireDefinitionProvider(
    uri: URI,
    position: Position,
    context: CleanSlateToolContext
): Promise<unknown[] | undefined> {
    return fireLanguageServerForUri(uri, context, {
        id: '_executeDefinitionProvider',
        args: [uri, position]
    });
}

export async function fireReferenceProvider(
    uri: URI,
    position: Position,
    context: CleanSlateToolContext
): Promise<unknown[] | undefined> {
    return fireLanguageServerForUri(uri, context, {
        id: '_executeReferenceProvider',
        args: [uri, position]
    });
}

function normalizeLanguageFeatureCommandResult(result: unknown): unknown[] | undefined {
    if (Array.isArray(result)) {
        return result;
    }
    if (result) {
        return [result];
    }
    return undefined;
}
