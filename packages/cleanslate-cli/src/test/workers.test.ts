/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { updateWorkers } from '../workers.js';

test('interleaved worker streams stay separate and completion preserves their order', () => {
	const first = { id: 'one', kind: 'worker' as const, description: 'First assignment', prompt: 'Inspect first', status: 'running' as const, createdAt: 1 };
	const second = { ...first, id: 'two', description: 'Second assignment', prompt: 'Inspect second' };
	let state = updateWorkers([], { type: 'created', agent: first });
	state = updateWorkers(state, { type: 'created', agent: second });
	state = updateWorkers(state, { type: 'progress', agent: second, streamPart: { type: 'chat_text', content: 'Second result' } });
	state = updateWorkers(state, { type: 'progress', agent: first, streamPart: { type: 'chat_text', content: 'First result' } });
	state = updateWorkers(state, { type: 'completed', agent: { ...first, status: 'completed', output: 'First result' } });
	assert.deepEqual(state.map(worker => worker.agent.id), ['one', 'two']);
	assert.deepEqual(state[0].transcript.map(entry => entry.content), ['Inspect first', 'First result']);
	assert.deepEqual(state[1].transcript.map(entry => entry.content), ['Inspect second', 'Second result']);
	assert.equal(state[0].agent.status, 'completed');
});
