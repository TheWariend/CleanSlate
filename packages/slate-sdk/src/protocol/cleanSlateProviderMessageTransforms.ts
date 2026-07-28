/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AIProvider, IChatMessage, IChatMessagePart } from './cleanSlateAI.js';
import { resolveCleanSlateModelFamily } from './cleanSlateModelCapabilities.js';

export type CleanSlateProviderMessageTarget = 'openaiCompatible' | 'anthropic' | 'gemini' | 'bedrock';

export interface ICleanSlateProviderMessageTransformOptions {
	target: CleanSlateProviderMessageTarget;
	model?: string;
	provider?: AIProvider;
	hasTools?: boolean;
}

export function normalizeCleanSlateMessagesForProvider(
	messages: readonly IChatMessage[],
	options: ICleanSlateProviderMessageTransformOptions
): IChatMessage[] {
	let normalized = messages
		.map(message => normalizeMessage(message, options))
		.filter((message): message is IChatMessage => !!message);

	normalized = applyModelSpecificMessageTransforms(normalized, options);
	if (options.hasTools === false) {
		normalized = flattenToolHistory(normalized);
	}

	if (options.target === 'openaiCompatible') {
		return normalized;
	}

	return normalized.filter(message => {
		if (message.role === 'assistant' && message.toolCalls?.length) {
			return true;
		}
		if (message.role === 'tool') {
			return true;
		}
		return messageContentToText(message.content).trim().length > 0;
	});
}

function flattenToolHistory(messages: IChatMessage[]): IChatMessage[] {
	return messages
		.map(message => {
			if (message.role === 'tool') {
				const toolLabel = message.toolName ? ` (${message.toolName})` : '';
				return {
					role: 'user' as const,
					content: `[Tool result${toolLabel}]\n${messageContentToText(message.content)}`
				};
			}
			if (message.role === 'assistant' && message.toolCalls?.length) {
				return { role: message.role, content: message.content };
			}
			return message;
		})
		.filter(message => messageContentToText(message.content).trim().length > 0);
}

function normalizeMessage(message: IChatMessage, options: ICleanSlateProviderMessageTransformOptions): IChatMessage | undefined {
	const normalized: IChatMessage = {
		role: message.role,
		content: normalizeContent(message.content, options.target),
		toolCallId: message.toolCallId,
		toolName: normalizeToolName(message.toolName, options.target),
		toolCalls: message.toolCalls?.map((toolCall, index) => ({
			id: normalizeToolCallId(toolCall.id || `call_${index}`, options.target),
			toolName: normalizeToolName(toolCall.toolName, options.target) || toolCall.toolName,
			input: toolCall.input ?? {},
			providerMetadata: toolCall.providerMetadata
		}))
	};

	if (normalized.role === 'tool') {
		normalized.toolCallId = normalizeToolCallId(normalized.toolCallId || 'tool_result', options.target);
		if (!messageContentToText(normalized.content).trim()) {
			normalized.content = '{}';
		}
	}

	if (normalized.role === 'assistant' && normalized.toolCalls?.length) {
		normalized.toolCalls = normalized.toolCalls.map((toolCall, index) => ({
			...toolCall,
			id: normalizeToolCallId(toolCall.id || `call_${index}`, options.target)
		}));
	}

	return normalized;
}

function normalizeContent(content: IChatMessage['content'], target: CleanSlateProviderMessageTarget): IChatMessage['content'] {
	if (typeof content === 'string') {
		return sanitizeText(content);
	}
	// cache_control is Anthropic-only prompt caching syntax. Strip it for every
	// other target to avoid 400 validation errors on openai-compatible endpoints.
	const keepCacheControl = target === 'anthropic';
	return content.map(part => {
		if (part?.type === 'text') {
			const normalized: IChatMessagePart = { type: 'text', text: sanitizeText(part.text ?? '') };
			if (keepCacheControl && part.cache_control) {
				normalized.cache_control = part.cache_control;
			}
			return normalized;
		}
		// Non-text parts (e.g. image_url): also strip cache_control if not Anthropic
		if (!keepCacheControl) {
			const { cache_control: _cc, ...rest } = part as any;
			void _cc;
			return rest as IChatMessagePart;
		}
		return { ...part };
	});
}

export function normalizeToolName(toolName: string | undefined, target?: CleanSlateProviderMessageTarget): string | undefined {
	if (!toolName) {
		return undefined;
	}
	void target;
	const trimmed = toolName.trim();
	// Remove 'functions.' prefix if present
	let name = trimmed.startsWith('functions.')
		? trimmed.slice('functions.'.length)
		: trimmed;

	// Always sanitize tool names for provider compatibility
	name = name.replace(/[^a-zA-Z0-9_-]/g, '_');
	return name;
}

function normalizeToolCallId(id: string, target: CleanSlateProviderMessageTarget): string {
	const trimmed = String(id || '').trim() || 'tool_call';
	if (target === 'openaiCompatible') {
		return trimmed;
	}
	return trimmed.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function applyModelSpecificMessageTransforms(messages: IChatMessage[], options: ICleanSlateProviderMessageTransformOptions): IChatMessage[] {
	const provider = options.provider ?? 'openai';
	const family = resolveCleanSlateModelFamily(provider, options.model);
	if (family !== 'mistral') {
		return messages;
	}

	const scrubMistralToolCallId = (id: string | undefined) => String(id || 'tool_call')
		.replace(/[^a-zA-Z0-9]/g, '')
		.substring(0, 9)
		.padEnd(9, '0');

	// Mistral only allows a system message at position 0. Any system message
	// appearing later in the conversation causes a 400 "Unexpected role 'system'
	// after role 'tool'" (or similar). Convert mid-conversation system messages
	// to user messages so the sequence stays valid.
	const remapped = messages.map((message, index) => {
		if (message.role === 'system' && index > 0) {
			return { ...message, role: 'user' as const };
		}
		return message;
	});

	const transformedMessages: IChatMessage[] = [];
	for (let index = 0; index < remapped.length; index++) {
		const message = remapped[index];
		const nextMessage = remapped[index + 1];
		if (message.role === 'assistant' && message.toolCalls?.length) {
			transformedMessages.push({
				...message,
				toolCalls: message.toolCalls.map(toolCall => ({
					...toolCall,
					id: scrubMistralToolCallId(toolCall.id)
				}))
			});
		} else if (message.role === 'tool') {
			transformedMessages.push({
				...message,
				toolCallId: scrubMistralToolCallId(message.toolCallId)
			});
		} else {
			transformedMessages.push(message);
		}

		// Mistral requires an assistant turn between a tool result and the next
		// user/system turn. Insert a lightweight bridge message to satisfy this.
		if (message.role === 'tool' && (nextMessage?.role === 'user' || nextMessage?.role === 'system')) {
			transformedMessages.push({
				role: 'assistant',
				content: 'Done.'
			});
		}
	}
	return transformedMessages;
}


function sanitizeText(value: string): string {
	return value.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

function messageContentToText(content: IChatMessage['content']): string {
	if (typeof content === 'string') {
		return content;
	}
	return content.map(part => part?.type === 'text' ? part.text : '').join('\n');
}
