/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CleanSlateTool, CleanSlateToolContext } from './types.js';
import { CLEANSLATE_MAX_FILE_READ_LINES, resolveCleanSlateFileReadBudget, takeCleanSlateBoundedLineSlice } from './cleanSlateFileReadPolicy.js';
import { resolvePathToUriAsync } from './utils.js';

/**
 * Tool: read_file_range
 */
export const readFileRangeTool: CleanSlateTool = {
    name: 'read_file_range',
    description: 'Reads a complete bounded line range from a file. Input: { path: string, startLine: number, endLine: number } (aliases start_line/end_line also supported). Returns the exact returned range, totalLines, and nextStartLine when more content remains; it never silently truncates content.',
    parametersSchema: {
        path: "string",
        startLine: "number",
        endLine: "number",
        start_line: "number",
        end_line: "number"
    },
    category: "discovery",
    planningHint: "Use the explicit range suggested by a file_too_large read_file result, or a targeted range found through search. Read only non-overlapping ranges that are actually needed.",

    async run(input: { path: string; startLine?: number; endLine?: number; start_line?: number; end_line?: number }, context: CleanSlateToolContext): Promise<any> {
        const path = input.path;
        const startLine = typeof input.startLine === 'number' ? input.startLine : input.start_line;
        const endLine = typeof input.endLine === 'number' ? input.endLine : input.end_line;
        if (!path) throw new Error('read_file_range requires a "path" parameter');
        if (typeof startLine !== 'number' || typeof endLine !== 'number') {
            throw new Error('read_file_range requires "startLine"/"endLine" (or "start_line"/"end_line") parameters as numbers');
        }
        if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) {
            throw new Error('read_file_range requires finite numeric startLine/endLine');
        }

        const normalizedStart = Math.max(1, Math.floor(startLine));
        const normalizedEnd = Math.max(normalizedStart, Math.floor(endLine));
        const requestedLineCount = normalizedEnd - normalizedStart + 1;
        const cappedEnd = normalizedStart + Math.min(requestedLineCount, CLEANSLATE_MAX_FILE_READ_LINES) - 1;

        try {
            const uri = await resolvePathToUriAsync(path, context);
            context.onProgress?.({ type: 'read', path: uri.fsPath });
            let content = '';
            let currentVersionId: number | undefined;
            let mtime: number | undefined;

            const model = context.modelService.getModel(uri);
            if (model) {
                content = model.getValue();
                currentVersionId = model.getVersionId();
            } else {
                const fileContent = await context.textFileService.read(uri);
                content = fileContent.value;
            }
            try {
                mtime = (await context.fileService.stat(uri)).mtime;
            } catch {
                // Some schemes do not expose file metadata; version guards still apply when a model exists.
            }

            const lines = content.split('\n');
            const config = context.configService.getConfiguration();
            const contextWindowTokens = context.fileReadBudget?.contextWindowTokens
                ?? config.contextWindow
                ?? config.maxInputTokens
                ?? 64_000;
            const availableInputTokens = context.fileReadBudget?.availableInputTokens ?? contextWindowTokens;
            const readBudget = resolveCleanSlateFileReadBudget(contextWindowTokens, availableInputTokens);
            const startIdx = normalizedStart - 1;
            const endIdxExclusive = Math.min(lines.length, cappedEnd);

            if (startIdx >= lines.length) {
                throw new Error(`Start line ${normalizedStart} is beyond the end of the file (${lines.length} lines)`);
            }

            const boundedSlice = takeCleanSlateBoundedLineSlice(lines, startIdx, endIdxExclusive, readBudget.maxBytes);
            if (boundedSlice.oversizedFirstLine) {
                return {
                    success: false,
                    code: 'line_too_large',
                    path: uri.fsPath,
                    totalLines: lines.length,
                    maxBytes: readBudget.maxBytes,
                    maxTokens: readBudget.maxTokens,
                    message: `Line ${normalizedStart} exceeds this model turn's file-read budget of ${readBudget.maxBytes} UTF-8 bytes / ${readBudget.maxTokens} estimated tokens. No partial line was returned.`,
                    recoveryHint: 'Use grep_search or another targeted structured tool instead of reading this generated/minified line as source text.'
                };
            }
            const rangeContent = boundedSlice.content;
            const actualEndLine = Math.max(normalizedStart, boundedSlice.endExclusive);
            const requestedEndWithinFile = Math.min(lines.length, normalizedEnd);
            const truncated = boundedSlice.endExclusive < requestedEndWithinFile || normalizedEnd > cappedEnd;
            const hasMore = actualEndLine < lines.length;
            const previousReadState = context.readFileState?.get(uri.toString());
            const canReusePreviousRanges = previousReadState
                && previousReadState.currentVersionId === currentVersionId
                && previousReadState.mtime === mtime;
            const previousRanges = canReusePreviousRanges ? previousReadState.ranges ?? [] : [];
            const nextRange = {
                startLine: normalizedStart,
                endLine: actualEndLine,
                content: rangeContent,
                currentVersionId,
                mtime,
                readAt: Date.now()
            };
            const ranges = [
                ...previousRanges.filter(range => range.startLine !== nextRange.startLine || range.endLine !== nextRange.endLine),
                nextRange
            ].slice(-32);
            context.readFileState?.set(uri.toString(), {
                path: uri.fsPath,
                uri: uri.toString(),
                content: rangeContent,
                currentVersionId,
                mtime,
                totalLines: lines.length,
                isPartialView: true,
                readAt: nextRange.readAt,
                ranges
            });
            return {
                content: rangeContent,
                path: uri.fsPath,
                range: { startLine: normalizedStart, endLine: actualEndLine },
                totalLines: lines.length,
                currentVersionId,
                truncated,
                hasMore,
                nextStartLine: hasMore ? actualEndLine + 1 : undefined,
                maxBytes: readBudget.maxBytes,
                maxTokens: readBudget.maxTokens
            };
        } catch (error) {
            const message = String(error);
            const isMissingFile =
                message.includes('Unable to resolve nonexistent file')
                || message.includes('not found')
                || message.includes('does not exist');

            return {
                success: false,
                code: isMissingFile ? 'not_found' : 'read_failed',
                path,
                message: isMissingFile
                    ? `File not found: "${path}". Discover the real file path before requesting a range read.`
                    : `Failed to read file range "${path}": ${message}`,
                recoveryHint: isMissingFile
                    ? 'Use list_dir(".") or find_by_name to locate the file first, then retry the range read.'
                    : 'Verify the path and line range, then retry.'
            };
        }
    }
};
