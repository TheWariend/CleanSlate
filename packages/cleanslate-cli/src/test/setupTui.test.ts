/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SUPPORTED_PROVIDERS } from '../argv.js';
import { providerSetupFieldKeys } from '../setupTui.js';

test('provider setup loads a model picker after collecting provider configuration', () => {
	for (const provider of SUPPORTED_PROVIDERS) {
		assert.equal(
			providerSetupFieldKeys(provider).includes('model'),
			false,
			`${provider} should choose its model in the catalog stage`
		);
	}
	assert.deepEqual(providerSetupFieldKeys('nvidia'), ['apiKey']);
	assert.deepEqual(providerSetupFieldKeys('azureOpenAI'), ['azureEndpoint', 'azureApiVersion', 'apiKey']);
});

test('provider setup skips credentials that are already saved', () => {
	assert.deepEqual(providerSetupFieldKeys('anthropic', true), []);
	assert.deepEqual(providerSetupFieldKeys('azureOpenAI', true), ['azureEndpoint', 'azureApiVersion']);
	assert.deepEqual(providerSetupFieldKeys('azureOpenAI', true, { azureEndpoint: 'https://example.openai.azure.com' }), []);
});
