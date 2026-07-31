/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CLEANSLATE_ARTIFACT_SCHEME } from '../protocol/cleanSlateAI.js';
import { CleanSlateTool, CleanSlateToolContext } from './types.js';
import { getVirtualArtifactType, resolvePathToUriAsync } from './utils.js';
import { isStaleGeneratedDiagnosticPath, STALE_GENERATED_DIAGNOSTIC_WARNING } from './cleanSlateStaleDiagnosticPolicy.js';
import { CLEANSLATE_MAX_FILE_READ_LINES, CLEANSLATE_MAX_FULL_FILE_READ_BYTES, estimateCleanSlateFileReadTokens, estimateCleanSlateUtf8Bytes, resolveCleanSlateFileReadBudget, takeCleanSlateBoundedLineSlice } from './cleanSlateFileReadPolicy.js';

/**
 * Tool: read_file
 */
export const readFileTool: CleanSlateTool = {
    name: 'read_file',
    description: 'Reads a complete text file from the workspace when it fits the file-read budget. Input: { path: string }. Large files return a structured file_too_large result with available size/line metadata and a suggested read_file_range; content is never silently truncated.',
    parametersSchema: {
        path: "string"
    },
    category: "discovery",
    planningHint: "Use when complete file content is required. If the tool reports file_too_large, use its suggested read_file_range instead of repeating the same read or running wc.",

    async run(input: { path: string }, context: CleanSlateToolContext): Promise<any> {
        const { path } = input;
        if (!path) throw new Error('read_file requires a "path" parameter');

        try {
            const uri = await resolvePathToUriAsync(path, context);
            context.onProgress?.({ type: 'read', path: uri.fsPath });
            let content = '';
            let languageId = 'plaintext';
            let currentVersionId: number | undefined;
            let mtime: number | undefined;

            // Check if it's a virtual artifact FIRST
            if (uri.scheme === CLEANSLATE_ARTIFACT_SCHEME) {
                const artifactType = getVirtualArtifactType(path);
                let artifact;
                if (artifactType === 'implementation_plan') artifact = context.artifactService.getLatestArtifactByType('implementation_plan', { sessionId: context.sessionId });
                else if (artifactType === 'walkthrough') artifact = context.artifactService.getLatestArtifactByType('walkthrough', { sessionId: context.sessionId });
                else if (artifactType === 'analysis') artifact = context.artifactService.getLatestArtifactByType('analysis', { sessionId: context.sessionId });

                if (artifact) {
                    content = artifact.content;
                    languageId = 'markdown';
                    return { content, languageId, path: uri.toString() };
                }
                throw new Error(`Virtual artifact "${path}" not found.`);
            }

            const config = context.configService.getConfiguration();
            const contextWindowTokens = context.fileReadBudget?.contextWindowTokens
                ?? config.contextWindow
                ?? config.maxInputTokens
                ?? 64_000;
            const availableInputTokens = context.fileReadBudget?.availableInputTokens ?? contextWindowTokens;
            const readBudget = resolveCleanSlateFileReadBudget(contextWindowTokens, availableInputTokens);
            const model = context.modelService.getModel(uri);
            let fileSize: number | undefined;
            try {
                const stat = await context.fileService.stat(uri);
                mtime = stat.mtime;
                fileSize = stat.size;
            } catch {
                // Some schemes do not expose file metadata; the adaptive result budget still applies.
            }
            if (!model && typeof fileSize === 'number' && fileSize > CLEANSLATE_MAX_FULL_FILE_READ_BYTES) {
                context.readFileState?.set(uri.toString(), {
                    path: uri.fsPath,
                    uri: uri.toString(),
                    currentVersionId,
                    mtime,
                    isPartialView: true,
                    readAt: Date.now(),
                    ranges: []
                });
                return {
                    success: false,
                    code: 'file_too_large',
                    path: uri.fsPath,
                    totalBytes: fileSize,
                    maxFullFileBytes: CLEANSLATE_MAX_FULL_FILE_READ_BYTES,
                    maxBytes: readBudget.maxBytes,
                    maxTokens: readBudget.maxTokens,
                    contextWindowTokens: readBudget.contextWindowTokens,
                    availableInputTokens: readBudget.availableInputTokens,
                    suggestedRange: { startLine: 1, endLine: CLEANSLATE_MAX_FILE_READ_LINES },
                    message: `File is ${fileSize} bytes, exceeding the ${CLEANSLATE_MAX_FULL_FILE_READ_BYTES}-byte unrestricted full-read safety limit. The file was not loaded and no partial content was returned.`,
                    recoveryHint: 'Use a targeted search or read_file_range with the suggested starting range. Continue with later non-overlapping ranges only when needed.'
                };
            }
            if (model) {
                content = model.getValue();
                languageId = model.getLanguageId();
                currentVersionId = model.getVersionId();
            } else {
                const fileContent = await context.textFileService.read(uri);
                content = fileContent.value;
                // `read` reports a text encoding, not a language. With no model
                // resolved there is nothing to ask, so leave the default rather
                // than reporting "utf8" as the file's language.
                languageId = 'plaintext';
            }
            const totalLines = content.split('\n').length;
            const totalBytes = estimateCleanSlateUtf8Bytes(content);
            const estimatedTokens = estimateCleanSlateFileReadTokens(content);

            if (totalBytes > readBudget.maxBytes || estimatedTokens > readBudget.maxTokens) {
                const lines = content.split('\n');
                const suggestedSlice = takeCleanSlateBoundedLineSlice(
                    lines,
                    0,
                    Math.min(totalLines, CLEANSLATE_MAX_FILE_READ_LINES),
                    readBudget.maxBytes
                );
                const suggestedEndLine = Math.max(1, suggestedSlice.endExclusive);
                context.readFileState?.set(uri.toString(), {
                    path: uri.fsPath,
                    uri: uri.toString(),
                    totalLines,
                    currentVersionId,
                    mtime,
                    isPartialView: true,
                    readAt: Date.now(),
                    ranges: []
                });
                return {
                    success: false,
                    code: 'file_too_large',
                    path: uri.fsPath,
                    totalLines,
                    totalBytes,
                    estimatedTokens,
                    maxBytes: readBudget.maxBytes,
                    maxTokens: readBudget.maxTokens,
                    contextWindowTokens: readBudget.contextWindowTokens,
                    availableInputTokens: readBudget.availableInputTokens,
                    currentVersionId,
                    suggestedRange: {
                        startLine: 1,
                        endLine: suggestedEndLine
                    },
                    message: `File has ${totalLines} lines, ${totalBytes} UTF-8 bytes, and approximately ${estimatedTokens} tokens. It exceeds this model turn's complete-read budget of ${readBudget.maxBytes} bytes / ${readBudget.maxTokens} estimated tokens. No partial content was returned.`,
                    recoveryHint: 'Call read_file_range once with the suggested range, then continue with later non-overlapping ranges only when those sections are needed. Do not repeat read_file or run wc; totalLines is already provided.'
                };
            }

            context.readFileState?.set(uri.toString(), {
                path: uri.fsPath,
                uri: uri.toString(),
                content,
                totalLines,
                currentVersionId,
                mtime,
                isPartialView: false,
                readAt: Date.now(),
                ranges: []
            });
            if (isStaleGeneratedDiagnosticPath(path) || isStaleGeneratedDiagnosticPath(uri.fsPath)) {
                return {
                    content,
                    languageId,
                    path: uri.fsPath,
                    totalLines,
                    currentVersionId,
                    staleGeneratedDiagnostic: true,
                    warning: STALE_GENERATED_DIAGNOSTIC_WARNING
                };
            }
            return { content, languageId, path: uri.fsPath, totalLines, currentVersionId, truncated: false };
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
                    ? `File not found: "${path}". Do not assume common manifest files exist. Inspect the actual root listing and only read files that were discovered in this workspace.`
                    : `Failed to read file "${path}": ${message}`,
                recoveryHint: isMissingFile
                    ? 'Use list_dir(".") or find_by_name first, then read only files that actually exist.'
                    : 'Verify the path and retry. If the file is large, consider read_file_range after locating the correct target.'
            };
        }
    }
};
