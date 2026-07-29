/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authenticateCleanSlateInBrowser, signInToCleanSlate } from '../managedAuth.js';

test('CleanSlate account sign-in exchanges credentials for managed models', async () => {
	const requests: Array<{ url: string; init?: RequestInit }> = [];
	const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		requests.push({ url, init });
		if (url.endsWith('/auth/login')) {
			return Response.json({ token: 'managed-token' });
		}
		return Response.json({
			data: { managed_ai: true, models: [{ id: 'managed-model', name: 'Managed Model' }] }
		});
	}) as typeof fetch;

	const result = await signInToCleanSlate(
		'user@example.com',
		'password',
		{ CLEANSLATE_API_BASE_URL: 'https://api.example.test/api/' },
		fetcher
	);

	assert.equal(result.token, 'managed-token');
	assert.equal(result.entitlements.models?.[0]?.id, 'managed-model');
	assert.equal(requests[0]?.url, 'https://api.example.test/api/auth/login');
	assert.equal(JSON.parse(String(requests[0]?.init?.body)).source, 'cleanslate-cli');
	assert.equal((requests[1]?.init?.headers as Record<string, string>).Authorization, 'Bearer managed-token');
});

test('CleanSlate sign-in surfaces server validation errors', async () => {
	const fetcher = (async () => Response.json({
		message: 'The provided credentials are incorrect.'
	}, { status: 422 })) as typeof fetch;

	await assert.rejects(
		() => signInToCleanSlate('user@example.com', 'wrong', {}, fetcher),
		/The provided credentials are incorrect/
	);
});

test('browser authentication opens TheWariend and polls the one-time device exchange', async () => {
	const requests: string[] = [];
	let tokenPolls = 0;
	let openedUrl = '';
	const fetcher = (async (input: string | URL | Request) => {
		const url = String(input);
		requests.push(url);
		if (url.endsWith('/auth/device')) {
			return Response.json({
				device_code: 'secret-device-code',
				verification_uri_complete: 'https://thewariend.com/auth?device_code=public-flow',
				expires_in: 600,
				interval: 1
			});
		}
		if (url.endsWith('/auth/device/token')) {
			tokenPolls += 1;
			return tokenPolls === 1
				? Response.json({ error: 'authorization_pending' }, { status: 428 })
				: Response.json({ token: 'browser-token' });
		}
		return Response.json({
			data: { managed_ai: true, models: [{ id: 'managed-model', name: 'Managed Model' }] }
		});
	}) as typeof fetch;

	const result = await authenticateCleanSlateInBrowser({
		env: { CLEANSLATE_API_BASE_URL: 'https://api.example.test/api' },
		fetcher,
		openBrowser: url => { openedUrl = url; },
		sleep: async () => undefined
	});

	assert.equal(openedUrl, 'https://thewariend.com/auth?device_code=public-flow');
	assert.equal(result.token, 'browser-token');
	assert.equal(result.entitlements.models?.[0]?.id, 'managed-model');
	assert.equal(tokenPolls, 2);
	assert.deepEqual(requests, [
		'https://api.example.test/api/auth/device',
		'https://api.example.test/api/auth/device/token',
		'https://api.example.test/api/auth/device/token',
		'https://api.example.test/api/cleanslate/entitlements'
	]);
});

test('browser authentication explains a missing server device-auth route', async () => {
	const fetcher = (async () => Response.json({
		message: 'The route api/auth/device could not be found.'
	}, { status: 404 })) as typeof fetch;

	await assert.rejects(
		() => authenticateCleanSlateInBrowser({
			env: { CLEANSLATE_API_BASE_URL: 'https://api.example.test/api' },
			fetcher
		}),
		/server is missing the device-auth routes/
	);
});
