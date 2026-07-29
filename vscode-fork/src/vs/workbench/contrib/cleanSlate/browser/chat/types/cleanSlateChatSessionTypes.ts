/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AgentDefinition } from '@cleanslate/sdk/composer/registry/agentSchema.js';
import { ICleanSlateTaskSessionSnapshot } from '@cleanslate/sdk/services/cleanSlateTaskSessionService.js';
import {
    CleanSlateReasoningLevel,
	type ICleanSlateAgentRuntimeSnapshot,
    normalizeCleanSlateExecutionState
} from '../../../../../services/cleanSlate/common/core/cleanSlateAI.js';

export const CLEANSLATE_SESSION_STATES = ['starting', 'running', 'detached', 'stopping', 'stopped'] as const;

export type CleanSlateSessionState = typeof CLEANSLATE_SESSION_STATES[number];

export function isCleanSlateSessionState(value: unknown): value is CleanSlateSessionState {
    return typeof value === 'string' && (CLEANSLATE_SESSION_STATES as readonly string[]).includes(value);
}

export function normalizeCleanSlateSessionExecutionState(value: {
    readonly planMode?: unknown;
    readonly reasoningLevel?: unknown;
}): { planMode: boolean; reasoningLevel: CleanSlateReasoningLevel } {
    return normalizeCleanSlateExecutionState(value);
}

export interface ICleanSlateSessionMessage {
    readonly role: string;
    readonly content: string;
    readonly isInternalState?: boolean;
    readonly renderPayload?: string;
    readonly images?: string[];
}

export interface ICleanSlateTranscriptMessage extends ICleanSlateSessionMessage {
    readonly id?: string;
}

export interface ICleanSlateSessionSnapshot {
    readonly id: string;
    readonly parentSessionId?: string;
    readonly createdAt?: number;
    readonly title: string;
    readonly savedAt: number;
    readonly updatedAt?: number;
    readonly workspaceId?: string;
    readonly projectRoot?: string;
    readonly workDir?: string;
    readonly status?: CleanSlateSessionState;
    readonly sessionKey?: string;
    readonly history: ICleanSlateSessionMessage[];
    readonly transcript?: ICleanSlateTranscriptMessage[];
    readonly transcriptVersion?: number;
    readonly taskState?: ICleanSlateTaskSessionSnapshot;
    readonly threadState?: Partial<ICleanSlateTaskSessionSnapshot>;
	readonly agentRuntimeState?: ICleanSlateAgentRuntimeSnapshot;
    readonly planMode: boolean;
    readonly reasoningLevel: CleanSlateReasoningLevel;
    readonly agent?: AgentDefinition;
    readonly workspaceName?: string;
    readonly isGenerating?: boolean;
}

export interface ICleanSlateSessionIndexEntry {
    readonly sessionId: string;
    readonly transcriptSessionId: string;
    readonly cwd: string;
    readonly permissionMode?: string;
    readonly createdAt: number;
    readonly lastActiveAt: number;
}

export function cloneCleanSlateSessionMessages<T extends ICleanSlateSessionMessage>(
    history: readonly T[]
): T[] {
    return history
        .filter(message => message && typeof message.role === 'string' && typeof message.content === 'string')
        .map(message => ({
            ...message,
            images: Array.isArray(message.images)
                ? message.images.filter((image): image is string => typeof image === 'string')
                : undefined
        } as T));
}

export function deriveCleanSlateTranscriptFromHistory(
    history: readonly ICleanSlateSessionMessage[]
): ICleanSlateTranscriptMessage[] {
    const transcript: ICleanSlateTranscriptMessage[] = [];

    for (const message of history) {
        if (!message || typeof message.role !== 'string' || typeof message.content !== 'string') {
            continue;
        }

        if (message.role === 'user') {
            if (message.isInternalState || !message.content.trim() || isCleanSlateControlTranscriptMessage(message)) {
                continue;
            }
            transcript.push(message);
            continue;
        }

        if (message.role === 'assistant' || message.role === 'cleanSlate') {
            const hasRenderPayload = typeof message.renderPayload === 'string' && message.renderPayload.trim().length > 0;
            const hasVisibleContent = !message.isInternalState && message.content.trim().length > 0;
            if (hasRenderPayload || hasVisibleContent) {
                transcript.push(message);
            }
        }
    }

    return normalizeCleanSlateTranscriptOrder(transcript);
}

export function isCleanSlateControlTranscriptMessage(message: Pick<ICleanSlateSessionMessage, 'role' | 'content' | 'images'>): boolean {
    return message.role === 'user'
        && message.content.trim().toLowerCase() === 'continue'
        && (!Array.isArray(message.images) || message.images.length === 0);
}

const CLEANSLATE_PLANNING_ANSWER_KIND = 'cleanSlate.planningAnswer';
const CLEANSLATE_PLANNING_ANSWER_VERSION = 1;

/**
 * Answers to `ask_question` are tagged on the user transcript message so a restored
 * conversation can tell an answered question from an open one without relying on
 * message order — which the transcript reorder heuristic below is free to change.
 */
export function stringifyCleanSlatePlanningAnswerPayload(question: string): string | undefined {
    const normalized = question.trim();
    if (!normalized) {
        return undefined;
    }
    return JSON.stringify({
        type: CLEANSLATE_PLANNING_ANSWER_KIND,
        version: CLEANSLATE_PLANNING_ANSWER_VERSION,
        question: normalized
    });
}

export function parseCleanSlatePlanningAnswerQuestion(value: string | undefined): string | undefined {
    if (!value) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(value) as { type?: unknown; version?: unknown; question?: unknown };
        if (parsed?.type !== CLEANSLATE_PLANNING_ANSWER_KIND || parsed.version !== CLEANSLATE_PLANNING_ANSWER_VERSION) {
            return undefined;
        }
        return typeof parsed.question === 'string' && parsed.question.trim() ? parsed.question.trim() : undefined;
    } catch {
        return undefined;
    }
}

export function isCleanSlatePlanningAnswerMessage(message: Pick<ICleanSlateSessionMessage, 'role' | 'renderPayload'>): boolean {
    return message.role === 'user' && !!parseCleanSlatePlanningAnswerQuestion(message.renderPayload);
}

export function normalizeCleanSlateTranscriptOrder<T extends ICleanSlateSessionMessage>(
    history: readonly T[]
): T[] {
    const messages = cloneCleanSlateSessionMessages(history);

    for (let i = 0; i < messages.length - 1; i++) {
        const current = messages[i];
        const next = messages[i + 1];
        if (!isCleanSlateAssistantMessage(current) || !isVisibleCleanSlateUserMessage(next)) {
            continue;
        }

        const previousUser = findPreviousVisibleUserMessage(messages, i);
        if (!shouldMoveUserBeforeAssistant(next, current, previousUser)) {
            continue;
        }

        messages[i] = next;
        messages[i + 1] = current;
        if (i > 0) {
            i -= 2;
        }
    }

    return messages;
}

function shouldMoveUserBeforeAssistant(
    user: ICleanSlateSessionMessage,
    assistant: ICleanSlateSessionMessage,
    previousUser: ICleanSlateSessionMessage | undefined
): boolean {
    const userText = user.content.trim();
    if (userText.length < 12) {
        return false;
    }

    // An answer to `ask_question` is worded from the assistant's own options, so it
    // always scores a near-perfect overlap — but it genuinely belongs after the
    // question. Reordering it would make a restored transcript look like the question
    // is still open.
    if (isCleanSlatePlanningAnswerMessage(user) || answersPlanningQuestionOf(assistant, userText)) {
        return false;
    }

    const assistantText = getAssistantTranscriptSearchText(assistant);
    if (!assistantText) {
        return false;
    }

    const userMatch = getCleanSlateTokenOverlapScore(userText, assistantText);
    if (userMatch < 0.5) {
        return false;
    }

    return !previousUser || getCleanSlateTokenOverlapScore(previousUser.content, assistantText) < 0.35;
}

function findPreviousVisibleUserMessage<T extends ICleanSlateSessionMessage>(
    messages: readonly T[],
    beforeIndex: number
): ICleanSlateSessionMessage | undefined {
    for (let i = beforeIndex - 1; i >= 0; i--) {
        const message = messages[i];
        if (isVisibleCleanSlateUserMessage(message)) {
            return message;
        }
    }

    return undefined;
}

function isCleanSlateAssistantMessage(message: ICleanSlateSessionMessage | undefined): boolean {
    return message?.role === 'assistant' || message?.role === 'cleanSlate';
}

function isVisibleCleanSlateUserMessage(message: ICleanSlateSessionMessage | undefined): message is ICleanSlateSessionMessage {
    return message?.role === 'user'
        && !message.isInternalState
        && message.content.trim().length > 0
        && !isCleanSlateControlTranscriptMessage(message);
}

/**
 * Fallback for transcripts recorded before answers carried a marker: an answer with no
 * extra typed detail is verbatim one of the question's option labels.
 */
function answersPlanningQuestionOf(assistant: ICleanSlateSessionMessage, userText: string): boolean {
    if (typeof assistant.renderPayload !== 'string' || !assistant.renderPayload.includes('planning_question')) {
        return false;
    }
    let options: unknown;
    let customLabel: unknown;
    try {
        const parsed = JSON.parse(assistant.renderPayload) as { planning_question?: { options?: unknown; customLabel?: unknown } };
        options = parsed?.planning_question?.options;
        customLabel = parsed?.planning_question?.customLabel;
    } catch {
        return false;
    }
    const answer = userText.toLowerCase();
    if (answer === 'answered planning question'
        || (typeof customLabel === 'string' && customLabel.trim().toLowerCase() === answer)) {
        return true;
    }
    return Array.isArray(options) && options.some(option => {
        const label = typeof option === 'string' ? option : (option as { label?: unknown })?.label;
        return typeof label === 'string' && label.trim().toLowerCase() === answer;
    });
}

function getAssistantTranscriptSearchText(message: ICleanSlateSessionMessage): string {
    const chunks = [message.content];
    if (typeof message.renderPayload === 'string' && message.renderPayload.trim().length > 0) {
        chunks.push(message.renderPayload);
    }
    return chunks.join(' ').trim();
}

function getCleanSlateTokenOverlapScore(source: string, target: string): number {
    const sourceTokens = tokenizeCleanSlateTranscriptText(source);
    if (sourceTokens.length === 0) {
        return 0;
    }

    const targetTokens = tokenizeCleanSlateTranscriptText(target);
    let matches = 0;
    for (const sourceToken of sourceTokens) {
        if (targetTokens.some(targetToken => areCleanSlateTranscriptTokensSimilar(sourceToken, targetToken))) {
            matches++;
        }
    }

    return matches / sourceTokens.length;
}

function tokenizeCleanSlateTranscriptText(value: string): string[] {
    const stopWords = new Set([
        'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'it', 'of', 'on', 'or',
        'so', 'the', 'this', 'to', 'with', 'now', 'only', 'file', 'files', 'changed', 'component', 'components'
    ]);
    const seen = new Set<string>();
    const tokens: string[] = [];

    for (const match of value.toLowerCase().matchAll(/[a-z0-9]+/g)) {
        const token = match[0];
        if (token.length < 2 || stopWords.has(token) || seen.has(token)) {
            continue;
        }
        seen.add(token);
        tokens.push(token);
    }

    return tokens;
}

function areCleanSlateTranscriptTokensSimilar(first: string, second: string): boolean {
    return first === second
        || first.length >= 4 && second.startsWith(first)
        || second.length >= 4 && first.startsWith(second)
        || first.length >= 5 && second.length >= 5 && first.slice(0, 5) === second.slice(0, 5);
}
