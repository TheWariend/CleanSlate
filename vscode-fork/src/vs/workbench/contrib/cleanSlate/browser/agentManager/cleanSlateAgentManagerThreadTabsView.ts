/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { localize } from '../../../../../nls.js';

export interface ICleanSlateThreadTab {
	readonly id: string;
	readonly title: string;
	readonly running: boolean;
	readonly browser?: boolean;
	readonly closable?: boolean;
}

export class CleanSlateAgentManagerThreadTabsView {

	render(container: HTMLElement, tabs: readonly ICleanSlateThreadTab[], activeId: string, handlers: {
		readonly contentId: string;
		readonly onSelect: (id: string) => void | Promise<void>;
		readonly onClose: (id: string) => void;
	}): void {
		const existing = new Map(Array.from(container.querySelectorAll<HTMLElement>('.cleanSlate-agent-manager-thread-tab'))
			.map(element => [element.dataset.sessionId, element]));
		let selectionChanged = false;
		let next = container.firstElementChild;
		for (const tab of tabs) {
			const element = existing.get(tab.id) ?? dom.$('.cleanSlate-agent-manager-thread-tab');
			existing.delete(tab.id);
			element.dataset.sessionId = tab.id;
			element.setAttribute('role', 'presentation');
			const active = tab.id === activeId;
			selectionChanged ||= active && !element.classList.contains('active');
			element.classList.toggle('active', active);
			const button = element.querySelector<HTMLButtonElement>('[role="tab"]')
				?? dom.append(element, dom.$('button.cleanSlate-agent-manager-thread-select')) as HTMLButtonElement;
			button.type = 'button';
			button.setAttribute('role', 'tab');
			button.setAttribute('aria-selected', String(active));
			button.setAttribute('aria-controls', handlers.contentId);
			button.setAttribute('aria-label', tab.title);
			button.tabIndex = active ? 0 : -1;
			button.title = tab.title;
			const icon = button.querySelector<HTMLElement>('.cleanSlate-agent-manager-thread-icon')
				?? dom.append(button, dom.$('span.cleanSlate-agent-manager-thread-icon'));
			icon.className = `cleanSlate-agent-manager-thread-icon ${ThemeIcon.asClassName(tab.running ? Codicon.loading : tab.browser ? Codicon.globe : Codicon.edit)}`;
			icon.classList.toggle('codicon-modifier-spin', tab.running);
			icon.setAttribute('aria-hidden', 'true');
			const label = button.querySelector<HTMLElement>('.cleanSlate-agent-manager-thread-label')
				?? dom.append(button, dom.$('span.cleanSlate-agent-manager-thread-label'));
			label.textContent = tab.title;
			button.onclick = () => handlers.onSelect(tab.id);
			button.onkeydown = event => {
				const index = tabs.findIndex(candidate => candidate.id === tab.id);
				const target = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length]
					: event.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length]
						: event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : undefined;
				if (target) {
					event.preventDefault();
					void Promise.resolve(handlers.onSelect(target.id)).then(() => {
						const targetElement = Array.from(container.children).find(child => (child as HTMLElement).dataset.sessionId === target.id);
						targetElement?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
					});
				} else if (event.key === 'Delete' && tab.closable !== false) {
					event.preventDefault();
					handlers.onClose(tab.id);
				}
			};
			const close = element.querySelector<HTMLButtonElement>('.cleanSlate-agent-manager-thread-close')
				?? dom.append(element, dom.$('button.cleanSlate-agent-manager-thread-close')) as HTMLButtonElement;
			close.type = 'button';
			close.hidden = tab.closable === false;
			close.tabIndex = active ? 0 : -1;
			close.title = localize('cleanSlate.agentManager.closeThreadTab', 'Close tab');
			close.setAttribute('aria-label', localize('cleanSlate.agentManager.closeNamedThreadTab', 'Close {0}', tab.title));
			if (!close.firstChild) {
				dom.append(close, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.close)}`));
			}
			close.onclick = () => handlers.onClose(tab.id);
			if (element !== next) {
				container.insertBefore(element, next);
			}
			next = element.nextElementSibling;
		}
		for (const element of existing.values()) {
			element.remove();
		}
		if (selectionChanged) {
			container.querySelector('.cleanSlate-agent-manager-thread-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		}
	}
}
