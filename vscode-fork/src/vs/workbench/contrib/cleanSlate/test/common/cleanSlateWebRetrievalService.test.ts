/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { cleanSlateWebRetrievalTestExports } from '../../../../services/cleanSlate/node/core/cleanSlateWebRetrievalService.js';

suite('CleanSlateWebRetrievalService', () => {
	test('parses JSON-RPC MCP text responses', () => {
		const parsed = cleanSlateWebRetrievalTestExports.parseMcpTextResponse(JSON.stringify({
			result: {
				content: [
					{ type: 'text', text: 'Result from [Docs](https://example.com/docs).' }
				]
			}
		}));

		assert.strictEqual(parsed, 'Result from [Docs](https://example.com/docs).');
	});

	test('parses SSE MCP text responses', () => {
		const parsed = cleanSlateWebRetrievalTestExports.parseMcpTextResponse([
			'event: message',
			`data: ${JSON.stringify({ result: { content: [{ type: 'text', text: 'One' }] } })}`,
			`data: ${JSON.stringify({ result: { content: [{ type: 'text', text: 'Two' }] } })}`
		].join('\n'));

		assert.strictEqual(parsed, 'One\n\nTwo');
	});

	test('extracts citation results from provider text', () => {
		const results = cleanSlateWebRetrievalTestExports.extractResultsFromProviderText(
			'Read [CleanSlate docs](https://example.com/docs) and also https://example.com/blog.',
			'exaMcpAnonymous',
			5
		);

		assert.strictEqual(results.length, 2);
		assert.strictEqual(results[0].title, 'CleanSlate docs');
		assert.strictEqual(results[0].url, 'https://example.com/docs');
		assert.strictEqual(results[1].url, 'https://example.com/blog');
	});

	test('converts HTML to markdown without scripts and preserves links', () => {
		const markdown = cleanSlateWebRetrievalTestExports.htmlToMarkdown(
			'<html><head><title>x</title></head><body><h1>Hello</h1><script>alert(1)</script><p>Read <a href="/docs">docs</a>.</p></body></html>',
			'https://example.com/base/page'
		);

		assert.match(markdown, /^# Hello/);
		assert.match(markdown, /\[docs\]\(https:\/\/example.com\/docs\)/);
		assert.ok(!markdown.includes('alert(1)'));
	});

	test('detects private IP addresses', () => {
		assert.strictEqual(cleanSlateWebRetrievalTestExports.isPrivateIpAddress('127.0.0.1'), true);
		assert.strictEqual(cleanSlateWebRetrievalTestExports.isPrivateIpAddress('10.0.0.5'), true);
		assert.strictEqual(cleanSlateWebRetrievalTestExports.isPrivateIpAddress('192.168.1.10'), true);
		assert.strictEqual(cleanSlateWebRetrievalTestExports.isPrivateIpAddress('::1'), true);
		assert.strictEqual(cleanSlateWebRetrievalTestExports.isPrivateIpAddress('8.8.8.8'), false);
	});
});
