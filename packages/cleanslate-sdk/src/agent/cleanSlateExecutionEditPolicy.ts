/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ParsedToolCall } from './cleanSlateAgentTypes.js';

export interface ICleanSlateExecutionPathState {
    touchedPaths: Set<string>;
    mutatedPaths: Set<string>;
}
/** Owns source-edit preconditions, recovery guidance, and affected-path extraction. */
export class CleanSlateExecutionEditPolicy {
    public countStructuredEdits(toolCall: ParsedToolCall): number {
        if (toolCall.toolName === 'apply_edit') {
			return typeof toolCall.input?.old_string === 'string' && typeof toolCall.input?.new_string === 'string' ? 1 : 0;
        }
        if (toolCall.toolName === 'multi_file_replace' && Array.isArray(toolCall.input?.edits)) {
			return toolCall.input.edits.filter((entry: any) =>
				typeof entry?.old_string === 'string' && typeof entry?.new_string === 'string').length;
        }
        return 0;
    }

    public withScopedReadLintsInput(toolCall: ParsedToolCall, guardState: ICleanSlateExecutionPathState): ParsedToolCall {
        const scopedPaths = guardState.mutatedPaths.size > 0
            ? guardState.mutatedPaths
            : guardState.touchedPaths;
        if (toolCall.toolName !== 'read_lints' || scopedPaths.size === 0) {
            return toolCall;
        }

        const input = toolCall.input && typeof toolCall.input === 'object' ? toolCall.input : {};
        const hasExplicitPath = typeof input.path === 'string' && input.path.trim().length > 0;
        const hasExplicitPaths = Array.isArray(input.paths) && input.paths.some((path: unknown) => typeof path === 'string' && path.trim().length > 0);
        if (hasExplicitPath || hasExplicitPaths) {
            return toolCall;
        }

        return {
            toolName: toolCall.toolName,
            input: {
                ...input,
                paths: Array.from(scopedPaths)
            }
        };
    }


    public buildFailedEditRecoveryPrompt(toolCall: ParsedToolCall, result: any): string | undefined {
        if (result?.success !== false || (toolCall.toolName !== 'apply_edit' && toolCall.toolName !== 'multi_file_replace')) {
            return undefined;
        }

        const topLevelFailures = Array.isArray(result.failures) ? result.failures : [];
        const detailedFailures = topLevelFailures.flatMap((failure: any) =>
            Array.isArray(failure?.failures)
                ? failure.failures.map((nestedFailure: any) => ({ ...nestedFailure, path: nestedFailure?.path ?? failure?.path }))
                : typeof failure?.editIndex === 'number' || typeof failure?.currentContent === 'string'
                    ? [failure]
                    : []
        );
        const primaryFailure = detailedFailures[0] ?? topLevelFailures[0] ?? result;
        const code = String(primaryFailure?.code ?? result.code ?? 'edit_failed');
        const path = String(primaryFailure?.path ?? result.path ?? toolCall.input?.file_path ?? toolCall.input?.path ?? 'unknown path');
        const rawDiagnostics = Array.isArray(result?.diagnostics)
            ? result.diagnostics
            : Array.isArray(topLevelFailures[0]?.diagnostics)
                ? topLevelFailures[0].diagnostics
                : Array.isArray(primaryFailure?.diagnostics)
                    ? primaryFailure.diagnostics
                    : [];
        const diagnostics = rawDiagnostics.length > 0
            ? `\nDiagnostics:\n${rawDiagnostics.slice(0, 8).map((diagnostic: any) => `- ${JSON.stringify(diagnostic)}`).join('\n')}`
            : '';
        const failedEditDetails = detailedFailures.length > 0
            ? `\nFailed edits:\n${detailedFailures.slice(0, 8).map((failure: any) => {
                const editNumber = typeof failure?.editIndex === 'number' ? failure.editIndex + 1 : '?';
                const range = failure?.requestedRange
                    ? ` lines ${failure.requestedRange.startLine}-${failure.requestedRange.endLine}`
                    : '';
                const currentContent = typeof failure?.currentContent === 'string'
                    ? `\n  Current requested range:\n${failure.currentContent}`
                    : '';
                const candidates = Array.isArray(failure?.candidates) && failure.candidates.length > 0
                    ? `\n  Candidate matches:\n${failure.candidates.slice(0, 8).map((candidate: any) => `  - lines ${candidate.startLine}-${candidate.endLine}:\n${candidate.content}`).join('\n')}`
                    : '';
                return `- Edit ${editNumber} [${String(failure?.code ?? 'edit_failed')}]${range}: ${String(failure?.message ?? '')}${currentContent}${candidates}`;
            }).join('\n')}`
            : '';
        const recoveryHint = String(primaryFailure?.recoveryHint ?? result.recoveryHint ?? '');

        const action = code === 'ambiguous_match'
            ? 'Retry with a larger current old_string that uniquely identifies the intended occurrence, or set replace_all only when every occurrence should change.'
            : code === 'file_changed'
                ? 'Re-read the file, then retry with its current old_string and the intended new_string.'
                : 'Retry apply_edit with file_path, the exact current old_string, and new_string. Inspect the affected current region first when the returned message shows the old string no longer matches.';

        return [
            `EDIT RECOVERY REQUIRED for ${path}.`,
            `Failed tool: ${toolCall.toolName}`,
            `Failure code: ${code}`,
            primaryFailure?.message ? `Message: ${primaryFailure.message}` : undefined,
            recoveryHint ? `Tool recovery hint: ${recoveryHint}` : undefined,
            diagnostics || undefined,
            failedEditDetails || undefined,
            `Required next action: ${action}`,
            detailedFailures.length > 0 ? 'Retry exactly one failed edit at a time. Do not resubmit the rejected batch.' : undefined,
            'Do not treat this failed edit as completion; return the corrective tool call.'
        ].filter(Boolean).join('\n');
    }


    public isUserCancelledCommandResult(toolCall: ParsedToolCall, result: any): boolean {
        const commandToolNames = new Set(['execute_command', 'start_background_command']);
        return commandToolNames.has(toolCall.toolName)
            && result?.success === false
            && (result?.userCancelled === true || result?.code === 'user_cancelled' || result?.status === 'cancelled');
    }

    public isSettledEditNoOp(toolCall: ParsedToolCall, result: any): boolean {
        if (toolCall.toolName !== 'apply_edit' && toolCall.toolName !== 'multi_file_replace') {
            return false;
        }
        if (result?.success !== true) {
            return false;
        }
        if (String(result?.code ?? '').toLowerCase() === 'no_op') {
            return this.collectMutationPaths(toolCall, result).length > 0;
        }
        const message = typeof result?.message === 'string' ? result.message.toLowerCase() : '';
        return this.collectMutationPaths(toolCall, result).length > 0
            && (message.includes('already matches') || message.includes('no changes were necessary'));
    }


    public collectMutationPaths(toolCall: ParsedToolCall, result: any): string[] {
        const paths: string[] = [];
        const addPath = (candidate: unknown) => {
            if (typeof candidate !== 'string') {
                return;
            }
            const path = candidate.trim();
            if (path.length === 0 || paths.includes(path)) {
                return;
            }
            paths.push(path);
        };

        addPath(result?.path);
        addPath(toolCall.input?.file_path);
        addPath(toolCall.input?.path);

        for (const path of Array.isArray(result?.affectedFiles) ? result.affectedFiles : []) {
            addPath(path);
        }
        for (const path of Array.isArray(result?.created) ? result.created : []) {
            addPath(path);
        }
        for (const file of Array.isArray(result?.results) ? result.results : []) {
            addPath(file?.path);
        }
        for (const file of Array.isArray(toolCall.input?.files) ? toolCall.input.files : []) {
            addPath(file?.path);
        }
        for (const editGroup of Array.isArray(toolCall.input?.edits) ? toolCall.input.edits : []) {
            addPath(editGroup?.file_path);
            addPath(editGroup?.path);
        }

        return paths;
    }

}
