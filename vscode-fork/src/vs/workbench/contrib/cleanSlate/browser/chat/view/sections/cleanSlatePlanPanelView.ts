/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../../base/browser/dom.js';

export class CleanSlatePlanPanelView {
	private readonly root: HTMLElement;

	constructor(container: HTMLElement) {
		this.root = dom.append(container, dom.$('.cleanSlate-plan-dropup'));
		this.buildDOM();
	}

	clear(): void {
		this.root.classList.remove('visible');
	}

	update(steps: string[]): void {
		if (!steps || steps.length === 0) {
			return;
		}

		const completed = steps.filter(step => /\[[xX]\]/.test(step)).length;
		const inProgress = steps.filter(step => /\[\/\]/.test(step)).length;
		const total = steps.length;
		const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;
		const allDone = completed === total;

		const header = this.root.querySelector('.cleanSlate-plan-dropup-header') as HTMLElement | null;
		const titleEl = this.root.querySelector('.plan-dropup-title') as HTMLElement | null;
		const statusIcon = this.root.querySelector('.plan-status-icon') as HTMLElement | null;
		const fill = this.root.querySelector('.plan-dropup-progress-fill') as HTMLElement | null;

		if (titleEl) {
			titleEl.textContent = `Tasks ${completed}/${total}`;
		}
		if (fill) {
			fill.style.width = `${progressPct}%`;
			fill.classList.toggle('complete', allDone);
		}
		if (statusIcon) {
			statusIcon.style.display = allDone ? 'flex' : 'none';
		}
		if (header) {
			header.classList.toggle('all-done', allDone);
		}

		const body = this.root.querySelector('.cleanSlate-plan-dropup-body') as HTMLElement | null;
		if (body) {
			dom.clearNode(body);
			if (this.root.dataset.collapsed === 'false' && inProgress > 0) {
				// Keep the active task visible when the panel first appears.
			}

			for (const step of steps) {
				const isCompleted = /\[[xX]\]/.test(step);
				const isInProgress = /\[\/\]/.test(step);
				const label = step.replace(/^\s*[-*]?\s*\[[xX/\s]\]\s*/, '').trim();

				const item = dom.append(body, dom.$('.plan-dropup-item'));
				if (isCompleted) {
					item.classList.add('done');
				}
				if (isInProgress) {
					item.classList.add('active');
				}

				const iconEl = dom.append(item, dom.$('i.codicon'));
				if (isCompleted) {
					iconEl.classList.add('codicon-pass-filled');
					iconEl.style.color = 'var(--vscode-testing-iconPassed)';
				} else if (isInProgress) {
					iconEl.classList.add('codicon-loading', 'codicon-modifier-spin');
					iconEl.style.color = 'var(--vscode-progressBar-background)';
				} else {
					iconEl.classList.add('codicon-circle-large-outline');
					iconEl.style.color = 'var(--vscode-descriptionForeground)';
				}

				const labelEl = dom.append(item, dom.$('span.plan-dropup-item-label'));
				labelEl.textContent = label;
				if (isCompleted) {
					labelEl.style.textDecoration = 'line-through';
					labelEl.style.opacity = '0.5';
				}
			}
		}

		const wasVisible = this.root.classList.contains('visible');
		if (!wasVisible) {
			this.root.classList.add('animate-in');
			setTimeout(() => this.root.classList.remove('animate-in'), 300);
		}
		this.root.classList.add('visible');
	}

	private buildDOM(): void {
		this.root.dataset.collapsed = 'false';

		const card = dom.append(this.root, dom.$('.cleanSlate-plan-dropup-card'));
		const header = dom.append(card, dom.$('.cleanSlate-plan-dropup-header'));

		const headerLeft = dom.append(header, dom.$('.plan-dropup-header-left'));
		const statusIcon = dom.append(headerLeft, dom.$('i.codicon.codicon-check-all.plan-status-icon'));
		statusIcon.style.display = 'none';

		const headerTitle = dom.append(headerLeft, dom.$('span.plan-dropup-title'));
		headerTitle.textContent = 'Steps';

		const progressTrack = dom.append(header, dom.$('.plan-dropup-progress-track'));
		dom.append(progressTrack, dom.$('.plan-dropup-progress-fill'));

		const chevronBtn = dom.append(header, dom.$('button.plan-dropup-chevron'));
		dom.append(chevronBtn, dom.$('i.codicon.codicon-chevron-down'));

		dom.append(card, dom.$('.cleanSlate-plan-dropup-body'));

		header.onclick = () => {
			const isCollapsed = this.root.dataset.collapsed === 'true';
			this.root.dataset.collapsed = isCollapsed ? 'false' : 'true';
		};
	}
}
