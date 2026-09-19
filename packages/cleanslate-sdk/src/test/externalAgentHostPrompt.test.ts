/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { createExternalAgentHostPrompt } from '../externalAgents/handoff.js';

test('host browser routing applies to fresh and resumed prompts with advertised tools only', () => {
	for (const message of ['Open the site', 'Click the login button']) {
		const prompt = createExternalAgentHostPrompt(message, ['browser_open', 'browser_click', 'read_file']);
		assert.match(prompt, /connected cleanslate-ide MCP server/);
		assert.match(prompt, /unless the user explicitly requests/);
		assert.ok(prompt.endsWith(message));
		assert.ok(prompt.includes('browser_open, browser_click'));
		assert.ok(!prompt.includes('browser_screenshot'));
	}
});

test('does not advertise a host browser when unavailable', () => {
	assert.equal(createExternalAgentHostPrompt('Open in Safari', ['read_file']), 'Open in Safari');
});
