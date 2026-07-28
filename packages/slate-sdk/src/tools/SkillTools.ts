/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { MCPTool } from '../protocol/cleanSlateAI.js';
import {
	getCleanSlateMcpCapabilityCatalog,
	getCleanSlateSkillCatalog,
	type CleanSlateSkillDescriptor,
	type CleanSlateMcpToolSummary
} from '../skills/cleanSlateSkillCatalog.js';
import { CleanSlateTool, CleanSlateToolContext } from './types.js';

interface IListSkillsInput {
	refreshMcp?: boolean;
	includeUnavailable?: boolean;
	includeInternalDetails?: boolean;
}

export const listSkillsTool: CleanSlateTool = {
	name: 'list_skills',
	description: 'Internal availability check for CleanSlate skills and MCP-backed capabilities. Use the result to decide what the agent can do; do not expose raw details unless explicitly debugging configuration.',
	category: 'system',
	parametersSchema: {
		type: 'object',
		properties: {
			refreshMcp: {
				type: 'boolean',
				description: 'Reconnect MCP servers before checking node_repl/computer-use availability.'
			},
			includeUnavailable: {
				type: 'boolean',
				description: 'Include skills that are known but not yet backed by a production runtime. Defaults to true.'
			},
			includeInternalDetails: {
				type: 'boolean',
				description: 'Include raw internal tool names and MCP catalog fields for debugging. Defaults to false.'
			}
		}
	},
	async run(input: IListSkillsInput, context: CleanSlateToolContext): Promise<any> {
		const mcpStatus = await readMcpTools(input, context);
		const skillCatalog = getCleanSlateSkillCatalog(mcpStatus.tools);
		const mcpCapabilities = getCleanSlateMcpCapabilityCatalog(mcpStatus.tools);
		const includeUnavailable = input?.includeUnavailable !== false;
		const includeInternalDetails = input?.includeInternalDetails === true;
		const availableSkills = includeUnavailable
			? skillCatalog
			: skillCatalog.filter(skill => skill.productionReady);
		const visibleSkills = includeInternalDetails
			? availableSkills
			: availableSkills.map(toPublicSkillSummary);
		const visibleMcpCapabilities = includeInternalDetails
			? mcpCapabilities
			: mcpCapabilities.map(capability => ({
				id: capability.id,
				serverName: capability.serverName,
				status: capability.status,
				productionReady: capability.productionReady,
				description: capability.description,
				requirements: capability.requirements
			}));

		return {
			success: true,
			skillCount: skillCatalog.length,
			requestedMcpCount: mcpCapabilities.length,
			productionReadySkillCount: skillCatalog.filter(skill => skill.productionReady).length,
			productionReadyMcpCount: mcpCapabilities.filter(capability => capability.productionReady).length,
			mcpToolCount: mcpStatus.tools.length,
			mcpError: mcpStatus.error,
			skills: visibleSkills,
			mcpCapabilities: visibleMcpCapabilities,
			guidance: [
				'Use available capabilities automatically when a user asks in normal language.',
				'Do not expose internal MCP tool names or configuration fields unless the user explicitly asks to debug MCP internals.',
				'node_repl and computer-use become production-ready when their backing MCP servers are configured and detected.',
				'Native Google Sheets needs a Google Drive/Sheets MCP connector; spreadsheet file creation needs a bundled spreadsheet runtime.'
			]
		};
	}
};

async function readMcpTools(input: IListSkillsInput, context: CleanSlateToolContext): Promise<{ tools: CleanSlateMcpToolSummary[]; error?: string }> {
	if (!context.mcpClientService) {
		return {
			tools: [],
			error: 'MCP client service is not available.'
		};
	}

	try {
		if (input?.refreshMcp) {
			await context.mcpClientService.refreshServers();
		}
		const tools = await context.mcpClientService.getTools();
		return {
			tools: tools.map(toMcpToolSummary)
		};
	} catch (error) {
		return {
			tools: [],
			error: String(error)
		};
	}
}

function toMcpToolSummary(tool: MCPTool): CleanSlateMcpToolSummary {
	return {
		name: tool.name,
		serverName: tool.serverName
	};
}

function toPublicSkillSummary(skill: CleanSlateSkillDescriptor): object {
	return {
		id: skill.id,
		title: skill.title,
		status: skill.status,
		productionReady: skill.productionReady,
		description: skill.description,
		requirements: skill.requirements,
		notes: skill.notes
	};
}
