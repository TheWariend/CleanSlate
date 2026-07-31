/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseArguments } from '../argv.js';

describe('CLI argv', () => {
	test('defaults fresh installs to the managed CleanSlate provider', () => {
		const defaults = parseArguments([], {});
		assert.equal(defaults.provider, 'cleanslate');
		assert.equal(defaults.reasoningLevel, 'minimal');
		assert.equal(parseArguments([], { OPENAI_API_KEY: 'secret' }).provider, 'openai');
	});

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
		assert.equal(args.apiKeySpecified, false);
	});

	test('tracks command-line API keys separately from environment credentials', () => {
		const explicit = parseArguments(['--provider', 'openai', '--api-key', 'command-line-secret'], {});
		const environment = parseArguments(['--provider', 'openai'], { OPENAI_API_KEY: 'environment-secret' });

		assert.equal(explicit.apiKeySpecified, true);
		assert.equal(explicit.apiKey, 'command-line-secret');
		assert.equal(environment.apiKeySpecified, false);
		assert.equal(environment.apiKey, 'environment-secret');
	});

	test('rejects unknown options and invalid turn bounds', () => {
		assert.throws(() => parseArguments(['--wat']), /Unknown option/);
		assert.throws(() => parseArguments(['--max-turns', '0', 'task']), /positive integer/);
		assert.throws(() => parseArguments(['--permission-mode', 'unsafe']), /read-only, default, full/);
	});

	test('parses permission modes explicitly', () => {
		const args = parseArguments(['--permission-mode', 'read-only', 'inspect'], {});
		assert.equal(args.permissionMode, 'read-only');
		assert.equal(args.permissionSpecified, true);
	});

	test('JSON output selects the non-interactive surface', () => {
		const args = parseArguments(['--json', 'inspect'], {});
		assert.equal(args.json, true);
		assert.equal(args.tui, false);
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
			'--delete-session', 'old-session',
			'--setup',
			'--doctor',
			'--auth-list',
			'--logout'
		], {});
		assert.equal(args.tui, true);
		assert.equal(args.resume, true);
		assert.equal(args.sessionId, 'session-123');
		assert.equal(args.listSessions, true);
		assert.equal(args.deleteSessionId, 'old-session');
		assert.equal(args.setup, true);
		assert.equal(args.doctor, true);
		assert.equal(args.listCredentials, true);
		assert.equal(args.logout, true);
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

		const embeddings = parseArguments([], {
			CLEANSLATE_EMBEDDING_PROVIDER: 'azure',
			CLEANSLATE_EMBEDDING_MODEL: 'embedding-deployment',
			AZURE_OPENAI_EMBEDDING_ENDPOINT: 'https://embedding.openai.azure.com',
			AZURE_OPENAI_API_KEY: 'embedding-secret'
		});
		assert.equal(embeddings.embeddingProvider, 'azureOpenAI');
		assert.equal(embeddings.azureEmbeddingDeploymentName, 'embedding-deployment');
		assert.equal(embeddings.embeddingApiKey, 'embedding-secret');
	});
});
