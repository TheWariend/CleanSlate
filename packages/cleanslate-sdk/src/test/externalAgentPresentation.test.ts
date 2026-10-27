/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { coalesceExternalAgentTranscript, externalAgentDisplayText } from '../externalAgents/externalAgentPresentation.js';
import type { ICleanSlatePersistedThreadMessage } from '../protocol/cleanSlateAI.js';

const tool = (id: string): ICleanSlatePersistedThreadMessage => ({ role: 'assistant', content: `Tool: exec_command\nTool result (${id}):\npassed`,
	renderPayload: JSON.stringify({ timeline: [{ id, type: 'tool', externalTool: true, toolStatus: 'completed', output: 'passed', content: 'Run tests' }] }) });

test('import presentation groups protocol rows by user turn while retaining ordered tools and handoff history', () => {
	const history = [
		{ role: 'user', content: 'Fix Store' }, { role: 'assistant', content: 'Checking Store.' }, tool('first'), tool('second'),
		{ role: 'assistant', content: 'Fixed Store.' }, { role: 'user', content: 'Add docs' }, tool('docs'), { role: 'assistant', content: 'Added docs.' }
	];
	const original = JSON.stringify(history);
	const transcript = coalesceExternalAgentTranscript(history);
	assert.deepEqual(transcript.map(message => message.role), ['user', 'assistant', 'user', 'assistant']);
	const first = JSON.parse(transcript[1].renderPayload!);
	assert.deepEqual(first.timeline.map((block: { content: string }) => block.content), ['Checking Store.', 'Run tests', 'Run tests', 'Fixed Store.']);
	assert.equal(first.timeline[1].output, 'passed');
	assert.equal(transcript[1].content, 'Checking Store.\n\nFixed Store.');
	assert.equal(JSON.stringify(history), original);
	assert.deepEqual(coalesceExternalAgentTranscript(transcript), transcript);
});

test('native turns, questions, hosted checkpoints, images and agent handoffs retain message boundaries', () => {
	for (const boundary of [
		{ role: 'user', content: 'Next' }, { role: 'assistant', content: 'Conversation handed off to Slate.' },
		{ role: 'assistant', content: 'Question', renderPayload: JSON.stringify({ timeline: [], planning_question: { question: 'Choose' } }) },
		{ role: 'assistant', content: 'Plan', renderPayload: JSON.stringify({ timeline: [{ id: 'plan', type: 'summary', content: 'Plan' }], to_do: ['Add docs'] }) },
		{ role: 'assistant', content: 'Code', renderPayload: JSON.stringify({ timeline: [{ id: 'code', type: 'summary', content: 'Code' }], code_snippet: 'const x = 1;' }) },
		{ role: 'assistant', content: 'Image', images: ['data:image/png;base64,aGVsbG8='] },
		{ role: 'assistant', content: 'Checkpoint', id: 'hosted-run' }, { role: 'assistant', content: 'Internal', isInternalState: true },
		{ role: 'assistant', content: 'Malformed', renderPayload: '{unfinished' }
	]) {
		const history = [tool('first'), boundary, tool('last')];
		assert.deepEqual(coalesceExternalAgentTranscript(history), history);
	}
	const native = [{ role: 'assistant', content: 'Progress' }, { role: 'assistant', content: 'Done' }];
	assert.deepEqual(coalesceExternalAgentTranscript(native), native);
});

test('Codex app markers disappear from prose, including streaming and multiline markers, while code examples survive', () => {
	const marker = '<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>';
	assert.equal(externalAgentDisplayText(`Done.\n\n${marker}\nNext.`), 'Done.\n\n\nNext.');
	assert.equal(externalAgentDisplayText(marker), '');
	assert.equal(externalAgentDisplayText('<external_codex_apps_open_page>\n    {"page_id":null}\n</external_codex_apps_open_page>'), '');
	for (let length = '<external_'.length; length <= marker.length; length++) {
		assert.equal(externalAgentDisplayText(marker.slice(0, length), true), '');
	}
	for (const example of [`\`\`\`xml\n${marker}\n\`\`\``, `~~~xml\n${marker}\n~~~`, `    ${marker}`, `\`${marker}\``, `The marker is ${marker}.`]) {
		assert.equal(externalAgentDisplayText(example), example);
	}
	assert.equal(externalAgentDisplayText('Use <custom_element> normally.'), 'Use <custom_element> normally.');
});
