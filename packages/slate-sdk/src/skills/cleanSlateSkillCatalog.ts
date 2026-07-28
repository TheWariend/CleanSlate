/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type CleanSlateCapabilityStatus =
	| 'available'
	| 'available_when_mcp_configured'
	| 'partial'
	| 'requires_provider'
	| 'requires_runtime'
	| 'requires_product_runtime';

export interface CleanSlateMcpToolSummary {
	name: string;
	serverName?: string;
}

export interface CleanSlateSkillDescriptor {
	id: string;
	referenceName: string;
	title: string;
	status: CleanSlateCapabilityStatus;
	productionReady: boolean;
	description: string;
	entryPoints: string[];
	requirements: string[];
	notes: string[];
}

export interface CleanSlateMcpCapabilityDescriptor {
	id: string;
	serverName: string;
	status: 'available' | 'not_configured';
	productionReady: boolean;
	expectedToolPrefixes: string[];
	detectedTools: string[];
	description: string;
	requirements: string[];
}

const NODE_REPL_TOOL_PREFIXES = ['mcp__node_repl__'];
const COMPUTER_USE_TOOL_PREFIXES = ['mcp__computer_use__', 'mcp__computer-use__'];

export function getCleanSlateSkillCatalog(mcpTools: readonly CleanSlateMcpToolSummary[] = []): CleanSlateSkillDescriptor[] {
	const computerUseAvailable = hasAnyMcpToolWithPrefix(mcpTools, COMPUTER_USE_TOOL_PREFIXES);

	return [
		{
			id: 'imagegen',
			referenceName: 'imagegen',
			title: 'Image Generation',
			status: 'requires_provider',
			productionReady: false,
			description: 'Generate or edit raster images, mockups, textures, sprites, and transparent cutouts.',
			entryPoints: [],
			requirements: [
				'A CleanSlate image-generation provider/tool contract',
				'API key and safety handling for image creation/editing',
				'Artifact storage and preview UI for generated bitmap outputs'
			],
			notes: ['Not MCP by itself; this needs a provider-backed image tool.']
		},
		{
			id: 'official-docs',
			referenceName: 'official-docs',
			title: 'Official Docs Research',
			status: 'partial',
			productionReady: true,
			description: 'Answer product, API, SDK, framework, or platform questions using current official documentation.',
			entryPoints: ['web_search', 'web_fetch'],
			requirements: [
				'Restrict searches/fetches to the official domains for the technology being discussed',
				'Cite fetched documentation when answering current or version-sensitive questions'
			],
			notes: ['CleanSlate has web retrieval; dedicated documentation MCP connectors can be added later for richer doc search.']
		},
		{
			id: 'plugin-creator',
			referenceName: 'plugin-creator',
			title: 'Plugin Creator',
			status: 'requires_product_runtime',
			productionReady: false,
			description: 'Create CleanSlate plugin directories, manifests, and marketplace metadata.',
			entryPoints: [],
			requirements: [
				'A CleanSlate plugin manifest schema',
				'Plugin install/cache directories',
				'Marketplace or local-plugin registration UI'
			],
			notes: ['CleanSlate does not yet have its own plugin marketplace/runtime equivalent.']
		},
		{
			id: 'skill-creator',
			referenceName: 'skill-creator',
			title: 'Skill Creator',
			status: 'requires_product_runtime',
			productionReady: false,
			description: 'Create and maintain local SKILL.md instruction packs.',
			entryPoints: [],
			requirements: [
				'A CleanSlate skill file location',
				'Skill discovery/loading rules',
				'Prompt injection and trust controls for skill instructions'
			],
			notes: ['This catalog is the first stable product surface for that runtime.']
		},
		{
			id: 'skill-installer',
			referenceName: 'skill-installer',
			title: 'Skill Installer',
			status: 'requires_product_runtime',
			productionReady: false,
			description: 'Install curated or repository-hosted skills into the local skill directory.',
			entryPoints: [],
			requirements: [
				'A trusted skill source policy',
				'Install/update/remove workflows',
				'Manifest validation before a skill is loaded into prompts'
			],
			notes: ['Installer work should come after the CleanSlate skill runtime is defined.']
		},
		{
			id: 'browser',
			referenceName: 'browser:browser',
			title: 'Browser Automation',
			status: 'available',
			productionReady: true,
			description: 'Operate and verify the live integrated browser with semantic locators, tabs, diagnostics, screenshots, uploads, and native input.',
			entryPoints: [
				'browser_open',
				'browser_snapshot',
				'browser_click',
				'browser_hover',
				'browser_fill',
				'browser_check',
				'browser_select',
				'browser_upload',
				'browser_type',
				'browser_key',
				'browser_scroll',
				'browser_screenshot',
				'browser_diagnostics',
				'browser_dialog',
				'browser_clipboard',
				'browser_tabs',
				'browser_new_tab',
				'browser_select_tab',
				'browser_close_tab'
			],
			requirements: [],
			notes: ['Already wired as native CleanSlate browser tools.']
		},
		{
			id: 'computer-use',
			referenceName: 'computer-use:computer-use',
			title: 'Computer Use',
			status: computerUseAvailable ? 'available' : 'available_when_mcp_configured',
			productionReady: computerUseAvailable,
			description: 'Control local desktop apps through MCP-backed computer-use actions.',
			entryPoints: computerUseAvailable ? detectedToolNames(mcpTools, COMPUTER_USE_TOOL_PREFIXES) : [],
			requirements: computerUseAvailable ? [] : ['Bundle or configure a CleanSlate-owned computer-use MCP server.'],
			notes: ['When available, desktop-control actions are callable internally by the agent.']
		},
		{
			id: 'documents',
			referenceName: 'documents:documents',
			title: 'Documents',
			status: 'requires_runtime',
			productionReady: false,
			description: 'Create, edit, redline, render, and verify DOCX/Google Docs-targeted documents.',
			entryPoints: [],
			requirements: [
				'A bundled document runtime',
				'DOCX rendering/visual verification',
				'Document artifact export and preview UI'
			],
			notes: ['Not solved by MCP alone; this is a document artifact runtime.']
		},
		{
			id: 'pdf',
			referenceName: 'pdf',
			title: 'PDF',
			status: 'requires_runtime',
			productionReady: false,
			description: 'Read, create, render, and visually verify PDF artifacts.',
			entryPoints: [],
			requirements: [
				'A bundled PDF generation/extraction runtime',
				'Page rendering for visual QA',
				'PDF artifact export and preview UI'
			],
			notes: ['Generic file tools are not enough for production PDF handling.']
		},
		{
			id: 'presentations',
			referenceName: 'presentations:Presentations',
			title: 'Presentations',
			status: 'requires_runtime',
			productionReady: false,
			description: 'Build, render, verify, and export PowerPoint/Google Slides-targeted decks.',
			entryPoints: [],
			requirements: [
				'A bundled presentation runtime',
				'Slide rendering/visual verification',
				'PPTX artifact export and preview UI'
			],
			notes: ['Native Google Slides also needs a Google Drive/Slides connector after local deck creation.']
		},
		{
			id: 'spreadsheets',
			referenceName: 'spreadsheets:Spreadsheets',
			title: 'Spreadsheets',
			status: 'requires_runtime',
			productionReady: false,
			description: 'Create, edit, analyze, render, verify, and export XLSX/CSV/Google Sheets-targeted workbooks.',
			entryPoints: [],
			requirements: [
				'A bundled spreadsheet runtime',
				'Formula recalculation and rendered workbook verification',
				'Google Drive/Sheets MCP for native Google Sheets import/edit workflows'
			],
			notes: ['For a real Google Sheet link, CleanSlate still needs the Google Drive/Sheets connector.']
		}
	];
}

export function getCleanSlateMcpCapabilityCatalog(mcpTools: readonly CleanSlateMcpToolSummary[] = []): CleanSlateMcpCapabilityDescriptor[] {
	return [
		createMcpCapability({
			id: 'node_repl',
			serverName: 'node_repl',
			expectedToolPrefixes: NODE_REPL_TOOL_PREFIXES,
			description: 'Run JavaScript through a configured Node REPL MCP server.',
			requirements: ['Configure the node_repl MCP server in CleanSlate native MCP, CleanSlate settings, or a CleanSlate plugin root.']
		}, mcpTools),
		createMcpCapability({
			id: 'computer_use',
			serverName: 'computer-use',
			expectedToolPrefixes: COMPUTER_USE_TOOL_PREFIXES,
			description: 'Control local Mac apps through configured desktop-control MCP actions.',
			requirements: ['Bundle or configure the computer-use MCP server under CleanSlate native MCP, CleanSlate settings, or a CleanSlate plugin root.']
		}, mcpTools)
	];
}

function createMcpCapability(
	descriptor: Omit<CleanSlateMcpCapabilityDescriptor, 'status' | 'productionReady' | 'detectedTools'>,
	mcpTools: readonly CleanSlateMcpToolSummary[]
): CleanSlateMcpCapabilityDescriptor {
	const detectedTools = detectedToolNames(mcpTools, descriptor.expectedToolPrefixes);
	const productionReady = detectedTools.length > 0;
	return {
		...descriptor,
		status: productionReady ? 'available' : 'not_configured',
		productionReady,
		detectedTools
	};
}

function hasAnyMcpToolWithPrefix(mcpTools: readonly CleanSlateMcpToolSummary[], prefixes: readonly string[]): boolean {
	return detectedToolNames(mcpTools, prefixes).length > 0;
}

function detectedToolNames(mcpTools: readonly CleanSlateMcpToolSummary[], prefixes: readonly string[]): string[] {
	return mcpTools
		.map(tool => tool.name)
		.filter(toolName => prefixes.some(prefix => toolName.startsWith(prefix)))
		.sort();
}
