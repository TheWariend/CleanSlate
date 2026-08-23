/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../base/browser/dom.js';
import { IDisposable } from '../../../../../../base/common/lifecycle.js';
import { CLEANSLATE_EDIT_MODES } from '@cleanslate/sdk/protocol/cleanSlateAI.js';
import { formatCleanSlateEditMode } from '@cleanslate/sdk/protocol/cleanSlateAI.js';
import { getCleanSlateEditModeDescription } from '@cleanslate/sdk/protocol/cleanSlateAI.js';
import type { CleanSlateEditMode } from '@cleanslate/sdk/protocol/cleanSlateAI.js';
import { CleanSlateChatSettingsProvider } from '../providers/cleanSlateChatSettingsProvider.js';

/**
 * Dropup listing the approval modes: Manual, Accept edits and Auto.
 * Selecting an option persists it through the settings provider.
 */
export class CleanSlateEditModeSelectorRenderer {
    private overlay: HTMLElement | undefined;
    private outsideClickListener: IDisposable | undefined;

    constructor(private readonly settingsProvider: CleanSlateChatSettingsProvider) { }

    toggle(container: HTMLElement, anchor: HTMLElement): void {
        if (this.overlay) {
            this.hide();
            return;
        }

        this.show(container, anchor);
    }

    hide(): void {
        this.overlay?.remove();
        this.overlay = undefined;
        this.outsideClickListener?.dispose();
        this.outsideClickListener = undefined;
    }

    private show(container: HTMLElement, anchor: HTMLElement): void {
        const currentMode = this.settingsProvider.getState().editMode;
        const overlay = dom.append(container, dom.$('.cleanSlate-mode-selector-overlay.cleanSlate-edit-mode-overlay'));
        this.overlay = overlay;

        const header = dom.append(overlay, dom.$('.edit-mode-header'));
        const heading = dom.append(header, dom.$('.edit-mode-heading'));
        dom.append(heading, dom.$('span')).textContent = 'Approval mode';

        for (const mode of CLEANSLATE_EDIT_MODES) {
            const option = dom.append(overlay, dom.$('button.edit-mode-option')) as HTMLButtonElement;
            option.type = 'button';
            option.classList.toggle('selected', mode === currentMode);
            option.setAttribute('aria-pressed', mode === currentMode ? 'true' : 'false');

            const textColumn = dom.append(option, dom.$('.edit-mode-option-text'));
            dom.append(textColumn, dom.$('.edit-mode-option-label')).textContent = formatCleanSlateEditMode(mode);
            dom.append(textColumn, dom.$('.edit-mode-option-description')).textContent = getCleanSlateEditModeDescription(mode);
            if (mode === currentMode) {
                dom.append(option, dom.$('i.codicon.codicon-check.edit-mode-option-check'));
            }

            option.onclick = () => {
                void this.settingsProvider.updateEditMode(mode as CleanSlateEditMode);
                this.hide();
            };
        }

        this.positionOverlay(overlay, anchor, container);

        this.outsideClickListener?.dispose();
        this.outsideClickListener = dom.addDisposableListener(document, 'mousedown', (event) => {
            if (!this.overlay?.contains(event.target as Node) && !anchor.contains(event.target as Node)) {
                this.hide();
            }
        });
    }

    private positionOverlay(overlay: HTMLElement, anchor: HTMLElement, container: HTMLElement): void {
        const containerRect = container.getBoundingClientRect();
        const margin = 10;
        const width = Math.min(
            260,
            Math.max(220, containerRect.width - (margin * 2)),
            Math.max(220, window.innerWidth - (margin * 2))
        );
        overlay.style.width = `${Math.round(width)}px`;

        const anchorRect = anchor.getBoundingClientRect();
        const overlayRect = overlay.getBoundingClientRect();
        const measuredWidth = overlayRect.width || width;
        const height = overlayRect.height || 150;
        const minLeft = Math.max(margin, containerRect.left + margin);
        const maxLeft = Math.min(
            window.innerWidth - measuredWidth - margin,
            containerRect.right - measuredWidth - margin
        );
        const preferredLeft = anchorRect.left + (anchorRect.width / 2) - (measuredWidth / 2);
        const left = Math.min(
            Math.max(preferredLeft, minLeft),
            Math.max(minLeft, maxLeft)
        );
        const preferredTop = anchorRect.top - height - 10;
        const top = preferredTop >= margin
            ? preferredTop
            : Math.min(anchorRect.bottom + 10, Math.max(margin, window.innerHeight - height - margin));

        overlay.style.left = `${Math.round(left)}px`;
        overlay.style.top = `${Math.round(top)}px`;
    }
}
