/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CleanSlateMessageSubmitController } from '../../browser/chat/viewModel/cleanSlateMessageSubmitController.js';
import type { ICleanSlateBrowserAnnotation } from '../../browser/core/cleanSlateBrowserAutomationService.js';

suite('CleanSlateMessageSubmitController', () => {
	test('uses and clears annotations from the originating Agent Manager session', async () => {
		let activeSessionId = 'session-a';
		const sessionSurface = 'agentManager:session-a' as const;
		const listedSurfaces: string[] = [];
		const clearedSurfaces: string[] = [];
		let submittedInput = '';
		let completeSend!: () => void;
		const sendCompletion = new Promise<void>(resolve => completeSend = resolve);
		const annotation: ICleanSlateBrowserAnnotation = {
			id: 'annotation-1',
			url: 'https://example.com/reference',
			title: 'Reference',
			text: 'Use this layout',
			tagName: 'section',
			label: 'Example section',
			selector: '#example',
			elementText: 'Example',
			pageX: 10,
			pageY: 20,
			x: 10,
			y: 20,
			width: 100,
			height: 50,
			createdAt: 1
		};

		const sidebarViewModel = {
			getActiveSessionId: () => activeSessionId,
			hasPendingCommandApproval: () => false,
			getIsGenerating: () => false,
			getPendingSelectionReferences: () => [],
			getPendingImages: () => [],
			clearPendingImages: () => undefined,
			clearPendingSelectionReferences: () => undefined,
			recordTranscriptMessage: () => undefined,
			sendMessage: (input: string) => {
				submittedInput = input;
				return sendCompletion;
			}
		};
		const browserAutomationService = {
			listCachedAnnotations: (surface: string) => {
				listedSurfaces.push(surface);
				return surface === sessionSurface ? [annotation] : [];
			},
			clearAnnotations: async (surface: string) => {
				clearedSurfaces.push(surface);
				return {};
			}
		};
		const composerView = {
			getValue: () => 'Use the attached reference',
			clearValue: () => undefined,
			suppressAnnotationReferences: () => undefined,
			clearAnnotationSuppression: () => undefined,
			setGenerating: () => undefined
		};
		const renderer = {
			addMessage: () => undefined
		};
		const controller = new CleanSlateMessageSubmitController(
			sidebarViewModel as any,
			browserAutomationService as any,
			{
				getComposerView: () => composerView as any,
				getRenderer: () => renderer as any,
				onBeforeSend: () => undefined,
				onUpdateTitle: () => undefined,
				onAnnotationsChanged: () => undefined
			},
			() => `agentManager:${activeSessionId}`
		);

		await controller.send();
		assert.strictEqual(listedSurfaces[0], sessionSurface);
		assert.ok(submittedInput.includes('provenance="external_reference"'));

		activeSessionId = 'session-b';
		completeSend();
		await sendCompletion;
		await new Promise(resolve => setTimeout(resolve, 0));

		assert.deepStrictEqual(clearedSurfaces, [sessionSurface]);
	});
});
