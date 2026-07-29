/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CancellationToken } from '../core/cancellation.js';
import { CleanSlateNodeWebRetrieval, assertPublicUrl } from '../node/cleanSlateNodeWebRetrieval.js';

describe('CleanSlateNodeWebRetrieval', () => {
	test('rejects local and private web targets', async () => {
		await assert.rejects(() => assertPublicUrl(new URL('http://localhost:3000')), /local\/private/);
		await assert.rejects(() => assertPublicUrl(new URL('http://127.0.0.1')), /private IP/);
		await assert.rejects(() => assertPublicUrl(new URL('http://10.0.0.1')), /private IP/);
	});

	test('parses anonymous MCP search results and citations', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => new Response(JSON.stringify({
			result: {
				content: [{ type: 'text', text: 'Result: https://example.com/docs useful documentation' }]
			}
		}), { status: 200, headers: { 'content-type': 'application/json' } });
		try {
			const retrieval = new CleanSlateNodeWebRetrieval();
			const result = await retrieval.search({
				query: 'example docs',
				providerOrder: ['exaMcpAnonymous']
			}, CancellationToken.None);
			assert.equal(result.success, true);
			assert.equal(result.provider, 'exaMcpAnonymous');
			assert.equal(result.results[0]?.url, 'https://example.com/docs');
			assert.equal(result.citations[0]?.url, 'https://example.com/docs');
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
