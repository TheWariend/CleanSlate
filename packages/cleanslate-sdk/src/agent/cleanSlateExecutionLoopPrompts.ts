/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function buildExecutionNoToolRecoveryPrompt(hasTechnicalProgress: boolean): string {
	if (hasTechnicalProgress) {
		return [
			'EXECUTION GUARDRAIL: do not end with narration.',
			'If the requested work is complete and verified, write the visible final answer as normal assistant text and stop. Otherwise return the next concrete tool call; verify diagnostics or apply the next small edit. Re-read only after external staleness or a failed match.'
		].join('\n');
	}

	return [
		'EXECUTION GUARDRAIL: no technical tool action has completed yet.',
		'Return concrete tool_calls only. Start with read/list/search tools to inspect the current workspace, then apply localized changes with apply_edit or complete-file writes with write_file. Do not narrate progress as a substitute for tool calls.'
	].join('\n');
}

/**
 * Detects a tool call the model serialized into its TEXT channel instead of
 * emitting a provider-native tool call. GPT-5.x under pressure emits patterns
 * like "to=functions.read_file", the hallucinated "multi_tool_use.parallel"
 * wrapper (its way of asking for parallel calls), or raw tool-call JSON. Text
 * is never executed, so without targeted feedback the model waits on results
 * that will never arrive.
 */
const SERIALIZED_TOOL_CALL_PATTERN = /\bto=(?:functions|multi_tool_use|tools?)[.\w-]*|multi_tool_use\.parallel|<\|tool_calls?\|>|"tool_calls"\s*:\s*\[|\bfunctions\.[\w-]+\s*\(/;

export function detectSerializedToolCallSyntax(text: string): boolean {
	return SERIALIZED_TOOL_CALL_PATTERN.test(text);
}

export function buildSerializedToolCallRecoveryPrompt(): string {
	return [
		'TOOL CALL NOT EXECUTED: the previous turn serialized a tool call into plain text (for example "to=functions.read_file" or a "multi_tool_use.parallel" wrapper). Text is never executed and produced no result.',
		'Re-issue the action as provider-native tool calls. To run several independent read-only actions at once, return multiple entries in one native tool_calls array — do not invent wrapper tools and do not print tool syntax as text.'
	].join('\n');
}

export function buildExecutionNoProgressStopMessage(attempts: number, reason: string): string {
	return [
		`Paused execution after ${attempts} consecutive no-progress model attempt(s): ${reason}.`,
		'The workspace was not declared complete because the model did not return the required tools.'
	].join(' ');
}
