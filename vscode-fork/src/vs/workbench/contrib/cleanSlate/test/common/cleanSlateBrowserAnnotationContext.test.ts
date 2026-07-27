/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	buildBrowserAnnotationRoutingContext,
	buildBrowserAnnotationTaskContext,
	classifyBrowserAnnotationProvenance,
	CleanSlateBrowserAnnotationProvenance
} from '../../browser/agent/cleanSlateBrowserAnnotationContext.js';
import type { ICleanSlateBrowserAnnotation } from '../../browser/core/cleanSlateBrowserAutomationService.js';
import { buildCleanSlateAnnotationSubmitContext } from '../../browser/chat/viewModel/cleanSlateChatViewHelpers.js';

suite('CleanSlateBrowserAnnotationContext', () => {
	function annotation(url: string, text = 'Use this card layout'): ICleanSlateBrowserAnnotation {
		return {
			id: 'annotation-1',
			url,
			title: 'Reference page',
			text,
			tagName: 'section',
			label: 'Pricing card',
			selector: '#pricing',
			elementText: 'Pro plan',
			pageX: 120,
			pageY: 240,
			x: 100,
			y: 200,
			width: 320,
			height: 180,
			createdAt: 1
		};
	}

	test('classifies loopback previews separately from external sites', () => {
		assert.strictEqual(classifyBrowserAnnotationProvenance('http://localhost:5173/dashboard'), CleanSlateBrowserAnnotationProvenance.ProjectPreview);
		assert.strictEqual(classifyBrowserAnnotationProvenance('http://127.0.0.1:3000'), CleanSlateBrowserAnnotationProvenance.ProjectPreview);
		assert.strictEqual(classifyBrowserAnnotationProvenance('http://[::1]:8080'), CleanSlateBrowserAnnotationProvenance.ProjectPreview);
		assert.strictEqual(classifyBrowserAnnotationProvenance('https://example.com/pricing'), CleanSlateBrowserAnnotationProvenance.ExternalReference);
	});

	test('marks external annotations as references and requires contextual clarification', () => {
		const annotations = [annotation('https://example.com/pricing')];
		const routingContext = buildBrowserAnnotationRoutingContext(annotations);
		const taskContext = buildBrowserAnnotationTaskContext(annotations);

		assert.ok(routingContext.includes('provenance=external_reference'));
		assert.ok(routingContext.includes('comment=Use this card layout'));
		assert.ok(taskContext.includes('not, by themselves, authorization to edit the workspace'));
		assert.ok(taskContext.includes('generate a task-specific question and options'));
		assert.ok(taskContext.includes('Do not invent a target'));
	});

	test('does not turn an attached external annotation into an implicit edit command', () => {
		const submitContext = buildCleanSlateAnnotationSubmitContext([annotation('https://example.com/pricing')]);

		assert.ok(submitContext.includes('provenance="external_reference"'));
		assert.ok(submitContext.includes('not an implicit request to edit the workspace'));
		assert.ok(!submitContext.includes('Apply the attached browser annotation'));
	});
});
