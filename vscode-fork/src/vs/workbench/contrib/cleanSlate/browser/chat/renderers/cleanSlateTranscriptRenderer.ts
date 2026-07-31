/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../base/browser/dom.js';
import { MarkdownString } from '../../../../../../base/common/htmlContent.js';
import { REVEAL_TICK_MS, revealCutPoint } from '@cleanslate/sdk/agent/cleanSlateStreamReveal.js';
import { IDisposable } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IMarkdownRendererService } from '../../../../../../platform/markdown/browser/markdownRenderer.js';
import { IRenderedMarkdown } from '../../../../../../base/browser/markdownRenderer.js';
import { marked } from '../../../../../../base/common/marked/marked.js';
import { IMarkerService } from '../../../../../../platform/markers/common/markers.js';
import { IClipboardService } from '../../../../../../platform/clipboard/common/clipboardService.js';
import { IEditorService } from '../../../../../services/editor/common/editorService.js';
import { policy } from '../runtime/cleanSlateChatController.js';
import { applyCleanSlateAgentDisplayPolicy } from '../runtime/cleanSlateAgentDisplayPolicy.js';
import { normalizeCleanSlateBrowserScreenshotDataUrl } from '../runtime/cleanSlateBrowserScreenshotPresentation.js';
import { normalizeChatResponse } from '../runtime/cleanSlateChatResponseNormalizer.js';
import { ChatResponse, InteractionBlock } from '../types/cleanSlateChatTypes.js';
import { normalizeTerminalOutput } from '../../tools/terminalUtils.js';
import { renderAnsiToHtml } from './cleanSlateAnsiRenderer.js';
import { CleanSlateWebActivityRenderer } from './cleanSlateWebActivityRenderer.js';
import { CleanSlateTranscriptFileRenderer } from './cleanSlateTranscriptFileRenderer.js';

interface ICleanSlateAssistantMarkdownStreamState {
    targetContent: string;
    renderedContent: string;
    renderedWordCount: number;
    lastRenderTime: number;
    timer?: number;
    cancelTimer?: (timer: number) => void;
    isStreaming: boolean;
    onDidRender?: () => void;
}

interface ICleanSlateStreamingMarkdownState {
    committedRaw: string;
    disposables: IRenderedMarkdown[];
}

interface ICleanSlateReasoningStreamState {
    targetContent: string;
    // Text already committed to the DOM, tracked here so streaming never has to
    // read back body.textContent (an O(n) concat over the growing thought).
    renderedText?: string;
    animationFrame?: number;
    cancelAnimationFrame?: (frame: number) => void;
    completionTimer?: number;
    cancelCompletionTimer?: (timer: number) => void;
}

export class CleanSlateTranscriptRenderer {
    private readonly assistantMarkdownStreamStates = new Map<string, ICleanSlateAssistantMarkdownStreamState>();
    // Reasoning renders at the provider's stream pace. This state only
    // coalesces bursty deltas to one DOM write per paint frame; it never builds
    // a client-side character backlog that can fall behind later tool steps.
    private readonly reasoningStreamStates = new Map<string, ICleanSlateReasoningStreamState>();
    private readonly markdownRenderDisposables = new Map<HTMLElement, IDisposable>();
    private readonly expandedTerminalBlockIds = new Set<string>();
    private readonly fileRenderer: CleanSlateTranscriptFileRenderer;
    private readonly webActivityRenderer = new CleanSlateWebActivityRenderer();
    // Per-message streaming markdown: committed blocks render once (so their async
    // code widgets survive) and their raw text is never re-lexed; only the trailing,
    // still-growing block re-renders each tick.
    private readonly streamingMarkdownStates = new Map<string, ICleanSlateStreamingMarkdownState>();

    constructor(
        @IMarkerService markerService: IMarkerService,
        @IEditorService editorService: IEditorService,
        @IMarkdownRendererService private readonly markdownRendererService: IMarkdownRendererService,
        @IClipboardService private readonly clipboardService: IClipboardService
    ) {
        this.fileRenderer = new CleanSlateTranscriptFileRenderer(markerService, editorService, {
            disposeMarkdownRender: element => this.disposeMarkdownRender(element),
            setMarkdownIfChanged: (element, markdown, renderKey) => this.setMarkdownIfChanged(element, markdown, renderKey),
            setTrustedHtmlIfChanged: (element, html, renderKey) => this.setTrustedHtmlIfChanged(element, html, renderKey),
            openFile: (resource, options) => this.openFileOverride ? this.openFileOverride(resource, options) : false
        });
    }

    /**
     * When set, transcript file clicks are routed here (the agent manager opens
     * them in its embedded editor) instead of the IDE editor. Return true when
     * the click was handled.
     */
    public openFileOverride?: (resource: URI, options: { selection?: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } }) => boolean;
    
    /**
     * When set, the to-do step list is forwarded here instead of being rendered
     * inline inside the chat message bubble. The caller (plan dropup) is
     * responsible for displaying the steps.
     */
    public onDidUpdateToDo?: (steps: string[]) => void;

    renderJSONResponse(
        data: ChatResponse,
        isStreaming: boolean,
        messagesContainer: HTMLElement,
        targetMessage?: HTMLElement,
        onDidRender?: () => void
    ): void {
        const normalizedData = normalizeChatResponse(data);
        const displayData = applyCleanSlateAgentDisplayPolicy(normalizedData, {
            isStreaming,
            preserveTimeline: normalizedData.transcriptStatus === 'completed'
                || normalizedData.transcriptStatus === 'interrupted'
        });
        const messages = messagesContainer.querySelectorAll('.cleanSlate-chat-message.cleanSlate');
        const lastMessage = targetMessage || (messages[messages.length - 1] as HTMLElement);

        if (!lastMessage) {
            return;
        }

        let transcript = lastMessage.querySelector('.cleanSlate-message-transcript') as HTMLElement | null;
        if (!transcript) {
            transcript = dom.append(lastMessage, dom.$('.cleanSlate-message-transcript'));
        }

        // Forward the to_do steps to the plan dropup widget (owned by the view pane).
        const toDoSteps = normalizedData.to_do || [];
        this.onDidUpdateToDo?.(toDoSteps);

        const summaryText = this.getSummaryText(displayData.summary);
        // Each reasoning block renders in place, keyed by its own id (per-step
        // thinking). No cross-block merging — merging was what made a new
        // turn's thought appear to rewrite the earlier one at the head.
        const timelineBlocks = Array.isArray(displayData.timeline)
            ? displayData.timeline.filter(block => this.shouldRenderTimelineBlock(block))
            : [];
        const hasTimeline = timelineBlocks.length > 0;
        const activeTimelineBlockId = this.getActiveTimelineBlockId(timelineBlocks, isStreaming);
        const hasStreamingAssistantText = this.hasStreamingAssistantText(timelineBlocks);
        // A streaming reasoning block is its own "thinking" indicator ("Thinking for Xs"),
        // so the separate working placeholder must not also be shown alongside it —
        // otherwise the redundant placeholder gets yanked when the answer starts and the
        // layout jumps. Treat streaming reasoning like streaming assistant text here.
        const hasStreamingReasoning = this.hasStreamingReasoning(timelineBlocks);
        const hasStreamingContent = hasStreamingAssistantText || hasStreamingReasoning;
        const renderedTimelineIds = this.getRenderedTimelineBlockIds(timelineBlocks, 'root');
        this.removeStaleTimelineBlocks(transcript, renderedTimelineIds);

        if (hasTimeline) {
            if (hasStreamingContent) {
                transcript.querySelector('.cleanSlate-working-placeholder.placeholder')?.remove();
            }

            this.renderTimelineBlocks(timelineBlocks, transcript, isStreaming, 'root', onDidRender);
            this.removeFallbackSummaryBlock(transcript);
            this.syncTimelineBlockOrder(transcript, renderedTimelineIds);

            const placeholder = transcript.querySelector('.cleanSlate-working-placeholder.placeholder');
            if (isStreaming && !activeTimelineBlockId && !hasStreamingContent) {
                this.ensureWorkingPlaceholder(transcript, this.getWorkingPlaceholderLabel(displayData.lastToolName));
            } else if (placeholder && hasStreamingContent) {
                placeholder.remove();
            } else if (placeholder) {
                this.fadeOutWorkingPlaceholder(placeholder as HTMLElement);
            }
        } else if (isStreaming) {
            this.ensureWorkingPlaceholder(transcript, this.getWorkingPlaceholderLabel(displayData.lastToolName));
        } else {
            const placeholder = transcript.querySelector('.cleanSlate-working-placeholder.placeholder');
            if (placeholder) {
                placeholder.remove();
            }
        }

        if (!hasTimeline && summaryText && !isStreaming) {
            this.renderFallbackSummary(summaryText, transcript);
        } else if (!hasTimeline) {
            this.removeFallbackSummaryBlock(transcript);
        }

        this.removeEmptyTranscript(lastMessage, transcript, isStreaming);
        onDidRender?.();
    }

    private shouldRenderTimelineBlock(block: InteractionBlock): boolean {
        if (block.type === 'summary') {
            return typeof block.content === 'string' && block.content.trim().length > 0;
        }

        if (block.type === 'assistant_text') {
            return typeof block.content === 'string' && block.content.trim().length > 0;
        }

        if (block.type === 'reasoning') {
            return typeof block.content === 'string' && block.content.trim().length > 0;
        }

        if (block.type === 'terminal') {
            return typeof block.command === 'string' && block.command.trim().length > 0
                || typeof block.output === 'string' && block.output.trim().length > 0;
        }

        if (block.type === 'file') {
            return typeof block.path === 'string' && block.path.trim().length > 0
                || (Array.isArray(block.details) && block.details.length > 0)
                || typeof block.status === 'string' && block.status.trim().length > 0;
        }

        if (block.type === 'browser') {
            if (block.browserToolName === 'browser_get_url' || block.browserToolName === 'browser_wait') {
                return false;
            }
            return typeof block.browserAction === 'string' && block.browserAction.trim().length > 0
                || typeof block.browserUrl === 'string' && block.browserUrl.trim().length > 0
                || (Array.isArray(block.details) && block.details.length > 0)
                || (Array.isArray(block.browserScreenshots) && block.browserScreenshots.length > 0);
        }

        if (block.type === 'web') {
            if (!this.shouldRenderWebActivityBlock(block)) {
                return false;
            }
            return typeof block.webAction === 'string' && block.webAction.trim().length > 0
                || typeof block.webQuery === 'string' && block.webQuery.trim().length > 0
                || typeof block.webUrl === 'string' && block.webUrl.trim().length > 0
                || typeof block.webFinalUrl === 'string' && block.webFinalUrl.trim().length > 0
                || typeof block.webContentPreview === 'string' && block.webContentPreview.trim().length > 0
                || (Array.isArray(block.webResults) && block.webResults.length > 0)
                || (Array.isArray(block.details) && block.details.length > 0);
        }

        if (block.type === 'tool') {
            return false;
        }

        if (block.type === 'turn') {
            return Array.isArray(block.blocks) && block.blocks.some(child => this.shouldRenderTimelineBlock(child));
        }

        if (block.type === 'finish') {
            return typeof block.content === 'string' && block.content.trim().length > 0
                || (Array.isArray(block.fileChanges) && block.fileChanges.length > 0);
        }

        return false;
    }

    private removeStaleTimelineBlocks(transcript: HTMLElement, activeBlockIds: Set<string>): void {
        Array.from(transcript.children).forEach(child => {
            const element = child as HTMLElement;
            if (!element.classList.contains('cleanSlate-timeline-block')) {
                return;
            }
            const id = element.getAttribute('data-block-id');
            if (id && id !== 'fallback-summary-block' && !activeBlockIds.has(id)) {
                this.fileRenderer.disposeFinishDiffEditorsForBlock(id);
                this.fileRenderer.clearFileDeltaCounterStatesForBlock(id);
                this.clearAssistantMarkdownStreamStateForBlock(id);
                this.clearReasoningStreamStateForBlock(id);
                this.disposeBlockMarkdownRenders(element);
                element.remove();
            }
        });
    }

    private removeEmptyTranscript(lastMessage: HTMLElement, transcript: HTMLElement, isStreaming: boolean): void {
        if (isStreaming || transcript.children.length > 0 || transcript.textContent?.trim()) {
            return;
        }

        transcript.remove();
        if (!lastMessage.textContent?.trim() && lastMessage.children.length === 0) {
            lastMessage.remove();
        }
    }

    private getSummaryText(summary: ChatResponse['summary']): string | undefined {
        if (Array.isArray(summary)) {
            const joined = summary
                .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
                .join('\n\n')
                .trim();
            return joined.length > 0 ? joined : undefined;
        }

        if (typeof summary === 'string' && summary.trim().length > 0) {
            return summary.trim();
        }

        return undefined;
    }

    private renderFallbackSummary(content: string, transcript: HTMLElement): void {
        const blockId = 'fallback-summary-block';
        let blockEl = transcript.querySelector(`[data-block-id="${blockId}"]`) as HTMLElement | null;
        if (!blockEl) {
            blockEl = dom.append(transcript, dom.$('.cleanSlate-timeline-block.type-summary'));
            blockEl.setAttribute('data-block-id', blockId);
        }

        this.updateSummaryBlock({
            id: blockId,
            type: 'summary',
            content
        }, blockEl);
    }

    private removeFallbackSummaryBlock(transcript: HTMLElement): void {
        const existing = transcript.querySelector('[data-block-id="fallback-summary-block"]');
        existing?.remove();
    }

    private syncTimelineBlockOrder(container: HTMLElement, blockIds: Set<string>): void {
        let previousElement: HTMLElement | null = null;

        for (const blockId of blockIds) {
            const blockElement = this.findDirectTimelineBlockElement(container, blockId);
            if (!blockElement) {
                continue;
            }

            if (!previousElement) {
                if (container.firstElementChild !== blockElement) {
                    container.insertBefore(blockElement, container.firstElementChild);
                }
            } else if (previousElement.nextElementSibling !== blockElement) {
                container.insertBefore(blockElement, previousElement.nextElementSibling);
            }

            previousElement = blockElement;
        }
    }

    private getRenderedTimelineBlockIds(blocks: InteractionBlock[], scopeId: string): Set<string> {
        const ids = new Set<string>();
        let terminalRun: InteractionBlock[] = [];
        let terminalRunIndex = 0;
        let browserGroupOpen = false;
        let browserRunIndex = 0;
        let webGroupOpen = false;
        let webRunIndex = 0;

        const flushTerminalRun = () => {
            if (terminalRun.length === 1) {
                ids.add(terminalRun[0].id);
            } else if (terminalRun.length > 1) {
                ids.add(terminalRunIndex === 0
                    ? this.getTerminalGroupId(scopeId)
                    : this.getTerminalGroupId(`${scopeId}:${terminalRunIndex}`));
            }
            if (terminalRun.length > 0) {
                terminalRunIndex++;
                terminalRun = [];
            }
        };

        for (const block of blocks) {
            if (block.type === 'terminal') {
                browserGroupOpen = false;
                webGroupOpen = false;
                terminalRun.push(block);
                continue;
            }

            flushTerminalRun();

            if (block.type === 'browser') {
                webGroupOpen = false;
                if (this.isStandaloneBrowserToolBlock(block)) {
                    browserGroupOpen = false;
                    ids.add(block.id);
                    continue;
                }
                if (!browserGroupOpen) {
                    ids.add(browserRunIndex === 0
                        ? this.getBrowserGroupId(scopeId)
                        : this.getBrowserGroupId(`${scopeId}:${browserRunIndex}`));
                    browserGroupOpen = true;
                    browserRunIndex++;
                }
                continue;
            }

            if (block.type === 'web') {
                browserGroupOpen = false;
                if (!webGroupOpen) {
                    ids.add(webRunIndex === 0
                        ? this.getWebGroupId(scopeId)
                        : this.getWebGroupId(`${scopeId}:${webRunIndex}`));
                    webGroupOpen = true;
                    webRunIndex++;
                }
                continue;
            }

            browserGroupOpen = false;
            webGroupOpen = false;
            ids.add(block.id);
        }

        flushTerminalRun();

        return ids;
    }

    private renderTimelineBlocks(blocks: InteractionBlock[], container: HTMLElement, isStreaming: boolean, scopeId: string, onDidRender?: () => void): void {
        let terminalRun: InteractionBlock[] = [];
        let terminalRunIndex = 0;
        let browserRun: InteractionBlock[] = [];
        let browserRunIndex = 0;
        let webRun: InteractionBlock[] = [];
        let webRunIndex = 0;
        const activeBlockId = this.getActiveTimelineBlockId(blocks, isStreaming);

        const flushTerminalRun = () => {
            if (terminalRun.length === 0) {
                return;
            }

            if (terminalRun.length === 1) {
                this.renderTimelineBlock(terminalRun[0], container, isStreaming, activeBlockId, onDidRender);
            } else {
                const groupId = terminalRunIndex === 0
                    ? this.getTerminalGroupId(scopeId)
                    : this.getTerminalGroupId(`${scopeId}:${terminalRunIndex}`);
                this.renderTerminalGroup(terminalRun, container, isStreaming, groupId, activeBlockId);
            }
            terminalRun = [];
            terminalRunIndex++;
        };

        const flushBrowserRun = () => {
            if (browserRun.length === 0) {
                return;
            }

            const groupId = browserRunIndex === 0
                ? this.getBrowserGroupId(scopeId)
                : this.getBrowserGroupId(`${scopeId}:${browserRunIndex}`);
            this.renderBrowserGroup(browserRun, container, isStreaming, groupId, activeBlockId);
            browserRun = [];
            browserRunIndex++;
        };

        const flushWebRun = () => {
            if (webRun.length === 0) {
                return;
            }

            const groupId = webRunIndex === 0
                ? this.getWebGroupId(scopeId)
                : this.getWebGroupId(`${scopeId}:${webRunIndex}`);
            this.renderWebGroup(webRun, container, isStreaming, groupId, activeBlockId);
            webRun = [];
            webRunIndex++;
        };

        for (const block of blocks) {
            if (block.type === 'terminal') {
                flushBrowserRun();
                flushWebRun();
                terminalRun.push(block);
                continue;
            }

            if (block.type === 'browser') {
                flushTerminalRun();
                flushWebRun();
                if (this.isStandaloneBrowserToolBlock(block)) {
                    flushBrowserRun();
                    this.renderTimelineBlock(block, container, isStreaming, activeBlockId, onDidRender);
                    continue;
                }
                browserRun.push(block);
                continue;
            }

            if (block.type === 'web') {
                flushTerminalRun();
                flushBrowserRun();
                webRun.push(block);
                continue;
            }

            flushTerminalRun();
            flushBrowserRun();
            flushWebRun();
            this.renderTimelineBlock(block, container, isStreaming, activeBlockId, onDidRender);
        }

        flushTerminalRun();
        flushBrowserRun();
        flushWebRun();
    }

    private getActiveTimelineBlockId(blocks: InteractionBlock[], allowExplorationContinuation = false): string | undefined {
        for (let index = blocks.length - 1; index >= 0; index--) {
            const block = blocks[index];

            if (block.type === 'turn') {
                const childActiveBlockId = this.getActiveTimelineBlockId((block.blocks || []).filter(child => this.shouldRenderTimelineBlock(child)), allowExplorationContinuation);
                if (childActiveBlockId) {
                    return childActiveBlockId;
                }
            }

            if (this.isTimelineBlockLightEligible(block)) {
                return block.id;
            }

            if (block.type === 'assistant_text' && block.isStreaming === true) {
                return block.id;
            }
        }

        if (allowExplorationContinuation) {
            for (let index = blocks.length - 1; index >= 0; index--) {
                const block = blocks[index];

                if (block.type === 'turn') {
                    const childActiveBlockId = this.getActiveTimelineBlockId((block.blocks || []).filter(child => this.shouldRenderTimelineBlock(child)), true);
                    if (childActiveBlockId) {
                        return childActiveBlockId;
                    }
                }

                if (this.isExplorationContinuationBlock(block)) {
                    return block.id;
                }

                if (block.type !== 'summary') {
                    return undefined;
                }
            }
        }

        return undefined;
    }

    private hasStreamingAssistantText(blocks: InteractionBlock[]): boolean {
        return blocks.some(block => {
            if (block.type === 'assistant_text' && block.isStreaming === true) {
                return true;
            }
            return block.type === 'turn'
                && Array.isArray(block.blocks)
                && this.hasStreamingAssistantText(block.blocks.filter(child => this.shouldRenderTimelineBlock(child)));
        });
    }

    private hasStreamingReasoning(blocks: InteractionBlock[]): boolean {
        return blocks.some(block => {
            if (block.type === 'reasoning' && block.isStreaming === true) {
                return true;
            }
            return block.type === 'turn'
                && Array.isArray(block.blocks)
                && this.hasStreamingReasoning(block.blocks.filter(child => this.shouldRenderTimelineBlock(child)));
        });
    }

    private getBrowserGroupId(scopeId: string): string {
        return `${scopeId}:browser-inspection`;
    }

    private getTerminalGroupId(scopeId: string): string {
        return `${scopeId}:terminal-commands`;
    }

    private getWebGroupId(scopeId: string): string {
        return `${scopeId}:web-activity`;
    }

    private findDirectTimelineBlockElement(container: HTMLElement, blockId: string): HTMLElement | null {
        const blockElement = Array.from(container.children).find(child => {
            const element = child as HTMLElement;
            return element.classList.contains('cleanSlate-timeline-block')
                && element.getAttribute('data-block-id') === blockId;
        }) as HTMLElement | undefined;

        return blockElement ?? null;
    }

    private renderTimelineBlock(block: InteractionBlock, container: HTMLElement, isStreaming: boolean, activeBlockId?: string, onDidRender?: () => void): void {
        let blockEl = container.querySelector(`[data-block-id="${block.id}"]`) as HTMLElement | null;
        const isNew = !blockEl;

        if (isNew) {
            blockEl = dom.append(container, dom.$('.cleanSlate-timeline-block'));
            blockEl.setAttribute('data-block-id', block.id);
            blockEl.classList.add(`type-${block.type}`);
        }
        blockEl!.classList.toggle('is-active', activeBlockId === block.id);
        blockEl!.classList.toggle('kind-web-search', block.type === 'web' && block.webToolName === 'web_search');
        blockEl!.classList.toggle('kind-web-fetch', block.type === 'web' && block.webToolName === 'web_fetch');

        switch (block.type) {
            case 'summary':
                this.updateSummaryBlock(block, blockEl!);
                break;
            case 'assistant_text':
                this.updateAssistantTextBlock(block, blockEl!, onDidRender);
                break;
            case 'reasoning':
                this.updateReasoningBlock(block, blockEl!);
                break;
            case 'terminal':
                this.updateTerminalBlock(block, blockEl!);
                break;
            case 'file':
                this.fileRenderer.updateFileBlock(block, blockEl!, isStreaming);
                break;
            case 'browser':
                this.updateBrowserBlock(block, blockEl!);
                break;
            case 'web':
                this.updateWebRetrievalBlock(block, blockEl!);
                break;
            case 'tool':
                this.updateToolBlock(block, blockEl!);
                break;
            case 'turn':
                this.updateTurnBlock(block, blockEl!, isStreaming, onDidRender);
                break;
            case 'finish':
                this.fileRenderer.updateFinishBlock(block, blockEl!);
                break;
        }
    }

    private fadeOutWorkingPlaceholder(placeholder: HTMLElement): void {
        if (placeholder.classList.contains('is-exiting')) {
            return;
        }

        placeholder.classList.add('is-exiting');
        dom.getWindow(placeholder).setTimeout(() => {
            if (placeholder.classList.contains('is-exiting')) {
                placeholder.remove();
            }
        }, 180);
    }

    private ensureWorkingPlaceholder(transcript: HTMLElement, label: string): HTMLElement {
        const existing = transcript.querySelector('.cleanSlate-working-placeholder.placeholder') as HTMLElement | null;
        const target = existing || dom.append(transcript, dom.$('.cleanSlate-working-placeholder.placeholder'));
        target.classList.remove('is-exiting');
        this.setTrustedHtmlIfChanged(target, `
            <div class="cleanSlate-working-row">
                <span class="cleanSlate-working-label">${this.escapeHtml(label)}</span>
            </div>
        `, `working:${label}`);
        return target;
    }

    private isTimelineBlockLightEligible(block: InteractionBlock): boolean {
        if (block.type === 'tool') {
            return block.toolStatus === 'running'
                || block.isStreaming === true && block.toolStatus !== 'completed' && block.toolStatus !== 'failed';
        }

        if (block.type === 'browser') {
            return block.browserStatus === 'running'
                || block.isStreaming === true && block.browserStatus !== 'completed' && block.browserStatus !== 'failed';
        }

        if (block.type === 'web') {
            return block.webStatus === 'running'
                || block.isStreaming === true && block.webStatus !== 'completed' && block.webStatus !== 'failed';
        }

        if (block.type === 'file') {
            const status = (block.status || '').toLowerCase();
            if (status === 'failed'
                || status === 'modified'
                || status === 'edited'
                || status === 'created'
                || status === 'read'
                || status === 'analyzed'
                || status === 'explored') {
                return false;
            }

            return block.isStreaming === true && (status.endsWith('...')
                || status === 'editing'
                || status === 'creating'
                || status === 'analyzing'
                || status === 'exploring');
        }

        return false;
    }

    private isExplorationContinuationBlock(block: InteractionBlock): boolean {
        if (block.type !== 'file') {
            return false;
        }

        const status = (block.status || '').toLowerCase();
        const hasActivityDetails = Array.isArray(block.details) && block.details.length > 0;
        const hasSearches = typeof block.searchCount === 'number' && block.searchCount > 0;
        const hasReads = typeof block.fileCount === 'number' && block.fileCount > 0;

        return hasActivityDetails
            && (hasSearches || hasReads)
            && (status === 'explored' || status === 'analyzed');
    }

    private setTrustedHtmlIfChanged(el: HTMLElement, html: string, renderKey: string): boolean {
        if (el.dataset.renderKey === renderKey) {
            return false;
        }

        this.disposeMarkdownRender(el);
        el.innerHTML = (policy ? policy.createHTML(html) : html) as unknown as string;
        el.dataset.renderKey = renderKey;
        return true;
    }

    private disposeMarkdownRender(el: HTMLElement | null | undefined): void {
        if (!el) {
            return;
        }
        this.markdownRenderDisposables.get(el)?.dispose();
        this.markdownRenderDisposables.delete(el);
    }

    disposeMarkdownRenders(): void {
        for (const disposable of this.markdownRenderDisposables.values()) {
            disposable.dispose();
        }
        this.markdownRenderDisposables.clear();
    }

    private disposeBlockMarkdownRenders(el: HTMLElement): void {
        this.disposeMarkdownRender(el);
    }

    private clearAssistantMarkdownStreamStateForBlock(blockId: string): void {
        this.disposeStreamingMarkdownBlocks(blockId);
        const state = this.assistantMarkdownStreamStates.get(blockId);
        if (!state) {
            return;
        }

        if (state.timer !== undefined) {
            state.cancelTimer?.(state.timer);
            state.timer = undefined;
        }

        this.assistantMarkdownStreamStates.delete(blockId);
    }

    private setMarkdownIfChanged(el: HTMLElement, markdownText: string, renderKey: string, fillInIncompleteTokens = false): boolean {
        if (el.dataset.renderKey === renderKey) {
            return false;
        }

        this.disposeMarkdownRender(el);
        dom.clearNode(el);

        // Leaving streaming mode → drop its markers/styling before the full render.
        if (el.dataset.streamPlain === '1') {
            delete el.dataset.streamPlain;
            delete el.dataset.streamPlainText;
            el.classList.remove('cleanSlate-streaming-plaintext');
        }
        if (el.dataset.streamMarkdown === '1') {
            delete el.dataset.streamMarkdown;
            delete el.dataset.streamMarkdownText;
        }

        const markdown = new MarkdownString(markdownText, {
            isTrusted: false,
            supportThemeIcons: true,
            supportHtml: false
        });
        const rendered = this.markdownRendererService.render(markdown, {
            fillInIncompleteTokens,
            markedOptions: {
                breaks: true,
                gfm: true
            }
        });

        this.markdownRenderDisposables.set(el, rendered);
        el.appendChild(rendered.element);
        this.decorateCodeBlocks(el, this.extractFenceLanguages(markdownText));
        el.dataset.renderKey = renderKey;
        return true;
    }

    private updateReasoningBlock(block: InteractionBlock, el: HTMLElement): void {
        const content = block.content || '';
        const isStreaming = block.isStreaming === true;

        el.classList.add('cleanSlate-reasoning-block');

        let header = el.querySelector('.cleanSlate-reasoning-header') as HTMLElement | null;
        let body = el.querySelector('.cleanSlate-reasoning-body') as HTMLElement | null;
        if (!header || !body) {
            dom.clearNode(el);
            header = dom.append(el, dom.$('button.cleanSlate-reasoning-header'));
            header.setAttribute('type', 'button');
            header.setAttribute('aria-expanded', 'true');
            dom.append(header, dom.$('span.cleanSlate-reasoning-label'));
            dom.append(header, dom.$('span.cleanSlate-reasoning-chevron.codicon.codicon-chevron-down'));
            body = dom.append(el, dom.$('.cleanSlate-reasoning-body.cleanSlate-message-content'));

            header.addEventListener('click', () => {
                el.dataset.userToggled = 'true';
                el.classList.toggle('is-collapsed');
                header!.setAttribute('aria-expanded', String(!el.classList.contains('is-collapsed')));
            });
            // Expanded while the model is thinking; auto-collapse once the thought
            // is complete, unless the user has manually toggled it.
            el.classList.remove('is-collapsed');
        }

        const label = header.querySelector('.cleanSlate-reasoning-label') as HTMLElement | null;
        if (label) {
            // Only rewrite when the text actually changes. Reassigning textContent
            // tears down and rebuilds the text node, and under the streaming
            // background-clip:text sheen forces a re-clip/repaint of the gradient.
            // A deliberately quiet qualitative label rather than a timer keeps
            // completed thoughts visually secondary.
            const labelText = isStreaming ? 'Thinking' : 'Thought briefly';
            if (label.textContent !== labelText) {
                label.textContent = labelText;
            }
        }
        el.classList.toggle('is-streaming', isStreaming);

        // Reasoning is dimmed secondary text. Provider reasoning summaries carry
        // lightweight markdown (**bold** headers, # headings, `code`); strip
        // those markers so they read as clean prose. The visible content follows
        // provider deltas instead of replaying them character by character
        // after the model has already moved to its next action.
        const displayContent = this.stripReasoningEmphasis(content);
        const isActiveOrHolding = this.renderReasoningAtStreamPace(block.id, body!, displayContent, isStreaming);
        if (!isStreaming && !isActiveOrHolding && el.dataset.userToggled !== 'true') {
            el.classList.add('is-collapsed');
        } else if (isActiveOrHolding && el.dataset.userToggled !== 'true') {
            el.classList.remove('is-collapsed');
        }
        header.setAttribute('aria-expanded', String(!el.classList.contains('is-collapsed')));
    }

    private renderReasoningAtStreamPace(blockId: string, body: HTMLElement, content: string, isStreaming: boolean): boolean {
        let state = this.reasoningStreamStates.get(blockId);

        // Persisted completed thoughts were not observed live, so render them in
        // full and keep their normal collapsed transcript presentation.
        if (!isStreaming && !state) {
            if (body.textContent !== content) {
                body.textContent = content;
            }
            return false;
        }

        if (!state) {
            state = {
                targetContent: content
            };
            this.reasoningStreamStates.set(blockId, state);
        }
        state.targetContent = content;

        if (isStreaming) {
            this.scheduleReasoningFrame(blockId, body);
            return true;
        }

        // A completed reasoning event is a hard stream boundary. Flush the
        // latest provider text immediately so subsequent tool activity never
        // overtakes a still-typing thought, then leave it open briefly.
        this.cancelReasoningFrame(state);
        this.renderReasoningContent(body, state, content);
        if (state.completionTimer === undefined) {
            const win = dom.getWindow(body);
            const reasoningBlock = body.closest('.cleanSlate-reasoning-block') as HTMLElement | null;
            state.cancelCompletionTimer = timer => win.clearTimeout(timer);
            state.completionTimer = win.setTimeout(() => {
                state!.completionTimer = undefined;
                if (reasoningBlock?.isConnected && reasoningBlock.dataset.userToggled !== 'true') {
                    reasoningBlock.classList.add('is-collapsed');
                }
                this.clearReasoningStreamStateForBlock(blockId);
            }, CleanSlateTranscriptRenderer.REASONING_COMPLETION_HOLD_MS);
        }
        return true;
    }

    private scheduleReasoningFrame(blockId: string, body: HTMLElement): void {
        const state = this.reasoningStreamStates.get(blockId);
        if (!state || state.animationFrame !== undefined) {
            return;
        }
        const win = dom.getWindow(body);
        state.cancelAnimationFrame = frame => win.cancelAnimationFrame(frame);
        state.animationFrame = win.requestAnimationFrame(() => {
            state.animationFrame = undefined;
            if (!body.isConnected) {
                this.reasoningStreamStates.delete(blockId);
                return;
            }
            this.renderReasoningContent(body, state, state.targetContent);
        });
    }

    private renderReasoningContent(body: HTMLElement, state: ICleanSlateReasoningStreamState, content: string): void {
        const rendered = state.renderedText ?? '';
        if (rendered === content) {
            return;
        }

        // Streaming reasoning is almost always a pure append (the thought grows by
        // a suffix each delta). In that case append only the new tail as a text
        // node instead of reassigning the whole textContent — the latter re-lays
        // out the entire, ever-growing thought every frame (O(n²) over the stream)
        // and is what makes long thoughts feel laggy. Fall back to a full replace
        // when the prefix diverges (e.g. stripReasoningEmphasis collapsing a
        // just-completed `*`→`**` token shifts earlier characters).
        if (rendered.length > 0 && content.startsWith(rendered) && body.firstChild) {
            body.appendChild(body.ownerDocument.createTextNode(content.slice(rendered.length)));
        } else {
            body.textContent = content;
        }
        state.renderedText = content;

        // Avoid reading scrollHeight for every streamed delta. Browsers clamp
        // this assignment to the current scroll range without a forced read.
        body.scrollTop = Number.MAX_SAFE_INTEGER;
    }

    private cancelReasoningFrame(state: ICleanSlateReasoningStreamState): void {
        if (state.animationFrame === undefined) {
            return;
        }
        state.cancelAnimationFrame?.(state.animationFrame);
        state.animationFrame = undefined;
    }

    private clearReasoningStreamStateForBlock(blockId: string): void {
        const state = this.reasoningStreamStates.get(blockId);
        if (!state) {
            return;
        }
        this.cancelReasoningFrame(state);
        if (state.completionTimer !== undefined) {
            state.cancelCompletionTimer?.(state.completionTimer);
            state.completionTimer = undefined;
        }
        this.reasoningStreamStates.delete(blockId);
    }

    private stripReasoningEmphasis(text: string): string {
        return text
            .replace(/\*\*/g, '')            // **bold**
            .replace(/`+/g, '')              // `inline code`
            .replace(/^\s{0,3}#{1,6}\s+/gm, ''); // # / ## headings
    }

    private updateSummaryBlock(block: InteractionBlock, el: HTMLElement): void {
        const content = block.content || '';
        el.classList.add('cleanSlate-message-content');
        el.style.marginTop = '8px';
        el.style.marginBottom = '8px';
        this.setMarkdownIfChanged(el, content, `summary:${content}`);
    }

    private updateAssistantTextBlock(block: InteractionBlock, el: HTMLElement, onDidRender?: () => void): void {
        const content = block.content || '';
        void onDidRender;
        el.classList.add('cleanSlate-message-content');
        el.classList.add('cleanSlate-assistant-text-block');
        el.classList.toggle('is-streaming', block.isStreaming === true);
        el.style.marginTop = '8px';
        el.style.marginBottom = '8px';

        if (block.isStreaming) {
            this.renderAssistantMarkdownProgressively(block.id, el, content, true, onDidRender);
            return;
        }

        const streamState = this.assistantMarkdownStreamStates.get(block.id);
        if (streamState && streamState.renderedContent !== content) {
            this.renderAssistantMarkdownProgressively(block.id, el, content, false, onDidRender);
            return;
        }

        this.clearAssistantMarkdownStreamStateForBlock(block.id);
        this.setMarkdownIfChanged(el, content, `assistant-text:${block.id}:${content}`);
    }

    private static readonly REASONING_COMPLETION_HOLD_MS = 1800;

    private renderAssistantMarkdownProgressively(blockId: string, el: HTMLElement, content: string, isStreaming: boolean, onDidRender?: () => void): void {
        let state = this.assistantMarkdownStreamStates.get(blockId);
        // A non-append change (edit/reset) invalidates the paced reveal: start over.
        if (state && !content.startsWith(state.renderedContent)) {
            this.clearAssistantMarkdownStreamStateForBlock(blockId);
            state = undefined;
        }

        if (!state) {
            state = {
                targetContent: content,
                renderedContent: '',
                renderedWordCount: 0,
                lastRenderTime: 0,
                isStreaming,
                onDidRender
            };
            this.assistantMarkdownStreamStates.set(blockId, state);
        }

        state.targetContent = content;
        state.isStreaming = isStreaming;
        state.onDidRender = onDidRender;

        // Once streaming ends, render the final content in full and drop the state.
        if (!isStreaming) {
            const didRender = this.setMarkdownIfChanged(el, content, `assistant-text:${blockId}:${content}`, false);
            state.renderedContent = content;
            if (didRender) {
                onDidRender?.();
            }
            this.clearAssistantMarkdownStreamStateForBlock(blockId);
            return;
        }

        const shownLength = state.renderedContent.length;
        // First frame of a block has no previous render to measure from; treat it
        // as one tick so the reveal starts at the floor rate instead of jumping.
        const elapsedMs = state.lastRenderTime === 0
            ? REVEAL_TICK_MS
            : Math.min(Date.now() - state.lastRenderTime, 250);
        const end = content.length <= shownLength
            ? content.length
            : revealCutPoint(content, shownLength, elapsedMs);
        const revealed = content.slice(0, end);

        // Render the streaming reveal as markdown, but MORPH the existing DOM to match
        // the new render instead of clearing + rebuilding the whole subtree every tick
        // (which is what flickers). Only changed nodes update, so it stays smooth.
        const didRender = this.setStreamingMarkdown(blockId, el, revealed);
        state.renderedContent = revealed;
        state.lastRenderTime = Date.now();
        if (didRender) {
            onDidRender?.();
        }

        // More text is available than we have revealed — schedule the next frame.
        if (end < content.length) {
            this.scheduleAssistantMarkdownProgressiveRender(blockId, el);
        }
    }

    // Flicker-free streaming markdown that keeps async code-block widgets. The text is
    // split into top-level markdown blocks; every block except the last is rendered ONCE
    // with the real (async-widget) renderer and kept stable, so completed code blocks
    // finish rendering their widget and never re-render. Only the last, still-growing
    // block re-renders each tick, and it is morphed (in place) so its text stays smooth.
    private setStreamingMarkdown(blockId: string, el: HTMLElement, markdownText: string): boolean {
        if (el.dataset.streamMarkdownText === markdownText) {
            return false;
        }

        let state = this.streamingMarkdownStates.get(blockId);
        const needsReset = el.dataset.streamMarkdown !== '1' || !state || !markdownText.startsWith(state.committedRaw);
        if (needsReset) {
            this.disposeStreamingMarkdownBlocks(blockId);
            this.disposeMarkdownRender(el);
            if (el.dataset.streamPlain === '1') {
                delete el.dataset.streamPlain;
                delete el.dataset.streamPlainText;
                el.classList.remove('cleanSlate-streaming-plaintext');
            }
            dom.clearNode(el);
            el.dataset.streamMarkdown = '1';
            state = { committedRaw: '', disposables: [] };
            this.streamingMarkdownStates.set(blockId, state);
        }

        let tailEl = el.querySelector(':scope > .cleanSlate-stream-tail') as HTMLElement | null;
        if (!tailEl) {
            // The tail carries .rendered-markdown too: morphChildren copies the
            // renderer's CHILDREN into it, so without the class the streaming
            // paragraphs sit outside every `.rendered-markdown p` margin rule and
            // pick up the UA default 1em top margin — which made the finished
            // answer snap up by ~14px when the final render swapped in.
            tailEl = dom.append(el, dom.$('.cleanSlate-stream-tail.rendered-markdown'));
        }

        // Only the not-yet-committed tail is lexed each tick, so per-tick cost stays
        // bounded by the trailing block instead of growing with the whole message.
        const tail = markdownText.slice(state!.committedRaw.length);
        let tokens: { type: string; raw: string }[];
        try {
            tokens = marked.lexer(tail) as unknown as { type: string; raw: string }[];
        } catch {
            tokens = [{ type: 'paragraph', raw: tail }];
        }
        let lastVisual = -1;
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].type !== 'space' && tokens[i].raw.trim().length > 0) {
                lastVisual = i;
            }
        }

        // Every token before the trailing one is final: render it once with the real
        // renderer (async code widgets included) and never touch it again.
        for (let i = 0; i < lastVisual; i++) {
            const token = tokens[i];
            state!.committedRaw += token.raw;
            if (token.type === 'space' || token.raw.trim().length === 0) {
                continue;
            }
            const wrapper = dom.$('.cleanSlate-stream-block');
            el.insertBefore(wrapper, tailEl);
            const rendered = this.renderMarkdownFragment(token.raw, false);
            wrapper.appendChild(rendered.element);
            this.decorateCodeBlocks(wrapper, this.extractFenceLanguages(token.raw));
            state!.disposables.push(rendered);
        }

        // The trailing block is still growing — morph it in place for smooth text.
        if (lastVisual >= 0) {
            const rendered = this.renderMarkdownFragment(tokens[lastVisual].raw, true);
            try {
                this.morphChildren(tailEl, rendered.element);
            } finally {
                rendered.dispose();
            }
        }

        el.dataset.streamMarkdownText = markdownText;
        el.dataset.renderKey = '';
        return true;
    }

    private renderMarkdownFragment(text: string, fillInIncompleteTokens: boolean): IRenderedMarkdown {
        const markdown = new MarkdownString(text, {
            isTrusted: false,
            supportThemeIcons: true,
            supportHtml: false
        });
        return this.markdownRendererService.render(markdown, {
            fillInIncompleteTokens,
            markedOptions: { breaks: true, gfm: true }
        });
    }

    private disposeStreamingMarkdownBlocks(blockId: string): void {
        const state = this.streamingMarkdownStates.get(blockId);
        if (!state) {
            return;
        }
        for (const disposable of state.disposables) {
            disposable.dispose();
        }
        this.streamingMarkdownStates.delete(blockId);
    }

    // Fence info strings (```tsx → "tsx") in document order, for code widget labels.
    private extractFenceLanguages(markdownText: string): string[] {
        const langs: string[] = [];
        const fenceRe = /^[ \t]{0,3}(?:`{3,}|~{3,})[ \t]*([^\s`~]*)/gm;
        let match: RegExpExecArray | null;
        let open = false;
        while ((match = fenceRe.exec(markdownText)) !== null) {
            if (!open) {
                langs.push(match[1] || '');
            }
            open = !open;
        }
        return langs;
    }

    // Wrap rendered code blocks in the CleanSlate code widget (header with language
    // label + copy button). The markdown renderer inserts a stable div.code
    // placeholder synchronously and swaps the highlighted content into it async, so
    // wrapping the placeholder is safe.
    private decorateCodeBlocks(root: HTMLElement, langs: string[]): void {
        // VSCode's markdown renderer inserts async code placeholders as div[data-code]
        // (its own swap queries exactly that — the class may be sanitized away), and
        // some paths emit bare <pre>. Match both, but never a pre inside a placeholder.
        const placeholders = Array.from(root.querySelectorAll<HTMLElement>('div[data-code], pre'));
        let index = 0;
        for (const codeEl of placeholders) {
            if (codeEl.closest('.cleanSlate-code-widget')) {
                continue;
            }
            if (codeEl.tagName === 'PRE' && codeEl.closest('div[data-code]')) {
                continue;
            }
            const lang = langs[index++] ?? '';

            const widget = dom.$('.cleanSlate-code-widget');
            const header = dom.append(widget, dom.$('.cleanSlate-code-widget-header'));
            const label = dom.append(header, dom.$('span.cleanSlate-code-widget-lang'));
            label.textContent = lang || 'code';
            const copyButton = dom.append(header, dom.$('button.cleanSlate-code-widget-copy')) as HTMLButtonElement;
            copyButton.type = 'button';
            copyButton.title = 'Copy code';
            const copyIcon = dom.append(copyButton, dom.$('span.codicon.codicon-copy'));

            codeEl.parentNode?.replaceChild(widget, codeEl);
            const body = dom.append(widget, dom.$('.cleanSlate-code-widget-body'));
            body.appendChild(codeEl);

            copyButton.addEventListener('click', async () => {
                const text = codeEl.textContent ?? '';
                if (!text) {
                    return;
                }
                try {
                    await this.clipboardService.writeText(text);
                    copyIcon.classList.replace('codicon-copy', 'codicon-check');
                    dom.getWindow(copyButton).setTimeout(() => {
                        copyIcon.classList.replace('codicon-check', 'codicon-copy');
                    }, 1500);
                } catch {
                    // Clipboard unavailable — ignore.
                }
            });
        }
    }

    // Minimal DOM morph (morphdom-style): make target's children match source's,
    // updating in place and preserving unchanged nodes. Inserted/replaced nodes are
    // cloned so disposing the source render leaves the live tree intact.
    private morphChildren(target: Node, source: Node): void {
        const sourceKids = source.childNodes;
        for (let i = 0; i < sourceKids.length; i++) {
            const s = sourceKids[i];
            const t = target.childNodes[i];
            if (!t) {
                target.appendChild(s.cloneNode(true));
                continue;
            }
            if (t.nodeType !== s.nodeType
                || (t.nodeType === Node.ELEMENT_NODE && (t as Element).tagName !== (s as Element).tagName)) {
                target.replaceChild(s.cloneNode(true), t);
                continue;
            }
            if (t.nodeType === Node.TEXT_NODE || t.nodeType === Node.COMMENT_NODE) {
                if (t.textContent !== s.textContent) {
                    t.textContent = s.textContent;
                }
                continue;
            }
            if (t.nodeType === Node.ELEMENT_NODE) {
                this.morphAttributes(t as Element, s as Element);
                this.morphChildren(t, s);
            }
        }
        while (target.childNodes.length > sourceKids.length) {
            target.removeChild(target.lastChild!);
        }
    }

    private morphAttributes(target: Element, source: Element): void {
        for (const attr of Array.from(target.attributes)) {
            if (!source.hasAttribute(attr.name)) {
                target.removeAttribute(attr.name);
            }
        }
        for (const attr of Array.from(source.attributes)) {
            if (target.getAttribute(attr.name) !== attr.value) {
                target.setAttribute(attr.name, attr.value);
            }
        }
    }

    private scheduleAssistantMarkdownProgressiveRender(blockId: string, el: HTMLElement): void {
        const state = this.assistantMarkdownStreamStates.get(blockId);
        if (!state || state.timer !== undefined) {
            return;
        }

        const win = dom.getWindow(el);
        state.cancelTimer = timer => win.clearTimeout(timer);
        state.timer = win.setTimeout(() => {
            state.timer = undefined;
            if (!el.isConnected) {
                this.assistantMarkdownStreamStates.delete(blockId);
                return;
            }
            this.renderAssistantMarkdownProgressively(blockId, el, state.targetContent, state.isStreaming, state.onDidRender);
        }, REVEAL_TICK_MS);
    }

    private updateTerminalBlock(block: InteractionBlock, el: HTMLElement): void {
        const cmd = (typeof block.command === 'string' ? block.command : '')
            .replace(/\s*\|\s*cat\s*$/, '')
            .replace(/^\$\s+/, '')
            .trim();
        const rawOutput = typeof block.output === 'string' ? block.output : '';
        const output = normalizeTerminalOutput(rawOutput)
            .split('\n')
            .filter(line => !line.includes('__CLEANSLATE_CMD'))
            .filter(line => !line.includes('__CLEANSLATE_VERIFY_EXIT__'))
            .join('\n')
            .trimEnd();
        const outputSignature = `${output.length}:${output.slice(-160)}`;
        const outputHtml = output ? renderAnsiToHtml(output) : '';
        const normalizedStatus = (block.status || '').trim().toLowerCase();
        const failed = (typeof block.exitCode === 'number' && block.exitCode !== 0)
            || normalizedStatus === 'failed'
            || normalizedStatus === 'error'
            || normalizedStatus === 'timeout'
            || normalizedStatus === 'timed out'
            || normalizedStatus === 'cancelled'
            || normalizedStatus === 'canceled'
            || normalizedStatus === 'interrupted';
        const running = !failed && (block.isStreaming === true
            || normalizedStatus === 'running'
            || normalizedStatus === 'starting'
            || normalizedStatus === 'pending'
            || normalizedStatus === 'working'
            || normalizedStatus.endsWith('...'));
        const statusKind = failed ? 'failed' : running ? 'running' : 'success';
        const statusLabel = failed ? 'Failed' : running ? 'Running' : 'Success';
        const statusIcon = failed
            ? 'codicon-error'
            : running
                ? 'codicon-loading codicon-modifier-spin'
                : 'codicon-check';
        const expanded = this.expandedTerminalBlockIds.has(block.id);
        const activityLabel = running ? 'Running' : 'Ran';
        const cardHtml = expanded ? `
            <div class="cleanSlate-terminal-block${running ? ' streaming' : ''}">
                <div class="terminal-shell-heading">Shell</div>
                <div class="terminal-shell-viewport">
                    <div class="terminal-shell-scroll" role="region" aria-label="Shell command and output" tabindex="0">
                        ${cmd ? `
                            <div class="terminal-cmd-row">
                                <span class="terminal-prompt" aria-hidden="true">$</span>
                                <span class="terminal-cmd-text">${this.escapeHtml(cmd)}</span>
                            </div>
                        ` : ''}
                        ${output ? `<pre class="terminal-pre-output" role="log" aria-live="${running ? 'polite' : 'off'}">${outputHtml}</pre>` : ''}
                    </div>
                    <div class="terminal-shell-fade terminal-shell-fade-top" aria-hidden="true"></div>
                    <div class="terminal-shell-fade terminal-shell-fade-bottom" aria-hidden="true"></div>
                </div>
                <div class="terminal-shell-status ${statusKind}" role="status" aria-live="polite">
                    <i class="codicon ${statusIcon}" aria-hidden="true"></i>
                    <span>${statusLabel}</span>
                </div>
            </div>
        ` : '';
        const renderKey = [
            'terminal-shell',
            block.id,
            expanded ? 'expanded' : 'collapsed',
            statusKind,
            normalizedStatus,
            cmd,
            outputSignature,
            block.exitCode ?? ''
        ].join(':');
        const shouldResetCompletedScroll = !running && el.dataset.renderKey !== renderKey;

        this.setTrustedHtmlIfChanged(el, `
            <div class="cleanSlate-terminal-activity${expanded ? ' expanded' : ' collapsed'}">
                <button class="terminal-summary-toggle" type="button" aria-expanded="${expanded ? 'true' : 'false'}" title="${this.escapeHtml(cmd)}">
                    <i class="codicon codicon-terminal terminal-summary-icon" aria-hidden="true"></i>
                    <span class="terminal-summary-label">${activityLabel}</span>
                    <span class="terminal-summary-command">${this.escapeHtml(cmd || 'command')}</span>
                    <i class="codicon ${expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'} terminal-summary-chevron" aria-hidden="true"></i>
                </button>
                ${cardHtml}
            </div>
        `, renderKey);

        const toggle = el.querySelector('.terminal-summary-toggle') as HTMLButtonElement | null;
        if (toggle && !toggle.hasAttribute('data-listener')) {
            toggle.setAttribute('data-listener', 'true');
            toggle.addEventListener('click', event => {
                event.stopPropagation();
                if (this.expandedTerminalBlockIds.has(block.id)) {
                    this.expandedTerminalBlockIds.delete(block.id);
                } else {
                    this.expandedTerminalBlockIds.add(block.id);
                }
                el.dataset.renderKey = '';
                this.updateTerminalBlock(block, el);
            });
        }

        const scrollContainer = el.querySelector('.terminal-shell-scroll') as HTMLElement | null;
        if (scrollContainer) {
            const viewport = scrollContainer.closest('.terminal-shell-viewport');
            const updateScrollFades = () => {
                const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
                const hasOverflow = maxScrollTop > 1;
                viewport?.classList.toggle('has-overflow-above', hasOverflow && scrollContainer.scrollTop > 1);
                viewport?.classList.toggle('has-overflow-below', hasOverflow && scrollContainer.scrollTop < maxScrollTop - 1);
            };

            if (running) {
                scrollContainer.scrollTop = scrollContainer.scrollHeight;
            } else if (shouldResetCompletedScroll) {
                scrollContainer.scrollTop = 0;
                scrollContainer.scrollLeft = 0;
            }

            if (!scrollContainer.hasAttribute('data-fade-listener')) {
                scrollContainer.setAttribute('data-fade-listener', 'true');
                scrollContainer.addEventListener('scroll', updateScrollFades, { passive: true });
            }
            updateScrollFades();
        }
    }

    private updateTurnBlock(block: InteractionBlock, el: HTMLElement, isStreaming: boolean, onDidRender?: () => void): void {
        el.classList.add('cleanSlate-turn-container');
        if (block.isStreaming) {
            el.classList.add('streaming');
        } else {
            el.classList.remove('streaming');
        }

        let inner = el.querySelector('.cleanSlate-turn-content') as HTMLElement | null;
        if (!inner) {
            inner = dom.append(el, dom.$('.cleanSlate-turn-content'));
        }

        const childBlocks = (block.blocks || []).filter(child => this.shouldRenderTimelineBlock(child));
        if (childBlocks.length === 0) {
            if (!block.isStreaming) {
                el.remove();
                return;
            }

            if (!inner.querySelector('.cleanSlate-working-row')) {
                inner.innerHTML = (policy ? policy.createHTML(`
                    <div class="cleanSlate-working-row">
                        <span class="cleanSlate-working-label">${this.escapeHtml(block.status || 'Thinking...')}</span>
                    </div>
                `) : '') as unknown as string;
            }
            return;
        }

        inner.querySelector('.cleanSlate-working-row')?.remove();
        
        // Keep model-authored orientation/progress above the activity they introduce; completion handoffs stay after activity.
        const toolBlocks = childBlocks.filter(b => b.type === 'file' || b.type === 'terminal' || b.type === 'browser' || b.type === 'web' || b.type === 'tool');
        const leadingSummaryBlocks = childBlocks.filter(b => b.type === 'summary' && b.summaryRole !== 'completion');
        const assistantTextBlocks = childBlocks.filter(b => b.type === 'assistant_text');
        const completionSummaryBlocks = childBlocks.filter(b => b.type === 'summary' && b.summaryRole === 'completion');
        const finishBlocks = childBlocks.filter(b => b.type === 'finish');

        const sortedBlocks = [...leadingSummaryBlocks, ...toolBlocks, ...assistantTextBlocks, ...completionSummaryBlocks, ...finishBlocks];

        this.renderTimelineBlocks(sortedBlocks, inner, isStreaming, block.id, onDidRender);
        const renderedChildIds = this.getRenderedTimelineBlockIds(sortedBlocks, block.id);
        this.syncTimelineBlockOrder(inner, renderedChildIds);

        // Clean up any blocks that were removed
        const existingChildIds = renderedChildIds;
        const renderedChildren = inner.querySelectorAll('.cleanSlate-timeline-block');
        renderedChildren.forEach(child => {
            const id = child.getAttribute('data-block-id');
            if (id && !existingChildIds.has(id)) {
                this.fileRenderer.disposeFinishDiffEditorsForBlock(id);
                this.fileRenderer.clearFileDeltaCounterStatesForBlock(id);
                this.clearAssistantMarkdownStreamStateForBlock(id);
                child.remove();
            }
        });
    }

    private renderTerminalGroup(blocks: InteractionBlock[], container: HTMLElement, isStreaming: boolean, groupId: string, activeBlockId?: string): void {
        let groupEl = this.findDirectTimelineBlockElement(container, groupId);
        if (!groupEl) {
            groupEl = dom.append(container, dom.$('.cleanSlate-timeline-block.type-terminal-group'));
            groupEl.setAttribute('data-block-id', groupId);
        }

        const running = blocks.some(block => {
            const status = (block.status || '').trim().toLowerCase();
            return block.isStreaming === true
                || status === 'running'
                || status === 'starting'
                || status === 'pending'
                || status === 'working'
                || status.endsWith('...');
        });
        const title = running ? 'Running commands' : 'Ran commands';
        const shellHtml = `
            <details class="cleanSlate-terminal-group">
                <summary class="cleanSlate-terminal-group-summary">
                    <i class="codicon codicon-terminal" aria-hidden="true"></i>
                    <span class="cleanSlate-terminal-group-title"></span>
                    <i class="codicon codicon-chevron-right cleanSlate-terminal-group-chevron" aria-hidden="true"></i>
                </summary>
                <div class="cleanSlate-terminal-group-events"></div>
            </details>
        `;
        this.setTrustedHtmlIfChanged(groupEl, shellHtml, 'terminal-group-shell');

        groupEl.classList.toggle('is-active', blocks.some(block => block.id === activeBlockId));
        groupEl.classList.toggle('is-running', running);
        const titleEl = groupEl.querySelector('.cleanSlate-terminal-group-title') as HTMLElement | null;
        if (titleEl && titleEl.textContent !== title) {
            titleEl.textContent = title;
        }

        const events = groupEl.querySelector('.cleanSlate-terminal-group-events') as HTMLElement | null;
        if (!events) {
            return;
        }

        const childIds = new Set(blocks.map(block => block.id));
        blocks.forEach(block => this.renderTimelineBlock(block, events, isStreaming, activeBlockId));
        this.syncTimelineBlockOrder(events, childIds);
        Array.from(events.children).forEach(child => {
            const element = child as HTMLElement;
            const id = element.getAttribute('data-block-id');
            if (id && !childIds.has(id)) {
                element.remove();
            }
        });
    }

    private renderBrowserGroup(blocks: InteractionBlock[], container: HTMLElement, isStreaming: boolean, groupId: string, activeBlockId?: string): void {
        let groupEl = container.querySelector(`[data-block-id="${groupId}"]`) as HTMLElement | null;
        const isNew = !groupEl;
        if (!groupEl) {
            groupEl = dom.append(container, dom.$('.cleanSlate-timeline-block.type-browser-group'));
            groupEl.setAttribute('data-block-id', groupId);
        }

        const running = blocks.some(block => block.browserStatus === 'running' || block.isStreaming);
        const failed = blocks.some(block => block.browserStatus === 'failed');
        const screenshotCount = blocks.reduce((count, block) => count + (block.browserScreenshots?.length || 0), 0);
        const primaryUrl = blocks.find(block => typeof block.browserUrl === 'string' && block.browserUrl.trim().length > 0)?.browserUrl || '';
        const primaryTitle = blocks.find(block => typeof block.browserTitle === 'string' && block.browserTitle.trim().length > 0)?.browserTitle || '';
        const statusLabel = failed ? 'Failed' : running ? 'Running' : 'Complete';
        const title = blocks.length === 1
            ? (blocks[0].browserAction || 'Browser action')
            : `Browser inspection · ${blocks.length} actions`;
        const evidence = [
            screenshotCount > 0 ? `${screenshotCount} screenshot${screenshotCount === 1 ? '' : 's'}` : '',
            primaryUrl
        ].filter(Boolean).join(' · ');
        const wasOpen = groupEl.querySelector('details')?.hasAttribute('open') === true;
        const openAttr = (isNew && running) || (!isNew && wasOpen) ? ' open' : '';
        const iconClass = failed
            ? 'codicon-error'
            : running
                ? 'codicon-loading codicon-modifier-spin'
                : 'codicon-globe';

        const groupHtml = `
            <details class="cleanSlate-browser-group"${openAttr}>
                <summary class="cleanSlate-browser-group-summary">
                    <span class="cleanSlate-browser-group-main">
                        <i class="codicon ${iconClass}"></i>
                        <span class="cleanSlate-browser-group-title">${this.escapeHtml(title)}</span>
                        <span class="cleanSlate-browser-group-status">${this.escapeHtml(statusLabel)}</span>
                    </span>
                    <span class="cleanSlate-browser-group-meta">
                        ${evidence ? `<span>${this.escapeHtml(evidence)}</span>` : ''}
                        ${primaryTitle ? `<span>${this.escapeHtml(primaryTitle)}</span>` : ''}
                    </span>
                    <i class="codicon codicon-chevron-down cleanSlate-browser-group-chevron"></i>
                </summary>
                <div class="cleanSlate-browser-group-body">
                    <div class="cleanSlate-browser-group-events"></div>
                </div>
            </details>
        `;
        this.setTrustedHtmlIfChanged(
            groupEl,
            groupHtml,
            `browser-group:${statusLabel}:${iconClass}:${title}:${evidence}:${primaryTitle}:${blocks.length}:${screenshotCount}`
        );

        const events = groupEl.querySelector('.cleanSlate-browser-group-events') as HTMLElement | null;
        if (!events) {
            return;
        }

        const childIds = new Set(blocks.map(block => block.id));
        blocks.forEach(block => this.renderTimelineBlock(block, events, isStreaming, activeBlockId));
        this.syncTimelineBlockOrder(events, childIds);
        Array.from(events.children).forEach(child => {
            const element = child as HTMLElement;
            const id = element.getAttribute('data-block-id');
            if (id && !childIds.has(id)) {
                element.remove();
            }
        });
    }

    private renderWebGroup(blocks: InteractionBlock[], container: HTMLElement, isStreaming: boolean, groupId: string, activeBlockId?: string): void {
        let groupEl = container.querySelector(`[data-block-id="${groupId}"]`) as HTMLElement | null;
        const visibleBlocks = blocks.filter(block => this.shouldRenderWebActivityBlock(block));
        if (visibleBlocks.length === 0) {
            groupEl?.remove();
            return;
        }

        if (!groupEl) {
            groupEl = dom.append(container, dom.$('.cleanSlate-timeline-block.type-web-group'));
            groupEl.setAttribute('data-block-id', groupId);
        }

        const running = visibleBlocks.some(block => block.webStatus === 'running' || block.isStreaming);
        const fetchCount = visibleBlocks.filter(block => block.webToolName === 'web_fetch').length;
        const sourceCount = visibleBlocks.reduce((count, block) => count + (block.webResults?.length || 0), 0);
        const title = running
            ? 'Working'
            : fetchCount > 0
                ? `Read ${fetchCount} web page${fetchCount === 1 ? '' : 's'}`
                : sourceCount > 0
                    ? `Searched ${sourceCount} source${sourceCount === 1 ? '' : 's'}`
                    : 'Web activity';
        const meta = [
            fetchCount > 0 ? `${fetchCount} page${fetchCount === 1 ? '' : 's'}` : '',
            sourceCount > 0 ? `${sourceCount} source${sourceCount === 1 ? '' : 's'}` : ''
        ].filter(Boolean).join(' · ');
        const groupClasses = [
            'cleanSlate-web-activity',
            running ? 'is-running' : '',
            visibleBlocks.length > 1 ? 'has-multiple-events' : ''
        ].filter(Boolean).join(' ');
        const shellHtml = `
            <div class="cleanSlate-web-activity">
                <div class="cleanSlate-web-activity-status">
                    <span class="cleanSlate-web-activity-title"></span>
                    <span class="cleanSlate-web-activity-meta"></span>
                </div>
                <div class="cleanSlate-web-activity-rule"></div>
                <div class="cleanSlate-web-group-events"></div>
            </div>
        `;
        this.setTrustedHtmlIfChanged(groupEl, shellHtml, 'web-group-shell');
        const activity = groupEl.querySelector('.cleanSlate-web-activity') as HTMLElement | null;
        const titleEl = groupEl.querySelector('.cleanSlate-web-activity-title') as HTMLElement | null;
        const metaEl = groupEl.querySelector('.cleanSlate-web-activity-meta') as HTMLElement | null;
        if (activity) {
            activity.className = groupClasses;
        }
        if (titleEl && titleEl.textContent !== title) {
            titleEl.textContent = title;
        }
        if (metaEl) {
            metaEl.textContent = meta;
            metaEl.toggleAttribute('hidden', meta.length === 0);
        }

        const events = groupEl.querySelector('.cleanSlate-web-group-events') as HTMLElement | null;
        if (!events) {
            return;
        }

        const childIds = new Set(visibleBlocks.map(block => block.id));
        visibleBlocks.forEach(block => this.renderTimelineBlock(block, events, isStreaming, activeBlockId));
        this.syncTimelineBlockOrder(events, childIds);
        Array.from(events.children).forEach(child => {
            const element = child as HTMLElement;
            const id = element.getAttribute('data-block-id');
            if (id && !childIds.has(id)) {
                element.remove();
            }
        });
    }

    private shouldRenderWebActivityBlock(block: InteractionBlock): boolean {
        return !(block.webToolName === 'web_fetch' && block.webStatus === 'failed');
    }

    private updateToolBlock(block: InteractionBlock, el: HTMLElement): void {
        const interrupted = (block.status || '').toLowerCase() === 'interrupted';
        const status = interrupted ? 'interrupted' : block.toolStatus || (block.isStreaming ? 'running' : 'completed');
        this.updateToolActivityRow(
            el,
            status,
            block.isStreaming === true,
            block.content || this.getWorkingPlaceholderLabel(block.toolName),
            'codicon-tools',
            `tool:${block.toolName || ''}`
        );
    }

    private updateToolActivityRow(
        el: HTMLElement,
        status: string,
        isStreaming: boolean,
        rawLabel: string,
        completedIconClass: string,
        renderKeyPrefix: string
    ): void {
        const failed = status === 'failed';
        const interrupted = status === 'interrupted';
        const running = !interrupted && (status === 'running' || isStreaming);
        const iconClass = failed
            ? 'codicon-error'
            : interrupted
                ? 'codicon-debug-stop'
                : running
                    ? 'codicon-loading codicon-modifier-spin'
                    : completedIconClass;
        const label = this.escapeHtml(rawLabel);
        const statusLabel = failed ? 'Failed' : interrupted ? 'Interrupted' : running ? 'Running' : 'Done';

        const html = `
            <div class="cleanSlate-tool-activity-row status-${status}">
                <i class="codicon ${iconClass}"></i>
                <span class="cleanSlate-tool-activity-label">${label}</span>
                <span class="cleanSlate-tool-activity-status">${statusLabel}</span>
            </div>
        `;
        this.setTrustedHtmlIfChanged(el, html, `${renderKeyPrefix}:${status}:${iconClass}:${label}:${statusLabel}`);
    }

    private updateBrowserBlock(block: InteractionBlock, el: HTMLElement): void {
        const interrupted = (block.status || '').toLowerCase() === 'interrupted';
        const status = interrupted ? 'interrupted' : block.browserStatus || (block.isStreaming ? 'running' : 'completed');
        if (this.isCompactBrowserToolBlock(block)) {
            this.updateToolActivityRow(
                el,
                status,
                block.isStreaming === true,
                block.browserAction || 'Opening browser',
                'codicon-globe',
                'browser-open'
            );
            return;
        }
        const isCompactExpandableActivity = this.isCompactExpandableBrowserToolBlock(block);
        const iconClass = status === 'failed'
            ? 'codicon-error'
            : interrupted
                ? 'codicon-debug-stop'
            : status === 'running'
                ? 'codicon-loading codicon-modifier-spin'
                : 'codicon-globe';
        const action = this.escapeHtml(block.browserAction || block.browserToolName || 'Browser action');
        const url = typeof block.browserUrl === 'string' && block.browserUrl.trim().length > 0
            ? `<span class="cleanSlate-browser-url">${this.escapeHtml(block.browserUrl)}</span>`
            : '';
        const title = typeof block.browserTitle === 'string' && block.browserTitle.trim().length > 0
            ? `<span class="cleanSlate-browser-title">${this.escapeHtml(block.browserTitle)}</span>`
            : '';
        const rawDetails = (block.details || [])
            .filter(detail => !/^URL\s+/i.test(detail.trim()) && !/^Title\s+/i.test(detail.trim()))
            .filter(detail => detail.trim() !== (block.browserAction || '').trim());
        const maxDetails = 6;
        const visibleDetails = rawDetails.slice(0, maxDetails);
        const hiddenDetails = rawDetails.slice(maxDetails);
        const hasDomSnapshotDetails = rawDetails.some(detail => this.isBrowserDomSnapshotDetail(detail));
        const visibleDetailsHtml = visibleDetails
            .map(detail => this.renderBrowserDetail(detail))
            .join('');
        const hiddenDetailsHtml = hiddenDetails
            .map(detail => this.renderBrowserDetail(detail))
            .join('');
        const details = hiddenDetails.length > 0
            ? `
                ${visibleDetailsHtml}
                <div class="cleanSlate-browser-hidden-details" hidden>${hiddenDetailsHtml}</div>
                <button
                    class="cleanSlate-browser-detail-more"
                    type="button"
                    data-browser-details-toggle
                    data-hidden-count="${hiddenDetails.length}"
                    aria-expanded="false"
                >+${hiddenDetails.length} more</button>
            `
            : visibleDetailsHtml;
        const screenshotItems = (block.browserScreenshots || [])
            .slice(0, 6)
            .map(screenshot => ({
                label: screenshot.label || 'Screenshot',
                source: normalizeCleanSlateBrowserScreenshotDataUrl(screenshot.mimeType, screenshot.base64)
            }));
        const screenshots = screenshotItems
            .map((screenshot, index) => screenshot.source
                ? `
                    <figure class="cleanSlate-browser-shot">
                        <img alt="${this.escapeHtml(screenshot.label || 'Browser screenshot')}" data-browser-screenshot-index="${index}" />
                        <figcaption>${this.escapeHtml(screenshot.label || 'Screenshot')}</figcaption>
                    </figure>
                `
                : `
                    <figure class="cleanSlate-browser-shot is-unavailable">
                        <div class="cleanSlate-browser-shot-unavailable">Screenshot unavailable</div>
                        <figcaption>${this.escapeHtml(screenshot.label || 'Screenshot')}</figcaption>
                    </figure>
                `)
            .join('');
        const detailsSection = details
            ? `<div class="cleanSlate-browser-details${hasDomSnapshotDetails ? ' is-dom-snapshot' : ''}">${details}</div>`
            : '';
        const screenshotSection = screenshots
            ? `<div class="cleanSlate-browser-shots count-${Math.min(screenshotItems.length, 6)}">${screenshots}</div>`
            : '';
        const hasExpandableContent = !!detailsSection || !!screenshotSection;
        const browserClasses = [
            'cleanSlate-browser-block',
            `status-${this.escapeHtml(status)}`,
            isCompactExpandableActivity ? 'cleanSlate-browser-inspection-activity' : '',
            screenshotItems.length > 0 ? 'has-shots' : 'compact',
            hasExpandableContent ? 'has-body' : 'is-empty'
        ].filter(Boolean).join(' ');

        const statusLabel = status === 'failed'
            ? 'Failed'
            : interrupted
                ? 'Interrupted'
                : status === 'running'
                    ? 'Running'
                    : 'Done';
        const headerHtml = isCompactExpandableActivity
            ? `
            <summary class="cleanSlate-browser-header cleanSlate-tool-activity-row cleanSlate-browser-inspection-header status-${this.escapeHtml(status)}">
                <i class="codicon ${iconClass}"></i>
                <span class="cleanSlate-tool-activity-label">${action}</span>
                <span class="cleanSlate-tool-activity-status">${statusLabel}</span>
                ${hasExpandableContent ? '<i class="codicon codicon-chevron-right cleanSlate-browser-event-chevron"></i>' : ''}
            </summary>
        `
            : `
            <summary class="cleanSlate-browser-header">
                <i class="codicon ${iconClass}"></i>
                <span class="cleanSlate-browser-action">${action}</span>
                <span class="cleanSlate-browser-meta">${url}${title}</span>
                ${hasExpandableContent ? '<i class="codicon codicon-chevron-right cleanSlate-browser-event-chevron"></i>' : ''}
            </summary>
        `;
        const flatHeaderHtml = isCompactExpandableActivity
            ? `
                <div class="cleanSlate-browser-header cleanSlate-tool-activity-row cleanSlate-browser-inspection-header status-${this.escapeHtml(status)}">
                    <i class="codicon ${iconClass}"></i>
                    <span class="cleanSlate-tool-activity-label">${action}</span>
                    <span class="cleanSlate-tool-activity-status">${statusLabel}</span>
                </div>
            `
            : `
                <div class="cleanSlate-browser-header">
                    <i class="codicon ${iconClass}"></i>
                    <span class="cleanSlate-browser-action">${action}</span>
                    <span class="cleanSlate-browser-meta">${url}${title}</span>
                </div>
            `;
        const html = hasExpandableContent
            ? `
                <details class="${browserClasses}">
                    ${headerHtml}
                    <div class="cleanSlate-browser-body">
                        ${detailsSection}
                        ${screenshotSection}
                    </div>
                </details>
            `
            : `
                <div class="${browserClasses}">
                    ${flatHeaderHtml}
                </div>
            `;
        const screenshotKey = screenshotItems
            .map(screenshot => `${screenshot.label}:${screenshot.source?.length || 0}:${screenshot.source?.slice(0, 48) || ''}`)
            .join('\u001e');
        this.setTrustedHtmlIfChanged(
            el,
            html,
            `browser:${status}:${iconClass}:${block.browserAction || ''}:${block.browserUrl || ''}:${block.browserTitle || ''}:${rawDetails.join('\u001f')}:${screenshotKey}:${isCompactExpandableActivity}`
        );
        this.hydrateBrowserScreenshotSources(el, screenshotItems);
        this.bindBrowserDetailsDisclosure(el);
    }

    private isCompactBrowserToolBlock(block: InteractionBlock): boolean {
        return block.browserToolName === 'browser_open'
            || block.browserToolName === 'browser_click'
            || block.browserToolName === 'browser_hover'
            || block.browserToolName === 'browser_fill'
            || block.browserToolName === 'browser_check'
            || block.browserToolName === 'browser_select'
            || block.browserToolName === 'browser_upload'
            || block.browserToolName === 'browser_type'
            || block.browserToolName === 'browser_key'
            || block.browserToolName === 'browser_scroll'
            || block.browserToolName === 'browser_dialog'
            || block.browserToolName === 'browser_clipboard'
            || block.browserToolName === 'browser_new_tab'
            || block.browserToolName === 'browser_select_tab'
            || block.browserToolName === 'browser_close_tab';
    }

    private isCompactExpandableBrowserToolBlock(block: InteractionBlock): boolean {
        return block.browserToolName === 'browser_snapshot'
            || block.browserToolName === 'browser_screenshot'
            || block.browserToolName === 'browser_diagnostics'
            || block.browserToolName === 'browser_tabs';
    }

    private isStandaloneBrowserToolBlock(block: InteractionBlock): boolean {
        return this.isCompactBrowserToolBlock(block) || this.isCompactExpandableBrowserToolBlock(block);
    }

    private hydrateBrowserScreenshotSources(
        el: HTMLElement,
        screenshots: readonly { source: string | undefined }[]
    ): void {
        const images = el.querySelectorAll('img[data-browser-screenshot-index]');
        images.forEach(imageNode => {
            const image = imageNode as HTMLImageElement;
            const index = Number(image.dataset.browserScreenshotIndex);
            const source = Number.isInteger(index) ? screenshots[index]?.source : undefined;
            if (source && image.src !== source) {
                // Keep large media payloads out of innerHTML. Assigning the
                // normalized URL directly avoids Chromium treating wrapped or
                // already-prefixed base64 as a malformed attribute URL.
                image.src = source;
            }
        });
    }

    private bindBrowserDetailsDisclosure(el: HTMLElement): void {
        const button = el.querySelector('[data-browser-details-toggle]') as HTMLButtonElement | null;
        const hiddenDetails = el.querySelector('.cleanSlate-browser-hidden-details') as HTMLElement | null;
        if (!button || !hiddenDetails) {
            delete el.dataset.browserDetailsExpanded;
            return;
        }

        const hiddenCount = Number(button.dataset.hiddenCount) || 0;
        const applyExpandedState = (expanded: boolean) => {
            hiddenDetails.hidden = !expanded;
            button.setAttribute('aria-expanded', String(expanded));
            button.textContent = expanded ? 'Show less' : `+${hiddenCount} more`;
            button.setAttribute(
                'aria-label',
                expanded
                    ? 'Show fewer inspected pages'
                    : `Show ${hiddenCount} more inspected page${hiddenCount === 1 ? '' : 's'}`
            );
        };

        applyExpandedState(el.dataset.browserDetailsExpanded === 'true');
        button.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            const expanded = button.getAttribute('aria-expanded') !== 'true';
            el.dataset.browserDetailsExpanded = String(expanded);
            applyExpandedState(expanded);
        };
    }

    private updateWebRetrievalBlock(block: InteractionBlock, el: HTMLElement): void {
        const rendered = this.webActivityRenderer.render(block);
        this.setTrustedHtmlIfChanged(el, rendered.html, rendered.renderKey);
    }

    private renderBrowserDetail(detail: string): string {
        const trimmed = detail.trim();
        const domMatch = /^element-(\d+):\s*<([^>]+)>\s*(.*)$/i.exec(trimmed);
        if (domMatch) {
            const [, index, tagName, text] = domMatch;
            const label = text.trim();
            return `
                <div class="cleanSlate-browser-detail cleanSlate-browser-dom-row">
                    <span class="cleanSlate-browser-dom-index">${this.escapeHtml(index)}</span>
                    <span class="cleanSlate-browser-dom-tag">&lt;${this.escapeHtml(tagName.toLowerCase())}&gt;</span>
                    <span class="cleanSlate-browser-dom-text">${label ? this.escapeHtml(label) : '<span class="is-empty">No visible text</span>'}</span>
                </div>
            `;
        }

        const moreMatch = /^(?:\+|\.\.\.and\s+)(\d+)\s+more/i.exec(trimmed);
        if (moreMatch) {
            return `<div class="cleanSlate-browser-detail cleanSlate-browser-detail-more">${this.escapeHtml(trimmed.replace(/^\.\.\.and/i, '+'))}</div>`;
        }

        if (/^(error|failed):/i.test(trimmed)) {
            return `<div class="cleanSlate-browser-detail cleanSlate-browser-detail-error">${this.escapeHtml(trimmed)}</div>`;
        }

        return `<div class="cleanSlate-browser-detail">${this.escapeHtml(trimmed)}</div>`;
    }

    private isBrowserDomSnapshotDetail(detail: string): boolean {
        return /^element-\d+:\s*<[^>]+>/i.test(detail.trim());
    }

    private escapeHtml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    private getWorkingPlaceholderLabel(toolName: string | undefined): string {
        if (!toolName || toolName.trim().length === 0) {
            return 'Thinking...';
        }

        return `Using ${this.formatToolNameForDisplay(toolName)}`;
    }

    private formatToolNameForDisplay(toolName: string): string {
        return toolName
            .replace(/^mcp_/, 'MCP ')
            .split(/[_\s-]+/)
            .filter(Boolean)
            .map(part => part.length <= 2 ? part.toUpperCase() : `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
            .join(' ');
    }

}
