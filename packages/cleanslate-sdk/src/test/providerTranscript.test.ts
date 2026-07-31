/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	messageContentToText,
	toGeminiContents,
	toGeminiToolCallTranscriptText
} from '../protocol/cleanSlateProviderTranscript.js';

describe('gemini transcript flattening', () => {
	test('renders a tool call as the text turn the model is trained against', () => {
		assert.equal(
			toGeminiToolCallTranscriptText({ toolName: 'ReadFile', input: { path: 'a.ts' } }, 'call_1'),
			'Tool call (call_1): ReadFile\nArguments: {"path":"a.ts"}'
		);
	});

	test('degrades gracefully when arguments cannot be stringified', () => {
		const cyclic: any = {};
		cyclic.self = cyclic;
		assert.match(toGeminiToolCallTranscriptText({ toolName: 't', input: cyclic }, 'c'), /^Tool call \(c\): t\nArguments: /);
	});

	test('collapses consecutive tool results into one user turn', () => {
		const { contents } = toGeminiContents([
			{ role: 'user', content: 'hi' },
			{ role: 'assistant', content: '', toolCalls: [{ id: 'c1', toolName: 'ListDir', input: {} }] },
			{ role: 'tool', toolCallId: 'c1', toolName: 'ListDir', content: 'a.ts' },
			{ role: 'tool', toolCallId: 'c2', toolName: 'ReadFile', content: 'body' }
		]);
		assert.deepEqual(contents.map((c: any) => c.role), ['user', 'model', 'user']);
		assert.equal(contents[2].parts.length, 2);
		assert.equal(contents[1].parts[0].text, 'Tool call (c1): ListDir\nArguments: {}');
	});

	test('hoists system messages into systemInstruction', () => {
		const { contents, systemInstruction } = toGeminiContents([
			{ role: 'system', content: 'be brief' },
			{ role: 'user', content: 'hi' }
		]);
		assert.equal(systemInstruction.parts[0].text, 'be brief');
		assert.deepEqual(contents.map((c: any) => c.role), ['user']);
	});

	test('synthesises a tool call id when the provider omitted one', () => {
		const { contents } = toGeminiContents([
			{ role: 'assistant', content: '', toolCalls: [{ toolName: 'Grep', input: {} }] }
		]);
		assert.match(contents[0].parts[0].text, /^Tool call \(call_0_0\): Grep/);
	});

	test('inlines base64 data-URL images and drops other parts', () => {
		const { contents } = toGeminiContents([
			{
				role: 'user',
				content: [
					{ type: 'text', text: 'look' },
					{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
					{ type: 'image_url', image_url: { url: 'https://a.test/x.png' } }
				]
			}
		]);
		assert.deepEqual(contents[0].parts, [
			{ text: 'look' },
			{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }
		]);
	});

	test('messageContentToText keeps only text parts', () => {
		assert.equal(messageContentToText('plain'), 'plain');
		assert.equal(messageContentToText([{ type: 'text', text: 'a' }, { type: 'image_url' }, { type: 'text', text: 'b' }]), 'a\nb');
		assert.equal(messageContentToText(undefined), '');
	});
});
