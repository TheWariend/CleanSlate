/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChatMessage } from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';

export interface ICleanSlateContextBudgetResult {
	compacted: boolean;
	beforeChars: number;
	afterChars: number;
	clampedToolResults: number;
	clampedAssistantTurns: number;
	droppedToolMessages: number;
	droppedSystemMessages: number;
	droppedHistoryMessages: number;
}

export interface ICleanSlateContextProjection {
	messages: IChatMessage[];
	result: ICleanSlateContextBudgetResult;
}

export interface ICleanSlateToolOutputPruneResult {
	pruned: boolean;
	beforeChars: number;
	afterChars: number;
	reclaimedChars: number;
	compactedToolResults: number;
	compactedAssistantTurns: number;
}

export class CleanSlateContextBudgetManager {
	/** Keep roughly 40k tokens of the newest tool transcript intact. */
	private static readonly PRUNE_PROTECT_CHARS = 40_000 * 4;
	/** Do not churn the transcript unless pruning earns back at least 20k tokens. */
	private static readonly PRUNE_MINIMUM_RECLAIM_CHARS = 20_000 * 4;
	private static readonly PRUNED_TOOL_RESULT_CHAR_LIMIT = 2_000;
	private static readonly MIN_RECENT_TOOL_GROUPS = 4;
	private static readonly TOOL_RESULT_CHAR_LIMIT = 3000;
	private static readonly ASSISTANT_TOOL_TURN_CHAR_LIMIT = 1200;
	private static readonly COMPACTED_HISTORY_HEADER = '[COMPACTED HISTORY]';
	private static readonly COMPACTED_HISTORY_PREAMBLE = 'Earlier tool activity was compacted out of context. It already ran — do not repeat it blindly. Re-read a file only if its current content is actually needed again.';
	private static readonly MAX_DIGEST_ENTRIES = 80;
	private static readonly MAX_DIGEST_LINE_CHARS = 160;

	public shouldCompactMessages(messages: readonly IChatMessage[], thresholdChars: number): boolean {
		return Number.isFinite(thresholdChars)
			&& thresholdChars > 0
			&& this.getMessagesCharCount(messages) >= thresholdChars;
	}

	/**
	 * Proactively reduce old tool output independently of model-window
	 * compaction. Long-context models otherwise resend every prior file read on
	 * every agent turn and can exhaust a paid session while using only a small
	 * fraction of their advertised context window.
	 *
	 * The 40k-token protected tail and 20k-token minimum saving keep the
	 * transcript from churning, while native tool-call/result pairs are retained
	 * for provider protocol validity.
	 */
	public pruneOldToolOutputs(messages: IChatMessage[]): ICleanSlateToolOutputPruneResult {
		const beforeChars = this.getMessagesCharCount(messages);
		const groups = this.collectToolTranscriptGroups(messages);
		let protectedChars = 0;
		let firstCandidateGroup = groups.length;

		for (let index = groups.length - 1; index >= 0; index--) {
			const group = groups[index];
			const groupChars = this.getMessagesCharCount(messages.slice(group.start, group.endExclusive));
			if (protectedChars < CleanSlateContextBudgetManager.PRUNE_PROTECT_CHARS
				|| groups.length - index <= CleanSlateContextBudgetManager.MIN_RECENT_TOOL_GROUPS) {
				protectedChars += groupChars;
				firstCandidateGroup = index;
				continue;
			}
			break;
		}

		const candidates = groups.slice(0, firstCandidateGroup);
		const reclaimableChars = candidates.reduce((total, group) => {
			for (let index = group.start; index < group.endExclusive; index++) {
				const message = messages[index];
				const limit = message.role === 'tool'
					? CleanSlateContextBudgetManager.PRUNED_TOOL_RESULT_CHAR_LIMIT
					: message.role === 'assistant' && message.toolCalls?.length
						? CleanSlateContextBudgetManager.ASSISTANT_TOOL_TURN_CHAR_LIMIT
						: Number.POSITIVE_INFINITY;
				if (Number.isFinite(limit)) {
					total += Math.max(0, this.getContentCharCount(message.content) - limit);
				}
			}
			return total;
		}, 0);

		if (reclaimableChars < CleanSlateContextBudgetManager.PRUNE_MINIMUM_RECLAIM_CHARS) {
			return {
				pruned: false,
				beforeChars,
				afterChars: beforeChars,
				reclaimedChars: 0,
				compactedToolResults: 0,
				compactedAssistantTurns: 0
			};
		}

		let compactedToolResults = 0;
		let compactedAssistantTurns = 0;
		for (const group of candidates) {
			for (let index = group.start; index < group.endExclusive; index++) {
				const message = messages[index];
				if (message.role === 'tool' && this.clampMessageContent(
					message,
					CleanSlateContextBudgetManager.PRUNED_TOOL_RESULT_CHAR_LIMIT,
					'[older tool result pruned after successful execution — re-read only if current content is needed]'
				)) {
					compactedToolResults++;
				} else if (message.role === 'assistant' && message.toolCalls?.length && this.clampMessageContent(
					message,
					CleanSlateContextBudgetManager.ASSISTANT_TOOL_TURN_CHAR_LIMIT,
					'[older assistant tool-call narration pruned]'
				)) {
					compactedAssistantTurns++;
				}
			}
		}

		const afterChars = this.getMessagesCharCount(messages);
		return {
			pruned: afterChars < beforeChars,
			beforeChars,
			afterChars,
			reclaimedChars: Math.max(0, beforeChars - afterChars),
			compactedToolResults,
			compactedAssistantTurns
		};
	}

	public projectMessagesForProvider(messages: readonly IChatMessage[], budgetChars: number): ICleanSlateContextProjection {
		const projectedMessages = messages.map(message => this.cloneMessage(message));
		const result = this.createResult(this.getMessagesCharCount(projectedMessages));
		if (!Number.isFinite(budgetChars) || budgetChars <= 0 || result.beforeChars <= budgetChars) {
			return { messages: projectedMessages, result };
		}

		this.clampToolTranscriptContent(projectedMessages, result);
		this.dropToolTranscriptsWhileOverBudget(projectedMessages, budgetChars, result);
		this.dropOldSystemMessagesWhileOverBudget(projectedMessages, budgetChars, result);
		this.dropHistoryMessagesWhileOverBudget(projectedMessages, budgetChars, result);
		this.clampProtectedToolResultsAsLastResort(projectedMessages, budgetChars, result);
		this.finalizeResult(projectedMessages, result);

		return { messages: projectedMessages, result };
	}

	public compactMessages(messages: IChatMessage[], budgetChars: number): ICleanSlateContextBudgetResult {
		const beforeChars = this.getMessagesCharCount(messages);
		const result = this.createResult(beforeChars);

		if (!Number.isFinite(budgetChars) || budgetChars <= 0 || beforeChars <= budgetChars) {
			return result;
		}

		this.clampToolTranscriptContent(messages, result);
		this.dropToolTranscriptsWhileOverBudget(messages, budgetChars, result);
		this.dropOldSystemMessagesWhileOverBudget(messages, budgetChars, result);
		this.dropHistoryMessagesWhileOverBudget(messages, budgetChars, result);
		this.clampProtectedToolResultsAsLastResort(messages, budgetChars, result);
		this.finalizeResult(messages, result);

		return result;
	}

	private createResult(beforeChars: number): ICleanSlateContextBudgetResult {
		return {
			compacted: false,
			beforeChars,
			afterChars: beforeChars,
			clampedToolResults: 0,
			clampedAssistantTurns: 0,
			droppedToolMessages: 0,
			droppedSystemMessages: 0,
			droppedHistoryMessages: 0
		};
	}

	private clampToolTranscriptContent(messages: IChatMessage[], result: ICleanSlateContextBudgetResult): void {
		// The most recent tool groups keep their full content. Clamping what the
		// model JUST read forces it to re-read the same file over and over (each
		// re-read gets clamped again) — the re-read storm. Mirrors the
		// MIN_RECENT_TOOL_GROUPS protection the drop pass already applies.
		const protectedStart = this.getProtectedRecentToolStart(messages);

		for (let i = 1; i < messages.length; i++) {
			if (messages[i].role !== 'tool' || i >= protectedStart) {
				continue;
			}
			if (this.clampMessageContent(messages[i], CleanSlateContextBudgetManager.TOOL_RESULT_CHAR_LIMIT, '[older tool result compacted for context budget — the target still exists; re-read it only if this content is needed again]')) {
				result.clampedToolResults++;
			}
		}

		for (let i = 1; i < messages.length; i++) {
			if (messages[i].role !== 'assistant' || !messages[i].toolCalls?.length || i >= protectedStart) {
				continue;
			}
			if (this.clampMessageContent(messages[i], CleanSlateContextBudgetManager.ASSISTANT_TOOL_TURN_CHAR_LIMIT, '[assistant tool-call turn compacted for context budget]')) {
				result.clampedAssistantTurns++;
			}
		}
	}

	/** Index of the first message belonging to the protected most-recent tool groups. */
	private getProtectedRecentToolStart(messages: readonly IChatMessage[]): number {
		const groups = this.collectToolTranscriptGroups(messages);
		if (groups.length === 0) {
			return messages.length;
		}
		const firstProtectedGroup = Math.max(0, groups.length - CleanSlateContextBudgetManager.MIN_RECENT_TOOL_GROUPS);
		return groups[firstProtectedGroup].start;
	}

	/**
	 * Only when clamping old results and dropping old transcripts was not enough:
	 * clamp the protected recent tool results too, oldest first, so the provider
	 * call still fits. This is the pathological single-huge-result case; the
	 * common case never touches recent reads.
	 */
	private clampProtectedToolResultsAsLastResort(messages: IChatMessage[], budgetChars: number, result: ICleanSlateContextBudgetResult): void {
		for (let i = 1; i < messages.length && this.getMessagesCharCount(messages) > budgetChars; i++) {
			if (messages[i].role !== 'tool') {
				continue;
			}
			if (this.clampMessageContent(messages[i], CleanSlateContextBudgetManager.TOOL_RESULT_CHAR_LIMIT, '[tool result compacted for context budget — re-read the target if this content is needed again]')) {
				result.clampedToolResults++;
			}
		}
	}

	private dropOldSystemMessagesWhileOverBudget(messages: IChatMessage[], budgetChars: number, result: ICleanSlateContextBudgetResult): void {
		this.dropMessagesWhileOverBudget(messages, budgetChars, result, message => {
			if (message.role !== 'system' || this.isCompactedHistoryMessage(message)) {
				return false;
			}
			const index = messages.indexOf(message);
			if (index <= 0) {
				return false;
			}
			const laterSystemMessages = messages.slice(index + 1).filter(candidate => candidate.role === 'system').length;
			return laterSystemMessages >= 4;
		}, 'system');
	}

	private dropHistoryMessagesWhileOverBudget(messages: IChatMessage[], budgetChars: number, result: ICleanSlateContextBudgetResult): void {
		this.dropMessagesWhileOverBudget(messages, budgetChars, result, message => {
			if (message.role === 'system' || message.role === 'tool' || message.toolCalls?.length) {
				return false;
			}
			return !this.isCurrentContextUserMessage(message, messages);
		}, 'history');
	}

	private finalizeResult(messages: IChatMessage[], result: ICleanSlateContextBudgetResult): void {
		const afterChars = this.getMessagesCharCount(messages);
		result.afterChars = afterChars;
		result.compacted = result.clampedToolResults > 0
			|| result.clampedAssistantTurns > 0
			|| result.droppedToolMessages > 0
			|| result.droppedSystemMessages > 0
			|| result.droppedHistoryMessages > 0
			|| afterChars < result.beforeChars;
	}

	private dropToolTranscriptsWhileOverBudget(
		messages: IChatMessage[],
		budgetChars: number,
		result: ICleanSlateContextBudgetResult
	): void {
		while (this.getMessagesCharCount(messages) > budgetChars) {
			const groups = this.collectToolTranscriptGroups(messages);
			const maxDroppableGroupIndex = groups.length - CleanSlateContextBudgetManager.MIN_RECENT_TOOL_GROUPS;
			if (maxDroppableGroupIndex <= 0) {
				return;
			}

			const group = groups[0];
			// The refs compact by summarizing, never by pure amnesia: leave a
			// one-line ledger entry per dropped tool call so the model still
			// knows what it already did and does not redo the work blindly.
			const digestLines = this.describeDroppedToolGroup(messages, group);
			const removed = messages.splice(group.start, group.endExclusive - group.start);
			result.droppedToolMessages += removed.length;
			this.appendCompactedHistoryDigest(messages, digestLines);
		}
	}

	private describeDroppedToolGroup(messages: readonly IChatMessage[], group: { start: number; endExclusive: number }): string[] {
		const head = messages[group.start];
		const lines: string[] = [];
		for (const toolCall of head.toolCalls ?? []) {
			const target = this.describeToolCallTarget(toolCall.input);
			const resultMessage = messages
				.slice(group.start + 1, group.endExclusive)
				.find(message => message.role === 'tool' && (!toolCall.id || message.toolCallId === toolCall.id));
			const failed = resultMessage !== undefined && /"success"\s*:\s*false/.test(this.messageContentToText(resultMessage));
			const line = `- ${toolCall.toolName}${target ? ` ${target}` : ''}${failed ? ' (failed)' : ''}`;
			lines.push(line.length > CleanSlateContextBudgetManager.MAX_DIGEST_LINE_CHARS
				? `${line.slice(0, CleanSlateContextBudgetManager.MAX_DIGEST_LINE_CHARS - 1)}…`
				: line);
		}
		return lines;
	}

	private describeToolCallTarget(input: unknown): string {
		if (typeof input === 'string') {
			return input.slice(0, 80);
		}
		if (!input || typeof input !== 'object') {
			return '';
		}
		const record = input as Record<string, unknown>;
		for (const key of ['path', 'TargetFile', 'targetFile', 'file', 'command', 'query', 'Query', 'SearchPath', 'url', 'Url', 'name', 'symbol']) {
			const value = record[key];
			if (typeof value === 'string' && value.trim().length > 0) {
				return value.trim().slice(0, 100);
			}
		}
		return '';
	}

	private isCompactedHistoryMessage(message: IChatMessage): boolean {
		return message.role === 'system'
			&& typeof message.content === 'string'
			&& message.content.startsWith(CleanSlateContextBudgetManager.COMPACTED_HISTORY_HEADER);
	}

	private appendCompactedHistoryDigest(messages: IChatMessage[], lines: readonly string[]): void {
		if (lines.length === 0) {
			return;
		}
		let digest = messages.find(message => this.isCompactedHistoryMessage(message));
		if (!digest) {
			digest = {
				role: 'system',
				content: `${CleanSlateContextBudgetManager.COMPACTED_HISTORY_HEADER}\n${CleanSlateContextBudgetManager.COMPACTED_HISTORY_PREAMBLE}`
			};
			// Directly after the leading system prompt: stable position that the
			// drop passes never disturb.
			messages.splice(Math.min(1, messages.length), 0, digest);
		}
		const existing = String(digest.content).split('\n');
		const headerLines = existing.slice(0, 2);
		const entries = existing.slice(2).concat(lines);
		const capped = entries.slice(-CleanSlateContextBudgetManager.MAX_DIGEST_ENTRIES);
		digest.content = [...headerLines, ...capped].join('\n');
	}

	private collectToolTranscriptGroups(messages: readonly IChatMessage[]): Array<{ start: number; endExclusive: number }> {
		const groups: Array<{ start: number; endExclusive: number }> = [];
		for (let i = 1; i < messages.length; i++) {
			const message = messages[i];
			if (message.role !== 'assistant' || !message.toolCalls?.length) {
				continue;
			}

			const toolCallIds = new Set(message.toolCalls.map(toolCall => toolCall.id).filter((id): id is string => typeof id === 'string' && id.length > 0));
			let endExclusive = i + 1;
			while (endExclusive < messages.length && messages[endExclusive].role === 'tool') {
				const toolCallId = messages[endExclusive].toolCallId;
				if (toolCallIds.size > 0 && (!toolCallId || !toolCallIds.has(toolCallId))) {
					break;
				}
				endExclusive++;
			}

			groups.push({ start: i, endExclusive });
			i = endExclusive - 1;
		}
		return groups;
	}

	private dropMessagesWhileOverBudget(
		messages: IChatMessage[],
		budgetChars: number,
		result: ICleanSlateContextBudgetResult,
		canDrop: (message: IChatMessage) => boolean,
		kind: 'system' | 'history'
	): void {
		while (this.getMessagesCharCount(messages) > budgetChars) {
			const dropIndex = messages.findIndex((message, index) => index > 0 && canDrop(message));
			if (dropIndex === -1) {
				return;
			}
			messages.splice(dropIndex, 1);
			if (kind === 'system') {
				result.droppedSystemMessages++;
			} else {
				result.droppedHistoryMessages++;
			}
		}
	}

	private clampMessageContent(message: IChatMessage, maxChars: number, marker: string): boolean {
		if (typeof message.content === 'string') {
			const clamped = this.clampString(message.content, maxChars, marker);
			if (clamped !== message.content) {
				message.content = clamped;
				return true;
			}
			return false;
		}

		let changed = false;
		message.content = message.content.map(part => {
			if (part?.type !== 'text' || typeof part.text !== 'string') {
				return part;
			}
			const clamped = this.clampString(part.text, maxChars, marker);
			if (clamped !== part.text) {
				changed = true;
				return { ...part, text: clamped };
			}
			return part;
		});
		return changed;
	}

	private clampString(value: string, maxChars: number, marker: string): string {
		if (value.length <= maxChars) {
			return value;
		}
		const omitted = value.length - maxChars;
		return `${value.slice(0, Math.max(0, maxChars - marker.length - 80))}\n${marker}: ${omitted} chars omitted.`;
	}

	private isCurrentContextUserMessage(message: IChatMessage, messages: IChatMessage[]): boolean {
		if (message.role !== 'user') {
			return false;
		}
		const index = messages.indexOf(message);
		const lastUserIndex = messages.map((candidate, candidateIndex) => candidate.role === 'user' ? candidateIndex : -1).filter(index => index >= 0).pop();
		return index === lastUserIndex && this.messageContentToText(message).includes('[CONTEXT]');
	}

	public getMessagesCharCount(messages: readonly IChatMessage[]): number {
		return messages.reduce((total, message) => total
			+ message.role.length
			+ this.getContentCharCount(message.content)
			+ this.getToolCallsCharCount(message.toolCalls), 0);
	}

	private getContentCharCount(content: IChatMessage['content']): number {
		if (typeof content === 'string') {
			return content.length;
		}
		return content.reduce((total, part) => {
			if (part?.type === 'text' && typeof part.text === 'string') {
				return total + part.text.length;
			}
			return total + JSON.stringify(part).length;
		}, 0);
	}

	private getToolCallsCharCount(toolCalls: IChatMessage['toolCalls']): number {
		if (!toolCalls?.length) {
			return 0;
		}
		try {
			return JSON.stringify(toolCalls).length;
		} catch {
			return toolCalls.reduce((total, toolCall) => total
				+ String(toolCall.id ?? '').length
				+ toolCall.toolName.length
				+ String(toolCall.input ?? '').length, 0);
		}
	}

	private messageContentToText(message: IChatMessage): string {
		if (typeof message.content === 'string') {
			return message.content;
		}
		return message.content.map(part => part?.type === 'text' ? part.text : '').join('\n');
	}

	private cloneMessage(message: IChatMessage): IChatMessage {
		return {
			...message,
			content: this.cloneContent(message.content),
			toolCalls: message.toolCalls?.map(toolCall => ({ ...toolCall }))
		};
	}

	private cloneContent(content: IChatMessage['content']): IChatMessage['content'] {
		if (typeof content === 'string') {
			return content;
		}
		return content.map(part => ({
			...part,
			image_url: part.image_url ? { ...part.image_url } : undefined,
			cache_control: part.cache_control ? { ...part.cache_control } : undefined
		}));
	}
}
