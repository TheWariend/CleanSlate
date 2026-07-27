/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { normalizeCleanSlateBrowserScreenshotDataUrl } from '../../browser/chat/runtime/cleanSlateBrowserScreenshotPresentation.js';

suite('CleanSlate browser screenshot presentation', () => {
	test('builds a data URL from raw base64', () => {
		assert.strictEqual(
			normalizeCleanSlateBrowserScreenshotDataUrl('image/jpeg', '/9j/AA=='),
			'data:image/jpeg;base64,/9j/AA=='
		);
	});

	test('does not double-prefix an existing data URL', () => {
		assert.strictEqual(
			normalizeCleanSlateBrowserScreenshotDataUrl('image/jpeg', 'data:image/png;base64,iVBORw=='),
			'data:image/png;base64,iVBORw=='
		);
	});

	test('removes transport whitespace and rejects malformed payloads', () => {
		assert.strictEqual(
			normalizeCleanSlateBrowserScreenshotDataUrl('image/jpeg', '/9j/\nAA=='),
			'data:image/jpeg;base64,/9j/AA=='
		);
		assert.strictEqual(
			normalizeCleanSlateBrowserScreenshotDataUrl('image/jpeg', 'not:a-base64-payload'),
			undefined
		);
	});
});
