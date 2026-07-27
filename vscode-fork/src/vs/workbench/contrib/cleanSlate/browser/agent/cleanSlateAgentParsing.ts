/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CLEANSLATE_FALLBACK_CONTEXT_WINDOW_TOKENS, ICleanSlateConfigurationService, normalizeCleanSlateExecutionState } from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { AgentPhase } from './cleanSlatePrompts.js';
import { IExecutionLoopSettings, ParsedToolCall } from './cleanSlateAgentTypes.js';

export class CleanSlateAgentParsingSupport {
    private static readonly CHARS_PER_TOKEN_ESTIMATE = 4;
    /**
     * A fixed reserve is kept below the model's usable input window before
     * compaction starts.  The resolved model profile normally gives
     * us an exact reserve; this is only the safe fallback for unknown models.
     */
    private static readonly DEFAULT_AUTO_COMPACT_RESERVE_TOKENS = 13_000;
    private static readonly MINIMUM_AUTO_COMPACT_RESERVE_TOKENS = 4_000;

    constructor(
        private readonly configService: ICleanSlateConfigurationService
    ) { }

    public getExecutionLoopSettings(): IExecutionLoopSettings {
        const config = this.configService.getConfiguration();
        const executionState = normalizeCleanSlateExecutionState({
            planMode: config.planMode,
            reasoningLevel: config.reasoningLevel
        });
        type RuntimeExecutionFlow = 'normal' | 'planning';
        const executionFlow: RuntimeExecutionFlow = executionState.planMode ? 'planning' : 'normal';

        const flowDefaults: Record<RuntimeExecutionFlow, {
            maxNoToolTurns: number;
            maxVerificationRetries: number;
            failOnWarnings: boolean;
            usePlanningPhase: boolean;
            turnDelayMs: number;
        }> = {
            normal: {
                maxNoToolTurns: 2,
                maxVerificationRetries: 1,
                failOnWarnings: false,
                usePlanningPhase: false,
                turnDelayMs: 0
            },
            planning: {
                maxNoToolTurns: 3,
                maxVerificationRetries: 2,
                failOnWarnings: false,
                usePlanningPhase: true,
                turnDelayMs: 0
            }
        };

        const defaults = flowDefaults[executionFlow];
        const maxTurns = Number.isFinite(config.maxTurns) && config.maxTurns! > 0
            ? Math.floor(config.maxTurns!)
            : undefined;
        const maxNoToolTurns = Number.isFinite(config.maxNoToolTurns) ? Math.max(1, Math.floor(config.maxNoToolTurns!)) : defaults.maxNoToolTurns;
        const maxVerificationRetries = Number.isFinite(config.maxVerificationRetries) ? Math.max(0, Math.floor(config.maxVerificationRetries!)) : defaults.maxVerificationRetries;
        const verificationCommands = Array.isArray(config.verificationCommands)
            ? config.verificationCommands.filter((command: string) => typeof command === 'string' && command.trim().length > 0)
            : [];
        const failOnWarnings = config.failOnWarnings !== undefined ? !!config.failOnWarnings : defaults.failOnWarnings;

        return {
            executionFlow,
            planMode: executionState.planMode,
            reasoningLevel: executionState.reasoningLevel,
            maxTurns,
            maxNoToolTurns,
            maxVerificationRetries,
            verificationCommands,
            failOnWarnings,
            usePlanningPhase: defaults.usePlanningPhase,
            turnDelayMs: defaults.turnDelayMs
        };
    }

    public getExecutionContextBudgetChars(): number {
        const config = this.configService.getConfiguration();
        const contextWindowTokens = Number.isFinite(config.contextWindow)
            ? Math.max(1024, Math.floor(config.contextWindow!))
            : CLEANSLATE_FALLBACK_CONTEXT_WINDOW_TOKENS;
        // globalContextBudget is a retrieval / working-context budget. It must
        // never decide when the conversation itself is compacted: doing that
        // made a 252k-token model compact after only a few normal turns.
        return Math.max(12_000, contextWindowTokens * CleanSlateAgentParsingSupport.CHARS_PER_TOKEN_ESTIMATE);
    }

    public getExecutionAutoCompactThresholdChars(): number {
        const config = this.configService.getConfiguration();
        const contextWindowTokens = Number.isFinite(config.contextWindow)
            ? Math.max(1024, Math.floor(config.contextWindow!))
            : CLEANSLATE_FALLBACK_CONTEXT_WINDOW_TOKENS;
        const fallbackReserveTokens = Math.min(
            CleanSlateAgentParsingSupport.DEFAULT_AUTO_COMPACT_RESERVE_TOKENS,
            Math.max(
                CleanSlateAgentParsingSupport.MINIMUM_AUTO_COMPACT_RESERVE_TOKENS,
                Math.floor(contextWindowTokens * 0.10)
            )
        );
        const reserveTokens = Number.isFinite(config.autoCompactReserveTokens)
            ? Math.max(0, Math.floor(config.autoCompactReserveTokens!))
            : fallbackReserveTokens;
        const thresholdTokens = Math.max(1024, contextWindowTokens - reserveTokens);
        return Math.max(12_000, thresholdTokens * CleanSlateAgentParsingSupport.CHARS_PER_TOKEN_ESTIMATE);
    }

    public truncateForPrompt(text: string, maxChars: number = 1600): string {
        if (!text || text.length <= maxChars) {
            return text;
        }
        return `${text.slice(0, maxChars)}\n... [truncated]`;
    }

	public buildLoopAssistantMemory(
		rawResponse: string,
		phase: AgentPhase,
		toDoList: string[],
		toolCalls: ParsedToolCall[]
	): string {
		const memoryLines: string[] = [];
		const trimmedResponse = rawResponse.trim();
		if (trimmedResponse.length > 0) {
			memoryLines.push(trimmedResponse);
		}
		if (toDoList.length > 0) {
			memoryLines.push(['Current todo:', ...toDoList.map(item => `- ${item}`)].join('\n'));
		}

		void phase;
		void toolCalls;
		return memoryLines.join('\n\n');
	}
}
