/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CliPermissionPolicy } from '../permissions.js';

test('read-only mode blocks mutations while retaining discovery', () => {
	const policy = new CliPermissionPolicy('read-only');
	assert.equal(policy.allowsTool({ toolName: 'read_file', category: 'discovery' }), true);
	assert.equal(policy.allowsTool({ toolName: 'browser_snapshot', category: 'browser' }), true);
	assert.equal(policy.allowsTool({ toolName: 'apply_edit', category: 'edit' }), false);
	assert.equal(policy.allowsTool({ toolName: 'execute_command', category: 'execution' }), false);
	assert.equal(policy.allowsTool({ toolName: 'mcp_call_tool', category: 'system' }), false);
	assert.equal(policy.allowsCommandWithoutPrompt(), false);
});

test('full mode permits tools and commands without an interactive prompt', () => {
	const policy = new CliPermissionPolicy('full');
	assert.equal(policy.allowsTool({ toolName: 'apply_edit', category: 'edit' }), true);
	assert.equal(policy.allowsCommandWithoutPrompt(), true);
});
