/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { normalizeCleanSlateMessagesForProvider } from '@cleanslate/sdk/protocol/cleanSlateProviderMessageTransforms.js';

suite('cleanSlateProviderMessageTransforms', () => {
	test('normalizes tool names and tool-call ids for non-OpenAI providers', () => {
		const messages = normalizeCleanSlateMessagesForProvider([
			{
				role: 'assistant',
				content: '',
				toolCalls: [{
					id: 'call read/file:1',
					toolName: 'functions.read_file',
					input: { path: 'package.json' }
				}]
			},
			{
				role: 'tool',
				toolCallId: 'call read/file:1',
				toolName: 'functions.read_file',
				content: ''
			}
		], { target: 'anthropic' });

		assert.strictEqual(messages.length, 2);
		assert.strictEqual(messages[0].toolCalls?.[0].id, 'call_read_file_1');
		assert.strictEqual(messages[0].toolCalls?.[0].toolName, 'read_file');
		assert.strictEqual(messages[1].toolCallId, 'call_read_file_1');
		assert.strictEqual(messages[1].toolName, 'read_file');
		assert.strictEqual(messages[1].content, '{}');
	});

	test('drops empty non-tool turns for provider adapters that reject them', () => {
		const messages = normalizeCleanSlateMessagesForProvider([
			{ role: 'system', content: 'core prompt' },
			{ role: 'assistant', content: '' },
			{ role: 'user', content: 'hi' }
		], { target: 'gemini' });

		assert.deepStrictEqual(messages.map(message => message.role), ['system', 'user']);
	});

	test('flattens tool history when the request provides no tools', () => {
		const messages = normalizeCleanSlateMessagesForProvider([
			{ role: 'user', content: 'Explain this project.' },
			{
				role: 'assistant',
				content: '',
				toolCalls: [{ id: 'call_read_1', toolName: 'read_file', input: { path: 'README.md' } }]
			},
			{ role: 'tool', toolCallId: 'call_read_1', toolName: 'read_file', content: '# Project' }
		], { target: 'openaiCompatible', provider: 'custom', model: 'sarvam-105b', hasTools: false });

		assert.deepStrictEqual(messages.map(message => message.role), ['user', 'user']);
		assert.strictEqual(messages.some(message => message.role === 'tool'), false);
		assert.strictEqual(messages.some(message => !!message.toolCalls?.length), false);
		assert.strictEqual(messages[1].content, '[Tool result (read_file)]\n# Project');
	});

	test('applies CleanSlate Mistral tool-call id and tool/user sequence fixes', () => {
		const messages = normalizeCleanSlateMessagesForProvider([
			{
				role: 'assistant',
				content: '',
				toolCalls: [{
					id: 'call read/file:1',
					toolName: 'read_file',
					input: { path: 'package.json' }
				}]
			},
			{
				role: 'tool',
				toolCallId: 'call read/file:1',
				toolName: 'read_file',
				content: '{"ok":true}'
			},
			{ role: 'user', content: 'continue' }
		], { target: 'openaiCompatible', provider: 'azureOpenAI', model: 'mistral-large' });

		assert.strictEqual(messages[0].toolCalls?.[0].id, 'callreadf');
		assert.strictEqual(messages[1].toolCallId, 'callreadf');
		assert.deepStrictEqual(messages.map(message => message.role), ['assistant', 'tool', 'assistant', 'user']);
		assert.strictEqual(messages[2].content, 'Done.');
	});
});
