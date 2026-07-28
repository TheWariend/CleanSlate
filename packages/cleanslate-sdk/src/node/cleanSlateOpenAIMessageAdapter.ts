/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Adapts canonical CleanSlate messages to OpenAI Chat and Responses request shapes. */
export class CleanSlateOpenAIMessageAdapter {
	public toChatMessage(message: any, index: number): any {
		if (message.role === 'tool') {
			return {
				role: 'tool',
				tool_call_id: message.toolCallId || `call_${index}`,
				content: this.messageContentToText(message.content)
			};
		}

		if (message.role === 'assistant' && message.toolCalls?.length) {
			return {
				role: 'assistant',
				content: this.messageContentToText(message.content) || null,
				tool_calls: message.toolCalls.map((toolCall: any, toolIndex: number) => ({
					id: toolCall.id || `call_${index}_${toolIndex}`,
					type: 'function',
					function: {
						name: toolCall.toolName,
						arguments: JSON.stringify(toolCall.input ?? {})
					}
				}))
			};
		}

		if (message.role === 'system') {
			return {
				role: 'system',
				content: this.messageContentToText(message.content) || ''
			};
		}

		if (Array.isArray(message.content)) {
			return {
				role: message.role,
				content: message.content.map((part: any) => {
					if (part?.type === 'image_url') {
						return { type: 'image_url', image_url: part.image_url };
					}
					return { type: 'text', text: part?.text ?? '' };
				})
			};
		}

		return {
			role: message.role,
			content: message.content || ''
		};
	}

	public toResponsesInput(messages: any[]): any[] {
		const input: any[] = [];
		for (let index = 0; index < messages.length; index++) {
			const message = messages[index];
			if (message.role === 'tool') {
				input.push({
					type: 'function_call_output',
					call_id: message.toolCallId || `call_${index}`,
					output: this.messageContentToText(message.content)
				});
				continue;
			}

			const text = this.messageContentToText(message.content);
			if (message.role === 'assistant' && message.toolCalls?.length) {
				if (text) {
					input.push({
						role: 'assistant',
						content: text
					});
				}
				for (const [toolIndex, toolCall] of message.toolCalls.entries()) {
					input.push({
						type: 'function_call',
						call_id: toolCall.id || `call_${index}_${toolIndex}`,
						name: toolCall.toolName,
						arguments: JSON.stringify(toolCall.input ?? {})
					});
				}
				continue;
			}

			input.push({
				role: message.role === 'system' ? 'developer' : message.role,
				content: Array.isArray(message.content) ? this.toOpenAIResponsesContent(message.content) : (message.content || '')
			});
		}
		return input;
	}

	private toOpenAIResponsesContent(content: any[]): any[] {
		return content
			.map(part => {
				if (part?.type === 'text') {
					return { type: 'input_text', text: part.text ?? '' };
				}
				if (part?.type === 'image_url' && typeof part.image_url?.url === 'string') {
					return { type: 'input_image', image_url: part.image_url.url };
				}
				return undefined;
			})
			.filter(Boolean);
	}

	private messageContentToText(content: any): string {
		if (typeof content === 'string') {
			return content;
		}
		if (Array.isArray(content)) {
			return content.filter(part => part?.type === 'text').map(part => part.text ?? '').filter(text => text.length > 0).join('\n');
		}
		return '';
	}
}
