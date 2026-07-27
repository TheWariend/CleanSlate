/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../base/browser/dom.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IMarkerService, MarkerSeverity } from '../../../../../../platform/markers/common/markers.js';
import { IEditorService } from '../../../../../services/editor/common/editorService.js';
import { policy } from '../runtime/cleanSlateChatController.js';
import { InteractionBlock } from '../types/cleanSlateChatTypes.js';
import { getCleanSlateSearchActivityPresentation, isCleanSlateQuerySearchGroup } from './cleanSlateActivityPresentation.js';
import { CleanSlateReviewRenderer } from './cleanSlateReviewRenderer.js';
import type { ICleanSlateReviewChange } from './cleanSlateReviewModel.js';

type CleanSlateDeltaCounterKind = 'added' | 'deleted';

interface ICleanSlateDeltaCounterState {
    displayed: number;
    target: number;
    frame?: number;
    cancelFrame?: (frame: number) => void;
    deleteWhenSettled?: boolean;
}

export interface ICleanSlateTranscriptFileRendererCallbacks {
    disposeMarkdownRender: (element: HTMLElement | null | undefined) => void;
    setMarkdownIfChanged: (element: HTMLElement, markdown: string, renderKey: string) => boolean;
    setTrustedHtmlIfChanged: (element: HTMLElement, html: string, renderKey: string) => boolean;
    /**
     * When provided and it returns true, the host handled opening the file
     * (e.g. the agent manager opening it in its embedded editor) and the
     * default IDE editor open is skipped.
     */
    openFile?: (resource: URI, options: { selection?: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } }) => boolean;
}

/** Owns file activity, mutation deltas, and finish-card diff previews. */
export class CleanSlateTranscriptFileRenderer {
    private readonly finishDiffExpandedKeys = new Set<string>();
    private readonly fileDiffExpandedBlockIds = new Set<string>();
    private readonly fileDeltaCounterStates = new Map<string, ICleanSlateDeltaCounterState>();
    private readonly reviewRenderer = new CleanSlateReviewRenderer();

    constructor(
        private readonly markerService: IMarkerService,
        private readonly editorService: IEditorService,
        private readonly callbacks: ICleanSlateTranscriptFileRendererCallbacks
    ) { }

    private disposeMarkdownRender(element: HTMLElement | null | undefined): void {
        this.callbacks.disposeMarkdownRender(element);
    }

    private setMarkdownIfChanged(element: HTMLElement, markdown: string, renderKey: string): boolean {
        return this.callbacks.setMarkdownIfChanged(element, markdown, renderKey);
    }

    private setTrustedHtmlIfChanged(element: HTMLElement, html: string, renderKey: string): boolean {
        return this.callbacks.setTrustedHtmlIfChanged(element, html, renderKey);
    }

    public updateFinishBlock(block: InteractionBlock, el: HTMLElement): void {
        this.disposeFinishDiffEditorsForBlock(block.id);
        const changes = Array.isArray(block.fileChanges) ? block.fileChanges : [];
        const fileCount = changes.length;
        const totalAdded = changes.reduce((total, change) => total + (change.added || 0), 0);
        const totalDeleted = changes.reduce((total, change) => total + (change.deleted || 0), 0);
        const summary = typeof block.content === 'string' && block.content.trim().length > 0
            ? block.content.trim()
            : '';
        const existingSummary = el.querySelector('.cleanSlate-finish-summary') as HTMLElement | null;
        this.disposeMarkdownRender(existingSummary);
        const summarySection = summary
            ? '<div class="cleanSlate-finish-summary cleanSlate-message-content" data-clean-slate-finish-summary></div>'
            : '';
        const compactLimit = 8;
        const remainingCount = Math.max(0, fileCount - compactLimit);
        const rows = changes.map((change, index) => {
            const path = change.path || '';
            const basename = path.split(/[/\\]/).pop() || path;
            const added = change.added || 0;
            const deleted = change.deleted || 0;
            const shouldShowDiffPreview = this.shouldShowFinishDiffPreview(change, path);
            const diffKey = `${block.id}:${index}`;
            const isInitiallyHidden = index >= compactLimit;
            const isOpen = shouldShowDiffPreview && this.finishDiffExpandedKeys.has(diffKey);
            const diffHtml = shouldShowDiffPreview
                ? `<div class="cleanSlate-finish-diff-editor" data-diff-key="${this.escapeHtml(diffKey)}" data-file-path="${this.escapeHtml(path)}" ${isOpen ? '' : 'hidden'}></div>`
                : '';
            return `
                <div class="cleanSlate-finish-file-diff${isInitiallyHidden ? ' is-hidden-extra' : ''}">
                    <button class="cleanSlate-finish-file-row${isOpen ? ' is-open' : ''}" type="button" title="${this.escapeHtml(path)}" data-diff-toggle="${this.escapeHtml(diffKey)}" aria-expanded="${isOpen ? 'true' : 'false'}" ${shouldShowDiffPreview ? '' : 'disabled'}>
                        <i class="codicon codicon-file"></i>
                        <span class="cleanSlate-finish-file-name">${this.escapeHtml(basename)}</span>
                        <span class="cleanSlate-finish-file-spacer"></span>
                        ${added > 0 ? `<span class="stat-added">+${added}</span>` : ''}
                        ${deleted > 0 ? `<span class="stat-deleted">-${deleted}</span>` : ''}
                        ${shouldShowDiffPreview ? '<i class="codicon codicon-chevron-right cleanSlate-finish-file-chevron"></i>' : ''}
                    </button>
                    ${diffHtml}
                </div>
            `;
        }).join('');
        const remainingRow = remainingCount > 0
            ? `<button class="cleanSlate-finish-more-row" type="button" data-show-more-finish-files>...and ${remainingCount} more</button>`
            : '';
        const totalStats = [
            totalAdded > 0 ? `<span class="stat-added">+${totalAdded}</span>` : '',
            totalDeleted > 0 ? `<span class="stat-deleted">-${totalDeleted}</span>` : ''
        ].filter(Boolean).join(' ');
        const changesSection = fileCount > 0
            ? `
                <div class="cleanSlate-finish-changes-card">
                    <div class="cleanSlate-finish-changes-header">
                        <span class="cleanSlate-finish-changes-title">${fileCount} ${fileCount === 1 ? 'file' : 'files'} changed</span>
                        <span class="cleanSlate-finish-total-stats">${totalStats}</span>
                        <span class="cleanSlate-finish-header-spacer"></span>
                    </div>
                    <div class="cleanSlate-finish-file-list">
                        ${rows}
                        ${remainingRow}
                    </div>
                </div>
            `
            : '';

        el.innerHTML = (policy ? policy.createHTML(`
            <div class="cleanSlate-finish-card">
                ${summarySection}
                ${changesSection}
            </div>
        `) : '') as unknown as string;
        const summaryEl = el.querySelector('[data-clean-slate-finish-summary]') as HTMLElement | null;
        if (summaryEl && summary) {
            this.setMarkdownIfChanged(summaryEl, summary, `finish-summary:${block.id}:${summary}`);
        }
        this.setupFinishDiffToggles(block, el, changes);
        this.mountOpenFinishDiffPreviews(block, el, changes);
        this.setupFinishShowMore(el);
    }


    private shouldShowFinishDiffPreview(change: NonNullable<InteractionBlock['fileChanges']>[number], path: string): boolean {
        void path;
        return this.hasReviewDiffContent(change.beforeContent, change.afterContent, change.diff);
    }

    /** Render a diff into an already-visible container from inline change content. */
    private renderDiffPreview(
        container: HTMLElement,
        path: string,
        added: unknown,
        deleted: unknown,
        diff: unknown,
        beforeContent: unknown,
        afterContent: unknown
    ): void {
        const inlineChange = this.createReviewChange(path, added, deleted, diff, beforeContent, afterContent);
        if (!inlineChange) {
            return;
        }
        container.classList.remove('custom');
        container.classList.add('review-inline');
        this.reviewRenderer.renderInlineDiff(container, inlineChange);
    }

    private mountFinishDiffPreview(block: InteractionBlock, el: HTMLElement, change: NonNullable<InteractionBlock['fileChanges']>[number] | undefined, index: number): void {
        if (!change) {
            return;
        }
        const key = `${block.id}:${index}`;
        const container = Array.from(el.querySelectorAll('.cleanSlate-finish-diff-editor'))
            .find(candidate => candidate.getAttribute('data-diff-key') === key) as HTMLElement | undefined;
        if (!container) {
            return;
        }

        this.disposeFinishDiffEditor(key);
        this.renderDiffPreview(
            container,
            change.path || `change-${index}`,
            change.added,
            change.deleted,
            change.diff,
            change.beforeContent,
            change.afterContent
        );
    }

    private mountOpenFinishDiffPreviews(block: InteractionBlock, el: HTMLElement, changes: NonNullable<InteractionBlock['fileChanges']>): void {
        const containers = Array.from(el.querySelectorAll('.cleanSlate-finish-diff-editor:not([hidden])')) as HTMLElement[];
        for (const container of containers) {
            const key = container.getAttribute('data-diff-key');
            if (!key) {
                continue;
            }
            const index = Number(key.slice(key.lastIndexOf(':') + 1));
            if (!Number.isInteger(index)) {
                continue;
            }
            this.mountFinishDiffPreview(block, el, changes[index], index);
        }
    }

    private setupFinishDiffToggles(block: InteractionBlock, el: HTMLElement, changes: NonNullable<InteractionBlock['fileChanges']>): void {
        const toggles = Array.from(el.querySelectorAll('.cleanSlate-finish-file-row[data-diff-toggle]')) as HTMLButtonElement[];
        toggles.forEach(toggle => {
            const key = toggle.getAttribute('data-diff-toggle');
            if (key) {
                const container = Array.from(el.querySelectorAll('.cleanSlate-finish-diff-editor'))
                    .find(candidate => candidate.getAttribute('data-diff-key') === key) as HTMLElement | undefined;
                const isOpen = !!container && container.hidden === false;
                toggle.classList.toggle('is-open', isOpen);
                toggle.setAttribute('aria-expanded', String(isOpen));
            }
            toggle.addEventListener('click', () => {
                const key = toggle.getAttribute('data-diff-toggle');
                if (!key) {
                    return;
                }

                const container = Array.from(el.querySelectorAll('.cleanSlate-finish-diff-editor'))
                    .find(candidate => candidate.getAttribute('data-diff-key') === key) as HTMLElement | undefined;
                if (!container) {
                    return;
                }

                const willOpen = container.hidden === true;
                container.hidden = !willOpen;
                toggle.classList.toggle('is-open', willOpen);
                toggle.setAttribute('aria-expanded', String(willOpen));
                if (willOpen) {
                    this.finishDiffExpandedKeys.add(key);
                    const index = Number(key.slice(key.lastIndexOf(':') + 1));
                    this.mountFinishDiffPreview(block, el, changes[index], index);
                } else {
                    this.finishDiffExpandedKeys.delete(key);
                    this.disposeFinishDiffEditor(key);
                    dom.clearNode(container);
                }
            });
        });
    }

    private setupFinishShowMore(el: HTMLElement): void {
        const showMore = el.querySelector('[data-show-more-finish-files]') as HTMLButtonElement | null;
        if (!showMore) {
            return;
        }
        showMore.addEventListener('click', () => {
            el.querySelectorAll('.cleanSlate-finish-file-diff.is-hidden-extra').forEach(row => {
                row.classList.remove('is-hidden-extra');
            });
            showMore.remove();
        });
    }

    private disposeFinishDiffEditor(key: string): void {
        void key;
    }

    public disposeFinishDiffEditorsForBlock(blockId: string): void {
        void blockId;
    }

    public updateFileBlock(block: InteractionBlock, el: HTMLElement, isStreaming: boolean): void {
        const path = block.path || '';
        const isActivityGroup = block.id.startsWith('group-activity-block');
        const isContextCompaction = block.id.startsWith('context-compaction-');
        const isContextUsage = block.id.startsWith('context-usage-');
        if (!isActivityGroup && !isContextCompaction && !isContextUsage && !path.trim()) {
            el.style.display = 'none';
            return;
        }
        const status = block.status || 'Edited';

        if (isContextUsage) {
            // Hide context-usage blocks restored from older persisted sessions.
            el.style.display = 'none';
            return;
        }

        if (isContextCompaction) {
            const label = status === 'Compacting context...' ? 'Compacting context' : status;
            const spinner = block.isStreaming
                ? '<span class="cleanSlate-file-spinner" style="margin-right: 8px;"></span>'
                : '';
            const html = `
                <div class="cleanSlate-activity-disclosure activity-group cleanSlate-context-compaction">
                    <div class="cleanSlate-activity-summary">
                        ${spinner}
                        <span class="cleanSlate-activity-label">${this.escapeHtml(label)}</span>
                    </div>
                </div>
            `;
            this.setTrustedHtmlIfChanged(el, html, `context-compaction:${status}:${block.isStreaming ? 'streaming' : 'complete'}`);
            el.style.display = 'block';
            return;
        }

        if (isActivityGroup || status === 'Read' || status === 'Exploring...' || status === 'Explored') {
            if (isActivityGroup) {
                const details = block.details || [];
                const detailsMetadata = block.detailMetadata || [];
                const isQuerySearchGroup = isCleanSlateQuerySearchGroup(
                    block.searchCount || 0,
                    block.fileCount || 0,
                    detailsMetadata
                );

                const parts: string[] = [];
                if (block.fileCount && block.fileCount > 0) parts.push(`${block.fileCount} file${block.fileCount > 1 ? 's' : ''}`);
                if (block.searchCount && block.searchCount > 0) {
                    parts.push(isQuerySearchGroup
                        ? `${block.searchCount} pattern${block.searchCount > 1 ? 's' : ''}`
                        : `${block.searchCount} search${block.searchCount > 1 ? 'es' : ''}`);
                }

                const isActiveActivity = el.classList.contains('is-active');
                const isActiveExploration = status === 'Exploring...' || status === 'Exploring' || (isActiveActivity && status === 'Explored');
                const summaryLabel = isQuerySearchGroup ? (isActiveExploration ? 'Searching' : 'Searched') :
                                    isActiveExploration ? 'Exploring' :
                                    (status === 'Analyzing...' || status === 'Analyzing' || (isActiveActivity && status === 'Analyzed')) ? 'Analyzing' :
                                    (status === 'Explored') ? 'Explored' : 'Analyzed';
                const summaryText = `${summaryLabel} ${parts.join(', ')}`;

                // Detail strings derive from model-controlled tool inputs (search
                // queries, paths). A malformed tool call once rendered raw garbage
                // here — always escape, strip control characters, and clamp.
                const detailsHtml = details.map((d: string, i: number) => {
                    const meta = detailsMetadata[i];
                    if (meta && meta.path) {
                        const basename = meta.path.split(/[/\\]/).pop() || meta.path;
                        const label = meta.label || d;
                        const searchPresentation = getCleanSlateSearchActivityPresentation(meta, basename);
                        if (searchPresentation) {
                            return `
                                <div class="activity-detail-item clickable-file" data-path="${this.escapeHtml(meta.path)}" data-range="">
                                    <span class="activity-action">${searchPresentation.action}</span>
                                    <span class="file-icon-container" data-path="${this.escapeHtml(meta.path)}"></span>
                                    <span class="activity-file"><span class="activity-query">“${this.sanitizeActivityLabel(searchPresentation.query, 120)}”</span><span class="activity-scope"> in ${this.sanitizeActivityLabel(searchPresentation.scope, 120)}</span></span>
                                </div>
                            `;
                        }
                        const actionLabel = this.sanitizeActivityLabel(label.split(' ')[0], 24); // Read or Explored
                        const rangeSuffix = meta.range ? ` #${this.sanitizeActivityLabel(meta.range, 24)}` : '';

                        return `
                            <div class="activity-detail-item clickable-file" data-path="${this.escapeHtml(meta.path)}" data-range="${this.escapeHtml(meta.range || '')}">
                                <span class="activity-action">${actionLabel}</span>
                                <span class="file-icon-container" data-path="${this.escapeHtml(meta.path)}"></span>
                                <span class="activity-file">${this.sanitizeActivityLabel(basename, 120)}${rangeSuffix}</span>
                            </div>
                        `;
                    }
                    return `<div class="activity-detail-item">${this.sanitizeActivityLabel(d, 160)}</div>`;
                }).join('');

                const html = `
                    <details class="cleanSlate-activity-disclosure activity-group">
                        <summary class="cleanSlate-activity-summary">
                            <svg class="cleanSlate-activity-chevron" width="10" height="10" viewBox="0 0 10 10"><path d="M3 2l4 3-4 3z" fill="currentColor"/></svg>
                            <span class="cleanSlate-activity-label">${summaryText}</span>
                        </summary>
                        <div class="cleanSlate-activity-content activity-details">
                            ${detailsHtml}
                        </div>
                    </details>
                `;
                const detailKey = details
                    .map((detail, index) => `${detail}|${detailsMetadata[index]?.path || ''}|${detailsMetadata[index]?.range || ''}|${detailsMetadata[index]?.type || ''}`)
                    .join('\n');
                const didChange = this.setTrustedHtmlIfChanged(
                    el,
                    html,
                    `activity:${status}:${summaryText}:${detailKey}`
                );

                // Inject icons and attach listeners
                if (didChange) {
                    el.querySelectorAll('.clickable-file').forEach((item, i) => {
                        const meta = detailsMetadata[i];
                        const iconContainer = item.querySelector('.file-icon-container') as HTMLElement;

                        if (meta && iconContainer) {
                            const iconClass = meta.type === 'explore' ? 'codicon-search' : 'codicon-file';
                            iconContainer.className = `file-icon-container codicon ${iconClass}`;
                        }

                        if (meta && meta.type === 'read' && meta.path) {
                            item.addEventListener('click', (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const options: any = { pinned: true };
                                if (meta.range) {
                                    const [start, end] = meta.range.split('-').map(Number);
                                    if (!isNaN(start)) {
                                        options.selection = { startLineNumber: start, startColumn: 1, endLineNumber: end || start, endColumn: 1 };
                                    }
                                }
                                const resource = URI.file(meta.path!);
                                if (this.callbacks.openFile?.(resource, options)) {
                                    return;
                                }
                                this.editorService.openEditor({ resource, options });
                            });
                        } else {
                            // For search/explore, remove the clickable styling
                            item.classList.remove('clickable-file');
                            (item as HTMLElement).style.cursor = 'default';
                        }
                    });
                }
                return;
            }

            const basename = path.split(/[/\\]/).pop() || path;
            const hasGroupedItems = (block.itemCount || 0) > 1;
            const labelStr = status === 'Read' ? 'Analyzed' : (status === 'Exploring...' ? 'Exploring' : 'Explored');
            const itemsStr = hasGroupedItems ? `${block.itemCount} items` : basename;
            const rangeStr = (status === 'Read' && (block.range || '')) ? `<span class="file-range">${block.range}</span>` : '';
            const pathInfo = `<span class="file-name" style="cursor: pointer;">${itemsStr}</span>`;
            const titleText = status === 'Read' ? path : (block.path || path);

            const html = `
                <div class="cleanSlate-file-analyzed" title="${titleText}">
                    <span class="analyzed-label">${labelStr}</span>
                    ${pathInfo}
                    ${rangeStr}
                </div>
            `;
            this.setTrustedHtmlIfChanged(el, html, `file-read:${status}:${path}:${itemsStr}:${block.range || ''}`);
            return;
        }

        el.style.display = 'block';
        const basename = path.split(/[/\\]/).pop() || path;
        const resource = URI.file(path);
        const markers = this.markerService.read({ resource, severities: MarkerSeverity.Warning | MarkerSeverity.Error });
        const warningCount = markers.length;

        const statusLabel = status === 'Edited' ? 'Modified' : status.replace(/\.\.\.$/, '');
        const added = block.added || 0;
        const deleted = block.deleted || 0;
        const hasMutationStats = typeof block.added === 'number' || typeof block.deleted === 'number';
        const suffixParts: string[] = [];
        if (hasMutationStats) {
            suffixParts.push(`<span class="stat-added cleanSlate-delta-counter" data-delta-kind="added" data-delta-target="${added}">+${added}</span>`);
            suffixParts.push(`<span class="stat-deleted cleanSlate-delta-counter" data-delta-kind="deleted" data-delta-target="${deleted}">-${deleted}</span>`);
        }
        if (warningCount > 0) {
            suffixParts.push(`<span class="file-marker-count">!${warningCount}</span>`);
        }

        const suffixHtml = suffixParts.length > 0
            ? `<span class="file-range cleanSlate-file-delta">${suffixParts.join(' ')}</span>`
            : '';
        const spinnerHtml = block.isStreaming
            ? '<span class="cleanSlate-file-spinner" style="margin-left: 8px;"></span>'
            : '';
        const hasDiffPreview = this.hasFileDiffPreview(block);
        const diffKey = this.getFileDiffKey(block);
        if (!hasDiffPreview) {
            this.fileDiffExpandedBlockIds.delete(block.id);
            this.disposeFinishDiffEditor(diffKey);
        }
        const isExpanded = hasDiffPreview && this.fileDiffExpandedBlockIds.has(block.id);
        const chevronHtml = hasDiffPreview
            ? '<i class="codicon codicon-chevron-right cleanSlate-file-diff-chevron"></i>'
            : '';
        const diffHtml = hasDiffPreview
            ? `<div class="cleanSlate-file-diff-editor" data-file-diff-key="${this.escapeHtml(diffKey)}" data-file-path="${this.escapeHtml(path)}" ${isExpanded ? '' : 'hidden'}></div>`
            : '';
        const rowTag = hasDiffPreview ? 'button' : 'div';
        const rowAttrs = hasDiffPreview
            ? `type="button" data-file-diff-toggle="${this.escapeHtml(diffKey)}" aria-expanded="${isExpanded ? 'true' : 'false'}"`
            : '';

        const compactHtml = `
            <div class="cleanSlate-file-mutation-card${hasDiffPreview ? ' has-diff-preview' : ''}${isExpanded ? ' is-open' : ''}" title="${this.escapeHtml(path)}">
                <${rowTag} class="cleanSlate-file-analyzed cleanSlate-file-mutation-row" ${rowAttrs}>
                    <span class="analyzed-label">${statusLabel}</span>
                    <i class="codicon codicon-file" style="font-size: 12px; margin-right: 4px; opacity: 0.8;"></i>
                    <span class="file-name" style="cursor: pointer;">${this.escapeHtml(basename)}</span>
                    ${suffixHtml}
                    ${spinnerHtml}
                    ${chevronHtml}
                </${rowTag}>
                ${diffHtml}
            </div>
        `;
        const renderKey = [
            'file',
            statusLabel,
            path,
            added,
            deleted,
            warningCount,
            block.isStreaming === true,
            hasDiffPreview,
            isExpanded,
            this.getFileDiffContentSignature(block)
        ].join(':');
        if (el.dataset.renderKey !== renderKey) {
            this.disposeFinishDiffEditor(diffKey);
        }
        const didChange = this.setTrustedHtmlIfChanged(
            el,
            compactHtml,
            renderKey
        );
        if (didChange && hasDiffPreview) {
            this.setupFileDiffToggle(block, el);
        }
        if (hasDiffPreview && isExpanded) {
            const diffContainer = el.querySelector('.cleanSlate-file-diff-editor') as HTMLElement | null;
            if (didChange || !diffContainer || diffContainer.childElementCount === 0) {
                this.mountFileDiffPreview(block, el);
            }
        }
        const shouldAnimateDelta = block.isStreaming === true || isStreaming;
        this.updateFileDeltaCounter(el, block.id, 'added', added, shouldAnimateDelta, didChange);
        this.updateFileDeltaCounter(el, block.id, 'deleted', deleted, shouldAnimateDelta, didChange);
    }

    private hasFileDiffPreview(block: InteractionBlock): boolean {
        return this.hasReviewDiffContent(block.beforeContent, block.afterContent, block.diff);
    }

    private getFileDiffKey(block: InteractionBlock): string {
        return `file:${block.id}`;
    }

    private getFileDiffContentSignature(block: InteractionBlock): string {
        return [
            typeof block.beforeContent === 'string' ? block.beforeContent.length : 0,
            typeof block.afterContent === 'string' ? block.afterContent.length : 0,
            typeof block.diff === 'string' ? block.diff.length : 0
        ].join('/');
    }

    private setupFileDiffToggle(block: InteractionBlock, el: HTMLElement): void {
        const toggle = el.querySelector('.cleanSlate-file-mutation-row[data-file-diff-toggle]') as HTMLButtonElement | null;
        if (!toggle) {
            return;
        }

        toggle.addEventListener('click', () => {
            const key = toggle.getAttribute('data-file-diff-toggle') || this.getFileDiffKey(block);
            const container = Array.from(el.querySelectorAll('.cleanSlate-file-diff-editor'))
                .find(candidate => candidate.getAttribute('data-file-diff-key') === key) as HTMLElement | undefined;
            const card = el.querySelector('.cleanSlate-file-mutation-card') as HTMLElement | null;
            if (!container) {
                return;
            }

            const willOpen = container.hidden === true;
            container.hidden = !willOpen;
            toggle.classList.toggle('is-open', willOpen);
            card?.classList.toggle('is-open', willOpen);
            toggle.setAttribute('aria-expanded', String(willOpen));
            if (willOpen) {
                this.fileDiffExpandedBlockIds.add(block.id);
                this.mountFileDiffPreview(block, el);
            } else {
                this.fileDiffExpandedBlockIds.delete(block.id);
                this.disposeFinishDiffEditor(key);
                dom.clearNode(container);
            }
        });
    }

    private mountFileDiffPreview(block: InteractionBlock, el: HTMLElement): void {
        const key = this.getFileDiffKey(block);
        const container = Array.from(el.querySelectorAll('.cleanSlate-file-diff-editor'))
            .find(candidate => candidate.getAttribute('data-file-diff-key') === key) as HTMLElement | undefined;
        if (!container) {
            return;
        }

        this.disposeFinishDiffEditor(key);
        const path = block.path || `change-${block.id}`;
        this.renderDiffPreview(
            container,
            path,
            block.added,
            block.deleted,
            block.diff,
            block.beforeContent,
            block.afterContent
        );
    }

    private hasReviewDiffContent(beforeContent: unknown, afterContent: unknown, diff: unknown): boolean {
        const beforeSnapshot = this.cleanReviewSnapshotText(beforeContent);
        const afterSnapshot = this.cleanReviewSnapshotText(afterContent);
        const unifiedDiff = this.cleanReviewDiffText(diff);
        return (typeof beforeSnapshot === 'string' && typeof afterSnapshot === 'string' && beforeSnapshot !== afterSnapshot)
            || typeof unifiedDiff === 'string';
    }

    private createReviewChange(
        path: string,
        added: unknown,
        deleted: unknown,
        diff: unknown,
        beforeContent: unknown,
        afterContent: unknown
    ): ICleanSlateReviewChange | undefined {
        const cleanBeforeContent = this.cleanReviewSnapshotText(beforeContent);
        const cleanAfterContent = this.cleanReviewSnapshotText(afterContent);
        const hasSnapshot = typeof cleanBeforeContent === 'string' && typeof cleanAfterContent === 'string';
        const unifiedDiff = this.cleanReviewDiffText(diff) || '';
        if (!hasSnapshot && unifiedDiff.trim().length === 0) {
            return undefined;
        }

        return {
            uri: URI.file(path || 'change'),
            added: typeof added === 'number' ? added : this.countReviewDiffLines(unifiedDiff, '+'),
            deleted: typeof deleted === 'number' ? deleted : this.countReviewDiffLines(unifiedDiff, '-'),
            diff: unifiedDiff,
            beforeContent: hasSnapshot ? cleanBeforeContent : '',
            afterContent: hasSnapshot ? cleanAfterContent : ''
        };
    }

    private cleanReviewSnapshotText(value: unknown): string | undefined {
        if (typeof value !== 'string') {
            return undefined;
        }
        return this.isTruncatedReviewSnapshotText(value) ? undefined : value;
    }

    private cleanReviewDiffText(value: unknown): string | undefined {
        const diff = this.cleanReviewSnapshotText(value);
        return typeof diff === 'string' && diff.trim().length > 0 ? diff : undefined;
    }

    private isTruncatedReviewSnapshotText(value: string): boolean {
        return /\n?\.{3}\[truncated \d+ chars\]\s*$/.test(value)
            || /\n?\.{3} \[truncated\]\s*$/.test(value)
            || /\n?\[truncated\]\s*$/.test(value);
    }

    private countReviewDiffLines(diff: string, prefix: '+' | '-'): number {
        const metadataPrefix = prefix === '+' ? '+++' : '---';
        return diff
            .split(/\r?\n/)
            .filter(line => line.startsWith(prefix) && !line.startsWith(metadataPrefix))
            .length;
    }

    private updateFileDeltaCounter(el: HTMLElement, blockId: string, kind: CleanSlateDeltaCounterKind, targetValue: number, isStreaming: boolean, forceRestart = false): void {
        const node = el.querySelector(`[data-delta-kind="${kind}"]`) as HTMLElement | null;
        const key = this.getFileDeltaCounterKey(blockId, kind);
        const previous = this.fileDeltaCounterStates.get(key);
        const target = Math.max(0, Math.floor(Number.isFinite(targetValue) ? targetValue : 0));
        const prefix = kind === 'added' ? '+' : '-';

        if (!node) {
            this.clearFileDeltaCounterState(key, el);
            return;
        }

        if (!isStreaming && !previous) {
            node.textContent = `${prefix}${target}`;
            return;
        }

        if (!forceRestart && previous?.target === target) {
            node.textContent = `${prefix}${previous.displayed}`;
            if (previous.frame !== undefined) {
                if (!isStreaming) {
                    previous.deleteWhenSettled = true;
                }
                return;
            }

            if (!isStreaming) {
                this.fileDeltaCounterStates.delete(key);
            }
            return;
        }

        const win = dom.getWindow(el);
        if (previous?.frame !== undefined) {
            (previous.cancelFrame ?? win.cancelAnimationFrame.bind(win))(previous.frame);
        }

        const from = previous?.displayed ?? 0;
        const distance = Math.abs(target - from);
        const state: ICleanSlateDeltaCounterState = {
            displayed: from,
            target,
            cancelFrame: win.cancelAnimationFrame.bind(win)
        };
        this.fileDeltaCounterStates.set(key, state);
        node.textContent = `${prefix}${from}`;

        if (distance === 0) {
            node.textContent = `${prefix}${target}`;
            state.displayed = target;
            if (!isStreaming) {
                this.fileDeltaCounterStates.delete(key);
            }
            return;
        }

        const duration = Math.min(1400, Math.max(420, distance * 20));
        const startedAt = win.performance.now();
        const step = (now: number): void => {
            const progress = Math.min(1, (now - startedAt) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = Math.round(from + (target - from) * eased);
            state.displayed = current;
            node.textContent = `${prefix}${current}`;

            if (progress < 1) {
                state.frame = win.requestAnimationFrame(step);
                return;
            }

            state.displayed = target;
            state.frame = undefined;
            node.textContent = `${prefix}${target}`;
            if (!isStreaming || state.deleteWhenSettled) {
                this.fileDeltaCounterStates.delete(key);
            }
        };

        state.frame = win.requestAnimationFrame(step);
    }

    public clearFileDeltaCounterStatesForBlock(blockId: string): void {
        this.clearFileDeltaCounterState(this.getFileDeltaCounterKey(blockId, 'added'));
        this.clearFileDeltaCounterState(this.getFileDeltaCounterKey(blockId, 'deleted'));
    }

    private clearFileDeltaCounterState(key: string, el?: HTMLElement): void {
        const state = this.fileDeltaCounterStates.get(key);
        if (!state) {
            return;
        }
        if (state.frame !== undefined) {
            (state.cancelFrame ?? (el ? dom.getWindow(el).cancelAnimationFrame.bind(dom.getWindow(el)) : undefined))?.(state.frame);
        }
        this.fileDeltaCounterStates.delete(key);
    }

    private getFileDeltaCounterKey(blockId: string, kind: CleanSlateDeltaCounterKind): string {
        return `${blockId}:${kind}`;
    }

    private escapeHtml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /** Escape + strip control/invisible characters + clamp — for labels built from model-controlled strings. */
    private sanitizeActivityLabel(value: string, maxLength: number): string {
        // eslint-disable-next-line no-control-regex
        const cleaned = value.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim();
        const clamped = cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}\u2026` : cleaned;
        return this.escapeHtml(clamped);
    }
}
