/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { renderAnsiToHtml } from '../../browser/chat/renderers/cleanSlateAnsiRenderer.js';

suite('CleanSlateAnsiRenderer', () => {
	test('renders standard ANSI colors through terminal theme variables', () => {
		const html = renderAnsiToHtml('\u001b[34mINFO\u001b[0m plain');

		assert.strictEqual(
			html,
			'<span style="color: var(--vscode-terminal-ansiBlue)">INFO</span> plain'
		);
	});

	test('renders true-color and indexed ANSI sequences', () => {
		const html = renderAnsiToHtml('\u001b[38;2;12;34;56mcustom\u001b[0m \u001b[38;5;196mindexed\u001b[0m');

		assert.ok(html.includes('color: rgb(12, 34, 56)'));
		assert.ok(html.includes('color: rgb(255, 0, 0)'));
	});

	test('escapes terminal text before returning trusted markup', () => {
		const html = renderAnsiToHtml('\u001b[32m<script>&"\'\u001b[0m');

		assert.ok(!html.includes('<script>'));
		assert.ok(html.includes('&lt;script&gt;&amp;&quot;&#39;'));
	});

	test('drops non-renderable terminal control sequences', () => {
		const html = renderAnsiToHtml('\u001b[2Jhello\u001b]0;title\u0007 world');

		assert.strictEqual(html, 'hello world');
	});
});
