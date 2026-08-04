/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { URI } from '../core/uri.js';
import { CleanSlateExecutionFlow, IChatMessage, ICleanSlateContextService, ICleanSlateService } from '../protocol/cleanSlateAI.js';
import { CleanSlateThreadService } from '../services/cleanSlateThreadService.js';
import { CleanSlateTaskSessionService } from '../services/cleanSlateTaskSessionService.js';
import { CleanSlateTool, CleanSlateToolContext } from '../services/cleanSlateTools.js';
import { CleanSlateAgentParsingSupport } from './cleanSlateAgentParsing.js';
import { CleanSlateAgentExecutionSupport } from './cleanSlateAgentExecutionSupport.js';
import { AgentPhase } from './cleanSlatePrompts.js';
import { CleanSlateStreamPart, ParsedToolCall } from './cleanSlateAgentTypes.js';
import { CleanSlateExecutionQueryEngine, ICleanSlateExecutionQueryCompletionState } from './cleanSlateExecutionQuery.js';
import { CleanSlateFilesModifiedService, ICleanSlateFileChange } from './cleanSlateFilesModifiedService.js';
import { CleanSlateExecutionBudget, ICleanSlateExecutionBudget } from './cleanSlateExecutionBudget.js';

export interface IExecutionRunnerOptions {
	cleanSlateService: ICleanSlateService;
	cleanSlateContextService: ICleanSlateContextService;
	parsingSupport: CleanSlateAgentParsingSupport;
	executionSupport: CleanSlateAgentExecutionSupport;
	toolContext: CleanSlateToolContext;
	recentFocusLines: Map<string, Set<number>>;
	referenceBuffer: Map<string, any>;
	getToolCategory: (toolName: string) => string | undefined;
	getTools?: () => readonly CleanSlateTool[];
	/** Stable desktop conversation id used for provider prompt-cache affinity. */
	getSessionId?: () => string | undefined;
	recordSemanticToolResult?: (toolName: string, input: any, result: any) => void;
	buildPromptContext: (context: any, signal?: AbortSignal) => Promise<string>;
	buildPromptContextForMode?: (context: any, mode: string, signal?: AbortSignal) => Promise<string>;
	checkCrossFileReferences: (uri: URI, touchedPaths: Set<string>, signal?: AbortSignal) => Promise<string[]>;
	executeTool: (toolName: string, input: any, toolCallId?: string, signal?: AbortSignal) => AsyncIterable<CleanSlateStreamPart>;
	onQuestionPaused?: (toolCall: ParsedToolCall, result: unknown) => void;
	getToolDescriptions?: () => string;
}

/**
 * A best-effort, non-blocking context contribution. The value is produced off
 * the critical path (e.g. a warmed semantic-retrieval prefetch) and consumed at
 * most once, and only if it has already settled — the loop never awaits it.
 * Context is injected when ready, otherwise the model retrieves it on demand
 * via its tools.
 */
export interface ICleanSlateDeferredContext {
	/** Returns the formatted context once if it has settled; '' otherwise. Never blocks; consumes at most once. */
	tryConsume(): string;
}

export interface IExecutionRunOptions {
	stopOnPhaseTransition?: boolean;
	executionFlow?: CleanSlateExecutionFlow;
	executionBudget?: ICleanSlateExecutionBudget;
	/** Warmed semantic context injected into the first turn's context message when ready; never awaited. */
	deferredSemanticContext?: ICleanSlateDeferredContext;
}

export class CleanSlateQueryRunner {
	private readonly executionQueryEngine: CleanSlateExecutionQueryEngine;
	private readonly filesModifiedService = new CleanSlateFilesModifiedService();

	constructor(options: IExecutionRunnerOptions) {
		this.executionQueryEngine = new CleanSlateExecutionQueryEngine(options);
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
		runOptions: IExecutionRunOptions = {}
	): AsyncIterable<CleanSlateStreamPart> {
		const settings = this.executionQueryEngine.getExecutionLoopSettings();
		const executionFlow = runOptions.executionFlow ?? settings.executionFlow;
		const executionBudget = runOptions.executionBudget ?? new CleanSlateExecutionBudget(settings.maxTurns);
		const effectiveRunOptions = { ...runOptions, executionFlow, executionBudget };
		const phase = activeTaskSessionService.getPhase();
		// One loop for everything (refs-faithful): PLANNING is the execution
		// engine in plan mode (write tools filtered, submit_artifact as the
		// ExitPlanMode analog), EXECUTION is the engine proper, and there is no
		// separate verification phase — verification is pre-stop behavior
		// inside the loop.
		{
			const engineRunOptions = phase === AgentPhase.PLANNING
				? { ...effectiveRunOptions, phase: AgentPhase.PLANNING }
				: effectiveRunOptions;
			for await (const part of this.executionQueryEngine.run(messages, originalUserMessage, uiMode, initialContext, mentionedFiles, activeThreadService, activeTaskSessionService, signal, engineRunOptions)) {
				if (part.type === 'task_complete') {
					const completionState = part.result?.completionState as ICleanSlateExecutionQueryCompletionState | undefined;
					if (completionState) {
						const filesChanged = this.filesModifiedService.buildFileChanges(completionState.mutatedPaths, completionState.mutationSummaries);
						this.recordExecutionFilesChanged(filesChanged, activeTaskSessionService);
						yield this.enrichCompletion(part, completionState, filesChanged);
						continue;
					}
				} else if (part.type === 'tool_result') {
					this.recordExecutionFilesChanged(
						this.filesModifiedService.buildMutationFileChanges(part.toolName, (part as any).input, part.result),
						activeTaskSessionService
					);
				}
				yield part;
			}
			return;
		}
	}

	private enrichCompletion(
		part: Extract<CleanSlateStreamPart, { type: 'task_complete' }>,
		completionState: ICleanSlateExecutionQueryCompletionState,
		filesChanged: ICleanSlateFileChange[]
	): CleanSlateStreamPart {
		const filesModified = this.filesModifiedService.buildOptionalFilesModifiedPayload(filesChanged);
		const hasChangeEvidenceGap = filesChanged.length === 0 && completionState.successfulMutationsInPhase > 0;
		return {
			...part,
			result: {
				...part.result,
				...(filesChanged.length > 0 ? { filesChanged } : {}),
				completionSummary: {
					status: 'completed',
					...(filesModified ?? {}),
					...(hasChangeEvidenceGap ? { changeEvidenceStatus: 'incomplete' } : {}),
					...(completionState.proofSummaries.length > 0 ? { proofSummaries: completionState.proofSummaries } : {}),
					...(completionState.pullRequest ? { pullRequest: completionState.pullRequest } : {}),
					...(completionState.summary ? { summary: completionState.summary } : {})
				}
			}
		};
	}

	private recordExecutionFilesChanged(filesChanged: ICleanSlateFileChange[], activeTaskSessionService: CleanSlateTaskSessionService): void {
		if (filesChanged.length === 0) {
			return;
		}
		const merged = this.filesModifiedService.mergeFileChanges(activeTaskSessionService.getExecutionFilesChanged(), filesChanged);
		activeTaskSessionService.recordExecutionFilesChanged(merged);
	}
}
