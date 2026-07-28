/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ParsedToolCall } from './cleanSlateAgentTypes.js';

export interface ICleanSlateToolCallLedgerOptions {
	availableToolNames: Iterable<string>;
	validateToolCall?: (toolCall: ParsedToolCall) => string | undefined;
	loopThreshold?: number;
}

export interface ICleanSlateToolCallDecision {
	toolCall: ParsedToolCall;
	accepted: boolean;
	result?: any;
}

export class CleanSlateToolCallLedger {
	private static readonly DEFAULT_LOOP_THRESHOLD = 3;
	private static readonly TOOL_ALIASES: Record<string, string> = {
		codebase_search: 'semantic_search',
		rag_search: 'semantic_search',
		workspace_search: 'search_workspace',
		search_files: 'search_workspace',
		grep: 'grep_search',
		readfile: 'read_file',
		readfilerange: 'read_file_range',
		apply_patch: 'apply_edit',
		edit_file: 'apply_edit',
		create_and_write_file: 'write_file'
	};

	private readonly availableToolNames = new Set<string>();
	private readonly availableToolNamesByLower = new Map<string, string>();
	private readonly currentTurnKeys = new Set<string>();
	private readonly recentExecutionKeys: string[] = [];
	private readonly loopThreshold: number;

	constructor(private readonly options: ICleanSlateToolCallLedgerOptions) {
		for (const toolName of options.availableToolNames) {
			this.availableToolNames.add(toolName);
			this.availableToolNamesByLower.set(toolName.toLowerCase(), toolName);
		}
		this.loopThreshold = Math.max(2, Math.floor(options.loopThreshold ?? CleanSlateToolCallLedger.DEFAULT_LOOP_THRESHOLD));
	}

	public beginTurn(): void {
		this.currentTurnKeys.clear();
	}

	public normalizeToolCall(toolCall: ParsedToolCall): ParsedToolCall {
		const repairedName = this.repairToolName(toolCall.toolName);
		const normalizedInput = toolCall.toolName.trim().toLowerCase() === 'create_and_write_file'
			&& repairedName === 'write_file'
			&& typeof toolCall.input?.file_path !== 'string'
			&& typeof toolCall.input?.path === 'string'
			? (() => {
				const { path, ...rest } = toolCall.input;
				return { ...rest, file_path: path };
			})()
			: toolCall.input;
		if (repairedName === toolCall.toolName && normalizedInput === toolCall.input) {
			return toolCall;
		}
		return {
			...toolCall,
			toolName: repairedName,
			input: normalizedInput
		};
	}

	public getTurnKey(toolCall: ParsedToolCall): string {
		return this.getSemanticKey(this.normalizeToolCall(toolCall));
	}

	public shouldAcceptInCurrentTurn(toolCall: ParsedToolCall): boolean {
		const key = this.getTurnKey(toolCall);
		if (this.currentTurnKeys.has(key)) {
			return false;
		}
		this.currentTurnKeys.add(key);
		return true;
	}

	public prepareForExecution(toolCall: ParsedToolCall): ICleanSlateToolCallDecision {
		const normalizedToolCall = this.normalizeToolCall(toolCall);
		const semanticKey = this.getSemanticKey(normalizedToolCall);
		this.recentExecutionKeys.push(semanticKey);
		if (this.recentExecutionKeys.length > this.loopThreshold) {
			this.recentExecutionKeys.shift();
		}

		if (this.recentExecutionKeys.length === this.loopThreshold
			&& this.recentExecutionKeys.every(key => key === semanticKey)) {
			return {
				toolCall: normalizedToolCall,
				accepted: false,
				result: {
					success: false,
					code: 'tool_call_loop_detected',
					message: `The same tool call was repeated ${this.loopThreshold} times.`,
					recoveryHint: 'Do not repeat the same arguments. Re-read narrower context, choose a different tool, or change the edit/input before trying again.'
				}
			};
		}

		if (!this.availableToolNames.has(normalizedToolCall.toolName)) {
			return {
				toolCall: normalizedToolCall,
				accepted: false,
				result: {
					success: false,
					code: 'unknown_tool',
					requestedTool: toolCall.toolName,
					toolName: normalizedToolCall.toolName,
					message: `Tool "${toolCall.toolName}" is unavailable in this execution surface.`,
					recoveryHint: 'Use one of the currently exposed tools instead of inventing or aliasing a new tool name.'
				}
			};
		}

		const validationError = this.options.validateToolCall?.(normalizedToolCall);
		if (validationError) {
			return {
				toolCall: normalizedToolCall,
				accepted: false,
				result: {
					success: false,
					code: 'malformed_tool_call',
					message: validationError,
					recoveryHint: this.buildMalformedRecoveryHint(normalizedToolCall, validationError)
				}
			};
		}

		return {
			toolCall: normalizedToolCall,
			accepted: true
		};
	}

	public recordResult(toolCall: ParsedToolCall, result: any): void {
		void toolCall;
		void result;
	}

	private repairToolName(toolName: string): string {
		const stripped = toolName.trim().startsWith('functions.')
			? toolName.trim().slice('functions.'.length)
			: toolName.trim();
		const lower = stripped.toLowerCase();
		const alias = CleanSlateToolCallLedger.TOOL_ALIASES[lower];
		if (alias && this.availableToolNames.has(alias)) {
			return alias;
		}
		return this.availableToolNamesByLower.get(lower) ?? stripped;
	}

	private getSemanticKey(toolCall: ParsedToolCall): string {
		try {
			return `${toolCall.toolName}:${JSON.stringify(toolCall.input ?? {})}`;
		} catch {
			return `${toolCall.toolName}:${String(toolCall.input)}`;
		}
	}

	private buildMalformedRecoveryHint(toolCall: ParsedToolCall, validationError: string): string {
		if (toolCall.toolName === 'apply_edit') {
			const path = typeof toolCall.input?.file_path === 'string' && toolCall.input.file_path.trim().length > 0
				? toolCall.input.file_path.trim()
				: undefined;
			return [
				'The model emitted a malformed apply_edit call.',
				path ? `Target path: ${path}.` : 'No target path was provided.',
				validationError,
				path
					? 'Retry apply_edit with file_path, the exact current old_string, and new_string.'
					: 'Choose the target file, read it, then retry apply_edit with file_path, old_string, and new_string.'
			].join(' ');
		}
		if (toolCall.toolName === 'multi_file_replace') {
			return [
				'The model emitted a malformed multi_file_replace call.',
				validationError,
				'Retry with edits: Array<{ file_path, old_string, new_string, replace_all? }>.'
			].join(' ');
		}
		return validationError;
	}
}
