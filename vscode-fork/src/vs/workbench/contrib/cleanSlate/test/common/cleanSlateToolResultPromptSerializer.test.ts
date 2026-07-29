/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { sanitizeToolResultForRenderer, serializeToolResultForPrompt } from '@cleanslate/sdk/agent/cleanSlateToolResultPromptSerializer.js';
import { CLEANSLATE_ABSOLUTE_MAX_FILE_READ_TOKENS, CLEANSLATE_MAX_FULL_FILE_READ_BYTES, CLEANSLATE_MIN_FILE_READ_TOKENS, estimateCleanSlateFileReadTokens, estimateCleanSlateUtf8Bytes, resolveCleanSlateFileReadBudget, takeCleanSlateBoundedLineSlice } from '@cleanslate/sdk/tools/cleanSlateFileReadPolicy.js';

suite('CleanSlateToolResultPromptSerializer', () => {
	test('preserves complete file-read content instead of applying the generic string clamp', () => {
		const content = Array.from({ length: 160 }, (_, index) => `line ${index + 1}: ${'x'.repeat(20)}`).join('\n');
		assert.ok(content.length > 3000);

		const serialized = serializeToolResultForPrompt('read_file', {
			content,
			path: '/workspace/lib/screens/main_screen.dart',
			totalLines: 160,
			truncated: false
		});

		assert.ok(serialized.includes(content));
		assert.ok(serialized.includes('"totalLines":160'));
		assert.strictEqual(serialized.includes('...[truncated'), false);
	});

	test('keeps the generic string clamp for non-file tool results', () => {
		const serialized = serializeToolResultForPrompt('execute_command', {
			content: 'x'.repeat(5000)
		});

		assert.ok(serialized.includes('...[truncated'));
	});

	test('bounded range reads stop on a complete-line boundary with an exact continuation', () => {
		const lines = ['first', 'x'.repeat(90), 'last'];
		const slice = takeCleanSlateBoundedLineSlice(lines, 0, lines.length, 100);

		assert.strictEqual(slice.content, `${lines[0]}\n${lines[1]}`);
		assert.strictEqual(slice.endExclusive, 2);
		assert.strictEqual(slice.oversizedFirstLine, false);
	});

	test('derives an adaptive read budget from model context and remaining input', () => {
		const largeModel = resolveCleanSlateFileReadBudget(200_000, 100_000);
		assert.strictEqual(largeModel.maxTokens, CLEANSLATE_ABSOLUTE_MAX_FILE_READ_TOKENS);
		assert.strictEqual(largeModel.maxBytes, CLEANSLATE_MAX_FULL_FILE_READ_BYTES);

		const smallModel = resolveCleanSlateFileReadBudget(32_000, 20_000);
		assert.strictEqual(smallModel.maxTokens, 4_800);
		assert.strictEqual(smallModel.maxBytes, 14_400);
		assert.ok(smallModel.maxBytes < CLEANSLATE_MAX_FULL_FILE_READ_BYTES);
	});

	test('floors the read budget when the prompt estimate exhausts the context window', () => {
		const exhausted = resolveCleanSlateFileReadBudget(64_000, 1);
		assert.strictEqual(exhausted.maxTokens, CLEANSLATE_MIN_FILE_READ_TOKENS);
		assert.strictEqual(exhausted.maxBytes, CLEANSLATE_MIN_FILE_READ_TOKENS * 3);
	});

	test('uses conservative UTF-8 estimation without splitting Unicode accounting', () => {
		assert.strictEqual(estimateCleanSlateUtf8Bytes('aé😀'), 7);
		assert.strictEqual(estimateCleanSlateFileReadTokens('aé😀'), 3);
	});

	test('preserves browser visual metadata needed for readability verification', () => {
		const serialized = serializeToolResultForPrompt('browser_snapshot', {
			url: 'http://localhost:3000/news',
			title: 'News',
			bodyText: 'Dark mode verification',
			elements: [{
				id: 'element-1',
				tagName: 'p',
				role: 'status',
				name: 'Latest status',
				testId: 'news-status',
				text: 'Muted body copy',
				disabled: false,
				visual: {
					color: 'rgb(120, 120, 120)',
					backgroundColor: 'rgb(18, 18, 18)',
					opacity: 0.72,
					contrastRatio: 2.61,
					lowContrast: true
				}
			}],
			theme: {
				prefersColorScheme: 'dark',
				colorScheme: 'dark',
				backgroundColor: 'rgb(18, 18, 18)',
				foregroundColor: 'rgb(240, 240, 240)'
			}
		});

		assert.ok(serialized.includes('"tagName":"p"'));
		assert.ok(serialized.includes('"role":"status"'));
		assert.ok(serialized.includes('"name":"Latest status"'));
		assert.ok(serialized.includes('"testId":"news-status"'));
		assert.ok(serialized.includes('"contrastRatio":2.61'));
		assert.ok(serialized.includes('"lowContrast":true'));
		assert.ok(serialized.includes('"colorScheme":"dark"'));
		assert.ok(serialized.includes('"prefersColorScheme":"dark"'));
	});

	test('retains an explicit screenshot for the renderer but omits it from model context', () => {
		const rawResult = {
			mimeType: 'image/jpeg',
			base64: 'raw-screenshot'
		};

		const rendererResult = sanitizeToolResultForRenderer('browser_screenshot', rawResult) as typeof rawResult;
		assert.strictEqual(rendererResult.base64, 'raw-screenshot');

		const serialized = serializeToolResultForPrompt('browser_screenshot', rendererResult);
		assert.strictEqual(serialized.includes('raw-screenshot'), false);
		assert.ok(serialized.includes('[base64 omitted:'));
	});
});
