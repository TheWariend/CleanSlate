/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { CleanSlateNodeIndexService } from '../node/cleanSlateNodeIndexService.js';

test('Node code index ranks relevant source chunks and skips dependencies', async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-index-'));
	try {
		fs.writeFileSync(path.join(root, 'invoice.ts'), 'export function calculateInvoiceTotal(items: number[]) { return items.reduce((a, b) => a + b, 0); }');
		fs.writeFileSync(path.join(root, 'unrelated.ts'), 'export const greeting = "hello";');
		fs.mkdirSync(path.join(root, 'node_modules'));
		fs.writeFileSync(path.join(root, 'node_modules', 'ignored.ts'), 'calculateInvoiceTotal calculateInvoiceTotal');
		const requests: Array<{ url: string; body?: string }> = [];
		const index = new CleanSlateNodeIndexService(root, {
			configuration: {
				provider: 'openai',
				embeddingProvider: 'openai',
				embeddingModel: 'verified-embedding-model',
				providers: { openai: { apiKey: 'test-key', baseUrl: 'https://embedding.test/v1' } }
			},
			embeddingTransport: {
				request: async request => {
					requests.push({ url: request.url, body: request.body });
					const inputs = JSON.parse(request.body || '{}').input as string[];
					return {
						statusCode: 200,
						data: JSON.stringify({
							data: inputs.map((text, itemIndex) => ({
								index: itemIndex,
								embedding: /invoice|calculate|total/i.test(text) ? [1, 0] : [0, 1]
							}))
						})
					};
				}
			},
			logger: { debug() { }, info() { }, warn() { }, error() { } }
		});
		const results = await index.search('invoice amount', 5, 0.9);
		assert.equal(results.length > 0, true);
		assert.equal(results[0]?.uri.fsPath, path.join(root, 'invoice.ts'));
		assert.equal(results.some(result => result.uri.fsPath.includes('node_modules')), false);
		assert.equal(requests.every(request => request.url === 'https://embedding.test/v1/embeddings'), true);
		assert.equal(requests.some(request => JSON.parse(request.body || '{}').model === 'verified-embedding-model'), true);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
