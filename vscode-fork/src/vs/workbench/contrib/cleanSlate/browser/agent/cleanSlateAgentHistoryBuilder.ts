/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CLEANSLATE_FALLBACK_CONTEXT_WINDOW_TOKENS, IChatMessage } from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';

/** Builds bounded provider history without persisted render or ephemeral context state. */
export class CleanSlateAgentHistoryBuilder {
    public getContextWindowCharBudget(config: any): number {
        const configuredWindow = Number.isFinite(config?.contextWindow)
            ? Math.max(1, Math.floor(config.contextWindow))
            : CLEANSLATE_FALLBACK_CONTEXT_WINDOW_TOKENS;

        return Math.max(4000, configuredWindow * 4);
    }

    public prepareBudgetedDialogueHistory(
        rawHistory: readonly { role: string; content: string; isInternalState?: boolean; renderPayload?: string; images?: string[] }[],
        rawCurrentUserMessage: string,
        currentUserRequest: string,
        historyBudgetChars: number
    ): IChatMessage[] {
        const historyWithoutCurrentTurn = this.dropCurrentTurnEcho(rawHistory, rawCurrentUserMessage);
        const dialogueHistory = historyWithoutCurrentTurn
            .map(message => this.cloneThreadMessageForPrompt(message))
            .filter((message): message is IChatMessage => !!message);

        const initialHistoryAndRequestChars = this.getMessagesCharCount(dialogueHistory) + currentUserRequest.length;
        if (initialHistoryAndRequestChars <= historyBudgetChars) {
            return dialogueHistory;
        }

        return this.pruneHistoryToBudget(dialogueHistory, currentUserRequest, historyBudgetChars);
    }

    private dropCurrentTurnEcho<T extends { role: string; content: string }>(history: readonly T[], rawCurrentUserMessage: string): T[] {
        const normalizedCurrent = rawCurrentUserMessage.trim();
        if (!normalizedCurrent) {
            return [...history];
        }

        for (let i = history.length - 1; i >= 0; i--) {
            const message = history[i];
            if (message.role === 'user' && this.stripEphemeralContextFromText(message.content).trim() === normalizedCurrent) {
                return history.slice(0, i).concat(history.slice(i + 1));
            }
        }

        return [...history];
    }

    private cloneThreadMessageForPrompt(message: { role: string; content: string; images?: string[] }): IChatMessage | undefined {
        const role = this.toChatRole(message.role);
        if (!role) {
            return undefined;
        }

        const textContent = role === 'user'
            ? this.stripEphemeralContextFromText(message.content)
            : message.content;
		const content: IChatMessage['content'] = role === 'user' && message.images?.length
			? [
				{ type: 'text', text: textContent },
				...message.images.map(image => ({ type: 'image_url' as const, image_url: { url: image } }))
			]
			: textContent;

        return this.cloneChatMessage({ role, content });
    }

    private toChatRole(role: string): IChatMessage['role'] | undefined {
        if (role === 'user' || role === 'assistant' || role === 'system') {
            return role;
        }
        if (role === 'cleanSlate') {
            return 'assistant';
        }
        return undefined;
    }

    public stripEphemeralContextFromText(content: string): string {
        const markerMatch = /\[CONTEXT(?:\s*-[^\]]+)?\]/.exec(content);
        if (!markerMatch || markerMatch.index === undefined) {
            return content;
        }

        const beforeContext = content.slice(0, markerMatch.index).trim();
        const afterMarker = content.slice(markerMatch.index + markerMatch[0].length);
        const userRequestMatch = /\n\s*User Request:\s*/.exec(afterMarker);
        if (!userRequestMatch || userRequestMatch.index === undefined) {
            return beforeContext || '[Previous ephemeral context stripped]';
        }

        const userRequest = afterMarker.slice(userRequestMatch.index + userRequestMatch[0].length).trim();
        return [beforeContext, userRequest].filter(part => part.length > 0).join('\n\n');
    }

    private pruneHistoryToBudget(history: IChatMessage[], currentUserRequest: string, historyBudgetChars: number): IChatMessage[] {
        const pruned = history.map(message => this.cloneChatMessage(message));
        let firstObjectiveIndex = pruned.findIndex(message => message.role === 'user');

        while (
            pruned.length > 0
            && this.getMessagesCharCount(pruned) + currentUserRequest.length > historyBudgetChars
        ) {
            const dropIndex = pruned.findIndex((_, index) => index !== firstObjectiveIndex);
            if (dropIndex === -1) {
                break;
            }

            pruned.splice(dropIndex, 1);
            if (firstObjectiveIndex > dropIndex) {
                firstObjectiveIndex--;
            }
        }

        return pruned;
    }

    public cloneChatMessage(message: IChatMessage): IChatMessage {
        return {
            role: message.role,
            content: this.cloneMessageContent(message.content),
            toolCallId: message.toolCallId,
            toolName: message.toolName,
            toolCalls: message.toolCalls?.map(toolCall => ({
                id: toolCall.id,
                toolName: toolCall.toolName,
                input: toolCall.input,
                providerMetadata: toolCall.providerMetadata
            }))
        };
    }

    public cloneMessageContent(content: IChatMessage['content']): IChatMessage['content'] {
        if (typeof content === 'string') {
            return content;
        }

        return content.map(part => ({
            ...part,
            image_url: part.image_url ? { ...part.image_url } : undefined,
            cache_control: part.cache_control ? { ...part.cache_control } : undefined
        }));
    }

    private getMessagesCharCount(messages: readonly IChatMessage[]): number {
        return messages.reduce((total, message) => total + message.role.length + this.getMessageContentCharCount(message.content), 0);
    }

    private getMessageContentCharCount(content: IChatMessage['content']): number {
        if (typeof content === 'string') {
            return content.length;
        }

        return content.reduce((total, part) => {
            if (part.type === 'text') {
                return total + (part.text?.length ?? 0);
            }
            // Base64 length is not a useful approximation of provider image tokens and
            // would make a single screenshot evict itself from recent dialogue history.
            return total + 4096;
        }, 0);
    }

}
