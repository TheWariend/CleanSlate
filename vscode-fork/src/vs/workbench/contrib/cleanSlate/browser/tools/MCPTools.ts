/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CleanSlateTool, CleanSlateToolContext } from './types.js';
import type { MCPTool } from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { cancellationTokenFromAbortSignal } from '../core/cleanSlateCancellation.js';

export async function requestMcpToolApproval(tool: MCPTool, input: any, context: CleanSlateToolContext): Promise<boolean> {
	if (tool.readOnlyHint === true && tool.openWorldHint !== true) {
		return true;
	}
	const server = tool.serverName?.trim();
	const preview = JSON.stringify({
		server: server || undefined,
		tool: tool.originalName || tool.name,
		input: input ?? {}
	}, undefined, 2);
	return context.requestCommandApproval({
		command: preview,
		reason: `MCP tool "${tool.originalName || tool.name}"${server ? ` from "${server}"` : ''} wants to run`,
		toolName: tool.name
	});
}

export const mcpListToolsTool: CleanSlateTool = {
	name: 'mcp_list_tools',
	description: 'List tools exposed by configured Model Context Protocol servers. Use this before calling external tools such as GitHub, Jira, search, databases, or custom MCP servers.',
	category: 'system',
	parametersSchema: {
		type: 'object',
		properties: {
			refresh: { type: 'boolean', description: 'Reconnect configured MCP servers before listing tools.' }
		}
	},
	async run(input: { refresh?: boolean }, context: CleanSlateToolContext): Promise<any> {
		if (!context.mcpClientService) {
			return {
				success: false,
				code: 'mcp_unavailable',
				message: 'MCP client service is not available in this CleanSlate environment.'
			};
		}

		if (input?.refresh) {
			await context.mcpClientService.refreshServers(cancellationTokenFromAbortSignal(context.signal));
		}

		const tools = await context.mcpClientService.getTools(cancellationTokenFromAbortSignal(context.signal));
		return {
			success: true,
			count: tools.length,
			tools: tools.map((tool: MCPTool) => ({
				name: tool.name,
				originalName: tool.originalName,
				description: tool.description,
				serverName: tool.serverName,
				inputSchema: tool.inputSchema
			}))
		};
	}
};

export const mcpCallTool: CleanSlateTool = {
	name: 'mcp_call_tool',
	description: 'Call a tool exposed by a configured Model Context Protocol server. Input: { toolName: string, input: object }.',
	category: 'system',
	parametersSchema: {
		type: 'object',
		properties: {
			toolName: { type: 'string', description: 'Exact MCP tool name from mcp_list_tools.' },
			input: { type: 'object', description: 'Arguments matching the MCP tool inputSchema.' }
		},
		required: ['toolName', 'input']
	},
	async run(input: { toolName?: string; input?: any }, context: CleanSlateToolContext): Promise<any> {
		if (!context.mcpClientService) {
			return {
				success: false,
				code: 'mcp_unavailable',
				message: 'MCP client service is not available in this CleanSlate environment.'
			};
		}
		if (!input?.toolName) {
			throw new Error('mcp_call_tool requires "toolName".');
		}

		const token = cancellationTokenFromAbortSignal(context.signal);
		const tools = await context.mcpClientService.getTools(token);
		const tool = tools.find(candidate => candidate.name === input.toolName || candidate.originalName === input.toolName) ?? {
			name: input.toolName,
			description: '',
			inputSchema: {}
		};
		if (!await requestMcpToolApproval(tool, input.input ?? {}, context)) {
			return {
				success: false,
				code: 'user_cancelled',
				toolName: input.toolName,
				message: 'The user declined this MCP tool call. Do not retry it unless explicitly requested.'
			};
		}

		const result = await context.mcpClientService.executeTool(input.toolName, input.input ?? {}, token);
		return {
			success: true,
			toolName: input.toolName,
			result
		};
	}
};
