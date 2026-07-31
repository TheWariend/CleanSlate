/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orderUserTurnLast } from '../agent/cleanSlateProviderMessageOrder.js';
import { IChatMessage } from '../protocol/cleanSlateAI.js';

const m = (role: IChatMessage['role'], content: string): IChatMessage => ({ role, content });
const roles = (list: readonly IChatMessage[]) => list.map(entry => entry.role);

// Regression: the terminal host appended objective/context reminders AFTER the user message,
// so the request ended on `system`. deepseek-v4-flash then continued the transcript instead of
// answering — leaking `</think>` and inventing whole user turns.
test('system messages trailing the user turn are hoisted so the user turn is last', () => {
	const ordered = orderUserTurnLast([
		m('system', 'kernel'), m('user', 'hi'), m('system', 'objective'), m('system', 'reminder')
	]);
	assert.deepEqual(roles(ordered), ['system', 'system', 'system', 'user']);
	assert.equal(ordered.at(-1)?.content, 'hi');
	// The hoisted messages keep their relative order.
	assert.deepEqual(ordered.map(entry => entry.content), ['kernel', 'objective', 'reminder', 'hi']);
});

test('a request already ending with the user turn is untouched', () => {
	const input = [m('system', 'kernel'), m('user', 'hi')];
	assert.deepEqual(roles(orderUserTurnLast(input)), ['system', 'user']);
});

// Mid-loop steering prompts must stay put: once the model has produced an assistant or tool
// message, a trailing system message is a recovery nudge aimed at THAT point in the loop.
test('mid-loop steering prompts after an assistant turn are left alone', () => {
	const input = [
		m('system', 'kernel'), m('user', 'do it'), m('assistant', 'working'),
		m('system', 'EXECUTION GUARDRAIL: return concrete tool_calls only')
	];
	assert.deepEqual(roles(orderUserTurnLast(input)), ['system', 'user', 'assistant', 'system']);
});

test('a tool result after the user turn also blocks reordering', () => {
	const input = [m('user', 'go'), m('tool', 'result'), m('system', 'nudge')];
	assert.deepEqual(roles(orderUserTurnLast(input)), ['user', 'tool', 'system']);
});

test('messages with no user turn are returned unchanged', () => {
	const input = [m('system', 'a'), m('system', 'b')];
	assert.deepEqual(roles(orderUserTurnLast(input)), ['system', 'system']);
});
