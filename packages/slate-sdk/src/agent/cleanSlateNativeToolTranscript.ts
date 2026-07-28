/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChatMessage } from '../protocol/cleanSlateAI.js';
import { CleanSlateStreamPart, ParsedToolCall } from './cleanSlateAgentTypes.js';
import { serializeToolResultForPrompt } from './cleanSlateToolResultPromptSerializer.js';

export class CleanSlateNativeToolTranscript {
	private nextSyntheticToolCallId = 1;

	constructor(private readonly idPrefix: string) { }

	parseToolCall(call: { id?: string; toolName?: string; input?: any; providerMetadata?: ParsedToolCall['providerMetadata'] } | undefined): ParsedToolCall | undefined {
		const toolName = this.normalizeToolName(typeof call?.toolName === 'string' ? call.toolName : '');
		return toolName
			? { id: this.normalizeToolCallId(call?.id, toolName), toolName, input: call?.input ?? {}, providerMetadata: call?.providerMetadata }
			: undefined;
	}

	buildAssistantToolCallMessage(content: string, toolCalls: ParsedToolCall[]): IChatMessage {
		return {
			role: 'assistant',
			content,
			toolCalls: toolCalls.map(toolCall => ({
				id: toolCall.id,
				toolName: toolCall.toolName,
				input: toolCall.input ?? {},
				providerMetadata: toolCall.providerMetadata
			}))
		};
	}

	buildToolResultMessage(toolCall: ParsedToolCall, result: any, maxChars?: number): IChatMessage {
		return {
			role: 'tool',
			toolCallId: toolCall.id,
			toolName: toolCall.toolName,
			content: serializeToolResultForPrompt(toolCall.toolName, result, maxChars)
		};
	}

	attachToolCallId(part: CleanSlateStreamPart, toolCallId: string | undefined): CleanSlateStreamPart {
		if ((part.type === 'tool_start' || part.type === 'tool_progress' || part.type === 'tool_result') && toolCallId) {
			return { ...part, toolCallId };
		}
		return part;
	}

	getToolCallKey(toolCall: ParsedToolCall): string {
		return toolCall.id || this.getToolCallSemanticKey(toolCall);
	}

	getToolCallSemanticKey(toolCall: ParsedToolCall): string {
		try {
			return `${toolCall.toolName}:${JSON.stringify(toolCall.input ?? {})}`;
		} catch {
			return `${toolCall.toolName}:${String(toolCall.input)}`;
		}
	}

	normalizeToolName(toolName: string): string {
		const trimmed = toolName.trim();
		return trimmed.startsWith('functions.')
			? trimmed.slice('functions.'.length)
			: trimmed;
	}

	private normalizeToolCallId(id: unknown, toolName: string): string {
		return typeof id === 'string' && id.trim().length > 0
			? id.trim()
			: `call_${this.sanitizeIdPart(this.idPrefix)}_${this.sanitizeIdPart(toolName)}_${this.nextSyntheticToolCallId++}`;
	}

	private sanitizeIdPart(value: string): string {
		return Array.from(value).map(char => {
			const code = char.charCodeAt(0);
			const isDigit = code >= 48 && code <= 57;
			const isUpper = code >= 65 && code <= 90;
			const isLower = code >= 97 && code <= 122;
			return isDigit || isUpper || isLower || char === '_' || char === '-'
				? char
				: '_';
		}).join('');
	}
}
