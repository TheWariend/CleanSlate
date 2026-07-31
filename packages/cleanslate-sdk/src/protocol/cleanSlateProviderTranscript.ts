/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Transcript flattening shared by the provider paths that cannot represent tool
 * calls natively. Gemini and Bedrock both need CleanSlate's tool turns rendered
 * back into plain text, and the exact wording is part of the wire contract with
 * the model — a host that formats it differently gets different completions, so
 * this lives in one place rather than in each host's main service.
 */

/** Collapses a message content payload (string or part array) to plain text. */
export function messageContentToText(content: any): string {
	if (typeof content === 'string') {
		return content;
	}
	if (Array.isArray(content)) {
		return content
			.filter(part => part?.type === 'text')
			.map(part => part.text ?? '')
			.filter(text => text.length > 0)
			.join('\n');
	}
	return '';
}

/** JSON stringify that degrades to String() rather than throwing on cycles. */
export function safeStringifyForTranscript(value: any): string {
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

/** Maps message content to Gemini parts, inlining base64 data-URL images. */
export function toGeminiParts(content: any): any[] {
	if (typeof content === 'string') {
		return content.trim().length > 0 ? [{ text: content }] : [];
	}

	if (!Array.isArray(content)) {
		return [];
	}

	return content.map(part => {
		if (part?.type === 'text') {
			return { text: part.text ?? '' };
		}
		if (part?.type === 'image_url' && part.image_url?.url) {
			const match = String(part.image_url.url).match(/^data:(image\/[a-zA-Z0-9.\-+]+);base64,(.*)$/);
			if (match) {
				return {
					inlineData: {
						mimeType: match[1],
						data: match[2]
					}
				};
			}
		}
		return null;
	}).filter(Boolean);
}

export function toGeminiToolCallTranscriptText(toolCall: any, toolCallId: string): string {
	return [
		`Tool call (${toolCallId}): ${toolCall.toolName || 'tool'}`,
		`Arguments: ${safeStringifyForTranscript(toolCall.input ?? {})}`
	].join('\n');
}

export function toGeminiToolResultTranscriptText(toolMessage: any): string {
	return [
		`Tool result (${toolMessage.toolCallId || 'tool_result'}): ${toolMessage.toolName || 'tool'}`,
		messageContentToText(toolMessage.content)
	].filter(part => typeof part === 'string' && part.trim().length > 0).join('\n');
}

/**
 * Rewrites a CleanSlate message list into Gemini `contents`, folding tool calls
 * and tool results into text turns. Consecutive tool messages collapse into a
 * single user turn so the model sees one result block per round trip.
 */
export function toGeminiContents(messages: any[]): { contents: any[]; systemInstruction?: any } {
	const systemParts: any[] = [];
	const contents: any[] = [];

	for (let index = 0; index < messages.length; index++) {
		const message = messages[index];
		if (message.role === 'system') {
			systemParts.push(...toGeminiParts(message.content));
			continue;
		}

		if (message.role === 'tool') {
			const parts: any[] = [];
			while (index < messages.length && messages[index].role === 'tool') {
				const toolMessage = messages[index];
				parts.push({
					text: toGeminiToolResultTranscriptText(toolMessage)
				});
				index++;
			}
			index--;
			contents.push({
				role: 'user',
				parts
			});
			continue;
		}

		const parts = toGeminiParts(message.content);
		if (message.role === 'assistant' && message.toolCalls?.length) {
			for (let toolIndex = 0; toolIndex < message.toolCalls.length; toolIndex++) {
				const toolCall = message.toolCalls[toolIndex];
				const toolCallId = toolCall.id || `call_${index}_${toolIndex}`;
				parts.push({
					text: toGeminiToolCallTranscriptText(toolCall, toolCallId)
				});
			}
		}
		if (parts.length) {
			contents.push({
				role: message.role === 'assistant' ? 'model' : 'user',
				parts
			});
		}
	}

	return {
		contents,
		systemInstruction: systemParts.length ? { role: 'user', parts: systemParts } : undefined
	};
}
