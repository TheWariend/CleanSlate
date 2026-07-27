/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import type { IDisposable } from '../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import type { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import type { IMarkdownRendererService } from '../../../../../platform/markdown/browser/markdownRenderer.js';
import type { IArtifact } from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { CleanSlateReviewRenderer } from '../chat/renderers/cleanSlateReviewRenderer.js';
import type { CleanSlateReviewDisplayScopeMode, ICleanSlateReviewChange } from '../chat/renderers/cleanSlateReviewModel.js';
import type { ICleanSlateBrowserState } from '../core/cleanSlateBrowserAutomationService.js';
import type { CleanSlateAgentManagerRightTab } from './cleanSlateAgentManagerTypes.js';

export interface ICleanSlateAgentManagerRightPaneParts {
	readonly title: HTMLElement;
	readonly tabs: HTMLElement;
	readonly body: HTMLElement;
}

export interface ICleanSlateAgentManagerTabStripHandlers {
	readonly onSelect: (tab: CleanSlateAgentManagerRightTab) => void;
	readonly onCloseTab: (tab: CleanSlateAgentManagerRightTab) => void;
	readonly onAdd: () => void;
}

export interface ICleanSlateAgentManagerBrowserRenderOptions {
	readonly state: ICleanSlateBrowserState | undefined;
	readonly rightPaneVisible: boolean;
	readonly onBack: () => void;
	readonly onForward: () => void;
	readonly onReload: () => void;
	readonly onOpenAddress: (url: string) => void;
	readonly onToggleAnnotation: () => void;
	readonly onShowActions: (anchor: HTMLElement) => void;
	readonly onViewport: (viewport: HTMLElement) => void;
}

export interface ICleanSlateAgentManagerReviewRenderOptions {
	readonly pendingEdits: readonly ICleanSlateReviewChange[];
	readonly scopeMode: CleanSlateReviewDisplayScopeMode;
	readonly onScopeModeChange: (mode: CleanSlateReviewDisplayScopeMode) => void;
	readonly rootUris?: readonly URI[];
	readonly onAcceptAll: () => void;
	readonly onRejectAll: () => void;
}

export class CleanSlateAgentManagerRightPaneView {
	private readonly reviewRenderer = new CleanSlateReviewRenderer();

	constructor(
		private readonly markdownRenderer: IMarkdownRendererService,
		private readonly copyText: (text: string) => Promise<void>
	) { }

	build(parent: HTMLElement): ICleanSlateAgentManagerRightPaneParts {
		// No pane-level close button — the header's pane toggle already owns
		// opening/closing the right pane.
		const header = dom.append(parent, dom.$('.cleanSlate-agent-manager-right-header'));
		const headerMain = dom.append(header, dom.$('.cleanSlate-agent-manager-right-header-main'));
		const title = dom.append(headerMain, dom.$('.cleanSlate-agent-manager-right-title'));
		title.textContent = localize('cleanSlate.agentManager.rightPaneTitle', 'Workspace');
		const tabs = dom.append(headerMain, dom.$('.cleanSlate-agent-manager-right-tabs'));
		const body = dom.append(parent, dom.$('.cleanSlate-agent-manager-right-body'));
		return { title, tabs, body };
	}

	getTabPresentation(tab: CleanSlateAgentManagerRightTab): { readonly icon: ThemeIcon; readonly label: string } {
		switch (tab) {
			case 'review':
				return { icon: Codicon.diffMultiple, label: localize('cleanSlate.agentManager.reviewTab', 'Review') };
			case 'artifacts':
				return { icon: Codicon.files, label: localize('cleanSlate.agentManager.artifactsTab', 'Artifacts') };
			case 'browser':
				return { icon: Codicon.globe, label: localize('cleanSlate.agentManager.browserTab', 'Browser') };
			case 'file':
				return { icon: Codicon.file, label: localize('cleanSlate.agentManager.fileTab', 'File') };
			case 'terminal':
			default:
				return { icon: Codicon.terminal, label: localize('cleanSlate.agentManager.terminalTab', 'Terminal') };
		}
	}

	/** Tab strip: open surfaces render as closable pills, with "+" outside the launcher. */
	renderTabStrip(
		container: HTMLElement,
		openTabs: readonly CleanSlateAgentManagerRightTab[],
		activeTab: CleanSlateAgentManagerRightTab | undefined,
		handlers: ICleanSlateAgentManagerTabStripHandlers
	): void {
		dom.clearNode(container);
		for (const tab of openTabs) {
			const { icon, label } = this.getTabPresentation(tab);
			const button = dom.append(container, dom.$('button.cleanSlate-agent-manager-right-tab')) as HTMLButtonElement;
			button.type = 'button';
			button.title = label;
			button.setAttribute('aria-label', label);
			button.classList.toggle('active', tab === activeTab);
			button.setAttribute('aria-pressed', String(tab === activeTab));
			dom.append(button, dom.$(`span${ThemeIcon.asCSSSelector(icon)}`));
			dom.append(button, dom.$('span.cleanSlate-agent-manager-right-tab-label')).textContent = label;
			const close = dom.append(button, dom.$('span.cleanSlate-agent-manager-right-tab-close'));
			close.title = localize('cleanSlate.agentManager.closeTab', 'Close tab');
			close.setAttribute('role', 'button');
			close.setAttribute('aria-label', close.title);
			dom.append(close, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.close)}`));
			close.onclick = event => {
				event.preventDefault();
				event.stopPropagation();
				handlers.onCloseTab(tab);
			};
			button.onclick = () => handlers.onSelect(tab);
		}
		if (activeTab) {
			const add = dom.append(container, dom.$('button.cleanSlate-agent-manager-right-tab-add')) as HTMLButtonElement;
			add.type = 'button';
			add.title = localize('cleanSlate.agentManager.newRightTab', 'New tab');
			add.setAttribute('aria-label', add.title);
			dom.append(add, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.add)}`));
			add.onclick = () => handlers.onAdd();
		}
	}

	/** Empty-pane launcher: a vertically centered stack of surface rows. */
	renderLauncher(
		body: HTMLElement,
		tabs: readonly CleanSlateAgentManagerRightTab[],
		onSelect: (tab: CleanSlateAgentManagerRightTab) => void
	): void {
		dom.clearNode(body);
		const launcher = dom.append(body, dom.$('.cleanSlate-agent-manager-launcher'));
		for (const tab of tabs) {
			const { icon, label } = this.getTabPresentation(tab);
			const row = dom.append(launcher, dom.$('button.cleanSlate-agent-manager-launcher-row')) as HTMLButtonElement;
			row.type = 'button';
			row.setAttribute('aria-label', label);
			const iconBox = dom.append(row, dom.$('span.cleanSlate-agent-manager-launcher-icon'));
			dom.append(iconBox, dom.$(`span${ThemeIcon.asCSSSelector(icon)}`));
			dom.append(row, dom.$('span.cleanSlate-agent-manager-launcher-label')).textContent = label;
			row.onclick = () => onSelect(tab);
		}
	}

	renderBrowser(
		body: HTMLElement,
		title: HTMLElement,
		options: ICleanSlateAgentManagerBrowserRenderOptions
	): { readonly browserActive: boolean; readonly viewport?: HTMLElement } {
		const state = options.state;
		title.textContent = state?.title || state?.url || localize('cleanSlate.agentManager.browser', 'Browser');
		dom.clearNode(body);
		body.classList.remove('review', 'terminal');
		body.classList.add('browser');
		const shell = dom.append(body, dom.$('.cleanSlate-agent-manager-browser-shell'));
		const toolbar = dom.append(shell, dom.$('.cleanSlate-agent-manager-browser-toolbar'));
		if (!state) {
			const back = this.createBrowserButton(toolbar, Codicon.arrowLeft, localize('cleanSlate.agentManager.browserBack', 'Back'), options.onBack);
			back.disabled = true;
			const forward = this.createBrowserButton(toolbar, Codicon.arrowRight, localize('cleanSlate.agentManager.browserForward', 'Forward'), options.onForward);
			forward.disabled = true;
			const reload = this.createBrowserButton(toolbar, Codicon.refresh, localize('cleanSlate.agentManager.browserRefresh', 'Reload'), options.onReload);
			reload.disabled = true;
			const address = this.createAddress(toolbar, '', options.onOpenAddress);
			this.renderEmpty(
				shell,
				Codicon.globe,
				localize('cleanSlate.agentManager.browserEmptyTitle', 'Start browsing'),
				localize('cleanSlate.agentManager.browserEmptyDescription', 'Enter a URL to open a page')
			);
			address.focus();
			return { browserActive: false };
		}
		const back = this.createBrowserButton(toolbar, Codicon.arrowLeft, localize('cleanSlate.agentManager.browserBack', 'Back'), options.onBack);
		back.disabled = !state.canGoBack;
		const forward = this.createBrowserButton(toolbar, Codicon.arrowRight, localize('cleanSlate.agentManager.browserForward', 'Forward'), options.onForward);
		forward.disabled = !state.canGoForward;
		this.createBrowserButton(toolbar, Codicon.refresh, localize('cleanSlate.agentManager.browserRefresh', 'Reload'), options.onReload);
		this.createAddress(toolbar, state.url, options.onOpenAddress);
		this.createAnnotationToggle(toolbar, state, options.onToggleAnnotation);
		this.createBrowserButton(toolbar, Codicon.kebabVertical, localize('cleanSlate.agentManager.browserMore', 'Browser actions'), anchor => options.onShowActions(anchor));
		const viewport = dom.append(shell, dom.$('.cleanSlate-agent-manager-browser-viewport'));
		options.onViewport(viewport);
		return { browserActive: options.rightPaneVisible, viewport };
	}

	renderReview(
		body: HTMLElement,
		title: HTMLElement,
		options: ICleanSlateAgentManagerReviewRenderOptions
	): void {
		title.textContent = localize('cleanSlate.agentManager.review', 'Review');
		dom.clearNode(body);
		body.classList.remove('browser', 'terminal');
		body.classList.add('review');
		this.reviewRenderer.render(body, options.pendingEdits, {
			scopeMode: options.scopeMode,
			onScopeModeChange: options.onScopeModeChange,
			rootUris: options.rootUris
		});
		void options.onAcceptAll;
		void options.onRejectAll;
	}

	renderArtifact(
		body: HTMLElement,
		title: HTMLElement,
		artifact: IArtifact | undefined,
		getArtifactKindLabel: (artifact: IArtifact) => string,
		getArtifactFilename: (artifact: IArtifact) => string,
		disposables: { add<T extends IDisposable>(disposable: T): T }
	): void {
		body.classList.remove('browser', 'review', 'terminal');
		dom.clearNode(body);
		if (!artifact) {
			title.textContent = localize('cleanSlate.agentManager.artifacts', 'Artifacts');
			this.renderEmpty(
				body,
				Codicon.files,
				title.textContent,
				localize('cleanSlate.agentManager.artifactsEmptyDescription', 'Plans, analysis, walkthroughs, and research notes will appear here.')
			);
			return;
		}
		title.textContent = getArtifactFilename(artifact);
		const meta = dom.append(body, dom.$('.cleanSlate-agent-manager-artifact-meta'));
		dom.append(meta, dom.$('.cleanSlate-agent-manager-artifact-kind')).textContent = getArtifactKindLabel(artifact);
		const copyButton = dom.append(meta, dom.$('button.cleanSlate-agent-manager-artifact-copy')) as HTMLButtonElement;
		copyButton.type = 'button';
		copyButton.title = localize('cleanSlate.agentManager.copyArtifact', 'Copy artifact');
		copyButton.setAttribute('aria-label', copyButton.title);
		const copyIcon = dom.append(copyButton, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.copy)}`));
		dom.append(copyButton, dom.$('span.cleanSlate-agent-manager-artifact-copy-label')).textContent = localize('cleanSlate.agentManager.copyArtifactLabel', 'Copy');
		copyButton.onclick = async () => {
			try {
				await this.copyText(artifact.content);
				copyIcon.classList.remove('codicon-copy');
				copyIcon.classList.add('codicon-check');
				copyButton.title = localize('cleanSlate.agentManager.artifactCopied', 'Artifact copied');
				copyButton.setAttribute('aria-label', copyButton.title);
				dom.getWindow(copyButton).setTimeout(() => {
					copyIcon.classList.remove('codicon-check');
					copyIcon.classList.add('codicon-copy');
					copyButton.title = localize('cleanSlate.agentManager.copyArtifact', 'Copy artifact');
					copyButton.setAttribute('aria-label', copyButton.title);
				}, 1500);
			} catch {
				copyButton.title = localize('cleanSlate.agentManager.copyArtifactFailed', 'Could not copy artifact');
				copyButton.setAttribute('aria-label', copyButton.title);
			}
		};
		const rendered = this.markdownRenderer.render(new MarkdownString(artifact.content, { isTrusted: false, supportHtml: true }));
		disposables.add(rendered);
		rendered.element.classList.add('cleanSlate-agent-manager-artifact-content');
		body.appendChild(rendered.element);
	}

	private createBrowserButton(container: HTMLElement, icon: ThemeIcon, label: string, onClick: (anchor: HTMLElement) => void): HTMLButtonElement {
		const button = dom.append(container, dom.$('button.cleanSlate-agent-manager-browser-button')) as HTMLButtonElement;
		button.type = 'button';
		button.title = label;
		button.setAttribute('aria-label', label);
		dom.append(button, dom.$(`span${ThemeIcon.asCSSSelector(icon)}`));
		button.onclick = () => onClick(button);
		return button;
	}

	private createAddress(container: HTMLElement, url: string, onOpenAddress: (url: string) => void): HTMLInputElement {
		const address = dom.append(container, dom.$('.cleanSlate-agent-manager-browser-address'));
		dom.append(address, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.globe)}`));
		const input = dom.append(address, dom.$('input')) as HTMLInputElement;
		input.type = 'url';
		input.value = url;
		input.placeholder = localize('cleanSlate.agentManager.browserAddressPlaceholder', 'Enter URL');
		input.spellcheck = false;
		input.setAttribute('aria-label', localize('cleanSlate.agentManager.browserAddress', 'Browser address'));
		input.onkeydown = event => {
			if (event.key === 'Enter') {
				event.preventDefault();
				const nextUrl = input.value.trim();
				if (nextUrl) {
					onOpenAddress(nextUrl);
				}
			}
		};
		return input;
	}

	private createAnnotationToggle(container: HTMLElement, state: ICleanSlateBrowserState, onToggleAnnotation: () => void): void {
		const annotate = dom.append(container, dom.$('button.cleanSlate-agent-manager-browser-annotation-toggle')) as HTMLButtonElement;
		annotate.type = 'button';
		annotate.classList.toggle('active', state.annotationActive);
		annotate.setAttribute('aria-pressed', String(state.annotationActive));
		annotate.title = state.annotationActive
			? localize('cleanSlate.agentManager.browserAnnotationStopTitle', 'Stop Annotating')
			: localize('cleanSlate.agentManager.browserAnnotationStartTitle', 'Annotate Page');
		annotate.setAttribute('aria-label', annotate.title);
		dom.append(annotate, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.add)}`));
		const annotateLabel = dom.append(annotate, dom.$('span.cleanSlate-agent-manager-browser-annotation-label'));
		annotateLabel.textContent = state.annotationActive
			? localize('cleanSlate.agentManager.browserAnnotationActiveLabel', 'Annotating')
			: localize('cleanSlate.agentManager.browserAnnotationInactiveLabel', 'Annotate');
		annotate.onclick = onToggleAnnotation;
	}

	private renderEmpty(body: HTMLElement, icon: ThemeIcon, title: string, description: string): void {
		const empty = dom.append(body, dom.$('.cleanSlate-agent-manager-right-empty'));
		dom.append(empty, dom.$(`span${ThemeIcon.asCSSSelector(icon)}.cleanSlate-agent-manager-right-empty-icon`));
		dom.append(empty, dom.$('div.cleanSlate-agent-manager-right-empty-title')).textContent = title;
		dom.append(empty, dom.$('div.cleanSlate-agent-manager-right-empty-description')).textContent = description;
	}

	renderEmptyState(body: HTMLElement, icon: ThemeIcon, title: string, description: string): void {
		this.renderEmpty(body, icon, title, description);
	}
}
