/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'cleanslate-test', version: '1.0.0' });
server.registerTool('echo', {
	description: 'Echo text',
	inputSchema: { text: z.string() },
	annotations: { readOnlyHint: true }
}, async ({ text }) => ({
	content: [{ type: 'text', text }]
}));
await server.connect(new StdioServerTransport());
