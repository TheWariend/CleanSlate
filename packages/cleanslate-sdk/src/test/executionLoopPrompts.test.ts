/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	buildSerializedToolCallRecoveryPrompt,
	detectSerializedToolCallSyntax
} from '../agent/cleanSlateExecutionLoopPrompts.js';

test('detects tool syntax serialized into assistant text or native call arguments', () => {
	assert.equal(detectSerializedToolCallSyntax('to=functions.read_file {"path":"README.md"}'), true);
	assert.equal(detectSerializedToolCallSyntax('multi_tool_use.parallel'), true);
	assert.equal(detectSerializedToolCallSyntax('{"tool_calls":[{"name":"read_file"}]}'), true);
	assert.equal(detectSerializedToolCallSyntax('I inspected the README and found no issue.'), false);
});

test('recovery tells the provider to use multiple native calls without wrapper tools', () => {
	const prompt = buildSerializedToolCallRecoveryPrompt();
	assert.match(prompt, /provider-native tool calls/);
	assert.match(prompt, /multiple entries/);
	assert.match(prompt, /do not invent wrapper tools/);
});
