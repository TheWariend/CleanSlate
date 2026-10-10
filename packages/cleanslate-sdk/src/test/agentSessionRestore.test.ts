/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { CleanSlateAgentSession } from '../agent/cleanSlateAgentSession.js';
import type { ICleanSlateAgentRuntimeSnapshot } from '../protocol/cleanSlateAI.js';

for (const content of [null, undefined, '']) {
	test(`restores tool-only assistant turns with ${String(content)} text without orphaning results`, () => {
		const session = new CleanSlateAgentSession();
		const toolCall = { id: 'call-list', toolName: 'list_dir', input: { path: '.', empty: '', code: '  indented\n' } };
		session.restore({
			version: 1,
			messages: [
				{ role: 'user', content: 'Build the game.' },
				{ role: 'assistant', content, toolCalls: [toolCall] },
				{ role: 'tool', toolCallId: toolCall.id, toolName: toolCall.toolName, content: '{"files":[]}' }
			]
		} as unknown as ICleanSlateAgentRuntimeSnapshot);
		session.continueWithTurn([{ role: 'user', content: 'Open in browser.' }]);
		const messages = session.getSnapshot()!.messages;
		assert.equal(messages.length, 4);
		assert.equal(messages[1].content, '');
		assert.deepEqual(messages[1].toolCalls, [toolCall]);
		assert.equal(messages[2].toolCallId, messages[1].toolCalls![0].id);
	});
}

test('restore still rejects null text without a valid assistant tool call', () => {
	const session = new CleanSlateAgentSession();
	session.restore({ version: 1, messages: [
		{ role: 'assistant', content: null },
		{ role: 'assistant', content: null, toolCalls: [] },
		{ role: 'assistant', content: null, toolCalls: [{ toolName: '' }] },
		{ role: 'user', content: null, toolCalls: [{ toolName: 'list_dir', input: {} }] },
		{ role: 'user', content: 'Valid turn.' }
	] } as unknown as ICleanSlateAgentRuntimeSnapshot);
	assert.deepEqual(session.getSnapshot()!.messages, [{ role: 'user', content: 'Valid turn.' }]);
});
