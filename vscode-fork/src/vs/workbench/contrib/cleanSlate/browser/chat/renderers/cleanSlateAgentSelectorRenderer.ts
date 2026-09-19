/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../base/browser/dom.js';
import { FileAccess } from '../../../../../../base/common/network.js';
import { IDisposable } from '../../../../../../base/common/lifecycle.js';

export interface ICleanSlateAgentChoice {
	readonly id: string;
	readonly name: string;
	readonly iconPath?: string;
	readonly monochromeIcon?: boolean;
	readonly available: boolean;
	readonly unavailableReason?: string;
}

export class CleanSlateAgentSelectorRenderer {
	private overlay: HTMLElement | undefined;
	private outsideClickListener: IDisposable | undefined;

	constructor(
		private readonly getCurrentId: () => string,
		private readonly load: () => Promise<readonly ICleanSlateAgentChoice[]>,
		private readonly select: (id: string) => Promise<void>
	) { }

	async toggle(container: HTMLElement, anchor: HTMLElement): Promise<void> {
		if (this.overlay) { this.hide(); return; }
		const overlay = dom.append(container, dom.$('.cleanSlate-model-selector-overlay.cleanSlate-agent-selector-overlay'));
		this.overlay = overlay;
		const list = dom.append(overlay, dom.$('.model-list-container.status'));
		const loading = dom.append(list, dom.$('.model-status-item.is-loading'));
		dom.append(loading, dom.$('.model-status-icon.codicon.codicon-loading.codicon-modifier-spin'));
		dom.append(loading, dom.$('.model-status-title')).textContent = 'Loading Agents';
		this.position(overlay, anchor, container);
		this.outsideClickListener = dom.addDisposableListener(document, 'mousedown', event => {
			if (!this.overlay?.contains(event.target as Node) && !anchor.contains(event.target as Node)) { this.hide(); }
		});
		try {
			const agents = await this.load();
			if (this.overlay !== overlay) { return; }
			dom.clearNode(list);
			list.classList.remove('status');
			const currentId = this.getCurrentId();
			for (const agent of agents) {
				const item = dom.append(list, dom.$('button.model-item.cleanSlate-agent-choice')) as HTMLButtonElement;
				item.type = 'button';
				this.renderLogo(item, agent);
				const label = agent.name.trim() || agent.id;
				dom.append(item, dom.$('.model-item-label')).textContent = label;
				if (agent.id === currentId) { item.classList.add('active'); dom.append(item, dom.$('span.codicon.codicon-check')); }
				item.disabled = !agent.available;
				item.title = agent.available ? label : agent.unavailableReason ?? `${label} is unavailable`;
				item.onclick = async () => {
					if (agent.id === this.getCurrentId()) { this.hide(); return; }
					await this.select(agent.id);
					this.hide();
				};
			}
			this.position(overlay, anchor, container);
		} catch (error) {
			if (this.overlay !== overlay) { return; }
			dom.clearNode(list);
			const status = dom.append(list, dom.$('.model-status-item'));
			dom.append(status, dom.$('.model-status-icon.codicon.codicon-warning'));
			dom.append(status, dom.$('.model-status-title')).textContent = 'Agent List Unavailable';
			dom.append(status, dom.$('.model-status-description')).textContent = error instanceof Error ? error.message : String(error);
		}
	}

	hide(): void {
		this.overlay?.remove();
		this.overlay = undefined;
		this.outsideClickListener?.dispose();
		this.outsideClickListener = undefined;
	}

	private renderLogo(parent: HTMLElement, agent: ICleanSlateAgentChoice): void {
		const logo = dom.append(parent, dom.$('span.cleanSlate-agent-choice-logo'));
		logo.classList.toggle('is-cleanslate', agent.id === 'native');
		const path = agent.iconPath ?? (agent.id === 'native' ? 'vs/workbench/contrib/cleanSlate/browser/media/logo.png' : undefined);
		if (!path) { logo.classList.add('codicon', 'codicon-hubot'); return; }
		const url = FileAccess.asBrowserUri(path as Parameters<typeof FileAccess.asBrowserUri>[0]).toString(true);
		if (agent.monochromeIcon) {
			logo.style.backgroundColor = 'currentColor';
			logo.style.mask = `url("${url}") center / contain no-repeat`;
		} else {
			logo.style.backgroundImage = `url("${url}")`;
		}
	}

	private position(overlay: HTMLElement, anchor: HTMLElement, container: HTMLElement): void {
		const containerRect = container.getBoundingClientRect();
		const anchorRect = anchor.getBoundingClientRect();
		const width = Math.min(280, Math.max(220, containerRect.width - 20));
		overlay.style.width = `${width}px`;
		const height = overlay.getBoundingClientRect().height || 180;
		overlay.style.left = `${Math.max(10, Math.min(anchorRect.right - width, window.innerWidth - width - 10))}px`;
		overlay.style.top = `${Math.max(10, anchorRect.top - height - 8)}px`;
	}
}
