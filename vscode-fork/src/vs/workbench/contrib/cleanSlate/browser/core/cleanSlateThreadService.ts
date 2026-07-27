/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';

/**
 * Service responsible for managing conversation thread history
 */
export interface ICleanSlateThreadMessage {
    role: string;
    content: string;
    isInternalState?: boolean;
    renderPayload?: string;
    images?: string[];
}

export class CleanSlateThreadService {
    private static readonly TASK_BOUNDARY_MARKER = '[TASK_BOUNDARY]';
    private history: ICleanSlateThreadMessage[] = [];
    private readonly _onDidChangeHistory = new Emitter<void>();
    readonly onDidChangeHistory: Event<void> = this._onDidChangeHistory.event;

    /**
     * Get the complete conversation history
     */
    getHistory(): ICleanSlateThreadMessage[] {
        return [...this.history];
    }

    /**
     * Get the exact primitive array reference for concurrent session mutation
     */
    getRawHistoryReference(): ICleanSlateThreadMessage[] {
        return this.history;
    }

    /**
     * Add a message to the conversation history
     */
    addMessage(role: string, content: string, isInternalState: boolean = false, images?: readonly string[]): void {
        this.history.push(this.prepareHistoricalMessage({ role, content, isInternalState, images: images ? [...images] : undefined }));
        this._onDidChangeHistory.fire();
    }

    setLastAssistantRenderPayload(renderPayload: string): void {
        for (let i = this.history.length - 1; i >= 0; i--) {
            const message = this.history[i];
            if (message.role === 'assistant' || message.role === 'cleanSlate') {
                this.history[i] = {
                    ...message,
                    renderPayload
                };
                this._onDidChangeHistory.fire();
                return;
            }
        }
    }

    startNewTaskBoundary(): void {
        if (this.history.length === 0) {
            return;
        }

        const lastMessage = this.history[this.history.length - 1];
        if (this.isTaskBoundary(lastMessage)) {
            return;
        }

        this.history.push({
            role: 'system',
            content: CleanSlateThreadService.TASK_BOUNDARY_MARKER,
            isInternalState: true
        });
        this._onDidChangeHistory.fire();
    }

    /**
     * Clear the entire conversation history
     */
    clearHistory(): void {
        this.history = [];
        this._onDidChangeHistory.fire();
    }

    /**
     * Replace the in-memory history with an existing session's history snapshot.
     */
    setHistory(history: ICleanSlateThreadMessage[]): void {
        this.history = history.map(message => this.prepareHistoricalMessage({
            role: message.role,
            content: message.content,
            isInternalState: message.isInternalState,
            renderPayload: message.renderPayload,
            images: message.images
        }));
        this._onDidChangeHistory.fire();
    }

    /**
     * Set the history by strict reference, ensuring background loops targeting the array remain synced
     */
    setHistoryReference(history: ICleanSlateThreadMessage[]): void {
        this.history = history;
        this._onDidChangeHistory.fire();
    }

    getActiveTaskHistory(): ICleanSlateThreadMessage[] {
        return [...this.getActiveTaskHistorySlice()];
    }

    /**
     * Get recent history with a limit on number of messages
     * @param count Maximum number of recent messages to retrieve
     * @returns Recent messages, excluding the most recent one
     */
    getRecentHistory(count: number): ICleanSlateThreadMessage[] {
        const activeTaskHistory = this.getActiveTaskHistorySlice();
        if (activeTaskHistory.length === 0) {
            return [];
        }
        const startIndex = Math.max(0, activeTaskHistory.length - count);
        return activeTaskHistory.slice(startIndex);
    }

    /**
     * Get the total number of messages in the history
     */
    getMessageCount(): number {
        return this.history.length;
    }

    /**
     * Get a "pruned" history for the Execution phase.
     * Retains the original user request and the latest implementation_plan.md content,
     * while discarding intermediate research/search turns.
     */
    getIsolatedExecutionHistory(): ICleanSlateThreadMessage[] {
        const activeTaskHistory = this.getActiveTaskHistorySlice();
        if (activeTaskHistory.length === 0) return [];

        // In Execution/Verification phases, we want to ensure the agent has:
        // 1. Perspective: The initial user objective.
        // 2. Strategy: The latest implementation plan.
        // 3. Narrative: EVERY follow-up instruction the user has given since the plan was made.

        const result: ICleanSlateThreadMessage[] = [];

        // 1. Find the initial user request
        const firstUserMsg = activeTaskHistory.find(m => m.role === 'user');
        if (firstUserMsg) {
            result.push(firstUserMsg);
        }

        // 2. Find the LATEST version of the implementation plan
        let latestPlanIndex = -1;
        for (let i = activeTaskHistory.length - 1; i >= 0; i--) {
            const msg = activeTaskHistory[i];
            if (msg.content.includes('implementation_plan.md') ||
                msg.content.includes('# Implementation Plan') ||
                msg.content.includes('## Proposed Changes')) {
                latestPlanIndex = i;
                break;
            }
        }

        if (latestPlanIndex !== -1) {
            result.push(activeTaskHistory[latestPlanIndex]);

            // 2b. Preserve the last 5 research turns immediately PRECEDING the plan
            // This ensures the agent doesn't "forget" the file content it just read during Planning.
            const researchRetentionCount = 5;
            const researchStart = Math.max(0, latestPlanIndex - researchRetentionCount);
            for (let i = researchStart; i < latestPlanIndex; i++) {
                const msg = activeTaskHistory[i];
                if (msg !== firstUserMsg && !result.includes(msg)) {
                    result.push(msg);
                }
            }
        }

        // 3. Preserve ALL message content that occurred AFTER the plan was generated
        // This includes all your clarifying questions, follow-up instructions, and corrections.
        // (When no plan exists, keep everything — there is nothing to prune against.)
        const afterStart = latestPlanIndex !== -1 ? latestPlanIndex + 1 : 0;
        for (let i = afterStart; i < activeTaskHistory.length; i++) {
            const msg = activeTaskHistory[i];
            if (msg === firstUserMsg || i === latestPlanIndex || result.includes(msg)) continue;
            result.push(msg);
        }

        return result;
    }

    private getActiveTaskHistorySlice(): ICleanSlateThreadMessage[] {
        let startIndex = 0;
        for (let i = this.history.length - 1; i >= 0; i--) {
            if (this.isTaskBoundary(this.history[i])) {
                startIndex = i + 1;
                break;
            }
        }

        return this.history.slice(startIndex);
    }

    private prepareHistoricalMessage(message: ICleanSlateThreadMessage): ICleanSlateThreadMessage {
        const prepared: ICleanSlateThreadMessage = {
            role: message.role,
            content: message.content,
            isInternalState: message.isInternalState,
            renderPayload: message.renderPayload,
            images: message.images ? [...message.images] : undefined
        };

        return prepared;
    }

    private isTaskBoundary(message: ICleanSlateThreadMessage | undefined): boolean {
        return !!message?.isInternalState && message.content === CleanSlateThreadService.TASK_BOUNDARY_MARKER;
    }
}
