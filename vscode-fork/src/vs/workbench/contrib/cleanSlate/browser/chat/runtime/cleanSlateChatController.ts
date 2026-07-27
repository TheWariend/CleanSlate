/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditorService } from '../../../../../../editor/browser/services/codeEditorService.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { ICleanSlateEditCodeService, type CleanSlateExecutionFlow } from '../../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { Selection } from '../../../../../../editor/common/core/selection.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';

import { CleanSlateAgent } from '../../agent/cleanSlateAgent.js';
import { CleanSlateThreadService } from '../../core/cleanSlateThreadService.js';
import { CleanSlateTaskSessionService } from '../../core/cleanSlateTaskSessionService.js';
import { AgentPhase } from '../../agent/cleanSlatePrompts.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';

import { createTrustedTypesPolicy } from '../../../../../../base/browser/trustedTypes.js';
import { InlineCleanSlateController } from '../../../../../../editor/browser/cleanSlate/core/inlineCleanSlateController.js';
import { ChatResponse, InteractionBlock, IResponseRenderer } from '../types/cleanSlateChatTypes.js';
import { normalizeChatResponse, normalizePlanningQuestion } from './cleanSlateChatResponseNormalizer.js';
import { formatChatErrorMessage, parseStreamingJSON } from './cleanSlateStreamingResponseParser.js';
import { getRenderableSummaryRole, isAgentTaskPhase, isStableSummaryRole, selectRenderableSummaries, type SummaryRenderContext } from './cleanSlateSummaryPolicy.js';
import { CleanSlateFilesModifiedService } from '../../agent/cleanSlateFilesModifiedService.js';
import { CleanSlateFileChangeLedger } from './cleanSlateFileChangeLedger.js';
import { ICleanSlateCommandApprovalService, type ICleanSlateCommandApprovalRequest, type ICleanSlateCommandApprovalResolution } from '../../core/cleanSlateCommandApprovalService.js';
import { CleanSlateRenderPayloadCodec } from './cleanSlateRenderPayloadCodec.js';
import { CleanSlateToolPresentation } from './cleanSlateToolPresentation.js';
import { CleanSlateCompletionTimelineBuilder } from './cleanSlateCompletionTimelineBuilder.js';

export const policy = createTrustedTypesPolicy('cleanSlate-chat', {
    createHTML: (value: string) => value
});
export type { ChatResponse, CleanSlatePlanningQuestion, CleanSlatePlanningQuestionOption, InteractionBlock, IResponseRenderer } from '../types/cleanSlateChatTypes.js';

/**
 * Controller that orchestrates chat interactions between UI, agent, and thread service
 */
export class CleanSlateChatController extends Disposable {
    private readonly controllers = new Map<CleanSlateThreadService, AbortController>();
    private lastResponse: { text: string; selections: Selection[] } | undefined;
    private readonly sessionGenerating = new Map<CleanSlateThreadService, boolean>();
    private readonly _onDidChangeState = this._register(new Emitter<void>());
    readonly onDidChangeState: Event<void> = this._onDidChangeState.event;
    readonly onDidPendingEditsChange: Event<void>;

    private readonly filesModifiedService = new CleanSlateFilesModifiedService();
    private readonly fileChangeLedger = new CleanSlateFileChangeLedger();
    private readonly renderPayloadCodec = new CleanSlateRenderPayloadCodec();
    private readonly toolPresentation = new CleanSlateToolPresentation();
    private readonly completionTimelineBuilder: CleanSlateCompletionTimelineBuilder;
    private activeRenderState?: {
        messageElement: HTMLElement;
        timeline: InteractionBlock[];
        render: (isStreaming: boolean) => void;
    };

    constructor(
        @ICodeEditorService private readonly codeEditorService: ICodeEditorService,
        @ICleanSlateEditCodeService private readonly editCodeService: ICleanSlateEditCodeService,
        @INotificationService private readonly notificationService: INotificationService,
        private readonly agent: CleanSlateAgent,
        private threadService: CleanSlateThreadService,
        private taskSessionService: CleanSlateTaskSessionService,
        private readonly workspaceContextService: IWorkspaceContextService,
        private readonly sessionId: string,
        @ICleanSlateCommandApprovalService private readonly commandApprovalService: ICleanSlateCommandApprovalService
    ) {
        super();
        this.onDidPendingEditsChange = editCodeService.onDidPendingEditsChange;
        this.completionTimelineBuilder = new CleanSlateCompletionTimelineBuilder(workspaceContextService, editCodeService, this.filesModifiedService, this.fileChangeLedger);
        this._register(this.commandApprovalService.onDidRequestApproval(request => this.handleCommandApprovalRequested(request)));
        this._register(this.commandApprovalService.onDidResolveApproval(resolution => this.handleCommandApprovalResolved(resolution)));
    }

    getIsGenerating(): boolean {
        return this.sessionGenerating.get(this.threadService) ?? false;
    }

    setExternalGeneratingState(isGenerating: boolean): void {
        const current = this.getIsGenerating();
        if (current === isGenerating) {
            return;
        }

        if (isGenerating) {
            this.sessionGenerating.set(this.threadService, true);
        } else {
            this.sessionGenerating.delete(this.threadService);
        }

        this._onDidChangeState.fire();
    }

    setThreadService(threadService: CleanSlateThreadService): void {
        this.threadService = threadService;
    }

    setTaskSessionService(taskSessionService: CleanSlateTaskSessionService): void {
        this.taskSessionService = taskSessionService;
    }

    cancelActiveGenerationForSessionSwitch(): void {
        const activeController = this.controllers.get(this.threadService);
        if (activeController) {
            activeController.abort();
            this.controllers.delete(this.threadService);
        }

        this.sessionGenerating.delete(this.threadService);

        this.commandApprovalService.rejectAll(this.sessionId);

        this.activeRenderState = undefined;
        this._onDidChangeState.fire();
    }

    private setGenerating(isGenerating: boolean, callback?: (isGenerating: boolean) => void): void {
        if (isGenerating) {
            this.sessionGenerating.set(this.threadService, true);
        } else {
            this.sessionGenerating.delete(this.threadService);
        }
        if (callback) {
            callback(isGenerating);
        }
    }

    abortGeneration(renderer: IResponseRenderer): boolean {
        // The retry banner is transient run UI, not transcript content. Clear it
        // immediately even when the run is between transport attempts and there
        // is no active stream/controller left to tear down.
        renderer.clearTransportRetry();
        const controller = this.controllers.get(this.threadService);
        if (!controller) {
            if (this.getIsGenerating()) {
                this.sessionGenerating.delete(this.threadService);
                this.commandApprovalService.rejectAll(this.sessionId);
                this.activeRenderState = undefined;
                renderer.removeStreamingPlaceholders();
                this._onDidChangeState.fire();
            }
            return false;
        }

        controller.abort();
        this.controllers.delete(this.threadService);
        this.sessionGenerating.delete(this.threadService);
        this.taskSessionService.markInterrupted();
        this.commandApprovalService.rejectAll(this.sessionId);

        const state = this.activeRenderState;
        if (state) {
            try {
                state.render(true);
            } catch (error) {
                console.warn('[CleanSlateChatController] Failed to checkpoint interrupted transcript:', error);
            }
        }
        renderer.removeStreamingPlaceholders();
        this._onDidChangeState.fire();
        return true;
    }

    clearHistory(): void {
        this.threadService.clearHistory();
        this.taskSessionService.reset();
        this.lastResponse = undefined;
        this._onDidChangeState.fire();
    }

    getLastResponse(): { text: string; selections: Selection[] } | undefined {
        return this.lastResponse;
    }

    private handleCommandApprovalRequested(request: ICleanSlateCommandApprovalRequest): void {
        if (!this.isApprovalForThisSession(request)) {
            return;
        }

        const state = this.activeRenderState;
        if (!state) {
            this._onDidChangeState.fire();
            return;
        }

        const block = this.findTerminalBlockForApproval(state.timeline, request);
        if (block) {
            block.awaitingApproval = true;
            block.status = 'Awaiting approval';
            this.promoteTimelineBlock(state.timeline, block.id);
            state.render(true);
            this.revealTimelineBlock(block.id);
        }

        this._onDidChangeState.fire();
    }

    private handleCommandApprovalResolved(resolution: ICleanSlateCommandApprovalResolution): void {
        if (!this.isApprovalForThisSession(resolution.request)) {
            return;
        }

        const state = this.activeRenderState;
        if (!state) {
            this._onDidChangeState.fire();
            return;
        }

        const block = this.findTerminalBlockForApproval(state.timeline, resolution.request);
        if (block) {
            block.awaitingApproval = false;
            if (resolution.approved) {
                block.status = 'Starting';
                block.isStreaming = true;
                this.promoteTimelineBlock(state.timeline, block.id);
                state.render(true);
                this.revealTimelineBlock(block.id);
            } else {
                block.isStreaming = false;
                block.exitCode = -1;
                block.status = 'Cancelled';
                block.output = 'Command cancelled by user';
                state.render(false);
            }
        }

        this._onDidChangeState.fire();
    }

    private isApprovalForThisSession(request: ICleanSlateCommandApprovalRequest): boolean {
        return !request.sessionId || request.sessionId === this.sessionId;
    }

    private findTerminalBlockForApproval(timeline: InteractionBlock[], request: ICleanSlateCommandApprovalRequest): InteractionBlock | undefined {
        const command = this.toolPresentation.formatTerminalCommandForDisplay(request.command);
        return [...timeline].reverse().find(block =>
            block.type === 'terminal'
            && ((request.toolCallId && block.toolCallId === request.toolCallId) || (!request.toolCallId && block.command === command))
        );
    }

    private promoteTimelineBlock(timeline: InteractionBlock[], blockId: string): void {
        const index = timeline.findIndex(block => block.id === blockId);
        if (index < 0 || index === timeline.length - 1) {
            return;
        }

        const [block] = timeline.splice(index, 1);
        timeline.push(block);
    }

    private revealTimelineBlock(blockId: string): void {
        setTimeout(() => {
            const state = this.activeRenderState;
            if (!state) {
                return;
            }

            const blockElement = Array.from(state.messageElement.querySelectorAll<HTMLElement>('[data-block-id]'))
                .find(element => element.dataset.blockId === blockId);
            blockElement?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }, 0);
    }

    getHistory(): { role: string; content: string }[] {
        return this.threadService.getHistory();
    }

    private isMutationTool(toolName: string): boolean {
        return toolName === 'apply_edit'
            || toolName === 'write_file'
            || toolName === 'create_and_write_file'
            || toolName === 'create_multiple_files'
            || toolName === 'multi_file_replace';
    }

    private isCommandExecutionTool(toolName: string): boolean {
        return toolName === 'execute_command' || toolName === 'start_background_command';
    }

    private formatCommandProgressStatus(status: string): string {
        switch (status) {
            case 'ready':
                return 'Ready';
            case 'timeout':
                return 'Timed out';
            case 'failed':
                return 'Failed';
            case 'running':
                return 'Running';
            default:
                return status;
        }
    }

    private getCommandResultStatus(toolName: string, result: any): string {
        if (toolName === 'start_background_command') {
            if (result?.status === 'ready') {
                return 'Ready';
            }
            if (result?.status === 'running') {
                return 'Running';
            }
            if (result?.success === false || result?.status === 'failed') {
                return 'Failed';
            }
            return result?.status || 'Started';
        }

        if (result?.status === 'ready') {
            return 'Ready';
        }
        if (result?.status === 'running') {
            return 'Running';
        }
        if (result?.status === 'timeout' || result?.timedOut === true) {
            return 'Timed out';
        }
        return result?.success === false ? 'Failed' : 'Completed';
    }

    private formatCommandResultOutput(result: any): string {
        const parts: string[] = [];
        if (typeof result?.url === 'string' && result.url.trim().length > 0) {
            parts.push(`URL: ${result.url.trim()}`);
        }
        if (typeof result?.output === 'string' && result.output.trim().length > 0) {
            parts.push(result.output.trimEnd());
        } else {
            if (typeof result?.stdout === 'string' && result.stdout.trim().length > 0) {
                parts.push(result.stdout.trimEnd());
            }
            if (typeof result?.stderr === 'string' && result.stderr.trim().length > 0) {
                parts.push(result.stderr.trimEnd());
            }
        }
        if (typeof result?.error === 'string' && result.error.trim().length > 0) {
            parts.push(result.error.trim());
        }
        return parts.join('\n\n');
    }

    private isConfirmedMutationResult(toolName: string, result: any): boolean {
        if (!this.isMutationTool(toolName) || result?.success === false) {
            return false;
        }

        switch (toolName) {
            case 'apply_edit':
                return typeof result?.appliedBlocks === 'number' && result.appliedBlocks > 0;
            case 'multi_file_replace':
                return Array.isArray(result?.results) && result.results.length > 0;
            case 'create_multiple_files':
                return Array.isArray(result?.created) && result.created.length > 0;
            case 'write_file':
            case 'create_and_write_file':
                return result?.persisted === true || result?.created === true;
            default:
                return false;
        }
    }

    private reconcileCompletedFilesWidget(
        timeline: InteractionBlock[],
        turnId: string | undefined,
        mode: string
    ): boolean {
        const taskChanges = this.taskSessionService.getExecutionFilesChanged().map(change => ({
            ...change,
            path: this.completionTimelineBuilder.canonicalWorkspaceFilePath(change.path)
        }));
        const ledgerChanges = this.fileChangeLedger.getChanges();
        const filesChanged = this.filesModifiedService.mergeFileChanges(taskChanges, ledgerChanges);
        if (filesChanged.length === 0) {
            return false;
        }

        return this.completionTimelineBuilder.upsertFinishTaskSummaryBlock(
            timeline,
            turnId,
            {
                completionSummary: {
                    status: 'completed',
                    filesChanged
                }
            },
            this.usesPlanningFlow(mode),
            true
        );
    }

    private normalizeMode(mode: string | undefined): CleanSlateExecutionFlow {
        const normalized = (mode || '').trim().toLowerCase();
        if (normalized === 'planning') {
            return normalized;
        }
        return 'normal';
    }

    private usesPlanningFlow(mode: string | undefined): boolean {
        const executionFlow = this.normalizeMode(mode);
        return executionFlow === 'planning';
    }

    private stripOptimisticNarrative(parsed: ChatResponse | undefined, isTurnStreaming: boolean): ChatResponse {
        if (!parsed) {
            return {};
        }
        if (!isTurnStreaming) {
            return parsed;
        }
        return {
            ...parsed,
            summary: undefined
        };
    }

    private createNarrativeBlockId(turnId: string, type: 'summary', summaryRole: InteractionBlock['summaryRole'] | undefined, index: number): string {
        return `narrative-${turnId}-${type}-${summaryRole || 'default'}-${index}`;
    }

    private syncNarrativeBlocks(
        timeline: InteractionBlock[],
        turnId: string,
        type: 'summary',
        contents: string[],
        isStreaming: boolean,
        summaryRole?: InteractionBlock['summaryRole']
    ): void {
        const targetTimeline = timeline;
        const sanitizedContents = contents.filter(c => typeof c === 'string' && c.trim().length > 0);
        if (sanitizedContents.length === 0 && isStableSummaryRole(summaryRole)) {
            return;
        }

        const blockIdPrefix = `narrative-${turnId}-${type}-${summaryRole || 'default'}-`;
        const activeIds = new Set(sanitizedContents.map((_, index) => this.createNarrativeBlockId(turnId, type, summaryRole, index)));

        for (let i = targetTimeline.length - 1; i >= 0; i--) {
            const block = targetTimeline[i];
            if (block.type === type && block.id.startsWith(blockIdPrefix) && !activeIds.has(block.id)) {
                targetTimeline.splice(i, 1);
            }
        }

        sanitizedContents.forEach((content, index) => {
            const id = this.createNarrativeBlockId(turnId, type, summaryRole, index);
            let block = targetTimeline.find(entry => entry.id === id);

            if (!block) {
                block = { id, type, content, summaryRole, isStreaming };
                targetTimeline.push(block);
            } else {
                block.summaryRole = summaryRole;
                if (!isStableSummaryRole(summaryRole)) {
                    block.content = content;
                }
                block.isStreaming = isStreaming;
            }
        });
    }

    private syncPlanningSummaryBlocks(
        timeline: InteractionBlock[],
        turnId: string,
        summary: ChatResponse['summary'],
        context: SummaryRenderContext,
        isStreaming: boolean
    ): boolean {
        if (context.phase !== AgentPhase.PLANNING) {
            return false;
        }
        const previousSummaryBlock = [...timeline].reverse().find(block => block.type === 'summary' && typeof block.content === 'string' && block.content.trim().length > 0);
        const summaries = selectRenderableSummaries(summary, {
            ...context,
            previousProgressSummary: context.previousProgressSummary ?? previousSummaryBlock?.content
        })
            .slice(0, 1)
            .filter(entry => !this.completionTimelineBuilder.hasSummaryBlockWithContent(timeline, entry));
        if (summaries.length === 0) {
            return false;
        }
        this.syncNarrativeBlocks(
            timeline,
            turnId,
            'summary',
            summaries,
            isStreaming,
            getRenderableSummaryRole(context)
        );
        return true;
    }

    private withRenderableTurnSummary(parsed: ChatResponse, phase: string | undefined): ChatResponse {
        if (!isAgentTaskPhase(phase)) {
            return parsed;
        }
        return { ...parsed, summary: undefined };
    }

    private buildPlanningArtifactHandoffPayload(summary: string | undefined): ChatResponse {
        return {
            ...(summary ? { summary } : {}),
            files_created: ['implementation_plan.md']
        };
    }

    private upsertPlanningHandoffSummaryBlock(timeline: InteractionBlock[], turnId: string | undefined, summary: string): void {
        const normalizedSummary = this.completionTimelineBuilder.normalizeSummaryContent(summary);
        if (!normalizedSummary) {
            return;
        }

        const targetTimeline = timeline;
        const id = turnId ? `planning-handoff-${turnId}` : 'planning-handoff';
        let block = targetTimeline.find(entry => entry.id === id);

        if (!block) {
            block = {
                id,
                type: 'summary',
                content: normalizedSummary,
                summaryRole: 'completion',
                isStreaming: false
            };
            targetTimeline.push(block);
            return;
        }

        block.type = 'summary';
        block.content = normalizedSummary;
        block.summaryRole = 'completion';
        block.isStreaming = false;
    }

	private getAssistantTextBlockId(turnId: string | undefined): string {
		return turnId ? `assistant-text-${turnId}` : 'assistant-text-active';
	}

	private upsertContextCompactionBlock(timeline: InteractionBlock[], turnId: string, compacted: boolean | undefined): void {
		const id = `context-compaction-${turnId}`;
		const existingIndex = timeline.findIndex(block => block.id === id);
		if (compacted === false) {
			if (existingIndex >= 0) {
				timeline.splice(existingIndex, 1);
			}
			return;
		}

		const status = compacted === true ? 'Context compacted' : 'Compacting context...';
		const block = existingIndex >= 0 ? timeline[existingIndex] : undefined;
		if (block) {
			block.type = 'file';
			block.status = status;
			block.isStreaming = compacted !== true;
			return;
		}

		timeline.push({
			id,
			type: 'file',
			status,
			isStreaming: compacted !== true
		});
	}

    private upsertAssistantTextBlock(timeline: InteractionBlock[], turnId: string | undefined, content: string, isStreaming: boolean): void {
        const rawContent = typeof content === 'string' ? content : '';
        const visibleContent = isStreaming ? rawContent.trimStart() : rawContent.trim();
        const id = this.getAssistantTextBlockId(turnId);
        if (!visibleContent.trim()) {
            const existingIndex = timeline.findIndex(entry => entry.id === id && entry.type === 'assistant_text');
            if (existingIndex >= 0) {
                timeline.splice(existingIndex, 1);
            }
            return;
        }

        let block = timeline.find(entry => entry.id === id);
        if (!block) {
            block = {
                id,
                type: 'assistant_text',
                content: visibleContent,
                isStreaming
            };
            timeline.push(block);
            return;
        }

        block.type = 'assistant_text';
        block.summaryRole = undefined;
        block.content = visibleContent;
        block.isStreaming = isStreaming;
    }

    private markAssistantTextBlockComplete(timeline: InteractionBlock[], turnId: string | undefined): void {
        const id = this.getAssistantTextBlockId(turnId);
        const block = timeline.find(entry => entry.id === id);
        if (block?.type === 'assistant_text') {
            block.isStreaming = false;
        }
    }

    private getReasoningBlockId(turnId: string | undefined): string {
        // Each model turn gets its OWN reasoning disclosure, positioned in the
        // timeline where the thought actually occurred — interleaved with the
        // tool calls and assistant text of the surrounding turns. A shared id
        // used to fold every turn's thinking into one widget at the head, so a
        // later turn's thought appeared to replace the earlier one in place.
        return turnId ? `reasoning-${turnId}` : 'reasoning-active';
    }

    private upsertReasoningBlock(timeline: InteractionBlock[], turnId: string | undefined, content: string, isStreaming: boolean): void {
        const rawContent = typeof content === 'string' ? content : '';
        const id = this.getReasoningBlockId(turnId);
        if (!rawContent.trim()) {
            return;
        }

        let block = timeline.find(entry => entry.id === id);
        if (!block) {
            block = {
                id,
                type: 'reasoning',
                content: '',
                isStreaming: false,
                reasoningDurationMs: 0,
                reasoningSegments: []
            };
            timeline.push(block);
        }

        const segmentId = turnId || 'active';
        const segments = block.reasoningSegments ?? [];
        let segment = segments.find(entry => entry.id === segmentId);
        if (!segment) {
            segment = { id: segmentId, content: '' };
            segments.push(segment);
        }
        segment.content = rawContent;
        if (isStreaming && segment.startedAt === undefined) {
            segment.startedAt = Date.now();
        }

        block.type = 'reasoning';
        block.reasoningSegments = segments;
        block.content = segments
            .map(entry => entry.content.trim())
            .filter(Boolean)
            .join('\n\n');
        block.isStreaming = isStreaming;
        block.reasoningStartedAt = isStreaming ? segment.startedAt : undefined;
        block.reasoningDurationMs = segments.reduce((total, entry) => total + (entry.durationMs ?? 0), 0);
    }

    private markReasoningBlockComplete(timeline: InteractionBlock[], turnId: string | undefined): void {
        const block = timeline.find(entry => entry.id === this.getReasoningBlockId(turnId));
        if (block?.type !== 'reasoning') {
            return;
        }

        const segmentId = turnId || 'active';
        const segment = block.reasoningSegments?.find(entry => entry.id === segmentId);
        if (segment && typeof segment.startedAt === 'number') {
            segment.durationMs = (segment.durationMs ?? 0) + Math.max(0, Date.now() - segment.startedAt);
            segment.startedAt = undefined;
        }
        block.isStreaming = block.reasoningSegments?.some(entry => typeof entry.startedAt === 'number') === true;
        block.reasoningStartedAt = block.reasoningSegments?.find(entry => typeof entry.startedAt === 'number')?.startedAt;
        block.reasoningDurationMs = block.reasoningSegments?.reduce((total, entry) => total + (entry.durationMs ?? 0), 0) ?? 0;
    }

    private removeReasoningBlock(timeline: InteractionBlock[], turnId: string | undefined): void {
        const id = this.getReasoningBlockId(turnId);
        const index = timeline.findIndex(entry => entry.id === id && entry.type === 'reasoning');
        if (index < 0) {
            return;
        }

        const block = timeline[index];
        const segmentId = turnId || 'active';
        if (!block.reasoningSegments) {
            timeline.splice(index, 1);
            return;
        }

        block.reasoningSegments = block.reasoningSegments.filter(entry => entry.id !== segmentId);
        if (block.reasoningSegments.length === 0) {
            timeline.splice(index, 1);
            return;
        }

        block.content = block.reasoningSegments
            .map(entry => entry.content.trim())
            .filter(Boolean)
            .join('\n\n');
        block.isStreaming = block.reasoningSegments.some(entry => typeof entry.startedAt === 'number');
        block.reasoningStartedAt = block.reasoningSegments.find(entry => typeof entry.startedAt === 'number')?.startedAt;
        block.reasoningDurationMs = block.reasoningSegments.reduce((total, entry) => total + (entry.durationMs ?? 0), 0);
    }

    private hasAssistantTextBlock(timeline: InteractionBlock[], turnId?: string): boolean {
        const id = turnId ? this.getAssistantTextBlockId(turnId) : undefined;
        return timeline.some(block =>
            block.type === 'assistant_text'
            && (!id || block.id === id)
            && typeof block.content === 'string'
            && block.content.trim().length > 0
        );
    }

    private createFileTimelineBlockId(kind: 'read' | 'mutation', normalizedPath: string, turnId?: string): string {
        if (kind === 'read') {
            return `group-activity-block-${turnId || 'global'}`;
        }
        const basename = this.basenameFromPath(normalizedPath);
        const safePath = this.toBlockIdSegment(basename);
        // Unique per call: every edit of a file gets its own widget with its own
        // diff, instead of later edits folding into the first widget in place.
        return `file-${kind}-${safePath || 'unknown'}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    }

    private findReusableFailedMutationBlock(blocks: InteractionBlock[], normalizedPath: string): InteractionBlock | undefined {
        // A retry after a failed edit updates the Failed card in place; only the
        // most recent widget for the path qualifies — once a later attempt has
        // succeeded, new edits get their own widget again.
        for (let index = blocks.length - 1; index >= 0; index--) {
            const block = blocks[index];
            if (block.type === 'file'
                && block.id.startsWith('file-mutation-')
                && this.completionTimelineBuilder.normalizeFileTimelinePath(block.path) === normalizedPath) {
                return block.status === 'Failed' ? block : undefined;
            }
        }
        return undefined;
    }

    private findPendingMutationBlock(blocks: InteractionBlock[], normalizedPath: string): InteractionBlock | undefined {
        for (let index = blocks.length - 1; index >= 0; index--) {
            const block = blocks[index];
            if (block.type === 'file'
                && block.isStreaming
                && block.id.startsWith('file-mutation-')
                && this.completionTimelineBuilder.normalizeFileTimelinePath(block.path) === normalizedPath) {
                return block;
            }
        }
        return undefined;
    }

    private findTimelineBlock(blocks: InteractionBlock[], blockId: string): InteractionBlock | undefined {
        for (const block of blocks) {
            if (block.id === blockId) {
                return block;
            }
            if (block.type === 'turn' && Array.isArray(block.blocks)) {
                const child = this.findTimelineBlock(block.blocks, blockId);
                if (child) {
                    return child;
                }
            }
        }
        return undefined;
    }

    private shouldCreateGenericToolBlock(toolName: string): boolean {
        void toolName;
        return false;
    }

    private isAuxiliaryCommandStatusTool(toolName: string): boolean {
        return toolName === 'read_background_command';
    }

    private attachAuxiliaryToolError(timeline: InteractionBlock[], toolName: string, result: any): void {
        const message = this.describeAuxiliaryToolError(toolName, result);
        const host = this.findAuxiliaryToolErrorHost(timeline);
        if (!host) {
            return;
        }

        if (host.type === 'terminal') {
            const existingOutput = typeof host.output === 'string' ? host.output.trimEnd() : '';
            host.output = existingOutput ? `${existingOutput}\n\n${message}` : message;
            host.status = 'Failed';
            host.exitCode = typeof host.exitCode === 'number' ? host.exitCode : 1;
            host.isStreaming = false;
            return;
        }

        host.details = host.details || [];
        if (!host.details.includes(message)) {
            host.details.push(message);
        }
        if (host.type === 'file') {
            host.status = host.status || 'Failed';
        }
    }

    private findAuxiliaryToolErrorHost(blocks: InteractionBlock[]): InteractionBlock | undefined {
        for (let index = blocks.length - 1; index >= 0; index--) {
            const block = blocks[index];
            if (block.type === 'turn' && Array.isArray(block.blocks)) {
                const nested = this.findAuxiliaryToolErrorHost(block.blocks);
                if (nested) {
                    return nested;
                }
            }
            if (block.type === 'browser' || block.type === 'terminal' || block.type === 'file') {
                return block;
            }
        }
        return undefined;
    }

    private describeAuxiliaryToolError(toolName: string, result: any): string {
        const detail = typeof result?.error === 'string' && result.error.trim().length > 0
            ? result.error.trim()
            : typeof result?.message === 'string' && result.message.trim().length > 0
                ? result.message.trim()
                : typeof result?.status === 'string' && result.status.trim().length > 0
                    ? result.status.trim()
                    : 'failed';
        const formattedToolName = toolName
            .replace(/^mcp_/, 'MCP ')
            .split(/[_\s-]+/)
            .filter(Boolean)
            .map(part => part.length <= 2 ? part.toUpperCase() : `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
            .join(' ');
        return `Error: ${formattedToolName} ${detail}`;
    }

    private isDiscoveryTool(toolName: string): boolean {
        return ['list_dir', 'find_by_name', 'grep_search', 'search_workspace', 'semantic_search', 'search_codebase', 'get_open_files', 'read_symbols', 'get_definitions', 'find_references', 'read_reference', 'read_lints', 'read_browser_page', 'read_url_content', 'read_file', 'read_file_range'].includes(toolName);
    }

    private isDiscoveryReadActivityTool(toolName: string): boolean {
        return toolName.startsWith('read_file') || toolName === 'get_open_files';
    }

    private getDiscoveryActivityPath(toolName: string, input: any): string {
        if (toolName === 'get_open_files') {
            return 'open files';
        }

        return input.path || input.pattern || input.query || input.Url || '.';
    }

    private getDiscoveryActivityLabel(toolName: string, input: any, path: string): string {
        if (toolName === 'get_open_files') {
            return 'open files';
        }

        const pattern = this.getDiscoveryActivityQuery(input);
        return pattern || this.basenameFromPath(path) || path;
    }

    private getDiscoveryActivityQuery(input: any): string | undefined {
        const query = input?.pattern || input?.query;
        return typeof query === 'string' && query.trim().length > 0 ? query.trim() : undefined;
    }

    private getDiscoveryActivityDetail(toolName: string, input: any, path: string): { detailText: string; range?: string } {
        const displayLabel = this.getDiscoveryActivityLabel(toolName, input, path);
        if (toolName === 'read_file_range') {
            const start = input.startLine || input.start_line;
            const end = input.endLine || input.end_line;
            const range = `${start}-${end}`;
            return {
                detailText: `Reading ${displayLabel} #${range}`,
                range
            };
        }

        if (this.isDiscoveryReadActivityTool(toolName)) {
            return { detailText: `Reading ${displayLabel}` };
        }

        const pattern = this.getDiscoveryActivityQuery(input);
        return { detailText: pattern ? `Exploring ${pattern}` : `Exploring ${path}` };
    }

    private upsertMutationTimelineBlock(
        timeline: InteractionBlock[],
        path: string | undefined,
        status: string,
        isStreaming: boolean,
        stats?: { added?: number; deleted?: number }
    ): InteractionBlock | undefined {
        if (typeof path !== 'string' || path.trim().length === 0) {
            return undefined;
        }

        const canonicalPath = this.completionTimelineBuilder.canonicalWorkspaceFilePath(path) || path;
        const normalizedPath = this.completionTimelineBuilder.normalizeFileTimelinePath(canonicalPath);
        if (!normalizedPath || normalizedPath.endsWith('implementation_plan.md')) {
            return undefined;
        }

        const targetBlocks = timeline;
        let block = this.findPendingMutationBlock(targetBlocks, normalizedPath);
        if (!block) {
            block = this.findReusableFailedMutationBlock(targetBlocks, normalizedPath);
            if (block) {
                const blockWithDiff = block as InteractionBlock & { diff?: string; beforeContent?: string; afterContent?: string };
                blockWithDiff.diff = undefined;
                blockWithDiff.beforeContent = undefined;
                blockWithDiff.afterContent = undefined;
                block.added = 0;
                block.deleted = 0;
            }
        }
        if (!block) {
            block = {
                id: this.createFileTimelineBlockId('mutation', normalizedPath),
                type: 'file',
                path: canonicalPath,
                status,
                isStreaming,
                fileCount: 0,
                searchCount: 0,
                details: []
            };
            targetBlocks.push(block);
        }

        block.path = canonicalPath;
        block.status = status;
        block.isStreaming = isStreaming;
        if (typeof stats?.added === 'number' && Number.isFinite(stats.added)) {
            block.added = Math.max(0, Math.floor(stats.added));
        }
        if (typeof stats?.deleted === 'number' && Number.isFinite(stats.deleted)) {
            block.deleted = Math.max(0, Math.floor(stats.deleted));
        }
        return block;
    }

    private addPendingMutationBlocks(timeline: InteractionBlock[], toolName: string, input: any): void {
        if (toolName === 'apply_edit') {
            this.upsertMutationTimelineBlock(
                timeline,
                input?.path,
                'Editing...',
                true,
                { added: 0, deleted: 0 }
            );
            return;
        }

        if (toolName === 'multi_file_replace') {
            const entries = Array.isArray(input?.edits) ? input.edits : [];
            for (const entry of entries) {
                this.upsertMutationTimelineBlock(
                    timeline,
                    entry?.path,
                    'Editing...',
                    true,
                    { added: 0, deleted: 0 }
                );
            }
            return;
        }

        if (toolName === 'write_file' || toolName === 'create_and_write_file') {
            this.upsertMutationTimelineBlock(
                timeline,
                input?.file_path ?? input?.path,
                'Writing...',
                true,
                { added: 0, deleted: 0 }
            );
            return;
        }

        if (toolName === 'create_multiple_files') {
            const files = Array.isArray(input?.files) ? input.files : [];
            for (const file of files) {
                this.upsertMutationTimelineBlock(
                    timeline,
                    file?.path,
                    'Creating...',
                    true,
                    { added: 0, deleted: 0 }
                );
            }
        }
    }

    private basenameFromPath(path: string): string {
        const normalized = this.completionTimelineBuilder.normalizePathSeparators(path);
        const index = normalized.lastIndexOf('/');
        return index >= 0 ? normalized.slice(index + 1) : normalized;
    }

    private toBlockIdSegment(value: string): string {
        let result = '';
        let pendingDash = false;
        for (const char of value.toLowerCase()) {
            const code = char.charCodeAt(0);
            const isAlpha = code >= 97 && code <= 122;
            const isDigit = code >= 48 && code <= 57;
            if (isAlpha || isDigit) {
                if (pendingDash && result.length > 0) {
                    result += '-';
                }
                pendingDash = false;
                result += char;
            } else {
                pendingDash = result.length > 0;
            }
        }
        return result;
    }

    async sendMessage(
        text: string,
        renderer: IResponseRenderer,
        mode: string,
        onGeneratingChange?: (isGenerating: boolean) => void,
        existingMessageElement?: HTMLElement,
        images?: string[]
    ): Promise<void> {
        const editor = this.codeEditorService.getActiveCodeEditor();
        const selections = editor ? [...(editor.getSelections() || [])] : [];

        this.fileChangeLedger.clear();
        const controller = new AbortController();
        this.controllers.set(this.threadService, controller);
        const sessionAtStart = this.threadService;

        try {
            const normalizedMode = this.normalizeMode(mode);
            const messageElement = existingMessageElement ?? renderer.addMessage('', 'cleanSlate');
            let currentTurnText = '';
            let currentTurnAssistantText = '';
            let currentTurnReasoning = '';
            let currentTurnParsed: ChatResponse = {};

            let currentTurnId: string | undefined;
            let currentTurnIndex: number | undefined;
            let currentTurnPhase: string | undefined;
            let currentTurnHasToolCalls = false;
            let currentTurnHasPlanningQuestion = false;
            let currentTurnSummaryDeferredToToolResult = false;
            let currentTurnHasConfirmedMutation = false;
            const terminalOutputs: { [cmd: string]: { output: string; exitCode: number } } = {};
            const terminalCommands: string[] = [];
            const timeline: InteractionBlock[] = [];
            const pendingToolActivitySectionIds = new Map<string, string>();
            const pendingBrowserBlockIds = new Map<string, string>();
            const pendingWebBlockIds = new Map<string, string>();
            const pendingGenericToolBlockIds = new Map<string, string>();
            let pendingMutationToolCount = 0;
            let activitySectionIndex = 0;
            let didReportRenderError = false;
            let lastKnownParsed: ChatResponse = {};
			let didRenderPlanningFinalResult = false;
			let assistantTurnCompleted = false;
			let pendingPlanningHandoffSummary: string | undefined;
			let didShowModelTerminatedPause = false;
			let didReceiveTaskFinished = false;
			let runHasConfirmedMutation = false;

			let activeToolName: string | undefined;

            const render = (isStreaming: boolean) => {
                try {
                    const isTurnStreaming = typeof currentTurnId === 'string' && currentTurnId.length > 0;
                    const parsedSource = Object.keys(currentTurnParsed).length > 0 ? currentTurnParsed : lastKnownParsed;
                    const parsed: ChatResponse = {
                        ...this.stripOptimisticNarrative(parsedSource, isTurnStreaming && isAgentTaskPhase(currentTurnPhase)),
                        timeline: this.usesPlanningFlow(normalizedMode) && !didRenderPlanningFinalResult
                            ? this.completionTimelineBuilder.withoutFinishBlocks(timeline)
                            : [...timeline],
                        lastToolName: activeToolName,
                        executionFlow: normalizedMode
                    };

                    // Fallbacks for to do items
                    if (parsed.to_do?.length === 0 && lastKnownParsed.to_do?.length) parsed.to_do = lastKnownParsed.to_do;
                    if (parsed.files_accessed?.length === 0 && lastKnownParsed.files_accessed?.length) parsed.files_accessed = lastKnownParsed.files_accessed;
                    if (parsed.files_created?.length === 0 && lastKnownParsed.files_created?.length) parsed.files_created = lastKnownParsed.files_created;

                    // Do not show optimistic summary text while mutation tools are still in flight.
                    if (pendingMutationToolCount > 0) {
                        parsed.summary = undefined;
                    }

                    parsed.terminal_outputs = { ...terminalOutputs };
                    (parsed as any).terminal_commands = [...terminalCommands];

                    renderer.renderJSONResponse(parsed, isStreaming, messageElement);
                } catch (error) {
                    console.error('[CleanSlateChatController] render error:', error);
                    if (!didReportRenderError) {
                        didReportRenderError = true;
                        renderer.addMessage(`UI render error: ${formatChatErrorMessage(error)}`, 'cleanSlate');
                    }
                }
            };

            let pendingChatTextRenderFrame: number | undefined;
            const cancelScheduledChatTextRender = () => {
                if (pendingChatTextRenderFrame === undefined) {
                    return;
                }

                messageElement.ownerDocument.defaultView?.cancelAnimationFrame(pendingChatTextRenderFrame);
                pendingChatTextRenderFrame = undefined;
            };
            const scheduleChatTextRender = () => {
                if (pendingChatTextRenderFrame !== undefined) {
                    return;
                }

                const win = messageElement.ownerDocument.defaultView;
                if (!win) {
                    render(true);
                    return;
                }

                pendingChatTextRenderFrame = win.requestAnimationFrame(() => {
                    pendingChatTextRenderFrame = undefined;
                    render(true);
                });
            };

            const pendingToolInputs = new Map<string, any>();
            const pendingToolInputsByCallId = new Map<string, any>();
            this.activeRenderState = { messageElement, timeline, render };

            renderer.renderJSONResponse({}, true, messageElement);
            this.setGenerating(true, onGeneratingChange);
            this._onDidChangeState.fire();

            const stream = await this.agent.sendMessage(text, selections, mode, controller.signal, images, status => {
                if (controller.signal.aborted) {
                    renderer.clearTransportRetry();
                } else if (status.state === 'retrying') {
                    renderer.showTransportRetry(status);
                } else {
                    renderer.clearTransportRetry();
                }
            });
            this._onDidChangeState.fire();

            for await (const event of stream) {
                if (controller.signal.aborted) break;

				if (event.type === 'transport_status') {
					if (event.status.state === 'retrying') {
						renderer.showTransportRetry(event.status);
					} else {
						renderer.clearTransportRetry();
					}
					continue;
				}

				if (event.type === 'assistant_turn_start') {
                    currentTurnId = event.turnId;
                    currentTurnIndex = event.turnIndex;
                    currentTurnPhase = event.phase;
                    currentTurnText = '';
                    currentTurnAssistantText = '';
                    currentTurnReasoning = '';
                    currentTurnParsed = {};
                    currentTurnHasToolCalls = false;
                    currentTurnHasPlanningQuestion = false;
                    currentTurnSummaryDeferredToToolResult = false;
                    currentTurnHasConfirmedMutation = false;

                    render(true);
					this._onDidChangeState.fire();
				} else if (event.type === 'context_compaction_start') {
					this.upsertContextCompactionBlock(timeline, event.turnId, undefined);
					render(true);
					this._onDidChangeState.fire();
				} else if (event.type === 'context_compaction_complete') {
					this.upsertContextCompactionBlock(timeline, event.turnId, event.compacted);
					render(true);
					this._onDidChangeState.fire();
				} else if (event.type === 'context_usage') {
					// Context usage remains available to the runtime for budgeting,
					// but it is intentionally not shown in the transcript.
				} else if (event.type === 'text') {
                    currentTurnText += event.content;
                    currentTurnParsed = parseStreamingJSON(currentTurnText);
                    currentTurnHasPlanningQuestion = currentTurnHasPlanningQuestion || !!currentTurnParsed.planning_question;

                    if (currentTurnId && currentTurnPhase === AgentPhase.PLANNING) {
                        this.syncPlanningSummaryBlocks(
                            timeline,
                            currentTurnId,
                            currentTurnParsed.summary,
                            {
                                phase: currentTurnPhase,
                                turnIndex: currentTurnIndex,
                                hasToolCalls: currentTurnHasToolCalls,
                                hasPlanningQuestion: currentTurnHasPlanningQuestion,
                                isSummaryDeferredToToolResult: currentTurnSummaryDeferredToToolResult,
                                isStreaming: false
                            },
                            true
                        );
                    }

                    render(true);
                } else if (event.type === 'chat_text') {
                    if (event.kind === 'model_terminated_pause') {
                        cancelScheduledChatTextRender();
                        if (!didShowModelTerminatedPause) {
                            didShowModelTerminatedPause = true;
                            this.showModelTerminatedPauseMessage(event.content, renderer, normalizedMode, onGeneratingChange);
                        }
                        continue;
                    }
                    currentTurnAssistantText += event.content;
                    this.upsertAssistantTextBlock(timeline, currentTurnId, currentTurnAssistantText, true);
                    scheduleChatTextRender();
                } else if (event.type === 'chat_text_reset') {
                    currentTurnAssistantText = '';
                    this.upsertAssistantTextBlock(timeline, currentTurnId, '', true);
                    scheduleChatTextRender();
                } else if (event.type === 'reasoning') {
                    currentTurnReasoning += event.content;
                    this.upsertReasoningBlock(timeline, currentTurnId, currentTurnReasoning, true);
                    scheduleChatTextRender();
                } else if (event.type === 'reasoning_reset') {
                    // The turn's thinking text was promoted to the final answer: drop the
                    // thinking block so the same text is not shown in both places.
                    currentTurnReasoning = '';
                    this.removeReasoningBlock(timeline, currentTurnId);
                    scheduleChatTextRender();
                } else if (event.type === 'assistant_turn_complete') {
                    cancelScheduledChatTextRender();
                    assistantTurnCompleted = true;
                    currentTurnId = event.turnId;
                    currentTurnIndex = event.turnIndex;
                    currentTurnHasPlanningQuestion = currentTurnHasPlanningQuestion || !!currentTurnParsed.planning_question;

                    if (currentTurnId) {
                        this.markAssistantTextBlockComplete(timeline, currentTurnId);
                        this.markReasoningBlockComplete(timeline, currentTurnId);
                    }

                    const normalizedCurrentTurn = normalizeChatResponse(
                        this.withRenderableTurnSummary(currentTurnParsed, currentTurnPhase)
                    );
                    if (this.renderPayloadCodec.hasRenderableResponsePayload(normalizedCurrentTurn)) {
                        lastKnownParsed = {
                            ...lastKnownParsed,
                            ...normalizedCurrentTurn,
                            to_do: normalizedCurrentTurn.to_do?.length ? normalizedCurrentTurn.to_do : lastKnownParsed.to_do,
                            files_accessed: normalizedCurrentTurn.files_accessed?.length ? normalizedCurrentTurn.files_accessed : lastKnownParsed.files_accessed,
                            files_created: normalizedCurrentTurn.files_created?.length ? normalizedCurrentTurn.files_created : lastKnownParsed.files_created
                        };
                    }

                    currentTurnText = '';
                    currentTurnAssistantText = '';
                    currentTurnReasoning = '';
                    currentTurnParsed = {};
                    render(true);
                    this._onDidChangeState.fire();
                } else if (event.type === 'tool_start') {
                    const toolName = event.toolName;
                    // Thinking for this turn is done once tool work starts — collapse the
                    // streamed reasoning into a "Thought" block above the tool activity.
                    this.markReasoningBlockComplete(timeline, currentTurnId);
                    pendingToolInputs.set(toolName, event.input);
                    if (event.toolCallId) {
                        pendingToolInputsByCallId.set(event.toolCallId, event.input);
                    }
                    activeToolName = toolName;
                    const timestamp = Date.now();
                    const randomSuffix = Math.floor(Math.random() * 10000);
                    const isMutationTool = this.isMutationTool(toolName);
                    const startLabel = this.toolPresentation.describeToolStart(toolName, event.input);

                    currentTurnHasToolCalls = true;
                    if (isMutationTool) {
                        pendingMutationToolCount++;
                    }
                    if (toolName === 'submit_artifact') {
                        currentTurnSummaryDeferredToToolResult = true;
                    }

                    this.taskSessionService.recordToolStart(toolName, startLabel);
                    this._onDidChangeState.fire();

                    if (this.isCommandExecutionTool(toolName) && event.input.command) {
                        let cmd = event.input.command;

                        // Silence internal lifecycle/probe commands
                        if (cmd.includes('__CLEANSLATE_CMD') || cmd.includes('pprintf')) {
                            return;
                        }

                        cmd = this.toolPresentation.formatTerminalCommandForDisplay(cmd);

                        terminalCommands.push(cmd);
                        timeline.push({
                            id: `term-${timestamp}-${randomSuffix}`,
                            type: 'terminal',
                            toolCallId: event.toolCallId,
                            command: cmd,
                            output: '',
                            isStreaming: true
                        });
                        this.revealTimelineBlock(`term-${timestamp}-${randomSuffix}`);
                        render(true);
                    } else if (isMutationTool) {
                        this.addPendingMutationBlocks(timeline, toolName, event.input);
                        render(true);
                    } else if (this.isDiscoveryTool(toolName)) {
                        const input = event.input || {};
                        const path = this.getDiscoveryActivityPath(toolName, input);
                        const isRead = this.isDiscoveryReadActivityTool(toolName);
                        const query = isRead ? undefined : this.getDiscoveryActivityQuery(input);
                        const discoveryScope = typeof input?.path === 'string'
                            ? input.path
                            : typeof input?.SearchPath === 'string'
                                ? input.SearchPath
                                : typeof input?.Url === 'string'
                                    ? input.Url
                                    : undefined;
                        if (typeof discoveryScope === 'string' && discoveryScope.trim().length > 0) {
                            this.taskSessionService.recordDiscoveredPaths([discoveryScope]);
                        }

                        // Consecutive tool activity merges into one disclosure regardless of how
                        // many model turns it spans; any interleaved block (assistant text,
                        // thinking, terminal, file edit, …) ends the run and the next discovery
                        // call opens a fresh section.
                        const targetBlocks = timeline;
                        const lastBlock = targetBlocks[targetBlocks.length - 1];
                        let activityBlockId: string;
                        if (lastBlock && lastBlock.id.startsWith('group-activity-block-')) {
                            activityBlockId = lastBlock.id;
                        } else {
                            activitySectionIndex++;
                            activityBlockId = `group-activity-block-${activitySectionIndex}`;
                        }
                        pendingToolActivitySectionIds.set(toolName, activityBlockId);
                        let activityBlock = targetBlocks.find(b => b.id === activityBlockId);

                        if (activityBlock) {
                            if (isRead) {
                                activityBlock.fileCount = (activityBlock.fileCount || 0) + 1;
                            } else {
                                activityBlock.searchCount = (activityBlock.searchCount || 0) + 1;
                            }
                            const { detailText, range } = this.getDiscoveryActivityDetail(toolName, input, path);

                            // Resolve absolute path for click-to-open
                            let absolutePath: string | undefined = toolName === 'get_open_files' ? undefined : path;
                            if (absolutePath && !absolutePath.startsWith('/') && !absolutePath.includes(':')) {
                                const root = this.workspaceContextService.getWorkspace().folders[0]?.uri;
                                if (root) {
                                    absolutePath = URI.joinPath(root, absolutePath).fsPath;
                                }
                            }

                            activityBlock.details = activityBlock.details || [];
                            activityBlock.details.push(detailText);
                            activityBlock.detailMetadata = activityBlock.detailMetadata || [];
                            activityBlock.detailMetadata.push({
                                label: detailText,
                                path: absolutePath,
                                range: range,
                                query,
                                type: isRead ? 'read' : 'explore'
                            });
                            activityBlock.isStreaming = true;
                            activityBlock.status = (activityBlock.fileCount || 0) > 0 ? 'Analyzing...' : 'Exploring...';
                        } else {
                            const { detailText, range } = this.getDiscoveryActivityDetail(toolName, input, path);

                            // Resolve absolute path
                            let absolutePath: string | undefined = toolName === 'get_open_files' ? undefined : path;
                            if (absolutePath && !absolutePath.startsWith('/') && !absolutePath.includes(':')) {
                                const root = this.workspaceContextService.getWorkspace().folders[0]?.uri;
                                if (root) {
                                    absolutePath = URI.joinPath(root, absolutePath).fsPath;
                                }
                            }

                            activityBlock = {
                                id: activityBlockId,
                                type: 'file',
                                status: isRead ? 'Analyzing...' : 'Exploring...',
                                searchCount: isRead ? 0 : 1,
                                fileCount: isRead ? 1 : 0,
                                details: [detailText],
                                detailMetadata: [{
                                    label: detailText,
                                    path: absolutePath,
                                    range: range,
                                    query,
                                    type: isRead ? 'read' : 'explore'
                                }],
                                isStreaming: true
                            };
                            targetBlocks.push(activityBlock);
                        }
                        render(true);
                    } else if (this.toolPresentation.isBrowserTool(toolName)) {
                        const blockId = `browser-${timestamp}-${randomSuffix}`;
                        pendingBrowserBlockIds.set(toolName, blockId);
                        timeline.push(this.toolPresentation.createBrowserTimelineBlock(blockId, toolName, event.input, true));
                        render(true);
                    } else if (this.toolPresentation.isWebRetrievalTool(toolName)) {
                        const blockId = `web-${timestamp}-${randomSuffix}`;
                        pendingWebBlockIds.set(event.toolCallId || toolName, blockId);
                        timeline.push(this.toolPresentation.createWebRetrievalTimelineBlock(blockId, toolName, event.input, true));
                        render(true);
                    } else if (this.shouldCreateGenericToolBlock(toolName)) {
                        const blockId = `tool-${timestamp}-${randomSuffix}`;
                        pendingGenericToolBlockIds.set(toolName, blockId);
                        const targetBlocks = timeline;
                        targetBlocks.push({
                            id: blockId,
                            type: 'tool',
                            toolName,
                            content: startLabel,
                            status: 'Running',
                            toolStatus: 'running',
                            isStreaming: true
                        });
                        render(true);
                    }
                } else if (event.type === 'tool_progress') {
                    if (event.progress?.type === 'mutation_stats') {
                        this.upsertMutationTimelineBlock(
                            timeline,
                            event.progress.path,
                            typeof event.progress.status === 'string' ? event.progress.status : 'Editing...',
                            true,
                            {
                                added: typeof event.progress.added === 'number' ? event.progress.added : undefined,
                                deleted: typeof event.progress.deleted === 'number' ? event.progress.deleted : undefined
                            }
                        );
                        render(true);
                    } else if (this.isCommandExecutionTool(event.toolName) && event.progress.command) {
                        const cmd = this.toolPresentation.formatTerminalCommandForDisplay(event.progress.command);

                        const block = [...timeline].reverse().find(b =>
                            b.type === 'terminal'
                            && b.isStreaming
                            && ((event.toolCallId && b.toolCallId === event.toolCallId) || (!event.toolCallId && b.command === cmd))
                        );
                        if (event.progress.type === 'command_output') {
                            const output = this.renderPayloadCodec.clampLiveTerminalOutput(typeof event.progress.data === 'string' ? event.progress.data : '');
                            terminalOutputs[cmd] = { output, exitCode: -1 };
                            if (block) {
                                block.output = output;
                            }
                        } else if (event.progress.type === 'command_status') {
                            if (block && typeof event.progress.status === 'string') {
                                block.status = this.formatCommandProgressStatus(event.progress.status);
                            }
                            if (typeof event.progress.data === 'string' && event.progress.data.length > 0) {
                                const output = this.renderPayloadCodec.clampLiveTerminalOutput(event.progress.data);
                                terminalOutputs[cmd] = { output, exitCode: -1 };
                                if (block) {
                                    block.output = output;
                                }
                            }
                        }
                        render(true);
                    } else if ((event.toolName === 'read_file' || event.toolName === 'read_file_range') && event.progress?.type === 'read') {
                        // Silencing intermediate "Read" progress per user request.
                    }

                    render(true);
				} else if (event.type === 'task_complete') {
					const completionPhase = typeof event.result?.phase === 'string' ? event.result.phase : currentTurnPhase;
					const usesPlanningFlow = this.usesPlanningFlow(normalizedMode);
					didReceiveTaskFinished = true;
					const didRenderFinishBlock = this.completionTimelineBuilder.upsertFinishTaskSummaryBlock(
						timeline,
						currentTurnId,
						event.result,
						usesPlanningFlow,
						this.hasAssistantTextBlock(timeline, currentTurnId) || this.hasAssistantTextBlock(timeline),
						usesPlanningFlow && completionPhase === AgentPhase.VERIFICATION
					);
					if (usesPlanningFlow && didRenderFinishBlock) {
						didRenderPlanningFinalResult = true;
					}
					if (usesPlanningFlow && !didRenderFinishBlock) {
						const summary = this.completionTimelineBuilder.getFinishSummaryText(event.result);
						this.completionTimelineBuilder.removeSummaryBlocksWithContent(timeline, summary);
					}
					render(true);
					renderer.scrollToBottom();
					continue;
				} else if (event.type === 'tool_result') {
					if (event.toolName === 'ask_question' && event.result?.success !== false) {
                        const planningQuestion = normalizePlanningQuestion(event.result?.planning_question);
                        if (planningQuestion) {
                            const summary = typeof event.result?.summary === 'string' && event.result.summary.trim().length > 0
                                ? event.result.summary.trim()
                                : undefined;
                            currentTurnHasPlanningQuestion = true;
                            currentTurnParsed = {
                                ...currentTurnParsed,
                                ...(summary ? { summary } : {}),
                                planning_question: planningQuestion
                            };
                            lastKnownParsed = {
                                ...lastKnownParsed,
                                ...(summary ? { summary } : {}),
                                planning_question: planningQuestion
                            };
                            render(true);
                            renderer.scrollToBottom();
                        }
                    } else if (event.toolName === '__plan_created__') {
                        const summary = typeof event.result?.summary === 'string' && event.result.summary.trim().length > 0
                            ? event.result.summary.trim()
                            : undefined;
                        pendingPlanningHandoffSummary = summary;
                        const handoffPayload = this.buildPlanningArtifactHandoffPayload(summary);
                        currentTurnParsed = {
                            ...currentTurnParsed,
                            ...handoffPayload
                        };
                        lastKnownParsed = {
                            ...lastKnownParsed,
                            ...handoffPayload
                        };
                        if (summary) {
                            this.upsertPlanningHandoffSummaryBlock(timeline, currentTurnId, summary);
                        }
                        this.syncRunStateFromParsedResponse(lastKnownParsed);
                        currentTurnText = '';
                        timeline.forEach(block => {
                            block.isStreaming = false;
                            if (block.type === 'file' && this.completionTimelineBuilder.normalizeFileTimelinePath(block.path) === this.completionTimelineBuilder.normalizeFileTimelinePath('implementation_plan.md')) {
                                block.status = block.status === 'Creating...' ? 'Created' : block.status;
                            }
                        });
                        render(true);
                        renderer.scrollToBottom();
                        this._onDidChangeState.fire();
                    } else if (this.isAuxiliaryCommandStatusTool(event.toolName)) {
                        if (event.result?.success === false) {
                            this.attachAuxiliaryToolError(timeline, event.toolName, event.result);
                            render(true);
                        }
                    } else if (this.isCommandExecutionTool(event.toolName)) {
                        const result = event.result;
                        const pendingInput = (event.toolCallId ? pendingToolInputsByCallId.get(event.toolCallId) : undefined) || pendingToolInputs.get(event.toolName) || {};
                        const displayCommand = this.toolPresentation.formatTerminalCommandForDisplay(pendingInput.command || result?.command || '');
                        const block = [...timeline].reverse().find(b =>
                            b.type === 'terminal'
                            && b.isStreaming
                            && ((event.toolCallId && b.toolCallId === event.toolCallId) || (!event.toolCallId && b.command === displayCommand))
                        );
                        const output = this.renderPayloadCodec.clampLiveTerminalOutput(this.formatCommandResultOutput(result));
                        terminalOutputs[displayCommand] = {
                            output,
                            exitCode: typeof result?.exitCode === 'number' ? result.exitCode : result?.success === false ? 1 : 0
                        };

                        if (block) {
                            block.isStreaming = false;
                            block.status = this.getCommandResultStatus(event.toolName, result);
                            block.output = output;
                            if (typeof result?.exitCode === 'number') {
                                block.exitCode = result.exitCode;
                            }
                            this.promoteTimelineBlock(timeline, block.id);
                        }
                        render(true);
                        if (block) {
                            this.revealTimelineBlock(block.id);
                        }
                    } else if (['apply_edit', 'multi_file_replace', 'write_file', 'create_and_write_file', 'create_multiple_files'].includes(event.toolName)) {
                        if (this.isMutationTool(event.toolName)) {
                            pendingMutationToolCount = Math.max(0, pendingMutationToolCount - 1);
                        }
                        const didConfirmMutation = this.isConfirmedMutationResult(event.toolName, event.result);
                        currentTurnHasConfirmedMutation = currentTurnHasConfirmedMutation || didConfirmMutation;
                        if (didConfirmMutation) {
							runHasConfirmedMutation = true;
                            this.fileChangeLedger.recordMutationResult(
                                event.toolName,
                                event.result,
                                path => this.completionTimelineBuilder.canonicalWorkspaceFilePath(path),
                                currentTurnId
                            );
                        }

	                        const resultEntries = (event.toolName === 'multi_file_replace' || event.toolName === 'create_multiple_files') && Array.isArray(event.result.results)
	                            ? event.result.results
	                            : [event.result];

                        for (const resultEntry of resultEntries) {
                            const path = resultEntry.path || event.result.path || (event.result.affectedFiles?.[0]);
                            const hasUsablePath = typeof path === 'string' && path.trim().length > 0;
                            const isReadTool = event.toolName.startsWith('read_file');
                            if (!hasUsablePath) {
                                continue;
                            }
                            if (isReadTool && event.result.success === false) {
                                continue;
                            }
                            const canonicalPath = this.completionTimelineBuilder.canonicalWorkspaceFilePath(path) || path;
                            const normalizedResultPath = this.completionTimelineBuilder.normalizeFileTimelinePath(canonicalPath);
                            const targetBlocks = timeline;
                            let block = isReadTool
                                ? targetBlocks.find(b => b.id === 'group-activity-block')
                                : this.findPendingMutationBlock(targetBlocks, normalizedResultPath)
                                    ?? this.findReusableFailedMutationBlock(targetBlocks, normalizedResultPath);

                            if (!block) {
                                block = {
                                    id: isReadTool
                                        ? 'group-activity-block'
                                        : this.createFileTimelineBlockId('mutation', normalizedResultPath),
                                    type: 'file',
                                    path: canonicalPath,
                                    isStreaming: true,
                                    fileCount: 0,
                                    searchCount: 0,
                                    details: []
                                };
                                targetBlocks.push(block);
                            }

                            if (block.id.startsWith('group-activity-block')) {
                                const input = pendingToolInputs.get(event.toolName) || {};
                                const pattern = input.pattern || input.query;
                                const displayLabel = pattern || this.basenameFromPath(path) || path;
                                
                                if (isReadTool) {
                                    const index = block.details?.findIndex(d => d.startsWith('Reading ' + displayLabel));
                                    if (index !== undefined && index !== -1) {
                                        block.details![index] = block.details![index].replace('Reading ', 'Read ');
                                    }
                                } else {
                                    const index = block.details?.findIndex(d => d.startsWith('Exploring ' + displayLabel));
                                    if (index !== undefined && index !== -1) {
                                        block.details![index] = block.details![index].replace('Exploring ', 'Explored ');
                                    }
                                }
                            }

                            block.path = canonicalPath;

	                            if (event.toolName === 'read_file' && event.result.content) {
	                                const lineCount = event.result.content.split('\n').length;
	                                block.range = `#L1-${lineCount}`;
	                            }

	                            const shouldReplacePendingStats = block.isStreaming === true;
	                            const previousAdded = shouldReplacePendingStats ? 0 : typeof block.added === 'number' ? block.added : 0;
	                            const previousDeleted = shouldReplacePendingStats ? 0 : typeof block.deleted === 'number' ? block.deleted : 0;
	                            block.added = previousAdded + (typeof resultEntry.added === 'number' ? resultEntry.added : 0);
	                            block.deleted = previousDeleted + (typeof resultEntry.deleted === 'number' ? resultEntry.deleted : 0);
	                            const blockWithDiff = block as InteractionBlock & { diff?: string; beforeContent?: string; afterContent?: string };
	                            blockWithDiff.diff = typeof resultEntry.diff === 'string' ? resultEntry.diff : (typeof event.result.diff === 'string' ? event.result.diff : undefined);
	                            const nextBeforeContent = typeof resultEntry.beforeContent === 'string' ? resultEntry.beforeContent : (typeof event.result.beforeContent === 'string' ? event.result.beforeContent : undefined);
	                            const nextAfterContent = typeof resultEntry.afterContent === 'string' ? resultEntry.afterContent : (typeof event.result.afterContent === 'string' ? event.result.afterContent : undefined);
	                            blockWithDiff.beforeContent = typeof blockWithDiff.beforeContent === 'string' ? blockWithDiff.beforeContent : nextBeforeContent;
	                            blockWithDiff.afterContent = nextAfterContent ?? blockWithDiff.afterContent;
	                            const normalizedBlockChange = this.filesModifiedService.buildFileChanges([], [{
	                                paths: [canonicalPath],
	                                fileChanges: [{
	                                    path: canonicalPath,
	                                    added: block.added,
	                                    deleted: block.deleted,
	                                    diff: blockWithDiff.diff,
	                                    beforeContent: blockWithDiff.beforeContent,
	                                    afterContent: blockWithDiff.afterContent
	                                }]
	                            }])[0];
	                            if (normalizedBlockChange) {
	                                block.added = normalizedBlockChange.added;
	                                block.deleted = normalizedBlockChange.deleted;
	                                // Adopt the compact diff computed from the full before/after
	                                // snapshots so the row still renders after those snapshots are
	                                // dropped for size on persistence/reconnect.
	                                if ((typeof blockWithDiff.diff !== 'string' || blockWithDiff.diff.trim().length === 0) && typeof normalizedBlockChange.diff === 'string') {
	                                    blockWithDiff.diff = normalizedBlockChange.diff;
	                                }
	                            }

                            if (event.result.success === false || resultEntry?.success === false) {
                                block.status = 'Failed';
                            } else if (event.toolName === 'write_file' || event.toolName === 'create_and_write_file') {
                                block.status = resultEntry.created ? 'Created' : 'Edited';
                            } else if (event.toolName === 'create_multiple_files') {
                                block.status = resultEntry.updated ? 'Edited' : 'Created';
                            } else if (event.toolName.startsWith('read_file')) {
                                block.status = block.id.startsWith('group-activity-block') ? 'Analyzed' : 'Read';
                            } else {
                                block.status = 'Edited';
                            }
                            block.isStreaming = false;
                        }
                        render(true);
                    } else if (this.toolPresentation.isBrowserTool(event.toolName)) {
                        const blockId = pendingBrowserBlockIds.get(event.toolName);
                        const block = blockId ? timeline.find(b => b.id === blockId) : undefined;
                        if (block) {
                            this.toolPresentation.updateBrowserTimelineBlock(block, event.toolName, pendingToolInputs.get(event.toolName), event.result);
                            block.isStreaming = false;
                            pendingBrowserBlockIds.delete(event.toolName);
                            render(true);
                        }
                    } else if (this.toolPresentation.isWebRetrievalTool(event.toolName)) {
                        const pendingKey = event.toolCallId || event.toolName;
                        const blockId = pendingWebBlockIds.get(pendingKey) || pendingWebBlockIds.get(event.toolName);
                        let block = blockId ? timeline.find(b => b.id === blockId) : undefined;
                        const input = (event.toolCallId ? pendingToolInputsByCallId.get(event.toolCallId) : undefined)
                            || pendingToolInputs.get(event.toolName)
                            || {};
                        if (!block) {
                            block = this.toolPresentation.createWebRetrievalTimelineBlock(`web-${Date.now()}-${Math.floor(Math.random() * 10000)}`, event.toolName, input, false);
                            timeline.push(block);
                        }
                        this.toolPresentation.updateWebRetrievalTimelineBlock(block, event.toolName, input, event.result);
                        block.isStreaming = false;
                        pendingWebBlockIds.delete(pendingKey);
                        pendingWebBlockIds.delete(event.toolName);
                        render(true);
                    } else if (this.isDiscoveryTool(event.toolName)) {
                        const targetBlocks = timeline;
                        const activityBlockId = pendingToolActivitySectionIds.get(event.toolName) || `group-activity-block-${activitySectionIndex}`;
                        const block = targetBlocks.find(b => b.id === activityBlockId);
                        if (block) {
                            if (event.toolName === 'get_open_files' && Array.isArray(event.result?.files)) {
                                block.fileCount = Math.max(1, event.result.files.length);
                            }
                            block.status = (block.fileCount || 0) > 0 ? 'Analyzed' : 'Explored';
                            block.isStreaming = false;

                            // Update the most recent entry
                            const input = pendingToolInputs.get(event.toolName) || {};
                            const path = this.getDiscoveryActivityPath(event.toolName, input);

                            if (block.details) {
                                const searchStr = this.getDiscoveryActivityDetail(event.toolName, input, path).detailText;
                                const detailToUpdate = block.details.lastIndexOf(searchStr);

                                if (detailToUpdate !== -1) {
                                    const original = block.details[detailToUpdate];
                                    if (event.toolName === 'read_file_range') {
                                        block.details[detailToUpdate] = original.replace('Reading ', 'Read ');
                                    } else {
                                        block.details[detailToUpdate] = original.replace('Reading ', 'Read ').replace('Exploring ', 'Explored ');
                                    }

                                    // Update metadata label too
                                    if (block.detailMetadata && block.detailMetadata[detailToUpdate]) {
                                        block.detailMetadata[detailToUpdate].label = block.details[detailToUpdate];
                                    }
                                } else {
                                    // Fallback to last index if specific search fails
                                    const lastIndex = block.details.length - 1;
                                    if (lastIndex >= 0) {
                                        block.details[lastIndex] = block.details[lastIndex].replace('Reading ', 'Read ').replace('Exploring ', 'Explored ');
                                        if (block.detailMetadata && block.detailMetadata[lastIndex]) {
                                            block.detailMetadata[lastIndex].label = block.details[lastIndex];
                                        }
                                    }
                                }
                            }
                        }
                        pendingToolInputs.delete(event.toolName);
                        if (event.toolCallId) {
                            pendingToolInputsByCallId.delete(event.toolCallId);
                        }
                        pendingToolActivitySectionIds.delete(event.toolName);
                        render(true);
                    }

                    const genericToolBlockId = pendingGenericToolBlockIds.get(event.toolName);
                    if (genericToolBlockId) {
                        const block = this.findTimelineBlock(timeline, genericToolBlockId);
                        if (block) {
                            block.isStreaming = false;
                            block.status = event.result?.success === false ? 'Failed' : 'Completed';
                            block.toolStatus = event.result?.success === false ? 'failed' : 'completed';
                            if (typeof event.result?.message === 'string' && event.result.message.trim().length > 0) {
                                block.content = event.result.message.trim();
                            }
                        }
                        pendingGenericToolBlockIds.delete(event.toolName);
                        render(true);
                    }

                    pendingToolInputs.delete(event.toolName);
                    if (event.toolCallId) {
                        pendingToolInputsByCallId.delete(event.toolCallId);
                    }
                    activeToolName = undefined;
                    render(true);

                    if (!String(event.toolName).startsWith('__')) {
                        const discoveredPaths = this.toolPresentation.extractDiscoveredPathsFromToolResult(event.toolName, event.result);
                        if (discoveredPaths.length > 0) {
                            this.taskSessionService.recordDiscoveredPaths(discoveredPaths);
                        }
                        this.taskSessionService.recordToolResult(
                            event.toolName,
                            event.result?.success !== false,
                            this.toolPresentation.describeToolResult(event.toolName, event.result)
                        );
                        if (event.toolName === 'update_todo' && event.result?.success !== false && Array.isArray(event.result?.to_do)) {
                            this.taskSessionService.updateToDo(event.result.to_do);
                        }
                        this._onDidChangeState.fire();
                    }
                }
                renderer.scrollToBottom();
            }

            const finalParsed = Object.keys(currentTurnParsed).length > 0 ? currentTurnParsed : lastKnownParsed;
            if (didReceiveTaskFinished || runHasConfirmedMutation) {
                const didReconcileCompletedFiles = this.reconcileCompletedFilesWidget(timeline, currentTurnId, normalizedMode);
                if (this.usesPlanningFlow(normalizedMode) && didReconcileCompletedFiles) {
                    didRenderPlanningFinalResult = true;
                }
            }
            this.ensureRenderableCompletion(timeline, finalParsed, assistantTurnCompleted, controller.signal.aborted);
				timeline.forEach(b => b.isStreaming = false);
	            render(false);

            this.syncRunStateFromParsedResponse(finalParsed);
            const persistedRenderPayload = this.renderPayloadCodec.buildPersistedRenderPayload(
                finalParsed,
                timeline,
                terminalOutputs,
                terminalCommands,
                activeToolName
            );
            const persistedPayloadHasFinishBlock = this.completionTimelineBuilder.hasFinishBlock(timeline);
	            if (!controller.signal.aborted && assistantTurnCompleted && persistedRenderPayload) {
	                sessionAtStart.setLastAssistantRenderPayload(persistedRenderPayload);
	            }
            if (!controller.signal.aborted && pendingPlanningHandoffSummary && !this.completionTimelineBuilder.hasSummaryBlockWithContent(timeline, pendingPlanningHandoffSummary)) {
                const handoffPayload: ChatResponse = { summary: pendingPlanningHandoffSummary };
                const handoffTarget = renderer.addMessage('', 'cleanSlate');
                renderer.renderJSONResponse(handoffPayload, false, handoffTarget);
                sessionAtStart.addMessage('assistant', pendingPlanningHandoffSummary);
                if (!persistedPayloadHasFinishBlock) {
                    sessionAtStart.setLastAssistantRenderPayload(JSON.stringify(handoffPayload));
                }
            }
            let lastSummary = '';
            if (Array.isArray(finalParsed.summary)) {
                lastSummary = finalParsed.summary[finalParsed.summary.length - 1];
            } else if (finalParsed.summary) {
                lastSummary = finalParsed.summary;
            }

            if (finalParsed.code_snippet || (lastSummary && lastSummary.includes('```'))) {
                this.lastResponse = { text: finalParsed.code_snippet || lastSummary || '', selections };
            }

        } catch (err) {
            console.error('[CleanSlateChatController] sendMessage error:', err);
            if (!controller.signal.aborted) {
                const formattedError = formatChatErrorMessage(err);
                this.taskSessionService.recordError(formattedError);
                if (formattedError.startsWith('QUOTA_EXCEEDED:')) {
                    this.taskSessionService.markFailed();
                    renderer.clearTransportRetry();
                    renderer.addMessage(formattedError, 'cleanSlate');
                } else if (this.isTransientAgentFailure(err)) {
                    this.taskSessionService.markInterrupted();
                    renderer.clearTransportRetry();
                    renderer.addModelTerminated(
                        formattedError,
                        () => {
                            globalThis.setTimeout(() => {
                                void this.sendMessage('continue', renderer, this.normalizeMode(mode), onGeneratingChange);
                            }, 0);
                        }
                    );
                } else {
                    this.taskSessionService.markFailed();
                    renderer.addMessage(formattedError, 'cleanSlate');
                }
            }
        } finally {
            if (controller.signal.aborted) {
                this.taskSessionService.markInterrupted();
            }
            this.setGenerating(false, onGeneratingChange);
            renderer.clearTransportRetry();
            renderer.removeStreamingPlaceholders();
            this.controllers.delete(sessionAtStart);
            this.activeRenderState = undefined;
            this._onDidChangeState.fire();
        }
    }

    private isTransientAgentFailure(error: unknown): boolean {
        const message = String(error ?? '').toLowerCase();
        return message.includes('http 429')
            || message.includes('too_many_requests')
            || message.includes('content_filter')
            || message.includes('responsibleaipolicyviolation')
            || message.includes('rate limit')
            || message.includes('timeout')
            || message.includes('did not receive provider activity')
            || message.includes('temporarily unavailable')
            || /(?:^|\D)50[0-4](?:\D|$)/.test(message)
            || message.includes('no body')
            || message.includes('provider connection terminated')
            || message.includes('connection terminated')
            || message.includes('socket hang up')
            || message.includes('econnreset')
            || message.includes('fetch failed');
    }

    private showModelTerminatedPauseMessage(
        message: string,
        renderer: IResponseRenderer,
        mode: CleanSlateExecutionFlow,
        onGeneratingChange?: (isGenerating: boolean) => void
    ): void {
        console.log(`[CleanSlateChatController] ${message}`);
        this.notificationService.warn(message);
        renderer.addModelTerminated(
            message,
            () => {
                globalThis.setTimeout(() => {
                    void this.sendMessage('continue', renderer, this.normalizeMode(mode), onGeneratingChange);
                }, 0);
            }
        );
    }

    applyLastResponse(): void {
        if (this.lastResponse) {
            let code = this.lastResponse.text;
            if (code.startsWith('```')) {
                code = this.toolPresentation.stripCodeFence(code);
            }
            const editor = this.codeEditorService.getActiveCodeEditor();
            if (!editor) return;
            const controller = InlineCleanSlateController.get(editor);
            controller?.preview(code, this.lastResponse.selections);
            editor.focus();
        }
    }

    undoLastEdit(): void {
        const editor = this.codeEditorService.getActiveCodeEditor();
        if (editor && editor.getModel()) {
            const uri = editor.getModel()!.uri;
            this.editCodeService.undoLastAIEdit(uri);
            this.notificationService.info('AI edit undone.');
            editor.focus();
            this.lastResponse = undefined;
        }
    }

    async regenerateMessage(
        prompt: string,
        selections: Selection[],
        renderer: IResponseRenderer,
        mode: CleanSlateExecutionFlow = 'normal',
        onGeneratingChange?: (isGenerating: boolean) => void
    ): Promise<void> {
        void selections;
        return this.sendMessage(prompt, renderer, mode, onGeneratingChange);
    }

    async approvePlan(
        renderer: IResponseRenderer,
        planStepsContext: string = '',
        executionFlow: CleanSlateExecutionFlow = 'planning',
        onGeneratingChange?: (isGenerating: boolean) => void
    ): Promise<void> {
        void planStepsContext;
        this.taskSessionService.approvePlan();
        this._onDidChangeState.fire();
        renderer.addSystemConfirmation('Steps Approved', '', 'pass-filled');
        return this.sendMessage('continue', renderer, executionFlow, onGeneratingChange);
    }

    rejectPlan(): void {
        this.taskSessionService.setAwaitingApproval(false);
        this.taskSessionService.setPhase(AgentPhase.PLANNING);
        this._onDidChangeState.fire();
    }

    canApprovePlan(): boolean {
        if (this.getIsGenerating()) {
            return false;
        }

        if (this.taskSessionService.isAwaitingApproval()) {
            return true;
        }

        if (this.taskSessionService.getPhase() !== AgentPhase.PLANNING) {
            return false;
        }

        return this.threadService.getActiveTaskHistory().some(message =>
            message.role === 'assistant' && (
                message.content.includes('implementation_plan.md')
                || message.content.includes('# Implementation Plan')
                || message.content.includes('## Proposed Changes')
            )
        );
    }

    acceptAll(): void {
        this.editCodeService.acceptAll();
        this.lastResponse = undefined;
    }

    rejectAll(): void {
        this.editCodeService.rejectAll();
        this.lastResponse = undefined;
    }

    hasPendingEdits(): boolean {
        return this.editCodeService.hasPendingEdits();
    }

    getPendingEditsCount(): number {
        return this.editCodeService.getPendingEditsCount();
    }

    getPendingEditsInfo(): { uri: URI; added: number; deleted: number }[] {
        return this.editCodeService.getPendingEditsInfo();
    }

    getPendingEditsDiffs(): { uri: URI; added: number; deleted: number; diff: string; beforeContent: string; afterContent: string }[] {
        return this.editCodeService.getPendingEditsDiffs();
    }

    private syncRunStateFromParsedResponse(parsed: ChatResponse | undefined): void {
        if (!parsed) {
            return;
        }

        const normalizedResponse = normalizeChatResponse(parsed);
        const normalizedToDo = this.renderPayloadCodec.extractToDoItems(normalizedResponse);
        if (normalizedToDo.length > 0) {
            this.taskSessionService.updateToDo(normalizedToDo);
        }

        const latestSummary = this.renderPayloadCodec.extractLatestSummaryText(normalizedResponse);
        if (latestSummary) {
            this.taskSessionService.recordAssistantSummary(latestSummary);
        }
    }

    private ensureRenderableCompletion(
        timeline: InteractionBlock[],
        parsed: ChatResponse,
        assistantTurnCompleted: boolean,
        aborted: boolean
    ): void {
        if (aborted || !assistantTurnCompleted) {
            return;
        }

        const payload: ChatResponse = {
            ...parsed,
            timeline: this.renderPayloadCodec.sanitizeTimeline(timeline)
        };
        if (this.renderPayloadCodec.hasRenderableResponsePayload(payload)) {
            return;
        }

        const evidenceBlock = this.createCompletionBlockFromEvidence();
        if (evidenceBlock) {
            timeline.push(evidenceBlock);
            return;
        }

        timeline.push({
            id: `completion-render-error-${Date.now()}`,
            type: 'finish',
            status: 'render_error',
            content: 'The run completed, but no displayable summary, artifact, browser result, command result, or error was recorded.',
            isStreaming: false
        });
    }

    private createCompletionBlockFromEvidence(): InteractionBlock | undefined {
        const evidence = [...this.taskSessionService.getEvidenceLedger()].reverse();
        for (const entry of evidence) {
            if ((entry.kind === 'completion' || entry.kind === 'artifact') && entry.success !== false) {
                const content = typeof entry.summary === 'string' && entry.summary.trim().length > 0
                    ? entry.summary.trim()
                    : undefined;
                const fileChanges = Array.isArray(entry.filesChanged)
                    ? entry.filesChanged
                        .filter(change => change && typeof change.path === 'string' && change.path.trim().length > 0)
                        .map(change => ({
                            path: this.completionTimelineBuilder.canonicalWorkspaceFilePath(change.path),
                            added: change.added,
                            deleted: change.deleted
                        }))
                    : [];
                if (content || fileChanges.length > 0) {
                    return {
                        id: `completion-evidence-${entry.id}`,
                        type: 'finish',
                        status: 'completed',
                        content,
                        fileChanges,
                        isStreaming: false
                    };
                }
            }

            if (entry.kind === 'browser' && entry.success !== false) {
                const details: string[] = [];
                if (entry.summary) {
                    details.push(entry.summary);
                }
                if (entry.browserPageCount !== undefined) {
                    details.push(`Inspected ${entry.browserPageCount} page${entry.browserPageCount === 1 ? '' : 's'}`);
                }
                if (entry.screenshotCount !== undefined) {
                    details.push(`Captured ${entry.screenshotCount} screenshot${entry.screenshotCount === 1 ? '' : 's'}`);
                }
                if (entry.url || details.length > 0) {
                    return {
                        id: `browser-evidence-${entry.id}`,
                        type: 'browser',
                        browserToolName: entry.toolName,
                        browserAction: entry.summary || entry.toolName || 'Browser result',
                        browserUrl: entry.url,
                        browserStatus: 'completed',
                        status: 'Completed',
                        details,
                        isStreaming: false
                    };
                }
            }

            if (entry.kind === 'command' && entry.success !== undefined) {
                const output = [
                    entry.url ? `URL: ${entry.url}` : '',
                    entry.summary || '',
                    entry.error || ''
                ].filter(Boolean).join('\n\n');
                return {
                    id: `command-evidence-${entry.id}`,
                    type: 'terminal',
                    command: entry.command,
                    output: output || `Command ${entry.success ? 'completed' : 'failed'}.`,
                    exitCode: entry.exitCode,
                    status: entry.success ? 'Completed' : 'Failed',
                    isStreaming: false
                };
            }

            if (entry.kind === 'error' && (entry.error || entry.summary)) {
                return {
                    id: `error-evidence-${entry.id}`,
                    type: 'finish',
                    status: 'failed',
                    content: entry.error || entry.summary,
                    isStreaming: false
                };
            }
        }

        return undefined;
    }

}
