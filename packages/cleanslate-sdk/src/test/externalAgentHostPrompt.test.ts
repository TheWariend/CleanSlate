/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { createExternalAgentHostPrompt } from '../externalAgents/handoff.js';
import { CLEANSLATE_BROWSER_POLICY } from '../tools/cleanSlateBrowserPolicy.js';
import { getToolByName } from '../tools/registry.js';

test('host browser routing applies to fresh and resumed prompts with advertised tools only', () => {
	for (const message of ['Open the site', 'Click the login button']) {
		const prompt = createExternalAgentHostPrompt(message, ['browser_open', 'browser_click', 'read_file']);
		assert.match(prompt, /connected cleanslate-ide MCP server/);
		assert.match(prompt, /only when the current user request explicitly asks to open a browser/);
		assert.match(prompt, /only because UI files changed/);
		assert.ok(!prompt.includes('by default'));
		assert.ok(prompt.endsWith(message));
		assert.ok(prompt.includes('browser_open, browser_click'));
		assert.ok(!prompt.includes('browser_screenshot'));
	}
});

test('does not advertise a host browser when unavailable', () => {
	assert.equal(createExternalAgentHostPrompt('Open in Safari', ['read_file']), 'Open in Safari');
});

test('browser opt-in policy is carried by the advertised tool catalog', () => {
	const browserDescription = getToolByName('browser_open')?.description ?? '';
	assert.match(browserDescription, /Request scope:/);
	assert.ok(browserDescription.includes(CLEANSLATE_BROWSER_POLICY.activation));
	assert.ok(browserDescription.includes(CLEANSLATE_BROWSER_POLICY.incidentalUiChanges));
	assert.doesNotMatch(browserDescription, /use (?:it|them) by default/i);
	assert.doesNotMatch(getToolByName('read_file')?.description ?? '', /Request scope:/);
});
