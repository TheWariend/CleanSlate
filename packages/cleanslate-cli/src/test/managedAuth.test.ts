/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signInToCleanSlate } from '../managedAuth.js';

test('CleanSlate account sign-in exchanges credentials for managed models', async () => {
	const requests: Array<{ url: string; init?: RequestInit }> = [];
	const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		requests.push({ url, init });
		if (url.endsWith('/auth/login')) {
			return new Response(JSON.stringify({ token: 'managed-token' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		return new Response(JSON.stringify({
			data: { managed_ai: true, models: [{ id: 'managed-model', name: 'Managed Model' }] }
		}), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
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
	const fetcher = (async () => new Response(JSON.stringify({
		message: 'The provided credentials are incorrect.'
	}), {
		status: 422,
		headers: { 'Content-Type': 'application/json' }
	})) as typeof fetch;

	await assert.rejects(
		() => signInToCleanSlate('user@example.com', 'wrong', {}, fetcher),
		/The provided credentials are incorrect/
	);
});
