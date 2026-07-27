/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICleanSlateAnthropicMessagesOptions } from '../../common/core/cleanSlateAI.js';
import { CleanSlateProviderSchemaNormalizer } from './cleanSlateProviderSchemaNormalizer.js';

/** Adapts canonical CleanSlate messages and tools to Anthropic Messages requests. */
export class CleanSlateAnthropicMessageAdapter {
    constructor(private readonly schemaNormalizer: CleanSlateProviderSchemaNormalizer) { }

    public toMessagesRequest(options: ICleanSlateAnthropicMessagesOptions): any {
        const system: any[] = [];
        const messages: any[] = [];

        for (let index = 0; index < options.messages.length; index++) {
            const message = options.messages[index];
            if (message.role === 'system') {
                const systemContent = this.toAnthropicContentParts(message.content);
                system.push(...systemContent);
                continue;
            }

            if (message.role === 'tool') {
                const content: any[] = [];
                while (index < options.messages.length && options.messages[index].role === 'tool') {
                    const toolMessage = options.messages[index];
                    content.push({
                        type: 'tool_result',
                        tool_use_id: toolMessage.toolCallId || `tool_${index}`,
                        content: this.messageContentToText(toolMessage.content)
                    });
                    index++;
                }
                index--;
                messages.push({
                    role: 'user',
                    content
                });
                continue;
            }

            const content = this.toAnthropicContentParts(message.content);
            if (message.role === 'assistant' && message.toolCalls?.length) {
                content.push(...message.toolCalls.map((toolCall: any, index: number) => ({
                    type: 'tool_use',
                    id: toolCall.id || `call_${index}`,
                    name: toolCall.toolName,
                    input: toolCall.input ?? {}
                })));
            }

            if (content.length) {
                messages.push({
                    role: message.role === 'assistant' ? 'assistant' : 'user',
                    content
                });
            }
        }

        const body: any = {
            model: options.model,
            messages,
            stream: true,
            max_tokens: options.maxOutputTokens || 16384
        };
        if (options.temperature !== undefined) {
            body.temperature = options.temperature;
        }
        if (options.topP !== undefined) {
            body.top_p = options.topP;
        }
        if (options.thinking) {
            body.thinking = this.toAnthropicMessagesThinking(options.thinking);
        }
        if (system.length) {
            body.system = system.length === 1 && system[0]?.type === 'text' ? system[0].text : system;
        }
        if (options.options?.tools?.length) {
            body.tools = options.options.tools.map(tool => ({
                name: tool.name,
                description: tool.description,
                input_schema: this.schemaNormalizer.normalizeJsonObjectSchema(tool.parametersSchema, { target: 'anthropic', model: options.model })
            }));
            body.tool_choice = options.options.requiredToolName
                ? { type: 'tool', name: options.options.requiredToolName }
                : undefined;
        }
        return body;
    }

    private toAnthropicMessagesThinking(thinking: Record<string, any>): Record<string, any> {
        const result = { ...thinking };
        if (typeof result.budgetTokens === 'number' && result.budget_tokens === undefined) {
            result.budget_tokens = result.budgetTokens;
            delete result.budgetTokens;
        }
        return result;
    }

    private toAnthropicContentParts(content: any): any[] {
        if (typeof content === 'string') {
            return content.trim().length > 0 ? [{ type: 'text', text: content }] : [];
        }

        if (!Array.isArray(content)) {
            return [];
        }

        return content.map(part => {
            if (part?.type === 'text') {
                return {
                    type: 'text',
                    text: part.text ?? '',
                    ...(part.cache_control && { cache_control: part.cache_control })
                };
            }
            if (part?.type === 'image_url' && part.image_url?.url) {
                const match = String(part.image_url.url).match(/^data:(image\/[a-zA-Z0-9.\-+]+);base64,(.*)$/);
                if (match) {
                    return {
                        type: 'image',
                        source: { type: 'base64', media_type: match[1], data: match[2] },
                        ...(part.cache_control && { cache_control: part.cache_control })
                    };
                }
            }
            return null;
        }).filter(Boolean);
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
