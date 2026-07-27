/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ICleanSlateTransportStatus } from '../../../../../services/cleanSlate/common/core/cleanSlateAI.js';

/**
 * Individual interaction block for chronological transcript
 */
export interface InteractionBlock {
    id: string;
    type: 'terminal' | 'summary' | 'assistant_text' | 'reasoning' | 'file' | 'browser' | 'web' | 'tool' | 'turn' | 'finish';
    content?: string;
    summaryRole?: 'orientation' | 'progress' | 'completion' | 'status';
    toolName?: string;
    toolCallId?: string;
    toolStatus?: 'running' | 'completed' | 'failed';
    command?: string;
    output?: string;
    exitCode?: number;
    awaitingApproval?: boolean;
    path?: string;
    status?: string;
    added?: number;
    deleted?: number;
    diff?: string;
    beforeContent?: string;
    afterContent?: string;
    range?: string;
    isStreaming?: boolean;
    reasoningStartedAt?: number;
    reasoningDurationMs?: number;
    /** Runtime-only segments used to group provider reasoning across model turns in one disclosure. */
    reasoningSegments?: { id: string; content: string; startedAt?: number; durationMs?: number }[];
    sessionId?: string;
    queueToken?: string;
    interactiveRisk?: boolean;
    isOptimistic?: boolean;
    itemCount?: number;
    fileCount?: number;
    searchCount?: number;
    details?: string[];
    detailMetadata?: { label: string; path?: string; range?: string; query?: string; type: 'read' | 'explore' }[];
    fileChanges?: { path: string; added?: number; deleted?: number; diff?: string; beforeContent?: string; afterContent?: string }[];
    browserToolName?: string;
    browserAction?: string;
    browserUrl?: string;
    browserTitle?: string;
    browserStatus?: 'running' | 'completed' | 'failed';
    browserScreenshots?: { label: string; mimeType: string; base64: string }[];
    webToolName?: 'web_search' | 'web_fetch';
    webAction?: string;
    webStatus?: 'running' | 'completed' | 'failed';
    webQuery?: string;
    webProvider?: string;
    webUrl?: string;
    webFinalUrl?: string;
    webTitle?: string;
    webContentType?: string;
    webContentPreview?: string;
    webBytes?: number;
    webTruncated?: boolean;
    webResults?: { title: string; url: string; snippet?: string; source?: string; provider?: string; publishedDate?: string }[];
    webAttempts?: { provider: string; status: 'skipped' | 'success' | 'failed'; reason?: string; durationMs?: number }[];
    /** Approximate prompt-context measurement for this model turn. */
    contextUsage?: { estimatedInputTokens: number; contextWindowTokens: number; autoCompactThresholdTokens: number; percentage: number };
    blocks?: InteractionBlock[];
}

/**
 * Structured response from the AI
 */
export interface CleanSlatePlanningQuestionOption {
    label: string;
    description?: string;
    recommended?: boolean;
}

export interface CleanSlatePlanningQuestion {
    question: string;
    options: CleanSlatePlanningQuestionOption[];
    allowCustom?: boolean;
    customLabel?: string;
    placeholder?: string;
}

export interface ChatResponse {
    response?: string | string[];
    to_do?: string[];
    execution_plan?: string[];
    files_accessed?: string[];
    files_created?: string[];
    summary?: string | string[];
    code_snippet?: string;
    isImplementationPlan?: boolean;
    planAction?: 'created' | 'modified';
    terminal_outputs?: { [command: string]: { output: string; exitCode: number } };
    files_edited?: { path: string; added: number; deleted: number }[];
    timeline?: InteractionBlock[];
    lastToolName?: string;
    executionFlow?: string;
    transcriptStatus?: 'completed' | 'interrupted';
    planning_question?: CleanSlatePlanningQuestion;
}

export interface CleanSlateUserSelectionDisplay {
    kind: 'selection';
    label: string;
    command?: string;
    selectionCount: number;
}

/**
 * Response rendering callback interface
 */
export interface IResponseRenderer {
    renderJSONResponse(data: ChatResponse, isStreaming: boolean, targetMessage?: HTMLElement): void;
    addMessage(text: string, type: 'user' | 'cleanSlate', images?: string[]): HTMLElement;
    addUserSelectionMessage?(display: CleanSlateUserSelectionDisplay, images?: string[]): HTMLElement;
    addSystemConfirmation(title: string, message: string, icon?: string): HTMLElement;
    showTransportRetry(status: ICleanSlateTransportStatus): void;
    clearTransportRetry(): void;
    addModelTerminated(message: string, onContinue: () => void): HTMLElement;
    scrollToBottom(): void;
    removeStreamingPlaceholders(): void;
}
