/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChatResponse, InteractionBlock } from '../types/cleanSlateChatTypes.js';
import { normalizeChatResponse, normalizePlanningQuestion } from './cleanSlateChatResponseNormalizer.js';

/** Bounds and serializes the render state persisted with an assistant turn. */
export class CleanSlateRenderPayloadCodec {
    public static readonly MAX_RENDER_PAYLOAD_CHARS = 90_000;
    public static readonly MAX_TIMELINE_BLOCKS = 80;
    public static readonly MAX_TEXT_BLOCK_CHARS = 8_000;
    public static readonly MAX_CODE_SNIPPET_CHARS = 20_000;
    public static readonly MAX_TERMINAL_OUTPUT_CHARS = 4_000;
    public static readonly MAX_LIST_ITEMS = 100;
    public static readonly MAX_LIST_ITEM_CHARS = 512;
    public static readonly MAX_FILE_EDIT_ENTRIES = 80;
    public static readonly MAX_FILE_PATH_CHARS = 512;
    public static readonly MAX_TOOL_NAME_CHARS = 128;
    public static readonly MAX_DETAIL_ITEMS = 30;
    public static readonly MAX_DETAIL_ITEM_CHARS = 240;
    public static readonly MAX_BROWSER_SCREENSHOTS = 6;
    public static readonly MAX_BROWSER_SCREENSHOT_BASE64_CHARS = 2_000_000;
    public static readonly MAX_WEB_RESULTS = 8;
    public static readonly MAX_WEB_ATTEMPTS = 6;
    public static readonly MAX_WEB_SNIPPET_CHARS = 320;
    public static readonly MAX_WEB_CONTENT_PREVIEW_CHARS = 1_200;

    public hasRenderableResponsePayload(parsed: ChatResponse): boolean {
        const hasSummary = Array.isArray(parsed.summary)
            ? parsed.summary.some(item => typeof item === 'string' && item.trim().length > 0)
            : (typeof parsed.summary === 'string' && parsed.summary.trim().length > 0);
        const hasToDo = Array.isArray(parsed.to_do) && parsed.to_do.length > 0;
        const hasTimeline = Array.isArray(parsed.timeline) && parsed.timeline.length > 0;
        const hasCodeSnippet = typeof parsed.code_snippet === 'string' && parsed.code_snippet.trim().length > 0;
        const hasTerminalOutputs = !!parsed.terminal_outputs && Object.keys(parsed.terminal_outputs).length > 0;
        const hasPlanningQuestion = !!normalizePlanningQuestion(parsed.planning_question);

        return hasSummary || hasToDo || hasTimeline || hasCodeSnippet || hasTerminalOutputs || hasPlanningQuestion;
    }

    public buildPersistedRenderPayload(
        parsed: ChatResponse,
        timeline: InteractionBlock[],
        terminalOutputs: { [command: string]: { output: string; exitCode: number } },
        terminalCommands: string[],
        lastToolName: string | undefined
    ): string | undefined {
        const payload: ChatResponse = {};
        const normalized = normalizeChatResponse(parsed ?? {});
        const planningQuestion = normalizePlanningQuestion(normalized.planning_question);
        const normalizedTimeline = this.sanitizeTimeline(timeline);

        const normalizedSummary = this.normalizeSummaryField(normalized.summary);
        if (normalizedSummary !== undefined && !planningQuestion && normalizedTimeline.length === 0) {
            payload.summary = normalizedSummary;
        }

        const normalizedToDo = this.sanitizeStringList(normalized.to_do);
        if (normalizedToDo.length > 0) {
            payload.to_do = normalizedToDo;
        }

        if (planningQuestion) {
            payload.planning_question = planningQuestion;
        }

        const filesAccessed = this.sanitizeStringList(normalized.files_accessed);
        if (filesAccessed.length > 0) {
            payload.files_accessed = filesAccessed;
        }

        const filesCreated = this.sanitizeStringList(normalized.files_created);
        if (filesCreated.length > 0) {
            payload.files_created = filesCreated;
        }

        const filesEdited = this.sanitizeFilesEdited(normalized.files_edited);
        if (filesEdited.length > 0) {
            payload.files_edited = filesEdited;
        }

        const normalizedCode = this.clampText(normalized.code_snippet, CleanSlateRenderPayloadCodec.MAX_CODE_SNIPPET_CHARS, false);
        if (normalizedCode) {
            payload.code_snippet = normalizedCode;
        }

        if (normalizedTimeline.length > 0) {
            payload.timeline = normalizedTimeline;
        }

        const normalizedTerminalOutputs = this.sanitizeTerminalOutputs(terminalOutputs, terminalCommands);
        if (Object.keys(normalizedTerminalOutputs).length > 0) {
            payload.terminal_outputs = normalizedTerminalOutputs;
        }

        const normalizedToolName = this.clampText(lastToolName, CleanSlateRenderPayloadCodec.MAX_TOOL_NAME_CHARS, true);
        if (normalizedToolName) {
            payload.lastToolName = normalizedToolName;
        }

        if (!this.hasRenderableResponsePayload(payload)) {
            return undefined;
        }

        const boundedPayload = this.reducePayloadToStorageLimit(payload);
        if (!this.hasRenderableResponsePayload(boundedPayload)) {
            return undefined;
        }

        return JSON.stringify(boundedPayload);
    }

    private reducePayloadToStorageLimit(payload: ChatResponse): ChatResponse {
        const reduced: ChatResponse = {
            ...payload,
            timeline: payload.timeline ? [...payload.timeline] : undefined,
            terminal_outputs: payload.terminal_outputs ? { ...payload.terminal_outputs } : undefined
        };

        const withinLimit = () => JSON.stringify(reduced).length <= CleanSlateRenderPayloadCodec.MAX_RENDER_PAYLOAD_CHARS;

        if (withinLimit()) {
            return reduced;
        }

        if (reduced.timeline && reduced.timeline.length > 60) {
            reduced.timeline = reduced.timeline.slice(-60);
        }
        if (withinLimit()) {
            return reduced;
        }

        if (reduced.terminal_outputs && Object.keys(reduced.terminal_outputs).length > 0) {
            delete reduced.terminal_outputs;
        }
        if (withinLimit()) {
            return reduced;
        }

        if (reduced.timeline && reduced.timeline.length > 0) {
            reduced.timeline = reduced.timeline.map(block => {
                if (block.type === 'terminal') {
                    return {
                        ...block,
                        output: this.clampText(block.output, 2_000, false),
                        isStreaming: false
                    };
                }
                if (block.type === 'file') {
                    return {
                        ...block,
                        details: Array.isArray(block.details) ? block.details.slice(0, 10) : undefined,
                        isStreaming: false
                    };
                }
                return {
                    ...block,
                    isStreaming: false
                };
            });
        }
        if (withinLimit()) {
            return reduced;
        }

        if (reduced.code_snippet) {
            reduced.code_snippet = this.clampText(reduced.code_snippet, 4_000, false);
        }
        if (withinLimit()) {
            return reduced;
        }

        const latestSummary = this.extractLatestSummaryText(reduced);
        const minimalPayload: ChatResponse = {};
        if (latestSummary) {
            minimalPayload.summary = latestSummary;
        }
        if (Array.isArray(reduced.to_do) && reduced.to_do.length > 0) {
            minimalPayload.to_do = reduced.to_do.slice(0, 20);
        }
        if (reduced.planning_question) {
            minimalPayload.planning_question = reduced.planning_question;
        }
        if (Array.isArray(reduced.timeline) && reduced.timeline.length > 0) {
            minimalPayload.timeline = reduced.timeline.slice(-20);
        }

        return minimalPayload;
    }

    private sanitizeStringList(values: string[] | undefined): string[] {
        if (!Array.isArray(values)) {
            return [];
        }

        return values
            .filter((value): value is string => typeof value === 'string')
            .map(value => this.clampText(value, CleanSlateRenderPayloadCodec.MAX_LIST_ITEM_CHARS, true))
            .filter((value): value is string => typeof value === 'string' && value.length > 0)
            .slice(0, CleanSlateRenderPayloadCodec.MAX_LIST_ITEMS);
    }

    private sanitizeFilesEdited(values: { path: string; added: number; deleted: number }[] | undefined): { path: string; added: number; deleted: number }[] {
        if (!Array.isArray(values)) {
            return [];
        }

        return values
            .filter((value): value is { path: string; added: number; deleted: number } => !!value && typeof value.path === 'string')
            .slice(0, CleanSlateRenderPayloadCodec.MAX_FILE_EDIT_ENTRIES)
            .map(value => ({
                path: this.clampText(value.path, CleanSlateRenderPayloadCodec.MAX_FILE_PATH_CHARS, true) || value.path.slice(0, CleanSlateRenderPayloadCodec.MAX_FILE_PATH_CHARS),
                added: Number.isFinite(value.added) ? value.added : 0,
                deleted: Number.isFinite(value.deleted) ? value.deleted : 0
            }));
    }

    public sanitizeTimeline(timeline: InteractionBlock[]): InteractionBlock[] {
        if (!Array.isArray(timeline) || timeline.length === 0) {
            return [];
        }

        return timeline
            .slice(-CleanSlateRenderPayloadCodec.MAX_TIMELINE_BLOCKS)
            .filter(block => !block.isOptimistic)
            .map(block => this.sanitizeTimelineBlock(block))
            .filter((block): block is InteractionBlock => !!block);
    }

    private sanitizeTimelineBlock(block: InteractionBlock): InteractionBlock | undefined {
        if (!block || !block.id || !block.type) {
            return undefined;
        }

        const base: InteractionBlock = {
            id: this.clampText(block.id, CleanSlateRenderPayloadCodec.MAX_LIST_ITEM_CHARS, true) || block.id.slice(0, CleanSlateRenderPayloadCodec.MAX_LIST_ITEM_CHARS),
            type: block.type,
            isStreaming: false
        };

        if (block.type === 'summary') {
            base.content = this.clampText(block.content, CleanSlateRenderPayloadCodec.MAX_TEXT_BLOCK_CHARS, false);
            if (!base.content) {
                return undefined;
            }
            if (block.summaryRole === 'orientation' || block.summaryRole === 'progress' || block.summaryRole === 'completion' || block.summaryRole === 'status') {
                base.summaryRole = block.summaryRole;
            }
            return base;
        }

        if (block.type === 'assistant_text') {
            base.content = this.clampText(block.content, CleanSlateRenderPayloadCodec.MAX_TEXT_BLOCK_CHARS, false);
            if (!base.content) {
                return undefined;
            }
            return base;
        }

        if (block.type === 'reasoning') {
            base.content = this.clampText(block.content, CleanSlateRenderPayloadCodec.MAX_TEXT_BLOCK_CHARS, false);
            if (!base.content) {
                return undefined;
            }
            if (typeof block.reasoningDurationMs === 'number') {
                base.reasoningDurationMs = block.reasoningDurationMs;
            }
            return base;
        }

        if (block.type === 'terminal') {
            base.command = this.clampText(block.command, CleanSlateRenderPayloadCodec.MAX_LIST_ITEM_CHARS, true);
            base.output = this.clampText(block.output, CleanSlateRenderPayloadCodec.MAX_TERMINAL_OUTPUT_CHARS, false);
            if (typeof block.exitCode === 'number') {
                base.exitCode = block.exitCode;
            }
            return base;
        }

        if (block.type === 'file') {
            base.path = this.clampText(block.path, CleanSlateRenderPayloadCodec.MAX_FILE_PATH_CHARS, true);
            base.status = this.clampText(block.status, CleanSlateRenderPayloadCodec.MAX_LIST_ITEM_CHARS, true);
            if (typeof block.added === 'number') {
                base.added = block.added;
            }
            if (typeof block.deleted === 'number') {
                base.deleted = block.deleted;
            }
            if (typeof block.range === 'string') {
                base.range = this.clampText(block.range, CleanSlateRenderPayloadCodec.MAX_LIST_ITEM_CHARS, true);
            }
            if (typeof block.diff === 'string') {
                base.diff = this.clampText(block.diff, CleanSlateRenderPayloadCodec.MAX_CODE_SNIPPET_CHARS, false);
            }
            if (typeof block.beforeContent === 'string') {
                base.beforeContent = this.snapshotForPayload(block.beforeContent);
            }
            if (typeof block.afterContent === 'string') {
                base.afterContent = this.snapshotForPayload(block.afterContent);
            }
            if (typeof block.fileCount === 'number') {
                base.fileCount = block.fileCount;
            }
            if (typeof block.searchCount === 'number') {
                base.searchCount = block.searchCount;
            }
            if (Array.isArray(block.details)) {
                base.details = block.details
                    .filter(detail => typeof detail === 'string')
                    .slice(0, CleanSlateRenderPayloadCodec.MAX_DETAIL_ITEMS)
                    .map(detail => this.clampText(detail, CleanSlateRenderPayloadCodec.MAX_DETAIL_ITEM_CHARS, true) || detail.slice(0, CleanSlateRenderPayloadCodec.MAX_DETAIL_ITEM_CHARS));
            }
            return base;
        }

        if (block.type === 'browser') {
            base.browserToolName = this.clampText(block.browserToolName, CleanSlateRenderPayloadCodec.MAX_TOOL_NAME_CHARS, true);
            base.browserAction = this.clampText(block.browserAction, CleanSlateRenderPayloadCodec.MAX_LIST_ITEM_CHARS, true);
            base.browserUrl = this.clampText(block.browserUrl, CleanSlateRenderPayloadCodec.MAX_FILE_PATH_CHARS, true);
            base.browserTitle = this.clampText(block.browserTitle, CleanSlateRenderPayloadCodec.MAX_LIST_ITEM_CHARS, true);
            base.status = this.clampText(block.status, CleanSlateRenderPayloadCodec.MAX_LIST_ITEM_CHARS, true);
            if (block.browserStatus === 'running' || block.browserStatus === 'completed' || block.browserStatus === 'failed') {
                base.browserStatus = block.browserStatus;
            }
            if (Array.isArray(block.details)) {
                base.details = block.details
                    .filter(detail => typeof detail === 'string')
                    .slice(0, CleanSlateRenderPayloadCodec.MAX_DETAIL_ITEMS)
                    .map(detail => this.clampText(detail, CleanSlateRenderPayloadCodec.MAX_DETAIL_ITEM_CHARS, true) || detail.slice(0, CleanSlateRenderPayloadCodec.MAX_DETAIL_ITEM_CHARS));
            }
            if (Array.isArray(block.browserScreenshots)) {
                base.browserScreenshots = block.browserScreenshots
                    .filter(screenshot =>
                        screenshot
                        && typeof screenshot.base64 === 'string'
                        && screenshot.base64.length > 0
                        && screenshot.base64.length <= CleanSlateRenderPayloadCodec.MAX_BROWSER_SCREENSHOT_BASE64_CHARS
                    )
                    .slice(0, CleanSlateRenderPayloadCodec.MAX_BROWSER_SCREENSHOTS)
                    .map(screenshot => ({
                        label: this.clampText(screenshot.label, CleanSlateRenderPayloadCodec.MAX_LIST_ITEM_CHARS, true) || 'Screenshot',
                        mimeType: this.clampText(screenshot.mimeType, 64, true) || 'image/jpeg',
                        base64: screenshot.base64
                    }));
            }
            if (!base.browserAction && !base.browserUrl && (!base.details || base.details.length === 0) && (!base.browserScreenshots || base.browserScreenshots.length === 0)) {
                return undefined;
            }
            return base;
        }

        if (block.type === 'web') {
            if (block.webToolName === 'web_search' || block.webToolName === 'web_fetch') {
                base.webToolName = block.webToolName;
            }
            base.webAction = this.clampText(block.webAction, CleanSlateRenderPayloadCodec.MAX_LIST_ITEM_CHARS, true);
            base.webQuery = this.clampText(block.webQuery, CleanSlateRenderPayloadCodec.MAX_LIST_ITEM_CHARS, true);
            base.webProvider = this.clampText(block.webProvider, CleanSlateRenderPayloadCodec.MAX_TOOL_NAME_CHARS, true);
            base.webUrl = this.clampText(block.webUrl, CleanSlateRenderPayloadCodec.MAX_FILE_PATH_CHARS, true);
            base.webFinalUrl = this.clampText(block.webFinalUrl, CleanSlateRenderPayloadCodec.MAX_FILE_PATH_CHARS, true);
            base.webTitle = this.clampText(block.webTitle, CleanSlateRenderPayloadCodec.MAX_LIST_ITEM_CHARS, true);
            base.webContentType = this.clampText(block.webContentType, CleanSlateRenderPayloadCodec.MAX_LIST_ITEM_CHARS, true);
            base.webContentPreview = this.clampText(block.webContentPreview, CleanSlateRenderPayloadCodec.MAX_WEB_CONTENT_PREVIEW_CHARS, false);
            base.webTruncated = block.webTruncated === true;
            if (typeof block.webBytes === 'number' && Number.isFinite(block.webBytes)) {
                base.webBytes = block.webBytes;
            }
            if (block.webStatus === 'running' || block.webStatus === 'completed' || block.webStatus === 'failed') {
                base.webStatus = block.webStatus;
            }
            if (Array.isArray(block.webResults)) {
                base.webResults = block.webResults
                    .filter(result => result && typeof result.url === 'string' && result.url.trim().length > 0)
                    .slice(0, CleanSlateRenderPayloadCodec.MAX_WEB_RESULTS)
                    .map(result => ({
                        title: this.clampText(result.title, CleanSlateRenderPayloadCodec.MAX_LIST_ITEM_CHARS, true) || result.url.slice(0, CleanSlateRenderPayloadCodec.MAX_LIST_ITEM_CHARS),
                        url: this.clampText(result.url, CleanSlateRenderPayloadCodec.MAX_FILE_PATH_CHARS, true) || result.url.slice(0, CleanSlateRenderPayloadCodec.MAX_FILE_PATH_CHARS),
                        snippet: this.clampText(result.snippet, CleanSlateRenderPayloadCodec.MAX_WEB_SNIPPET_CHARS, true),
                        source: this.clampText(result.source, CleanSlateRenderPayloadCodec.MAX_LIST_ITEM_CHARS, true),
                        provider: this.clampText(result.provider, CleanSlateRenderPayloadCodec.MAX_TOOL_NAME_CHARS, true),
                        publishedDate: this.clampText(result.publishedDate, 64, true)
                    }));
            }
            if (Array.isArray(block.webAttempts)) {
                base.webAttempts = block.webAttempts
                    .filter(attempt => attempt && typeof attempt.provider === 'string')
                    .slice(0, CleanSlateRenderPayloadCodec.MAX_WEB_ATTEMPTS)
                    .map(attempt => ({
                        provider: this.clampText(attempt.provider, CleanSlateRenderPayloadCodec.MAX_TOOL_NAME_CHARS, true) || attempt.provider.slice(0, CleanSlateRenderPayloadCodec.MAX_TOOL_NAME_CHARS),
                        status: attempt.status === 'success' || attempt.status === 'failed' || attempt.status === 'skipped' ? attempt.status : 'failed',
                        reason: this.clampText(attempt.reason, CleanSlateRenderPayloadCodec.MAX_DETAIL_ITEM_CHARS, true),
                        durationMs: typeof attempt.durationMs === 'number' && Number.isFinite(attempt.durationMs) ? attempt.durationMs : undefined
                    }));
            }
            if (Array.isArray(block.details)) {
                base.details = block.details
                    .filter(detail => typeof detail === 'string')
                    .slice(0, CleanSlateRenderPayloadCodec.MAX_DETAIL_ITEMS)
                    .map(detail => this.clampText(detail, CleanSlateRenderPayloadCodec.MAX_DETAIL_ITEM_CHARS, true) || detail.slice(0, CleanSlateRenderPayloadCodec.MAX_DETAIL_ITEM_CHARS));
            }
            if (!base.webAction
                && !base.webQuery
                && !base.webUrl
                && !base.webFinalUrl
                && !base.webTitle
                && !base.webContentPreview
                && (!base.webResults || base.webResults.length === 0)
                && (!base.details || base.details.length === 0)) {
                return undefined;
            }
            return base;
        }

        if (block.type === 'tool') {
            base.toolName = this.clampText(block.toolName, CleanSlateRenderPayloadCodec.MAX_TOOL_NAME_CHARS, true);
            base.content = this.clampText(block.content, CleanSlateRenderPayloadCodec.MAX_LIST_ITEM_CHARS, true);
            base.status = this.clampText(block.status, CleanSlateRenderPayloadCodec.MAX_LIST_ITEM_CHARS, true);
            if (block.toolStatus === 'running' || block.toolStatus === 'completed' || block.toolStatus === 'failed') {
                base.toolStatus = block.toolStatus;
            }
            if (!base.toolName && !base.content && !base.status) {
                return undefined;
            }
            return base;
        }

        if (block.type === 'finish') {
            base.content = this.clampText(block.content, CleanSlateRenderPayloadCodec.MAX_TEXT_BLOCK_CHARS, false);
            base.status = this.clampText(block.status, CleanSlateRenderPayloadCodec.MAX_LIST_ITEM_CHARS, true);
            if (Array.isArray(block.fileChanges)) {
                base.fileChanges = block.fileChanges
                    .filter(change => change && typeof change.path === 'string' && change.path.trim().length > 0)
                    .slice(0, CleanSlateRenderPayloadCodec.MAX_FILE_EDIT_ENTRIES)
                    .map(change => ({
                        path: this.clampText(change.path, CleanSlateRenderPayloadCodec.MAX_FILE_PATH_CHARS, true) || change.path.slice(0, CleanSlateRenderPayloadCodec.MAX_FILE_PATH_CHARS),
                        added: typeof change.added === 'number' ? change.added : undefined,
                        deleted: typeof change.deleted === 'number' ? change.deleted : undefined,
                        diff: this.clampText(change.diff, CleanSlateRenderPayloadCodec.MAX_CODE_SNIPPET_CHARS, false),
                        beforeContent: this.snapshotForPayload(change.beforeContent),
                        afterContent: this.snapshotForPayload(change.afterContent)
                    }));
            }
            if (!base.content && (!base.fileChanges || base.fileChanges.length === 0)) {
                return undefined;
            }
            return base;
        }

        if (block.type === 'turn') {
            const childBlocks = Array.isArray(block.blocks)
                ? block.blocks
                    .filter(child => !child.isOptimistic)
                    .map(child => this.sanitizeTimelineBlock(child))
                    .filter((child): child is InteractionBlock => !!child)
                : [];
            if (childBlocks.length === 0) {
                return undefined;
            }
            base.blocks = childBlocks;
            base.status = this.clampText(block.status, CleanSlateRenderPayloadCodec.MAX_LIST_ITEM_CHARS, true);
            return base;
        }

        return undefined;
    }

    private sanitizeTerminalOutputs(
        terminalOutputs: { [command: string]: { output: string; exitCode: number } },
        terminalCommands: string[]
    ): { [command: string]: { output: string; exitCode: number } } {
        if (!terminalOutputs || typeof terminalOutputs !== 'object') {
            return {};
        }

        const orderedCommands = terminalCommands.length > 0
            ? terminalCommands
            : Object.keys(terminalOutputs);

        const result: { [command: string]: { output: string; exitCode: number } } = {};
        for (const command of orderedCommands.slice(-20)) {
            const entry = terminalOutputs[command];
            if (!entry) {
                continue;
            }

            const safeCommand = this.clampText(command, CleanSlateRenderPayloadCodec.MAX_LIST_ITEM_CHARS, true);
            if (!safeCommand) {
                continue;
            }

            result[safeCommand] = {
                output: this.clampText(entry.output, CleanSlateRenderPayloadCodec.MAX_TERMINAL_OUTPUT_CHARS, false) || '',
                exitCode: Number.isFinite(entry.exitCode) ? entry.exitCode : -1
            };
        }

        return result;
    }

    public clampLiveTerminalOutput(output: string): string {
        if (output.length <= CleanSlateRenderPayloadCodec.MAX_TERMINAL_OUTPUT_CHARS) {
            return output;
        }
        const omitted = output.length - CleanSlateRenderPayloadCodec.MAX_TERMINAL_OUTPUT_CHARS;
        const marker = `\n...[terminal output truncated in renderer: ${omitted} chars omitted]`;
        return `${output.slice(0, Math.max(0, CleanSlateRenderPayloadCodec.MAX_TERMINAL_OUTPUT_CHARS - marker.length))}${marker}`;
    }

    private normalizeSummaryField(field: string | string[] | undefined): string | string[] | undefined {
        if (Array.isArray(field)) {
            const normalized = field
                .filter((item): item is string => typeof item === 'string')
                .map(item => this.clampText(item, CleanSlateRenderPayloadCodec.MAX_TEXT_BLOCK_CHARS, true))
                .filter((item): item is string => typeof item === 'string' && item.length > 0)
                .slice(0, 12);
            return normalized.length > 0 ? normalized : undefined;
        }

        const normalized = this.clampText(field, CleanSlateRenderPayloadCodec.MAX_TEXT_BLOCK_CHARS, true);
        return normalized || undefined;
    }

    public clampText(value: string | undefined, maxChars: number, trim: boolean): string | undefined {
        if (typeof value !== 'string') {
            return undefined;
        }

        const normalized = trim ? value.trim() : value;
        if (!normalized) {
            return undefined;
        }

        if (normalized.length <= maxChars) {
            return normalized;
        }

        return `${normalized.slice(0, maxChars)}...`;
    }

    /**
     * A before/after snapshot is only kept when it fits the snippet budget. When
     * it doesn't, it's dropped (undefined) rather than clamped: a truncated
     * snapshot renders as a broken diff, whereas dropping it lets the transcript
     * fall back to the compact unified diff, which is always complete.
     */
    private snapshotForPayload(value: string | undefined): string | undefined {
        if (typeof value !== 'string') {
            return undefined;
        }
        return value.length <= CleanSlateRenderPayloadCodec.MAX_CODE_SNIPPET_CHARS ? value : undefined;
    }

    public extractToDoItems(parsed: ChatResponse): string[] {
        const rawToDo = Array.isArray(parsed.to_do) ? parsed.to_do : [];

        return rawToDo.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    }

    public extractLatestSummaryText(parsed: ChatResponse): string | undefined {
        if (Array.isArray(parsed.summary)) {
            for (let i = parsed.summary.length - 1; i >= 0; i--) {
                const entry = parsed.summary[i];
                if (typeof entry === 'string' && entry.trim().length > 0) {
                    return entry.trim();
                }
            }
            return undefined;
        }

        return typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
            ? parsed.summary.trim()
            : undefined;
    }

}
