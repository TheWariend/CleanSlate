/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InteractionBlock } from '../types/cleanSlateChatTypes.js';
import { CleanSlateRenderPayloadCodec } from './cleanSlateRenderPayloadCodec.js';

/** Converts tool activity into stable, user-facing timeline presentation. */
export class CleanSlateToolPresentation {
    private readonly renderPayloadCodec = new CleanSlateRenderPayloadCodec();

    private isCommandExecutionTool(toolName: string): boolean {
        return toolName === 'execute_command' || toolName === 'start_background_command';
    }

    public isBrowserTool(toolName: string): boolean {
        return toolName === 'browser_open'
            || toolName === 'browser_snapshot'
            || toolName === 'browser_click'
            || toolName === 'browser_hover'
            || toolName === 'browser_fill'
            || toolName === 'browser_check'
            || toolName === 'browser_select'
            || toolName === 'browser_upload'
            || toolName === 'browser_type'
            || toolName === 'browser_key'
            || toolName === 'browser_scroll'
            || toolName === 'browser_screenshot'
            || toolName === 'browser_diagnostics'
            || toolName === 'browser_dialog'
            || toolName === 'browser_clipboard'
            || toolName === 'browser_tabs'
            || toolName === 'browser_new_tab'
            || toolName === 'browser_select_tab'
            || toolName === 'browser_close_tab'
            || toolName === 'browser_get_url'
            || toolName === 'browser_wait'
            || toolName === 'browser_start_annotation'
            || toolName === 'browser_stop_annotation'
            || toolName === 'browser_list_annotations'
            || toolName === 'browser_delete_annotation'
            || toolName === 'browser_clear_annotations';
    }

    public createBrowserTimelineBlock(id: string, toolName: string, input: any, isStreaming: boolean): InteractionBlock {
        const label = this.describeBrowserToolStart(toolName, input);
        return {
            id,
            type: 'browser',
            browserToolName: toolName,
            browserAction: label,
            browserUrl: typeof input?.url === 'string' ? input.url : undefined,
            browserStatus: isStreaming ? 'running' : 'completed',
            status: isStreaming ? 'Running' : 'Completed',
            details: [label],
            isStreaming
        };
    }

    public updateBrowserTimelineBlock(block: InteractionBlock, toolName: string, input: any, result: any): void {
        const failed = result?.success === false;
        block.browserToolName = toolName;
        block.browserStatus = failed ? 'failed' : 'completed';
        block.status = failed ? 'Failed' : 'Completed';
        block.browserUrl = typeof result?.url === 'string'
            ? result.url
            : typeof input?.url === 'string'
                ? input.url
                : block.browserUrl;
        block.browserTitle = typeof result?.title === 'string' ? result.title : block.browserTitle;
        block.browserAction = this.describeBrowserToolResult(toolName, input, result);
        block.details = this.buildBrowserTimelineDetails(toolName, input, result);
        block.browserScreenshots = this.extractBrowserScreenshots(toolName, result);
    }

    private describeBrowserToolStart(toolName: string, input: any): string {
        switch (toolName) {
            case 'browser_open':
                return `Opening ${typeof input?.url === 'string' ? input.url : 'browser page'}`;
            case 'browser_snapshot':
                return 'Inspecting DOM snapshot';
            case 'browser_click':
                return `Clicking ${this.formatBrowserTarget(input)}`;
            case 'browser_hover':
                return `Hovering ${this.formatBrowserTarget(input)}`;
            case 'browser_fill':
                return `Filling ${this.formatBrowserTarget(input)}`;
            case 'browser_check':
                return `${input?.checked === false ? 'Unchecking' : 'Checking'} ${this.formatBrowserTarget(input)}`;
            case 'browser_select':
                return `Selecting ${this.formatBrowserTarget(input)}`;
            case 'browser_upload':
                return `Uploading to ${this.formatBrowserTarget(input)}`;
            case 'browser_type':
                return 'Typing in browser';
            case 'browser_key':
                return `Pressing ${input?.key || 'browser key'}`;
            case 'browser_scroll':
                return 'Scrolling browser page';
            case 'browser_screenshot':
                return input?.fullPage ? 'Capturing full-page screenshot' : 'Capturing viewport screenshot';
            case 'browser_diagnostics':
                return 'Reading browser diagnostics';
            case 'browser_dialog':
                return input?.accept === false ? 'Dismissing browser dialog' : 'Accepting browser dialog';
            case 'browser_clipboard':
                return input?.action === 'write' ? 'Writing browser clipboard' : 'Reading browser clipboard';
            case 'browser_tabs':
                return 'Reading browser tabs';
            case 'browser_new_tab':
                return 'Opening new browser tab';
            case 'browser_select_tab':
                return 'Switching browser tab';
            case 'browser_close_tab':
                return 'Closing browser tab';
            case 'browser_start_annotation':
                return 'Starting browser annotation mode';
            case 'browser_stop_annotation':
                return 'Stopping browser annotation mode';
            case 'browser_list_annotations':
                return 'Reading browser annotations';
            case 'browser_delete_annotation':
                return 'Deleting browser annotation';
            case 'browser_clear_annotations':
                return 'Clearing browser annotations';
            default:
                return `Running ${toolName}`;
        }
    }

    private describeBrowserToolResult(toolName: string, input: any, result: any): string {
        if (result?.success === false) {
            return `${this.describeBrowserToolStart(toolName, input)} failed`;
        }

        if (toolName === 'browser_snapshot') {
            const count = Array.isArray(result?.elements) ? result.elements.length : 0;
            return count > 0 ? `Captured DOM snapshot with ${count} visible element${count === 1 ? '' : 's'}` : 'Captured DOM snapshot';
        }

        if (toolName === 'browser_screenshot') {
            return 'Captured browser screenshot';
        }

        if (toolName === 'browser_open') {
            const url = typeof result?.url === 'string'
                ? result.url
                : typeof input?.url === 'string'
                    ? input.url
                    : undefined;
            return url ? `Opened ${url}` : 'Opened browser page';
        }

        if (toolName === 'browser_scroll') {
            return 'Scrolled browser page';
        }

        if (toolName === 'browser_click') {
            return `Clicked ${result?.target || this.formatBrowserTarget(input)}`;
        }

        return this.describeBrowserToolStart(toolName, input);
    }

    private buildBrowserTimelineDetails(toolName: string, input: any, result: any): string[] {
        const details: string[] = [];
        const add = (value: unknown) => {
            if (typeof value === 'string' && value.trim().length > 0) {
                details.push(value.trim());
            }
        };

        if (result?.success === false) {
            add(typeof result?.error === 'string' ? result.error : 'Browser tool failed');
            return details;
        }

        add(typeof result?.url === 'string' ? `URL ${result.url}` : undefined);
        add(typeof result?.title === 'string' ? `Title ${result.title}` : undefined);

        if (toolName === 'browser_snapshot' && Array.isArray(result?.elements)) {
            // Keep every snapshot element in the presentation model. The
            // transcript renderer owns the disclosure threshold and count.
            for (const element of result.elements) {
                add(`${element.id}: <${element.tagName || 'element'}> ${element.text || element.ariaLabel || element.placeholder || ''}`.trim());
            }
        } else if (toolName === 'browser_scroll') {
            add(`Delta ${typeof input?.deltaX === 'number' ? input.deltaX : 0}, ${typeof input?.deltaY === 'number' ? input.deltaY : 0}`);
        } else if (toolName === 'browser_tabs' && Array.isArray(result?.tabs)) {
            for (const tab of result.tabs) {
                add(`${tab?.active ? 'Active' : 'Tab'} ${tab?.title || tab?.url || tab?.id || ''}`.trim());
            }
        } else if (toolName === 'browser_diagnostics') {
            const consoleCount = Array.isArray(result?.console) ? result.console.length : 0;
            const networkCount = Array.isArray(result?.network) ? result.network.length : 0;
            const downloadCount = Array.isArray(result?.downloads) ? result.downloads.length : 0;
            add(`${consoleCount} console messages, ${networkCount} network requests, ${downloadCount} downloads`);
        }

        return details;
    }

    private formatBrowserTarget(input: any): string {
        return input?.elementId
            || input?.selector
            || input?.testId
            || input?.name
            || input?.label
            || input?.placeholder
            || input?.text
            || input?.role
            || this.formatBrowserPoint(input)
            || 'page element';
    }

    private extractBrowserScreenshots(toolName: string, result: any): { label: string; mimeType: string; base64: string }[] {
        const screenshots: { label: string; mimeType: string; base64: string }[] = [];
        const addScreenshot = (label: string, value: any) => {
            if (screenshots.length >= 6 || typeof value?.base64 !== 'string' || value.base64.length === 0) {
                return;
            }
            screenshots.push({
                label,
                mimeType: typeof value.mimeType === 'string' ? value.mimeType : 'image/jpeg',
                base64: value.base64
            });
        };

        if (toolName === 'browser_screenshot') {
            addScreenshot('Viewport', result);
            return screenshots;
        }

        return screenshots;
    }

    private formatBrowserPoint(input: any): string | undefined {
        return typeof input?.x === 'number' && typeof input?.y === 'number'
            ? `(${Math.round(input.x)}, ${Math.round(input.y)})`
            : undefined;
    }

    public isWebRetrievalTool(toolName: string): toolName is 'web_search' | 'web_fetch' {
        return toolName === 'web_search' || toolName === 'web_fetch';
    }

    public createWebRetrievalTimelineBlock(id: string, toolName: string, input: any, isStreaming: boolean): InteractionBlock {
        const webToolName = this.isWebRetrievalTool(toolName) ? toolName : 'web_search';
        return {
            id,
            type: 'web',
            webToolName,
            webAction: this.describeWebRetrievalStart(toolName, input),
            webStatus: isStreaming ? 'running' : 'completed',
            status: isStreaming ? 'Running' : 'Completed',
            webQuery: typeof input?.query === 'string' ? this.renderPayloadCodec.clampText(input.query, CleanSlateRenderPayloadCodec.MAX_LIST_ITEM_CHARS, true) : undefined,
            webUrl: typeof input?.url === 'string' ? this.renderPayloadCodec.clampText(input.url, CleanSlateRenderPayloadCodec.MAX_FILE_PATH_CHARS, true) : undefined,
            isStreaming
        };
    }

    public updateWebRetrievalTimelineBlock(block: InteractionBlock, toolName: string, input: any, result: any): void {
        const failed = result?.success === false;
        const webToolName = this.isWebRetrievalTool(toolName) ? toolName : 'web_search';
        block.type = 'web';
        block.webToolName = webToolName;
        block.webStatus = failed ? 'failed' : 'completed';
        block.status = failed ? 'Failed' : 'Completed';
        block.webAction = this.describeWebRetrievalResult(toolName, input, result);
        block.details = this.buildWebRetrievalDetails(result);

        if (webToolName === 'web_search') {
            block.webQuery = this.renderPayloadCodec.clampText(
                typeof result?.query === 'string' ? result.query : typeof input?.query === 'string' ? input.query : undefined,
                CleanSlateRenderPayloadCodec.MAX_LIST_ITEM_CHARS,
                true
            );
            block.webProvider = this.renderPayloadCodec.clampText(result?.provider, CleanSlateRenderPayloadCodec.MAX_TOOL_NAME_CHARS, true);
            block.webResults = this.normalizeWebResults(result?.results);
            block.webAttempts = this.normalizeWebAttempts(result?.attempts);
            return;
        }

        block.webUrl = this.renderPayloadCodec.clampText(
            typeof result?.url === 'string' ? result.url : typeof input?.url === 'string' ? input.url : undefined,
            CleanSlateRenderPayloadCodec.MAX_FILE_PATH_CHARS,
            true
        );
        block.webFinalUrl = this.renderPayloadCodec.clampText(result?.finalUrl, CleanSlateRenderPayloadCodec.MAX_FILE_PATH_CHARS, true);
        block.webTitle = this.renderPayloadCodec.clampText(result?.title, CleanSlateRenderPayloadCodec.MAX_LIST_ITEM_CHARS, true);
        block.webContentType = this.renderPayloadCodec.clampText(result?.contentType, CleanSlateRenderPayloadCodec.MAX_LIST_ITEM_CHARS, true);
        block.webBytes = typeof result?.bytes === 'number' && Number.isFinite(result.bytes) ? result.bytes : undefined;
        block.webTruncated = result?.truncated === true;
        block.webContentPreview = this.normalizeWebContentPreview(result?.content);
    }

    private describeWebRetrievalStart(toolName: string, input: any): string {
        if (toolName === 'web_search') {
            const query = typeof input?.query === 'string' && input.query.trim().length > 0 ? input.query.trim() : '';
            return query ? `Searching the web for "${query}"` : 'Searching the web';
        }

        if (toolName === 'web_fetch') {
            const url = typeof input?.url === 'string' && input.url.trim().length > 0 ? input.url.trim() : '';
            return url ? `Reading web page ${url}` : 'Reading web page';
        }

        return `Using ${toolName}`;
    }

    private describeWebRetrievalResult(toolName: string, input: any, result: any): string {
        if (result?.success === false) {
            return `${this.describeWebRetrievalStart(toolName, input)} failed`;
        }

        if (toolName === 'web_search') {
            const count = Array.isArray(result?.results) ? result.results.length : 0;
            const provider = this.formatWebProviderForDisplay(typeof result?.provider === 'string' ? result.provider : '');
            const sourceText = count > 0 ? `${count} source${count === 1 ? '' : 's'}` : 'no sources';
            return provider ? `Searched web with ${provider} - ${sourceText}` : `Searched web - ${sourceText}`;
        }

        if (toolName === 'web_fetch') {
            const title = typeof result?.title === 'string' && result.title.trim().length > 0 ? result.title.trim() : '';
            const url = typeof result?.finalUrl === 'string' && result.finalUrl.trim().length > 0
                ? result.finalUrl.trim()
                : typeof result?.url === 'string' && result.url.trim().length > 0
                    ? result.url.trim()
                    : typeof input?.url === 'string'
                        ? input.url.trim()
                        : '';
            return title ? `Read web page "${title}"` : url ? `Read web page ${url}` : 'Read web page';
        }

        return `${toolName} completed`;
    }

    private buildWebRetrievalDetails(result: any): string[] {
        const details: string[] = [];
        const add = (value: unknown) => {
            if (typeof value === 'string' && value.trim().length > 0) {
                details.push(this.renderPayloadCodec.clampText(value, CleanSlateRenderPayloadCodec.MAX_DETAIL_ITEM_CHARS, true) || value.slice(0, CleanSlateRenderPayloadCodec.MAX_DETAIL_ITEM_CHARS));
            }
        };

        if (result?.success === false) {
            add(typeof result?.error === 'string' ? result.error : 'Web retrieval failed');
        }

        if (typeof result?.sourcePolicy === 'string') {
            add(result.sourcePolicy);
        }

        return details.slice(0, CleanSlateRenderPayloadCodec.MAX_DETAIL_ITEMS);
    }

    private normalizeWebResults(results: any): NonNullable<InteractionBlock['webResults']> | undefined {
        if (!Array.isArray(results)) {
            return undefined;
        }

        const normalized = results
            .filter(result => result && typeof result.url === 'string' && result.url.trim().length > 0)
            .slice(0, CleanSlateRenderPayloadCodec.MAX_WEB_RESULTS)
            .map(result => {
                const url = this.renderPayloadCodec.clampText(result.url, CleanSlateRenderPayloadCodec.MAX_FILE_PATH_CHARS, true) || result.url.slice(0, CleanSlateRenderPayloadCodec.MAX_FILE_PATH_CHARS);
                const fallbackTitle = this.hostnameFromUrl(url) || url;
                return {
                    title: this.renderPayloadCodec.clampText(result.title, CleanSlateRenderPayloadCodec.MAX_LIST_ITEM_CHARS, true) || fallbackTitle,
                    url,
                    snippet: this.renderPayloadCodec.clampText(result.snippet, CleanSlateRenderPayloadCodec.MAX_WEB_SNIPPET_CHARS, true),
                    source: this.renderPayloadCodec.clampText(result.source, CleanSlateRenderPayloadCodec.MAX_LIST_ITEM_CHARS, true) || this.hostnameFromUrl(url),
                    provider: this.renderPayloadCodec.clampText(result.provider, CleanSlateRenderPayloadCodec.MAX_TOOL_NAME_CHARS, true),
                    publishedDate: this.renderPayloadCodec.clampText(result.publishedDate, 64, true)
                };
            });

        return normalized.length > 0 ? normalized : undefined;
    }

    private normalizeWebAttempts(attempts: any): NonNullable<InteractionBlock['webAttempts']> | undefined {
        if (!Array.isArray(attempts)) {
            return undefined;
        }

        const normalized = attempts
            .filter(attempt => attempt && typeof attempt.provider === 'string')
            .slice(0, CleanSlateRenderPayloadCodec.MAX_WEB_ATTEMPTS)
            .map(attempt => ({
                provider: this.renderPayloadCodec.clampText(attempt.provider, CleanSlateRenderPayloadCodec.MAX_TOOL_NAME_CHARS, true) || attempt.provider.slice(0, CleanSlateRenderPayloadCodec.MAX_TOOL_NAME_CHARS),
                status: attempt.status === 'success' || attempt.status === 'failed' || attempt.status === 'skipped' ? attempt.status : 'failed',
                reason: this.renderPayloadCodec.clampText(attempt.reason, CleanSlateRenderPayloadCodec.MAX_DETAIL_ITEM_CHARS, true),
                durationMs: typeof attempt.durationMs === 'number' && Number.isFinite(attempt.durationMs) ? attempt.durationMs : undefined
            }));

        return normalized.length > 0 ? normalized : undefined;
    }

    private normalizeWebContentPreview(content: unknown): string | undefined {
        if (typeof content !== 'string') {
            return undefined;
        }

        const normalized = content
            .replace(/\r\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        return this.renderPayloadCodec.clampText(normalized, CleanSlateRenderPayloadCodec.MAX_WEB_CONTENT_PREVIEW_CHARS, false);
    }

    private hostnameFromUrl(value: string | undefined): string | undefined {
        if (typeof value !== 'string' || value.trim().length === 0) {
            return undefined;
        }

        try {
            return new URL(value).hostname.replace(/^www\./i, '');
        } catch {
            return undefined;
        }
    }

    private formatWebProviderForDisplay(provider: string): string {
        switch (provider) {
            case 'searxng':
                return 'SearXNG';
            case 'exaMcpAnonymous':
                return 'Exa MCP';
            case 'parallelMcpAnonymous':
                return 'Parallel MCP';
            default:
                return provider
                    .replace(/Mcp/g, ' MCP')
                    .replace(/Anonymous/g, '')
                    .replace(/[_-]+/g, ' ')
                    .trim();
        }
    }

    public describeToolStart(toolName: string, input: any): string {
        if (this.isBrowserTool(toolName)) {
            return this.describeBrowserToolStart(toolName, input);
        }

        if (this.isWebRetrievalTool(toolName)) {
            return this.describeWebRetrievalStart(toolName, input);
        }

        if (this.isCommandExecutionTool(toolName)) {
            const command = typeof input?.command === 'string' ? this.formatTerminalCommandForDisplay(input.command) : '';
            return command ? `Running command: ${command}` : 'Running command';
        }

        if (toolName === 'write_file' || toolName === 'create_and_write_file') {
            const path = input?.file_path ?? input?.path;
            return typeof path === 'string' && path.trim().length > 0
                ? `Writing file: ${path}`
                : 'Writing file';
        }

        if (toolName === 'create_multiple_files') {
            const count = Array.isArray(input?.files) ? input.files.length : 0;
            return count > 0 ? `Creating ${count} file${count === 1 ? '' : 's'}` : 'Creating files';
        }

        if (toolName === 'multi_file_replace') {
            const count = Array.isArray(input?.edits) ? input.edits.length : 0;
            return count > 0 ? `Updating ${count} file${count === 1 ? '' : 's'}` : 'Updating files';
        }

        if (toolName === 'apply_edit') {
            const path = input?.file_path ?? input?.path;
            return typeof path === 'string' && path.trim().length > 0
                ? `Applying edit to ${path}`
                : 'Applying edit';
        }

        if (toolName === 'submit_artifact') {
            return typeof input?.path === 'string' && input.path.trim().length > 0
                ? `Submitting ${input.path}`
                : 'Submitting artifact';
        }

        if (toolName === 'update_todo') {
            return 'Updating task list';
        }

        if (toolName === 'ask_question') {
            return 'Preparing question';
        }

        if (toolName === 'get_open_files') {
            return 'Reading open files';
        }

        if (toolName === 'mcp_call_tool') {
            return typeof input?.toolName === 'string' && input.toolName.trim().length > 0
                ? `Calling ${input.toolName}`
                : 'Calling MCP tool';
        }

        return `Started ${toolName}`;
    }

    public formatTerminalCommandForDisplay(command: string): string {
        let cleaned = this.stripTrailingPipeCat(command).trim();
        const verificationMarker = '); __cleanslate_status=$?;';
        const markerIndex = cleaned.indexOf(verificationMarker);
        if (cleaned.startsWith('(') && markerIndex > 0 && cleaned.includes('__CLEANSLATE_VERIFY_EXIT__')) {
            cleaned = cleaned.slice(1, markerIndex).trim();
        }
        return cleaned;
    }

    public stripCodeFence(code: string): string {
        if (!code.startsWith('```')) {
            return code;
        }

        const firstNewline = code.indexOf('\n');
        if (firstNewline < 0) {
            return code;
        }

        let stripped = code.slice(firstNewline + 1);
        if (stripped.endsWith('\n```')) {
            stripped = stripped.slice(0, -4);
        } else if (stripped.endsWith('```')) {
            stripped = stripped.slice(0, -3);
        }
        return stripped;
    }

    private stripTrailingPipeCat(command: string): string {
        const trimmedRight = command.trimEnd();
        if (!trimmedRight.endsWith('cat')) {
            return trimmedRight;
        }

        const beforeCat = trimmedRight.slice(0, -3).trimEnd();
        if (!beforeCat.endsWith('|')) {
            return trimmedRight;
        }

        return beforeCat.slice(0, -1).trimEnd();
    }

    public describeToolResult(toolName: string, result: any): string {
        const outcome = result?.success === false ? 'failed' : 'completed';

        if (this.isCommandExecutionTool(toolName)) {
            const command = typeof result?.command === 'string' ? result.command.trim() : '';
            const exitCode = typeof result?.exitCode === 'number' ? result.exitCode : undefined;
            const commandLabel = command || 'command';
            return typeof exitCode === 'number'
                ? `${commandLabel} ${outcome} with exit code ${exitCode}`
                : `${commandLabel} ${outcome}`;
        }

        if (this.isWebRetrievalTool(toolName)) {
            return this.describeWebRetrievalResult(toolName, {}, result);
        }

        const affectedFiles = this.extractAffectedPathCount(result);
        if (affectedFiles > 0) {
            return `${toolName} ${outcome} for ${affectedFiles} file${affectedFiles === 1 ? '' : 's'}`;
        }

        return `${toolName} ${outcome}`;
    }

    private extractAffectedPathCount(result: any): number {
        if (Array.isArray(result?.results)) {
            return result.results.filter((entry: any) => typeof entry?.path === 'string' && entry.path.trim().length > 0).length;
        }

        if (Array.isArray(result?.files)) {
            return result.files.filter((entry: any) => typeof entry?.path === 'string' && entry.path.trim().length > 0).length;
        }

        if (Array.isArray(result?.affectedFiles)) {
            return result.affectedFiles.filter((entry: any) => typeof entry === 'string' && entry.trim().length > 0).length;
        }

        return typeof result?.path === 'string' && result.path.trim().length > 0 ? 1 : 0;
    }

    public extractDiscoveredPathsFromToolResult(toolName: string, result: any): string[] {
        const paths = new Set<string>();
        const addPath = (value: unknown) => {
            if (typeof value !== 'string') {
                return;
            }
            const trimmed = value.trim();
            if (!trimmed) {
                return;
            }
            paths.add(trimmed);
        };

        addPath(result?.path);

        if (Array.isArray(result)) {
            for (const entry of result) {
                if (typeof entry === 'string') {
                    addPath(entry);
                    continue;
                }
                addPath(entry?.path);
                addPath(entry?.uri);
            }
        }

        if (Array.isArray(result?.results)) {
            for (const entry of result.results) {
                addPath(entry?.path);
            }
        }

        if (Array.isArray(result?.affectedFiles)) {
            for (const entry of result.affectedFiles) {
                addPath(entry);
            }
        }

        if (Array.isArray(result?.definitions)) {
            for (const definition of result.definitions) {
                addPath(definition?.uri);
            }
        }

        if (Array.isArray(result?.references)) {
            for (const reference of result.references) {
                addPath(reference?.uri);
            }
        }

        if (toolName === 'read_symbols' && typeof result?.path === 'string') {
            addPath(result.path);
        }

        return Array.from(paths);
    }

}
