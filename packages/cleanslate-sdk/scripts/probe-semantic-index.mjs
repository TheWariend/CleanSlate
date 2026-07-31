#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { CleanSlateNodeIndexService } from '../dist/node/cleanSlateNodeIndexService.js';

const fake = process.env.CLEANSLATE_EMBEDDING_PROBE_FAKE === '1';
const provider = process.env.CLEANSLATE_EMBEDDING_PROVIDER || 'openai';
const model = process.env.CLEANSLATE_EMBEDDING_MODEL || (provider === 'gemini' ? 'gemini-embedding-001' : 'text-embedding-3-small');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-semantic-probe-'));
let server;

try {
	fs.writeFileSync(path.join(root, 'invoice.ts'), [
		'export function calculateInvoiceTotal(items) {',
		'  return items.reduce((sum, item) => sum + item.price, 0);',
		'}'
	].join('\n'));
	fs.writeFileSync(path.join(root, 'greeting.ts'), 'export const greeting = "hello from an unrelated module";');

	let baseUrl = process.env.CLEANSLATE_EMBEDDING_BASE_URL;
	let apiKey = process.env.CLEANSLATE_EMBEDDING_API_KEY;
	if (fake) {
		server = http.createServer(async (request, response) => {
			let body = '';
			for await (const chunk of request) body += chunk;
			const inputs = JSON.parse(body).input;
			response.setHeader('content-type', 'application/json');
			response.end(JSON.stringify({ data: inputs.map((text, index) => ({
				index,
				embedding: /invoice|calculate|total|amount/i.test(text) ? [1, 0] : [0, 1]
			})) }));
		});
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
		apiKey = 'local-probe';
	}

	if (provider !== 'openai') {
		throw new Error('This probe currently exercises the OpenAI-compatible endpoint. Set CLEANSLATE_EMBEDDING_PROVIDER=openai.');
	}
	if (!baseUrl || !apiKey) {
		throw new Error('Set CLEANSLATE_EMBEDDING_BASE_URL and CLEANSLATE_EMBEDDING_API_KEY, or set CLEANSLATE_EMBEDDING_PROBE_FAKE=1.');
	}

	const index = new CleanSlateNodeIndexService(root, {
		configuration: {
			provider: 'openai',
			embeddingProvider: 'openai',
			embeddingModel: model,
			providers: { openai: { baseUrl, apiKey } }
		},
		embeddingTransport: {
			request: async request => {
				const controller = new AbortController();
				const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
				try {
					const response = await fetch(request.url, {
						method: request.method,
						headers: request.headers,
						body: request.body,
						signal: controller.signal
					});
					return { statusCode: response.status, data: await response.text() };
				} finally {
					clearTimeout(timeout);
				}
			}
		},
		logger: { debug() { }, info() { }, warn() { }, error: message => console.error(message) }
	});

	const results = await index.search('invoice amount', 2, 0.9);
	assert.equal(results[0]?.uri.fsPath, path.join(root, 'invoice.ts'));
	console.log(JSON.stringify({
		mode: fake ? 'local-endpoint' : 'configured-endpoint',
		provider,
		model,
		result: path.basename(results[0].uri.fsPath),
		score: results[0].score
	}));
} finally {
	if (server) await new Promise(resolve => server.close(resolve));
	fs.rmSync(root, { recursive: true, force: true });
}
