/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../../base/browser/dom.js';
import type { CleanSlatePlanningQuestion, CleanSlatePlanningQuestionOption } from '../../types/cleanSlateChatTypes.js';

export interface ICleanSlatePlanningQuestionSubmission {
	readonly message: string;
	readonly displayText: string;
	/** The question this answers, so the transcript can record it as resolved. */
	readonly question: string;
}

export class CleanSlatePlanningQuestionView {
	private readonly root: HTMLElement;
	private activeQuestion: CleanSlatePlanningQuestion | undefined;
	private activeQuestionKey: string | undefined;
	private choiceIndex = 0;
	private suppressed = false;

	constructor(
		parent: HTMLElement,
		private readonly getInputElement: () => HTMLTextAreaElement | undefined,
		private readonly onDidChange: () => void
	) {
		this.root = dom.append(parent, dom.$('.cleanSlate-planning-question'));
	}

	isVisible(): boolean {
		return this.root.classList.contains('visible') && !this.suppressed;
	}

	show(question: CleanSlatePlanningQuestion): void {
		const key = this.getQuestionKey(question);
		if (this.activeQuestionKey === key && this.isVisible()) {
			return;
		}

		this.activeQuestion = question;
		this.activeQuestionKey = key;
		this.choiceIndex = 0;
		this.render();
		this.root.classList.toggle('visible', !this.suppressed);
		this.onDidChange();
	}

	setSuppressed(suppressed: boolean): void {
		if (this.suppressed === suppressed) {
			return;
		}

		this.suppressed = suppressed;
		this.root.classList.toggle('visible', !!this.activeQuestion && !suppressed);
		this.onDidChange();
	}

	clear(focusInput = false): void {
		this.root.classList.remove('visible');
		dom.clearNode(this.root);
		this.activeQuestion = undefined;
		this.activeQuestionKey = undefined;
		this.choiceIndex = 0;
		this.onDidChange();

		if (focusInput) {
			this.getInputElement()?.focus();
		}
	}

	getPlaceholder(): string {
		const selected = this.getOptions()[this.choiceIndex];
		if (selected?.custom) {
			return this.activeQuestion?.placeholder || 'What should change?';
		}

		return 'Add details for CleanSlate...';
	}

	consumeSubmission(): ICleanSlatePlanningQuestionSubmission | undefined {
		if (!this.activeQuestion) {
			return undefined;
		}

		const input = this.getInputElement();
		const selected = this.getOptions()[this.choiceIndex];
		const details = input?.value.trim() ?? '';
		if (selected?.custom && !details) {
			input?.focus();
			return undefined;
		}

		const question = this.activeQuestion.question;
		const answerLabel = selected?.label ?? details;
		const message = [
			'answer planning question:',
			`Question: ${question}`,
			answerLabel ? `Selected option: ${answerLabel}` : '',
			selected?.description ? `Option detail: ${selected.description}` : '',
			details ? `Additional direction: ${details}` : ''
		].filter(Boolean).join('\n');
		const displayText = details || answerLabel || 'Answered planning question';

		this.clear();
		return { message, displayText, question };
	}

	private render(): void {
		if (!this.activeQuestion) {
			return;
		}

		dom.clearNode(this.root);

		const header = dom.append(this.root, dom.$('.cleanSlate-planning-question-header'));
		const title = dom.append(header, dom.$('span.cleanSlate-planning-question-title'));
		title.textContent = this.activeQuestion.question;

		const closeBtn = dom.append(header, dom.$('button.cleanSlate-planning-question-close'));
		closeBtn.title = 'Dismiss';
		dom.append(closeBtn, dom.$('i.codicon.codicon-close'));
		closeBtn.onclick = () => this.clear(true);

		const options = dom.append(this.root, dom.$('.cleanSlate-planning-question-options'));
		this.getOptions().forEach((option, index) => {
			const optionEl = dom.append(options, dom.$('button.cleanSlate-planning-question-option'));
			optionEl.classList.toggle('selected', index === this.choiceIndex);
			optionEl.setAttribute('aria-pressed', String(index === this.choiceIndex));

			dom.append(optionEl, dom.$('span.cleanSlate-planning-question-index', undefined, `${index + 1}.`));
			const labelWrap = dom.append(optionEl, dom.$('span.cleanSlate-planning-question-copy'));
			dom.append(labelWrap, dom.$('span.cleanSlate-planning-question-label', undefined, option.label));
			if (option.description) {
				dom.append(labelWrap, dom.$('span.cleanSlate-planning-question-description', undefined, option.description));
			}

			optionEl.onclick = () => {
				this.choiceIndex = index;
				this.render();
				this.onDidChange();
				this.getInputElement()?.focus();
			};
		});

		const footer = dom.append(this.root, dom.$('.cleanSlate-planning-question-footer'));
		const dismissBtn = dom.append(footer, dom.$('button.cleanSlate-planning-question-dismiss'));
		dom.append(dismissBtn, dom.$('span', undefined, 'Dismiss'));
		dom.append(dismissBtn, dom.$('kbd', undefined, 'Esc'));
		dismissBtn.onclick = () => this.clear(true);

		const submitBtn = dom.append(footer, dom.$('button.cleanSlate-planning-question-submit'));
		dom.append(submitBtn, dom.$('span', undefined, 'Submit'));
		submitBtn.onclick = () => {
			const submission = this.consumeSubmission();
			if (submission) {
				this.root.dispatchEvent(new CustomEvent<ICleanSlatePlanningQuestionSubmission>('cleanslate-planning-question-submit', {
					bubbles: true,
					detail: submission
				}));
			}
		};
	}

	private getOptions(): (CleanSlatePlanningQuestionOption & { custom?: boolean })[] {
		if (!this.activeQuestion) {
			return [];
		}

		const options: (CleanSlatePlanningQuestionOption & { custom?: boolean })[] = [...this.activeQuestion.options];
		if (this.activeQuestion.allowCustom) {
			options.push({
				label: this.activeQuestion.customLabel || 'Something else',
				description: 'Tell CleanSlate what should change.',
				custom: true
			});
		}

		return options;
	}

	private getQuestionKey(question: CleanSlatePlanningQuestion): string {
		return [
			question.question,
			...question.options.map(option => `${option.label}:${option.description ?? ''}`),
			question.allowCustom ? 'custom' : ''
		].join('\n');
	}
}
