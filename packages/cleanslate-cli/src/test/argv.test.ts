/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseArguments } from '../argv.js';

describe('CLI argv', () => {
	test('parses a task and provider settings', () => {
		const args = parseArguments([
			'--provider', 'anthropic',
			'--model', 'claude-test',
			'--reasoning', 'high',
			'fix', 'the', 'tests'
		], { ANTHROPIC_API_KEY: 'secret' });

		assert.equal(args.task, 'fix the tests');
		assert.equal(args.provider, 'anthropic');
		assert.equal(args.model, 'claude-test');
		assert.equal(args.apiKey, 'secret');
		assert.equal(args.reasoningLevel, 'high');
	});

	test('rejects unknown options and invalid turn bounds', () => {
		assert.throws(() => parseArguments(['--wat']), /Unknown option/);
		assert.throws(() => parseArguments(['--max-turns', '0', 'task']), /positive integer/);
	});

	test('infers Anthropic only when it is the sole configured key', () => {
		const args = parseArguments(['task'], {
			ANTHROPIC_API_KEY: 'secret',
			ANTHROPIC_MODEL: 'claude-test'
		});
		assert.equal(args.provider, 'anthropic');
		assert.equal(args.model, 'claude-test');
	});

	test('parses interactive session controls', () => {
		const args = parseArguments([
			'--tui',
			'--resume',
			'--session', 'session-123',
			'--list-sessions',
			'--setup'
		], {});
		assert.equal(args.tui, true);
		assert.equal(args.resume, true);
		assert.equal(args.sessionId, 'session-123');
		assert.equal(args.listSessions, true);
		assert.equal(args.setup, true);
	});

	test('supports Azure aliases and extended reasoning levels', () => {
		const args = parseArguments([
			'--provider', 'azure',
			'--model', 'deployment',
			'--azure-endpoint', 'https://example.openai.azure.com',
			'--reasoning', 'xhigh'
		], { AZURE_OPENAI_API_KEY: 'secret' });
		assert.equal(args.provider, 'azureOpenAI');
		assert.equal(args.azureEndpoint, 'https://example.openai.azure.com');
		assert.equal(args.reasoningLevel, 'xhigh');
		assert.equal(args.apiKey, 'secret');
	});
});
