/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICleanSlateResourceTextEditDescriptor } from './cleanSlateHostTypes.js';
import { CleanSlateEditService, CleanSlatePlannedEdit } from '../core/cleanSlateEditService.js';
import { resolvePathToUri, isUriInIdeWorkspace, resolveTextModelHeadless } from './utils.js';
import { CleanSlateTool, CleanSlateToolContext } from './types.js';
import { canonicalizeStructuredEdits } from './structuredEditCanonicalizer.js';
import { CleanSlateFileHistory, CleanSlateFileHistoryEntry } from '../core/cleanSlateFileHistory.js';
import { URI } from '../../../../../base/common/uri.js';
import { ApplyEditInput, assessRewriteScope, CleanSlateRewriteAssessment, getFileMtime, normalizeApplyEditRequest, resolveSafeExpectedVersionId, validateReadBeforeEdit, validateSourceCodeRangeEditBudget } from './ApplyEditTool.js';

interface MultiFileStructuredEditRequest extends ApplyEditInput { }

interface PlannedMultiFileEdit {
    path: string;
    uri: ReturnType<typeof resolvePathToUri>;
    versionId: number;
    beforeContent: string;
    edits: CleanSlatePlannedEdit[];
    originalEdits: { range: CleanSlatePlannedEdit['range']; text: string; originalStartLine: number }[];
    added: number;
    deleted: number;
    totalLinesChanged: number;
    strategies: string[];
    confidences: number[];
    preflightDiagnostics: string[];
    rewriteAssessment: CleanSlateRewriteAssessment;
    historyEntry?: CleanSlateFileHistoryEntry;
}

/**
 * Tool: multi_file_replace
 */
export const multiFileReplaceTool: CleanSlateTool = {
    name: 'multi_file_replace',
    description: 'Atomically applies exact current-string replacements to multiple previously read files. Each old_string must be unique in its file unless replace_all is true.',
    category: 'edit',
    parametersSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            edits: {
                type: 'array',
                description: 'Exact string replacements, one per file.',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        file_path: { type: 'string' },
                        old_string: { type: 'string' },
                        new_string: { type: 'string' },
                        replace_all: { type: 'boolean' }
                    },
                    required: ['file_path', 'old_string', 'new_string']
                }
            }
        },
        required: ['edits']
    },
    async run(input: { edits: MultiFileStructuredEditRequest[] }, context: CleanSlateToolContext): Promise<any> {
        if (!Array.isArray(input.edits) || input.edits.length === 0) {
            throw new Error('multi_file_replace: The "edits" parameter must be a non-empty array.');
        }

        const plannedFiles: PlannedMultiFileEdit[] = [];
        const failures: Array<{
            path: string;
            code: string;
            primaryDiagnostic?: any;
            allMatches?: Array<{ lineNumber: number; endLineNumber: number; lineContent: string; confidence: number }>;
            diagnostics: any[];
            recoveryHint?: string;
            currentVersionId?: number;
            attemptedEdits?: number;
            failures?: any[];
            message: string;
        }> = [];
        const seenPaths = new Set<string>();

        for (const rawEntry of input.edits) {
            const requestedPath = rawEntry?.file_path ?? rawEntry?.path;
            if (!requestedPath) {
                failures.push({
                    path: '',
                    code: 'invalid_input',
                    diagnostics: [],
                    message: 'Each multi_file_replace entry must include a "file_path".'
                });
                continue;
            }
            let entry: MultiFileStructuredEditRequest = { ...rawEntry, path: requestedPath };

            const pathKey = requestedPath.replace(/\\/g, '/').toLowerCase();
            if (seenPaths.has(pathKey)) {
                failures.push({
                    path: requestedPath,
                    code: 'invalid_input',
                    diagnostics: [],
                    message: `Duplicate multi_file_replace target "${requestedPath}" is not allowed.`
                });
                continue;
            }
            seenPaths.add(pathKey);

            try {
                const uri = resolvePathToUri(requestedPath, context, { allowWorkspaceRootRelativeAbsolute: false });

                let model = context.modelService.getModel(uri);
                if (!model) {
                    model = await resolveTextModelHeadless(uri, context);
                }
                if (!model) {
                    failures.push({
                        path: requestedPath,
                        code: 'invalid_input',
                        diagnostics: [],
                        message: `Could not load file model for ${requestedPath}.`
                    });
                    continue;
                }

                const currentVersionId = model.getVersionId();
                const beforeContent = model.getValue();
                const normalizedRequest = normalizeApplyEditRequest(entry, beforeContent);
                if (!normalizedRequest.ok) {
                    failures.push({
                        path: uri.fsPath,
                        code: normalizedRequest.result.code ?? 'invalid_input',
                        diagnostics: [],
                        currentVersionId,
                        recoveryHint: normalizedRequest.result.recoveryHint,
                        message: normalizedRequest.result.message
                    });
                    continue;
                }
                entry = { ...entry, edits: normalizedRequest.edits };
                const readGuard = await validateReadBeforeEdit(uri, currentVersionId, entry, context, beforeContent);
                if (!readGuard.ok) {
                    failures.push({
                        path: uri.fsPath,
                        code: readGuard.result.code ?? 'file_not_read',
                        primaryDiagnostic: readGuard.result.primaryDiagnostic,
                        diagnostics: readGuard.result.diagnostics ?? [],
                        currentVersionId: readGuard.result.currentVersionId ?? currentVersionId,
                        attemptedEdits: entry.edits!.length,
                        failures: readGuard.result.failures,
                        recoveryHint: readGuard.result.recoveryHint,
                        message: readGuard.result.message ?? 'File must be read before editing.'
                    });
                    continue;
                }
                const canonicalizedEdits = await canonicalizeStructuredEdits(requestedPath, model, entry.edits!, context);
                if (!canonicalizedEdits.ok) {
                    failures.push(canonicalizedEdits.failure);
                    continue;
                }
                const rangeBudgetGuard = validateSourceCodeRangeEditBudget(model, canonicalizedEdits.edits, uri.fsPath);
                if (!rangeBudgetGuard.ok) {
                    failures.push({
                        path: uri.fsPath,
                        code: rangeBudgetGuard.result.code ?? 'range_too_broad_for_source_code',
                        diagnostics: [],
                        currentVersionId: model.getVersionId(),
                        attemptedEdits: entry.edits!.length,
                        recoveryHint: rangeBudgetGuard.result.recoveryHint,
                        message: rangeBudgetGuard.result.message
                    });
                    continue;
                }
                const versionGuard = resolveSafeExpectedVersionId(
                    model,
                    entry,
                    readGuard.readState,
                    canonicalizedEdits.edits,
                    uri.fsPath
                );
                if (!versionGuard.ok) {
                    failures.push({
                        path: uri.fsPath,
                        code: versionGuard.result.code ?? 'stale_expected_version_without_anchor',
                        diagnostics: [],
                        currentVersionId: model.getVersionId(),
                        attemptedEdits: entry.edits!.length,
                        recoveryHint: versionGuard.result.recoveryHint,
                        message: versionGuard.result.message
                    });
                    continue;
                }

                const plan = CleanSlateEditService.planEdits(model, {
                    edits: canonicalizedEdits.edits,
                    expectedVersionId: versionGuard.expectedVersionId
                });

                if (!plan.ok) {
                    const primaryDiagnostic = plan.diagnostics[0];
                    failures.push({
                        path: uri.fsPath,
                        code: primaryDiagnostic?.code ?? 'invalid_input',
                        primaryDiagnostic,
                        allMatches: primaryDiagnostic?.allMatches,
                        diagnostics: plan.diagnostics,
                        recoveryHint: CleanSlateEditService.buildRecoveryHint(primaryDiagnostic, model),
                        currentVersionId: model.getVersionId(),
                        attemptedEdits: entry.edits!.length,
                        message: CleanSlateEditService.formatFailure(plan)
                    });
                    continue;
                }

                const rewriteAssessment = assessRewriteScope(model, plan.edits, uri.fsPath);

				const preflightDiagnostics: string[] = [];

                const appliedChanges = plan.edits.map((edit: CleanSlatePlannedEdit) => ({
                    range: edit.range,
                    oldText: model.getValueInRange(edit.range),
                    newText: edit.text,
                    strategy: edit.strategy,
                    confidence: edit.confidence
                }));

                plannedFiles.push({
                    path: uri.fsPath,
                    uri,
                    versionId: model.getVersionId(),
                    beforeContent,
                    edits: plan.edits,
                    originalEdits: appliedChanges.map(change => ({
                        range: change.range,
                        text: change.oldText,
                        originalStartLine: change.range.startLineNumber
                    })),
                    added: appliedChanges.reduce((sum, change) => sum + (change.newText.length > 0 ? change.newText.split('\n').length : 0), 0),
                    deleted: appliedChanges.reduce((sum, change) => sum + (change.oldText.length > 0 ? change.oldText.split('\n').length : 0), 0),
                    totalLinesChanged: appliedChanges.reduce((sum, change) => sum + (change.range.endLineNumber - change.range.startLineNumber + 1), 0),
                    strategies: [...new Set(plan.edits.map(edit => edit.strategy))],
                    confidences: plan.edits
                        .map(edit => edit.confidence)
                        .filter((confidence): confidence is number => typeof confidence === 'number'),
                    preflightDiagnostics,
                    rewriteAssessment
                });
            } catch (error) {
                failures.push({
                    path: requestedPath,
                    code: 'invalid_input',
                    diagnostics: [],
                    message: `Failed to prepare edits for ${requestedPath}: ${String(error)}`
                });
            }
        }

        if (failures.length > 0) {
            return {
                success: false,
                code: failures[0]?.code ?? 'invalid_input',
                failures,
                message: `multi_file_replace failed to plan edits for ${failures.length} file(s). Nothing was applied.`
            };
        }

        const markerBaselines = new Map<string, ReturnType<typeof CleanSlateEditService.captureMarkerValidationBaseline>>();
        const markerWaiters = new Map<string, ReturnType<typeof CleanSlateEditService.createMarkerRefreshWaiter>>();
        for (const file of plannedFiles) {
            markerBaselines.set(file.path, CleanSlateEditService.captureMarkerValidationBaseline(context.markerService, file.uri));
            markerWaiters.set(file.path, CleanSlateEditService.createMarkerRefreshWaiter(context.markerService, file.uri));
            const workspaceId = context.workspaceContextService.getWorkspace().id;
            const storageRoot = context.environmentService ? URI.joinPath(context.environmentService.workspaceStorageHome, workspaceId) : undefined;
            file.historyEntry = await CleanSlateFileHistory.trackEdit({
                workspaceRoot: context.workspaceContextService.getWorkspaceFolder(file.uri)?.uri,
                storageRoot,
                resource: file.uri,
                fileService: context.fileService,
                modelService: context.modelService,
                operation: 'multi_file_replace',
                toolName: multiFileReplaceTool.name,
                versionId: file.versionId
            });
        }

        // Descriptors, not editor objects — the host builds the real edit. See
        // ICleanSlateResourceTextEditDescriptor for why constructing it here
        // would fail silently.
        const workspaceEdits: ICleanSlateResourceTextEditDescriptor[] = plannedFiles.flatMap(file =>
            file.edits.map(edit => ({
                resource: file.uri,
                range: edit.range,
                text: edit.text,
                versionId: file.versionId
            }))
        );

        if (workspaceEdits.length === 0) {
            for (const waiter of markerWaiters.values()) {
                waiter.dispose();
            }
            return {
                success: false,
                code: 'no_op',
                failures: [],
                message: 'multi_file_replace produced no file changes.'
            };
        }

        if (context.bulkEditService) {
            const applyResult = await context.bulkEditService.applyTextEdits(workspaceEdits, {
                label: 'CleanSlate multi-file edit',
                respectAutoSaveConfig: false
            });
            if (!applyResult.isApplied) {
                for (const waiter of markerWaiters.values()) {
                    waiter.dispose();
                }
                return {
                    success: false,
                    code: 'invalid_input',
                    failures: [],
                    message: 'multi_file_replace was cancelled before any edits were applied.'
                };
            }
        } else {
            for (const file of plannedFiles) {
                const model = context.modelService.getModel(file.uri);
                if (!model) {
                    throw new Error(`multi_file_replace: Lost model for ${file.path} before applying edits.`);
                }
                model.pushStackElement();
                model.pushEditOperations(null, file.edits.map(edit => ({ range: edit.range, text: edit.text })), () => null);
                model.pushStackElement();
            }
        }

        const validationDiagnostics: Array<{
            path: string;
            diagnostics: string[];
        }> = [];

        for (const file of plannedFiles) {
            const baseline = markerBaselines.get(file.path);
            if (!baseline) {
                continue;
            }
            const validation = await CleanSlateEditService.validateMarkersAfterEdit(
                context.markerService,
                file.uri,
                baseline,
                markerWaiters.get(file.path)
            );
            if (!validation.ok) {
                validationDiagnostics.push({
                    path: file.path,
                    diagnostics: validation.issues.map(issue => `[marker] ${issue.message} (${issue.startLineNumber}:${issue.startColumn})`)
                });
            }
        }

        for (const file of plannedFiles) {
            await context.textFileService.save(file.uri);
            const model = context.modelService.getModel(file.uri);
            const afterContent = model?.getValue();
            context.readFileState?.set(file.uri.toString(), {
                path: file.path,
                uri: file.uri.toString(),
                content: afterContent,
                currentVersionId: model?.getVersionId(),
                mtime: await getFileMtime(file.uri, context),
                totalLines: afterContent ? afterContent.split('\n').length : undefined,
                isPartialView: false,
                readAt: Date.now()
            });
            if (isUriInIdeWorkspace(context, file.uri)) {
                context.editorDecorationHost?.registerPostApplySession(
                    file.uri,
                    file.edits.map(edit => ({ range: edit.range, text: edit.text })),
                    file.originalEdits,
                    file.beforeContent
                );
            }
        }

	        const results = plannedFiles.map(file => ({
	            path: file.path,
	            appliedBlocks: file.edits.length,
	            added: file.added,
	            deleted: file.deleted,
            totalLinesChanged: file.totalLinesChanged,
            strategies: file.strategies,
            confidences: file.confidences,
            rewriteAssessment: file.rewriteAssessment,
            historyEntryId: file.historyEntry?.id,
	            diagnostics: [
	                ...file.preflightDiagnostics,
	                ...(validationDiagnostics.find(entry => entry.path === file.path)?.diagnostics ?? [])
	            ],
	            beforeContent: file.beforeContent,
	            afterContent: context.modelService.getModel(file.uri)?.getValue()
	        }));

        const totalDiagnostics = results.reduce((sum, file) => sum + file.diagnostics.length, 0);

        return {
            success: true,
            results,
            affectedFiles: plannedFiles.map(file => file.path),
            totalFiles: plannedFiles.length,
            totalAppliedBlocks: plannedFiles.reduce((sum, file) => sum + file.edits.length, 0),
            added: plannedFiles.reduce((sum, file) => sum + file.added, 0),
            deleted: plannedFiles.reduce((sum, file) => sum + file.deleted, 0),
            appliedWithDiagnostics: totalDiagnostics > 0,
            validationDiagnostics,
            message: totalDiagnostics > 0
                ? `SUCCESS WITH DIAGNOSTICS: Applied exact replacements to ${plannedFiles.length} file(s). New syntax/compiler diagnostics were preserved for follow-up fixes.`
                : `SUCCESS: Applied exact replacements to ${plannedFiles.length} file(s).`
        };
    }
};
