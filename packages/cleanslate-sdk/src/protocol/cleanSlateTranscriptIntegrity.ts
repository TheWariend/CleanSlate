/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChatMessage, IToolCall } from './cleanSlateAI.js';

export class CleanSlateTranscriptIntegrityError extends Error {
	readonly code = 'invalid_tool_history';

	constructor(index: number, reason: string) {
		super(`[invalid_tool_history] Saved tool history is inconsistent at message ${index}: ${reason}. Recover the saved conversation or start a new one.`);
		this.name = 'CleanSlateTranscriptIntegrityError';
	}
}

/**
 * Prepare a prompt copy without changing saved history or executing tools.
 * Missing results describe an unknown outcome; missing calls and ambiguous IDs
 * require recovery from authoritative history rather than invented tool calls.
 */
export function prepareCleanSlateProviderMessages(
	messages: readonly IChatMessage[],
	onMissingResult?: (toolCallId: string) => void
): IChatMessage[] {
	const prepared: IChatMessage[] = [];
	const seenCallIds = new Set<string>();
	const missingResultIds: string[] = [];
	for (let index = 0; index < messages.length; index++) {
		const message = messages[index];
		const fail = (reason: string): never => { throw new CleanSlateTranscriptIntegrityError(index, reason); };
		if (message.role === 'tool') {
			fail(`tool result ${message.toolCallId ?? '(missing ID)'} has no immediately preceding call`);
		}
		if (message.toolCalls !== undefined && !Array.isArray(message.toolCalls)) {
			fail('tool calls must be an array');
		}
		if (!message.toolCalls?.length) {
			prepared.push(message);
			continue;
		}
		if (message.role !== 'assistant') {
			fail('only assistant messages can contain tool calls');
		}
		const calls = new Map<string, IToolCall>();
		for (const call of message.toolCalls) {
			if (!call || typeof call.id !== 'string' || !call.id.trim()) {
				fail('a tool call is missing its stable ID');
			}
			if (typeof call.toolName !== 'string' || !call.toolName.trim()) {
				fail(`tool call ${call.id} is missing its name`);
			}
			if (seenCallIds.has(call.id!)) {
				fail(`duplicate tool call ID ${call.id}`);
			}
			seenCallIds.add(call.id!);
			calls.set(call.id!, call);
		}
		const results: IChatMessage[] = [];
		const resultIds = new Set<string>();
		while (index + 1 < messages.length && messages[index + 1].role === 'tool') {
			const result = messages[++index];
			const id = result.toolCallId;
			if (typeof id !== 'string' || !id.trim()) {
				fail('a tool result is missing its stable ID');
			}
			const call = calls.get(id!);
			if (!call) {
				fail(`tool result ${id} does not belong to the immediately preceding call group`);
			}
			if (resultIds.has(id!)) {
				fail(`duplicate tool result ID ${id}`);
			}
			if (result.toolName !== undefined && result.toolName !== call!.toolName) {
				fail(`tool result ${id} has a different tool name from its call`);
			}
			resultIds.add(id!);
			results.push(result);
		}
		prepared.push(message.content == null ? { ...message, content: '' } : message, ...results);
		for (const [id, call] of calls) {
			if (resultIds.has(id)) {
				continue;
			}
			missingResultIds.push(id);
			prepared.push({
				role: 'tool',
				toolCallId: id,
				toolName: call.toolName,
				content: JSON.stringify({
					success: false,
					code: 'tool_result_missing',
					message: 'No result was recorded for this tool call. Its execution status is unknown. Do not assume success or repeat an external action without checking its state.'
				})
			});
		}
	}
	for (const id of missingResultIds) {
		onMissingResult?.(id);
	}
	return prepared;
}
