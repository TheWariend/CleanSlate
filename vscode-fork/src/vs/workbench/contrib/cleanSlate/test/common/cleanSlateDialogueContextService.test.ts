/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CleanSlateDialogueContextService } from '../../browser/agent/cleanSlateDialogueContextService.js';
import { CleanSlateThreadService } from '@cleanslate/sdk/services/cleanSlateThreadService.js';

suite('CleanSlateDialogueContextService', () => {
	test('keeps recent visible dialogue across task boundaries when using full thread memory', () => {
		const threadService = new CleanSlateThreadService();
		threadService.addMessage('user', 'why is the update button disabled?');
		threadService.addMessage('assistant', 'The issue is that canUpdate is never recomputed after validation changes.');
		threadService.startNewTaskBoundary();
		threadService.addMessage('user', 'sounds right, make that change');

		const dialogueContext = new CleanSlateDialogueContextService({
			getConfiguration: () => ({ contextWindow: 20_480 })
		} as any);

		const fullThreadMemory = dialogueContext.buildDialogueMemoryPrompt(threadService, 'sounds right, make that change', {
			minUserTurns: 4,
			maxChars: 12_000,
			useFullThread: true
		});
		const activeOnlyMemory = dialogueContext.buildDialogueMemoryPrompt(threadService, 'sounds right, make that change', {
			minUserTurns: 4,
			maxChars: 12_000,
			useFullThread: false
		});

		assert.ok(fullThreadMemory.includes('canUpdate is never recomputed'));
		assert.ok(!activeOnlyMemory.includes('canUpdate is never recomputed'));
		assert.ok(!fullThreadMemory.includes('User: sounds right, make that change'));
	});
});
