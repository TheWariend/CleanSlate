/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	buildCleanSlateRuntimeConfig,
	CleanSlateEnvLookup,
	normalizeBaseUrlValue,
	normalizeEnvValue,
	resolveCleanSlateUrl
} from '../protocol/cleanSlateRuntimeConfig.js';

function envFrom(values: Record<string, string>): CleanSlateEnvLookup {
	return name => normalizeEnvValue(values[name]);
}

describe('runtime config resolution', () => {
	test('falls back to shipped defaults when nothing is set', () => {
		const config = buildCleanSlateRuntimeConfig(envFrom({}));
		assert.equal(config.apiBaseUrl, 'https://api.thewariend.com/api');
		assert.equal(config.authWebUrl, 'https://thewariend.com/auth');
		assert.equal(config.proCheckoutUrl, 'https://api.thewariend.com/checkout/cleanslate/pro');
	});

	test('derives the managed base from the API base so both track one deployment', () => {
		const config = buildCleanSlateRuntimeConfig(envFrom({ CLEANSLATE_API_BASE_URL: 'https://staging.test/api' }));
		assert.equal(config.managedAIBaseUrl, 'https://staging.test/api/cleanslate');
	});

	test('strips trailing slashes so joined paths never contain //', () => {
		const config = buildCleanSlateRuntimeConfig(envFrom({ CLEANSLATE_API_BASE_URL: 'https://staging.test/api///' }));
		assert.equal(config.apiBaseUrl, 'https://staging.test/api');
		assert.equal(config.managedAIBaseUrl, 'https://staging.test/api/cleanslate');
	});

	test('blank overrides are treated as unset rather than as an empty URL', () => {
		const config = buildCleanSlateRuntimeConfig(envFrom({ CLEANSLATE_API_BASE_URL: '   ' }));
		assert.equal(config.apiBaseUrl, 'https://api.thewariend.com/api');
	});

	test('rejects a non-absolute override instead of requesting a nonsense host', () => {
		assert.throws(
			() => resolveCleanSlateUrl('CLEANSLATE_API_BASE_URL', 'https://a.test', envFrom({ CLEANSLATE_API_BASE_URL: '/api' })),
			/must be an absolute HTTP\(S\) URL/
		);
	});

	test('rejects a non-HTTP scheme', () => {
		assert.throws(
			() => resolveCleanSlateUrl('CLEANSLATE_API_BASE_URL', 'https://a.test', envFrom({ CLEANSLATE_API_BASE_URL: 'ftp://a.test' })),
			/must use HTTP or HTTPS/
		);
	});

	test('normalizeEnvValue trims but leaves a non-URL value intact', () => {
		assert.equal(normalizeEnvValue('  a/b/  '), 'a/b/');
		assert.equal(normalizeEnvValue('   '), undefined);
		assert.equal(normalizeEnvValue(undefined), undefined);
	});

	test('normalizeBaseUrlValue drops only trailing slashes', () => {
		assert.equal(normalizeBaseUrlValue('  https://a.test/v1/  '), 'https://a.test/v1');
		assert.equal(normalizeBaseUrlValue('///'), undefined);
	});
});
