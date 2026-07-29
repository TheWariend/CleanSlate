/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AgentPhase } from '@cleanslate/sdk/agent/cleanSlatePrompts.js';
import { ChatResponse } from '../types/cleanSlateChatTypes.js';

export type RenderableSummaryRole = 'orientation' | 'progress' | 'completion' | 'status';

export interface SummaryRenderContext {
    phase: string | undefined;
    turnIndex: number | undefined;
    hasToolCalls: boolean;
    hasPlanningQuestion: boolean;
    isSummaryDeferredToToolResult: boolean;
    isStreaming: boolean;
    /** Last progress summary already rendered this run — near-duplicates are suppressed. */
    previousProgressSummary?: string;
}

export function selectRenderableSummaries(
    summary: ChatResponse['summary'],
    context: SummaryRenderContext
): string[] {
    const nonEmptySummaries = normalizeSummaryList(summary);

    if (!isAgentTaskPhase(context.phase)) {
        return nonEmptySummaries;
    }

    if (context.hasPlanningQuestion) {
        return [];
    }

    if (context.isSummaryDeferredToToolResult) {
        return [];
    }

    if (context.turnIndex === 1) {
        const firstSummary = nonEmptySummaries[0];
        return firstSummary ? [firstSummary] : [];
    }

    if (shouldRenderProgressSummary(context)) {
        const progressSummary = nonEmptySummaries[nonEmptySummaries.length - 1];
        if (!progressSummary) {
            return [];
        }
        // Models under a per-turn summary habit emit the same status in fresh
        // words every turn ("Home flow is mapped…" / "Home UX changes will
        // target…"). A near-duplicate of the last rendered progress line adds
        // no information — drop it instead of stacking filler.
        if (isNearDuplicateSummary(progressSummary, context.previousProgressSummary)) {
            return [];
        }
        return [progressSummary];
    }

    return [];
}

export function isNearDuplicateSummary(summary: string, previous: string | undefined): boolean {
    if (!previous) {
        return false;
    }
    const a = summaryComparisonTokens(summary);
    const b = summaryComparisonTokens(previous);
    if (a.size === 0 || b.size === 0) {
        return normalizeSummaryText(summary).toLowerCase() === normalizeSummaryText(previous).toLowerCase();
    }
    let shared = 0;
    for (const token of a) {
        if (b.has(token)) {
            shared++;
        }
    }
    const overlap = shared / Math.min(a.size, b.size);
    return overlap >= 0.6;
}

const SUMMARY_STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'is', 'are', 'will', 'next', 'now', 'i', 'im', 'its', 'that', 'this']);

function summaryComparisonTokens(summary: string): Set<string> {
    return new Set(
        normalizeSummaryText(summary)
            .toLowerCase()
            .split(/[^a-z0-9_]+/)
            .filter(token => token.length > 1 && !SUMMARY_STOP_WORDS.has(token))
    );
}

export function getRenderableSummaryRole(context: SummaryRenderContext): RenderableSummaryRole | undefined {
    if (!isAgentTaskPhase(context.phase)) {
        return 'status';
    }

    if (context.hasPlanningQuestion) {
        return undefined;
    }

    if (context.isSummaryDeferredToToolResult) {
        return undefined;
    }

    if (context.turnIndex === 1) {
        return 'orientation';
    }

    if (shouldRenderProgressSummary(context)) {
        return 'progress';
    }

    return undefined;
}

export function isStableSummaryRole(role: RenderableSummaryRole | undefined): boolean {
    return role === 'orientation';
}

export function isAgentTaskPhase(phase: string | undefined): boolean {
    return phase === AgentPhase.PLANNING
        || phase === AgentPhase.EXECUTION
        || phase === AgentPhase.VERIFICATION;
}

function normalizeSummaryList(summary: ChatResponse['summary']): string[] {
    const summaries = Array.isArray(summary)
        ? summary
        : typeof summary === 'string'
            ? [summary]
            : [];

    return summaries
        .map(entry => typeof entry === 'string' ? normalizeSummaryText(entry) : '')
        .filter((entry): entry is string => entry.length > 0);
}

function shouldRenderProgressSummary(context: SummaryRenderContext): boolean {
    return !context.isStreaming
        && context.hasToolCalls
        && typeof context.turnIndex === 'number'
        && context.turnIndex > 1;
}

function normalizeSummaryText(summary: string): string {
    return summary.replace(/\s+/g, ' ').trim();
}
