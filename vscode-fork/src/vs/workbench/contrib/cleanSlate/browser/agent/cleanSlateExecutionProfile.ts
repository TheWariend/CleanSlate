/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CleanSlateTaskKind, CleanSlateTurnIntent } from '../core/cleanSlateTaskState.js';
import type { IExecutionLoopSettings } from './cleanSlateAgentTypes.js';

export const CLEANSLATE_PHASE = {
	PLANNING: 'PLANNING',
	EXECUTION: 'EXECUTION',
	VERIFICATION: 'VERIFICATION'
} as const;

export type CleanSlateExecutionPhase = typeof CLEANSLATE_PHASE[keyof typeof CLEANSLATE_PHASE];

export const CLEANSLATE_REQUESTED_MODE = {
	CHAT: 'chat',
	PLANNING: 'planning',
	EXECUTION: 'execution'
} as const;

export type CleanSlateRequestedMode = typeof CLEANSLATE_REQUESTED_MODE[keyof typeof CLEANSLATE_REQUESTED_MODE];

export interface IExecutionFlowPhaseInput {
	currentPhase: CleanSlateExecutionPhase;
	isAwaitingApproval: boolean;
	currentTaskKind: CleanSlateTaskKind;
	turnIntent: CleanSlateTurnIntent;
	planMode: boolean;
	usePlanningPhase: boolean;
	usePlanningForCurrentTurn?: boolean;
}

export function normalizePhaseForExecutionFlow(input: IExecutionFlowPhaseInput): CleanSlateExecutionPhase {
	// Backward-compatible session migration: VERIFICATION used to be a cold
	// worker phase. All restored sessions now resume in the continuous
	// execution loop, where verification happens before the stop boundary.
	if (input.currentPhase === CLEANSLATE_PHASE.VERIFICATION) {
		return CLEANSLATE_PHASE.EXECUTION;
	}

	if (input.isAwaitingApproval || input.currentTaskKind === CleanSlateTaskKind.CHAT) {
		return input.currentPhase;
	}

	if (input.usePlanningForCurrentTurn === false && input.currentPhase === CLEANSLATE_PHASE.PLANNING) {
		return CLEANSLATE_PHASE.EXECUTION;
	}

	if (input.currentPhase === CLEANSLATE_PHASE.PLANNING
		&& (input.turnIntent === CleanSlateTurnIntent.APPROVE_PLAN
			|| !input.usePlanningPhase
			|| (!input.planMode && input.usePlanningForCurrentTurn === false))) {
		return CLEANSLATE_PHASE.EXECUTION;
	}

	return input.currentPhase;
}

export function applyRequestedModeToExecutionSettings(
	settings: IExecutionLoopSettings,
	requestedMode: CleanSlateRequestedMode
): IExecutionLoopSettings {
	if (requestedMode === CLEANSLATE_REQUESTED_MODE.EXECUTION) {
		if (settings.executionFlow === 'normal'
			&& !settings.planMode
			&& !settings.usePlanningPhase) {
			return settings;
		}
		return {
			...settings,
			executionFlow: 'normal',
			planMode: false,
			usePlanningPhase: false
		};
	}

	if (requestedMode !== CLEANSLATE_REQUESTED_MODE.PLANNING) {
		return settings;
	}

	return {
		...settings,
		executionFlow: 'planning',
		planMode: true,
		usePlanningPhase: true,
		maxNoToolTurns: Math.max(settings.maxNoToolTurns, 3),
		maxVerificationRetries: Math.max(settings.maxVerificationRetries, 2)
	};
}
