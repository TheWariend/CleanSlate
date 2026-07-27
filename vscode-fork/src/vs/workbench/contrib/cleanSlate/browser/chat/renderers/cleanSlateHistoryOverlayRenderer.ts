/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../base/browser/dom.js';
import { localize } from '../../../../../../nls.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { IContextViewService } from '../../../../../../platform/contextview/browser/contextView.js';
import { ICleanSlateSessionSnapshot } from '../types/cleanSlateChatSessionTypes.js';

export interface ICleanSlateHistoryOverlayData {
    activeSessionId: string | undefined;
    sessions: readonly ICleanSlateSessionSnapshot[];
    workspaceName: string;
}

export interface ICleanSlateHistoryOverlayActions {
    onRestore(session: ICleanSlateSessionSnapshot): void;
    onRemove(sessionId: string): void;
    onResume?(session: ICleanSlateSessionSnapshot): void;
    onRerun?(session: ICleanSlateSessionSnapshot): void;
}

export class CleanSlateHistoryOverlayRenderer {
    private historyOverlay: HTMLElement | undefined;
    private historySearchInput: HTMLInputElement | undefined;
    private historyList: HTMLElement | undefined;
    private data: ICleanSlateHistoryOverlayData | undefined;
    private actions: ICleanSlateHistoryOverlayActions | undefined;

    constructor(private readonly contextViewService: IContextViewService) { }

    show(anchorContainer: HTMLElement, data: ICleanSlateHistoryOverlayData, actions: ICleanSlateHistoryOverlayActions): void {
        this.data = data;
        this.actions = actions;

        const anchorRect = anchorContainer.getBoundingClientRect();
        const initialWidth = Math.min(420, anchorRect.width - 24);

        this.contextViewService.showContextView({
            render: (container: HTMLElement) => {
                const overlayDisposables = new DisposableStore();

                this.historyOverlay = dom.append(container, dom.$('.cleanSlate-history-overlay'));
                this.historyOverlay.classList.add('visible');
                this.historyOverlay.style.width = `${initialWidth}px`;
                this.historyOverlay.style.maxWidth = 'calc(100vw - 24px)';

                const header = dom.append(this.historyOverlay, dom.$('.cleanSlate-history-header'));
                const searchContainer = dom.append(header, dom.$('.cleanSlate-history-search-container'));
                dom.append(searchContainer, dom.$('i.codicon.codicon-search'));

                this.historySearchInput = dom.append(searchContainer, dom.$('input.cleanSlate-history-search')) as HTMLInputElement;
                this.historySearchInput.type = 'text';
                this.historySearchInput.placeholder = localize('cleanSlate.historySearchPlaceholder', 'Search Agents...');

                this.historyList = dom.append(this.historyOverlay, dom.$('.cleanSlate-history-list'));

                overlayDisposables.add(dom.addDisposableListener(this.historySearchInput, 'input', () => this.renderList()));
                overlayDisposables.add(dom.addDisposableListener(this.historySearchInput, 'keydown', (event: KeyboardEvent) => {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        this.hide();
                    }
                }));
                overlayDisposables.add(dom.addDisposableListener(document, 'mousedown', (event: MouseEvent) => {
                    const target = event.target as HTMLElement;
                    if (target.closest('.codicon-plus, .codicon-add')) {
                        return;
                    }
                    if (this.historyOverlay && !this.historyOverlay.contains(target) && !target.closest('.codicon-history')) {
                        this.hide();
                    }
                }));

                this.renderList();
                setTimeout(() => this.historySearchInput?.focus(), 0);

                return overlayDisposables;
            },
            getAnchor: () => {
                const window = dom.getWindow(anchorContainer);
                const currentAnchorRect = anchorContainer.getBoundingClientRect();
                const width = Math.min(420, currentAnchorRect.width - 24);
                const x = Math.min(
                    Math.max(currentAnchorRect.left + (currentAnchorRect.width - width) / 2, 12),
                    Math.max(12, window.innerWidth - width - 12)
                );
                const y = Math.min(Math.max(currentAnchorRect.top + 8, 44), Math.max(44, window.innerHeight - 320));
                return { x: Math.round(x), y: Math.round(y) };
            },
            onHide: () => {
                this.historyOverlay = undefined;
                this.historySearchInput = undefined;
                this.historyList = undefined;
            }
        });
    }

    refresh(data: ICleanSlateHistoryOverlayData): void {
        this.data = data;
        this.renderList();
    }

    isVisible(): boolean {
        return !!this.historyOverlay;
    }

    hide(): void {
        this.contextViewService.hideContextView();
    }

    private renderList(): void {
        if (!this.historyList || !this.data || !this.actions) {
            return;
        }

        const filter = this.historySearchInput?.value.trim().toLowerCase() ?? '';
        const olderItems = this.data.sessions.filter(session => this.matchesFilter(session, filter));

        dom.clearNode(this.historyList);
        this.appendSection(localize('cleanSlate.history.older', 'Older'), olderItems);

        if (!olderItems.length) {
            dom.append(this.historyList, dom.$('.cleanSlate-history-empty')).textContent =
                localize('cleanSlate.historyEmpty', 'No conversations match your search.');
        }
    }

    private appendSection(label: string, sessions: readonly ICleanSlateSessionSnapshot[]): void {
        if (!sessions.length || !this.historyList || !this.actions) {
            return;
        }

        const section = dom.append(this.historyList, dom.$('.cleanSlate-history-section'));
        dom.append(section, dom.$('.cleanSlate-history-section-title')).textContent = label;

        for (const session of sessions) {
            this.appendSessionRow(section, session, this.isCurrentSession(session));
        }
    }

    private appendSessionRow(section: HTMLElement, session: ICleanSlateSessionSnapshot, isCurrentSection: boolean): void {
        if (!this.actions) {
            return;
        }

        const isRunning = this.isRunningSession(session);
        const row = dom.append(section, dom.$('.cleanSlate-history-item'));
        if (isCurrentSection) {
            row.classList.add('active');
        }
        if (isRunning) {
            row.classList.add('running');
        }

        const activeIndicator = dom.append(row, dom.$('.cleanSlate-history-active-indicator'));
        if (isRunning) {
            dom.append(activeIndicator, dom.$('i.codicon.codicon-loading.codicon-modifier-spin'));
        } else if (isCurrentSection) {
            dom.append(activeIndicator, dom.$('i.codicon.codicon-check'));
        } else {
            dom.append(activeIndicator, dom.$('i.codicon.codicon-history'));
        }

        const leftGroup = dom.append(row, dom.$('.cleanSlate-history-item-left'));
        dom.append(leftGroup, dom.$('.cleanSlate-history-item-title')).textContent = session.title;
        const contextLabel = this.getSessionContextLabel(session);
        if (contextLabel) {
            dom.append(leftGroup, dom.$('.cleanSlate-history-item-context')).textContent = contextLabel;
        }

        const rightGroup = dom.append(row, dom.$('.cleanSlate-history-item-right'));
        if (!isCurrentSection) {
            const deleteBtn = dom.append(rightGroup, dom.$('.cleanSlate-history-delete-btn'));
            dom.append(deleteBtn, dom.$('i.codicon.codicon-trash'));

            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                this.actions?.onRemove(session.id);
                this.renderList();
            };
        }

        row.onclick = () => {
            if (isCurrentSection) {
                this.hide();
                return;
            }

            this.actions?.onRestore(session);
        };
    }

    private isCurrentSession(session: ICleanSlateSessionSnapshot): boolean {
        return !!this.data?.activeSessionId && session.id === this.data.activeSessionId;
    }

    private matchesFilter(session: ICleanSlateSessionSnapshot, filter: string): boolean {
        if (!filter) {
            return true;
        }

        let lastNonUserMessage = '';
        for (let i = session.history.length - 1; i >= 0; i--) {
            if (session.history[i].role !== 'user') {
                lastNonUserMessage = session.history[i].content;
                break;
            }
        }

        const haystack = [
            session.title,
            session.workspaceName ?? this.data?.workspaceName ?? '',
            session.taskState?.objective ?? '',
            ...(session.taskState?.runLedger ?? []).flatMap(run => [
                run.objective ?? '',
                run.lastSummary ?? '',
                run.currentWorkItem ?? ''
            ]),
            session.history.find(message => message.role === 'user')?.content ?? '',
            lastNonUserMessage
        ].join(' ').toLowerCase();

        return haystack.includes(filter);
    }

    private isRunningSession(session: ICleanSlateSessionSnapshot): boolean {
        return session.isGenerating === true;
    }

    private getSessionContextLabel(session: ICleanSlateSessionSnapshot): string {
        return session.workspaceName || this.data?.workspaceName || '';
    }

}
