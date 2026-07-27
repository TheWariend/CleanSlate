/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CleanSlateChatComposerProvider } from '../../browser/chat/providers/cleanSlateChatComposerProvider.js';

suite('CleanSlateChatComposerProvider', () => {
	test('keeps pending images scoped to the active session', () => {
		const provider = new CleanSlateChatComposerProvider();

		provider.setActiveSession('session-a', false);
		provider.addPendingImage('image-a');

		provider.setActiveSession('session-b', false);
		assert.deepStrictEqual(provider.getPendingImages(), []);
		provider.addPendingImage('image-b');

		provider.setActiveSession('session-a', false);
		assert.deepStrictEqual(provider.getPendingImages(), ['image-a']);

		provider.setActiveSession('session-b', false);
		assert.deepStrictEqual(provider.getPendingImages(), ['image-b']);
	});

	test('clears only the active session images', () => {
		const provider = new CleanSlateChatComposerProvider();

		provider.setActiveSession('session-a', false);
		provider.addPendingImage('image-a');
		provider.setActiveSession('session-b', false);
		provider.addPendingImage('image-b');

		provider.clearPendingImages();
		assert.deepStrictEqual(provider.getPendingImages(), []);

		provider.setActiveSession('session-a', false);
		assert.deepStrictEqual(provider.getPendingImages(), ['image-a']);
	});
});
