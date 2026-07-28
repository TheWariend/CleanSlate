/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CliPermissionMode } from './argv.js';
export type { CliPermissionMode } from './argv.js';

const READ_ONLY_SYSTEM_TOOLS = new Set([
	'list_skills',
	'mcp_list_tools',
	'read_reference',
	'ask_question',
	'update_todo',
	'submit_artifact'
]);

const READ_ONLY_BROWSER_TOOLS = new Set([
	'browser_get_url',
	'browser_tabs',
	'browser_snapshot',
	'browser_screenshot',
	'browser_diagnostics',
	'browser_list_annotations'
]);

export class CliPermissionPolicy {
	constructor(readonly mode: CliPermissionMode = 'default') { }

	allowsTool(request: { toolName: string; category?: string }): boolean {
		if (this.mode !== 'read-only') {
			return true;
		}
		if (request.category === 'discovery' || request.category === 'context') {
			return true;
		}
		if (request.category === 'browser') {
			return READ_ONLY_BROWSER_TOOLS.has(request.toolName);
		}
		if (request.category === 'system') {
			return READ_ONLY_SYSTEM_TOOLS.has(request.toolName);
		}
		return request.toolName === 'read_symbols' || request.toolName === 'get_definitions';
	}

	allowsCommandWithoutPrompt(): boolean {
		return this.mode === 'full';
	}

	requiresToolApproval(request: { category?: string }): boolean {
		return this.mode === 'default' && (request.category === 'edit' || request.category === 'creation');
	}
}
