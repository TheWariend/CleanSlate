/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { resolveCleanSlateBrowserAddress as resolve } from '../../browser/agentManager/cleanSlateBrowserAddress.js';

suite('CleanSlate browser address', () => {
	test('opens domains and domain ports with HTTPS', () => {
		assert.strictEqual(resolve(' example.test/docs?q=one '), 'https://example.test/docs?q=one');
		assert.strictEqual(resolve('example.test:8443/docs'), 'https://example.test:8443/docs');
	});

	test('opens local development servers with HTTP', () => {
		assert.strictEqual(resolve('localhost:3000'), 'http://localhost:3000/');
		assert.strictEqual(resolve('127.0.0.1:8080/preview'), 'http://127.0.0.1:8080/preview');
		assert.strictEqual(resolve('[::1]:3000'), 'http://[::1]:3000/');
	});

	test('preserves explicit web and local file addresses', () => {
		assert.strictEqual(resolve('http://example.test/path'), 'http://example.test/path');
		assert.strictEqual(resolve('file:///workspace/preview.html'), 'file:///workspace/preview.html');
	});

	test('searches ordinary text and encodes query characters', () => {
		assert.strictEqual(resolve('typescript async & await'), 'https://www.google.com/search?q=typescript%20async%20%26%20await');
		assert.strictEqual(resolve('documentation'), 'https://www.google.com/search?q=documentation');
	});

	test('rejects executable and unsupported URL schemes', () => {
		for (const address of ['javascript:alert(1)', 'data:text/html,test', 'vscode://example', 'about:blank']) {
			assert.throws(() => resolve(address), /Use an HTTP, HTTPS, or local file address/);
		}
		assert.throws(() => resolve('   '), /Enter a website address or search/);
	});
});
