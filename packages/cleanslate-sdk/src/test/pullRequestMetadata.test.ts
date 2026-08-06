/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getToolByName } from '../tools/registry.js';

test('prepare_pull_request returns the exact agent-authored title and body', async () => {
	const tool = getToolByName('prepare_pull_request');
	assert.ok(tool);
	const result = await tool.run({
		title: 'Improve recommendation card accessibility',
		body: '## Summary\n\nImprove keyboard navigation.\n\n## Verification\n\n- Tests passed.'
	}, {} as any);

	assert.deepEqual(result.pullRequest, {
		title: 'Improve recommendation card accessibility',
		body: '## Summary\n\nImprove keyboard navigation.\n\n## Verification\n\n- Tests passed.'
	});
});

test('prepare_pull_request rejects missing semantic metadata', async () => {
	const tool = getToolByName('prepare_pull_request');
	assert.ok(tool);
	const result = await tool.run({ title: '   ', body: '' }, {} as any);

	assert.equal(result.success, false);
	assert.equal(result.code, 'invalid_pull_request_metadata');
});

