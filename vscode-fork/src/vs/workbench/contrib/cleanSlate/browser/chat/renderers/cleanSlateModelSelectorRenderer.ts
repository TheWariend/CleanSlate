/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../base/browser/dom.js';
import { IDisposable } from '../../../../../../base/common/lifecycle.js';
import { AIProvider } from '../../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { CleanSlateChatModelProvider } from '../providers/cleanSlateChatModelProvider.js';
import { setCleanSlateProviderLogo } from '../providers/cleanSlateProviderLogos.js';
import { createCleanSlateActionButton } from '../../cleanSlateActionButton.js';

export class CleanSlateModelSelectorRenderer {
    private overlay: HTMLElement | undefined;
    private outsideClickListener: IDisposable | undefined;

    constructor(
        private readonly modelProvider: CleanSlateChatModelProvider,
        private readonly openSettings: () => void,
        private readonly upgradeToPro?: () => void
    ) { }

    async toggle(container: HTMLElement, anchor: HTMLElement): Promise<void> {
        if (this.overlay) {
            this.hide();
            return;
        }

        await this.show(container, anchor);
    }

    hide(): void {
        this.overlay?.remove();
        this.overlay = undefined;
        this.outsideClickListener?.dispose();
        this.outsideClickListener = undefined;
    }

    private async show(container: HTMLElement, anchor: HTMLElement): Promise<void> {
        const state = this.modelProvider.getState();
        const overlay = dom.append(container, dom.$('.cleanSlate-model-selector-overlay'));
        // Keep the overlay invisible until the async model fetch completes and it
        // has been positioned, otherwise it flashes unpositioned at the top-left.
        overlay.style.visibility = 'hidden';
        this.overlay = overlay;

        const providerRow = dom.append(overlay, dom.$('.selector-row'));
        dom.append(providerRow, dom.$('span')).textContent = 'Provider';
        const providerButton = dom.append(providerRow, dom.$('button.cleanSlate-provider-select')) as HTMLButtonElement;
        providerButton.type = 'button';
        providerButton.setAttribute('aria-haspopup', 'listbox');
        const providerLabel = dom.append(providerButton, dom.$('span.cleanSlate-provider-select-label'));
        providerLabel.textContent = this.formatProviderLabel(state.provider);
        dom.append(providerButton, dom.$('span.cleanSlate-provider-select-chevron.codicon.codicon-chevron-down'));

        let currentProvider = state.provider as AIProvider;
        let showingProviders = false;

        const modelListContainer = dom.append(overlay, dom.$('.model-list-container'));

        const renderList = async (provider: AIProvider) => {
            dom.clearNode(modelListContainer);
            modelListContainer.classList.remove('status');
            const selectorState = await this.modelProvider.getSelectorState(provider);
            if (this.overlay !== overlay) {
                return;
            }

            if (!selectorState.configured) {
                const requiresUpgrade = selectorState.configAction === 'upgrade';
                modelListContainer.classList.add('status');
                const statusItem = dom.append(modelListContainer, dom.$('.model-status-item'));
                dom.append(statusItem, dom.$(requiresUpgrade ? '.model-status-icon.codicon.codicon-sparkle-filled' : '.model-status-icon.codicon.codicon-warning'));
                dom.append(statusItem, dom.$('.model-status-title')).textContent = requiresUpgrade ? 'CleanSlate Pro Required' : 'Configuration Required';
                dom.append(statusItem, dom.$('.model-status-description')).textContent = selectorState.configMessage || 'Provider configuration is missing.';

                if (requiresUpgrade) {
                    createCleanSlateActionButton(statusItem, {
                        label: 'Upgrade to Pro',
                        action: this.upgradeToPro,
                        variant: 'primary',
                        leadingIcon: 'arrow-circle-up',
                        afterAction: () => this.hide()
                    });
                } else {
                    const button = dom.append(statusItem, dom.$('button.settings-button')) as HTMLButtonElement;
                    button.type = 'button';
                    button.textContent = 'Open Settings';
                    button.onclick = () => {
                        this.openSettings();
                        this.hide();
                    };
                }
                return;
            }

            if (selectorState.errorMessage) {
                const statusItem = dom.append(modelListContainer, dom.$('.model-status-item'));
                dom.append(statusItem, dom.$('.model-status-icon.codicon.codicon-warning'));
                dom.append(statusItem, dom.$('.model-status-title')).textContent = 'Model List Unavailable';
                dom.append(statusItem, dom.$('.model-status-description')).textContent = selectorState.errorMessage;

                if (!selectorState.models.length) {
                    return;
                }
            }

            if (!selectorState.models.length) {
                const statusItem = dom.append(modelListContainer, dom.$('.model-status-item'));
                dom.append(statusItem, dom.$('.model-status-icon.codicon.codicon-plug'));
                dom.append(statusItem, dom.$('.model-status-title')).textContent = 'No Models Found';
                dom.append(statusItem, dom.$('.model-status-description')).textContent = `We couldn't find any models for ${this.formatProviderLabel(provider)}.`;

                const button = dom.append(statusItem, dom.$('.settings-button'));
                button.textContent = 'Check Settings';
                button.onclick = () => {
                    this.openSettings();
                    this.hide();
                };
                return;
            }

            for (const model of selectorState.models) {
                const item = dom.append(modelListContainer, dom.$('.model-item'));
                let modelProviderLabel: string | undefined;
                if ((provider as string) === 'cleanslate') {
                    const logo = dom.append(item, dom.$('.model-item-provider-logo'));
                    modelProviderLabel = setCleanSlateProviderLogo(logo, provider, model);
                }
                dom.append(item, dom.$('.model-item-label')).textContent = this.formatModelItemLabel(provider, model);
                // Premium models are credits-only. This lock is presentation only —
                // the server rejects the request regardless of what the UI shows.
                const isCreditsLocked = !selectorState.hasCredits && (selectorState.creditsOnlyModels?.includes(model) ?? false);
                if (isCreditsLocked) {
                    item.classList.add('is-credits-locked');
                    const badge = dom.append(item, dom.$('.model-item-credits-badge'));
                    dom.append(badge, dom.$('span.codicon.codicon-lock'));
                    dom.append(badge, dom.$('span')).textContent = 'Credits';
                    item.title = `${model} — add usage credits to unlock`;
                    item.setAttribute('aria-disabled', 'true');
                } else {
                    item.title = model;
                }
                item.setAttribute('aria-label', modelProviderLabel ? `${modelProviderLabel}, ${model}` : model);
                if (model === selectorState.currentModel) {
                    item.classList.add('active');
                }

                item.onclick = async () => {
                    if (isCreditsLocked) {
                        return;
                    }
                    await this.modelProvider.updateModel(model);
                    this.hide();
                };
            }
        };

        const renderProviderList = () => {
            dom.clearNode(modelListContainer);
            for (const provider of this.modelProvider.getProviderOptions()) {
                const item = dom.append(modelListContainer, dom.$('.model-item'));
                dom.append(item, dom.$('.model-item-label')).textContent = this.formatProviderLabel(provider);
                if (provider === currentProvider) {
                    item.classList.add('active');
                }
                item.onclick = async () => {
                    currentProvider = provider;
                    providerLabel.textContent = this.formatProviderLabel(provider);
                    showingProviders = false;
                    providerButton.classList.remove('open');
                    await this.modelProvider.updateProvider(provider);
                    await renderList(provider);
                    if (this.overlay === overlay) {
                        this.positionOverlay(overlay, anchor, container);
                    }
                };
            }
            if (this.overlay === overlay) {
                this.positionOverlay(overlay, anchor, container);
            }
        };

        providerButton.onclick = () => {
            showingProviders = !showingProviders;
            providerButton.classList.toggle('open', showingProviders);
            if (showingProviders) {
                renderProviderList();
                return;
            }
            void renderList(currentProvider).then(() => {
                if (this.overlay === overlay) {
                    this.positionOverlay(overlay, anchor, container);
                }
            });
        };

        await renderList(state.provider);
        if (this.overlay !== overlay) {
            return;
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
            340,
            Math.max(220, containerRect.width - (margin * 2)),
            Math.max(220, window.innerWidth - (margin * 2))
        );
        overlay.style.width = `${Math.round(width)}px`;

        const anchorRect = anchor.getBoundingClientRect();
        const overlayRect = overlay.getBoundingClientRect();
        const measuredWidth = overlayRect.width || width;
        const height = overlayRect.height || 180;
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
        overlay.style.visibility = '';
    }

    private formatModelItemLabel(provider: AIProvider, model: string): string {
        if (provider !== 'bedrock') {
            return this.modelProvider.formatModelLabel(model);
        }

        const compact = model
            .replace(/^[a-z0-9_-]+\./i, '')
            .replace(/:[^:]+$/i, '')
            .replace(/-\d{8}(?=-|$)/g, '')
            .replace(/-/g, ' ')
            .replace(/\b(\d) (\d)\b/g, '$1.$2')
            .replace(/\b(v\d+)\b/gi, match => match.toLowerCase());

        return compact.charAt(0).toUpperCase() + compact.slice(1);
    }

    private formatProviderLabel(provider: AIProvider): string {
        if ((provider as string) === 'cleanslate') {
            // The managed provider is just "CleanSlate"; Free vs Pro is the plan,
            // shown in the usage panel — not baked into the provider name.
            return 'CleanSlate';
        }
        switch (provider) {
            case 'azureOpenAI':
                return 'Azure';
            case 'grok':
                return 'xAI Grok';
            case 'gemini':
                return 'Google Gemini';
            case 'bedrock':
                return 'AWS Bedrock';
            case 'anthropic':
                return 'Anthropic';
            case 'openai':
                return 'OpenAI';
            case 'nvidia':
                return 'NVIDIA NIM';
            case 'openrouter':
                return 'OpenRouter';
            case 'custom':
                return 'Custom API';
            default:
                return String(provider);
        }
    }
}
