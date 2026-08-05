/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { CleanSlateReadFileState, CleanSlateTool, CleanSlateToolContext } from './types.js';
import { PathOutsideWorkspaceError, buildPathOutsideWorkspaceResult, isUriInIdeWorkspace, resolvePathToUriForMutationAsync, resolveTextModelHeadless } from './utils.js';
import { URI } from '../core/uri.js';
import { ISlateTextModel } from '../host/textModel.js';
import { CleanSlateEditService, CleanSlatePlannedEdit, CleanSlateStructuredEdit } from '../services/cleanSlateEditService.js';
import { CleanSlateDiffService } from '../services/cleanSlateDiffService.js';
import { canonicalizeStructuredEdits } from './structuredEditCanonicalizer.js';
import { CleanSlateFileHistory } from '../services/cleanSlateFileHistory.js';

export interface ApplyEditInput {
    file_path?: string;
    old_string?: string;
    new_string?: string;
    replace_all?: boolean;
    /** Internal compatibility shape for sessions created before the edit-contract migration. */
    path?: string;
    edits?: CleanSlateStructuredEdit[];
    expectedVersionId?: number;
    /** Internal attribution used when another mutation tool delegates to this engine. */
    historyOperation?: string;
    historyToolName?: string;
}

/**
 * Tool: apply_edit
 */
export const applyEditTool: CleanSlateTool = {
    name: 'apply_edit',
    description: 'Performs an exact string replacement in an existing file. The file must have been read first. old_string must identify one current occurrence unless replace_all is true. Successful edits update the host read state, so the file only needs to be read again after an external change or a failed match.',
    category: "edit",
    parametersSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            file_path: { type: 'string', description: 'The absolute path to the file to modify.' },
            old_string: { type: 'string', description: 'The exact current text to replace. Include enough surrounding text to make it unique.' },
            new_string: { type: 'string', description: 'The replacement text. It must differ from old_string.' },
            replace_all: { type: 'boolean', description: 'Replace every exact occurrence of old_string. Defaults to false.' }
        },
        required: ['file_path', 'old_string', 'new_string']
    },
    async run(input: ApplyEditInput, context: CleanSlateToolContext): Promise<any> {
        // Restored sessions may still carry the old structured shape, but new
        // model calls only see the exact-string schema above.
        const requestedPath = input.file_path ?? input.path;
        if (!requestedPath) throw new Error('apply_edit: The "file_path" parameter is required.');
        input = { ...input, path: requestedPath };
        let uri: URI;
        try {
            uri = await resolvePathToUriForMutationAsync(requestedPath, context);
        } catch (error) {
            if (error instanceof PathOutsideWorkspaceError) {
                return buildPathOutsideWorkspaceResult(requestedPath, error);
            }
            throw error;
        }
        // Reveal/decorate the edit in the IDE editor only when the file belongs to the project the
        // IDE currently has open. A cross-project Agent Manager session still applies the edit to
        // disk headlessly; it just must not surface the file in the other project's editor.
        const revealInEditor = isUriInIdeWorkspace(context, uri);

        try {
            // 0. Force background resolution to 'warm up' the Language Server for this file
            await context.textFileService.files.resolve(uri);

            // 1. Resolve the model (without opening a visible editor).
            let model = context.modelService.getModel(uri);
            if (!model) {
                model = await resolveTextModelHeadless(uri, context);
            }
            if (!model) throw new Error(`apply_edit: Could not load model for ${requestedPath}.`);

            // Only bring the file into a visible editor when revealing in the IDE is appropriate.
            let editor: ReturnType<typeof context.codeEditorService.getActiveCodeEditor> = null;
            if (revealInEditor) {
                const activeEditor = context.codeEditorService.getActiveCodeEditor();
                try {
                    if (!activeEditor || activeEditor.getModel()?.uri.toString() !== uri.toString()) {
                        await context.codeEditorService.openCodeEditor({ resource: uri }, activeEditor);
                    }
                    editor = context.codeEditorService.getActiveCodeEditor();
                } catch {
                    editor = null;
                }
                // No editor means nothing to reveal into — a headless host, or a
                // reveal the workbench declined. The edit still applies to disk;
                // only the on-screen diff is skipped.
            }
            const beforeContent = model.getValue();
            const beforeVersionId = model.getVersionId();
            const normalizedRequest = normalizeApplyEditRequest(input, beforeContent);
            if (!normalizedRequest.ok) {
                return { success: false, path: uri.fsPath, ...normalizedRequest.result };
            }
            input = { ...input, edits: normalizedRequest.edits };
            const readGuard = await validateReadBeforeEdit(uri, beforeVersionId, input, context, beforeContent);
            if (!readGuard.ok) {
                return readGuard.result;
            }

			// 2. Canonicalize the exact replacement (legacy restored sessions may still carry structured edits).
            const canonicalizedEdits = await canonicalizeStructuredEdits(requestedPath, model, input.edits!, context);
            if (!canonicalizedEdits.ok) {
                return canonicalizedEdits.failure;
            }
            const rangeBudgetGuard = validateSourceCodeRangeEditBudget(model, canonicalizedEdits.edits, uri.fsPath);
            if (!rangeBudgetGuard.ok) {
                return rangeBudgetGuard.result;
            }
            const versionGuard = resolveSafeExpectedVersionId(
                model,
                input,
                readGuard.readState,
                canonicalizedEdits.edits,
                uri.fsPath
            );
            if (!versionGuard.ok) {
                return versionGuard.result;
            }

            const plan = CleanSlateEditService.planEdits(model, {
                edits: canonicalizedEdits.edits,
                expectedVersionId: versionGuard.expectedVersionId
            });

            if (!plan.ok) {
                const primaryDiagnostic = plan.diagnostics[0];
                return {
                    success: false,
                    path: uri.fsPath,
                    code: primaryDiagnostic?.code ?? 'invalid_input',
                    primaryDiagnostic,
                    diagnostics: plan.diagnostics,
                    allMatches: primaryDiagnostic?.allMatches,
                    recoveryHint: CleanSlateEditService.buildRecoveryHint(primaryDiagnostic, model),
                    attemptedEdits: input.edits!.length,
                    currentVersionId: model.getVersionId(),
                    message: CleanSlateEditService.formatFailure(plan)
                };
            }

            const rewriteAssessment = assessRewriteScope(model, plan.edits, uri.fsPath);

			// Keep the write path deterministic and extension-host independent.
			// Syntax/semantic diagnostics are collected after the edit through the
			// normal editor marker pipeline instead of invoking Tree-sitter here.
			const preflightDiagnostics: any[] = [];

            // 3. Capture Pre-Application State
            const appliedChanges = plan.edits.map((e: CleanSlatePlannedEdit) => ({
                range: e.range,
                oldText: model.getValueInRange(e.range),
                newText: e.text,
                strategy: e.strategy,
                sourceMode: e.sourceMode,
                confidence: e.confidence,
                matchCount: e.matchCount
            }));
            const plannedAdded = appliedChanges.reduce((sum, change) => sum + change.newText.split('\n').length, 0);
            const plannedDeleted = appliedChanges.reduce((sum, change) => sum + change.oldText.split('\n').length, 0);
            const workspaceId = context.workspaceContextService.getWorkspace().id;
            const storageRoot = context.environmentService ? URI.joinPath(context.environmentService.workspaceStorageHome, workspaceId) : undefined;
            const historyEntry = await CleanSlateFileHistory.trackEdit({
                workspaceRoot: context.workspaceContextService.getWorkspaceFolder(uri)?.uri,
                storageRoot,
                resource: uri,
                fileService: context.fileService,
                modelService: context.modelService,
                operation: input.historyOperation ?? 'apply_edit',
                toolName: input.historyToolName ?? applyEditTool.name,
                versionId: beforeVersionId
            });
            const markerBaseline = CleanSlateEditService.captureMarkerValidationBaseline(context.markerService, uri);
            const markerRefreshWaiter = CleanSlateEditService.createMarkerRefreshWaiter(context.markerService, uri);

            // 4. PHYSICAL APPLICATION (in-memory first; persisted only after validation)
            const commitReadGuard = await validateReadBeforeEdit(uri, beforeVersionId, input, context, beforeContent);
            if (!commitReadGuard.ok) {
                markerRefreshWaiter.dispose();
                return commitReadGuard.result;
            }
            try {
                model.pushStackElement(); // Create undo point
                model.pushEditOperations(null, plan.edits.map((e: { range: any, text: string }) => ({ range: e.range, text: e.text })), () => null);
                model.pushStackElement();
            } catch (error) {
                markerRefreshWaiter.dispose();
                throw error;
            }

            // 5. PRE-SAVE VALIDATION
            const markerValidation = await CleanSlateEditService.validateMarkersAfterEdit(
                context.markerService,
                uri,
                markerBaseline,
                markerRefreshWaiter
            );
            const postApplyDiagnostics = markerValidation.ok ? [] : markerValidation.issues;

            // 6. AUTO-SAVE ENFORCEMENT
            await context.textFileService.save(uri);
            const afterContent = model.getValue();
            const afterVersionId = model.getVersionId();
            context.readFileState?.set(uri.toString(), {
                path: uri.fsPath,
                uri: uri.toString(),
                content: afterContent,
                currentVersionId: afterVersionId,
                mtime: await getFileMtime(uri, context),
                totalLines: afterContent.split('\n').length,
                isPartialView: false,
                readAt: Date.now()
            });

            if (afterContent === beforeContent) {
                return {
                    success: true,
                    path: uri.fsPath,
                    code: 'no_op',
                    attemptedEdits: input.edits!.length,
                    currentVersionId: afterVersionId,
                    rewriteAssessment,
                    message: `NO_OP: The file content already matches the target for ${uri.fsPath}. No changes were necessary.`
                };
            }

            // 7. Visual Decorations (Post-Apply Mode) — only when the file was revealed in the IDE.
            if (editor && context.editorDecorationHost) {
                // The host expects originalEdits shaped for the diff overlay.
                const originalEditsForUI = appliedChanges.map(c => ({
                    range: c.range,
                    text: c.oldText,
                    originalStartLine: c.range.startLineNumber
                }));
                context.editorDecorationHost.showPostApply(uri, plan.edits, originalEditsForUI, beforeContent);
            }

            // 8. Generate Granular Feedback for the Agent
            const totalLinesChanged = appliedChanges.reduce((sum, c) => sum + (c.range.endLineNumber - c.range.startLineNumber + 1), 0);
            const diffSnippet = CleanSlateDiffService.renderUnifiedDiff(uri.fsPath, beforeContent, plan.edits.map(e => ({ range: e.range, text: e.text })));
            const appliedWithDiagnostics = preflightDiagnostics.length > 0 || postApplyDiagnostics.length > 0;
            const diagnosticsSummary = [
                ...preflightDiagnostics.map(diagnostic => `[${diagnostic.code}] ${diagnostic.message}`),
                ...postApplyDiagnostics.map(issue => `[marker] ${issue.message} (${issue.startLineNumber}:${issue.startColumn})`)
            ];

            return {
                success: true,
                path: uri.fsPath,
                appliedBlocks: plan.edits.length,
                added: plannedAdded,
                deleted: plannedDeleted,
                totalLinesChanged,
                strategies: [...new Set(plan.edits.map(edit => edit.strategy))],
                previousVersionId: beforeVersionId,
                currentVersionId: afterVersionId,
                versionGuardAdjustedFrom: versionGuard.adjustedFrom,
                historyEntryId: historyEntry?.id,
                rewriteAssessment,
                appliedWithDiagnostics,
                diagnostics: diagnosticsSummary,
                preflightDiagnostics,
                postApplyDiagnostics,
                changes: appliedChanges.map(c => ({
                    lines: `${c.range.startLineNumber}-${c.range.endLineNumber}`,
                    strategy: c.strategy,
                    sourceMode: c.sourceMode,
                    confidence: c.confidence,
                    matchCount: c.matchCount,
                    preview: `-${c.oldText.split('\n')[0]}\n+${c.newText.split('\n')[0]}`
                })),
                diff: diffSnippet,
                beforeContent,
                afterContent,
                message: appliedWithDiagnostics
                    ? `SUCCESS WITH DIAGNOSTICS: Applied ${plan.edits.length} change(s) to ${uri.fsPath}. New syntax/compiler diagnostics were preserved for the agent to fix in follow-up edits.`
                    : `SUCCESS: Applied ${plan.edits.length} change(s) to ${uri.fsPath}. See 'diff' for details.`
            };
        } catch (err) {
            throw new Error(`Failed to apply edit to ${requestedPath}: ${String(err)}`);
        }
    }
};

export function normalizeApplyEditRequest(
    input: ApplyEditInput,
    currentContent: string
): { ok: true; edits: CleanSlateStructuredEdit[] } | { ok: false; result: any } {
    if (typeof input.old_string === 'string' || typeof input.new_string === 'string') {
        if (typeof input.old_string !== 'string' || typeof input.new_string !== 'string') {
            return {
                ok: false,
                result: {
                    code: 'invalid_input',
                    message: 'apply_edit requires both "old_string" and "new_string".'
                }
            };
        }
        if (input.old_string.length === 0) {
            return {
                ok: false,
                result: {
                    code: 'invalid_input',
                    message: 'apply_edit edits existing files; "old_string" must not be empty. Use write_file for a new file.'
                }
            };
        }
        if (input.old_string === input.new_string) {
            return {
                ok: false,
                result: {
                    code: 'no_op',
                    message: 'No changes to make: old_string and new_string are exactly the same.'
                }
            };
        }

        const actualOldString = findActualString(currentContent, input.old_string);
        if (!actualOldString) {
            return {
                ok: false,
                result: {
                    code: 'no_match',
                    matchCount: 0,
                    message: `String to replace not found in file.\nString: ${input.old_string}`
                }
            };
        }

        const matchIndexes = findAllMatchIndexes(currentContent, actualOldString);
        if (matchIndexes.length > 1 && input.replace_all !== true) {
            return {
                ok: false,
                result: {
                    code: 'ambiguous_match',
                    matchCount: matchIndexes.length,
                    allMatches: matchIndexes.slice(0, 8).map(index => {
                        const candidate = buildMatchCandidate(currentContent, index, actualOldString.length);
                        return {
                            lineNumber: candidate.startLine,
                            endLineNumber: candidate.endLine,
                            lineContent: candidate.content,
                            confidence: 1
                        };
                    }),
                    message: `Found ${matchIndexes.length} matches of old_string. Provide more surrounding context to make it unique, or set replace_all to true.`
                }
            };
        }

        const actualNewString = CleanSlateEditService.preserveQuoteStyle(input.old_string, actualOldString, input.new_string);
        if (input.replace_all === true) {
            return {
                ok: true,
                edits: [{
                    mode: 'full_file',
                    content: currentContent.split(actualOldString).join(actualNewString)
                }]
            };
        }

        return {
            ok: true,
            edits: [{
                mode: 'replace_exact',
                originalText: actualOldString,
                replacementText: actualNewString
            }]
        };
    }

    if (Array.isArray(input.edits) && input.edits.length > 0) {
        return { ok: true, edits: input.edits };
    }

    return {
        ok: false,
        result: {
            code: 'invalid_input',
            message: 'apply_edit requires "file_path", "old_string", and "new_string".'
        }
    };
}

export async function validateReadBeforeEdit(
    uri: URI,
    currentVersionId: number,
    input: ApplyEditInput,
    context: CleanSlateToolContext,
    currentContent?: string
): Promise<{ ok: true; readState: CleanSlateReadFileState } | { ok: false; result: any }> {
    const readState = getReadFileState(uri, context);
    if (!readState) {
        return {
            ok: false,
            result: {
                success: false,
                path: uri.fsPath,
                code: 'file_not_read',
                currentVersionId,
                message: 'File has not been read yet. Read it first before editing it.',
                recoveryHint: 'Call read_file or read_file_range for the target file, then retry the edit using current content and version information.'
            }
        };
    }

    const edits = input.edits ?? [];
    const needsWholeFileRead = edits.some(edit => edit.mode === 'full_file');

    if (typeof readState.currentVersionId === 'number' && readState.currentVersionId !== currentVersionId) {
        return {
            ok: false,
            result: {
                success: false,
                path: uri.fsPath,
                code: 'file_changed',
                previousReadVersionId: readState.currentVersionId,
                currentVersionId,
                message: 'File has been modified since it was read. Re-read it before attempting to edit it.',
                recoveryHint: 'Call read_file or read_file_range again and prepare the edit from the fresh result.'
            }
        };
    }

    if (
        (typeof readState.currentVersionId !== 'number' || needsWholeFileRead)
        && !readState.isPartialView
        && typeof readState.content === 'string'
        && typeof currentContent === 'string'
        && readState.content !== currentContent
    ) {
        return {
            ok: false,
            result: {
                success: false,
                path: uri.fsPath,
                code: 'file_changed',
                currentVersionId,
                message: 'File content has changed since it was read. Re-read it before attempting to edit it.',
                recoveryHint: 'Call read_file again and prepare the edit from the fresh result.'
            }
        };
    }

    const currentMtime = await getFileMtime(uri, context);
    if (
        (typeof readState.currentVersionId !== 'number' || needsWholeFileRead)
        && typeof readState.mtime === 'number'
        && typeof currentMtime === 'number'
        && currentMtime > readState.mtime
    ) {
        return {
            ok: false,
            result: {
                success: false,
                path: uri.fsPath,
                code: 'file_changed',
                previousReadMtime: readState.mtime,
                currentMtime,
                currentVersionId,
                message: 'File has been modified since it was read. Re-read it before attempting to edit it.',
                recoveryHint: 'Call read_file or read_file_range again and prepare the edit from the fresh result.'
            }
        };
    }

    const rangeAnchorGuard = validateFreshReplaceRangeAnchors(
        uri.fsPath,
        currentVersionId,
        currentContent ?? '',
        edits,
        readState
    );
    if (!rangeAnchorGuard.ok) {
        return rangeAnchorGuard;
    }

    if (readState.isPartialView && needsWholeFileRead) {
        return {
            ok: false,
            result: {
                success: false,
                path: uri.fsPath,
                code: 'partial_read_before_structural_edit',
                currentVersionId,
                message: 'Only a partial view of this file has been read. Whole-file (full_file) edits require a full current file read first.',
                recoveryHint: 'Use read_file for the full file before retrying, then provide an exact old_string from the current result.'
            }
        };
    }

    return { ok: true, readState };
}

export async function getFileMtime(uri: URI, context: CleanSlateToolContext): Promise<number | undefined> {
    try {
        return (await context.fileService.stat(uri)).mtime;
    } catch {
        return undefined;
    }
}

function getReadFileState(uri: URI, context: CleanSlateToolContext): CleanSlateReadFileState | undefined {
    const exact = context.readFileState?.get(uri.toString());
    if (exact) {
        return exact;
    }

    for (const state of context.readFileState?.values() ?? []) {
        if (state.path === uri.fsPath || state.uri === uri.toString()) {
            return state;
        }
    }

    return undefined;
}

interface CleanSlateRangeAnchorFailure {
    path: string;
    editIndex: number;
    code: 'range_not_read' | 'no_match' | 'ambiguous_match';
    message: string;
    requestedRange: { startLine: number; endLine: number };
    currentContent: string;
    matchCount?: number;
    candidates?: Array<{ startLine: number; endLine: number; content: string }>;
}

export function validateFreshReplaceRangeAnchors(
    path: string,
    currentVersionId: number,
    currentContent: string,
    edits: CleanSlateStructuredEdit[],
    readState: CleanSlateReadFileState
): { ok: true } | { ok: false; result: any } {
    const failures: CleanSlateRangeAnchorFailure[] = [];

    for (let editIndex = 0; editIndex < edits.length; editIndex++) {
        const edit = edits[editIndex];
        if (edit.mode !== 'replace_range'
            || typeof edit.startLine !== 'number'
            || typeof edit.endLine !== 'number') {
            continue;
        }

        const startLine = Math.max(1, Math.floor(edit.startLine));
        const endLine = Math.max(startLine, Math.floor(edit.endLine));
        const requestedRange = { startLine, endLine };
        const currentRangeContent = getLineRangeContent(currentContent, startLine, endLine);

        // String-anchor-first grounding:
        // a unique originalText match against the CURRENT file
        // content proves the edit targets reality, regardless of line
        // coordinates — every applied edit shifts lines, so range-read
        // evidence goes stale constantly, and the edit service resyncs the
        // range to the exact match anyway. Requiring per-range read evidence
        // first rejected edits the applier could perform safely, causing
        // read → fail → re-read churn.
        const hasTextAnchor = typeof edit.originalText === 'string' && edit.originalText.length > 0;
        if (hasTextAnchor) {
            const actualOldString = findActualString(currentContent, edit.originalText!);
            if (!actualOldString) {
                failures.push({
                    path,
                    editIndex,
                    code: 'no_match',
                    message: `String to replace was not found for edit ${editIndex + 1}. Re-read the requested range and use its current text.`,
                    requestedRange,
                    currentContent: currentRangeContent,
                    matchCount: 0
                });
                continue;
            }

            const matchIndexes = findAllMatchIndexes(currentContent, actualOldString);
            if (matchIndexes.length > 1) {
                failures.push({
                    path,
                    editIndex,
                    code: 'ambiguous_match',
                    message: `Found ${matchIndexes.length} matches for edit ${editIndex + 1}. Provide more current surrounding text so old_string is unique.`,
                    requestedRange,
                    currentContent: currentRangeContent,
                    matchCount: matchIndexes.length,
                    candidates: matchIndexes.slice(0, 8).map(index => buildMatchCandidate(currentContent, index, actualOldString.length))
                });
            }
            continue;
        }

        // No text anchor: line coordinates are the only grounding, so they
        // must be covered by a read of the current file version.
        if (!hasFreshReadEvidence(readState, currentVersionId, startLine, endLine)) {
            failures.push({
                path,
                editIndex,
                code: 'range_not_read',
                message: `Edit ${editIndex + 1} is not covered by a current read of lines ${startLine}-${endLine}.`,
                requestedRange,
                currentContent: currentRangeContent
            });
        }
    }

    if (failures.length === 0) {
        return { ok: true };
    }

    const diagnostics = failures.map(failure => ({
        code: failure.code,
        blockIndex: failure.editIndex,
        message: failure.message,
        snippet: failure.currentContent,
        matchCount: failure.matchCount,
        allMatches: failure.candidates?.map(candidate => ({
            lineNumber: candidate.startLine,
            endLineNumber: candidate.endLine,
            lineContent: candidate.content,
            confidence: 1
        })),
        preferredRecoveryMode: 'replace_range'
    }));

    return {
        ok: false,
        result: {
            success: false,
            path,
            code: 'edit_batch_preflight_failed',
            primaryDiagnostic: diagnostics[0],
            diagnostics,
            failures,
            attemptedEdits: edits.length,
            currentVersionId,
            recoveryHint: 'Retry exactly one failed edit at a time with an exact current old_string from the candidate context.',
            message: `Edit preflight failed for ${failures.length} of ${edits.length} edit(s). No changes were applied.`
        }
    };
}

function hasFreshReadEvidence(
    readState: CleanSlateReadFileState,
    currentVersionId: number,
    startLine: number,
    endLine: number
): boolean {
    if (!readState.isPartialView
        && (readState.currentVersionId === currentVersionId || typeof readState.currentVersionId !== 'number')) {
        return true;
    }

    return (readState.ranges ?? []).some(range =>
        range.startLine <= startLine
        && range.endLine >= endLine
        && range.currentVersionId === readState.currentVersionId
        && range.mtime === readState.mtime
    );
}

/**
 * Returns the span of `fileContent` the model was aiming at, as the file
 * actually spells it. A model writes straight quotes, so an exact hit is tried
 * first and a quote-insensitive comparison is the fallback. Quote normalization
 * is a character-for-character substitution, so offsets in the normalized text
 * map straight back onto the original.
 */
function findActualString(fileContent: string, searchString: string): string | undefined {
    const exactIndex = fileContent.indexOf(searchString);
    if (exactIndex !== -1) {
        return searchString;
    }

    const foldedIndex = CleanSlateEditService.normalizeQuotes(fileContent)
        .indexOf(CleanSlateEditService.normalizeQuotes(searchString));
    if (foldedIndex === -1) {
        return undefined;
    }
    return fileContent.slice(foldedIndex, foldedIndex + searchString.length);
}

function findAllMatchIndexes(content: string, search: string): number[] {
    const indexes: number[] = [];
    let searchFrom = 0;
    while (searchFrom <= content.length - search.length) {
        const index = content.indexOf(search, searchFrom);
        if (index === -1) {
            break;
        }
        indexes.push(index);
        searchFrom = index + search.length;
    }
    return indexes;
}

function getLineRangeContent(content: string, startLine: number, endLine: number): string {
    const lines = content.split('\n');
    return clipRecoveryContent(lines.slice(startLine - 1, Math.min(endLine, lines.length)).join('\n'));
}

function buildMatchCandidate(content: string, matchIndex: number, matchLength: number): { startLine: number; endLine: number; content: string } {
    const startLine = countLinesBeforeOffset(content, matchIndex);
    const endLine = startLine + content.slice(matchIndex, matchIndex + matchLength).split('\n').length - 1;
    const lines = content.split('\n');
    const contextStart = Math.max(1, startLine - 3);
    const contextEnd = Math.min(lines.length, endLine + 3);
    return {
        startLine,
        endLine,
        content: clipRecoveryContent(lines.slice(contextStart - 1, contextEnd).join('\n'))
    };
}

function countLinesBeforeOffset(content: string, offset: number): number {
    let line = 1;
    for (let index = 0; index < offset; index++) {
        if (content.charCodeAt(index) === 10) {
            line++;
        }
    }
    return line;
}

function clipRecoveryContent(content: string): string {
    return content.length <= 4000 ? content : `${content.slice(0, 4000)}\n[... clipped ...]`;
}

export function resolveSafeExpectedVersionId(
    model: ISlateTextModel,
    input: { expectedVersionId?: number },
    readState: CleanSlateReadFileState,
    edits: CleanSlateStructuredEdit[],
    path: string
): { ok: true; expectedVersionId: number; adjustedFrom?: number } | { ok: false; result: any } {
    const currentVersionId = model.getVersionId();
    const requestedVersionId = typeof input.expectedVersionId === 'number' ? input.expectedVersionId : undefined;
    const readVersionId = typeof readState.currentVersionId === 'number' ? readState.currentVersionId : undefined;

    if (requestedVersionId === undefined || requestedVersionId === currentVersionId) {
        return { ok: true, expectedVersionId: readVersionId ?? currentVersionId };
    }

    if (readVersionId === currentVersionId && editsHaveStrongAnchors(edits)) {
        return {
            ok: true,
            expectedVersionId: currentVersionId,
            adjustedFrom: requestedVersionId
        };
    }

    return {
        ok: false,
        result: {
            success: false,
            path,
            code: 'stale_expected_version_without_anchor',
            expectedVersionId: requestedVersionId,
            currentVersionId,
            readVersionId,
            message: `The edit used stale expectedVersionId ${requestedVersionId}, but the current file version is ${currentVersionId}.`,
            recoveryHint: 'Re-read the relevant current text and retry apply_edit with an exact current old_string.'
        }
    };
}

function editsHaveStrongAnchors(edits: CleanSlateStructuredEdit[]): boolean {
    return edits.length > 0 && edits.every(edit => {
        if (edit.mode === 'replace_symbol') {
            return typeof edit.symbolName === 'string' && edit.symbolName.trim().length > 0;
        }
        if (edit.mode === 'replace_range') {
            return typeof edit.originalText === 'string'
                || edit.structuralOrigin === 'symbol'
                || edit.structuralOrigin === 'tree_sitter_declaration';
        }
        if (edit.mode === 'replace_exact') {
            return typeof edit.originalText === 'string' && edit.originalText.length > 0;
        }
        return false;
    });
}

export type CleanSlateRewriteClassification = 'surgical' | 'large_rewrite';

export interface CleanSlateRewriteAssessment {
    path: string;
    classification: CleanSlateRewriteClassification;
    fileLineCount: number;
    replacedLines: number;
    addedLines: number;
    netLineDelta: number;
    largestReplacedBlock: number;
    largestAddedBlock: number;
    replacesMostOfFile: boolean;
    message: string;
}

export function assessRewriteScope(
    model: ISlateTextModel,
    edits: CleanSlatePlannedEdit[],
    path: string
): CleanSlateRewriteAssessment {
    const fileLineCount = Math.max(1, model.getLineCount());
    let replacedLines = 0;
    let addedLines = 0;
    let largestReplacedBlock = 0;
    let largestAddedBlock = 0;

    for (const edit of edits) {
        const oldText = model.getValueInRange(edit.range);
        const oldLineCount = countLogicalLines(oldText);
        const newLineCount = countLogicalLines(edit.text);
        replacedLines += oldLineCount;
        addedLines += newLineCount;
        largestReplacedBlock = Math.max(largestReplacedBlock, oldLineCount);
        largestAddedBlock = Math.max(largestAddedBlock, newLineCount);
    }

    const replacesMostOfFile = replacedLines > fileLineCount * 0.6;
    const classification: CleanSlateRewriteClassification = replacesMostOfFile ? 'large_rewrite' : 'surgical';
    const netLineDelta = addedLines - replacedLines;
    const message = classification === 'large_rewrite'
        ? `Large rewrite: replacing ${replacedLines}/${fileLineCount} line(s) with ${addedLines} line(s) (net ${netLineDelta >= 0 ? '+' : ''}${netLineDelta}). Fresh-read, unique-anchor, version, atomic-planning, and syntax safeguards remain enforced.`
        : `Surgical edit: replacing ${replacedLines} line(s) with ${addedLines} line(s).`;

    if (classification === 'large_rewrite') {
        console.info(`[CleanSlateEdit] ${message}`);
    }

    return {
        path,
        classification,
        fileLineCount,
        replacedLines,
        addedLines,
        netLineDelta,
        largestReplacedBlock,
        largestAddedBlock,
        replacesMostOfFile,
        message
    };
}

export function validateSourceCodeRangeEditBudget(
    model: ISlateTextModel,
    edits: CleanSlateStructuredEdit[] | undefined,
    path: string
): { ok: true } | { ok: false; result: any } {
    if (!isSourceCodePath(path) || !edits?.length) {
        return { ok: true };
    }

    const fileLineCount = Math.max(1, model.getLineCount());
    const maxRawRangeLines = 60;
    const maxRawReplacementLines = 90;

    for (let index = 0; index < edits.length; index++) {
        const edit = edits[index];
        if (edit.mode !== 'replace_range') {
            continue;
        }
        if (edit.structuralOrigin === 'symbol') {
            continue;
        }

        const startLine = edit.startLine;
        const endLine = edit.endLine;
        if (typeof startLine !== 'number' || typeof endLine !== 'number') {
            continue;
        }

        const selectedLines = Math.max(1, endLine - startLine + 1);
        const replacementLines = countLogicalLines(edit.replacementText ?? '');
        const hasCurrentAnchor = typeof edit.originalText === 'string' && edit.originalText.trim().length > 0;
        const isAnchoredBalancedRange = hasCurrentAnchor
            && replacementLines >= selectedLines * 0.5
            && replacementLines <= Math.max(300, selectedLines * 3);
        const targetsMostOfFile = fileLineCount >= 20 && selectedLines > fileLineCount * 0.6;
        const isBroadRange = !isAnchoredBalancedRange
            && (selectedLines > maxRawRangeLines || replacementLines > maxRawReplacementLines || targetsMostOfFile);

        if (!isBroadRange) {
            continue;
        }

        return {
            ok: false,
            result: {
                success: false,
                path,
                code: 'range_too_broad_for_source_code',
                blockIndex: index,
                startLine,
                endLine,
                selectedLines,
                replacementLines,
                fileLineCount,
                currentVersionId: model.getVersionId(),
                message: `The legacy source-code range target is too broad (${selectedLines}/${fileLineCount} selected line(s), ${replacementLines} replacement line(s)).`,
                recoveryHint: 'Retry through apply_edit with one or more exact current old_string replacements.'
            }
        };
    }

    return { ok: true };
}

function countLogicalLines(value: string): number {
    if (value.length === 0) {
        return 0;
    }
    return value.split('\n').length;
}

function isSourceCodePath(path: string): boolean {
    return /\.(c|cc|cpp|cs|css|dart|go|h|hpp|java|js|jsx|kt|less|m|mm|php|rs|scss|swift|ts|tsx|vue)$/i.test(path.trim());
}
