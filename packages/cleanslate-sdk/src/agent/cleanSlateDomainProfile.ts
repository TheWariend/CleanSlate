/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The execution loop needs to know what a tool *does* to it — whether a call
 * mutates the workspace, whether it reports damage, whether two calls may
 * overlap — without knowing that the tool is called `apply_edit`.
 *
 * A domain profile answers those questions for one family of tools. The coding
 * profile below reproduces the behaviour the loop had when these names were
 * written into it directly; a browser-automation or research agent supplies its
 * own profile and reuses the same loop.
 */
export interface ICleanSlateDomainProfile {
	/** Identifier for logs and diagnostics. */
	readonly id: string;

	/**
	 * Calls that change the workspace. After one of these the loop refreshes
	 * its read-state rather than demanding the model re-read the file.
	 */
	readonly mutationTools: ReadonlySet<string>;

	/** Calls that run arbitrary commands, gated separately from edits. */
	readonly commandTools: ReadonlySet<string>;

	/**
	 * The foreground command tool. Its results carry an intent and a success
	 * flag the loop reasons about; background variants report differently, so
	 * this is deliberately narrower than `commandTools`.
	 */
	readonly primaryCommandTool?: string;

	/**
	 * Mutation calls whose input is a structured list of edits, so the loop can
	 * count them. Narrower than `mutationTools`, which includes whole-file
	 * writes with no edit list.
	 */
	readonly structuredEditTools: ReadonlySet<string>;

	/**
	 * Calls that report whether the workspace is broken. Their results are the
	 * loop's evidence that a mutation succeeded.
	 */
	readonly verificationTools: ReadonlySet<string>;

	/**
	 * The verification call the loop invokes itself, without the model asking,
	 * after mutations. Takes `{ paths }` and reports problems found in them.
	 * Leave unset in a domain where nothing can be checked deterministically.
	 */
	readonly deterministicVerificationTool?: string;

	/**
	 * Recorded against a recovery prompt so the model knows which call to
	 * re-issue after a failure.
	 */
	readonly recoveryMutationTool?: string;

	/**
	 * Read-only research calls. Never suppressed from the tool list — the model
	 * decides when it has read enough.
	 */
	readonly discoveryTools: ReadonlySet<string>;

	/**
	 * Calls safe to run concurrently with others. Anything outside this set
	 * serializes the queue.
	 */
	readonly parallelSafeTools: ReadonlySet<string>;

	/** The tool list available in plan mode. Must contain no mutation tools. */
	readonly planModeTools: ReadonlySet<string>;

	/** Ends a plan-mode turn by submitting a result. */
	readonly completionTool?: string;

	/** Pauses the turn to ask the user something. */
	readonly questionTool?: string;
}

const codingMutationTools = new Set([
	'apply_edit',
	'multi_file_replace',
	'write_file',
	'create_multiple_files',
	'undo_edit',
	'file_history_rewind'
]);

const codingCommandTools = new Set([
	'execute_command',
	'start_background_command'
]);

const codingVerificationTools = new Set([
	'read_lints'
]);

const codingDiscoveryTools = new Set([
	'read_file',
	'read_file_range',
	'list_dir',
	'find_by_name',
	'grep_search',
	'search_workspace',
	'search_codebase',
	'semantic_search',
	'get_open_files',
	'read_reference',
	'read_symbols',
	'get_definitions',
	'find_references',
	'web_search',
	'web_fetch'
]);

/**
 * Web and command calls overlap safely because they touch nothing the other
 * reads. Edits deliberately do not.
 */
const codingParallelSafeTools = new Set([
	'web_search',
	'web_fetch',
	'execute_command',
	'read_background_command'
]);

/**
 * Plan mode keeps every read-only capability, including the full browser
 * surface — driving a page mutates the page, not the workspace.
 */
const codingPlanModeTools = new Set([
	'ask_question',
	'submit_artifact',
	'read_file',
	'read_file_range',
	'list_dir',
	'find_by_name',
	'grep_search',
	'search_workspace',
	'search_codebase',
	'semantic_search',
	'web_search',
	'web_fetch',
	'get_open_files',
	'read_reference',
	'read_symbols',
	'get_definitions',
	'find_references',
	'read_lints',
	'browser_open',
	'browser_get_url',
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
	'browser_close_tab',
	'browser_wait',
	'browser_start_annotation',
	'browser_stop_annotation',
	'browser_list_annotations',
	'browser_delete_annotation',
	'browser_clear_annotations'
]);

export const CLEANSLATE_CODING_PROFILE: ICleanSlateDomainProfile = {
	id: 'coding',
	mutationTools: codingMutationTools,
	commandTools: codingCommandTools,
	primaryCommandTool: 'execute_command',
	structuredEditTools: new Set(['apply_edit', 'multi_file_replace']),
	deterministicVerificationTool: 'read_lints',
	recoveryMutationTool: 'apply_edit',
	verificationTools: codingVerificationTools,
	discoveryTools: codingDiscoveryTools,
	parallelSafeTools: codingParallelSafeTools,
	planModeTools: codingPlanModeTools,
	completionTool: 'submit_artifact',
	questionTool: 'ask_question'
};

/**
 * General workspace profile. File creation remains observable as a mutation,
 * but general agents are not forced through source-code diagnostics.
 */
export const CLEANSLATE_GENERAL_PROFILE: ICleanSlateDomainProfile = {
	id: 'general',
	mutationTools: codingMutationTools,
	commandTools: codingCommandTools,
	primaryCommandTool: 'execute_command',
	structuredEditTools: new Set(['apply_edit', 'multi_file_replace']),
	recoveryMutationTool: 'apply_edit',
	verificationTools: new Set(),
	discoveryTools: codingDiscoveryTools,
	parallelSafeTools: codingParallelSafeTools,
	planModeTools: codingPlanModeTools,
	completionTool: 'submit_artifact',
	questionTool: 'ask_question'
};

export function isMutationTool(profile: ICleanSlateDomainProfile, toolName: string): boolean {
	return profile.mutationTools.has(toolName);
}

export function isCommandTool(profile: ICleanSlateDomainProfile, toolName: string): boolean {
	return profile.commandTools.has(toolName);
}

export function isAllowedInPlanMode(profile: ICleanSlateDomainProfile, toolName: string): boolean {
	return profile.planModeTools.has(toolName);
}

export function isParallelSafeTool(profile: ICleanSlateDomainProfile, toolName: string): boolean {
	return profile.parallelSafeTools.has(toolName);
}
