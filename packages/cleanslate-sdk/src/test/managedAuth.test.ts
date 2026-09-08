/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authenticateCleanSlateInBrowser } from '../node/cleanSlateManagedAuth.js';

test('SDK browser sign-in opens and polls the device authorization flow', async () => {
	let polls = 0;
	let opened = '';
	const fetcher = (async (input: string | URL | Request) => {
		const url = String(input);
		if (url.endsWith('/auth/device')) {
			return Response.json({ device_code: 'device', verification_uri_complete: 'https://example.test/verify', interval: 1 });
		}
		if (url.endsWith('/auth/device/token')) {
			polls++;
			return polls === 1 ? Response.json({ error: 'authorization_pending' }, { status: 428 }) : Response.json({ token: 'browser-token' });
		}
		return Response.json({ data: { managed_ai: true, models: [] } });
	}) as typeof fetch;

	const result = await authenticateCleanSlateInBrowser({
		apiBaseUrl: 'https://api.example.test/api',
		fetcher,
		openBrowser: url => { opened = url; },
		sleep: async () => undefined
	});

	assert.equal(opened, 'https://example.test/verify');
	assert.equal(polls, 2);
	assert.equal(result.token, 'browser-token');
});

test('SDK managed authentication rejects insecure remote API endpoints', async () => {
	await assert.rejects(
		() => authenticateCleanSlateInBrowser({ apiBaseUrl: 'http://api.example.test/api' }),
		/authentication requires HTTPS/
	);
});

test('SDK managed authentication rejects credentials in API URLs', async () => {
	await assert.rejects(
		() => authenticateCleanSlateInBrowser({ apiBaseUrl: 'https://user:secret@api.example.test/api' }),
		/cannot contain credentials/
	);
});

test('SDK managed authentication rejects non-HTTP browser URLs, including localhost', async () => {
	const fetcher = (async () => Response.json({
		device_code: 'device',
		verification_uri_complete: 'file://localhost/tmp/sign-in'
	})) as typeof fetch;
	await assert.rejects(
		() => authenticateCleanSlateInBrowser({ apiBaseUrl: 'https://api.example.test/api', fetcher }),
		/insecure device authorization URL/
	);
});
