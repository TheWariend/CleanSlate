/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../../base/browser/dom.js';

export type CleanSlatePlanApprovalChoice = 'approve' | 'revise';

export interface ICleanSlatePlanApprovalViewOptions {
	readonly getInputValue: () => string;
	readonly focusInput: () => void;
	readonly onApprove: () => void;
	readonly onRevise: (direction: string) => void;
	readonly onDidChange: () => void;
}

export class CleanSlatePlanApprovalView {
	private readonly root: HTMLElement;
	private choice: CleanSlatePlanApprovalChoice = 'approve';
	private dismissed = false;

	constructor(
		parent: HTMLElement,
		private readonly options: ICleanSlatePlanApprovalViewOptions
	) {
		this.root = dom.append(parent, dom.$('.cleanSlate-plan-approval'));
		this.buildDOM();
	}

	getChoice(): CleanSlatePlanApprovalChoice {
		return this.choice;
	}

	isVisible(): boolean {
		return this.root.classList.contains('visible');
	}

	isDismissed(): boolean {
		return this.dismissed;
	}

	resetDismissed(): void {
		this.dismissed = false;
	}

	hide(): void {
		this.root.classList.remove('visible');
		this.options.onDidChange();
	}

	dismiss(focusInput = false): void {
		this.dismissed = true;
		this.hide();
		if (focusInput) {
			this.options.focusInput();
		}
	}

	updateVisibility(shouldShow: boolean): boolean {
		const wasVisible = this.isVisible();
		this.root.classList.toggle('visible', shouldShow);
		if (shouldShow && !wasVisible) {
			this.setChoice('approve');
		}
		this.options.onDidChange();
		return shouldShow && !wasVisible;
	}

	submit(): void {
		if (this.choice === 'approve') {
			this.options.onApprove();
			return;
		}

		const direction = this.options.getInputValue().trim();
		if (!direction) {
			this.setChoice('revise');
			return;
		}

		this.dismissed = true;
		this.hide();
		this.options.onRevise(direction);
	}

	private buildDOM(): void {
		this.root.dataset.choice = 'approve';

		const header = dom.append(this.root, dom.$('.cleanSlate-plan-approval-header'));
		const title = dom.append(header, dom.$('span.cleanSlate-plan-approval-title'));
		title.textContent = 'Proceed with these steps?';

		const closeBtn = dom.append(header, dom.$('button.cleanSlate-plan-approval-close'));
		closeBtn.title = 'Dismiss';
		dom.append(closeBtn, dom.$('i.codicon.codicon-close'));
		closeBtn.onclick = () => this.dismiss(true);

		const options = dom.append(this.root, dom.$('.cleanSlate-plan-approval-options'));
		const approveOption = this.createOption(options, 'approve', '1.', 'Yes');
		const reviseOption = this.createOption(options, 'revise', '2.', 'No, revise the steps');

		approveOption.onclick = () => this.setChoice('approve');
		reviseOption.onclick = () => this.setChoice('revise');

		const footer = dom.append(this.root, dom.$('.cleanSlate-plan-approval-footer'));
		const dismissBtn = dom.append(footer, dom.$('button.cleanSlate-plan-approval-dismiss'));
		dom.append(dismissBtn, dom.$('span', undefined, 'Dismiss'));
		dom.append(dismissBtn, dom.$('kbd', undefined, 'Esc'));
		dismissBtn.onclick = () => this.dismiss(true);

		const submitBtn = dom.append(footer, dom.$('button.cleanSlate-plan-approval-submit'));
		dom.append(submitBtn, dom.$('span', undefined, 'Submit'));
		submitBtn.onclick = () => this.submit();

		this.root.onkeydown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				this.dismiss(true);
			} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
				event.preventDefault();
				this.setChoice(this.choice === 'approve' ? 'revise' : 'approve');
			} else if (event.key === 'Enter') {
				event.preventDefault();
				this.submit();
			}
		};
	}

	private createOption(container: HTMLElement, choice: CleanSlatePlanApprovalChoice, index: string, label: string): HTMLElement {
		const option = dom.append(container, dom.$('button.cleanSlate-plan-approval-option'));
		option.dataset.choice = choice;
		option.setAttribute('aria-pressed', 'false');

		dom.append(option, dom.$('span.cleanSlate-plan-approval-index', undefined, index));
		dom.append(option, dom.$('span.cleanSlate-plan-approval-label', undefined, label));

		return option;
	}

	private setChoice(choice: CleanSlatePlanApprovalChoice): void {
		this.choice = choice;
		this.root.dataset.choice = choice;

		const options = this.root.querySelectorAll<HTMLElement>('.cleanSlate-plan-approval-option');
		options.forEach(option => {
			const selected = option.dataset.choice === choice;
			option.classList.toggle('selected', selected);
			option.setAttribute('aria-pressed', String(selected));
		});

		this.options.onDidChange();
		if (choice === 'revise') {
			this.options.focusInput();
		}
	}
}
