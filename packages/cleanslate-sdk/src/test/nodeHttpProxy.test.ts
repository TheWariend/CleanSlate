/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import * as http from 'node:http';
import * as net from 'node:net';
import { describe, test } from 'node:test';
import { getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { CancellationToken } from '../core/cancellation.js';
import { VSBuffer } from '../core/buffer.js';
import { NodeCleanSlateMainService } from '../node/cleanSlateNodeMainService.js';
import { CleanSlateNodeHttpTransport, proxyUrlFor } from '../node/cleanSlateNodeHttpTransport.js';

function lookup(values: Record<string, string>): (name: string) => string | undefined {
	return name => values[name];
}

async function listen(server: http.Server): Promise<number> {
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => resolve());
	});
	const address = server.address();
	assert.ok(address && typeof address === 'object');
	return address.port;
}

async function close(server: http.Server): Promise<void> {
	await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

describe('Node host proxy transport', () => {
	test('uses the original fetch path when no proxy variable is set', async () => {
		const originalFetch = globalThis.fetch;
		let called = false;
		globalThis.fetch = async () => {
			called = true;
			return new Response('direct');
		};
		try {
			const transport = new CleanSlateNodeHttpTransport(lookup({}));
			assert.equal(transport.usesProxy, false);
			assert.equal(await (await transport.fetch('https://example.test')).text(), 'direct');
			assert.equal(called, true);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test('selects protocol proxies and applies NO_PROXY host, suffix, and port entries', () => {
		const environment = {
			httpProxy: 'http://http-proxy.test:8080',
			httpsProxy: 'http://https-proxy.test:8443',
			noProxy: 'exact.test,.internal.test,port.test:9443'
		};
		assert.equal(proxyUrlFor(new URL('http://public.test'), environment), environment.httpProxy);
		assert.equal(proxyUrlFor(new URL('https://public.test'), environment), environment.httpsProxy);
		assert.equal(proxyUrlFor(new URL('https://exact.test'), environment), undefined);
		assert.equal(proxyUrlFor(new URL('https://api.internal.test'), environment), undefined);
		assert.equal(proxyUrlFor(new URL('https://port.test:9443'), environment), undefined);
		assert.equal(proxyUrlFor(new URL('https://port.test'), environment), environment.httpsProxy);
	});

	test('proxyRequest and proxyStream traverse a real forward proxy while NO_PROXY bypasses it', async () => {
		const origin = http.createServer((request, response) => {
			response.writeHead(200, { 'content-type': 'text/plain', 'x-request-path': request.url ?? '' });
			response.end(`origin:${request.url}`);
		});
		let proxyConnections = 0;
		const proxy = http.createServer();
		proxy.on('connect', (request, clientSocket, head) => {
			proxyConnections++;
			const [hostname, rawPort] = (request.url ?? '').split(':');
			const upstream = net.connect(Number(rawPort), hostname, () => {
				clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
				if (head.length > 0) {
					upstream.write(head);
				}
				upstream.pipe(clientSocket);
				clientSocket.pipe(upstream);
			});
			upstream.on('error', () => clientSocket.destroy());
		});

		const originPort = await listen(origin);
		const proxyPort = await listen(proxy);
		const url = `http://127.0.0.1:${originPort}/proxy-check`;
		let proxied: NodeCleanSlateMainService | undefined;
		let bypassed: NodeCleanSlateMainService | undefined;
		try {
			proxied = new NodeCleanSlateMainService('/tmp', lookup({
				HTTP_PROXY: `http://127.0.0.1:${proxyPort}`
			}));
			const buffered = await proxied.proxyRequest({ url }, CancellationToken.None);
			assert.equal(buffered.res.statusCode, 200);
			assert.equal(buffered.data, 'origin:/proxy-check');
			assert.equal(proxyConnections, 1);

			const streamed = await new Promise<string>((resolve, reject) => {
				let value = '';
				const subscription = proxied!.proxyStream({ url }, CancellationToken.None)(frame => {
					if (frame === null) {
						subscription.dispose();
						resolve(value);
					} else if (typeof frame === 'string') {
						reject(new Error(frame));
					} else {
						value += (frame as VSBuffer).toString();
					}
				});
			});
			assert.equal(streamed, 'origin:/proxy-check');
			assert.ok(proxyConnections >= 1);

			const originalDispatcher = getGlobalDispatcher();
			try {
				(proxied as any).httpTransport.ensureGlobalDispatcher();
				assert.equal(await (await globalThis.fetch(url)).text(), 'origin:/proxy-check');
			} finally {
				setGlobalDispatcher(originalDispatcher);
			}

			const proxyConnectionsBeforeBypass = proxyConnections;
			bypassed = new NodeCleanSlateMainService('/tmp', lookup({
				HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
				NO_PROXY: '127.0.0.1'
			}));
			assert.equal((await bypassed.proxyRequest({ url }, CancellationToken.None)).data, 'origin:/proxy-check');
			assert.equal(proxyConnections, proxyConnectionsBeforeBypass);
		} finally {
			await Promise.all([
				(proxied as any)?.httpTransport?.dispatcher?.destroy(),
				(bypassed as any)?.httpTransport?.dispatcher?.destroy()
			].filter(Boolean));
			await Promise.all([close(origin), close(proxy)]);
		}
	});

	test('adds proxy hooks only to proxy-configured provider clients', async () => {
		let directOptions: any;
		const direct = new NodeCleanSlateMainService('/tmp', lookup({}));
		(direct as any).importExternalModule = async () => ({
			OpenAI: class { constructor(options: any) { directOptions = options; } }
		});
		await (direct as any).createOpenAICompatibleClient({ providerName: 'OpenAI', apiKey: 'key' });
		assert.equal(directOptions.fetch, undefined);

		let proxyOptions: any;
		const proxied = new NodeCleanSlateMainService('/tmp', lookup({ HTTP_PROXY: 'http://proxy.test:8080' }));
		(proxied as any).importExternalModule = async () => ({
			OpenAI: class { constructor(options: any) { proxyOptions = options; } }
		});
		await (proxied as any).createOpenAICompatibleClient({ providerName: 'OpenAI', apiKey: 'key' });
		assert.equal(typeof proxyOptions.fetch, 'function');
	});

	test('wires the shared proxy transport into Anthropic, Gemini, AWS, catalog, and web calls', async () => {
		const service = new NodeCleanSlateMainService('/tmp', lookup({ HTTPS_PROXY: 'http://proxy.test:8080' }));
		const transport = (service as any).httpTransport;
		let anthropicOptions: any;
		let geminiDispatcherInstalled = false;
		const awsHandler = { handle() { throw new Error('not called'); } };
		transport.ensureGlobalDispatcher = () => { geminiDispatcherInstalled = true; };
		transport.createAwsRequestHandler = () => awsHandler;
		(service as any).importExternalModule = async (specifier: string) => {
			if (specifier === '@anthropic-ai/sdk') {
				return { Anthropic: class { constructor(options: any) { anthropicOptions = options; } } };
			}
			if (specifier === '@google/genai') {
				return { GoogleGenAI: class { } };
			}
			throw new Error(`Unexpected module: ${specifier}`);
		};

		await (service as any).createAnthropicClient({ apiKey: 'key' });
		assert.equal(typeof anthropicOptions.fetch, 'function');
		await (service as any).createGeminiClient({ apiKey: 'key' });
		assert.equal(geminiDispatcherInstalled, true);
		assert.equal((await (service as any).createBedrockClientConfig({
			region: 'us-east-1',
			credentialMode: 'accessKey',
			accessKeyId: 'id',
			secretAccessKey: 'secret'
		})).requestHandler, awsHandler);

		const requestedUrls: string[] = [];
		transport.fetch = async (input: string | URL) => {
			requestedUrls.push(String(input));
			if (String(input).includes('models.dev')) {
				return new Response(JSON.stringify({
					openai: { models: { 'proxy-test': { id: 'proxy-test', reasoning: true } } }
				}), { status: 200 });
			}
			return new Response(JSON.stringify({
				result: { content: [{ text: 'Result: https://example.com proxied result' }] }
			}), { status: 200, headers: { 'content-type': 'application/json' } });
		};
		assert.equal((await service.getModelsDevModelMetadata('openai', 'proxy-test', CancellationToken.None))?.reasoning, true);
		assert.equal((await service.webSearch({
			query: 'proxy test',
			providerOrder: ['exaMcpAnonymous']
		}, CancellationToken.None)).success, true);
		assert.ok(requestedUrls.some(url => url.includes('models.dev')));
		assert.ok(requestedUrls.some(url => url.includes('mcp.exa.ai')));
	});
});
