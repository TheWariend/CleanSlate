/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IChatMessage,
	ICleanSlateAgentRuntimeSnapshot,
	ICleanSlatePendingAgentInteraction,
	IToolCall
} from '../protocol/cleanSlateAI.js';

export interface ICleanSlateAgentSessionMetadata {
	readonly objective?: string;
	readonly mode?: string;
	readonly phase?: string;
}

/**
 * Owns the native model/tool transcript for one GUI session.
 *
 * The visible thread is a projection for rendering. This transcript is the
 * protocol source of truth and therefore survives plan handoffs, interactive
 * questions, and application reloads.
 */
export class CleanSlateAgentSession {
	private messages: IChatMessage[] = [];
	private objective: string | undefined;
	private mode: string | undefined;
	private phase: string | undefined;
	private pendingInteraction: ICleanSlatePendingAgentInteraction | undefined;

	public start(messages: readonly IChatMessage[], metadata: ICleanSlateAgentSessionMetadata = {}): IChatMessage[] {
		this.messages = messages.map(message => this.cloneMessage(message));
		this.updateMetadata(metadata);
		this.pendingInteraction = undefined;
		return this.messages;
	}

	public continueWithLatestUserMessage(
		seedMessages: readonly IChatMessage[],
		metadata: ICleanSlateAgentSessionMetadata = {}
	): IChatMessage[] {
		if (this.messages.length === 0) {
			return this.start(seedMessages, metadata);
		}

		const latestUserMessage = this.findLatestUserMessage(seedMessages);
		if (latestUserMessage && !this.isDuplicateTail(latestUserMessage)) {
			this.messages.push(this.cloneMessage(latestUserMessage));
		}
		this.updateMetadata(metadata);
		return this.messages;
	}

	/** Appends trailing mode/context reminders plus the new user turn. */
	public continueWithTurn(
		seedMessages: readonly IChatMessage[],
		metadata: ICleanSlateAgentSessionMetadata = {}
	): IChatMessage[] {
		if (this.messages.length === 0) {
			return this.start(seedMessages, metadata);
		}

		for (const message of seedMessages) {
			if (message.role === 'system') {
				this.appendMessage(message);
			}
		}
		const latestUserMessage = this.findLatestUserMessage(seedMessages);
		if (latestUserMessage) {
			this.appendMessage(latestUserMessage);
		}
		this.updateMetadata(metadata);
		return this.messages;
	}

	public appendMessage(message: IChatMessage): void {
		if (!this.isDuplicateTail(message)) {
			this.messages.push(this.cloneMessage(message));
		}
	}

	public getMutableMessages(): IChatMessage[] {
		return this.messages;
	}

	public hasMessages(): boolean {
		return this.messages.length > 0;
	}

	public pauseForQuestion(toolCall: IToolCall, question: unknown): void {
		this.pendingInteraction = {
			kind: 'question',
			toolCallId: this.requireToolCallId(toolCall),
			toolName: 'ask_question',
			question: this.cloneValue(question),
			objective: this.objective,
			mode: this.mode,
			phase: this.phase
		};
	}

	public hasPendingQuestion(): boolean {
		return this.pendingInteraction?.kind === 'question';
	}

	/**
	 * Completes the suspended ask_question call with the user's answer. The
	 * answer is appended as the result of the original tool call, never as a
	 * fresh model-facing user turn.
	 */
	public resumePendingQuestion(answer: string): ICleanSlatePendingAgentInteraction | undefined {
		const pending = this.pendingInteraction;
		if (!pending || pending.kind !== 'question') {
			return undefined;
		}

		const normalizedAnswer = answer.trim();
		const questionText = this.getQuestionText(pending.question);
		this.messages.push({
			role: 'tool',
			toolCallId: pending.toolCallId,
			toolName: pending.toolName,
			content: JSON.stringify({
				success: true,
				answer: normalizedAnswer,
				answers: questionText ? { [questionText]: normalizedAnswer } : { answer: normalizedAnswer }
			})
		});
		this.pendingInteraction = undefined;
		return pending;
	}

	public getSnapshot(): ICleanSlateAgentRuntimeSnapshot | undefined {
		if (this.messages.length === 0 && !this.pendingInteraction) {
			return undefined;
		}
		return {
			version: 1,
			messages: this.messages.map(message => this.cloneMessage(message)),
			objective: this.objective,
			mode: this.mode,
			phase: this.phase,
			pendingInteraction: this.pendingInteraction ? this.cloneValue(this.pendingInteraction) : undefined
		};
	}

	public restore(snapshot: ICleanSlateAgentRuntimeSnapshot | undefined): void {
		if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.messages)) {
			this.clear();
			return;
		}
		this.messages = snapshot.messages
			.filter(message => this.isChatMessage(message))
			.map(message => this.cloneMessage(message));
		this.objective = this.normalizeOptionalString(snapshot.objective);
		this.mode = this.normalizeOptionalString(snapshot.mode);
		this.phase = this.normalizeOptionalString(snapshot.phase);
		this.pendingInteraction = this.normalizePendingInteraction(snapshot.pendingInteraction);
	}

	public clear(): void {
		this.messages = [];
		this.objective = undefined;
		this.mode = undefined;
		this.phase = undefined;
		this.pendingInteraction = undefined;
	}

	private updateMetadata(metadata: ICleanSlateAgentSessionMetadata): void {
		this.objective = this.normalizeOptionalString(metadata.objective) ?? this.objective;
		this.mode = this.normalizeOptionalString(metadata.mode) ?? this.mode;
		this.phase = this.normalizeOptionalString(metadata.phase) ?? this.phase;
	}

	private findLatestUserMessage(messages: readonly IChatMessage[]): IChatMessage | undefined {
		for (let index = messages.length - 1; index >= 0; index--) {
			if (messages[index].role === 'user') {
				return messages[index];
			}
		}
		return undefined;
	}

	private isDuplicateTail(message: IChatMessage): boolean {
		const tail = this.messages[this.messages.length - 1];
		return !!tail
			&& tail.role === message.role
			&& JSON.stringify(tail.content) === JSON.stringify(message.content);
	}

	private requireToolCallId(toolCall: IToolCall): string {
		const id = typeof toolCall.id === 'string' ? toolCall.id.trim() : '';
		if (!id) {
			throw new Error('ask_question must have a stable native tool call id before it can pause.');
		}
		return id;
	}

	private getQuestionText(value: unknown): string | undefined {
		if (!value || typeof value !== 'object') {
			return undefined;
		}
		const result = value as { planning_question?: { question?: unknown } };
		return this.normalizeOptionalString(result.planning_question?.question);
	}

	private normalizePendingInteraction(value: unknown): ICleanSlatePendingAgentInteraction | undefined {
		if (!value || typeof value !== 'object') {
			return undefined;
		}
		const candidate = value as Partial<ICleanSlatePendingAgentInteraction>;
		if (candidate.kind !== 'question'
			|| candidate.toolName !== 'ask_question'
			|| typeof candidate.toolCallId !== 'string'
			|| candidate.toolCallId.trim().length === 0) {
			return undefined;
		}
		return {
			kind: 'question',
			toolCallId: candidate.toolCallId,
			toolName: 'ask_question',
			question: this.cloneValue(candidate.question),
			objective: this.normalizeOptionalString(candidate.objective),
			mode: this.normalizeOptionalString(candidate.mode),
			phase: this.normalizeOptionalString(candidate.phase)
		};
	}

	private isChatMessage(value: unknown): value is IChatMessage {
		if (!value || typeof value !== 'object') {
			return false;
		}
		const candidate = value as Partial<IChatMessage>;
		return (candidate.role === 'user' || candidate.role === 'assistant' || candidate.role === 'system' || candidate.role === 'tool')
			&& (typeof candidate.content === 'string' || Array.isArray(candidate.content));
	}

	private cloneMessage(message: IChatMessage): IChatMessage {
		return this.cloneValue(message);
	}

	private cloneValue<T>(value: T): T {
		try {
			return JSON.parse(JSON.stringify(value)) as T;
		} catch {
			return value;
		}
	}

	private normalizeOptionalString(value: unknown): string | undefined {
		return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
	}
}
