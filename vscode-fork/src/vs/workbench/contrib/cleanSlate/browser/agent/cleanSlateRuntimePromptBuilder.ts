/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AgentPhase } from './cleanSlatePrompts.js';
import { ICleanSlatePendingRecoveryState, ICleanSlateRunCheckpoint, ICleanSlateVerificationTarget } from '../core/cleanSlateTaskSessionService.js';

import {
    EXECUTION_MODIFY_PHASE_OBJECTIVE_PROMPT,
    EXECUTION_PHASE_OBJECTIVE_RULES,
    WEB_RESEARCH_PHASE_OBJECTIVE_RULES,
    WEB_RESEARCH_FINAL_ANSWER_RULES,
    APPROVED_IMPLEMENTATION_PLAN_LABEL,
    ORIGINAL_OBJECTIVE_LABEL,
    EXECUTION_SUMMARY_LABEL,
    CONTINUATION_CONTEXT_LABEL,
    KNOWN_DISCOVERED_PATHS_LABEL,
    KNOWN_SEMANTIC_HIGHLIGHTS_LABEL
} from '../composer/instructions/runtimeInstructions.js';

interface IPhaseObjectivePromptOptions {
    phase: AgentPhase;
    latestPlan?: string;
    userMessage?: string;
    rootObjective?: string;
    priorPhaseSummary?: string;
    continuationContext?: string;
}

export function buildPhaseObjectivePrompt(options: IPhaseObjectivePromptOptions): string {
    const { phase, latestPlan = '', userMessage = '', rootObjective = '', priorPhaseSummary = '', continuationContext = '' } = options;

    switch (phase) {
        case AgentPhase.EXECUTION:
        case AgentPhase.VERIFICATION:
            return [
                EXECUTION_MODIFY_PHASE_OBJECTIVE_PROMPT,
                ...EXECUTION_PHASE_OBJECTIVE_RULES,
                ...WEB_RESEARCH_PHASE_OBJECTIVE_RULES,
                ...WEB_RESEARCH_FINAL_ANSWER_RULES,
                latestPlan ? `${APPROVED_IMPLEMENTATION_PLAN_LABEL}\n${latestPlan}` : '',
                rootObjective && rootObjective !== userMessage ? `${ORIGINAL_OBJECTIVE_LABEL}\n${rootObjective}` : '',
                priorPhaseSummary ? `${EXECUTION_SUMMARY_LABEL}\n${priorPhaseSummary}` : '',
                continuationContext ? `${CONTINUATION_CONTEXT_LABEL}\n${continuationContext}` : '',
                userMessage ? `User Instruction:\n${userMessage}` : ''
            ].filter(Boolean).join('\n\n');
        case AgentPhase.PLANNING:
        default:
            return [
                'Inspect enough real workspace context to make the plan reliable; choose list, search, read, or symbol tools according to what is actually unknown.',
                'Keep discovery proportional to the change. Submit the plan once the affected files, integration points, and meaningful risks are grounded.',
                ...WEB_RESEARCH_PHASE_OBJECTIVE_RULES,
                ...WEB_RESEARCH_FINAL_ANSWER_RULES,
                rootObjective && rootObjective !== userMessage ? `${ORIGINAL_OBJECTIVE_LABEL}\n${rootObjective}` : '',
                continuationContext ? `${CONTINUATION_CONTEXT_LABEL}\n${continuationContext}` : '',
                userMessage ? `User Instruction:\n${userMessage}` : ''
            ].filter(Boolean).join('\n\n');
    }
}

export function buildWorkspaceMemoryPrompt(
    discoveredPaths: string[] = [],
    semanticHighlights: string[] = []
): string {
    const normalizedDiscoveredPaths = discoveredPaths
        .map(path => path.trim())
        .filter(path => path.length > 0)
        .slice(-12)
        .map(path => `- ${path}`);
    const normalizedSemanticHighlights = semanticHighlights
        .map(item => item.trim())
        .filter(item => item.length > 0)
        .slice(-8)
        .map(item => `- ${item}`);

    if (normalizedDiscoveredPaths.length === 0 && normalizedSemanticHighlights.length === 0) {
        return '';
    }

    return [
		'[WORKSPACE CONTEXT]',
		'Reuse relevant native conversation context while it remains current.',
        normalizedDiscoveredPaths.length > 0 ? `${KNOWN_DISCOVERED_PATHS_LABEL}:\n${normalizedDiscoveredPaths.join('\n')}` : '',
        normalizedSemanticHighlights.length > 0 ? `${KNOWN_SEMANTIC_HIGHLIGHTS_LABEL}:\n${normalizedSemanticHighlights.join('\n')}` : ''
    ].filter(Boolean).join('\n');
}

export function getWebResearchFinalAnswerPrompt(): string {
    return WEB_RESEARCH_FINAL_ANSWER_RULES.join('\n');
}

interface IContinuationContextPromptOptions {
    phase: AgentPhase;
    objective?: string;
    currentWorkItem?: string;
    toDo?: string[];
    discoveredPaths?: string[];
    semanticHighlights?: string[];
    lastSummary?: string;
    lastError?: string;
    lastToolName?: string;
    checkpoints?: ICleanSlateRunCheckpoint[];
    pendingRecovery?: ICleanSlatePendingRecoveryState;
    verificationTargets?: ICleanSlateVerificationTarget[];
}

export function buildContinuationContextPrompt(options: IContinuationContextPromptOptions): string {
    const {
        phase,
        objective,
        currentWorkItem,
        toDo = [],
        discoveredPaths = [],
        semanticHighlights = [],
        lastSummary,
        lastError,
        lastToolName,
        checkpoints = [],
        pendingRecovery,
        verificationTargets = []
    } = options;
    const recentCheckpoints = checkpoints
        .filter(checkpoint => typeof checkpoint.summary === 'string' && checkpoint.summary.trim().length > 0)
        .slice(-5)
        .map(checkpoint => `- [${checkpoint.kind}] ${checkpoint.summary}`);
    const normalizedToDo = toDo
        .map(item => item.trim())
        .filter(item => item.length > 0)
        .map(item => `- ${item}`);
    const normalizedDiscoveredPaths = discoveredPaths
        .map(path => path.trim())
        .filter(path => path.length > 0)
        .slice(-15)
        .map(path => `- ${path}`);
    const normalizedSemanticHighlights = semanticHighlights
        .map(item => item.trim())
        .filter(item => item.length > 0)
        .slice(-10)
        .map(item => `- ${item}`);

    return [
        'Resume the active task from the latest saved checkpoint. Do not restart from scratch.',
        `Current Phase: ${phase}`,
        objective ? `Task Objective: ${objective}` : '',
        currentWorkItem ? `Current Work Item: ${currentWorkItem}` : '',
        lastSummary ? `Latest Summary: ${lastSummary}` : '',
        lastError ? `Latest Error: ${lastError}` : '',
        lastToolName ? `Last Tool: ${lastToolName}` : '',
        pendingRecovery ? `Unresolved Recovery: ${pendingRecovery.prompt}` : '',
        verificationTargets.filter(target => target.status !== 'verified').length > 0
            ? `Pending Verification Targets:\n${verificationTargets.filter(target => target.status !== 'verified').map(target => `- ${target.description}`).join('\n')}`
            : '',
        normalizedToDo.length > 0 ? `Current To Do:\n${normalizedToDo.join('\n')}` : '',
        normalizedDiscoveredPaths.length > 0 ? `Discovered Path Memory:\n${normalizedDiscoveredPaths.join('\n')}` : '',
        normalizedSemanticHighlights.length > 0 ? `Semantic Hotspots:\n${normalizedSemanticHighlights.join('\n')}` : '',
        recentCheckpoints.length > 0 ? `Recent Checkpoints:\n${recentCheckpoints.join('\n')}` : '',
        'Continue from the saved state and preserve already completed work.'
    ].filter(Boolean).join('\n\n');
}
