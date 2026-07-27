/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../base/browser/dom.js';
import { IDisposable } from '../../../../../../base/common/lifecycle.js';
import { CleanSlateReasoningLevel, formatCleanSlateReasoningLevel } from '../../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { CleanSlateChatSettingsProvider } from '../providers/cleanSlateChatSettingsProvider.js';
import { CleanSlateChatModelProvider } from '../providers/cleanSlateChatModelProvider.js';

export class CleanSlateReasoningSelectorRenderer {
    private overlay: HTMLElement | undefined;
    private outsideClickListener: IDisposable | undefined;

    constructor(
        private readonly settingsProvider: CleanSlateChatSettingsProvider,
        private readonly modelProvider: CleanSlateChatModelProvider
    ) { }

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
        const state = this.settingsProvider.getState();
        const reasoningState = this.modelProvider.getReasoningSelectorState();
        const enabledOptions = reasoningState.options.filter(option => option.enabled);
        const supportsReasoningEffort = enabledOptions.some(option => option.level !== 'none');
        const activeIndex = Math.max(0, enabledOptions.findIndex(option => option.level === state.reasoningLevel));
        const overlay = dom.append(container, dom.$('.cleanSlate-mode-selector-overlay.cleanSlate-reasoning-effort-overlay'));
        this.overlay = overlay;
        overlay.classList.toggle('is-unavailable', !supportsReasoningEffort);

        const header = dom.append(overlay, dom.$('.reasoning-effort-header'));
        const heading = dom.append(header, dom.$('.reasoning-effort-heading'));
        dom.append(heading, dom.$('span')).textContent = 'Reasoning effort';
        const selectedLabel = dom.append(heading, dom.$('span.reasoning-effort-value'));
        dom.append(header, dom.$('i.codicon.codicon-zap.reasoning-effort-icon'));

        const sliderShell = dom.append(overlay, dom.$('.reasoning-effort-slider-shell'));
        const track = dom.append(sliderShell, dom.$('.reasoning-effort-track'));
        dom.append(track, dom.$('.reasoning-effort-track-fill'));
        const ticks = dom.append(track, dom.$('.reasoning-effort-ticks'));
        for (const option of enabledOptions) {
            const tick = dom.append(ticks, dom.$('span.reasoning-effort-tick'));
            tick.title = formatCleanSlateReasoningLevel(option.level);
        }

        const slider = dom.append(sliderShell, dom.$('input.reasoning-effort-slider')) as HTMLInputElement;
        slider.type = 'range';
        slider.min = '0';
        slider.max = String(Math.max(0, enabledOptions.length - 1));
        slider.step = '1';
        slider.value = String(activeIndex);
        slider.disabled = !supportsReasoningEffort || enabledOptions.length <= 1;
        slider.setAttribute('aria-label', `Reasoning effort for ${reasoningState.model ?? 'selected model'}`);

        const updateSliderPresentation = (index: number): CleanSlateReasoningLevel | undefined => {
            const option = enabledOptions[Math.max(0, Math.min(index, enabledOptions.length - 1))];
            if (!option) {
                selectedLabel.textContent = 'Unavailable';
                overlay.style.setProperty('--cleanSlate-reasoning-fill', '0%');
                slider.setAttribute('aria-valuetext', 'Unavailable');
                return undefined;
            }
            const label = formatCleanSlateReasoningLevel(option.level);
            const percent = enabledOptions.length <= 1 ? 0 : (enabledOptions.indexOf(option) / (enabledOptions.length - 1)) * 100;
            selectedLabel.textContent = label;
            overlay.style.setProperty('--cleanSlate-reasoning-fill', `${percent}%`);
            slider.setAttribute('aria-valuetext', label);
            overlay.title = `${reasoningState.model ?? 'Selected model'} · ${label}`;
            return option.level;
        };

        updateSliderPresentation(activeIndex);
        if (!supportsReasoningEffort) {
            selectedLabel.textContent = 'Not supported';
            slider.setAttribute('aria-valuetext', 'Reasoning effort is not supported');
            overlay.title = `${reasoningState.model ?? 'Selected model'} does not support reasoning effort`;

            const showUnavailableFeedback = () => {
                overlay.classList.remove('show-unavailable-feedback');
                void overlay.offsetWidth;
                overlay.classList.add('show-unavailable-feedback');
            };
            sliderShell.onclick = (event) => {
                event.preventDefault();
                showUnavailableFeedback();
            };
            window.requestAnimationFrame(showUnavailableFeedback);
        }
        slider.oninput = () => {
            updateSliderPresentation(Number(slider.value));
        };
        slider.onchange = async () => {
            const level = updateSliderPresentation(Number(slider.value));
            if (level) {
                await this.settingsProvider.updateReasoningLevel(level);
            }
        };

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
            236,
            Math.max(196, containerRect.width - (margin * 2)),
            Math.max(196, window.innerWidth - (margin * 2))
        );
        overlay.style.width = `${Math.round(width)}px`;

        const anchorRect = anchor.getBoundingClientRect();
        const overlayRect = overlay.getBoundingClientRect();
        const measuredWidth = overlayRect.width || width;
        const height = overlayRect.height || 92;
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
