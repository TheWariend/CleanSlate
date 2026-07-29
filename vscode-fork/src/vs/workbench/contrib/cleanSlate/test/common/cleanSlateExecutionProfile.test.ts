/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { applyRequestedModeToExecutionSettings, CLEANSLATE_PHASE, CLEANSLATE_REQUESTED_MODE, normalizePhaseForExecutionFlow } from '../../browser/agent/cleanSlateExecutionProfile.js';
import { CleanSlateTaskKind, CleanSlateTurnIntent } from '@cleanslate/sdk/services/cleanSlateTaskState.js';
import { normalizeCleanSlateExecutionState } from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';

suite('CleanSlateExecutionFlow', () => {
	test('normal mode skips planning because plan mode is off', () => {
		const result = normalizePhaseForExecutionFlow({
			currentPhase: CLEANSLATE_PHASE.PLANNING,
			isAwaitingApproval: false,
			currentTaskKind: CleanSlateTaskKind.MODIFY_EXISTING,
			turnIntent: CleanSlateTurnIntent.START_NEW_TASK,
			planMode: false,
			usePlanningPhase: false
		});

		assert.strictEqual(result, CLEANSLATE_PHASE.EXECUTION);
	});

	test('approval still advances planning profiles into execution', () => {
		const result = normalizePhaseForExecutionFlow({
			currentPhase: CLEANSLATE_PHASE.PLANNING,
			isAwaitingApproval: false,
			currentTaskKind: CleanSlateTaskKind.MODIFY_EXISTING,
			turnIntent: CleanSlateTurnIntent.APPROVE_PLAN,
			planMode: true,
			usePlanningPhase: true
		});

		assert.strictEqual(result, CLEANSLATE_PHASE.EXECUTION);
	});

	test('non-planning execution can skip planning for the current turn', () => {
		const result = normalizePhaseForExecutionFlow({
			currentPhase: CLEANSLATE_PHASE.PLANNING,
			isAwaitingApproval: false,
			currentTaskKind: CleanSlateTaskKind.MODIFY_EXISTING,
			turnIntent: CleanSlateTurnIntent.START_NEW_TASK,
			planMode: false,
			usePlanningPhase: true,
			usePlanningForCurrentTurn: false
		});

		assert.strictEqual(result, CLEANSLATE_PHASE.EXECUTION);
	});

	test('plan mode keeps the planning phase', () => {
		const result = normalizePhaseForExecutionFlow({
			currentPhase: CLEANSLATE_PHASE.PLANNING,
			isAwaitingApproval: false,
			currentTaskKind: CleanSlateTaskKind.MODIFY_EXISTING,
			turnIntent: CleanSlateTurnIntent.START_NEW_TASK,
			planMode: true,
			usePlanningPhase: true,
			usePlanningForCurrentTurn: true
		});

		assert.strictEqual(result, CLEANSLATE_PHASE.PLANNING);
	});

	test('plan mode is bypassed when the current turn explicitly skips planning', () => {
		const result = normalizePhaseForExecutionFlow({
			currentPhase: CLEANSLATE_PHASE.PLANNING,
			isAwaitingApproval: false,
			currentTaskKind: CleanSlateTaskKind.MODIFY_EXISTING,
			turnIntent: CleanSlateTurnIntent.START_NEW_TASK,
			planMode: true,
			usePlanningPhase: true,
			usePlanningForCurrentTurn: false
		});

		assert.strictEqual(result, CLEANSLATE_PHASE.EXECUTION);
	});

	test('explicit plan mode keeps planning phase for new work', () => {
		const result = normalizePhaseForExecutionFlow({
			currentPhase: CLEANSLATE_PHASE.PLANNING,
			isAwaitingApproval: false,
			currentTaskKind: CleanSlateTaskKind.MODIFY_EXISTING,
			turnIntent: CleanSlateTurnIntent.START_NEW_TASK,
			planMode: false,
			usePlanningPhase: true,
			usePlanningForCurrentTurn: true
		});

		assert.strictEqual(result, CLEANSLATE_PHASE.PLANNING);
	});

	test('explicit plan mode upgrades normal execution settings for the current turn', () => {
		const result = applyRequestedModeToExecutionSettings({
			executionFlow: 'normal',
			planMode: false,
			reasoningLevel: 'low',
			maxNoToolTurns: 2,
			maxVerificationRetries: 1,
			verificationCommands: [],
			failOnWarnings: false,
			usePlanningPhase: false,
			turnDelayMs: 0
		}, CLEANSLATE_REQUESTED_MODE.PLANNING);

		assert.strictEqual(result.executionFlow, 'planning');
		assert.strictEqual(result.planMode, true);
		assert.strictEqual(result.usePlanningPhase, true);
		assert.strictEqual(result.maxNoToolTurns, 3);
		assert.strictEqual(result.maxVerificationRetries, 2);
	});

	test('explicit normal mode preserves normal execution settings', () => {
		const settings = {
			executionFlow: 'normal' as const,
			planMode: false,
			reasoningLevel: 'low' as const,
			maxNoToolTurns: 2,
			maxVerificationRetries: 1,
			verificationCommands: [],
			failOnWarnings: false,
			usePlanningPhase: false,
			turnDelayMs: 0
		};

		const result = applyRequestedModeToExecutionSettings(settings, CLEANSLATE_REQUESTED_MODE.EXECUTION);

		assert.strictEqual(result, settings);
	});

	test('explicit normal execution request keeps normal execution enabled', () => {
		const result = applyRequestedModeToExecutionSettings({
			executionFlow: 'normal',
			planMode: false,
			reasoningLevel: 'low',
			maxNoToolTurns: 2,
			maxVerificationRetries: 1,
			verificationCommands: [],
			failOnWarnings: false,
			usePlanningPhase: false,
			turnDelayMs: 0
		}, CLEANSLATE_REQUESTED_MODE.EXECUTION);

		assert.strictEqual(result.executionFlow, 'normal');
		assert.strictEqual(result.usePlanningPhase, false);
	});

	test('normal execution request bypasses plan-mode settings for the current turn', () => {
		const result = applyRequestedModeToExecutionSettings({
			executionFlow: 'planning',
			planMode: true,
			reasoningLevel: 'medium',
			maxNoToolTurns: 3,
			maxVerificationRetries: 2,
			verificationCommands: [],
			failOnWarnings: false,
			usePlanningPhase: true,
			turnDelayMs: 0
		}, CLEANSLATE_REQUESTED_MODE.EXECUTION);

		assert.strictEqual(result.executionFlow, 'normal');
		assert.strictEqual(result.planMode, false);
		assert.strictEqual(result.usePlanningPhase, false);
	});

	test('restored legacy verification sessions resume in execution', () => {
		const result = normalizePhaseForExecutionFlow({
			currentPhase: CLEANSLATE_PHASE.VERIFICATION,
			isAwaitingApproval: false,
			currentTaskKind: CleanSlateTaskKind.MODIFY_EXISTING,
			turnIntent: CleanSlateTurnIntent.CONTINUE_CURRENT,
			planMode: true,
			usePlanningPhase: true
		});

		assert.strictEqual(result, CLEANSLATE_PHASE.EXECUTION);
	});

	test('defaults missing execution settings to direct low reasoning', () => {
		assert.deepStrictEqual(normalizeCleanSlateExecutionState(), {
			planMode: false,
			reasoningLevel: 'low'
		});
	});

	test('normalizes explicit plan mode and reasoning level without legacy mode mapping', () => {
		assert.deepStrictEqual(normalizeCleanSlateExecutionState({ planMode: true, reasoningLevel: 'high' }), {
			planMode: true,
			reasoningLevel: 'high'
		});
	});
});
