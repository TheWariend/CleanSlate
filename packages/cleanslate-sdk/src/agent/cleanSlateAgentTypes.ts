/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CleanSlateExecutionFlow, CleanSlateReasoningLevel, ICleanSlateTransportStatus } from '../protocol/cleanSlateAI.js';

export type CleanSlateStreamPart =
    | { type: 'assistant_turn_start'; phase: string; turnId: string; turnIndex?: number }
    | { type: 'assistant_turn_complete'; phase: string; turnId: string; turnIndex?: number }
    | { type: 'context_compaction_start'; turnId: string }
    | { type: 'context_compaction_complete'; turnId: string; compacted: boolean }
    | { type: 'context_usage'; turnId: string; estimatedInputTokens: number; contextWindowTokens: number; autoCompactThresholdTokens: number; percentage: number }
    | { type: 'text'; content: string }
    | { type: 'reasoning'; content: string }
    | { type: 'reasoning_reset' }
    | { type: 'chat_text'; content: string; kind?: 'assistant' | 'commentary' | 'final_answer' | 'model_terminated_pause' }
    | { type: 'chat_text_reset' }
    | { type: 'transport_status'; status: ICleanSlateTransportStatus }
    | { type: 'tool_start'; toolName: string; input: any; toolCallId?: string }
    | { type: 'tool_progress'; toolName: string; progress: any; toolCallId?: string }
    | { type: 'tool_result'; toolName: string; result: any; toolCallId?: string }
    | { type: 'task_complete'; result: any };

export const PHASE_CONCLUSION_SIGNAL_PLAN_CREATED = '__plan_created__';

export type ParsedToolCall = { id?: string; toolName: string; input: any; providerMetadata?: { gemini?: { thoughtSignature?: string } } };

export interface IExecutionLoopSettings {
    executionFlow: CleanSlateExecutionFlow;
    planMode: boolean;
    reasoningLevel: CleanSlateReasoningLevel;
    maxTurns?: number;
    maxNoToolTurns: number;
    maxVerificationRetries: number;
    verificationCommands: string[];
    failOnWarnings: boolean;
    usePlanningPhase: boolean;
    turnDelayMs: number;
}

export class AsyncQueue<T> {
    private items: (T | undefined)[] = [];
    private resolver: ((value: T | undefined) => void) | null = null;

    push(item: T | undefined): void {
        if (this.resolver) {
            this.resolver(item);
            this.resolver = null;
        } else {
            this.items.push(item);
        }
    }

    async next(): Promise<T | undefined> {
        if (this.items.length > 0) {
            return this.items.shift();
        }
        return new Promise(resolve => { this.resolver = resolve; });
    }
}
