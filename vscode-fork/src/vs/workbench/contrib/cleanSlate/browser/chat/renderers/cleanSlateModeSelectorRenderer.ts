/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../base/browser/dom.js';
import { IDisposable } from '../../../../../../base/common/lifecycle.js';
import { CleanSlateReasoningLevel, formatCleanSlateReasoningLevel } from '../../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { CleanSlateChatSettingsProvider } from '../providers/cleanSlateChatSettingsProvider.js';
import { CleanSlateChatModelProvider } from '../providers/cleanSlateChatModelProvider.js';

export interface AgentChoice {
    configId: string;
    name: string;
    current: string;
    options: readonly { value: string; name: string; description?: string }[];
}

export function isFastModeControl(control: AgentChoice): boolean {
    return /^(fast[-_ ]mode)$/i.test(control.configId) && control.options.length === 2
        && control.options.some(option => option.value === 'on') && control.options.some(option => option.value === 'off');
}

export class CleanSlateReasoningSelectorRenderer {
    private overlay: HTMLElement | undefined;
    private outsideClickListener: IDisposable | undefined;
    private fastMode: { control: AgentChoice; select: (value: string) => Promise<void> } | undefined;

    constructor(
        private readonly settingsProvider: CleanSlateChatSettingsProvider,
        private readonly modelProvider: CleanSlateChatModelProvider
    ) { }

    toggle(container: HTMLElement, anchor: HTMLElement): void {
        this.fastMode = undefined;
        if (this.overlay) {
            this.hide();
            return;
        }

        this.show(container, anchor);
    }

	toggleChoices(container: HTMLElement, anchor: HTMLElement, choices: { name: string; current: string; options: readonly { value: string; name: string }[] }, select: (value: string) => Promise<void>): void {
		if (this.overlay) { this.hide(); return; }
		this.show(container, anchor, { ...choices, select });
	}

    toggleAgentChoices(container: HTMLElement, anchor: HTMLElement, control: AgentChoice, controls: readonly AgentChoice[], select: (configId: string, value: string) => Promise<void>): void {
        const fast = controls.find(isFastModeControl);
        this.fastMode = fast ? { control: fast, select: value => select(fast.configId, value) } : undefined;
        this.toggleChoices(container, anchor, control, value => select(control.configId, value));
    }

    hide(): void {
        this.overlay?.remove();
        this.overlay = undefined;
        this.outsideClickListener?.dispose();
        this.outsideClickListener = undefined;
    }

    private show(container: HTMLElement, anchor: HTMLElement, choices?: { name: string; current: string; options: readonly { value: string; name: string }[]; select: (value: string) => Promise<void> }): void {
        const state = this.settingsProvider.getState();
        const reasoningState = this.modelProvider.getReasoningSelectorState();
        const enabledOptions = choices?.options ?? reasoningState.options.filter(option => option.enabled).map(option => ({ value: option.level, name: formatCleanSlateReasoningLevel(option.level) }));
        const supportsReasoningEffort = choices ? enabledOptions.length > 0 : enabledOptions.some(option => option.value !== 'none');
        const activeIndex = Math.max(0, enabledOptions.findIndex(option => option.value === (choices?.current ?? state.reasoningLevel)));
        const overlay = dom.append(container, dom.$('.cleanSlate-mode-selector-overlay.cleanSlate-reasoning-effort-overlay'));
        this.overlay = overlay;
        overlay.classList.toggle('is-unavailable', !supportsReasoningEffort);

        const header = dom.append(overlay, dom.$('.reasoning-effort-header'));
        const heading = dom.append(header, dom.$('.reasoning-effort-heading'));
        dom.append(heading, dom.$('span')).textContent = choices?.name ?? 'Reasoning effort';
        const selectedLabel = dom.append(heading, dom.$('span.reasoning-effort-value'));
        const fast = this.fastMode;
        if (fast) {
            const button = dom.append(header, dom.$('button.reasoning-effort-icon.codicon.codicon-zap')) as HTMLButtonElement;
            button.type = 'button';
            const update = () => {
                const option = fast.control.options.find(option => option.value === fast.control.current);
                button.title = `${fast.control.name}: ${option?.name ?? fast.control.current}${option?.description ? ` · ${option.description}` : ''}`;
                button.setAttribute('aria-label', button.title);
                button.setAttribute('aria-pressed', String(fast.control.current === 'on'));
            };
            update();
            button.onclick = async () => {
                const index = fast.control.options.findIndex(option => option.value === fast.control.current);
                const next = fast.control.options[(index + 1) % fast.control.options.length];
                button.disabled = true;
                try {
                    await fast.select(next.value);
                    fast.control = { ...fast.control, current: next.value };
                    overlay.querySelector('.reasoning-error')?.remove();
                    update();
                } catch (error) {
                    let status = overlay.querySelector<HTMLElement>('.reasoning-error');
                    if (!status) { status = dom.append(overlay, dom.$('div.reasoning-error')); status.setAttribute('role', 'status'); }
                    status.textContent = error instanceof Error ? error.message : 'Unable to change fast mode.';
                } finally { button.disabled = false; }
            };
        }

        const sliderShell = dom.append(overlay, dom.$('.reasoning-effort-slider-shell'));
        const track = dom.append(sliderShell, dom.$('.reasoning-effort-track'));
        dom.append(track, dom.$('.reasoning-effort-track-fill'));
        const ticks = dom.append(track, dom.$('.reasoning-effort-ticks'));
        for (const option of enabledOptions) {
            const tick = dom.append(ticks, dom.$('span.reasoning-effort-tick'));
            tick.title = option.name;
        }

        const slider = dom.append(sliderShell, dom.$('input.reasoning-effort-slider')) as HTMLInputElement;
        slider.type = 'range';
        slider.min = '0';
        slider.max = String(Math.max(0, enabledOptions.length - 1));
        slider.step = '1';
        slider.value = String(activeIndex);
        slider.disabled = !supportsReasoningEffort || enabledOptions.length <= 1;
        slider.setAttribute('aria-label', choices?.name ?? `Reasoning effort for ${reasoningState.model ?? 'selected model'}`);

        const updateSliderPresentation = (index: number): string | undefined => {
            const option = enabledOptions[Math.max(0, Math.min(index, enabledOptions.length - 1))];
            if (!option) {
                selectedLabel.textContent = 'Unavailable';
                overlay.style.setProperty('--cleanSlate-reasoning-fill', '0%');
                slider.setAttribute('aria-valuetext', 'Unavailable');
                return undefined;
            }
            const label = option.name;
            const percent = enabledOptions.length <= 1 ? 0 : (enabledOptions.indexOf(option) / (enabledOptions.length - 1)) * 100;
            selectedLabel.textContent = label;
            overlay.style.setProperty('--cleanSlate-reasoning-fill', `${percent}%`);
            slider.setAttribute('aria-valuetext', label);
            overlay.title = `${choices?.name ?? reasoningState.model ?? 'Selected model'} · ${label}`;
            return option.value;
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
        let committedIndex = activeIndex;
        slider.onchange = async () => {
            const level = updateSliderPresentation(Number(slider.value));
            if (level !== undefined) {
				slider.disabled = true;
				try {
					if (choices) { await choices.select(level); }
					else { await this.settingsProvider.updateReasoningLevel(level as CleanSlateReasoningLevel); }
					committedIndex = Number(slider.value);
				} catch (error) {
					slider.value = String(committedIndex);
					updateSliderPresentation(committedIndex);
					let status = overlay.querySelector<HTMLElement>('.reasoning-error');
					if (!status) { status = dom.append(overlay, dom.$('div.reasoning-error')); status.setAttribute('role', 'status'); }
					status.textContent = error instanceof Error ? error.message : 'Unable to change reasoning effort.';
				} finally { slider.disabled = !supportsReasoningEffort || enabledOptions.length <= 1; }
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
