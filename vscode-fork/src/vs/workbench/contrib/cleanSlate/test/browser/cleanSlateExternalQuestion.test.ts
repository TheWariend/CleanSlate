/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CleanSlatePlanningQuestionView } from '../../browser/chat/view/sections/cleanSlatePlanningQuestionView.js';
import { CleanSlateMessageSubmitController } from '../../browser/chat/viewModel/cleanSlateMessageSubmitController.js';
import type { CleanSlateChatSidebarViewModel } from '../../browser/chat/viewModel/cleanSlateChatSidebarViewModel.js';
import type { ICleanSlateBrowserAutomationService } from '../../browser/core/cleanSlateBrowserAutomationService.js';
import type { CleanSlateComposerView } from '../../browser/chat/view/sections/cleanSlateComposerView.js';
import type { IResponseRenderer } from '../../browser/chat/types/cleanSlateChatTypes.js';

suite('CleanSlate external question interaction', () => {
    test('a selected answer reaches the pending request without stopping generation', async () => {
        const parent = document.createElement('div');
        document.body.append(parent);
        const input = document.createElement('textarea');
        parent.append(input);
        const answers: string[] = [];
		const order: string[] = [];
        let submission: Promise<void> | undefined;
        const controller = new CleanSlateMessageSubmitController({
            getActiveSessionId: () => 'chat',
            answerExternalQuestion: (answer: string, beforeResume: () => void) => {
				answers.push(answer);
				beforeResume();
				order.push('resume agent');
				return true;
			},
            recordTranscriptMessage: () => { order.push('record user answer'); },
            abortGeneration: () => assert.fail('Answer must not stop the active agent')
        } as unknown as CleanSlateChatSidebarViewModel, {} as ICleanSlateBrowserAutomationService, {
            getComposerView: () => ({ getValue: () => input.value, clearValue: () => { input.value = ''; } }) as CleanSlateComposerView,
            getRenderer: () => ({ addMessage: () => { order.push('render user answer'); } }) as unknown as IResponseRenderer,
            onBeforeSend: () => {}, onUpdateTitle: () => {}, onAnnotationsChanged: () => {}
        });
        const view = new CleanSlatePlanningQuestionView(parent, () => input, () => {});
        parent.addEventListener('cleanslate-planning-question-submit', event => {
            const { message, displayText } = (event as CustomEvent).detail;
            submission = controller.send(message, displayText);
        });
        try {
            view.show({ question: 'Which feature next?', options: [{ label: 'Pricing' }, { label: 'Reviews' }], allowCustom: true });
            (parent.querySelectorAll<HTMLButtonElement>('.cleanSlate-planning-question-option')[1]).click();
            parent.querySelector<HTMLButtonElement>('.cleanSlate-planning-question-submit')!.click();
            await submission;
            assert.strictEqual(answers.length, 1);
            assert.match(answers[0], /Selected option: Reviews/);
			assert.deepStrictEqual(order, ['render user answer', 'record user answer', 'resume agent']);
            assert.strictEqual(view.isVisible(), false);
        } finally { parent.remove(); }
    });

    test('dismissing cancels a pending question, while ordinary clearing does not', () => {
        const parent = document.createElement('div');
        let cancelled = 0;
        const view = new CleanSlatePlanningQuestionView(parent, () => undefined, () => {}, () => { cancelled++; });
        const question = { question: 'Continue?', options: [{ label: 'Yes' }], allowCustom: true };
        view.show(question);
        view.clear();
        assert.strictEqual(cancelled, 0, 'Switching views must not reject the question');
        view.show(question);
        parent.querySelector<HTMLButtonElement>('.cleanSlate-planning-question-dismiss')!.click();
        assert.strictEqual(cancelled, 1);
        assert.strictEqual(view.isVisible(), false);
    });

	test('up and down arrows move the selected answer', () => {
		const parent = document.createElement('div');
		document.body.append(parent);
		const input = document.createElement('textarea');
		parent.append(input);
		const view = new CleanSlatePlanningQuestionView(parent, () => input, () => {});
		try {
			view.show({ question: 'Choose one', options: [{ label: 'First' }, { label: 'Second' }], allowCustom: true });
			assert.strictEqual(parent.querySelector('.cleanSlate-planning-question-option.selected .cleanSlate-planning-question-label')?.textContent, 'First');
			assert.strictEqual(view.handleKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true })), true);
			assert.strictEqual(parent.querySelector('.cleanSlate-planning-question-option.selected .cleanSlate-planning-question-label')?.textContent, 'Second');
			assert.strictEqual(view.handleKeyDown(new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true })), true);
			assert.strictEqual(parent.querySelector('.cleanSlate-planning-question-option.selected .cleanSlate-planning-question-label')?.textContent, 'First');
		} finally { parent.remove(); }
	});
});
