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

import { isFullAccessMode, renderApprovalIcon } from './cleanSlateApprovalIcons.js';

/**
 * Dropup listing approval modes supported by hosted execution.
 * Selecting an option persists it through the settings provider.
 */
export class CleanSlateEditModeSelectorRenderer {
    private overlay: HTMLElement | undefined;
    private outsideClickListener: IDisposable | undefined;

    constructor(private readonly settingsProvider: CleanSlateChatSettingsProvider) { }

	toggleChoices(container: HTMLElement, anchor: HTMLElement, choices: { name: string; current: string; options: readonly { value: string; name: string; description?: string; kind?: string }[] }, select: (value: string) => Promise<void>): void {
		if (this.overlay) { this.hide(); return; }
		this.show(container, anchor, { ...choices, select });
	}

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

    private show(container: HTMLElement, anchor: HTMLElement, choices?: { name: string; current: string; options: readonly { value: string; name: string; description?: string; kind?: string }[]; select: (value: string) => Promise<void> }): void {
        const configuredMode = this.settingsProvider.getState().editMode;
        // Hosted file edits do not yet participate in the editor pending-edit service.
        // Preserve legacy Manual command approvals without advertising file review.
        const currentMode = choices?.current ?? (configuredMode === 'manual' ? 'accept-edits' : configuredMode);
        const overlay = dom.append(container, dom.$('.cleanSlate-mode-selector-overlay.cleanSlate-edit-mode-overlay'));
        this.overlay = overlay;

        const header = dom.append(overlay, dom.$('.edit-mode-header'));
        const heading = dom.append(header, dom.$('.edit-mode-heading'));
        dom.append(heading, dom.$('span')).textContent = choices?.name ?? 'Approval mode';

        for (const entry of choices?.options ?? CLEANSLATE_EDIT_MODES.filter(mode => mode !== 'manual').map(mode => ({ value: mode, name: formatCleanSlateEditMode(mode), description: getCleanSlateEditModeDescription(mode) }))) {
			const mode = entry.value;
            const option = dom.append(overlay, dom.$('button.edit-mode-option')) as HTMLButtonElement;
            option.type = 'button';
			const kind = choices ? ('kind' in entry ? entry.kind : undefined) : mode === 'auto' ? 'automatic-review' : 'approval-required';
			option.classList.toggle('full-access', isFullAccessMode(kind ?? ''));
            option.classList.toggle('selected', mode === currentMode);
            option.setAttribute('aria-pressed', mode === currentMode ? 'true' : 'false');
			const icon = dom.append(option, dom.$('span'));
			renderApprovalIcon(icon, kind);
			icon.setAttribute('aria-hidden', 'true');
			icon.style.cssText = 'font-size:16px;flex:0 0 18px;margin-top:2px;color:inherit';

            const textColumn = dom.append(option, dom.$('.edit-mode-option-text'));
            dom.append(textColumn, dom.$('.edit-mode-option-label')).textContent = entry.name;
            if (entry.description) { dom.append(textColumn, dom.$('.edit-mode-option-description')).textContent = entry.description; }
            if (mode === currentMode) {
                dom.append(option, dom.$('i.codicon.codicon-check.edit-mode-option-check'));
            }

            option.onclick = async () => {
				option.disabled = true;
				try {
					if (choices) { await choices.select(mode); } else { await this.settingsProvider.updateEditMode(mode as CleanSlateEditMode); }
					this.hide();
				} catch (error) {
					let status = overlay.querySelector<HTMLElement>('.edit-mode-error');
					if (!status) { status = dom.append(overlay, dom.$('.edit-mode-error')); status.setAttribute('role', 'status'); }
					status.textContent = error instanceof Error ? error.message : 'Unable to change setting.';
				} finally { option.disabled = false; }
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
            360,
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
