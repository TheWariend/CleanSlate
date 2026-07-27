/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { AgentPhase } from '../../browser/agent/cleanSlatePrompts.js';
import { getRenderableSummaryRole, isStableSummaryRole, selectRenderableSummaries } from '../../browser/chat/runtime/cleanSlateSummaryPolicy.js';

suite('CleanSlateSummaryPolicy', () => {
    test('renders the model-authored summary on the first task turn', () => {
        const summaries = selectRenderableSummaries('Checking the theme entrypoints first.', {
            phase: AgentPhase.PLANNING,
            turnIndex: 1,
            hasToolCalls: true,
            hasPlanningQuestion: false,
            isSummaryDeferredToToolResult: false,
            isStreaming: true
        });

        assert.deepStrictEqual(summaries, ['Checking the theme entrypoints first.']);
        assert.strictEqual(getRenderableSummaryRole({
            phase: AgentPhase.PLANNING,
            turnIndex: 1,
            hasToolCalls: true,
            hasPlanningQuestion: false,
            isSummaryDeferredToToolResult: false,
            isStreaming: true
        }), 'orientation');
    });

    test('renders completed progress summaries after the first tool turn', () => {
        const summaries = selectRenderableSummaries('I found the theme shell and I am checking the UI sections next.', {
            phase: AgentPhase.PLANNING,
            turnIndex: 2,
            hasToolCalls: true,
            hasPlanningQuestion: false,
            isSummaryDeferredToToolResult: false,
            isStreaming: false
        });

        assert.deepStrictEqual(summaries, ['I found the theme shell and I am checking the UI sections next.']);
        assert.strictEqual(getRenderableSummaryRole({
            phase: AgentPhase.PLANNING,
            turnIndex: 2,
            hasToolCalls: true,
            hasPlanningQuestion: false,
            isSummaryDeferredToToolResult: false,
            isStreaming: false
        }), 'progress');
    });

    test('waits until turn completion before showing mid-run progress summaries', () => {
        const summaries = selectRenderableSummaries('I found the theme shell and I am checking the UI sections next.', {
            phase: AgentPhase.PLANNING,
            turnIndex: 2,
            hasToolCalls: true,
            hasPlanningQuestion: false,
            isSummaryDeferredToToolResult: false,
            isStreaming: true
        });

        assert.deepStrictEqual(summaries, []);
    });

    test('leaves completion ownership to the host lifecycle event', () => {
        const summaries = selectRenderableSummaries(['Working through checks.', 'Dark mode wiring is complete.'], {
            phase: AgentPhase.EXECUTION,
            turnIndex: 4,
            hasToolCalls: true,
            hasPlanningQuestion: false,
            isSummaryDeferredToToolResult: false,
            isStreaming: false
        });

        assert.deepStrictEqual(summaries, ['Dark mode wiring is complete.']);
        assert.strictEqual(getRenderableSummaryRole({
            phase: AgentPhase.EXECUTION,
            turnIndex: 4,
            hasToolCalls: true,
            hasPlanningQuestion: false,
            isSummaryDeferredToToolResult: false,
            isStreaming: false
        }), 'progress');
    });

    test('defers plan handoff summaries to the tool result owner', () => {
        const context = {
            phase: AgentPhase.PLANNING,
            turnIndex: 4,
            hasToolCalls: true,
            hasPlanningQuestion: false,
            isSummaryDeferredToToolResult: true,
            isStreaming: false
        };

        assert.deepStrictEqual(selectRenderableSummaries('Drafted and submitted the plan for review.', context), []);
        assert.strictEqual(getRenderableSummaryRole(context), undefined);
    });

    test('treats first-turn orientation as stable but allows completion handoff updates', () => {
        assert.strictEqual(isStableSummaryRole('orientation'), true);
        assert.strictEqual(isStableSummaryRole('progress'), false);
        assert.strictEqual(isStableSummaryRole('completion'), false);
        assert.strictEqual(isStableSummaryRole('status'), false);
        assert.strictEqual(isStableSummaryRole(undefined), false);
    });

    test('lets non-task chat render normally', () => {
        const summaries = selectRenderableSummaries(['First answer.', 'Second answer.'], {
            phase: 'CHAT',
            turnIndex: undefined,
            hasToolCalls: false,
            hasPlanningQuestion: false,
            isSummaryDeferredToToolResult: false,
            isStreaming: false
        });

        assert.deepStrictEqual(summaries, ['First answer.', 'Second answer.']);
    });

    test('suppresses a progress summary that near-duplicates the previous one', () => {
        const context = {
            phase: AgentPhase.EXECUTION,
            turnIndex: 3,
            hasToolCalls: true,
            hasPlanningQuestion: false,
            isSummaryDeferredToToolResult: false,
            isStreaming: false,
            previousProgressSummary: 'Improving UX around the Flutter home flow; inspecting the current screen and provider before editing.'
        };

        // Same status reworded — filler, must be dropped.
        assert.deepStrictEqual(
            selectRenderableSummaries(['Improving home-screen UX; inspecting the current Flutter screen and provider state before editing.'], context),
            []
        );

        // Genuinely new information still renders.
        assert.deepStrictEqual(
            selectRenderableSummaries(['Found a setState-during-build bug in home_provider.dart; fixing state handling next.'], context),
            ['Found a setState-during-build bug in home_provider.dart; fixing state handling next.']
        );
    });
});
