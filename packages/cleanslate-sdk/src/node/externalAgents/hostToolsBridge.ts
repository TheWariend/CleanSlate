/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import type { IExternalAgentHostTools } from './externalAgentSession.js';
import { CLEANSLATE_SDK_VERSION } from './externalAgentVersion.js';

export interface IExternalAgentHostTool {
	readonly definition: Tool;
	call(args: Record<string, unknown>): Promise<CallToolResult>;
}

/** A private endpoint shared only with one agent process through its MCP environment. */
export async function createHostToolsBridge(tools: readonly IExternalAgentHostTool[], release: () => Promise<void>): Promise<IExternalAgentHostTools> {
	const token = randomBytes(32).toString('hex');
	let disposed = false;
	let operations: Promise<unknown> = Promise.resolve();
	const server = createServer(async (request, response) => {
		if (disposed || request.url !== '/mcp' || request.headers.origin || request.headers.authorization !== `Bearer ${token}`) {
			response.writeHead(403).end(); return;
		}
		if (request.method !== 'POST') { response.writeHead(405).end(); return; }
		const protocol = new Server({ name: 'CleanSlate IDE', version: CLEANSLATE_SDK_VERSION }, {
			capabilities: { tools: {} },
			instructions: 'These tools belong to the current CleanSlate chat and workspace. Use the advertised tools for IDE operations. Browser tools control the visible browser in this chat; use them by default instead of a separate agent browser unless the user explicitly chooses another destination. Capabilities not present in this catalog are unavailable through this connection.'
		});
		protocol.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map(tool => tool.definition) }));
		protocol.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
			const tool = tools.find(candidate => candidate.definition.name === params.name);
			if (!tool) { throw new Error('Unknown IDE tool.'); }
			const operation = operations.then(async () => {
				if (disposed) { throw new Error('This agent session has closed.'); }
				return tool.call(params.arguments ?? {});
			});
			operations = operation.catch(() => undefined);
			return operation;
		});
		const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
		response.on('close', () => { void protocol.close(); });
		try {
			let size = 0;
			const chunks: Buffer[] = [];
			for await (const chunk of request) {
				size += chunk.length;
				if (size > 65536) { response.writeHead(413).end(); return; }
				chunks.push(Buffer.from(chunk));
			}
			const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
			await protocol.connect(transport);
			await transport.handleRequest(request, response, body);
		} catch {
			if (!response.headersSent) { response.writeHead(400).end(); }
			else { response.end(); }
		}
	});
	server.requestTimeout = 15000;
	await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
	const address = server.address();
	if (!address || typeof address === 'string') { server.close(); throw new Error('Could not create the IDE tool connection.'); }
	return {
		servers: [{ name: 'cleanslate-ide', command: process.execPath,
			args: [fileURLToPath(new URL('./hostToolsProxy.js', import.meta.url))],
			env: [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }, { name: 'CLEANSLATE_HOST_TOOL_URL', value: `http://127.0.0.1:${address.port}/mcp` }, { name: 'CLEANSLATE_HOST_TOOL_TOKEN', value: token }] }],
		async dispose() {
			if (disposed) { return; }
			disposed = true;
			server.closeAllConnections();
			await new Promise<void>(resolve => server.close(() => resolve()));
			await operations;
			await release();
		}
	};
}
