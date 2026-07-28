/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IModelService } from '../../../../../editor/common/services/model.js';
import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
import { ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import { ICleanSlateService, IChatMessage, ICleanSlateIndexService, IMCPClientService, ICleanSlateContextService, ICleanSlateConfigurationService, ICleanSlateArtifactService, ICleanSlateMainService, type IChatMessagePart, type ICleanSlateAgentRuntimeSnapshot, type ICleanSlateTransportStatus, type ISearchResult } from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { Selection } from '../../../../../editor/common/core/selection.js';
import { IBulkEditService } from '../../../../../editor/browser/services/bulkEditService.js';
import { CleanSlateEditorDecorationHost } from '../tools/cleanSlateEditorDecorationHost.js';
import { CleanSlateEditorBulkEditHost } from '../host/cleanSlateEditorBulkEditHost.js';
import { URI } from '../../../../../base/common/uri.js';
import { IEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { ILanguageFeaturesService } from '../../../../../editor/common/services/languageFeatures.js';
import { ITreeSitterLibraryService } from '../../../../../editor/common/services/treeSitter/treeSitterLibraryService.js';
import { IUndoRedoService } from '../../../../../platform/undoRedo/common/undoRedo.js';
import {
    parseSlashCommand,
	AgentPhase,
	SLASH_COMMANDS
} from './cleanSlatePrompts.js';
import {
    buildContinuationContextPrompt,
    buildPhaseObjectivePrompt,
	buildWorkspaceMemoryPrompt
} from './cleanSlateRuntimePromptBuilder.js';
import { CleanSlateThreadService } from '../core/cleanSlateThreadService.js';
import { CleanSlateReadFileState, CleanSlateTool, CleanSlateToolContext, CleanSlateToolSurface, ALL_TOOLS } from '../core/cleanSlateTools.js';
import { AgentDefinition } from '../composer/registry/agentSchema.js';
import { AsyncQueue, CleanSlateStreamPart, IExecutionLoopSettings } from './cleanSlateAgentTypes.js';
import { CleanSlateAgentContextHelper } from './cleanSlateAgentContext.js';
import { CleanSlateAgentParsingSupport } from './cleanSlateAgentParsing.js';
import { CleanSlateAgentExecutionSupport } from './cleanSlateAgentExecutionSupport.js';
import { CleanSlateQueryRunner, IExecutionRunnerOptions, ICleanSlateDeferredContext } from './cleanSlateQueryRunner.js';
import { CleanSlateExecutionBudget, ICleanSlateExecutionBudget } from './cleanSlateExecutionBudget.js';
import { cancellationTokenFromAbortSignal } from '../core/cleanSlateCancellation.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { requestMcpToolApproval } from '../tools/MCPTools.js';
import { CleanSlateDialogueContextService } from './cleanSlateDialogueContextService.js';
import { CleanSlateCodeGraphService } from './cleanSlateCodeGraphService.js';
import { CleanSlateTaskSessionService } from '../core/cleanSlateTaskSessionService.js';
import { ICleanSlateCommandExecutionService } from '../core/cleanSlateCommandExecutionService.js';
import { ICleanSlateBrowserAutomationService, type ICleanSlateBrowserAnnotation } from '../core/cleanSlateBrowserAutomationService.js';
import { ICleanSlateCommandApprovalService } from '../core/cleanSlateCommandApprovalService.js';
import { applyRequestedModeToExecutionSettings, CLEANSLATE_REQUESTED_MODE, CleanSlateRequestedMode, normalizePhaseForExecutionFlow } from './cleanSlateExecutionProfile.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IMarkerService } from '../../../../../platform/markers/common/markers.js';
import { CleanSlateTaskKind, CleanSlateTaskLifecycleStatus, CleanSlateTurnIntent, CleanSlateWorkspaceShape } from '../core/cleanSlateTaskState.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IWorkspaceTrustManagementService } from '../../../../../platform/workspace/common/workspaceTrust.js';
import { ISearchService } from '../../../../services/search/common/search.js';
import { sanitizeToolResultForRenderer as sanitizeToolResultForRendererPayload } from './cleanSlateToolResultPromptSerializer.js';
import { CleanSlateAgentHistoryBuilder } from './cleanSlateAgentHistoryBuilder.js';
import { buildBrowserAnnotationTaskContext } from './cleanSlateBrowserAnnotationContext.js';
import { CleanSlateAgentSession } from './cleanSlateAgentSession.js';
import { CleanSlateToolDispatcher } from './cleanSlateToolDispatcher.js';
import { composeTurnReminder } from '../composer/promptComposer.js';

interface ICleanSlateTurnControlDecision {
	intent: CleanSlateTurnIntent;
	kind: CleanSlateTaskKind;
	workspaceShape: CleanSlateWorkspaceShape;
	requestedMode: CleanSlateRequestedMode;
	reason: string;
}

// JIT semantic retrieval auto-injects only chunks whose cosine similarity clears
// this bar, so a trivial turn ("hi") yields no above-threshold matches and injects
// nothing — no wasted tokens on weak snippets. The semantic_search tool stays
// available at lower recall (0.2) when the model explicitly wants broader results.
const CLEANSLATE_JIT_SEMANTIC_MIN_SCORE = 0.65;
// Upper bound for the background retrieval warm-up. It never blocks the turn; this
// only stops a stuck index from running unbounded off the critical path.
const CLEANSLATE_JIT_SEMANTIC_PREFETCH_BUDGET_MS = 2500;

export class CleanSlateAgent {
    private toolContext: CleanSlateToolContext;
    private registeredTools: CleanSlateTool[] = [];
	private readonly agentSession = new CleanSlateAgentSession();
	private readonly toolDispatcher = new CleanSlateToolDispatcher(() => this.registeredTools);
    private currentAgentDef?: AgentDefinition;
    private referenceBuffer: Map<string, any> = new Map();
    private recentFocusLines: Map<string, Set<number>> = new Map();
    private readFileState: Map<string, CleanSlateReadFileState> = new Map();
    private readonly contextHelper: CleanSlateAgentContextHelper;
    private readonly parsingSupport: CleanSlateAgentParsingSupport;
    private readonly executionSupport: CleanSlateAgentExecutionSupport;
    private readonly queryRunner: CleanSlateQueryRunner;
    private readonly dialogueContextService: CleanSlateDialogueContextService;
    private readonly codeGraphService: CleanSlateCodeGraphService;
    private readonly historyBuilder = new CleanSlateAgentHistoryBuilder();
    /** Inline diff decorations, backed by the editor's inline controller. */
    private readonly editorDecorationHost: CleanSlateEditorDecorationHost;
    /** Turns edit descriptors into the editor's own ResourceTextEdit. */
    private readonly bulkEditHost: CleanSlateEditorBulkEditHost;
    private sessionId: string | undefined;
    private mcpToolsLoaded = false;
    private mcpToolsLoadPromise: Promise<void> | undefined;
	private activeExecutionBudget: ICleanSlateExecutionBudget | undefined;

    constructor(
        private threadService: CleanSlateThreadService,
        private taskSessionService: CleanSlateTaskSessionService,
        @ICleanSlateService private readonly cleanSlateService: ICleanSlateService,
        @ICleanSlateMainService private readonly cleanSlateMainService: ICleanSlateMainService,
        @ICleanSlateContextService private readonly cleanSlateContextService: ICleanSlateContextService,
        @IModelService private readonly modelService: IModelService,
        @ITextFileService private readonly textFileService: ITextFileService,
        @ICodeEditorService private readonly codeEditorService: ICodeEditorService,
        @ICleanSlateIndexService private readonly indexService: ICleanSlateIndexService,
        @IMCPClientService private readonly mcpClientService: IMCPClientService,
        @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
        @ICleanSlateConfigurationService private readonly configService: ICleanSlateConfigurationService,
        @IFileService private readonly fileService: IFileService,
        @IMarkerService private readonly markerService: IMarkerService,
        @ICleanSlateArtifactService private readonly artifactService: ICleanSlateArtifactService,
        @IInstantiationService private readonly instantiationService: IInstantiationService,
        @IEditorService private readonly editorService: IEditorService,
        @ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
        @ISearchService private readonly searchService: ISearchService,
        @IBulkEditService private readonly bulkEditService: IBulkEditService,
        @IUndoRedoService private readonly undoRedoService: IUndoRedoService,
        @ITreeSitterLibraryService private readonly treeSitterLibraryService: ITreeSitterLibraryService,
        @ICleanSlateCommandExecutionService private readonly commandExecutionService: ICleanSlateCommandExecutionService,
        @ICleanSlateBrowserAutomationService private readonly browserAutomationService: ICleanSlateBrowserAutomationService,
        @ICleanSlateCommandApprovalService private readonly commandApprovalService: ICleanSlateCommandApprovalService,
        @IEnvironmentService private readonly environmentService: IEnvironmentService,
        @ICommandService private readonly commandService: ICommandService,
        @IWorkspaceTrustManagementService private readonly workspaceTrustManagementService: IWorkspaceTrustManagementService
    ) {
        this.editorDecorationHost = new CleanSlateEditorDecorationHost(this.codeEditorService);
        this.bulkEditHost = new CleanSlateEditorBulkEditHost(this.bulkEditService);
        this.toolContext = {
            surface: 'ide',
            modelService: this.modelService,
            codeEditorService: this.codeEditorService,
            textFileService: this.textFileService,
            fileService: this.fileService,
            contextService: this.cleanSlateContextService,
            indexService: this.indexService,
            workspaceContextService: this.workspaceContextService,
            ideWorkspaceContextService: this.workspaceContextService,
            configService: this.configService,
            markerService: this.markerService,
            artifactService: this.artifactService,
            mcpClientService: this.mcpClientService,
            cleanSlateMainService: this.cleanSlateMainService,
            instantiationService: this.instantiationService,
            editorService: this.editorService,
            searchService: this.searchService,
            bulkEditService: this.bulkEditHost,
            editorDecorationHost: this.editorDecorationHost,
            languageFeaturesService: this.languageFeaturesService,
            commandExecutionService: this.commandExecutionService,
            browserAutomationService: this.browserAutomationService,
            undoRedoService: this.undoRedoService,
            treeSitterLibraryService: this.treeSitterLibraryService,
            environmentService: this.environmentService,
            commandService: this.commandService,
            recentFocusLines: this.recentFocusLines,
            readFileState: this.readFileState,
            requestCommandApproval: async (req: { command: string; cwd?: string; reason?: string; toolName?: string; toolCallId?: string }) => this.commandApprovalService.requestApproval({
                ...req,
                sessionId: this.sessionId
            })
        };

        this.contextHelper = new CleanSlateAgentContextHelper(
            this.modelService,
            this.workspaceContextService,
            this.configService,
            this.languageFeaturesService,
            this.markerService,
            this.fileService,
            this.recentFocusLines
        );
        this.parsingSupport = new CleanSlateAgentParsingSupport(this.configService);
        this.codeGraphService = new CleanSlateCodeGraphService();
        this.executionSupport = new CleanSlateAgentExecutionSupport(
            this.workspaceContextService,
            this.markerService,
            this.cleanSlateContextService
        );
        this.dialogueContextService = new CleanSlateDialogueContextService(this.configService);
        this.queryRunner = new CleanSlateQueryRunner(this.createExecutionRunnerOptions());
        this.registeredTools = [...ALL_TOOLS];

    }

    /**
     * Kick off MCP tool discovery in the background. A cold MCP server start-up can
     * take tens of seconds (`getTools` spawns/handshakes the servers), so it must
     * never block the user's turn — previously this awaited on the send path and
     * added the entire ~30s first-message stall. Tools register as they arrive and
     * are picked up by subsequent turns; the triggering turn simply proceeds with
     * the native tool set. Idempotent: at most one load runs per session, and it is
     * intentionally not tied to any single turn's AbortSignal so it survives the
     * turn that started it.
     */
    private ensureMcpToolsLoading(): void {
        if (this.mcpToolsLoaded || this.mcpToolsLoadPromise || !this.mcpClientService || !this.workspaceTrustManagementService.isWorkspaceTrusted()) {
            return;
        }
        this.mcpToolsLoadPromise = this.loadMcpTools()
            .then(() => { this.mcpToolsLoaded = true; })
            .catch(error => { console.error('[CleanSlateAgent] Failed to load MCP tools:', error); })
            .finally(() => { this.mcpToolsLoadPromise = undefined; });
    }

    private async loadMcpTools(): Promise<void> {
        const mcpClientService = this.mcpClientService;
        if (!mcpClientService) {
            return;
        }
        const mcpTools = await mcpClientService.getTools(CancellationToken.None);
        for (const tool of mcpTools) {
            if (this.registeredTools.some(registeredTool => registeredTool.name === tool.name)) {
                continue;
            }
            this.registeredTools.push({
                name: tool.name,
                description: tool.description,
                category: 'system',
                parametersSchema: tool.inputSchema || { type: 'object', properties: {} },
				run: async (input: any, context: CleanSlateToolContext) => {
					if (!await requestMcpToolApproval(tool, input, context)) {
						return {
							success: false,
							code: 'user_cancelled',
							toolName: tool.name,
							message: 'The user declined this MCP tool call. Do not retry it unless explicitly requested.'
						};
					}
					return mcpClientService.executeTool(tool.name, input, cancellationTokenFromAbortSignal(context.signal));
				}
            });
        }
    }

    public setThreadService(threadService: CleanSlateThreadService): void {
        this.threadService = threadService;
    }

    public setTaskSessionService(taskSessionService: CleanSlateTaskSessionService): void {
        this.taskSessionService = taskSessionService;
    }

    public setSessionId(sessionId: string): void {
        this.sessionId = sessionId;
        this.toolContext.sessionId = sessionId;
    }

	public getRuntimeSnapshot(): ICleanSlateAgentRuntimeSnapshot | undefined {
		return this.agentSession.getSnapshot();
	}

	public restoreRuntimeSnapshot(snapshot: ICleanSlateAgentRuntimeSnapshot | undefined): void {
		this.agentSession.restore(snapshot);
	}

    public setToolSurface(surface: CleanSlateToolSurface): void {
        this.toolContext.surface = surface;
    }

    public setIdeWorkspaceContextService(workspaceContextService: IWorkspaceContextService): void {
        this.toolContext.ideWorkspaceContextService = workspaceContextService;
    }

    private async buildPromptContext(context: any, lean = false, signal?: AbortSignal): Promise<string> {
        return lean
            ? this.contextHelper.buildLeanPromptContext(context, signal)
            : this.contextHelper.buildPromptContext(context, signal);
    }

    private async checkCrossFileReferences(uri: URI, touchedPaths: Set<string>, signal?: AbortSignal): Promise<string[]> {
        return this.contextHelper.checkCrossFileReferences(uri, touchedPaths, signal);
    }

    private async resolveMentionedFiles(text: string, context: any, signal?: AbortSignal): Promise<string> {
        return this.contextHelper.resolveMentionedFiles(text, context, signal);
    }

    private async buildJitSemanticContext(query: string, timeoutMs = 2500): Promise<string> {
        const normalizedQuery = query.trim();
        if (!normalizedQuery) {
            return '';
        }
        if (this.configService.getConfiguration().ragEnabled === false) {
            return '';
        }

        try {
            const results = await this.withTimeout(
                this.indexService.search(normalizedQuery, 8, CLEANSLATE_JIT_SEMANTIC_MIN_SCORE),
                timeoutMs,
                [] as ISearchResult[]
            );
            const snippets = this.formatJitSemanticResults(results.slice(0, 8));
            return snippets;
        } catch (error) {
            console.warn('[CleanSlateAgent] JIT semantic retrieval failed:', error);
            return '';
        }
    }

    /**
     * Warms JIT semantic retrieval off the critical path and returns a handle that
     * the execution loop consumes non-blocking, only once it has settled. The turn
     * is never awaited on retrieval: if it isn't ready by context-prep time the
     * model falls back to the semantic_search tool (background prefetch,
     * consume-if-settled).
     */
    private startSemanticContextPrefetch(query: string): ICleanSlateDeferredContext {
        let settled = false;
        let value = '';
        let consumed = false;
        void this.buildJitSemanticContext(query, CLEANSLATE_JIT_SEMANTIC_PREFETCH_BUDGET_MS)
            .then(result => { value = result; })
            .catch(() => { /* best-effort; the model retrieves via the tool instead */ })
            .finally(() => { settled = true; });
        return {
            tryConsume: () => {
                if (consumed || !settled) {
                    return '';
                }
                consumed = true;
                return value;
            }
        };
    }

    private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                promise,
                new Promise<T>(resolve => {
                    timeout = setTimeout(() => resolve(fallback), timeoutMs);
                })
            ]);
        } finally {
            if (timeout) {
                clearTimeout(timeout);
            }
        }
    }

    private formatJitSemanticResults(results: ISearchResult[]): string {
        if (results.length === 0) {
            return '';
        }

        const formattedResults = results.map((result, index) => {
            const range = result.range
                ? `:${result.range.startLineNumber}-${result.range.endLineNumber}`
                : '';
            const score = Number.isFinite(result.score) ? result.score.toFixed(3) : 'n/a';
            const content = this.clampForPrompt(result.content, 1800);
            return [
                `### ${index + 1}. ${result.uri.fsPath}${range} (score ${score})`,
                '```',
                content,
                '```'
            ].join('\n');
        });

        return [
            '[JIT SEMANTIC RETRIEVAL - EPHEMERAL]',
            'Top code chunks for the current user turn. These are partial snippets, not full-file truth.',
            'If you need full implementations, exact anchors, or broader coverage, use semantic_search, read_file, read_file_range, or grep_search before editing.',
            '',
            formattedResults.join('\n\n'),
            ''
        ].join('\n');
    }

    private clampForPrompt(value: string, maxChars: number): string {
        if (value.length <= maxChars) {
            return value;
        }

        return `${value.slice(0, maxChars)}\n[... snippet truncated; use semantic_search/read_file_range for more ...]`;
    }

    async getContext(): Promise<any> {
        return await this.cleanSlateContextService.getContext();
    }

    setAgentDefinition(agentDef?: AgentDefinition): void {
        this.currentAgentDef = agentDef;
    }

    async sendMessage(
        userMessage: string,
        selections: Selection[],
        mode: string = 'normal',
        signal?: AbortSignal,
        images?: string[],
        onTransportStatus?: (status: ICleanSlateTransportStatus) => void
    ): Promise<AsyncIterable<CleanSlateStreamPart>> {
        void selections;
        await this.workspaceTrustManagementService.workspaceResolved;
        if (!this.workspaceTrustManagementService.isWorkspaceTrusted()) {
            return this.streamSystemSummaryResponse(
                userMessage,
                'CleanSlate is disabled while this workspace is in Restricted Mode. Trust the workspace before allowing the agent to read project instructions, edit files, start MCP servers, or execute commands.'
            );
        }
        const baseExecutionSettings = this.parsingSupport.getExecutionLoopSettings();
		const executionBudget = new CleanSlateExecutionBudget(baseExecutionSettings.maxTurns);
		this.ensureMcpToolsLoading();
		await this.refreshCodeGraphScope();
		let context;
		try {
			context = await this.cleanSlateContextService.getContext();
		} catch (error) {
			console.error('[CleanSlateAgent] Failed to retrieve context:', error);
			context = { activeFile: undefined, openFiles: [] };
		}

		const browserAnnotations = this.listBrowserAnnotationsForContext();
		const browserAnnotationContext = buildBrowserAnnotationTaskContext(browserAnnotations);
		const pendingQuestion = this.agentSession.resumePendingQuestion(userMessage);
		if (pendingQuestion) {
			const activeThreadService = this.threadService;
			const activeTaskSessionService = this.taskSessionService;
			activeThreadService.addMessage('user', userMessage, false, images);
			activeTaskSessionService.recordUserTurn(userMessage);
			activeTaskSessionService.resumeCurrentTask();
			const mentionedFiles = await this.resolveMentionedFiles(userMessage, context, signal);
			const phaseObjective = pendingQuestion.objective
				?? this.getLatestKnownObjective()
				?? userMessage;
			return this.streamWithToolExecution(
				this.agentSession.getMutableMessages(),
				phaseObjective,
				pendingQuestion.mode ?? mode,
				context,
				`${mentionedFiles}${browserAnnotationContext}`,
				activeThreadService,
				activeTaskSessionService,
				baseExecutionSettings,
				executionBudget,
				signal
			);
		}
		void onTransportStatus;
		const turnControl = await this.resolveTurnControlLocally(userMessage, mode, baseExecutionSettings);
		const executionSettings = applyRequestedModeToExecutionSettings(baseExecutionSettings, turnControl.requestedMode);
		executionBudget.configure(executionSettings.maxTurns);
		this.taskSessionService.recordIntent(turnControl.intent);

        const speedMode = !executionSettings.planMode;
        if (!speedMode) {
            this.refreshSemanticMemoryFromQuery(userMessage);
        }
        // Warm semantic retrieval in the background instead of blocking the turn on
        // it (previously a 0.9s/2.5s awaited search before every message). Consumed
        // non-blocking at context-prep time; if not ready, the model uses the tool.
        const deferredSemanticContext = this.startSemanticContextPrefetch(userMessage);

        let effectiveUserMessage = userMessage;
        let continuationContext = '';

		if (turnControl.intent === CleanSlateTurnIntent.APPROVE_PLAN
            && this.taskSessionService.getPhase() === AgentPhase.PLANNING
            && this.taskSessionService.isAwaitingApproval()) {
            this.taskSessionService.approvePlan();
		} else if (turnControl.intent === CleanSlateTurnIntent.REVISE_PLAN) {
            this.taskSessionService.setAwaitingApproval(false);
            this.taskSessionService.setPhase(AgentPhase.PLANNING);
            effectiveUserMessage = this.buildPlanRevisionPrompt(userMessage);
		} else if (turnControl.intent === CleanSlateTurnIntent.START_NEW_TASK) {
            this.threadService.startNewTaskBoundary();
			this.taskSessionService.startNewTask(turnControl.kind, turnControl.workspaceShape, userMessage);
		} else if (turnControl.intent === CleanSlateTurnIntent.RERUN_LAST_TASK) {
            const rerunObjective = this.getLatestKnownObjective();
            if (!rerunObjective) {
                return this.streamSystemSummaryResponse(userMessage, 'There is no prior task objective available to rerun.');
            }
            this.threadService.startNewTaskBoundary();
            this.taskSessionService.startNewTask(
				this.getLatestKnownTaskKind(turnControl.kind),
				this.getLatestKnownWorkspaceShape(turnControl.workspaceShape),
				rerunObjective
            );
            effectiveUserMessage = rerunObjective;
		} else if (turnControl.intent === CleanSlateTurnIntent.CONTINUE_CURRENT) {
            this.taskSessionService.resumeCurrentTask();
			if (this.taskSessionService.getTaskKind() === CleanSlateTaskKind.CHAT) {
				this.taskSessionService.setTaskKind(turnControl.kind);
			}
			continuationContext = this.buildContinuationContext();
		} else if (turnControl.intent === CleanSlateTurnIntent.CANCEL_CURRENT) {
            this.taskSessionService.markCancelled();
            return this.streamSystemSummaryResponse(userMessage, 'Cancelled the current task.');
        } else if (this.taskSessionService.getTaskKind() === CleanSlateTaskKind.UNKNOWN
			&& turnControl.kind !== CleanSlateTaskKind.UNKNOWN
			&& turnControl.kind !== CleanSlateTaskKind.CHAT) {
			this.taskSessionService.setTaskKind(turnControl.kind);
			this.taskSessionService.setWorkspaceShape(turnControl.workspaceShape);
        }

		const usePlanningForCurrentTurn = this.shouldUsePlanningForCurrentTurn(turnControl, executionSettings, effectiveUserMessage);
		const effectivePhase = this.normalizePhaseForExecutionFlow(turnControl, executionSettings, usePlanningForCurrentTurn);

        const mentionedFiles = await this.resolveMentionedFiles(userMessage, context, signal);
        // JIT semantic snippets are injected non-blocking at context-prep time via
        // the deferred prefetch, so the turn addendum carries only @-mention context.
        const turnContextAddendum = mentionedFiles;
        const activeThreadService = this.threadService;
        const activeTaskSessionService = this.taskSessionService;
		const isControlContinuationTurn = turnControl.intent === CleanSlateTurnIntent.APPROVE_PLAN
			|| turnControl.intent === CleanSlateTurnIntent.CONTINUE_CURRENT;
        activeThreadService.addMessage('user', userMessage, isControlContinuationTurn, images);
        if (!isControlContinuationTurn) {
            activeTaskSessionService.recordUserTurn(userMessage);
        }

		const runtimeTurn = this.parseRuntimeTurn(effectiveUserMessage);
		const phaseObjective = this.buildPhaseObjective(effectivePhase, runtimeTurn.userMessage, '', continuationContext, executionSettings);
		const messages = this.agentSession.hasMessages()
			? this.buildRuntimeTurn(effectivePhase, runtimeTurn, images)
			: await this.buildPhaseMessages(
				effectivePhase,
				phaseObjective,
				context,
				turnContextAddendum,
				activeThreadService,
				activeTaskSessionService,
				images,
				signal
			);

		return this.streamWithToolExecution(messages, phaseObjective, mode, context, turnContextAddendum, activeThreadService, activeTaskSessionService, executionSettings, executionBudget, signal, this.agentSession, deferredSemanticContext);
    }

	private parseRuntimeTurn(userMessage: string): { command?: string; userMessage: string } {
		if (!userMessage.startsWith('/')) {
			return { userMessage };
		}
		const command = userMessage.split(/\s/, 1)[0];
		const definition = SLASH_COMMANDS[command];
		if (!definition) {
			return { userMessage };
		}
		const remainder = userMessage.slice(command.length).trim();
		return {
			command,
			userMessage: remainder || definition.defaultMessage
		};
	}

	private buildRuntimeTurn(
		phase: AgentPhase,
		turn: { command?: string; userMessage: string },
		images?: string[]
	): IChatMessage[] {
		return [
			{
				role: 'system',
				content: composeTurnReminder({
					mode: this.getComposerModeForPhase(phase),
					command: turn.command
				})
			},
			this.buildRuntimeUserTurn(turn.userMessage, images)
		];
	}

	private buildRuntimeUserTurn(userMessage: string, images?: string[]): IChatMessage {
		if (!images?.length) {
			return { role: 'user', content: userMessage };
		}
		const content: IChatMessagePart[] = [{ type: 'text', text: userMessage }];
		for (const image of images) {
			content.push({ type: 'image_url', image_url: { url: image } });
		}
		return { role: 'user', content };
	}

    private async * streamWithToolExecution(
        messages: IChatMessage[],
        phaseObjective: string,
        uiMode: string,
        initialContext: any,
        mentionedFiles: string,
        activeThreadService: CleanSlateThreadService,
        activeTaskSessionService: CleanSlateTaskSessionService,
        executionSettings: IExecutionLoopSettings,
		executionBudget: ICleanSlateExecutionBudget,
		signal?: AbortSignal,
		runtimeSession: CleanSlateAgentSession = this.agentSession,
		deferredSemanticContext?: ICleanSlateDeferredContext
    ): AsyncIterable<CleanSlateStreamPart> {
		const previousExecutionBudget = this.activeExecutionBudget;
		this.activeExecutionBudget = executionBudget;
        try {
			let phase = activeTaskSessionService.getPhase();
			if (phase === AgentPhase.VERIFICATION || executionSettings.executionFlow === 'normal') {
				phase = AgentPhase.EXECUTION;
				activeTaskSessionService.setPhase(phase);
			}

			const runnerMessages = phase === AgentPhase.EXECUTION
				? this.buildExecutionMessages(messages, runtimeSession)
				: messages === runtimeSession.getMutableMessages()
					? messages
					: runtimeSession.hasMessages()
						? runtimeSession.continueWithTurn(messages, {
							objective: phaseObjective,
							mode: this.getComposerModeForPhase(phase),
							phase
						})
						: runtimeSession.start(messages, {
							objective: phaseObjective,
							mode: this.getComposerModeForPhase(phase),
							phase
						});
			// One native conversation loop for normal and plan mode. Mode changes
			// permissions/tool exposure; it does not route into another worker.
			const runner = this.queryRunner;

			yield* runner.run(
				runnerMessages,
				phaseObjective,
				uiMode,
				initialContext,
				mentionedFiles,
				activeThreadService,
				activeTaskSessionService,
				signal,
				{ executionFlow: executionSettings.executionFlow, executionBudget, deferredSemanticContext }
			);
		} finally {
			this.activeExecutionBudget = previousExecutionBudget;
		}
    }

	private buildExecutionMessages(messages: IChatMessage[], runtimeSession: CleanSlateAgentSession = this.agentSession): IChatMessage[] {
		let result = messages === runtimeSession.getMutableMessages()
			? messages
			: runtimeSession.hasMessages()
				? runtimeSession.continueWithTurn(messages, {
					objective: this.getLatestKnownObjective(),
					mode: 'Execution',
					phase: AgentPhase.EXECUTION
				})
				: runtimeSession.start(messages, {
					objective: this.getLatestKnownObjective(),
					mode: 'Execution',
					phase: AgentPhase.EXECUTION
				});

        const approvedPlan = this.artifactService.getLatestArtifactByType('implementation_plan', { sessionId: this.sessionId })?.content?.trim();
        if (!approvedPlan) {
            return result;
        }

        const hasApprovedPlanContext = result.some(message =>
            typeof message.content === 'string'
            && (message.content.includes('[APPROVED IMPLEMENTATION PLAN]') || message.content.includes(approvedPlan))
        );
        if (hasApprovedPlanContext) {
            return result;
        }

        return [
            ...result,
            {
                role: 'system',
                content: [
                    'PLANNING HANDOFF TO EXECUTION: execute the approved implementation plan through the execution tool loop.',
                    'The planning conversation above is part of this same task: files already read there do not need to be re-read unless they changed.',
					'Do not draft or rewrite the plan here; implement it with concrete tools, verify the result, then write the concise user-facing answer and stop.',
                    '',
                    '[APPROVED IMPLEMENTATION PLAN]',
                    approvedPlan
                ].join('\n')
            }
        ];
    }

    private async buildPhaseMessages(
        phase: AgentPhase,
        userMessage: string,
        context: any,
        mentionedFiles: string,
        threadService: CleanSlateThreadService,
        taskSessionService: CleanSlateTaskSessionService,
        images?: string[],
        signal?: AbortSignal
    ): Promise<IChatMessage[]> {
        const effectiveMode = this.getComposerModeForPhase(phase);
        const languageId = context.activeFile?.languageId;
        const openFilePaths = Array.isArray(context.openFiles)
            ? context.openFiles
                .map((file: any) => typeof file?.uri?.fsPath === 'string' ? file.uri.fsPath : (typeof file?.path === 'string' ? file.path : ''))
                .filter((path: string) => path.length > 0)
            : [];

        // JIT Context Discovery for Prompt Pruning
        const discoveredContext = {
            hasDatabase: openFilePaths.some((path: string) => /\.(sql|prisma|mongo|db)$/i.test(path)) || languageId === 'sql',
            hasFrontend: openFilePaths.some((path: string) => /\.(tsx|jsx|html|css|vue|svelte)$/i.test(path)) || ['typescriptreact', 'javascriptreact'].includes(languageId || ''),
            hasCloud: openFilePaths.some((path: string) => /(docker|kubernetes|k8s|github\/workflows)/i.test(path))
        };

        const parsedCommand = parseSlashCommand(userMessage, effectiveMode, this.currentAgentDef, languageId, discoveredContext);
        const config = this.configService.getConfiguration();
        const useLeanExecutionContext = phase === AgentPhase.EXECUTION;
        const systemInstruction = parsedCommand.systemInstruction;
        const contextWindowChars = this.historyBuilder.getContextWindowCharBudget(config);
        const historyBudgetChars = contextWindowChars;
        const rawHistory = phase === AgentPhase.EXECUTION || phase === AgentPhase.VERIFICATION
            ? threadService.getIsolatedExecutionHistory()
            : threadService.getActiveTaskHistory();
        const currentUserRequest = parsedCommand.userMessage || userMessage;
        const history = this.historyBuilder.prepareBudgetedDialogueHistory(rawHistory, userMessage, currentUserRequest, historyBudgetChars);
        const promptContext = await this.buildPromptContext(context, useLeanExecutionContext, signal);
        if (!useLeanExecutionContext) {
            this.refreshSemanticMemoryFromQuery(currentUserRequest);
        }
        const semanticHighlights = taskSessionService.getSemanticHighlights().slice(useLeanExecutionContext ? -3 : -15);

        const messages: IChatMessage[] = [
            { role: 'system', content: systemInstruction },
            ...history.map(message => this.historyBuilder.cloneChatMessage(message))
        ];
        const dialogueMemory = this.dialogueContextService.buildDialogueMemoryPrompt(
            threadService,
            currentUserRequest,
            useLeanExecutionContext
                ? { minUserTurns: 6, maxChars: Math.max(8000, Math.floor(historyBudgetChars * 0.2)), useFullThread: true }
                : undefined
        );
        if (dialogueMemory.trim().length > 0) {
            messages.push({ role: 'system', content: dialogueMemory });
        }

		const workspaceMemory = this.buildWorkspaceMemoryContext(taskSessionService);
        const discoveredPathMemory = taskSessionService.getDiscoveredPaths().slice(useLeanExecutionContext ? -10 : -50);
        const discoveredPathContext = discoveredPathMemory.length > 0
            ? `\n\n[DISCOVERED PATH MEMORY]\n${discoveredPathMemory.map(path => `- ${path}`).join('\n')}`
            : '';
        const semanticContext = semanticHighlights.length > 0
            ? `\n\n[SEMANTIC GRAPH MEMORY]\n${semanticHighlights.map(item => `- ${item}`).join('\n')}`
            : '';
		const browserAnnotationContext = this.buildBrowserAnnotationContext();
		const userContentText = `${workspaceMemory ? `${workspaceMemory}\n\n` : ''}[CONTEXT]\n${promptContext}${mentionedFiles}${browserAnnotationContext}${discoveredPathContext}${semanticContext}\n\nUser Request: ${currentUserRequest}`;

        if (images && images.length > 0) {
            const contentParts: IChatMessagePart[] = [{ type: 'text', text: userContentText }];
            for (const img of images) {
                contentParts.push({ type: 'image_url', image_url: { url: img } });
            }
            messages.push({ role: 'user', content: this.historyBuilder.cloneMessageContent(contentParts) });
        } else {
            messages.push({ role: 'user', content: userContentText });
        }

        return messages;
    }

    private buildBrowserAnnotationContext(): string {
		return buildBrowserAnnotationTaskContext(this.listBrowserAnnotationsForContext());
	}

	private listBrowserAnnotationsForContext(): ICleanSlateBrowserAnnotation[] {
		try {
			return this.browserAutomationService.listCachedAnnotations(this.browserSurfaceForToolContext());
		} catch {
			return [];
		}
    }

    private browserSurfaceForToolContext(): 'ide' | 'agentManager' | `agentManager:${string}` {
        if (this.toolContext.surface === 'agentManager') {
            return this.toolContext.sessionId ? `agentManager:${this.toolContext.sessionId}` : 'agentManager';
        }
        return 'ide';
    }

    private buildPhaseObjective(phase: AgentPhase, userMessage: string, priorPhaseSummary: string = '', continuationContext: string = '', settingsOverride?: IExecutionLoopSettings): string {
        const settings = settingsOverride ?? this.parsingSupport.getExecutionLoopSettings();

        if (phase === AgentPhase.EXECUTION && !settings.usePlanningPhase) {
            const completionInstruction = 'Write the final user-facing answer as normal assistant text with no tool call; the host records task completion after that response.';
            return [
				'Work in the normal agent loop for the current workspace.',
				'Decide from the user request whether to answer directly, investigate with tools, or change the workspace.',
				'When the user asks for a change, inspect what is needed and implement it with the enabled tools; do not downgrade the request into read-only recommendations.',
				'When the user asks only for information, answer directly after gathering any evidence that is actually needed.',
                'Do not wait for separate planning or verification handoffs.',
                completionInstruction,
                priorPhaseSummary ? `Latest Execution Context:\n${priorPhaseSummary}` : '',
                continuationContext ? `Continuation Context:\n${continuationContext}` : '',
                userMessage ? `Objective:\n${userMessage}` : ''
            ].filter(Boolean).join('\n\n');
        }

        return buildPhaseObjectivePrompt({
            phase,
            latestPlan: this.artifactService.getLatestArtifactByType('implementation_plan', { sessionId: this.sessionId })?.content ?? '',
            userMessage,
            rootObjective: this.getLatestKnownObjective(),
            priorPhaseSummary,
            continuationContext
        });
    }

    private getComposerModeForPhase(phase: AgentPhase): 'Planning' | 'Execution' {
        switch (phase) {
            case AgentPhase.EXECUTION:
            case AgentPhase.VERIFICATION:
                return 'Execution';
            case AgentPhase.PLANNING:
            default:
                return 'Planning';
        }
    }

    private getRootUserObjective(threadService: CleanSlateThreadService): string | undefined {
        return threadService.getActiveTaskHistory().find(message => message.role === 'user' && message.content.trim().length > 0)?.content;
    }

	/**
	 * Resolves host lifecycle controls without spending a separate model turn.
	 * The main conversation model decides whether an ordinary request needs
	 * tools or only an answer; this resolver only handles explicit GUI/task
	 * state transitions.
	 */
	private async resolveTurnControlLocally(
		userMessage: string,
		mode: string,
		settings: IExecutionLoopSettings
	): Promise<ICleanSlateTurnControlDecision> {
		const normalized = userMessage.trim();
		const lower = normalized.toLowerCase();
		const awaitingApproval = this.taskSessionService.isAwaitingApproval();
		const currentTaskStatus = this.taskSessionService.getStatus();
		// Workspace contents are context for the model, not a host-side task
		// classification. The model can inspect an empty or existing root with
		// the same tool loop.
		const workspaceShape = CleanSlateWorkspaceShape.UNKNOWN;

		const makeDecision = (
			intent: CleanSlateTurnIntent,
			requestedMode: CleanSlateRequestedMode,
			reason: string
		): ICleanSlateTurnControlDecision => ({
			intent,
			kind: CleanSlateTaskKind.MODIFY_EXISTING,
			workspaceShape,
			requestedMode,
			reason
		});

		if (awaitingApproval) {
			if (/\b(revise|change|adjust|update)\b[\s\S]*\bplan\b|\bplan\b[\s\S]*\b(revise|change|adjust|update)\b/i.test(normalized)) {
				return makeDecision(CleanSlateTurnIntent.REVISE_PLAN, CLEANSLATE_REQUESTED_MODE.PLANNING, 'explicit_plan_revision');
			}
			if (/^(?:yes|y|approve|approved|proceed|continue|go ahead|implement(?: it)?|start(?: implementation)?)\b[.!\s]*$/i.test(normalized)) {
				return makeDecision(CleanSlateTurnIntent.APPROVE_PLAN, CLEANSLATE_REQUESTED_MODE.EXECUTION, 'explicit_plan_approval');
			}
		}

		if (/^(?:cancel|stop|abort)(?:\s+(?:this|the|current)\s+(?:task|run))?[.!\s]*$/i.test(normalized)) {
			return makeDecision(CleanSlateTurnIntent.CANCEL_CURRENT, CLEANSLATE_REQUESTED_MODE.CHAT, 'explicit_cancel');
		}
		if (/^(?:rerun|run again|retry)(?:\s+(?:the|last|previous)\s+task)?[.!\s]*$/i.test(normalized)) {
			return makeDecision(CleanSlateTurnIntent.RERUN_LAST_TASK, CLEANSLATE_REQUESTED_MODE.EXECUTION, 'explicit_rerun');
		}
		if (/^(?:continue|resume|keep going|go on)[.!\s]*$/i.test(normalized)) {
			return makeDecision(CleanSlateTurnIntent.CONTINUE_CURRENT, CLEANSLATE_REQUESTED_MODE.EXECUTION, 'explicit_continue');
		}
		const isActiveTask = ![
			CleanSlateTaskLifecycleStatus.IDLE,
			CleanSlateTaskLifecycleStatus.COMPLETED,
			CleanSlateTaskLifecycleStatus.FAILED,
			CleanSlateTaskLifecycleStatus.CANCELLED
		].includes(currentTaskStatus);
		// The permission/collaboration mode is explicit host state.
		// Ordinary language is never semantically routed into a
		// read-only or write-enabled profile.
		const planningRequested = settings.planMode || settings.usePlanningPhase || /\bplan(?:ning)?\b/i.test(mode);
		const requestedMode = planningRequested
			? CLEANSLATE_REQUESTED_MODE.PLANNING
			: CLEANSLATE_REQUESTED_MODE.EXECUTION;

		return makeDecision(
			isActiveTask ? CleanSlateTurnIntent.CONTINUE_CURRENT : CleanSlateTurnIntent.START_NEW_TASK,
			requestedMode,
			isActiveTask ? 'same_native_conversation' : `explicit_mode_${lower ? 'new_turn' : 'empty_turn'}`
		);
	}

    private async refreshCodeGraphScope(): Promise<void> {
        const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
        const workspaceKey = workspaceFolders.length > 0
            ? `workspace:${workspaceFolders.map(folder => folder.uri.toString()).join('|')}`
            : 'workspace:empty';
        const gitHeadFingerprint = await this.resolveGitHeadFingerprint();
        this.codeGraphService.setScope(workspaceKey, `head:${gitHeadFingerprint}`);
    }

    private async resolveGitHeadFingerprint(): Promise<string> {
        const rootFolder = this.workspaceContextService.getWorkspace().folders[0];
        if (!rootFolder) {
            return 'none';
        }

        try {
            const headUri = rootFolder.toResource('.git/HEAD');
            const headValue = (await this.textFileService.read(headUri)).value.trim();
            if (!headValue) {
                return 'unknown';
            }
            if (!headValue.startsWith('ref:')) {
                return headValue;
            }

            const refPath = headValue.replace(/^ref:\s*/, '').trim();
            if (!refPath) {
                return headValue;
            }

            try {
                const refUri = rootFolder.toResource(`.git/${refPath}`);
                const refValue = (await this.textFileService.read(refUri)).value.trim();
                if (refValue) {
                    return `${refPath}:${refValue}`;
                }
            } catch {
                // Fall back to HEAD content if the referenced file is unavailable.
            }

            return headValue;
        } catch {
            return 'unknown';
        }
    }

    private refreshSemanticMemoryFromQuery(query: string): void {
        const highlights = this.codeGraphService.buildHighlights(query, {
            seedPaths: this.taskSessionService.getDiscoveredPaths(),
            maxPaths: 6,
            maxSymbols: 12
        });
        if (highlights.relatedPaths.length > 0) {
            this.taskSessionService.recordDiscoveredPaths(highlights.relatedPaths);
        }
        if (highlights.highlights.length > 0) {
            this.taskSessionService.recordSemanticHighlights(highlights.highlights);
        }
    }

    private recordSemanticToolResult(toolName: string, input: any, result: any): void {
        this.codeGraphService.ingestToolResult(toolName, input, result);
        const querySeed = this.getLatestKnownObjective() || this.taskSessionService.getLastUserTurn() || '';
        this.refreshSemanticMemoryFromQuery(querySeed);
    }

	private buildWorkspaceMemoryContext(taskSessionService: CleanSlateTaskSessionService): string {
		return buildWorkspaceMemoryPrompt(
            taskSessionService.getDiscoveredPaths(),
            taskSessionService.getSemanticHighlights()
        );
    }

    private normalizePhaseForExecutionFlow(
		turnControl: ICleanSlateTurnControlDecision,
        settings: IExecutionLoopSettings,
        usePlanningForCurrentTurn: boolean
    ): AgentPhase {
        const currentPhase = this.taskSessionService.getPhase();
        const nextPhase = normalizePhaseForExecutionFlow({
            currentPhase: currentPhase as 'PLANNING' | 'EXECUTION' | 'VERIFICATION',
            isAwaitingApproval: this.taskSessionService.isAwaitingApproval(),
            currentTaskKind: this.taskSessionService.getTaskKind(),
			turnIntent: turnControl.intent,
            planMode: settings.planMode,
            usePlanningPhase: settings.usePlanningPhase,
            usePlanningForCurrentTurn
        });

        if (nextPhase !== currentPhase) {
            this.taskSessionService.setPhase(nextPhase as AgentPhase);
        }

        return nextPhase as AgentPhase;
    }

	private shouldUsePlanningForCurrentTurn(turnControl: ICleanSlateTurnControlDecision, settings: IExecutionLoopSettings, userMessage: string): boolean {
        if (!settings.usePlanningPhase) {
            return false;
        }
        if (settings.planMode) {
            return true;
        }
		if (turnControl.requestedMode === CLEANSLATE_REQUESTED_MODE.PLANNING) {
            return true;
        }
        if (this.taskSessionService.isAwaitingApproval()
			|| turnControl.intent === CleanSlateTurnIntent.REVISE_PLAN
			|| turnControl.intent === CleanSlateTurnIntent.APPROVE_PLAN) {
            return true;
        }
        void userMessage;
        return false;
    }

    private async * streamSystemSummaryResponse(userMessage: string, summary: string): AsyncIterable<CleanSlateStreamPart> {
        const turnId = `system-${Date.now()}`;
        const response = JSON.stringify({ summary });

        this.threadService.addMessage('user', userMessage);
        this.taskSessionService.recordUserTurn(userMessage);
        yield { type: 'assistant_turn_start', phase: 'CHAT', turnId };
        yield { type: 'text', content: response };
        yield { type: 'assistant_turn_complete', phase: 'CHAT', turnId };
        this.threadService.addMessage('assistant', response);
        this.taskSessionService.recordAssistantTurn(response);
        this.taskSessionService.recordAssistantSummary(summary);
    }

    private buildContinuationContext(): string {
        const runSummary = this.taskSessionService.getRunSummary();
        return buildContinuationContextPrompt({
            phase: runSummary.phase,
            objective: runSummary.objective,
            currentWorkItem: runSummary.currentWorkItem,
            toDo: runSummary.toDo,
            lastSummary: runSummary.lastSummary,
            lastError: runSummary.lastError,
            lastToolName: runSummary.lastToolName,
            pendingRecovery: runSummary.pendingRecovery,
            verificationTargets: runSummary.verificationTargets,
            discoveredPaths: this.taskSessionService.getDiscoveredPaths(),
            semanticHighlights: this.taskSessionService.getSemanticHighlights(),
            checkpoints: this.taskSessionService.getCheckpoints()
        });
    }

    private buildPlanRevisionPrompt(userMessage: string): string {
        const objective = this.getLatestKnownObjective();
        return [
            objective ? `Objective: ${objective}` : '',
            `User Feedback: "${userMessage}"`,
            'Task: Evaluate the feedback. If the intent is clear, produce an updated implementation_plan.md. If the feedback is ambiguous or you need to understand the user\'s intent better before proceeding, do NOT draft a plan; instead, call the native ask_question tool to ask for clarification.'
        ].filter(Boolean).join('\n\n');
    }

    private getLatestKnownObjective(): string | undefined {
        const runSummary = this.taskSessionService.getRunSummary();
        if (runSummary.objective?.trim()) {
            return runSummary.objective.trim();
        }

        for (const entry of this.taskSessionService.getRunLedger()) {
            if (entry.objective?.trim()) {
                return entry.objective.trim();
            }
        }

        return this.getRootUserObjective(this.threadService) || this.taskSessionService.getLastUserTurn();
    }

    private getLatestKnownTaskKind(fallback: CleanSlateTaskKind): CleanSlateTaskKind {
        const currentTaskKind = this.taskSessionService.getTaskKind();
        if (currentTaskKind !== CleanSlateTaskKind.UNKNOWN && currentTaskKind !== CleanSlateTaskKind.CHAT) {
            return currentTaskKind;
        }

        const latestLedgerKind = this.taskSessionService.getRunLedger().find(entry =>
            entry.taskKind !== CleanSlateTaskKind.UNKNOWN && entry.taskKind !== CleanSlateTaskKind.CHAT
        )?.taskKind;

        return latestLedgerKind || fallback;
    }

    private getLatestKnownWorkspaceShape(fallback: CleanSlateWorkspaceShape): CleanSlateWorkspaceShape {
        const currentWorkspaceShape = this.taskSessionService.getWorkspaceShape();
        if (currentWorkspaceShape !== CleanSlateWorkspaceShape.UNKNOWN) {
            return currentWorkspaceShape;
        }

        const latestLedgerShape = this.taskSessionService.getRunLedger().find(entry =>
            entry.workspaceShape !== CleanSlateWorkspaceShape.UNKNOWN
        )?.workspaceShape;

        return latestLedgerShape || fallback;
    }



    async *regenerateMessage(prompt: string): AsyncIterable<string> {
        const stream = await this.cleanSlateService.generate(prompt);
        for await (const part of stream) {
            if (part.type === 'text') {
                yield part.content;
            }
        }
    }

    getTools(): CleanSlateTool[] {
        return [...this.registeredTools];
    }

    registerTool(tool: CleanSlateTool): void {
        if (!this.registeredTools.find(t => t.name === tool.name)) {
            this.registeredTools.push(tool);
        }
    }

    unregisterTool(toolName: string): void {
        this.registeredTools = this.registeredTools.filter(t => t.name !== toolName);
    }

    private normalizeToolName(toolName: string): string {
		return this.toolDispatcher.normalizeToolName(toolName);
    }

    async * executeTool(toolName: string, input: any, toolCallId?: string, signal?: AbortSignal): AsyncIterable<CleanSlateStreamPart> {
		const prepared = this.toolDispatcher.prepare(toolName, input ?? {});
		toolName = prepared.toolName;
        console.log(`[CleanSlateAgent] Executing tool: ${toolName}${this.describeToolInputForLog(input)}`);
		if (!prepared.ok) {
			yield { type: 'tool_start', toolName, input, toolCallId };
			yield { type: 'tool_result', toolName, result: prepared.error, toolCallId };
			return;
		}
		input = prepared.input;

        if (toolName === 'spawn_worker') {
            yield { type: 'tool_start', toolName, input, toolCallId };
            let lastWorkerResult = '';

            try {
                for await (const part of this.runWorkerSubagent(input.prompt, input.description, signal)) {
                    if (part.type === 'text') {
                        lastWorkerResult += part.content;
                    }
                    yield part;
                }

                yield { type: 'tool_result', toolName, result: this.sanitizeToolResultForRenderer(toolName, { success: true, result: lastWorkerResult }), toolCallId };
            } catch (err) {
                yield { type: 'tool_result', toolName, result: { success: false, error: String(err) }, toolCallId };
            }
            return;
        }

        if (toolName === 'read_reference') {
            yield { type: 'tool_start', toolName, input, toolCallId };
            const refId = input.referenceId;
            const content = this.referenceBuffer.get(refId);

            if (content !== undefined) {
                yield { type: 'tool_result', toolName, result: this.sanitizeToolResultForRenderer(toolName, { success: true, content }), toolCallId };
            } else {
                yield { type: 'tool_result', toolName, result: { success: false, error: `Reference ID "${refId}" not found or expired.` }, toolCallId };
            }
            return;
        }

		const tool = prepared.tool;
        yield { type: 'tool_start', toolName, input, toolCallId };

        const queue = new AsyncQueue<CleanSlateStreamPart>();
        const safeInput = input || {};

        const toolPromise = tool.run(safeInput, {
            ...this.toolContext,
            signal,
            requestCommandApproval: async (req) => this.commandApprovalService.requestApproval({
                ...req,
                sessionId: this.sessionId,
                toolName: req.toolName || toolName,
                toolCallId: req.toolCallId || toolCallId
            }),
            onProgress: (p) => queue.push({ type: 'tool_progress', toolName, progress: p, toolCallId })
        }).then(result => {
            if (result?.success === false) {
                const failureDetail = typeof result.error === 'string'
                    ? result.error
                    : typeof result.message === 'string' ? result.message : '';
                console.warn(`[CleanSlateAgent] Tool "${toolName}" reported failure${failureDetail ? `: ${failureDetail}` : ''}.`);
            }
            queue.push({ type: 'tool_result', toolName, result: this.sanitizeToolResultForRenderer(toolName, result), toolCallId });
            queue.push(undefined);
        }).catch(err => {
            console.error(`[CleanSlateAgent] Tool "${toolName}" threw:`, err);
            queue.push({ type: 'tool_result', toolName, result: { success: false, error: String(err) }, toolCallId });
            queue.push(undefined);
        });

        let part;
        while ((part = await queue.next()) !== undefined) {
            yield part;
        }

        await toolPromise;
    }

    private sanitizeToolResultForRenderer(toolName: string, result: unknown): unknown {
        return sanitizeToolResultForRendererPayload(toolName, result);
    }

    private describeToolInputForLog(input: unknown): string {
        if (!input || typeof input !== 'object') {
            return '';
        }
        const source = input as Record<string, unknown>;
        const hints = ['path', 'query', 'command', 'url', 'pattern']
            .map(key => {
                const value = source[key];
                return typeof value === 'string' && value.trim().length > 0
                    ? `${key}=${this.clampLogValue(value.trim())}`
                    : undefined;
            })
            .filter((value): value is string => typeof value === 'string');
        return hints.length > 0 ? ` (${hints.join(', ')})` : '';
    }

    private clampLogValue(value: string): string {
        return value.length <= 160 ? value : `${value.slice(0, 157)}...`;
    }

    protected getToolDescriptions(): string {
        if (this.registeredTools.length === 0) {
            return '';
        }

        const descriptions = this.registeredTools.map((tool: CleanSlateTool) => {
            let desc = `- ${tool.name}: ${tool.description}`;
            if (tool.parametersSchema) {
                desc += `\n  Parameters: ${JSON.stringify(tool.parametersSchema)}`;
            }
            if (tool.planningHint) {
                desc += `\n  Planning Hint: ${tool.planningHint}`;
            }
            return desc;
        }).join('\n');

        return `\n\nAvailable native tools:\n${descriptions}\n`;
    }

    private async * runWorkerSubagent(spec: string, description: string, signal?: AbortSignal): AsyncIterable<CleanSlateStreamPart> {
        console.log(`[CleanSlateAgent] Spawning Worker for: ${description}`);

        const context = await this.cleanSlateContextService.getContext();
        const languageId = context.activeFile?.languageId;
        const { systemInstruction } = parseSlashCommand(spec, 'Execution', this.currentAgentDef, languageId);
        const promptContext = await this.buildPromptContext(context, false, signal);
        const jitSemanticContext = await this.buildJitSemanticContext(spec);

        const messages: IChatMessage[] = [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: `[CONTEXT]\n${promptContext}${jitSemanticContext}\n\nTechnical Spec (Objective):\n${spec}` }
        ];

        const workerThreadService = new CleanSlateThreadService();
        const workerTaskSessionService = new CleanSlateTaskSessionService();
        workerTaskSessionService.setPhase(AgentPhase.EXECUTION);

		const executionSettings = this.parsingSupport.getExecutionLoopSettings();
		const executionBudget = this.activeExecutionBudget ?? new CleanSlateExecutionBudget(executionSettings.maxTurns);
        yield* this.streamWithToolExecution(
            messages,
            spec,
            'Execution',
            context,
            jitSemanticContext,
            workerThreadService,
            workerTaskSessionService,
			executionSettings,
			executionBudget,
			signal,
			new CleanSlateAgentSession()
        );
    }

	private createExecutionRunnerOptions(runtimeSession: CleanSlateAgentSession = this.agentSession): IExecutionRunnerOptions {
        return {
            cleanSlateService: this.cleanSlateService,
            cleanSlateContextService: this.cleanSlateContextService,
            parsingSupport: this.parsingSupport,
            executionSupport: this.executionSupport,
            toolContext: this.toolContext,
            recentFocusLines: this.recentFocusLines,
            referenceBuffer: this.referenceBuffer,
			getTools: () => this.registeredTools,
			getSessionId: () => this.sessionId,
            getToolCategory: (toolName: string) => this.registeredTools.find(tool => tool.name === this.normalizeToolName(toolName))?.category,
            recordSemanticToolResult: (toolName: string, input: any, result: any) => this.recordSemanticToolResult(toolName, input, result),
            buildPromptContext: (context: any, signal?: AbortSignal) => this.buildPromptContext(context, false, signal),
            buildPromptContextForMode: (context: any, mode: string, signal?: AbortSignal) => this.buildPromptContext(
                context,
                mode === 'Execution',
                signal
            ),
            checkCrossFileReferences: (uri: URI, touchedPaths: Set<string>, signal?: AbortSignal) => this.checkCrossFileReferences(uri, touchedPaths, signal),
            executeTool: (toolName: string, input: any, toolCallId?: string, signal?: AbortSignal) => this.executeTool(toolName, input, toolCallId, signal),
			onQuestionPaused: (toolCall, result) => runtimeSession.pauseForQuestion(toolCall, result),
            getToolDescriptions: () => this.getToolDescriptions()
        };
    }
}
