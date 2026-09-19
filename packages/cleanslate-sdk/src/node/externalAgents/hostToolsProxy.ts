/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { CLEANSLATE_SDK_VERSION } from './externalAgentVersion.js';

const endpoint = new URL(process.env['CLEANSLATE_HOST_TOOL_URL'] ?? '');
const token = process.env['CLEANSLATE_HOST_TOOL_TOKEN'];
if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !token) { throw new Error('Missing IDE tool connection.'); }
const client = new Client({ name: 'CleanSlate agent bridge', version: CLEANSLATE_SDK_VERSION });
await client.connect(new StreamableHTTPClientTransport(endpoint, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
const server = new Server({ name: 'CleanSlate IDE', version: CLEANSLATE_SDK_VERSION }, { capabilities: { tools: {} }, instructions: client.getInstructions() });
server.setRequestHandler(ListToolsRequestSchema, () => client.listTools());
// The IDE owns the request deadline (including time spent answering a question).
// Do not let the proxy's shorter default timeout abandon a still-visible request.
server.setRequestHandler(CallToolRequestSchema, ({ params }, extra) => client.callTool(params, undefined, { timeout: 125000, signal: extra.signal }));
process.stdin.once('end', () => { void client.close(); });
await server.connect(new StdioServerTransport());
