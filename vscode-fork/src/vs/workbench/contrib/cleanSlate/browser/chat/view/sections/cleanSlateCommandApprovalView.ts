/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../../base/browser/dom.js';
import type { ICleanSlateCommandApprovalRequest } from '../../../core/cleanSlateCommandApprovalService.js';

type CleanSlateCommandApprovalChoice = 'approve' | 'approveSession' | 'cancel';

export interface ICleanSlateCommandApprovalViewOptions {
	readonly focusInput: () => void;
	readonly onApprove: (approvalId: string) => void;
	readonly onApproveForSession: (approvalId: string) => void;
	readonly onCancel: (approvalId: string) => void;
	readonly onDidChange: () => void;
}

export class CleanSlateCommandApprovalView {
	private readonly root: HTMLElement;
	private title!: HTMLElement;
	private preview!: HTMLElement;
	private commandText!: HTMLElement;
	private cwdText!: HTMLElement;
	private expandButton!: HTMLButtonElement;
	private request: ICleanSlateCommandApprovalRequest | undefined;
	private choice: CleanSlateCommandApprovalChoice = 'approve';
	private expanded = false;

	constructor(
		parent: HTMLElement,
		private readonly options: ICleanSlateCommandApprovalViewOptions
	) {
		this.root = dom.append(parent, dom.$('.cleanSlate-command-approval'));
		this.buildDOM();
	}

	isVisible(): boolean {
		return this.root.classList.contains('visible');
	}

	getChoice(): CleanSlateCommandApprovalChoice {
		return this.choice;
	}

	handleKeyDown(event: KeyboardEvent): boolean {
		if (!this.isVisible()) {
			return false;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			this.cancel();
			return true;
		}
		if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			event.preventDefault();
			this.setChoice(this.getAdjacentChoice(event.key === 'ArrowDown' ? 1 : -1));
			return true;
		}
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			this.submit();
			return true;
		}
		if (event.key === '1') {
			event.preventDefault();
			this.setChoice('approve');
			return true;
		}
		if (event.key === '2') {
			event.preventDefault();
			this.setChoice('approveSession');
			return true;
		}
		return false;
	}

	hide(): void {
		this.request = undefined;
		this.root.classList.remove('visible');
		this.options.onDidChange();
	}

	update(request: ICleanSlateCommandApprovalRequest | undefined): boolean {
		const wasVisible = this.isVisible();
		this.request = request;
		this.root.classList.toggle('visible', !!request);
		if (request) {
			this.title.textContent = this.getApprovalTitle(request);
			this.title.title = this.title.textContent;
			this.commandText.textContent = request.command;
			this.cwdText.textContent = request.cwd ? request.cwd : '';
			this.cwdText.classList.toggle('empty', !request.cwd);
			this.setExpanded(false);
			this.setChoice('approve');
		}
		this.options.onDidChange();
		return !!request && !wasVisible;
	}

	submit(): void {
		if (!this.request) {
			return;
		}

		const approvalId = this.request.id;
		if (this.choice === 'approve') {
			this.hide();
			this.options.onApprove(approvalId);
			return;
		}

		if (this.choice === 'approveSession') {
			this.hide();
			this.options.onApproveForSession(approvalId);
			return;
		}

		this.hide();
		this.options.onCancel(approvalId);
	}

	cancel(): void {
		if (!this.request) {
			this.hide();
			return;
		}
		const approvalId = this.request.id;
		this.hide();
		this.options.onCancel(approvalId);
	}

	private buildDOM(): void {
		this.root.dataset.choice = 'approve';
		this.root.tabIndex = -1;

		const header = dom.append(this.root, dom.$('.cleanSlate-command-approval-header'));
		this.title = dom.append(header, dom.$('span.cleanSlate-command-approval-title'));

		const commandWrap = dom.append(this.root, dom.$('.cleanSlate-command-approval-command'));
		this.preview = commandWrap;
		this.commandText = dom.append(commandWrap, dom.$('code.cleanSlate-command-approval-command-text'));
		this.expandButton = dom.append(commandWrap, dom.$('button.cleanSlate-command-approval-expand', undefined, 'Expand'));
		this.expandButton.onclick = () => this.setExpanded(!this.expanded);
		this.cwdText = dom.append(this.root, dom.$('.cleanSlate-command-approval-cwd'));

		const options = dom.append(this.root, dom.$('.cleanSlate-command-approval-options'));
		const approveOption = this.createOption(options, 'approve', '1', 'Yes', 'codicon-arrow-both');
		const approveSessionOption = this.createOption(options, 'approveSession', '2', 'Yes, for session');
		const cancelOption = this.createOption(options, 'cancel', '', 'No', undefined, 'codicon-close');

		approveOption.onclick = () => {
			this.setChoice('approve');
		};
		approveSessionOption.onclick = () => {
			this.setChoice('approveSession');
		};
		cancelOption.onclick = () => {
			this.setChoice('cancel');
		};

		const footer = dom.append(this.root, dom.$('.cleanSlate-command-approval-footer'));
		const submitBtn = dom.append(footer, dom.$('button.cleanSlate-command-approval-submit'));
		dom.append(submitBtn, dom.$('span', undefined, 'Submit'));
		dom.append(submitBtn, dom.$('span.cleanSlate-command-approval-return', undefined, 'Enter'));
		submitBtn.onclick = () => this.submit();

		this.root.onkeydown = (event: KeyboardEvent) => {
			this.handleKeyDown(event);
		};
	}

	private createOption(container: HTMLElement, choice: CleanSlateCommandApprovalChoice, index: string, label: string, trailingIcon?: string, leadingIcon?: string): HTMLElement {
		const option = dom.append(container, dom.$('button.cleanSlate-command-approval-option'));
		option.dataset.choice = choice;
		option.setAttribute('aria-pressed', 'false');

		const indexElement = dom.append(option, dom.$('span.cleanSlate-command-approval-index'));
		if (leadingIcon) {
			dom.append(indexElement, dom.$(`i.codicon.${leadingIcon}`));
		} else {
			indexElement.textContent = index;
		}
		dom.append(option, dom.$('span.cleanSlate-command-approval-label', undefined, label));
		const indicator = dom.append(option, dom.$('span.cleanSlate-command-approval-indicator'));
		if (trailingIcon) {
			dom.append(indicator, dom.$('i.codicon.codicon-arrow-up'));
			dom.append(indicator, dom.$('i.codicon.codicon-arrow-down'));
		}

		return option;
	}

	private setChoice(choice: CleanSlateCommandApprovalChoice): void {
		this.choice = choice;
		this.root.dataset.choice = choice;

		const options = this.root.querySelectorAll<HTMLElement>('.cleanSlate-command-approval-option');
		options.forEach(option => {
			const selected = option.dataset.choice === choice;
			option.classList.toggle('selected', selected);
			option.setAttribute('aria-pressed', String(selected));
		});

		this.options.onDidChange();
		this.options.focusInput();
	}

	private setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.preview.classList.toggle('expanded', expanded);
		this.expandButton.textContent = expanded ? 'Collapse' : 'Expand';
	}

	private getAdjacentChoice(delta: number): CleanSlateCommandApprovalChoice {
		const choices: CleanSlateCommandApprovalChoice[] = ['approve', 'approveSession', 'cancel'];
		const index = choices.indexOf(this.choice);
		const nextIndex = (index + delta + choices.length) % choices.length;
		return choices[nextIndex];
	}

	private getApprovalTitle(request: ICleanSlateCommandApprovalRequest): string {
		const reason = request.reason?.trim();
		if (request.toolName?.startsWith('mcp')) {
			return reason
				? (reason.endsWith('?') ? reason : `${reason}?`)
				: 'Allow this MCP tool to run?';
		}
		if (reason) {
			return reason.endsWith('?') ? `Allow ${reason.slice(0, -1)}?` : `Allow ${reason}?`;
		}
		return 'Allow this command to run?';
	}
}
