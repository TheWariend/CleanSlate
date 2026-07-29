/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { CleanSlateNodeMcpClient } from '../node/cleanSlateNodeMcpClient.js';

test('Node MCP client discovers and invokes stdio tools', async () => {
	const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mcpServer.js');
	const client = new CleanSlateNodeMcpClient(process.cwd(), [{
		name: 'fixture',
		command: process.execPath,
		args: [fixture]
	}]);
	try {
		const tools = await client.getTools();
		assert.equal(tools.length, 1);
		assert.equal(tools[0]?.name, 'mcp_fixture_echo');
		assert.equal(tools[0]?.readOnlyHint, true);
		const result: any = await client.executeTool('mcp_fixture_echo', { text: 'hello' });
		assert.equal(result.content[0]?.text, 'hello');
	} finally {
		await client.dispose();
	}
});
