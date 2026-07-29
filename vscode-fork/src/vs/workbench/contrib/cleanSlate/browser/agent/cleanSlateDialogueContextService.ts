/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CLEANSLATE_FALLBACK_CONTEXT_WINDOW_TOKENS, IChatMessage, ICleanSlateConfigurationService } from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { CleanSlateThreadService } from '@cleanslate/sdk/services/cleanSlateThreadService.js';

interface IDialogueContextOptions {
	minUserTurns?: number;
	maxChars?: number;
	useFullThread?: boolean;
}

export class CleanSlateDialogueContextService {
	static readonly DEFAULT_RECENT_USER_TURNS = 10;

	constructor(private readonly configService: ICleanSlateConfigurationService) { }

	buildDialogueHistory(
		threadService: CleanSlateThreadService,
		currentUserMessage: string,
		options: IDialogueContextOptions = {}
	): IChatMessage[] {
		const rawHistory = this.getRecentVisibleDialogueWindow(
			threadService,
			options.minUserTurns ?? CleanSlateDialogueContextService.DEFAULT_RECENT_USER_TURNS,
			options.useFullThread ?? true
		);
		const historyBudgetChars = options.maxChars ?? this.defaultHistoryBudgetChars();
		return this.prepareBudgetedDialogueHistory(rawHistory, currentUserMessage, currentUserMessage, historyBudgetChars);
	}

	buildDialogueMemoryPrompt(
		threadService: CleanSlateThreadService,
		currentUserMessage: string,
		options: IDialogueContextOptions = {}
	): string {
		const history = this.buildDialogueHistory(threadService, currentUserMessage, options);
		if (history.length === 0) {
			return '';
		}

		const lines = history
			.map(message => {
				const label = message.role === 'assistant' ? 'Assistant' : message.role === 'user' ? 'User' : 'System';
				const content = this.getMessageText(message.content).trim();
				return content ? `${label}: ${content}` : '';
			})
			.filter(Boolean);

		if (lines.length === 0) {
			return '';
		}

		return [
			'[RECENT THREAD MEMORY]',
			'Recent visible user/assistant dialogue across task boundaries. Use this to understand follow-up intent, what was already tried, and which project landmarks are likely relevant. Still verify before editing.',
			...lines
		].join('\n');
	}

	private getRecentVisibleDialogueWindow(
		threadService: CleanSlateThreadService,
		minUserTurns: number,
		useFullThread: boolean
	): { role: string; content: string; isInternalState?: boolean; renderPayload?: string; images?: string[] }[] {
		const sourceHistory = useFullThread ? threadService.getHistory() : threadService.getActiveTaskHistory();
		const visibleDialogue = sourceHistory.filter(message => {
			if (message.isInternalState) {
				return false;
			}
			const role = message.role === 'cleanSlate' ? 'assistant' : message.role;
			return (role === 'user' || role === 'assistant')
				&& typeof message.content === 'string'
				&& message.content.trim().length > 0;
		});

		if (visibleDialogue.length === 0) {
			return [];
		}

		let userTurns = 0;
		let startIndex = 0;
		for (let i = visibleDialogue.length - 1; i >= 0; i--) {
			if (visibleDialogue[i].role === 'user') {
				userTurns++;
				if (userTurns >= minUserTurns) {
					startIndex = i;
					break;
				}
			}
		}

		return visibleDialogue.slice(startIndex);
	}

	private prepareBudgetedDialogueHistory(
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
			: this.normalizeAssistantHistoryContent(message.content);
		const content: IChatMessage['content'] = role === 'user' && message.images?.length
			? [
				{ type: 'text', text: textContent },
				...message.images.map(image => ({ type: 'image_url' as const, image_url: { url: image } }))
			]
			: textContent;

		return { role, content };
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

	private normalizeAssistantHistoryContent(content: string): string {
		const trimmed = content.trim();
		if (!trimmed) {
			return content;
		}

		try {
			const parsed = JSON.parse(trimmed);
			const summary = Array.isArray(parsed?.summary)
				? parsed.summary.find((entry: unknown) => typeof entry === 'string' && entry.trim().length > 0)
				: parsed?.summary;
			return typeof summary === 'string' && summary.trim().length > 0 ? summary.trim() : content;
		} catch {
			return content;
		}
	}

	private stripEphemeralContextFromText(content: string): string {
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
		const pruned = history.map(message => ({ ...message }));
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

	private defaultHistoryBudgetChars(): number {
		const config = this.configService.getConfiguration();
		const configuredWindow = Number.isFinite((config as any)?.contextWindow)
			? Math.max(1, Math.floor((config as any).contextWindow))
			: CLEANSLATE_FALLBACK_CONTEXT_WINDOW_TOKENS;
		const contextWindowChars = Math.max(4000, configuredWindow * 4);
		return Math.max(12000, Math.floor(contextWindowChars * 0.35));
	}

	private getMessagesCharCount(messages: readonly IChatMessage[]): number {
		return messages.reduce((total, message) => total + message.role.length + this.getMessageContentCharCount(message.content), 0);
	}

	private getMessageContentCharCount(content: IChatMessage['content']): number {
		if (typeof content === 'string') {
			return content.length;
		}

		return content.reduce((total, part) =>
			total + (part.type === 'text' ? part.text?.length ?? 0 : 4096), 0);
	}

	private getMessageText(content: IChatMessage['content']): string {
		if (typeof content === 'string') {
			return content;
		}

		return content
			.map(part => part.type === 'text' ? part.text ?? '' : '[Image attached]')
			.join('');
	}
}
