/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CleanSlateConversationBranchService } from '../services/cleanSlateConversationBranchService.js';

test('side conversations inherit context without sharing mutable history', () => {
	let id = 0;
	let now = 10;
	const conversations = new CleanSlateConversationBranchService(() => `chat-${++id}`, () => ++now);
	const primary = conversations.createBranch({ title: 'Main task' });
	conversations.appendMessage(primary.id, { role: 'user', content: 'Inspect auth' });
	const side = conversations.createBranch({ parentId: primary.id, inheritMessages: true });
	conversations.appendMessage(side.id, { role: 'user', content: 'Explain the token flow' });

	assert.equal(conversations.getBranch(primary.id)?.messages.length, 1);
	assert.deepEqual(conversations.getBranch(side.id)?.messages.map(message => message.content), [
		'Inspect auth',
		'Explain the token flow'
	]);
	assert.equal(side.kind, 'side-chat');
});
