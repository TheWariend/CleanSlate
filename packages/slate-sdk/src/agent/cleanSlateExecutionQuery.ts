/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CLEANSLATE_FALLBACK_CONTEXT_WINDOW_TOKENS, CleanSlateExecutionFlow, IChatMessage, IChatToolDefinition } from '../protocol/cleanSlateAI.js';
import { AgentPhase } from './cleanSlatePrompts.js';
import { CleanSlateThreadService } from '../services/cleanSlateThreadService.js';
import { CleanSlateTaskSessionService } from '../services/cleanSlateTaskSessionService.js';
import { CleanSlateStreamPart, IExecutionLoopSettings, ParsedToolCall, PHASE_CONCLUSION_SIGNAL_PLAN_CREATED } from './cleanSlateAgentTypes.js';
import type { IExecutionRunnerOptions, IExecutionRunOptions, ICleanSlateDeferredContext } from './cleanSlateQueryRunner.js';
import { CleanSlateAgentExecutionPhase } from './cleanSlateAgentExecutionPhase.js';
import { CleanSlateExecutionEvidenceLedger } from './cleanSlateExecutionEvidenceLedger.js';
import { CleanSlateFilesModifiedService, type ICleanSlateFileChange } from './cleanSlateFilesModifiedService.js';
import { ALL_TOOLS } from '../tools/registry.js';
import { serializeToolResultForPrompt } from './cleanSlateToolResultPromptSerializer.js';
import { CleanSlateNativeToolTranscript } from './cleanSlateNativeToolTranscript.js';
import { CleanSlateToolCallLedger } from './cleanSlateToolCallLedger.js';
import { CleanSlateContextBudgetManager } from './cleanSlateContextBudgetManager.js';
import { buildExecutionNoProgressStopMessage, buildExecutionNoToolRecoveryPrompt, buildSerializedToolCallRecoveryPrompt, detectSerializedToolCallSyntax } from './cleanSlateExecutionLoopPrompts.js';
import { CLEANSLATE_CODING_PROFILE, ICleanSlateDomainProfile } from './cleanSlateDomainProfile.js';
import { extractPlanFileEntries, planEntryTargetToPath } from '../tools/cleanSlatePlanArtifactPolicy.js';
import { evaluateExecutionCommandPolicy } from './cleanSlateCommandPolicy.js';
import { getWebResearchFinalAnswerPrompt } from './cleanSlateRuntimePromptBuilder.js';
import { CleanSlateStreamingToolEvent, CleanSlateStreamingToolExecutor, ICleanSlateStreamingToolExecution } from './cleanSlateStreamingToolExecutor.js';
import { CleanSlateExecutionEditPolicy } from './cleanSlateExecutionEditPolicy.js';
import { cancellationTokenFromAbortSignal } from '../services/cleanSlateCancellation.js';
import { estimateCleanSlateFileReadTokens } from '../tools/cleanSlateFileReadPolicy.js';

type IExecutionToolExecution = ICleanSlateStreamingToolExecution;
type IExecutionToolStreamEvent = CleanSlateStreamingToolEvent;

interface IExecutionQueryState {
    objective: string;
    /**
     * Plan mode: the SAME loop runs with mutation and command tools filtered
     * out, submit_artifact is the sole exit, and a text-only turn simply ends
     * the turn (the model is talking to the user) — no completion machinery.
     */
    planMode: boolean;
    /** File targets extracted from the approved implementation plan handoff, if any. */
    plannedFileTargets: string[];
    turnCount: number;
    pendingRecoveryPrompt?: string;
    recoveryNoToolTurns: number;
    noToolTurns: number;
}

interface IExecutionGuardState {
    touchedPaths: Set<string>;
    mutatedPaths: Set<string>;
    pendingVerificationPaths: Set<string>;
    executionEvidenceLedger: CleanSlateExecutionEvidenceLedger;
    mutationSummaries: IExecutionMutationSummary[];
    verificationSummaries: IExecutionVerificationSummary[];
    terminalSummaries: IExecutionTerminalSummary[];
    markerBaseline: Map<string, number>;
    currentTurnIndex: number;
    successfulToolResultsInPhase: number;
    successfulMutationsInPhase: number;
    failOnWarnings: boolean;
    postEditCommandVerified: boolean;
    postEditCommandIssues: string[];
}

interface IExecutionMutationSummary {
    toolName: string;
    turnIndex?: number;
    paths: string[];
    fileChanges?: ICleanSlateFileChange[];
    appliedBlocks?: number;
    added?: number;
    deleted?: number;
    totalLinesChanged?: number;
    diagnosticsCount?: number;
    strategies?: string[];
    message?: string;
}

interface IExecutionVerificationSummary {
    toolName: string;
    paths: string[];
    passed: boolean;
    lintIssueCount: number;
    markerIssueCount: number;
    message?: string;
}

export interface IExecutionTerminalSummary {
    toolName?: string;
    turnIndex?: number;
    command?: string;
    sessionId?: string;
    intent?: string;
    writesToWorkspace?: boolean;
    success?: boolean;
    status?: string;
    exitCode?: number;
    output?: string;
    error?: string;
}

export interface ICleanSlateExecutionQueryCompletionState {
    touchedPaths: string[];
    mutatedPaths: string[];
    mutationSummaries: IExecutionMutationSummary[];
    terminalSummaries: IExecutionTerminalSummary[];
    proofSummaries: string[];
    completionSource: 'host_finalized';
    verificationIssueCount: number;
    successfulMutationsInPhase: number;
    summary?: string;
    /** File targets named by the approved implementation plan, when one exists. */
    plannedFileTargets?: string[];
    /** Planned files with no mutation this run — the auditor requires each to be explicitly accounted for. */
    unmutatedPlannedFiles?: string[];
}

export interface IExecutionQueryRunOptions extends IExecutionRunOptions {
    logLabel?: string;
    executionFlow?: CleanSlateExecutionFlow;
    /** AgentPhase.PLANNING runs the loop in plan mode (read-only tools, submit_artifact concludes). Defaults to EXECUTION. */
    phase?: AgentPhase;
}

export class CleanSlateExecutionQueryEngine {
    /**
     * Describes what the tools in play do to the workspace, so the loop can
     * reason about mutation, verification and concurrency without knowing any
     * individual tool by name.
     */
    private readonly profile: ICleanSlateDomainProfile = CLEANSLATE_CODING_PROFILE;

    /** The check the loop runs itself after mutations. */
    private get verificationToolName(): string {
        return this.profile.deterministicVerificationTool ?? '';
    }
    private static readonly DEFAULT_MODEL_TURN_INTERVAL_MS = 0;
    private static readonly NORMAL_MODEL_TURN_INTERVAL_MS = 0;
    private static readonly PLANNING_MODEL_TURN_INTERVAL_MS = 0;
	/** Summaries are brief continuation state, not another agent turn. */
	private static readonly COMPACTION_MAX_OUTPUT_TOKENS = 2_000;
	/** Stop retrying a failed automatic compaction instead of burning quota repeatedly. */
	private static readonly MAX_CONSECUTIVE_COMPACTION_FAILURES = 3;
	/** A summary must earn back meaningful context before another automatic summary is useful. */
	private static readonly AUTO_COMPACTION_REGROWTH_RATIO = 1.25;
    private lastModelTurnStartedAt: number | undefined;
    private readonly executionPhase: CleanSlateAgentExecutionPhase;
    private readonly filesModifiedService = new CleanSlateFilesModifiedService();
    private readonly nativeToolTranscript = new CleanSlateNativeToolTranscript('execution');
	private readonly contextBudgetManager = new CleanSlateContextBudgetManager();
	private readonly editPolicy = new CleanSlateExecutionEditPolicy();
	private consecutiveCompactionFailures = 0;
	private lastSuccessfulCompactionChars: number | undefined;

    constructor(private readonly options: IExecutionRunnerOptions) {
        this.executionPhase = new CleanSlateAgentExecutionPhase(options);
    }

	public getExecutionLoopSettings(): IExecutionLoopSettings {
		return this.options.parsingSupport.getExecutionLoopSettings();
	}

    public async * run(
        messages: IChatMessage[],
        originalUserMessage: string,
        uiMode: string,
        initialContext: any,
        mentionedFiles: string,
        activeThreadService: CleanSlateThreadService,
        activeTaskSessionService: CleanSlateTaskSessionService,
        signal?: AbortSignal,
        runOptions: IExecutionQueryRunOptions = {}
    ): AsyncIterable<CleanSlateStreamPart> {
        const runPhase = runOptions.phase === AgentPhase.PLANNING ? AgentPhase.PLANNING : AgentPhase.EXECUTION;
        const planMode = runPhase === AgentPhase.PLANNING;
        const promptMode = planMode
            ? (typeof uiMode === 'string' && uiMode.trim().length > 0 ? uiMode : 'Planning')
            : 'Execution';
        const logLabel = runOptions.logLabel || (planMode ? 'PLANNING' : 'EXECUTION');
        const markCompletedOnFinish = !runOptions.stopOnPhaseTransition;

        const queryState: IExecutionQueryState = {
            objective: originalUserMessage,
            planMode,
            plannedFileTargets: planMode ? [] : this.extractPlannedFileTargets(messages),
            turnCount: 1,
            recoveryNoToolTurns: 0,
            noToolTurns: 0
        };
        const persistedPendingRecovery = planMode ? undefined : activeTaskSessionService.getPendingRecovery();
        if (persistedPendingRecovery?.prompt) {
            queryState.pendingRecoveryPrompt = persistedPendingRecovery.prompt;
        }
        const nativeTools = this.getNativeToolDefinitions();
        const settings = this.options.parsingSupport.getExecutionLoopSettings();
        const executionFlow = runOptions.executionFlow || settings.executionFlow;
        const toolCallLedger = new CleanSlateToolCallLedger({
            availableToolNames: nativeTools.map(tool => tool.name),
            validateToolCall: toolCall => this.executionPhase.validateToolCallForPhase(
                AgentPhase.EXECUTION,
                toolCall.toolName,
				toolCall.input
            )
        });
        const guardState: IExecutionGuardState = {
            touchedPaths: new Set<string>(),
            mutatedPaths: new Set<string>(),
            pendingVerificationPaths: new Set<string>(),
            executionEvidenceLedger: new CleanSlateExecutionEvidenceLedger(),
            mutationSummaries: [],
            verificationSummaries: [],
            terminalSummaries: [],
            markerBaseline: this.options.executionSupport.createMarkerBaseline(settings.failOnWarnings),
            currentTurnIndex: 1,
            successfulToolResultsInPhase: 0,
            successfulMutationsInPhase: 0,
            failOnWarnings: settings.failOnWarnings,
            postEditCommandVerified: false,
            postEditCommandIssues: []
        };

        if (activeTaskSessionService.getPhase() !== runPhase) {
            activeTaskSessionService.setPhase(runPhase);
        }

        while (true) {
            if (signal?.aborted) {
                break;
            }
			const budgetDecision = runOptions.executionBudget?.consumeModelTurn(runPhase);
			if (budgetDecision && !budgetDecision.allowed) {
				const stopMessage = budgetDecision.message!;
                yield { type: 'chat_text', content: stopMessage, kind: 'model_terminated_pause' };
                activeThreadService.addMessage('assistant', stopMessage);
                activeTaskSessionService.recordAssistantSummary(stopMessage);
                return;
            }
            const visibleTurnIndex = queryState.turnCount;
            guardState.currentTurnIndex = visibleTurnIndex;
            toolCallLedger.beginTurn();
            await this.waitForNextModelTurn(signal, executionFlow);

            console.log(`[CleanSlateAgent] [${logLabel}] Starting query turn ${visibleTurnIndex}...`);

            if (this.shouldRefreshContextForTurn(visibleTurnIndex)) {
                await this.prepareContext({
                    messages,
                    objective: originalUserMessage,
                    mode: promptMode,
                    planMode,
                    initialContext,
                    mentionedFiles,
                    deferredSemanticContext: runOptions.deferredSemanticContext,
                    signal
                });
            }

            const turnId = `${runPhase}-${visibleTurnIndex}`;
            let currentResponse = '';
            const streamedToolCalls: ParsedToolCall[] = [];
            const streamedToolCallKeys = new Set<string>();
            const yieldedStreamingExecutions: IExecutionToolExecution[] = [];
            let finishedDuringModelStream = false;
            let concludedWithPlanSignal = false;
            let completedBlockingToolDuringModelStream = false;
            let nextToolIndex = 0;
            const streamingToolExecutor = new CleanSlateStreamingToolExecutor({
                isConcurrencySafe: toolCall => this.isParallelToolCall(toolCall),
				executeTool: (toolCall, signal) => this.streamToolExecutionParts(toolCall, signal, queryState, guardState, executionFlow, toolCallLedger, activeTaskSessionService),
                signal,
                emitAbortedResults: true
            });
            const turnNativeTools = this.getNativeToolDefinitionsForTurn(nativeTools, queryState);
			const pruneResult = this.contextBudgetManager.pruneOldToolOutputs(messages);
			if (pruneResult.pruned) {
				console.info(`[CleanSlateAgent] [${logLabel}] Proactively pruned old tool output before turn ${visibleTurnIndex}: ${pruneResult.beforeChars} -> ${pruneResult.afterChars} chars; reclaimed=${pruneResult.reclaimedChars}; toolResults=${pruneResult.compactedToolResults}; assistantTurns=${pruneResult.compactedAssistantTurns}.`);
			}
			const toolDefinitionChars = this.getToolDefinitionChars(turnNativeTools);
			if (this.shouldAttemptConversationCompaction(messages, toolDefinitionChars)) {
				yield { type: 'context_compaction_start', turnId };
				const compacted = await this.compactMessagesBeforeProviderCall(messages, visibleTurnIndex, logLabel, toolDefinitionChars, signal);
				yield { type: 'context_compaction_complete', turnId, compacted };
            }
            const providerMessages = this.buildMessagesForProvider(messages, visibleTurnIndex, logLabel, toolDefinitionChars);
            const contextUsage = this.getEstimatedContextUsage(providerMessages, toolDefinitionChars);
            yield { type: 'assistant_turn_start', phase: runPhase, turnId, turnIndex: visibleTurnIndex };
            yield { type: 'context_usage', turnId, ...contextUsage };
            this.refreshFileReadBudget(providerMessages, turnNativeTools);
            const response = await this.options.cleanSlateService.chat(providerMessages, {
                tools: turnNativeTools,
				sessionId: this.options.getSessionId?.(),
                cancellationToken: cancellationTokenFromAbortSignal(signal)
            });
            const responseIterator = response[Symbol.asyncIterator]();
            let nextModelPart = responseIterator.next();
            let nextToolEvent: Promise<IExecutionToolStreamEvent | undefined> | undefined;
            const collectToolEventParts = (event: IExecutionToolStreamEvent | undefined): CleanSlateStreamPart[] => {
                if (!event) {
                    return [];
                }
                if (event.type === 'parts') {
                    return event.batch.parts;
                }
                yieldedStreamingExecutions.push(event.execution);
                if (!this.isParallelToolCall(event.execution.toolCall)) {
                    completedBlockingToolDuringModelStream = true;
                }
                return event.execution.parts;
            };

            while (!signal?.aborted) {
                if (!nextToolEvent && streamingToolExecutor.hasUnfinishedWork()) {
                    nextToolEvent = streamingToolExecutor.nextEvent();
                }

                const next = await Promise.race([
                    nextModelPart.then(result => ({ type: 'model' as const, result })),
                    ...(nextToolEvent ? [nextToolEvent.then(event => ({ type: 'tool' as const, event }))] : [])
                ]);

                if (next.type === 'tool') {
                    nextToolEvent = undefined;
                    for (const executionPart of collectToolEventParts(next.event)) {
                        yield executionPart;
                        if (executionPart.type === 'task_complete' || (executionPart.type === 'tool_result' && executionPart.toolName === PHASE_CONCLUSION_SIGNAL_PLAN_CREATED)) {
                            finishedDuringModelStream = true;
                            concludedWithPlanSignal = concludedWithPlanSignal || (executionPart.type === 'tool_result' && executionPart.toolName === PHASE_CONCLUSION_SIGNAL_PLAN_CREATED);
                        }
                    }
                    if (finishedDuringModelStream || completedBlockingToolDuringModelStream) {
                        if (typeof responseIterator.return === 'function') {
                            await responseIterator.return();
                        }
                        break;
                    }
                    continue;
                }

                const modelResult = next.result;
                if (modelResult.done) {
                    break;
                }

                const part = modelResult.value;
                nextModelPart = responseIterator.next();
                if (signal?.aborted) {
                    break;
                }
                if (part.type === 'transport_status') {
                    yield part;
                } else if (part.type === 'reasoning') {
                    yield { type: 'reasoning', content: part.content };
                } else if (part.type === 'text') {
                    currentResponse += part.content;
                    // Every normal text block renders, even when a tool call
                    // follows it. Phase is presentation metadata, never
                    // permission for the host to discard assistant text.
                    yield {
                        type: 'chat_text',
                        content: part.content,
                        kind: part.phase === 'commentary'
                            ? 'commentary'
                            : part.phase === 'final_answer' ? 'final_answer' : 'assistant'
                    };
                } else if (part.type === 'tool_call') {
                    const streamedToolCall = this.parseStreamedToolCall(part.call, toolCallLedger);
                    if (streamedToolCall) {
                        const key = toolCallLedger.getTurnKey(streamedToolCall);
                        if (!streamedToolCallKeys.has(key) && toolCallLedger.shouldAcceptInCurrentTurn(streamedToolCall)) {
                            streamedToolCallKeys.add(key);
                            streamedToolCalls.push(streamedToolCall);
                            streamingToolExecutor.addTool(streamedToolCall, nextToolIndex++);
                        }
                    }
                }

                if (finishedDuringModelStream) {
                    break;
                }
            }

            if (!finishedDuringModelStream && nextToolEvent) {
                for (const executionPart of collectToolEventParts(await nextToolEvent)) {
                    yield executionPart;
                    if (executionPart.type === 'task_complete' || (executionPart.type === 'tool_result' && executionPart.toolName === PHASE_CONCLUSION_SIGNAL_PLAN_CREATED)) {
                        finishedDuringModelStream = true;
                        concludedWithPlanSignal = concludedWithPlanSignal || (executionPart.type === 'tool_result' && executionPart.toolName === PHASE_CONCLUSION_SIGNAL_PLAN_CREATED);
                    }
                }
            }

            yield { type: 'assistant_turn_complete', phase: runPhase, turnId, turnIndex: visibleTurnIndex };
            this.recordModelTurnCompleted();

            if (finishedDuringModelStream) {
                if (markCompletedOnFinish && !concludedWithPlanSignal) {
                    activeTaskSessionService.markCompleted();
                }
                return;
            }

            const assistantTurn = this.parseAssistantTurn(currentResponse);
            const toolCalls = this.mergeToolCalls(assistantTurn.toolCalls, streamedToolCalls);
            for (const toolCall of assistantTurn.toolCalls) {
                const normalizedToolCall = toolCallLedger.normalizeToolCall(toolCall);
                const key = toolCallLedger.getTurnKey(normalizedToolCall);
                if (streamedToolCallKeys.has(key)) {
                    continue;
                }
                if (!toolCallLedger.shouldAcceptInCurrentTurn(normalizedToolCall)) {
                    continue;
                }
                streamingToolExecutor.addTool(normalizedToolCall, nextToolIndex++);
            }
            const assistantMemoryContent = () =>
                this.options.parsingSupport.buildLoopAssistantMemory(currentResponse, runPhase, assistantTurn.toDoList, toolCalls);

            if (toolCalls.length > 0) {
				queryState.noToolTurns = 0;
				messages.push(this.nativeToolTranscript.buildAssistantToolCallMessage(assistantMemoryContent(), toolCalls));
				let shouldRestartAfterMutation = false;
				let sawConfirmedMutation = false;
				let sawUserCancelledCommand = false;
				let sawToolCallLoop = false;
				const recoveryPrompts: string[] = [];

				for (const execution of yieldedStreamingExecutions) {
					if (this.pauseForQuestion(execution.toolCall, execution.result, activeTaskSessionService)) {
						return;
					}
					messages.push(this.nativeToolTranscript.buildToolResultMessage(execution.toolCall, execution.result));
					if (this.editPolicy.isUserCancelledCommandResult(execution.toolCall, execution.result)) {
						sawUserCancelledCommand = true;
					}
					if (this.isToolCallLoopResult(execution.result)) {
						sawToolCallLoop = true;
					}

					if (this.shouldVerifyAfterToolResult(execution.toolCall, execution.result)) {
						shouldRestartAfterMutation = true;
						sawConfirmedMutation = true;
                    }

                    const recoveryPrompt = this.editPolicy.buildFailedEditRecoveryPrompt(execution.toolCall, execution.result);
                    if (recoveryPrompt) {
                        recoveryPrompts.push(recoveryPrompt);
                    }

                }

				for await (const event of streamingToolExecutor.getRemainingEvents()) {
					if (event.type === 'parts') {
                        for (const part of event.batch.parts) {
                            yield part;
                            if (part.type === 'tool_result' && part.toolName === PHASE_CONCLUSION_SIGNAL_PLAN_CREATED) {
                                return;
                            }
                            if (part.type === 'task_complete') {
                                if (markCompletedOnFinish) {
                                    activeTaskSessionService.markCompleted();
                                }
                                return;
                            }
							if (part.type === 'tool_result' && this.pauseForQuestion(event.batch.toolCall, part.result, activeTaskSessionService)) {
                                return;
                            }
                        }
                    } else {
                        const execution = event.execution;
                        for (const part of execution.parts) {
                            yield part;
                            if (part.type === 'tool_result' && part.toolName === PHASE_CONCLUSION_SIGNAL_PLAN_CREATED) {
                                return;
                            }
                            if (part.type === 'task_complete') {
                                if (markCompletedOnFinish) {
                                    activeTaskSessionService.markCompleted();
                                }
                                return;
                            }
                        }

						if (this.pauseForQuestion(execution.toolCall, execution.result, activeTaskSessionService)) {
							return;
						}
						messages.push(this.nativeToolTranscript.buildToolResultMessage(execution.toolCall, execution.result));
						if (this.editPolicy.isUserCancelledCommandResult(execution.toolCall, execution.result)) {
							sawUserCancelledCommand = true;
						}
						if (this.isToolCallLoopResult(execution.result)) {
							sawToolCallLoop = true;
						}

						if (this.shouldVerifyAfterToolResult(execution.toolCall, execution.result)) {
							shouldRestartAfterMutation = true;
							sawConfirmedMutation = true;
                        }

                        const recoveryPrompt = this.editPolicy.buildFailedEditRecoveryPrompt(execution.toolCall, execution.result);
                        if (recoveryPrompt) {
                            recoveryPrompts.push(recoveryPrompt);
						}

					}
				}

				if (sawUserCancelledCommand) {
					const stopMessage = 'Command cancelled. I will not run it again unless you explicitly ask me to.';
					activeTaskSessionService.markCancelled();
					yield { type: 'chat_text', content: stopMessage };
					yield { type: 'assistant_turn_complete', phase: runPhase, turnId, turnIndex: visibleTurnIndex };
					activeThreadService.addMessage('assistant', stopMessage);
					activeTaskSessionService.recordAssistantSummary(stopMessage);
					return;
				}

				if (sawToolCallLoop) {
					const stopMessage = 'Paused after the same tool call was repeated three times. Change the tool or its arguments before continuing; the workspace was not declared complete.';
					yield { type: 'chat_text', content: stopMessage, kind: 'model_terminated_pause' };
					activeThreadService.addMessage('assistant', stopMessage);
					activeTaskSessionService.recordAssistantSummary(stopMessage);
					return;
				}

				if (shouldRestartAfterMutation) {
					if (sawConfirmedMutation && recoveryPrompts.length === 0) {
						queryState.pendingRecoveryPrompt = undefined;
						queryState.recoveryNoToolTurns = 0;
                        activeTaskSessionService.clearPendingRecovery();
                    }
                    const verificationResult = yield* this.streamPostMutationVerificationParts(signal, guardState);
                    if (verificationResult.result) {
                        messages.push({
                            role: 'system',
                            content: `Deterministic ${this.verificationToolName} verification result:\n${serializeToolResultForPrompt(this.verificationToolName, verificationResult.result)}`
                        });
                    }
                    const verificationFailed = verificationResult.result?.success === false;
                    const verificationIssues = verificationFailed
                        ? [String(verificationResult.result?.message ?? verificationResult.result?.error ?? 'read_lints failed.')]
                        : verificationResult.issues;
                    guardState.postEditCommandVerified = verificationIssues.length === 0;
                    guardState.postEditCommandIssues = verificationIssues;
                    if (verificationIssues.length > 0) {
                        messages.push({
                            role: 'system',
                            content: this.buildPostMutationVerificationPrompt(verificationIssues)
                        });
                    } else if (recoveryPrompts.length === 0 && !queryState.pendingRecoveryPrompt) {
                        const finalVerificationScope = guardState.mutatedPaths.size > 0
                            ? guardState.mutatedPaths
                            : guardState.touchedPaths;
                        const finalIssues = await this.options.executionSupport.collectNewMarkerIssues(
                            guardState.markerBaseline,
                            finalVerificationScope,
                            guardState.failOnWarnings,
                            40
                        );
                        if (finalIssues.length === 0) {
                            messages.push({
                                role: 'system',
                                content: this.buildVerifiedFinishPrompt(guardState)
                            });
                        } else {
                            guardState.postEditCommandVerified = false;
                            guardState.postEditCommandIssues = finalIssues;
                            messages.push({
                                role: 'system',
                                content: this.buildPostMutationVerificationPrompt(finalIssues)
                            });
                        }
                    }
                    // No re-read demand after mutations:
                    // apply_edit updates the host read-state with post-write
                    // content, and string anchors resolve against current
                    // content — the model's own edits never go stale on it.
                }

                if (recoveryPrompts.length > 0) {
                    for (const recoveryPrompt of recoveryPrompts) {
                        this.appendPendingRecoveryPrompt(queryState, recoveryPrompt);
                    }
                    activeTaskSessionService.setPendingRecovery(queryState.pendingRecoveryPrompt, { toolName: this.profile.recoveryMutationTool ?? '', code: 'recovery_required' });
                    messages.push({
                        role: 'system',
                        content: queryState.pendingRecoveryPrompt ?? recoveryPrompts.join('\n\n')
                    });
                } else if (sawConfirmedMutation) {
                    queryState.pendingRecoveryPrompt = undefined;
                    queryState.recoveryNoToolTurns = 0;
                    activeTaskSessionService.clearPendingRecovery();
                }

                queryState.turnCount++;
                continue;
            }

            if (planMode) {
                // Plan-mode stop semantics: a turn with no tool calls means the
                // model stopped to talk to the user — a clarifying question, an
                // intermediate report, or an answer. The turn simply ends; none
                // of the execution completion machinery below applies in plan
                // mode.
                if (currentResponse.trim().length > 0) {
					messages.push({ role: 'assistant', content: currentResponse });
                    activeThreadService.addMessage('assistant', currentResponse);
                    activeTaskSessionService.recordAssistantTurn(currentResponse);
                    return;
                }
                // A truly empty response falls through to the generic
                // no-tool retry nudge — that is transport-glitch recovery,
                // not completion pressure.
            }

            // Stop semantics:
            // tool calls keep the loop alive; a non-empty assistant response
            // with no tool call is the final model turn. Completion itself is
            // a host lifecycle event, never a model-facing tool call.
            if (!planMode && await this.canHostFinalizeProseStop(currentResponse, queryState, guardState)) {
                if (markCompletedOnFinish) {
                    activeTaskSessionService.markCompleted();
                }
				messages.push({ role: 'assistant', content: currentResponse });
                yield {
                    type: 'task_complete',
                    result: {
                        phase: AgentPhase.EXECUTION,
                        executionFlow,
                        verified: true,
                        completionSource: 'host_finalized',
                        completionState: this.buildCompletionState(guardState, currentResponse, queryState.plannedFileTargets)
                    }
                };
                return;
            }

            if (!planMode && currentResponse.trim().length > 0) {
				messages.push({ role: 'assistant', content: currentResponse });
				activeThreadService.addMessage('assistant', currentResponse);
				activeTaskSessionService.recordAssistantTurn(currentResponse);
				activeTaskSessionService.recordAssistantSummary(currentResponse);
				activeTaskSessionService.markInterrupted();
				return;
            }

            if (queryState.pendingRecoveryPrompt) {
                queryState.recoveryNoToolTurns++;
                const recoveryNudge = [
                    'RECOVERY STILL REQUIRED: the previous edit failed and no recovery tool call was returned.',
                    queryState.pendingRecoveryPrompt,
                    'Return corrected tool_calls only. Re-read only if the result reports stale content or you need more current context, then retry apply_edit with file_path, a corrected unique old_string, and new_string. Do not return a final answer until the failed edit is fixed or verified unnecessary.'
                ].join('\n\n');
                activeThreadService.addMessage('assistant', assistantMemoryContent(), true);
                messages.push({ role: 'assistant', content: assistantMemoryContent() });
                messages.push({ role: 'system', content: recoveryNudge });

                if (queryState.recoveryNoToolTurns >= 4) {
                    const stopMessage = 'Paused execution after repeated edit-failure recovery turns returned no tool calls. The workspace was not declared complete.';
                    yield { type: 'chat_text', content: stopMessage, kind: 'model_terminated_pause' };
                    activeThreadService.addMessage('assistant', stopMessage);
                    activeTaskSessionService.recordAssistantSummary(stopMessage);
                    return;
                }

                queryState.turnCount++;
                continue;
            }

            queryState.noToolTurns++;
            const maxNoToolTurns = this.getNoProgressTurnLimit(
                AgentPhase.EXECUTION,
                settings.maxNoToolTurns,
                {
                    hasPhaseProgress: guardState.successfulToolResultsInPhase > 0,
                    hasAssistantOutput: currentResponse.trim().length > 0
                }
            );

            const noToolStopLimit = executionFlow === 'normal'
                ? maxNoToolTurns
                : Math.max(maxNoToolTurns, 3);
            if (queryState.noToolTurns >= noToolStopLimit) {
                const stopMessage = this.buildNoProgressStopMessage(queryState.noToolTurns, 'the provider returned neither an executable tool call nor a final assistant answer');
                yield { type: 'chat_text', content: stopMessage, kind: 'model_terminated_pause' };
                activeThreadService.addMessage('assistant', stopMessage);
                activeTaskSessionService.recordAssistantSummary(stopMessage);
                return;
            }

            // A turn that serialized tool syntax into text is a specific failure
            // with a specific correction — the generic "return tool calls"
            // nudge leaves the model believing its call ran.
            const noToolPrompt = detectSerializedToolCallSyntax(currentResponse)
                ? buildSerializedToolCallRecoveryPrompt()
                : this.buildNoToolRecoveryPrompt(guardState.successfulToolResultsInPhase > 0);
            messages.push({ role: 'assistant', content: assistantMemoryContent() });
            messages.push({ role: 'system', content: noToolPrompt });
            activeThreadService.addMessage('assistant', assistantMemoryContent(), true);
            activeThreadService.addMessage('system', noToolPrompt, true);
            queryState.turnCount++;
            continue;
        }
    }

    private shouldPauseForQuestionResult(
        toolName: string | undefined,
        result: any,
        inputSummary: unknown,
        activeTaskSessionService: CleanSlateTaskSessionService
    ): boolean {
        if (toolName !== this.profile.questionTool || result?.success === false || !result?.planning_question) {
            return false;
        }
        const summary = typeof result?.summary === 'string' && result.summary.trim().length > 0
            ? result.summary.trim()
            : typeof inputSummary === 'string' && inputSummary.trim().length > 0
                ? inputSummary.trim()
                : undefined;
        activeTaskSessionService.recordAssistantSummary(summary);
        return true;
    }

	private pauseForQuestion(
		toolCall: ParsedToolCall,
		result: unknown,
		activeTaskSessionService: CleanSlateTaskSessionService
	): boolean {
		if (!this.shouldPauseForQuestionResult(toolCall.toolName, result, toolCall.input?.summary, activeTaskSessionService)) {
			return false;
		}
		this.options.onQuestionPaused?.(toolCall, result);
		return true;
	}

    private async waitForNextModelTurn(signal?: AbortSignal, executionFlow?: CleanSlateExecutionFlow): Promise<void> {
        const now = Date.now();
        if (this.lastModelTurnStartedAt === undefined) {
            this.lastModelTurnStartedAt = now;
            return;
        }
        const elapsedMs = now - this.lastModelTurnStartedAt;
        const intervalMs = executionFlow === 'normal'
            ? CleanSlateExecutionQueryEngine.NORMAL_MODEL_TURN_INTERVAL_MS
            : executionFlow === 'planning'
                ? CleanSlateExecutionQueryEngine.PLANNING_MODEL_TURN_INTERVAL_MS
            : CleanSlateExecutionQueryEngine.DEFAULT_MODEL_TURN_INTERVAL_MS;
        const waitMs = Math.max(0, intervalMs - elapsedMs);
        if (waitMs > 0) {
            await this.delay(waitMs, signal);
        }
        this.lastModelTurnStartedAt = Date.now();
    }

    private recordModelTurnCompleted(): void {
        // The native loop only needs a cadence boundary; waitForNextModelTurn tracks starts.
    }

	private async compactMessagesBeforeProviderCall(
		messages: IChatMessage[],
		visibleTurnIndex: number,
		logLabel: string,
		promptOverheadChars: number,
		signal?: AbortSignal
	): Promise<boolean> {
        const thresholdChars = this.getConversationMessageThresholdChars(promptOverheadChars);
        if (!this.contextBudgetManager.shouldCompactMessages(messages, thresholdChars)) {
            return false;
        }

		const keepStart = this.getCompactionKeepStart(messages);
		if (keepStart <= 2) {
            return false;
        }

		const beforeChars = this.contextBudgetManager.getMessagesCharCount(messages);
		const compactedHistory = messages.slice(1, keepStart);
		const previousSummary = compactedHistory.find(message => this.isCompactionSummaryMessage(message));
		const preservedUserMessages = compactedHistory.filter(message => message.role === 'user');
		const summaryPrompt: IChatMessage[] = [
			{
				role: 'system',
				content: [
					previousSummary
						? 'Update the prior continuation summary with the newer conversation history.'
						: 'Create a continuation summary for the older portion of this coding-agent conversation.',
					'Use exactly these terse Markdown sections: Goal; Constraints & Preferences; Progress (Done, In Progress, Blocked); Key Decisions; Next Steps; Critical Context; Relevant Files.',
					'Preserve exact file paths, symbols, commands, error strings, edits, test outcomes, unresolved work, and unanswered user questions. Do not invent facts.',
					'Completed tool calls already ran. Record their durable outcomes so the agent does not repeat work blindly.',
					previousSummary ? `Prior summary to update:\n${this.messageContentToText(previousSummary)}` : ''
				].join('\n')
			},
			...compactedHistory.filter(message => !this.isCompactionSummaryMessage(message))
		];
		const summaryBudget = Math.max(12_000, thresholdChars);
		const projected = this.contextBudgetManager.projectMessagesForProvider(summaryPrompt, summaryBudget).messages;

		try {
			const response = await this.options.cleanSlateService.chat(projected, {
				cancellationToken: cancellationTokenFromAbortSignal(signal),
				maxOutputTokens: CleanSlateExecutionQueryEngine.COMPACTION_MAX_OUTPUT_TOKENS
			});
			let summary = '';
			for await (const part of response) {
				if (part.type === 'text') {
					summary += part.content;
				}
			}
			const normalizedSummary = summary.trim();
			if (!normalizedSummary || signal?.aborted) {
				if (!signal?.aborted) {
					this.consecutiveCompactionFailures++;
				}
				return false;
			}
			// Replacement-history behavior: keep actual user turns intact and
			// replace only older model/tool transcript with one summary.
			// Recent messages (including the latest tool groups) remain untouched.
			messages.splice(
				1,
				keepStart - 1,
				...preservedUserMessages,
				{
					role: 'system',
					content: `[COMPACTED CONVERSATION SUMMARY]\n${normalizedSummary}`
				}
			);
			this.consecutiveCompactionFailures = 0;
			const afterChars = this.contextBudgetManager.getMessagesCharCount(messages);
			this.lastSuccessfulCompactionChars = afterChars;
			console.info(`[CleanSlateAgent] [${logLabel}] Model-compacted conversation before turn ${visibleTurnIndex}: ${beforeChars} -> ${afterChars} chars; threshold=${thresholdChars}.`);
			return true;
		} catch (error) {
			this.consecutiveCompactionFailures++;
			if (!signal?.aborted) {
				console.warn('[CleanSlateAgent] Conversation compaction failed; using a non-mutating provider projection for this turn.', error);
			}
			return false;
		}
    }

	private shouldAttemptConversationCompaction(messages: readonly IChatMessage[], promptOverheadChars: number): boolean {
		if (this.consecutiveCompactionFailures >= CleanSlateExecutionQueryEngine.MAX_CONSECUTIVE_COMPACTION_FAILURES) {
			return false;
		}
		const currentChars = this.contextBudgetManager.getMessagesCharCount(messages);
		if (this.lastSuccessfulCompactionChars !== undefined
			&& currentChars < Math.ceil(this.lastSuccessfulCompactionChars * CleanSlateExecutionQueryEngine.AUTO_COMPACTION_REGROWTH_RATIO)) {
			return false;
		}
		return this.contextBudgetManager.shouldCompactMessages(
			messages,
			this.getConversationMessageThresholdChars(promptOverheadChars)
		) && this.getCompactionKeepStart(messages) > 2;
	}

	private getConversationMessageThresholdChars(promptOverheadChars: number): number {
		return Math.max(
			12_000,
			this.options.parsingSupport.getExecutionAutoCompactThresholdChars() - Math.max(0, promptOverheadChars)
		);
	}

	private isCompactionSummaryMessage(message: IChatMessage): boolean {
		return message.role === 'system'
			&& this.messageContentToText(message).startsWith('[COMPACTED CONVERSATION SUMMARY]');
	}

	private messageContentToText(message: IChatMessage): string {
		return typeof message.content === 'string'
			? message.content
			: message.content.map(part => part.type === 'text' ? part.text ?? '' : '').join('\n');
	}

	private getCompactionKeepStart(messages: readonly IChatMessage[]): number {
		let keepStart = Math.max(1, messages.length - 18);
		while (keepStart > 1 && messages[keepStart]?.role === 'tool') {
			keepStart--;
		}
		return keepStart;
	}

    private buildMessagesForProvider(messages: IChatMessage[], visibleTurnIndex: number, logLabel: string, promptOverheadChars: number): IChatMessage[] {
        const budgetChars = Math.max(12_000, this.options.parsingSupport.getExecutionContextBudgetChars() - Math.max(0, promptOverheadChars));
        const projection = this.contextBudgetManager.projectMessagesForProvider(messages, budgetChars);
        if (projection.result.compacted) {
            console.debug(`[CleanSlateAgent] [${logLabel}] Context budget projected for turn ${visibleTurnIndex}: ${projection.result.beforeChars} -> ${projection.result.afterChars} chars; clampedToolResults=${projection.result.clampedToolResults}; clampedAssistantTurns=${projection.result.clampedAssistantTurns}; droppedTool=${projection.result.droppedToolMessages}; droppedSystem=${projection.result.droppedSystemMessages}; droppedHistory=${projection.result.droppedHistoryMessages}`);
        }
        return projection.messages;
    }

    private getEstimatedContextUsage(messages: readonly IChatMessage[], promptOverheadChars: number): { estimatedInputTokens: number; contextWindowTokens: number; autoCompactThresholdTokens: number; percentage: number } {
        const estimatedInputTokens = Math.ceil((this.contextBudgetManager.getMessagesCharCount(messages) + Math.max(0, promptOverheadChars)) / 4);
        const contextWindowTokens = Math.max(1, Math.floor(this.options.parsingSupport.getExecutionContextBudgetChars() / 4));
        const autoCompactThresholdTokens = Math.max(1, Math.floor(this.options.parsingSupport.getExecutionAutoCompactThresholdChars() / 4));
        return {
            estimatedInputTokens,
            contextWindowTokens,
            autoCompactThresholdTokens,
            percentage: Math.min(100, Math.round((estimatedInputTokens / contextWindowTokens) * 100))
        };
    }

    private getToolDefinitionChars(tools: readonly IChatToolDefinition[]): number {
        try {
            return JSON.stringify(tools).length;
        } catch {
            return 0;
        }
    }

    private shouldRefreshContextForTurn(visibleTurnIndex: number): boolean {
        return visibleTurnIndex <= 1;
    }

    private async prepareContext({
        messages,
        objective,
        mode,
        planMode,
        initialContext,
        mentionedFiles,
        deferredSemanticContext,
        signal
    }: {
        messages: IChatMessage[];
        objective: string;
        mode: string;
        planMode?: boolean;
        initialContext: any;
        mentionedFiles: string;
        deferredSemanticContext?: ICleanSlateDeferredContext;
		signal?: AbortSignal;
    }): Promise<void> {
        const freshContext = await this.options.cleanSlateContextService.getContext();
        const promptContext = await (this.options.buildPromptContextForMode
            ? this.options.buildPromptContextForMode(freshContext, mode, signal)
            : this.options.buildPromptContext(freshContext, signal));
		void initialContext;
        const systemDirective = planMode
            ? this.buildPlanModeDirective()
			: this.buildSystemDirective();
		if (systemDirective.trim().length > 0) {
			messages.push({ role: 'system', content: systemDirective.trim() });
		}
        // Consume the warmed semantic retrieval only if it has already settled by
        // this point (just before the model call) — never block the turn on it.
        // If it isn't ready, the model retrieves via the semantic_search tool.
        const semanticContext = deferredSemanticContext?.tryConsume() ?? '';
        this.refreshContextMessage(messages, promptContext, `${semanticContext}${mentionedFiles}`, objective);
    }

    private buildPlanModeDirective(): string {
        return [
            '',
            '',
            'PLAN MODE:',
            'You are in plan mode. Your tools are read-only: research the workspace, read the relevant code, and design the change. You cannot edit files or run commands in this mode.',
			'Investigate with concrete read/search tool calls. Use assistant text only when you need a user decision or when presenting the completed plan.',
            'When an implementation plan is ready, call submit_artifact with the concise final plan only so it can be reviewed. The artifact is not a research log: omit deliberation, progress narration, files-inspected inventories, and repeated repo facts.',
            'Prefer a clear title plus 3-5 compact sections: Summary, grouped Implementation Changes, Test Plan, and Assumptions only when meaningful. Keep bullets short, avoid unnecessary nesting, and keep straightforward plans under roughly 40 lines.',
            'Group by behavior or subsystem instead of exhaustive file-by-file notes. Mention exact paths only where they prevent ambiguity, normally no more than three unless the task genuinely requires more.',
            'For an informational request, answer in normal assistant text and stop.',
            'If a decision genuinely belongs to the user (competing approaches with real trade-offs, missing requirements), call ask_question. If you simply need to say something to the user, write it as assistant text and stop — the turn ends and the user replies.',
            'Match the plan to the request: for changes to an existing codebase, name the exact files and changes discovered through research; for a greenfield/empty workspace, a scaffold-first plan is correct; for a broad request, scope it explicitly or ask.'
        ].join('\n');
    }

    private buildSystemDirective(): string {
        const cliPolicy = [
            'VERIFICATION POLICY:',
			'Use host diagnostics after edits. When diagnostics do not prove the requested behavior, run a finite, scoped execute_command with an accurate intent and writesToWorkspace value.',
            'Prefer targeted tests or builds over broad project commands. Recover from a failed verification when useful, otherwise report it truthfully; partial output is not proof.',
			'Do not create walkthrough artifacts as a completion ritual. When the work is complete, write the visible final answer as normal assistant text and stop without calling a completion tool.'
        ].join('\n');

        return [
            '',
            '',
            'WEB RETRIEVAL RULE:',
            'Use web_search for internet discovery and web_fetch for specific URLs. Cite returned source URLs when relying on web evidence; do not use browser_* tools as a search-engine substitute.',
            'For explicit web research/current-information requests, do not answer from search snippets alone. Fetch the most relevant reliable result pages first, then synthesize the fetched evidence into the visible answer with citations.',
            'WEB ANSWER QUALITY:',
            getWebResearchFinalAnswerPrompt(),
            'BROWSER TOOL OPT-IN:',
            'Use browser_* tools only when the current user request explicitly asks you to open a browser, preview a page, inspect DOM, capture screenshots, or perform visual/browser verification.',
            'Do not open localhost, collect browser evidence, or require browser verification only because UI files changed.',
            'When browser verification was not explicitly requested, rely on code inspection, diagnostics, tests, and concise completion reporting instead.',
            'When browser work is requested, operate the one bound live browser session: observe with browser_snapshot, choose a unique semantic locator, act, then observe the resulting URL/DOM/screenshot or diagnostics. Prefer role/name, label, placeholder, text, or testId over coordinates; use coordinates only as a visual fallback.',
            'browser_snapshot is semantic DOM text, not an image. When the user asks to inspect, test, preview, or visually verify a site, call browser_screenshot on the key page states; do not claim visual inspection from browser_snapshot alone.',
            'The visible mouse belongs only to real pointer actions such as browser_click, browser_hover, and browser_scroll. Direct navigation, DOM snapshots, and screenshots must not fabricate mouse movement.',
            'Do not reuse an elementId after navigation or material DOM change. Take a new snapshot and recover from strict-locator ambiguity by choosing a more specific locator instead of guessing.',
            cliPolicy,
			'COMPLETION CONTRACT:',
			'Continue while tool calls are needed. When no more tool calls are needed, return one non-empty user-facing final assistant answer. The host emits task completion only after that natural assistant stop; reasoning, progress narration, mutations, and command output are not completion signals.'
        ].join('\n');
    }

    private parseAssistantTurn(rawResponse: string): { toolCalls: ParsedToolCall[]; toDoList: string[] } {
        void rawResponse;
        return {
            toolCalls: [],
            toDoList: []
        };
    }

    /**
     * Detects arguments that must not execute: the transport's JSON parse
     * failure marker, or serialized tool-call debris that a degenerate model
     * merged into locator argument values. Content-bearing fields (file
     * content, edit text, commands) are deliberately NOT scanned — they can
     * legitimately contain these tokens when the user's code mentions them.
     */
    private getMalformedToolArgumentsError(toolCall: ParsedToolCall): string | undefined {
        const input = toolCall.input;
        if (!input || typeof input !== 'object') {
            return undefined;
        }
        if (typeof input.__cleanSlateArgumentsParseError === 'string') {
            return input.__cleanSlateArgumentsParseError;
        }

        const locatorValues: string[] = [];
        for (const field of ['path', 'file_path', 'pattern', 'query', 'symbol', 'directory']) {
            if (typeof input[field] === 'string') {
                locatorValues.push(input[field]);
            }
        }
        if (Array.isArray(input.paths)) {
            for (const entry of input.paths) {
                if (typeof entry === 'string') {
                    locatorValues.push(entry);
                }
            }
        }
        for (const value of locatorValues) {
            if (detectSerializedToolCallSyntax(value)) {
                return `failed to parse function arguments: a locator argument contains serialized tool-call syntax ("${value.slice(0, 120)}").`;
            }
        }
        return undefined;
    }

    private parseStreamedToolCall(call: { id?: string; toolName?: string; input?: any } | undefined, toolCallLedger: CleanSlateToolCallLedger): ParsedToolCall | undefined {
        const toolCall = this.nativeToolTranscript.parseToolCall(call);
        return toolCall ? toolCallLedger.normalizeToolCall(toolCall) : undefined;
    }

    private mergeToolCalls(parsedToolCalls: ParsedToolCall[], streamedToolCalls: ParsedToolCall[]): ParsedToolCall[] {
        void parsedToolCalls;
        const seen = new Set<string>();
        const merged: ParsedToolCall[] = [];
        for (const toolCall of streamedToolCalls) {
            const key = this.getToolCallKey(toolCall);
            if (!seen.has(key)) {
                seen.add(key);
                merged.push(toolCall);
            }
        }
        return merged;
    }

    private async * executeToolWithTracking(
        toolName: string,
        input: any,
        { signal, toolCallId }: { signal?: AbortSignal; toolCallId?: string } = {}
    ): AsyncIterable<CleanSlateStreamPart> {
        for await (const part of this.options.executeTool(toolName, input, toolCallId, signal)) {
            if (signal?.aborted) {
                break;
            }
            if (part.type === 'tool_result' && this.options.executionSupport.didToolSucceed(part.result)) {
                try {
                    this.options.recordSemanticToolResult?.(toolName, input, part.result);
                } catch (error) {
                    console.warn('[CleanSlateAgent] Semantic graph ingestion failed:', error);
                }
            }
            yield part;
        }
    }

    private getNoProgressTurnLimit(
        _phase: AgentPhase,
        configuredMaxNoToolTurns: number,
        options: { hasPhaseProgress?: boolean; hasAssistantOutput?: boolean } = {}
    ): number {
        const configuredLimit = Number.isFinite(configuredMaxNoToolTurns)
            ? Math.max(1, Math.floor(configuredMaxNoToolTurns))
            : 4;
        const floor = options.hasPhaseProgress
            ? (options.hasAssistantOutput ? 8 : 6)
            : (options.hasAssistantOutput ? 6 : 4);
        return Math.min(Math.max(configuredLimit, floor), 12);
    }

    private refreshContextMessage(messages: IChatMessage[], promptContext: string, mentionedFiles: string, objective: string): void {
		messages.push({
			role: 'system',
			content: `[RUNTIME CONTEXT REMINDER]\n${promptContext}${mentionedFiles}\n\nCurrent objective: ${objective}`
		});
    }

    private getNativeToolDefinitions(): IChatToolDefinition[] {
		return (this.options.getTools?.() ?? ALL_TOOLS).map(tool => ({
            name: tool.name,
            description: tool.description,
            parametersSchema: tool.parametersSchema || { type: 'object', properties: {} }
        }));
    }

    private refreshFileReadBudget(messages: IChatMessage[], tools: IChatToolDefinition[]): void {
        const config = this.options.toolContext.configService.getConfiguration();
        const contextWindowTokens = Math.max(1, Math.floor(
            config.contextWindow
            ?? config.maxInputTokens
            ?? CLEANSLATE_FALLBACK_CONTEXT_WINDOW_TOKENS
        ));
        // Provider tokenizers are not uniformly available. UTF-8 bytes / 3 is
        // deliberately conservative for source code and works across models.
        const estimatedPromptTokens = estimateCleanSlateFileReadTokens(JSON.stringify({ messages, tools }) ?? '');
        this.options.toolContext.fileReadBudget = {
            contextWindowTokens,
            availableInputTokens: Math.max(1, contextWindowTokens - estimatedPromptTokens)
        };
    }

	private getNativeToolDefinitionsForTurn(nativeTools: IChatToolDefinition[], queryState: IExecutionQueryState): IChatToolDefinition[] {
		if (!queryState.planMode) {
			// The loop stops when an assistant turn contains no tool calls, and
			// task-finished is emitted host-side. No model-facing completion
			// tool is exposed, so normal mode receives every enabled tool.
			return nativeTools;
		}
		return nativeTools.filter(tool => this.profile.planModeTools.has(tool.name));
    }

    private isParallelToolCall(toolCall: ParsedToolCall): boolean {
        return this.options.getToolCategory(toolCall.toolName) === 'discovery'
            || this.profile.parallelSafeTools.has(toolCall.toolName);
    }

    private async * streamToolExecutionParts(
        toolCall: ParsedToolCall,
        signal: AbortSignal | undefined,
        queryState: IExecutionQueryState,
        guardState: IExecutionGuardState,
		executionFlow: CleanSlateExecutionFlow,
        toolCallLedger: CleanSlateToolCallLedger,
		activeTaskSessionService: CleanSlateTaskSessionService
    ): AsyncIterable<CleanSlateStreamPart> {
        // A tool call with unparseable or corrupted arguments is answered with
        // the parse error, never executed. This catches both the
        // transport-level JSON parse failure marker and serialized-call debris
        // that leaked into locator argument values (the A/B run executed
        // find_by_name with "to=multi_tool_use.parallel..." merged into path).
        const malformedArgumentsError = this.getMalformedToolArgumentsError(toolCall);
        if (malformedArgumentsError) {
            const result = {
                success: false,
                code: 'malformed_tool_arguments',
                message: malformedArgumentsError,
                recoveryHint: 'Re-issue this as a single native tool call with valid JSON arguments. Never serialize tool syntax (to=functions.*, multi_tool_use.parallel) into text or argument values.'
            };
            toolCallLedger.recordResult(toolCall, result);
            yield this.nativeToolTranscript.attachToolCallId({
                type: 'tool_result',
                toolName: toolCall.toolName,
                result
            }, toolCall.id);
            return;
        }

        // Plan-mode write barrier. The provider
        // only sees the read-only tool list, but tool calls parsed from text
        // bypass that filter — this is the hard guarantee that plan mode
        // cannot mutate the workspace or run commands.
        if (queryState.planMode && !this.profile.planModeTools.has(toolCall.toolName)) {
            const result = {
                success: false,
                code: 'plan_mode_tool_blocked',
                message: `Tool "${toolCall.toolName}" is not available in plan mode.`,
                recoveryHint: 'Plan mode is read-only: research with discovery tools, ask_question for decisions you cannot make, and submit the plan with submit_artifact when it is ready. Implementation happens after the user approves the plan.'
            };
            toolCallLedger.recordResult(toolCall, result);
            yield this.nativeToolTranscript.attachToolCallId({
                type: 'tool_result',
                toolName: toolCall.toolName,
                result
            }, toolCall.id);
            return;
        }

        const decision = toolCallLedger.prepareForExecution(toolCall);
        toolCall = decision.toolCall;
        if (!decision.accepted) {
            const result = decision.result ?? {
                success: false,
                code: 'tool_call_rejected',
                message: `Tool call "${toolCall.toolName}" was rejected by the execution ledger.`
            };
            toolCallLedger.recordResult(toolCall, result);
            const recoveryPrompt = this.editPolicy.buildFailedEditRecoveryPrompt(toolCall, result);
            if (recoveryPrompt) {
                this.appendPendingRecoveryPrompt(queryState, recoveryPrompt);
            }
            yield this.nativeToolTranscript.attachToolCallId({
                type: 'tool_result',
                toolName: toolCall.toolName,
                result
            }, toolCall.id);
            return;
        }

        if (toolCall.toolName === this.profile.primaryCommandTool) {
			const commandPolicy = evaluateExecutionCommandPolicy(toolCall.input);
            if (!commandPolicy.allowed) {
                const result = {
                    success: false,
                    code: commandPolicy.code,
                    message: commandPolicy.message,
                    recoveryHint: commandPolicy.recoveryHint
                };
                toolCallLedger.recordResult(toolCall, result);
                yield this.nativeToolTranscript.attachToolCallId({
                    type: 'tool_result',
                    toolName: toolCall.toolName,
                    result
                }, toolCall.id);
                return;
            }
        }

        if (queryState.pendingRecoveryPrompt
            && this.profile.structuredEditTools.has(toolCall.toolName)
            && this.editPolicy.countStructuredEdits(toolCall) !== 1) {
            const result = {
                success: false,
                code: 'recovery_requires_single_edit',
                message: 'A failed edit recovery is pending. Retry exactly one failed edit instead of resubmitting a batch.',
                recoveryHint: queryState.pendingRecoveryPrompt
            };
            toolCallLedger.recordResult(toolCall, result);
            yield this.nativeToolTranscript.attachToolCallId({
                type: 'tool_result',
                toolName: toolCall.toolName,
                result
            }, toolCall.id);
            return;
        }

        const executableToolCall = this.editPolicy.withScopedReadLintsInput(toolCall, guardState);
        let lastToolResult: any;
        for await (const part of this.executeToolWithTracking(
            executableToolCall.toolName,
            executableToolCall.input,
            { signal, toolCallId: executableToolCall.id }
        )) {
            if (part.type === 'tool_result') {
                lastToolResult = part.result;
                toolCallLedger.recordResult(executableToolCall, part.result);
                this.recordToolResultForGuardrails(executableToolCall, part.result, guardState);
                const recoveryPrompt = this.editPolicy.buildFailedEditRecoveryPrompt(executableToolCall, part.result);
                if (recoveryPrompt) {
                    this.appendPendingRecoveryPrompt(queryState, recoveryPrompt);
                }
            }
            yield this.nativeToolTranscript.attachToolCallId(part, executableToolCall.id);
        }

        if (queryState.planMode && executableToolCall.toolName === this.profile.completionTool) {
            const conclusion = this.resolvePlanModeConclusion(executableToolCall, lastToolResult, activeTaskSessionService);
            if (conclusion) {
                yield conclusion;
            }
        }
    }

    /**
     * Plan-mode ExitPlanMode analog: a successful submit_artifact concludes
     * the plan-mode run. An implementation plan pauses the task for user
     * approval; an explicitly requested analysis artifact finishes it.
     */
    private resolvePlanModeConclusion(
        toolCall: ParsedToolCall,
        result: any,
        activeTaskSessionService: CleanSlateTaskSessionService
    ): CleanSlateStreamPart | undefined {
        if (result?.success === false) {
            return undefined;
        }

        const inputType = typeof toolCall.input?.type === 'string' ? toolCall.input.type : '';
        const artifactType = typeof toolCall.input?.artifactType === 'string' ? toolCall.input.artifactType : '';
        const inputPath = typeof toolCall.input?.path === 'string' ? toolCall.input.path : '';
        const resultPath = typeof result?.path === 'string' ? result.path : '';
        const artifactPath = inputPath || resultPath;
        const normalizedArtifactPath = artifactPath.toLowerCase();
        const hasSubmittedContent = typeof toolCall.input?.content === 'string' && toolCall.input.content.trim().length > 0;
        const isAnalysisArtifact = inputType === 'analysis'
            || artifactType === 'analysis'
            || normalizedArtifactPath.includes('analysis');
        const isImplementationPlanArtifact = inputType === 'implementation_plan'
            || artifactType === 'implementation_plan'
            || normalizedArtifactPath.includes('implementation_plan')
            || (hasSubmittedContent && !isAnalysisArtifact);

        if (isImplementationPlanArtifact) {
            activeTaskSessionService.markAwaitingApproval();
            return {
                type: 'tool_result',
                toolName: PHASE_CONCLUSION_SIGNAL_PLAN_CREATED,
                result: {
                    planCreated: true,
                    artifactPath: artifactPath || 'implementation_plan.md',
                    summary: typeof result?.summary === 'string' ? result.summary : 'Planning artifact submitted.'
                }
            };
        }

        if (isAnalysisArtifact) {
            activeTaskSessionService.setAwaitingApproval(false);
            const summary = typeof result?.summary === 'string' && result.summary.trim().length > 0
                ? result.summary.trim()
                : 'Analysis report submitted.';
            return {
                type: 'task_complete',
                result: {
                    phase: AgentPhase.PLANNING,
                    analysisSubmitted: true,
                    artifactPath: artifactPath || 'analysis.md',
                    completionSummary: {
                        status: 'completed_analysis',
                        summary
                    }
                }
            };
        }

        return undefined;
    }

    private async * streamPostMutationVerificationParts(
        signal: AbortSignal | undefined,
        guardState: IExecutionGuardState
    ): AsyncGenerator<CleanSlateStreamPart, { result?: any; issues: string[] }, unknown> {
        const scopedPaths = Array.from(guardState.pendingVerificationPaths.size > 0
            ? guardState.pendingVerificationPaths
            : guardState.mutatedPaths.size > 0
                ? guardState.mutatedPaths
                : guardState.touchedPaths);
        if (scopedPaths.length === 0) {
            return { issues: [] };
        }

        const input = { paths: scopedPaths };
        let lastResult: any;
        for await (const part of this.executeToolWithTracking(
            this.verificationToolName,
            input,
            { signal }
        )) {
            if (part.type === 'tool_result') {
                lastResult = part.result;
                this.recordToolResultForGuardrails(
                    { toolName: this.verificationToolName, input },
                    part.result,
                    guardState
                );
            }
            yield part;
        }

        const markerIssues = await this.options.executionSupport.collectNewMarkerIssues(
            guardState.markerBaseline,
            new Set(scopedPaths),
            guardState.failOnWarnings,
            40
        );
        const lintIssueCount = this.countLintIssues(lastResult);
        if (markerIssues.length === 0 && lastResult?.success !== false) {
            guardState.pendingVerificationPaths.clear();
        }
        guardState.verificationSummaries.push({
            toolName: this.verificationToolName,
            paths: scopedPaths,
            passed: markerIssues.length === 0 && lastResult?.success !== false,
            lintIssueCount,
            markerIssueCount: markerIssues.length,
            message: typeof lastResult?.message === 'string' ? lastResult.message : undefined
        });

        return { result: lastResult, issues: markerIssues };
    }

    private buildPostMutationVerificationPrompt(issues: string[]): string {
        return [
            'POST-MUTATION VERIFICATION FAILED: the last edit changed the workspace but diagnostics are still present.',
            ...issues.map(issue => `- ${issue}`),
            'Fix these issues before returning the final answer. Use read_file_range/read_lints and small targeted edits.'
        ].join('\n');
    }

    private buildVerifiedFinishPrompt(guardState: IExecutionGuardState): string {
        const targetCount = guardState.mutatedPaths.size || guardState.touchedPaths.size;
        return [
            'EXECUTION VERIFICATION COMPLETE: post-mutation verification passed.',
            `Verified target files: ${targetCount}.`,
            'Do not stop merely because this one edit verified.',
			'If the full user request is implemented, write the visible final answer as normal assistant text and stop without a completion tool.',
            'If any planned work remains, continue with concrete tool_calls only.'
        ].join('\n');
    }

	private async canHostFinalizeProseStop(
		currentResponse: string,
		queryState: IExecutionQueryState,
		guardState: IExecutionGuardState
	): Promise<boolean> {
		if (queryState.pendingRecoveryPrompt) {
			return false;
		}

		// A reasoning-only or empty provider stop is not completion. Refs emit
		// their task-finished lifecycle only after a non-empty assistant answer.
		if (this.normalizeCompletionSummary(currentResponse) === undefined) {
			return false;
		}

		if (guardState.pendingVerificationPaths.size > 0
			|| guardState.postEditCommandIssues.length > 0
			|| this.getUnresolvedFailedGoalCommand(guardState)
			|| this.hasFailedUserRequestedOrVerificationCommand(guardState)) {
			return false;
		}

		if (guardState.mutatedPaths.size > 0 && !guardState.postEditCommandVerified) {
			return false;
		}

		const finalVerificationScope = guardState.mutatedPaths.size > 0
			? guardState.mutatedPaths
			: guardState.touchedPaths;
		if (finalVerificationScope.size > 0) {
			const markerIssues = await this.options.executionSupport.collectNewMarkerIssues(
				guardState.markerBaseline,
				finalVerificationScope,
				guardState.failOnWarnings,
				40
			);
			if (markerIssues.length > 0) {
				return false;
			}
		}

		return true;
	}

	private hasFailedUserRequestedOrVerificationCommand(guardState: IExecutionGuardState): boolean {
		return guardState.terminalSummaries.some(summary =>
			summary.toolName === this.profile.primaryCommandTool
			&& summary.success === false
			&& (summary.intent === 'verification' || summary.intent === 'user_requested')
		);
	}

	private isToolCallLoopResult(result: any): boolean {
		return result?.code === 'tool_call_loop_detected';
	}

	private buildCompletionState(guardState: IExecutionGuardState, finalAnswer: string, plannedFileTargets?: readonly string[]): ICleanSlateExecutionQueryCompletionState {
        const proofSummaries = this.buildHostProofSummaries(guardState);
		return {
			touchedPaths: Array.from(guardState.touchedPaths),
            mutatedPaths: Array.from(guardState.mutatedPaths),
            mutationSummaries: guardState.mutationSummaries,
            terminalSummaries: guardState.terminalSummaries.slice(-4),
            proofSummaries,
            completionSource: 'host_finalized',
            verificationIssueCount: guardState.verificationSummaries.reduce((sum, summary) => sum + summary.markerIssueCount, 0),
            successfulMutationsInPhase: guardState.successfulMutationsInPhase,
            summary: this.normalizeCompletionSummary(finalAnswer),
            ...(plannedFileTargets?.length ? {
                plannedFileTargets: [...plannedFileTargets],
                unmutatedPlannedFiles: this.getUnmutatedPlannedFiles(plannedFileTargets, guardState.mutatedPaths)
            } : {})
        };
    }

    /**
     * File targets named by the approved implementation plan handed off to this
     * run. Used as audit evidence so plan-to-execution fidelity is judged (and
     * deviations must be disclosed) instead of silently forgotten.
     */
    private extractPlannedFileTargets(messages: readonly IChatMessage[]): string[] {
        for (const message of messages) {
            const text = typeof message.content === 'string' ? message.content : '';
            if (!text.includes('[APPROVED IMPLEMENTATION PLAN]')) {
                continue;
            }
            const targets = extractPlanFileEntries(text)
                .filter(entry => typeof entry.target === 'string' && entry.target.length > 0)
                .map(entry => planEntryTargetToPath(entry.target!).replace(/\\/g, '/'));
            return Array.from(new Set(targets)).slice(0, 24);
        }
        return [];
    }

    private getUnmutatedPlannedFiles(plannedFileTargets: readonly string[], mutatedPaths: ReadonlySet<string>): string[] {
        const mutatedBasenames = new Set(
            Array.from(mutatedPaths).map(path => path.replace(/\\/g, '/').toLowerCase().split('/').pop() ?? '')
        );
        return plannedFileTargets.filter(target => {
            const basename = target.toLowerCase().split('/').pop() ?? target.toLowerCase();
            return !mutatedBasenames.has(basename);
        });
    }

    private buildHostProofSummaries(guardState: IExecutionGuardState): string[] {
        const proofSummaries: string[] = [];
        for (const summary of guardState.verificationSummaries.slice(-4)) {
            const status = summary.passed ? 'passed' : 'failed';
            const paths = summary.paths.length > 0 ? ` for ${summary.paths.join(', ')}` : '';
            proofSummaries.push(`${summary.toolName} ${status}${paths}`);
        }
        for (const summary of guardState.terminalSummaries.slice(-4)) {
            if (summary.success !== true) {
                continue;
            }
            const command = summary.command ? `"${summary.command}"` : (this.profile.primaryCommandTool ?? 'the command');
            const intent = summary.intent ? ` (${summary.intent})` : '';
            proofSummaries.push(`${command} succeeded${intent}`);
        }
        return Array.from(new Set(proofSummaries));
    }

    private normalizeCompletionSummary(summary: unknown): string | undefined {
        if (typeof summary !== 'string') {
            return undefined;
        }

        const trimmed = summary.trim();
        if (!trimmed) {
            return undefined;
        }

        return trimmed.length > 4000 ? trimmed.slice(0, 4000) : trimmed;
    }

    private getToolCallKey(toolCall: ParsedToolCall): string {
        return this.nativeToolTranscript.getToolCallKey(toolCall);
    }

    private shouldVerifyAfterToolResult(toolCall: ParsedToolCall, result: any): boolean {
        return this.options.executionSupport.isConfirmedMutationResult(toolCall.toolName, toolCall.input, result)
            || this.editPolicy.isSettledEditNoOp(toolCall, result);
    }

    private buildMutationSummary(toolCall: ParsedToolCall, result: any, mutationPaths: string[], turnIndex?: number): IExecutionMutationSummary {
        return {
            toolName: toolCall.toolName,
            turnIndex,
            paths: mutationPaths.length > 0 ? mutationPaths : this.editPolicy.collectMutationPaths(toolCall, result),
            fileChanges: this.filesModifiedService.buildMutationFileChanges(toolCall.toolName, toolCall.input, result),
            appliedBlocks: this.firstNumericValue(result?.appliedBlocks, result?.totalAppliedBlocks, this.sumResultField(result, 'appliedBlocks')),
            added: this.firstNumericValue(result?.added, this.sumResultField(result, 'added')),
            deleted: this.firstNumericValue(result?.deleted, this.sumResultField(result, 'deleted')),
            totalLinesChanged: this.firstNumericValue(result?.totalLinesChanged, this.sumResultField(result, 'totalLinesChanged')),
            diagnosticsCount: this.countEditDiagnostics(result),
            strategies: this.collectStrategies(result),
            message: typeof result?.message === 'string' ? result.message : undefined
        };
    }

    private firstNumericValue(...values: unknown[]): number | undefined {
        for (const value of values) {
            if (typeof value === 'number' && Number.isFinite(value)) {
                return value;
            }
        }
        return undefined;
    }

    private sumResultField(result: any, field: 'appliedBlocks' | 'added' | 'deleted' | 'totalLinesChanged'): number | undefined {
        if (!Array.isArray(result?.results)) {
            return undefined;
        }

        let sum = 0;
        let found = false;
        for (const entry of result.results) {
            const value = entry?.[field];
            if (typeof value === 'number' && Number.isFinite(value)) {
                sum += value;
                found = true;
            }
        }
        return found ? sum : undefined;
    }

    private countEditDiagnostics(result: any): number {
        let count = 0;
        const countArray = (candidate: unknown) => {
            if (Array.isArray(candidate)) {
                count += candidate.length;
            }
        };

        countArray(result?.diagnostics);
        countArray(result?.preflightDiagnostics);
        countArray(result?.postApplyDiagnostics);

        if (Array.isArray(result?.validationDiagnostics)) {
            for (const entry of result.validationDiagnostics) {
                countArray(entry?.diagnostics);
            }
        }
        if (Array.isArray(result?.results)) {
            for (const entry of result.results) {
                countArray(entry?.diagnostics);
            }
        }

        return count;
    }

    private countLintIssues(result: any): number {
        if (Array.isArray(result?.errors)) {
            return result.errors.length;
        }
        if (Array.isArray(result?.diagnostics)) {
            return result.diagnostics.length;
        }
        return 0;
    }

    private collectStrategies(result: any): string[] | undefined {
        const strategies: string[] = [];
        const addStrategy = (candidate: unknown) => {
            if (typeof candidate !== 'string') {
                return;
            }
            const strategy = candidate.trim();
            if (strategy.length === 0 || strategies.includes(strategy)) {
                return;
            }
            strategies.push(strategy);
        };

        for (const strategy of Array.isArray(result?.strategies) ? result.strategies : []) {
            addStrategy(strategy);
        }
        for (const entry of Array.isArray(result?.results) ? result.results : []) {
            for (const strategy of Array.isArray(entry?.strategies) ? entry.strategies : []) {
                addStrategy(strategy);
            }
        }

        return strategies.length > 0 ? strategies : undefined;
    }

    private appendPendingRecoveryPrompt(queryState: IExecutionQueryState, recoveryPrompt: string): void {
        if (!queryState.pendingRecoveryPrompt) {
            queryState.pendingRecoveryPrompt = recoveryPrompt;
            queryState.recoveryNoToolTurns = 0;
            return;
        }

        if (!queryState.pendingRecoveryPrompt.includes(recoveryPrompt)) {
            queryState.pendingRecoveryPrompt = `${queryState.pendingRecoveryPrompt}\n\n${recoveryPrompt}`;
        }
        queryState.recoveryNoToolTurns = 0;
    }

    private recordToolResultForGuardrails(toolCall: ParsedToolCall, result: any, guardState: IExecutionGuardState): void {
        this.options.executionSupport.trackTouchedPaths(toolCall.toolName, toolCall.input, result, guardState.touchedPaths);
        this.recordTerminalSummary(toolCall, result, guardState);
        const didSucceed = this.options.executionSupport.didToolSucceed(result);
        if (didSucceed) {
            guardState.successfulToolResultsInPhase++;
        }
        if (didSucceed) {
            this.executionPhase.updateExecutionEvidenceLedgerFromToolResult(
                guardState.executionEvidenceLedger,
                toolCall.toolName,
                toolCall.input,
                result
            );
        }

        const isConfirmedMutation = this.options.executionSupport.isConfirmedMutationResult(toolCall.toolName, toolCall.input, result);
        const isSettledNoOp = this.editPolicy.isSettledEditNoOp(toolCall, result);
        if (isConfirmedMutation || isSettledNoOp) {
            const mutationPaths = this.editPolicy.collectMutationPaths(toolCall, result);
            if (isConfirmedMutation) {
                guardState.successfulMutationsInPhase++;
            }
            guardState.postEditCommandVerified = false;
            guardState.postEditCommandIssues = [];
            guardState.mutationSummaries.push(this.buildMutationSummary(toolCall, result, mutationPaths, guardState.currentTurnIndex));
            this.executionPhase.registerPostMutationEvidence(
                guardState.executionEvidenceLedger,
                toolCall.toolName,
                toolCall.input
            );
            if (isConfirmedMutation) {
                for (const path of mutationPaths) {
                    guardState.mutatedPaths.add(path);
                    guardState.pendingVerificationPaths.add(path);
                }
            }
        }
    }

    private recordTerminalSummary(toolCall: ParsedToolCall, result: any, guardState: IExecutionGuardState): void {
        if (!this.profile.commandTools.has(toolCall.toolName)) {
            return;
        }

        const command = typeof toolCall.input?.command === 'string'
            ? toolCall.input.command
            : undefined;
        const toolName = toolCall.toolName;
        const intent = typeof toolCall.input?.intent === 'string' ? toolCall.input.intent : undefined;
        const writesToWorkspace = typeof toolCall.input?.writesToWorkspace === 'boolean' ? toolCall.input.writesToWorkspace : undefined;
        const success = typeof result?.success === 'boolean'
            ? result.success
            : typeof result?.exitCode === 'number'
                ? result.exitCode === 0
                : undefined;
        const sessionId = typeof result?.processId === 'string' ? result.processId : undefined;
        const status = typeof result?.status === 'string' ? result.status : undefined;
        const exitCode = typeof result?.exitCode === 'number' ? result.exitCode : undefined;
        const output = typeof result?.output === 'string' ? result.output : undefined;
        const error = typeof result?.error === 'string' ? result.error : undefined;

        const existing = sessionId
            ? guardState.terminalSummaries.find(summary => summary.sessionId === sessionId)
            : undefined;
        const update = {
            toolName: toolName ?? existing?.toolName,
            turnIndex: guardState.currentTurnIndex,
            command: command ?? existing?.command,
            sessionId: sessionId ?? existing?.sessionId,
            intent: intent ?? existing?.intent,
            writesToWorkspace: writesToWorkspace ?? existing?.writesToWorkspace,
            success: success ?? existing?.success,
            status: status ?? existing?.status,
            exitCode: exitCode ?? existing?.exitCode,
            output: output ?? existing?.output,
            error: error ?? existing?.error
        };

        if (existing) {
            Object.assign(existing, update);
            return;
        }

        guardState.terminalSummaries.push(update);
    }

    private getUnresolvedFailedGoalCommand(guardState: IExecutionGuardState): IExecutionTerminalSummary | undefined {
        const failedCommand = [...guardState.terminalSummaries].reverse().find(summary =>
            summary.toolName === this.profile.primaryCommandTool
            && summary.success === false
            && this.isFailedGoalCommand(summary)
        );
        if (!failedCommand) {
            return undefined;
        }

        return this.hasSuccessfulRecoveryAfterCommandFailure(guardState, failedCommand) ? undefined : failedCommand;
    }

    private isFailedGoalCommand(summary: IExecutionTerminalSummary): boolean {
        return summary.intent === 'implementation' || summary.writesToWorkspace === true;
    }

    private hasSuccessfulRecoveryAfterCommandFailure(
        guardState: IExecutionGuardState,
        failedCommand: IExecutionTerminalSummary
    ): boolean {
        const failedTurnIndex = failedCommand.turnIndex ?? -1;
        const hasLaterSuccessfulCommand = guardState.terminalSummaries.some(summary =>
            summary !== failedCommand
            && summary.success === true
            && (summary.turnIndex ?? -1) > failedTurnIndex
            && (summary.intent === failedCommand.intent
                || summary.intent === 'implementation'
                || (failedCommand.writesToWorkspace === true && summary.writesToWorkspace === true))
        );
        if (hasLaterSuccessfulCommand) {
            return true;
        }

        return guardState.mutationSummaries.some(summary =>
            typeof summary.turnIndex === 'number'
            && summary.turnIndex > failedTurnIndex
        );
    }

    private buildNoToolRecoveryPrompt(hasTechnicalProgress: boolean): string {
        return buildExecutionNoToolRecoveryPrompt(hasTechnicalProgress);
    }

    private buildNoProgressStopMessage(attempts: number, reason: string): string {
        return buildExecutionNoProgressStopMessage(attempts, reason);
    }

    private delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
        if (milliseconds <= 0 || signal?.aborted) {
            return Promise.resolve();
        }

        return new Promise(resolve => {
            const timeout = setTimeout(resolve, milliseconds);
            signal?.addEventListener('abort', () => {
                clearTimeout(timeout);
                resolve();
            }, { once: true });
        });
    }
}
