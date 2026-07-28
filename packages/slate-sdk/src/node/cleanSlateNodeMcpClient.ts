/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CancellationToken } from '../core/cancellation.js';
import {
	IMCPClientService,
	MCPServerConfiguration,
	MCPTool
} from '../protocol/cleanSlateAI.js';

interface IDefinition extends MCPServerConfiguration {
	name: string;
}

interface IConnection {
	definition: IDefinition;
	client: Client;
	transport: StdioClientTransport;
	tools: MCPTool[];
}

export class CleanSlateNodeMcpClient implements IMCPClientService {
	declare readonly _serviceBrand: undefined;
	private readonly connections = new Map<string, IConnection>();

	constructor(
		private readonly rootPath: string,
		private readonly configured: Array<string | MCPServerConfiguration> = []
	) { }

	async getTools(token: CancellationToken = CancellationToken.None): Promise<MCPTool[]> {
		if (token.isCancellationRequested) {
			throw new Error('MCP discovery cancelled.');
		}
		for (const definition of this.definitions()) {
			if (!this.connections.has(definition.name)) {
				await this.connect(definition, token);
			}
		}
		return Array.from(this.connections.values()).flatMap(connection => connection.tools);
	}

	async executeTool(toolName: string, input: any, token: CancellationToken = CancellationToken.None): Promise<any> {
		let match = this.findTool(toolName);
		if (!match) {
			await this.getTools(token);
			match = this.findTool(toolName);
		}
		if (!match) {
			throw new Error(`MCP tool "${toolName}" was not found.`);
		}
		if (token.isCancellationRequested) {
			throw new Error('MCP tool call cancelled.');
		}
		return match.connection.client.callTool({
			name: match.tool.originalName ?? match.tool.name,
			arguments: input ?? {}
		});
	}

	async refreshServers(token: CancellationToken = CancellationToken.None): Promise<void> {
		await this.dispose();
		await this.getTools(token);
	}

	async dispose(): Promise<void> {
		const connections = [...this.connections.values()];
		this.connections.clear();
		await Promise.all(connections.map(async connection => {
			try {
				await connection.client.close();
			} catch {
				await connection.transport.close().catch(() => undefined);
			}
		}));
	}

	private async connect(definition: IDefinition, token: CancellationToken): Promise<void> {
		if (token.isCancellationRequested) {
			throw new Error('MCP connection cancelled.');
		}
		const transport = new StdioClientTransport({
			command: definition.command,
			args: definition.args,
			cwd: definition.cwd ? path.resolve(this.rootPath, definition.cwd) : this.rootPath,
			env: {
				...this.safeEnvironment(),
				...definition.env
			},
			stderr: 'pipe'
		});
		const client = new Client({ name: 'cleanslate-cli', version: '0.1.0' }, { capabilities: {} });
		await client.connect(transport);
		const listed = await client.listTools();
		const tools: MCPTool[] = listed.tools.map(tool => ({
			name: this.canonicalName(definition.name, tool.name),
			originalName: tool.name,
			serverName: definition.name,
			description: tool.description ?? '',
			inputSchema: tool.inputSchema,
			readOnlyHint: tool.annotations?.readOnlyHint,
			openWorldHint: tool.annotations?.openWorldHint
		}));
		this.connections.set(definition.name, { definition, client, transport, tools });
	}

	private definitions(): IDefinition[] {
		const values: unknown[] = [...this.configured];
		const workspaceConfig = path.join(this.rootPath, '.mcp.json');
		try {
			const parsed = JSON.parse(fs.readFileSync(workspaceConfig, 'utf8'));
			const map = parsed?.mcpServers ?? parsed?.servers ?? parsed;
			if (map && typeof map === 'object' && !Array.isArray(map)) {
				for (const [name, value] of Object.entries(map)) {
					values.push({ ...(value as object), name });
				}
			}
		} catch { /* workspace MCP config is optional */ }

		const definitions: IDefinition[] = [];
		for (let index = 0; index < values.length; index++) {
			const value = values[index];
			if (typeof value === 'string') {
				const [command, ...args] = this.parseCommandLine(value);
				if (command) {
					definitions.push({ name: `server-${index + 1}`, command, args });
				}
				continue;
			}
			if (!value || typeof value !== 'object') {
				continue;
			}
			const entry = value as MCPServerConfiguration;
			if (!entry.command?.trim()) {
				continue;
			}
			definitions.push({
				name: entry.name?.trim() || `server-${index + 1}`,
				command: entry.command.trim(),
				args: Array.isArray(entry.args) ? entry.args.filter(arg => typeof arg === 'string') : [],
				cwd: entry.cwd,
				env: entry.env
			});
		}
		return [...new Map(definitions.map(definition => [definition.name, definition])).values()];
	}

	private findTool(name: string): { connection: IConnection; tool: MCPTool } | undefined {
		const originalMatches: Array<{ connection: IConnection; tool: MCPTool }> = [];
		for (const connection of this.connections.values()) {
			for (const tool of connection.tools) {
				if (tool.name === name) {
					return { connection, tool };
				}
				if (tool.originalName === name) {
					originalMatches.push({ connection, tool });
				}
			}
		}
		return originalMatches.length === 1 ? originalMatches[0] : undefined;
	}

	private canonicalName(server: string, tool: string): string {
		return `mcp_${server}_${tool}`.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
	}

	private parseCommandLine(value: string): string[] {
		const parts: string[] = [];
		let current = '';
		let quote = '';
		let escaped = false;
		for (const character of value.trim()) {
			if (escaped) {
				current += character;
				escaped = false;
			} else if (character === '\\') {
				escaped = true;
			} else if (quote) {
				character === quote ? quote = '' : current += character;
			} else if (character === '"' || character === "'") {
				quote = character;
			} else if (/\s/.test(character)) {
				if (current) {
					parts.push(current);
					current = '';
				}
			} else {
				current += character;
			}
		}
		if (current) {
			parts.push(current);
		}
		return parts;
	}

	private safeEnvironment(): Record<string, string> {
		const allowed = ['PATH', 'HOME', 'USER', 'SHELL', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'ComSpec', 'PATHEXT'];
		return Object.fromEntries(allowed.flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
	}
}
