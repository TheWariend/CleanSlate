/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { HookType } from './hookSchema.js';

/**
 * Maps AI CLI hook type names to our abstract HookType.
 * AI CLI uses camelCase names.
 */
export const AI_CLI_HOOK_TYPE_MAP: Record<string, HookType> = {
	'sessionStart': HookType.SessionStart,
	'userPromptSubmitted': HookType.UserPromptSubmit,
	'preToolUse': HookType.PreToolUse,
	'postToolUse': HookType.PostToolUse,
};

/**
 * Cached inverse mapping from HookType to AI CLI hook type name.
 * Lazily computed on first access.
 */
let _hookTypeToAiCliName: Map<HookType, string> | undefined;

function getHookTypeToAiCliNameMap(): Map<HookType, string> {
	if (!_hookTypeToAiCliName) {
		_hookTypeToAiCliName = new Map();
		for (const [aiCliName, hookType] of Object.entries(AI_CLI_HOOK_TYPE_MAP)) {
			_hookTypeToAiCliName.set(hookType, aiCliName);
		}
	}
	return _hookTypeToAiCliName;
}

/**
 * Resolves a AI CLI hook type name to our abstract HookType.
 */
export function resolveAiCliHookType(name: string): HookType | undefined {
	return AI_CLI_HOOK_TYPE_MAP[name];
}

/**
 * Gets the AI CLI hook type name for a given abstract HookType.
 * Returns undefined if the hook type is not supported in AI CLI.
 */
export function getAiCliHookTypeName(hookType: HookType): string | undefined {
	return getHookTypeToAiCliNameMap().get(hookType);
}
