/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { basename, isEqualOrParent, joinPath } from '../../../../../../base/common/resources.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { SyncDescriptor } from '../../../../../../platform/instantiation/common/descriptors.js';
import { ServiceCollection } from '../../../../../../platform/instantiation/common/serviceCollection.js';
import { ICodeEditorService } from '../../../../../../editor/browser/services/codeEditorService.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { CleanSlateReasoningLevel, ICleanSlateContextService, ICleanSlateEditCodeService, ICleanSlateIndexService, ICleanSlateMainService, ICleanSlatePersistedSession, ICleanSlateThreadSessionUpdate, normalizeCleanSlateExecutionState, type ICleanSlateContext } from '../../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { CleanSlateIndexServiceProxy } from '../../../../../services/cleanSlate/browser/indexing/cleanSlateIndexServiceProxy.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService, WorkbenchState, type IWorkspace, type IWorkspaceFolder, type IWorkspaceFoldersChangeEvent, type IWorkspaceFoldersWillChangeEvent, type IWorkspaceIdentifier, type ISingleFolderWorkspaceIdentifier } from '../../../../../../platform/workspace/common/workspace.js';
import { AgentDefinition } from '@cleanslate/sdk/composer/registry/agentSchema.js';
import { CleanSlateAgent } from '../../agent/cleanSlateAgent.js';
import { CleanSlateChatController } from '../runtime/cleanSlateChatController.js';
import { type ChatResponse, IResponseRenderer } from '../types/cleanSlateChatTypes.js';
import { stringifyCleanSlateTranscriptRenderPayload } from '../runtime/cleanSlateTranscriptPersistence.js';
import { getCleanSlateVisibleUserRequestText, normalizeCleanSlateVisibleWhitespace } from '../runtime/cleanSlateVisibleText.js';
import { stringifyCleanSlateUserSelectionDisplay } from '../viewModel/cleanSlateChatViewHelpers.js';
import {
    isCleanSlateSessionDeletedByGlobalCutoff,
    isCleanSlateSessionDeletedByProjectCutoff,
    loadCleanSlateDeletedBefore,
    loadCleanSlateDeletedProjectCutoffs,
    loadCleanSlateDeletedSessionIds,
    rememberCleanSlateDeletedSessionId
} from './cleanSlateChatDeletionStore.js';
import type { ICleanSlateCommandApprovalRequest } from '../../core/cleanSlateCommandApprovalService.js';
import { ICleanSlateCommandApprovalService } from '../../core/cleanSlateCommandApprovalService.js';
import {
    CleanSlateSessionState,
    deriveCleanSlateTranscriptFromHistory,
    ICleanSlateSessionSnapshot,
    ICleanSlateTranscriptMessage,
    isCleanSlateSessionState,
    normalizeCleanSlateSessionExecutionState
} from '../types/cleanSlateChatSessionTypes.js';
import { CleanSlateThreadService } from '@cleanslate/sdk/services/cleanSlateThreadService.js';
import { CleanSlateTaskSessionService, ICleanSlateRunSummary } from '@cleanslate/sdk/services/cleanSlateTaskSessionService.js';
import type { CleanSlateToolSurface } from '@cleanslate/sdk/services/cleanSlateTools.js';
import type { ICleanSlateChildAgentEvent, ICleanSlateChildAgentSnapshot } from '@cleanslate/sdk/services/cleanSlateAgentCoordinator.js';
import { AsyncQueue, type CleanSlateStreamPart } from '@cleanslate/sdk/agent/cleanSlateAgentTypes.js';
import { CleanSlateChatSessionRunState, CleanSlateSessionAlreadyRunningError, type CleanSlateSessionRunStatus } from './cleanSlateChatSessionRunState.js';
import { CleanSlateChatSessionSnapshotCodec } from './cleanSlateChatSessionSnapshotCodec.js';
import { CLEANSLATE_HOSTED_AGENT_OWNER } from '@cleanslate/sdk/protocol/cleanSlateAI.js';
import { ICleanSlateBrowserAutomationService } from '../../core/cleanSlateBrowserAutomationService.js';

const CLEANSLATE_ACTIVE_SESSION_STORAGE_KEY = 'cleanSlate.chat.activeSession';
const CLEANSLATE_ACTIVE_SESSION_SAVE_DEBOUNCE_MS = 250;
const CLEANSLATE_STREAMING_TRANSCRIPT_SAVE_INTERVAL_MS = 250;

export interface ICleanSlateSessionWorkspaceMetadata {
    readonly workspaceId?: string;
    readonly projectRoot?: string;
    readonly workDir?: string;
    readonly workspaceName?: string;
}

/**
 * A child-agent conversation update projected onto the task's existing side-chat
 * surface. It never enters task history or the parent model's conversation.
 */
export interface ICleanSlateChildAgentSurfaceEvent {
    readonly parentSessionId: string;
    readonly sideChatSessionId?: string;
    readonly event: ICleanSlateChildAgentEvent;
}

interface ICleanSlateChildAgentPresentation {
	readonly parent: ICleanSlateLiveSession;
	readonly sideChat: ICleanSlateLiveSession;
	readonly queue: AsyncQueue<CleanSlateStreamPart>;
	readonly runId: string;
}

interface ICleanSlateLiveSession {
    readonly id: string;
    readonly parentSessionId?: string;
    readonly createdAt: number;
    readonly workspaceId: string;
    readonly projectRoot?: string;
    readonly workDir?: string;
    readonly workspaceName?: string;
    readonly threadService: CleanSlateThreadService;
    readonly taskSessionService: CleanSlateTaskSessionService;
    readonly controller: CleanSlateChatController;
    readonly agent: CleanSlateAgent;
    readonly instantiationStore: DisposableStore;
    readonly threadHistoryListener: IDisposable;
    readonly controllerStateListener: IDisposable;
    title?: string;
    planMode: boolean;
    reasoningLevel: CleanSlateReasoningLevel;
    agentDefinition?: AgentDefinition;
    transcriptHistory: ICleanSlateTranscriptMessage[];
    status: CleanSlateSessionState;
    /** This surface is displaying a run owned by another provider. */
    liveOwnerId?: string;
    transportStatus?: NonNullable<ICleanSlateThreadSessionUpdate['live']>['transportStatus'];
}

export class CleanSlateChatSessionProvider extends Disposable {
    private readonly providerId = generateUuid();
    private readonly snapshotCodec = new CleanSlateChatSessionSnapshotCodec();
    private readonly sessions = new Map<string, ICleanSlateLiveSession>();
	/** Auxiliary conversations belong to a task surface, never to task history. */
	private readonly sideChats = new Map<string, ICleanSlateLiveSession>();
	private readonly sideChatRenderers = new Map<string, IResponseRenderer>();
	private readonly childAgentPresentations = new Map<string, ICleanSlateChildAgentPresentation>();
	private readonly hostedChildSequences = new Map<string, number>();
	private readonly hostedChildren = new Map<string, ICleanSlateChildAgentSnapshot>();
    private activeSessionId!: string;
    private activeSessionRevision = 0;
    private persistenceQueue: Promise<void> = Promise.resolve();
    private liveSyncQueue: Promise<void> = Promise.resolve();
    private pendingActiveSessionSave: ICleanSlateSessionSnapshot | undefined;
    private readonly pendingLiveSyncSessions = new Map<string, ICleanSlateLiveSession>();
    private readonly deletedSessionIds = new Set<string>();
    private readonly deletedProjectCutoffs: Map<string, number>;
    private readonly deletedBefore: number;
    private activeSessionSaveScheduled = false;
    private liveSyncScheduled = false;
    private applyingPublishedSession = false;
    private externalActiveSessionRefreshPending = false;
    private disposeAfterRuns = false;
    private readonly pendingHostedSubmissions = new Map<string, Promise<void>>();
    private readonly publishedRunningSessions = new Map<string, boolean>();
    private readonly hostedApprovals = new Map<string, string>();
    private readonly hostedUpdateVersions = new Map<string, number>();
    private readonly runState = this._register(new CleanSlateChatSessionRunState());
    private readonly readyPromise: Promise<void>;
	private readonly _onDidChangeState = new Emitter<void>();
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event;
	private readonly _onDidChangeChildAgent = new Emitter<ICleanSlateChildAgentSurfaceEvent>();
	readonly onDidChangeChildAgent: Event<ICleanSlateChildAgentSurfaceEvent> = this._onDidChangeChildAgent.event;
    readonly onDidPendingEditsChange: Event<void>;

    constructor(
        private readonly instantiationService: IInstantiationService,
        private readonly codeEditorService: ICodeEditorService,
        private readonly editCodeService: ICleanSlateEditCodeService,
        private readonly notificationService: INotificationService,
        private readonly storageService: IStorageService,
        private readonly workspaceContextService: IWorkspaceContextService,
        private readonly cleanSlateContextService: ICleanSlateContextService,
        private readonly cleanSlateMainService: ICleanSlateMainService,
        @ICleanSlateCommandApprovalService private readonly commandApprovalService: ICleanSlateCommandApprovalService,
        private readonly onDidUpdateInactiveSession?: (session: ICleanSlateSessionSnapshot) => void,
        private readonly surface: CleanSlateToolSurface = 'ide'
    ) {
        super();
        this._register(this._onDidChangeState);
        this._register(this._onDidChangeChildAgent);
        this.onDidPendingEditsChange = this.editCodeService.onDidPendingEditsChange;
        this._register(this.commandApprovalService.onDidChangeApprovalRequests(() => {
            this._onDidChangeState.fire();
        }));
        this._register(this.runState.onDidChangeStatus(() => this._onDidChangeState.fire()));
        this._register(this.cleanSlateMainService.onDidPublishThreadSession(update => this.applyPublishedThreadSession(update)));
        for (const sessionId of loadCleanSlateDeletedSessionIds(this.storageService)) {
            this.deletedSessionIds.add(sessionId);
        }
        this.deletedProjectCutoffs = loadCleanSlateDeletedProjectCutoffs(this.storageService);
        this.deletedBefore = loadCleanSlateDeletedBefore(this.storageService);
        const activeSession = this.surface === 'agentManager' ? undefined : this.loadActiveSessionSnapshot();
        if (activeSession) {
            const restored = this.createLiveSessionFromSnapshot(activeSession);
            this.registerSession(restored);
            this.activeSessionId = restored.id;
        } else {
            const fresh = this.createLiveSession();
            this.registerSession(fresh);
            this.activeSessionId = fresh.id;
        }
        this.readyPromise = this.surface === 'agentManager'
            ? Promise.resolve()
            : this.initializePersistentActiveSession(activeSession);
        void this.readyPromise.then(() => this.requestLiveSessionSync()).catch(error => {
            console.warn('[CleanSlate] Failed to request live session state:', error);
        });
    }

    whenReady(): Promise<void> {
        return this.readyPromise;
    }

    override dispose(): void {
        this.hostedApprovals.clear();
        // An editor/auxiliary view can close during IDE handoff. Keep execution
        // ownership and the live-control subscription until its runs settle.
        if (this.hasOwnedRunningSessions()) {
            this.disposeAfterRuns = true;
            return;
        }
        super.dispose();
    }

    getActiveSessionId(): string {
        return this.activeSessionId;
    }

    getHostedTransportStatus(): ICleanSlateLiveSession['transportStatus'] | null {
        return this.activeSession.liveOwnerId === CLEANSLATE_HOSTED_AGENT_OWNER ? this.activeSession.transportStatus : null;
    }

    hasOwnedRunningSessions(): boolean {
        return [...this.sessions.values(), ...this.sideChats.values()].some(session => this.runState.isRunning(session.id));
    }

    private requestLiveSessionSync(): Promise<void> {
        return this.cleanSlateMainService.publishThreadSession({
            originId: this.providerId,
            session: this.toPersistedSession(this.buildSessionSnapshot(this.activeSession)),
            request: 'sync',
            surface: this.surface === 'agentManager' ? 'agentManager' : 'ide'
        });
    }

    async publishActiveSessionForIdeHandoff(): Promise<void> {
        await this.whenHostedRunsAccepted();
        const session = this.activeSession;
        const snapshot = this.buildSessionSnapshot(session);
        const persisted = this.toPersistedSession(snapshot);
        await this.cleanSlateMainService.saveActiveThreadSession(this.getSnapshotWorkspaceId(snapshot), persisted);
        await this.cleanSlateMainService.publishThreadSession({
            originId: 'agentManager:handoff',
            session: persisted,
            makeActive: true,
            live: { ownerId: session.liveOwnerId ?? this.providerId, isRunning: this.isLiveSessionRunning(session) }
        });
    }

    async whenHostedRunsAccepted(): Promise<void> {
        // A rejected submission has no renderer-owned work to protect and must
        // not prevent the user from opening the IDE.
        await Promise.allSettled(this.pendingHostedSubmissions.values());
    }

    consumeExternalActiveSessionRefresh(): boolean {
        const shouldRefresh = this.externalActiveSessionRefreshPending;
        this.externalActiveSessionRefreshPending = false;
        return shouldRefresh;
    }

    getHistory(): { role: string; content: string }[] {
        return this.activeSession.controller.getHistory();
    }

    getRawHistoryReference(): { role: string; content: string; isInternalState?: boolean; renderPayload?: string; images?: string[] }[] {
        return this.activeSession.threadService.getRawHistoryReference();
    }

    getTranscriptHistory(): ICleanSlateTranscriptMessage[] {
        return this.snapshotCodec.cloneTranscript(this.getEffectiveTranscriptHistory(this.activeSession));
    }

    recordTranscriptMessage(message: Omit<ICleanSlateTranscriptMessage, 'id'> & { id?: string }): string | undefined {
        return this.recordTranscriptMessageForSession(this.activeSession, message);
    }

    private recordTranscriptMessageForSession(session: ICleanSlateLiveSession, message: Omit<ICleanSlateTranscriptMessage, 'id'> & { id?: string }): string | undefined {
        const role = typeof message.role === 'string' ? message.role : '';
        const content = typeof message.content === 'string' ? message.content : '';
        const renderPayload = typeof message.renderPayload === 'string' ? message.renderPayload : undefined;
        const hasImages = Array.isArray(message.images) && message.images.length > 0;
        if (!role || (!content.trim() && !renderPayload?.trim() && !hasImages)) {
            return undefined;
        }

        const id = message.id || this.createTranscriptMessageId();
        session.transcriptHistory.push({
            id,
            role,
            content,
            isInternalState: message.isInternalState,
            renderPayload,
            images: hasImages
                ? message.images?.filter((image): image is string => typeof image === 'string')
                : undefined
        });
        this.notifySessionChanged(session);
        return id;
    }

    updateTranscriptMessage(
        id: string | undefined,
        update: Partial<Omit<ICleanSlateTranscriptMessage, 'id' | 'role'>>
    ): void {
        this.updateTranscriptMessageForSession(this.activeSession, id, update);
    }

    private updateTranscriptMessageForSession(
        session: ICleanSlateLiveSession,
        id: string | undefined,
        update: Partial<Omit<ICleanSlateTranscriptMessage, 'id' | 'role'>>,
        emitStateChange = true
    ): void {
        if (!id) {
            return;
        }

        const index = session.transcriptHistory.findIndex(message => message.id === id);
        if (index === -1) {
            return;
        }

        const existing = session.transcriptHistory[index];
        const next = {
            ...existing,
            content: typeof update.content === 'string' ? update.content : existing.content,
            isInternalState: update.isInternalState ?? existing.isInternalState,
            renderPayload: typeof update.renderPayload === 'string' ? update.renderPayload : existing.renderPayload,
            images: Array.isArray(update.images)
                ? update.images.filter((image): image is string => typeof image === 'string')
                : existing.images
        };
        if (next.content === existing.content
            && next.isInternalState === existing.isInternalState
            && next.renderPayload === existing.renderPayload
            && this.snapshotCodec.areStringArraysEqual(next.images, existing.images)
        ) {
            return;
        }

        session.transcriptHistory[index] = next;
        if (emitStateChange) {
            this.notifySessionChanged(session);
        } else {
            this.persistTranscriptContent(session);
        }
    }

    getPhase(): string {
        return this.activeSession.taskSessionService.getPhase();
    }

    getRunSummary(): ICleanSlateRunSummary {
        return this.activeSession.taskSessionService.getRunSummary();
    }

    getCurrentWorkItem(): string | undefined {
        return this.activeSession.taskSessionService.getCurrentWorkItem();
    }

    getLastAssistantTurn(): string | undefined {
        return this.activeSession.taskSessionService.getLastAssistantTurn();
    }

    getCurrentPlanMode(): boolean {
        return this.activeSession.planMode;
    }

    getCurrentReasoningLevel(): CleanSlateReasoningLevel {
        return this.activeSession.reasoningLevel;
    }

    setExecutionState(planMode: boolean, reasoningLevel: CleanSlateReasoningLevel): void {
        this.activeSession.planMode = planMode;
        this.activeSession.reasoningLevel = reasoningLevel;
    }

    getCurrentAgent(): AgentDefinition | undefined {
        return this.activeSession.agentDefinition;
    }

    getIsGenerating(): boolean {
        return this.isLiveSessionRunning(this.activeSession);
    }

    isSessionRunning(sessionId: string | undefined): boolean {
        if (!sessionId) {
            return false;
        }
        const session = this.sessions.get(sessionId) ?? this.sideChats.get(sessionId);
        return session ? this.runState.isRunning(sessionId) || session.controller.getIsGenerating() === true
            : this.publishedRunningSessions.get(sessionId) === true;
    }

    canApprovePlan(): boolean {
        return this.activeSession.controller.canApprovePlan();
    }

    getCurrentTitle(): string {
        return this.ensureSessionTitle(this.activeSession);
    }

    hasCurrentSessionContent(): boolean {
        const session = this.activeSession;
        return this.hasVisibleSessionContent({
            history: session.threadService.getRawHistoryReference(),
            transcript: session.transcriptHistory
        });
    }

    getPendingEditsInfo(): { uri: URI; added: number; deleted: number }[] {
        return this.activeSession.controller.getPendingEditsInfo();
    }

    getPendingEditsDiffs(): { uri: URI; added: number; deleted: number; diff: string; beforeContent: string; afterContent: string }[] {
        return this.activeSession.controller.getPendingEditsDiffs();
    }

    startNewChat(
        planMode = false,
        reasoningLevel: CleanSlateReasoningLevel = this.getCurrentReasoningLevel(),
        workspaceMetadata: ICleanSlateSessionWorkspaceMetadata = {}
    ): void {
        const session = this.createLiveSession(undefined, planMode, reasoningLevel, workspaceMetadata);
        this.registerSession(session);
        this.activeSessionId = session.id;
        this.activeSessionRevision++;
        this.clearActiveSessionSnapshot();
        this._onDidChangeState.fire();
    }

	/**
	 * Creates a conversation attached to the current task without replacing the
	 * main composer. The side chat receives a read-only context seed, then owns
	 * an independent runtime, transcript and cancellation boundary.
	 */
	createSideChat(title = 'Side chat'): string {
		const parent = this.activeSession;
		const existing = Array.from(this.sideChats.values()).find(candidate => candidate.parentSessionId === parent.id);
		if (existing) {
			return existing.id;
		}
		return this.createSideChatForParent(parent, title).id;
	}

	private createSideChatForParent(parent: ICleanSlateLiveSession, title = 'Side chat'): ICleanSlateLiveSession {
		const side = this.createLiveSession(undefined, false, parent.reasoningLevel, {
			parentSessionId: parent.id,
			workspaceId: parent.workspaceId,
			projectRoot: parent.projectRoot,
			workDir: parent.workDir,
			workspaceName: parent.workspaceName,
			title
		});
		// Register in the auxiliary layer before seeding context because the thread
		// history listener fires synchronously. This keeps even the initial seed out
		// of persistence, publishing, archives and sidebar history.
		this.sideChats.set(side.id, side);
		const context = parent.threadService.getActiveTaskHistory()
			.filter(message => !message.isInternalState && (message.role === 'user' || message.role === 'assistant'))
			.slice(-8)
			.map(message => `${message.role}: ${message.content}`)
			.join('\n\n');
		if (context) {
			side.threadService.addMessage('system', [
				'This is a side conversation attached to another task.',
				'Use the following prior discussion only as context. Do not claim you performed the parent task.',
				context
			].join('\n\n'), true);
		}
		this.notifySessionChanged(side);
		return side;
	}

	attachSideChatRenderer(sessionId: string, renderer: IResponseRenderer): void {
		if (this.sideChats.has(sessionId)) {
			this.sideChatRenderers.set(sessionId, renderer);
		}
	}

	detachSideChatRenderer(sessionId: string): void {
		this.sideChatRenderers.delete(sessionId);
	}

	getSideChatTranscript(sessionId: string): ICleanSlateTranscriptMessage[] {
		const session = this.sideChats.get(sessionId);
		return session ? this.snapshotCodec.cloneTranscript(this.getEffectiveTranscriptHistory(session)) : [];
	}

	isSideChatGenerating(sessionId: string): boolean {
		if (this.isSessionRunning(sessionId)) {
			return true;
		}
		const sideChat = this.sideChats.get(sessionId);
		if (!sideChat) {
			return false;
		}
		const parent = sideChat.parentSessionId ? this.sessions.get(sideChat.parentSessionId) : undefined;
		return (parent?.agent.listChildAgents(parent.id) ?? [])
			.some(agent => agent.status === 'queued' || agent.status === 'running');
	}

	sendSideChatMessage(sessionId: string, text: string, renderer: IResponseRenderer, onGeneratingChange?: (isGenerating: boolean) => void, images?: string[]): Promise<void> {
		const session = this.sideChats.get(sessionId);
		if (!session || !session.parentSessionId) {
			return Promise.reject(new Error('Side chat is no longer available.'));
		}
		this.attachSideChatRenderer(sessionId, renderer);
		return this.sendSessionMessage(session, text, this.createLiveSideChatRenderer(sessionId), onGeneratingChange, images, true, true);
	}

	abortSideChat(sessionId: string, renderer: IResponseRenderer): void {
		const session = this.sideChats.get(sessionId);
		if (!session) {
			return;
		}
		session.controller.abortGeneration(renderer);
		// Clear both sources of composer state synchronously. Child cancellation
		// below may still need a moment to terminate an OS process, but the Side
		// Chat must accept the user's next message immediately.
		this.runState.cancel(session.id, 'User cancelled the side chat.');
		session.controller.setExternalGeneratingState(false);
		const parent = session.parentSessionId ? this.sessions.get(session.parentSessionId) : undefined;
		for (const worker of parent?.agent.listChildAgents(parent.id) ?? []) {
			if (worker.status === 'queued' || worker.status === 'running') {
				parent?.agent.cancelChildAgent(worker.id);
			}
		}
		session.status = 'stopped';
		this.notifySessionChanged(session);
	}

	private createLiveSideChatRenderer(sessionId: string): IResponseRenderer {
		const getRenderer = () => this.sideChatRenderers.get(sessionId);
		return {
			addMessage: (text, role, images) => getRenderer()?.addMessage(text, role, images) ?? this.createDetachedMessageElement(role),
			addUserSelectionMessage: (display, images) => getRenderer()?.addUserSelectionMessage?.(display, images) ?? this.createDetachedMessageElement('user'),
			addSystemConfirmation: (title, message, icon) => getRenderer()?.addSystemConfirmation(title, message, icon) ?? document.createElement('div'),
			showTransportRetry: status => getRenderer()?.showTransportRetry(status),
			clearTransportRetry: () => getRenderer()?.clearTransportRetry(),
			addModelTerminated: (message, onContinue) => getRenderer()?.addModelTerminated(message, onContinue) ?? document.createElement('div'),
			renderJSONResponse: (data, isStreaming, target) => getRenderer()?.renderJSONResponse(data, isStreaming, target),
			scrollToBottom: () => getRenderer()?.scrollToBottom(),
			removeStreamingPlaceholders: () => getRenderer()?.removeStreamingPlaceholders(),
			findTranscriptMessageElement: (transcriptId: string) => {
				const renderer = getRenderer() as (IResponseRenderer & {
					findTranscriptMessageElement?: (id: string) => HTMLElement | undefined;
				}) | undefined;
				return renderer?.findTranscriptMessageElement?.(transcriptId);
			}
		} as IResponseRenderer;
	}

	private applyHostedChildEvents(owner: ICleanSlateLiveSession, live: ICleanSlateThreadSessionUpdate['live']): void {
		if (live?.ownerId !== CLEANSLATE_HOSTED_AGENT_OWNER) { return; }
		for (const item of live.childAgentEvents ?? []) {
			if (item.sequence <= (this.hostedChildSequences.get(owner.id) ?? 0)) { continue; }
			this.hostedChildSequences.set(owner.id, item.sequence);
			this.hostedChildren.set(item.event.agent.id, item.event.agent);
			this.presentChildAgentEvent(owner, item.event);
		}
	}

	private presentChildAgentEvent(liveSession: ICleanSlateLiveSession, event: ICleanSlateChildAgentEvent): void {
		const sessionId = liveSession.id;
		if (event.agent.parentAgentId !== sessionId) {
			return;
		}
		const sourceSideChat = this.sideChats.get(sessionId);
		let sideChat = sourceSideChat ?? Array.from(this.sideChats.values()).find(candidate => candidate.parentSessionId === sessionId);
		if (!sideChat && event.type === 'created' && liveSession) {
			sideChat = this.createSideChatForParent(liveSession);
		}
		this._onDidChangeChildAgent.fire({
			parentSessionId: sourceSideChat?.parentSessionId ?? sessionId,
			sideChatSessionId: sideChat?.id,
			event
		});

		if (!sideChat || !liveSession || sourceSideChat) {
			return;
		}
		if (event.type === 'created') {
			this.startChildAgentPresentation(liveSession, sideChat, event.agent);
			return;
		}
		const presentation = this.childAgentPresentations.get(event.agent.id);
		if (!presentation) {
			return;
		}
		if (event.type === 'progress' && event.streamPart) {
			presentation.queue.push(event.streamPart);
		} else if (event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled') {
			if (event.type === 'failed') {
				presentation.queue.push({
					type: 'chat_text',
					kind: 'final_answer',
					content: `Worker failed: ${event.agent.error?.trim() || 'Unknown error.'}`
				});
			} else if (event.type === 'cancelled' && !event.agent.output?.trim()) {
				presentation.queue.push({ type: 'chat_text', kind: 'final_answer', content: 'Worker cancelled.' });
			} else if (event.type === 'completed' && !event.agent.output?.trim()) {
				presentation.queue.push({ type: 'chat_text', kind: 'final_answer', content: 'Worker completed without a response.' });
			}
			presentation.queue.push(undefined);
		}
	}

	private startChildAgentPresentation(
		owner: ICleanSlateLiveSession,
		sideChat: ICleanSlateLiveSession,
		agent: ICleanSlateChildAgentSnapshot
	): void {
		if (this.childAgentPresentations.has(agent.id)) {
			return;
		}

		let run: ReturnType<typeof this.startRun>;
		try {
			run = this.startRun(sideChat);
		} catch (error) {
			console.error('[CleanSlateChatSessionProvider] Failed to present child agent:', error);
			return;
		}

		const queue = new AsyncQueue<CleanSlateStreamPart>();
		this.childAgentPresentations.set(agent.id, { parent: owner, sideChat, queue, runId: run.runId });
		sideChat.status = 'running';
		sideChat.threadService.addMessage('user', agent.prompt);
		const renderer = this.createSessionScopedRenderer(sideChat, this.createLiveSideChatRenderer(sideChat.id), true);
		renderer.addMessage(agent.prompt, 'user');
		this.notifySessionChanged(sideChat);

		const stream = async function* (): AsyncIterable<CleanSlateStreamPart> {
			while (true) {
				const part = await queue.next();
				if (part === undefined) {
					return;
				}
				yield part;
			}
		};

		void sideChat.controller.sendMessage(
			agent.prompt,
			renderer,
			'normal',
			() => this.notifySessionChanged(sideChat),
			undefined,
			undefined,
			undefined,
			signal => {
				signal.addEventListener('abort', () => {
					if (this.hostedChildren.has(agent.id)) {
						void this.cleanSlateMainService.publishThreadSession({ originId: this.providerId, request: 'cancelChild',
							childAgentId: agent.id, session: this.toPersistedSession(this.buildSessionSnapshot(owner)) });
					} else { owner.agent.cancelChildAgent(agent.id); }
				}, { once: true });
				return stream();
			}
		).finally(() => {
			const settled = this.hostedChildren.get(agent.id) ?? owner.agent.getChildAgent(agent.id);
			if (settled?.output?.trim()) {
				sideChat.threadService.addMessage('assistant', settled.output.trim());
			}
			const status = settled?.status === 'failed' ? 'failed'
				: settled?.status === 'cancelled' ? 'cancelled'
					: 'completed';
			this.finishRun(sideChat, run.runId, status, settled?.error);
			sideChat.status = 'detached';
			this.childAgentPresentations.delete(agent.id);
			this.notifySessionChanged(sideChat);
		});
	}

    restoreSession(session: ICleanSlateSessionSnapshot, live?: ICleanSlateThreadSessionUpdate['live']): void {
        this.deletedSessionIds.delete(session.id);
        let liveSession = this.sessions.get(session.id);
        if (!liveSession) {
            liveSession = this.createLiveSessionFromSnapshot(session, !!live);
            this.registerSession(liveSession);
        } else {
            this.refreshLiveSessionFromSnapshot(liveSession, session, !!live);
        }
        this.activeSessionId = liveSession.id;
        this.activeSessionRevision++;
        liveSession.planMode = session.planMode;
        liveSession.reasoningLevel = session.reasoningLevel;
        liveSession.agentDefinition = session.agent;
        if (live && !this.runState.isRunning(liveSession.id)) {
            liveSession.liveOwnerId = live.ownerId;
        }
        const hasLiveRun = this.runState.isRunning(liveSession.id)
            || (live ? live.isRunning : !!liveSession.liveOwnerId && liveSession.controller.getIsGenerating());
        liveSession.status = hasLiveRun ? 'running' : this.getRestoredSessionStatus(session.status);
        liveSession.controller.setExternalGeneratingState(hasLiveRun);
        this.applyHostedChildEvents(liveSession, live);
        // Agent Manager already persists content changes and archives the outgoing
        // session. Selecting a saved chat must not serialize the entire archive again.
        if (this.surface !== 'agentManager') {
            this.persistSession(liveSession);
        }
        this._onDidChangeState.fire();
        if (!this.applyingPublishedSession) {
            void this.requestLiveSessionSync().catch(error => console.warn('[CleanSlate] Failed to request live session state:', error));
        }
    }

    /**
     * A live session can already exist for the restored id when it was first materialized from a
     * lightweight sidebar summary (stub history) before its full transcript was hydrated from the
     * store. Re-activating it as-is would render the stale, partial transcript, so adopt the
     * incoming snapshot's richer content. A running session owns the authoritative live transcript,
     * so it is never overwritten here.
     */
    private refreshLiveSessionFromSnapshot(liveSession: ICleanSlateLiveSession, snapshot: ICleanSlateSessionSnapshot, fromLiveUpdate = false): void {
        if (this.runState.isRunning(liveSession.id)
            || (!fromLiveUpdate && !!liveSession.liveOwnerId)
            || this.isSessionPayloadCurrent(liveSession, snapshot)) {
            return;
        }
        if (!this.hasVisibleSessionContent(snapshot)) {
            return;
        }
        const wasApplyingPublishedSession = this.applyingPublishedSession;
        this.applyingPublishedSession = true;
        try {
            liveSession.threadService.setHistory(this.snapshotCodec.cloneHistoryWithTranscriptImages(snapshot.history, snapshot.transcript));
            liveSession.transcriptHistory = this.snapshotCodec.cloneTranscript(snapshot.transcript?.length ? snapshot.transcript : deriveCleanSlateTranscriptFromHistory(snapshot.history));
            liveSession.taskSessionService.restoreStateSnapshot(this.snapshotCodec.cloneObject(snapshot.taskState ?? snapshot.threadState), { markActiveTaskInterrupted: !fromLiveUpdate });
            liveSession.agent.restoreRuntimeSnapshot(this.snapshotCodec.cloneObject(snapshot.agentRuntimeState));
            liveSession.agent.setSessionId(liveSession.id);
            liveSession.agent.setAgentDefinition(snapshot.agent);
        } finally {
            this.applyingPublishedSession = wasApplyingPublishedSession;
        }
    }

    markSessionDeleted(sessionId: string): void {
        rememberCleanSlateDeletedSessionId(this.storageService, this.deletedSessionIds, sessionId);
        this.pendingLiveSyncSessions.delete(sessionId);
        if (this.pendingActiveSessionSave?.id === sessionId) {
            this.pendingActiveSessionSave = undefined;
        }
    }

    buildCurrentSessionSnapshot(
        workspaceName?: string,
        planMode: boolean = this.activeSession.planMode,
        reasoningLevel: CleanSlateReasoningLevel = this.activeSession.reasoningLevel
    ): ICleanSlateSessionSnapshot {
        this.activeSession.planMode = planMode;
        this.activeSession.reasoningLevel = reasoningLevel;
        return this.buildSessionSnapshot(this.activeSession, this.activeSession.workspaceName ?? workspaceName, planMode, reasoningLevel);
    }

    private buildSessionSnapshot(
        session: ICleanSlateLiveSession,
        workspaceName?: string,
        planMode: boolean = session.planMode,
        reasoningLevel: CleanSlateReasoningLevel = session.reasoningLevel
    ): ICleanSlateSessionSnapshot {
        session.planMode = planMode;
        session.reasoningLevel = reasoningLevel;
        const history = session.controller.getHistory();
        const runSummary = session.taskSessionService.getRunSummary();

        const activeObjective = runSummary.objective
            ?? session.threadService.getActiveTaskHistory().find(message => message.role === 'user' && message.content.trim().length > 0)?.content
            ?? history.find(message => message.role === 'user' && message.content.trim().length > 0)?.content
            ?? '';

        const title = this.ensureSessionTitle(session, activeObjective, history);
        const now = Date.now();
        const isRunning = this.isLiveSessionRunning(session);

        return {
            id: session.id,
            parentSessionId: session.parentSessionId,
            createdAt: session.createdAt,
            title,
            savedAt: now,
            updatedAt: now,
            workspaceId: session.workspaceId,
            projectRoot: session.projectRoot,
            workDir: session.workDir,
            status: isRunning ? 'running' : this.getRestoredSessionStatus(session.status),
            sessionKey: session.id,
            history: this.snapshotCodec.cloneHistory(session.threadService.getRawHistoryReference()),
            transcript: this.snapshotCodec.cloneTranscript(this.getEffectiveTranscriptHistory(session)),
            transcriptVersion: 1,
            taskState: this.snapshotCodec.cloneObject(session.taskSessionService.getStateSnapshot()),
			agentRuntimeState: this.snapshotCodec.cloneObject(session.agent.getRuntimeSnapshot()),
            planMode: session.planMode,
            reasoningLevel: session.reasoningLevel,
            agent: session.agentDefinition,
            workspaceName: session.workspaceName ?? workspaceName,
            isGenerating: isRunning
        };
    }

    abortGeneration(renderer: IResponseRenderer): void {
        const session = this.activeSession;
        const submission = this.pendingHostedSubmissions.get(session.id);
        if (submission) {
            void submission.then(() => this.requestHostedStop(session)).catch(() => { });
            return;
        }
        if (session.liveOwnerId && this.isLiveSessionRunning(session)) {
            void this.cleanSlateMainService.publishThreadSession({
                originId: this.providerId,
                session: this.toPersistedSession(this.buildSessionSnapshot(session)),
                live: { ownerId: session.liveOwnerId, isRunning: true },
                request: 'stop'
            }).catch(error => console.warn('[CleanSlate] Failed to stop the live session:', error));
            return;
        }
        this.abortSessionGeneration(session, renderer);
    }

    private requestHostedStop(session: ICleanSlateLiveSession): Promise<void> {
        return this.cleanSlateMainService.publishThreadSession({
            originId: this.providerId, session: this.toPersistedSession(this.buildSessionSnapshot(session)),
            live: { ownerId: CLEANSLATE_HOSTED_AGENT_OWNER, isRunning: true }, request: 'stop'
        });
    }

    private abortSessionGeneration(session: ICleanSlateLiveSession, renderer: IResponseRenderer): void {
        const abortedLiveRun = session.controller.abortGeneration(renderer);
        if (abortedLiveRun) {
            this.runState.cancel(session.id, 'User cancelled the run.');
        } else {
            this.runState.clear(session.id);
        }
        session.status = 'stopped';
        this.notifySessionChanged(session);
    }

    applyLastResponse(): void {
        this.activeSession.controller.applyLastResponse();
    }

    sendMessage(
        text: string,
        renderer: IResponseRenderer,
        onGeneratingChange?: (isGenerating: boolean) => void,
        images?: string[]
    ): Promise<void> {
        const session = this.activeSession;
        return this.sendSessionMessage(session, text, renderer, onGeneratingChange, images);
    }

    private sendSessionMessage(
        session: ICleanSlateLiveSession,
        text: string,
        renderer: IResponseRenderer,
        onGeneratingChange?: (isGenerating: boolean) => void,
        images?: string[],
		forceVisibleRenderer = false,
		renderUserMessage = false
    ): Promise<void> {
        if (this.cleanSlateMainService.startHostedAgentRun && !session.parentSessionId) {
            return this.submitHostedRun(session, text, onGeneratingChange, images);
        }
        let run: ReturnType<typeof this.startRun>;
        try {
            run = this.startRun(session);
        } catch (error) {
            return Promise.reject(error);
        }
		if (renderUserMessage) {
			this.createSessionScopedRenderer(session, renderer, forceVisibleRenderer).addMessage(text, 'user', images);
		}
        session.status = 'running';
        session.agent.setAgentDefinition(session.agentDefinition);
        session.agent.setSessionId(session.id);
        session.agent.setToolSurface(this.surface);
        const executionState = normalizeCleanSlateExecutionState({ planMode: session.planMode, reasoningLevel: session.reasoningLevel });
        const executionFlow = executionState.planMode ? 'planning' : 'normal';
        let resolveCurrentRunSettled!: () => void;
        const currentRunSettled = new Promise<void>(resolve => resolveCurrentRunSettled = resolve);
        let resumeRequested = false;
        const resumeAfterModelTermination = (): void => {
            if (resumeRequested) {
                return;
            }
            resumeRequested = true;
            void currentRunSettled.then(() => {
                if (this.sessions.get(session.id) !== session && this.sideChats.get(session.id) !== session) {
                    return;
                }
				this.recordTranscriptMessageForSession(session, { role: 'user', content: 'continue', isInternalState: true });
				return this.sendSessionMessage(session, 'continue', renderer, onGeneratingChange, undefined, forceVisibleRenderer);
            }).catch(error => {
                console.error('[CleanSlateChatSessionProvider] Failed to resume terminated model run:', error);
            });
        };
        return session.controller.sendMessage(
            text,
			this.createSessionScopedRenderer(session, renderer, forceVisibleRenderer),
            executionFlow,
            (isGenerating: boolean) => {
                this.notifySessionChanged(session);
				if (forceVisibleRenderer || this.isActiveSession(session)) {
                    onGeneratingChange?.(isGenerating);
                }
            },
            undefined,
            images,
            resumeAfterModelTermination
        ).then(
            result => {
                this.finishRun(session, run.runId, 'completed');
                return result;
            },
            error => {
                this.finishRun(session, run.runId, this.isAbortLikeError(error) ? 'cancelled' : 'failed', String(error));
                throw error;
            }
        ).finally(() => {
            session.status = 'detached';
            this.notifySessionChanged(session);
            resolveCurrentRunSettled();
        });
    }

    approvePlan(
        renderer: IResponseRenderer,
        planStepsContext: string = '',
        onGeneratingChange?: (isGenerating: boolean) => void
    ): Promise<void> {
        const session = this.activeSession;
        if (this.cleanSlateMainService.startHostedAgentRun && !session.parentSessionId) {
            return this.submitHostedRun(session, planStepsContext, onGeneratingChange, undefined, 'approvePlan');
        }
        let run: ReturnType<typeof this.startRun>;
        try {
            run = this.startRun(session);
        } catch (error) {
            return Promise.reject(error);
        }
        session.status = 'running';
        session.agent.setSessionId(session.id);
        session.agent.setToolSurface(this.surface);
        const executionState = normalizeCleanSlateExecutionState({ planMode: session.planMode, reasoningLevel: session.reasoningLevel });
        const executionFlow = executionState.planMode ? 'planning' : 'normal';
        return session.controller.approvePlan(this.createSessionScopedRenderer(session, renderer), planStepsContext, executionFlow, (isGenerating: boolean) => {
            this.notifySessionChanged(session);
            if (this.isActiveSession(session)) {
                onGeneratingChange?.(isGenerating);
            }
        }).then(
            result => {
                this.finishRun(session, run.runId, 'completed');
                return result;
            },
            error => {
                this.finishRun(session, run.runId, this.isAbortLikeError(error) ? 'cancelled' : 'failed', String(error));
                throw error;
            }
        ).finally(() => {
            session.status = 'detached';
            this.notifySessionChanged(session);
        });
    }

    private submitHostedRun(
        session: ICleanSlateLiveSession, text: string, onGeneratingChange?: (value: boolean) => void,
        images?: string[], action: 'message' | 'approvePlan' = 'message'
    ): Promise<void> {
        if (this.isLiveSessionRunning(session) || this.pendingHostedSubmissions.has(session.id)) {
            return Promise.reject(new Error('This chat already has a running agent.'));
        }
        const previousOwnerId = session.liveOwnerId;
        session.liveOwnerId = CLEANSLATE_HOSTED_AGENT_OWNER;
        session.status = 'running';
        session.controller.setExternalGeneratingState(true);
        onGeneratingChange?.(true);
        const submission = (async () => {
            try {
                const configuration = await session.agent.getHostedConfiguration();
                const version = this.hostedUpdateVersions.get(session.id) ?? 0;
                const update = await this.cleanSlateMainService.startHostedAgentRun!({
                    surface: this.surface === 'agentManager' ? 'agentManager' : 'ide',
                    session: this.toPersistedSession(this.buildSessionSnapshot(session)), text, action, images,
                    configuration: { ...configuration, planMode: session.planMode, reasoningLevel: session.reasoningLevel }
                });
                // Streaming events can arrive before the IPC acknowledgement. Never
                // replace a newer checkpoint with the initial accepted snapshot.
                if ((this.hostedUpdateVersions.get(session.id) ?? 0) === version) {
                    this.applyPublishedThreadSession(update);
                }
            } catch (error) {
                session.liveOwnerId = previousOwnerId;
                session.controller.setExternalGeneratingState(false);
                session.status = 'detached';
                onGeneratingChange?.(false);
                this._onDidChangeState.fire();
                throw error;
            } finally {
                this.pendingHostedSubmissions.delete(session.id);
            }
        })();
        this.pendingHostedSubmissions.set(session.id, submission);
        return submission;
    }

    private syncHostedApprovals(update: ICleanSlateThreadSessionUpdate): void {
        const requests = update.live?.approvals ?? [];
        const activeIds = new Set(requests.map(request => request.id));
        for (const [id, sessionId] of this.hostedApprovals) {
            if (sessionId === update.session.id && !activeIds.has(id)) {
                this.hostedApprovals.delete(id);
                this.commandApprovalService.reject(id);
            }
        }
        for (const request of requests) {
            if (this.hostedApprovals.has(request.id)) { continue; }
            this.hostedApprovals.set(request.id, update.session.id);
            // The approval promise belongs to this view only. Detaching the view
            // leaves the host's pending decision intact for the next subscriber.
            void this.commandApprovalService.requestApproval(request).then(approved => {
                if (!this.hostedApprovals.delete(request.id)) { return; }
                return this.cleanSlateMainService.publishThreadSession({
                    originId: this.providerId, session: update.session,
                    request: approved ? 'approve' : 'reject', approvalId: request.id
                });
            }).catch(error => console.warn('[CleanSlate] Failed to resolve hosted approval:', error));
        }
    }

    rejectPlan(): void {
        if (this.activeSession.liveOwnerId === CLEANSLATE_HOSTED_AGENT_OWNER) {
            void this.cleanSlateMainService.publishThreadSession({
                originId: this.providerId, session: this.toPersistedSession(this.buildSessionSnapshot(this.activeSession)), request: 'rejectPlan'
            }).catch(error => console.warn('[CleanSlate] Failed to reject hosted plan:', error));
        }
        this.activeSession.controller.rejectPlan();
        this.persistSession(this.activeSession);
        this._onDidChangeState.fire();
    }

    approveCommand(blockId: string): void {
        this.commandApprovalService.approve(blockId);
        this.persistSession(this.activeSession);
        this._onDidChangeState.fire();
    }

    approveCommandForSession(blockId: string): void {
        this.commandApprovalService.approveForSession(blockId);
        this.persistSession(this.activeSession);
        this._onDidChangeState.fire();
    }

    rejectCommand(blockId: string): void {
        this.commandApprovalService.reject(blockId);
        this.persistSession(this.activeSession);
        this._onDidChangeState.fire();
    }

    hasPendingCommandApproval(): boolean {
        return this.commandApprovalService.hasPendingApproval(this.activeSession.id);
    }

    getPendingCommandApproval(): ICleanSlateCommandApprovalRequest | undefined {
        return this.commandApprovalService.getPendingApproval(this.activeSession.id);
    }

    resolvePendingCommandApprovalFromChat(text: string, renderer?: IResponseRenderer): boolean {
        const result = this.commandApprovalService.resolveFromChat(text, this.activeSession.id);
        if (result === 'none') {
            return false;
        }
        if (result === 'invalid') {
            renderer?.addSystemConfirmation('Command Approval', 'Reply "yes" to run the command or "no" to cancel it. Other text is left in the input until the command is resolved.', 'warning');
        }
        this.persistSession(this.activeSession);
        this._onDidChangeState.fire();
        return true;
    }

    acceptAll(): void {
        this.activeSession.controller.acceptAll();
        this._onDidChangeState.fire();
    }

    rejectAll(): void {
        this.activeSession.controller.rejectAll();
        this._onDidChangeState.fire();
    }

    private persistSession(session: ICleanSlateLiveSession): void {
		if (this.applyingPublishedSession || this.sideChats.get(session.id) === session) {
            return;
        }
        const snapshot = this.buildSessionSnapshot(session, this.getWorkspaceName());
        if (this.isDeletedSessionSnapshot(snapshot)) {
            if (this.isActiveSession(session)) {
                this.clearActiveSessionSnapshot();
            }
            return;
        }
        if (this.isActiveSession(session)) {
            if (this.surface === 'agentManager') {
                if (snapshot.history.length > 0 || (snapshot.transcript?.length ?? 0) > 0) {
                    this.onDidUpdateInactiveSession?.(snapshot);
                }
                return;
            }
            if (!this.hasVisibleSessionContent(snapshot)) {
                this.clearActiveSessionSnapshot();
                return;
            }
            this.storageService.store(
                CLEANSLATE_ACTIVE_SESSION_STORAGE_KEY,
                JSON.stringify(snapshot),
                StorageScope.WORKSPACE,
                StorageTarget.MACHINE
            );
            this.queueActiveSessionSave(snapshot);
            return;
        }

        if (snapshot.history.length > 0 || (snapshot.transcript?.length ?? 0) > 0) {
            this.onDidUpdateInactiveSession?.(snapshot);
        }
    }

    private notifySessionChanged(session: ICleanSlateLiveSession): void {
        // Restoring a view can emit controller/history events. They must never
        // echo a partially restored snapshot back into the execution owner.
        if (this.applyingPublishedSession) {
            return;
        }
		if (this.sideChats.get(session.id) === session) {
			this._onDidChangeState.fire();
			return;
		}
        this.persistSession(session);
        this.queueLiveSessionPublish(session);
        this._onDidChangeState.fire();
    }

    /**
     * Streaming transcript content is already painted directly by its renderer.
     * Persist it without invalidating the composer, sidebar and workspace chrome;
     * those consumers only need semantic session/status changes.
     */
    private persistTranscriptContent(session: ICleanSlateLiveSession): void {
		if (this.sideChats.get(session.id) === session) {
			return;
		}
        // Agent Manager's persistence callback also rebuilds its complete history
        // tree. The live session already owns this in-memory payload; publish the
        // coalesced checkpoint and let the settled render update the archive/tree.
        if (this.surface !== 'agentManager') {
            this.persistSession(session);
        }
        this.queueLiveSessionPublish(session);
    }

    private queueLiveSessionPublish(session: ICleanSlateLiveSession): void {
        if (this.applyingPublishedSession || session.liveOwnerId || this.sideChats.get(session.id) === session || this.deletedSessionIds.has(session.id)) {
            return;
        }

        this.pendingLiveSyncSessions.set(session.id, session);
        if (this.liveSyncScheduled) {
            return;
        }

        this.liveSyncScheduled = true;
        this.liveSyncQueue = this.liveSyncQueue
            .catch(() => undefined)
            .then(() => this.delay(60))
            .then(() => this.flushLiveSessionPublishLoop())
            .catch(error => console.warn('[CleanSlate] Failed to publish live session update:', error));
    }

    private async flushLiveSessionPublishLoop(): Promise<void> {
        try {
            while (this.pendingLiveSyncSessions.size > 0) {
                const sessions = [...this.pendingLiveSyncSessions.values()];
                this.pendingLiveSyncSessions.clear();
                for (const session of sessions) {
                    if (session.liveOwnerId) {
                        continue;
                    }
                    const snapshot = this.buildSessionSnapshot(session, session.workspaceName ?? this.getWorkspaceName());
                    if (this.isDeletedSessionSnapshot(snapshot) || !this.hasVisibleSessionContent(snapshot)) {
                        continue;
                    }
                    await this.cleanSlateMainService.publishThreadSession({
                        originId: this.providerId,
                        session: this.toPersistedSession(snapshot),
                        live: { ownerId: this.providerId, isRunning: this.isLiveSessionRunning(session) }
                    });
                }
            }
        } finally {
            this.liveSyncScheduled = false;
            if (this.pendingLiveSyncSessions.size > 0) {
                const sessions = [...this.pendingLiveSyncSessions.values()];
                this.pendingLiveSyncSessions.clear();
                for (const session of sessions) {
                    this.queueLiveSessionPublish(session);
                }
            }
        }
    }

    private applyPublishedThreadSession(update: ICleanSlateThreadSessionUpdate): void {
        if (update.originId === this.providerId || (!update.request && update.live?.ownerId === this.providerId)) {
            return;
        }

        const ownedSession = this.sessions.get(update.session.id);
        if (!update.request && update.live?.ownerId === CLEANSLATE_HOSTED_AGENT_OWNER && ownedSession) {
            this.applyHostedChildEvents(ownedSession, update.live);
        }
        if (!update.request && update.live) {
            const previous = this.publishedRunningSessions.get(update.session.id);
            this.publishedRunningSessions.set(update.session.id, update.live.isRunning);
            if (!ownedSession && previous !== update.live.isRunning) {
                this._onDidChangeState.fire();
            }
        }
        if (!update.request && update.live?.ownerId === CLEANSLATE_HOSTED_AGENT_OWNER) {
            this.hostedUpdateVersions.set(update.session.id, (this.hostedUpdateVersions.get(update.session.id) ?? 0) + 1);
            if (ownedSession || update.makeActive) { this.syncHostedApprovals(update); }
            ownedSession?.agent.restoreHostedArtifacts(update.live.artifacts ?? []);
            if (update.live.browser && (!update.live.surface || update.live.surface === this.surface)
                && (ownedSession && this.isActiveSession(ownedSession) || update.makeActive && this.surface === 'ide' && this.isSnapshotForCurrentWorkspace(update.session as ICleanSlateSessionSnapshot))) {
                const browser = update.live.browser;
                const surface = this.surface === 'agentManager' ? `agentManager:${update.session.id}` as const : 'ide';
                void this.instantiationService.invokeFunction(accessor => accessor.get(ICleanSlateBrowserAutomationService))
                    .adoptHostedBrowser(browser.viewId, surface)
                    .catch(error => console.warn('[CleanSlate] Failed to attach hosted browser:', error));
            }
        }
        if (update.request) {
            if (!ownedSession || ownedSession.liveOwnerId || !this.runState.isRunning(ownedSession.id)) {
                return;
            }
            if (update.request === 'stop' && update.live?.ownerId === this.providerId) {
                this.abortSessionGeneration(ownedSession, this.createLiveSideChatRenderer(ownedSession.id));
            } else if (update.request === 'sync') {
                this.queueLiveSessionPublish(ownedSession);
            }
            return;
        }
        // A live task is authoritative. A handoff or another view's saved copy
        // must not replace its native messages or mark its task interrupted.
        if (ownedSession && this.runState.isRunning(ownedSession.id)) {
            return;
        }

        const restored = this.fromPersistedSession(update.session);
        const snapshot = restored && update.live ? {
            ...restored,
            status: update.live.isRunning ? 'running' as const : restored.status,
            isGenerating: update.live.isRunning
        } : restored;
        if (snapshot && this.isDeletedSessionSnapshot(snapshot)) {
            return;
        }
        if (update.makeActive && snapshot && this.surface === 'ide' && this.isSnapshotForCurrentWorkspace(snapshot)) {
            this.pendingLiveSyncSessions.delete(snapshot.id);
            this.externalActiveSessionRefreshPending = true;
            this.applyingPublishedSession = true;
            try {
                this.restoreSession(snapshot, update.live);
                this.activeSession.agent.restoreHostedArtifacts(update.live?.artifacts ?? []);
            } finally {
                this.applyingPublishedSession = false;
            }
            this.persistAppliedPublishedSession(this.activeSession);
            return;
        }
        if (!snapshot) {
            return;
        }

        const session = this.sessions.get(snapshot.id);
        if (!session || (session.liveOwnerId && !update.live) || (update.live?.ownerId !== CLEANSLATE_HOSTED_AGENT_OWNER && this.isSessionPayloadCurrent(session, snapshot))) {
            return;
        }

        this.pendingLiveSyncSessions.delete(session.id);

        this.applyingPublishedSession = true;
        try {
            const executionState = normalizeCleanSlateSessionExecutionState(snapshot);
            session.threadService.setHistory(this.snapshotCodec.cloneHistoryWithTranscriptImages(snapshot.history, snapshot.transcript));
            session.transcriptHistory = this.snapshotCodec.cloneTranscript(snapshot.transcript?.length ? snapshot.transcript : deriveCleanSlateTranscriptFromHistory(snapshot.history));
            session.taskSessionService.restoreStateSnapshot(this.snapshotCodec.cloneObject(snapshot.taskState ?? snapshot.threadState), { markActiveTaskInterrupted: !update.live });
			session.agent.restoreRuntimeSnapshot(this.snapshotCodec.cloneObject(snapshot.agentRuntimeState));
            session.planMode = executionState.planMode;
            session.reasoningLevel = executionState.reasoningLevel;
            session.agentDefinition = snapshot.agent;
            session.agent.setSessionId(session.id);
            session.agent.setAgentDefinition(snapshot.agent);
            session.liveOwnerId = update.live?.ownerId;
            session.transportStatus = update.live?.transportStatus;
            const hasLiveRun = update.live?.isRunning === true;
            session.status = hasLiveRun ? 'running' : this.getRestoredSessionStatus(snapshot.status);
            session.controller.setExternalGeneratingState(hasLiveRun);
        } finally {
            this.applyingPublishedSession = false;
        }

        this.persistAppliedPublishedSession(session);
        this.externalActiveSessionRefreshPending ||= this.isActiveSession(session);
        this._onDidChangeState.fire();
    }

    private isSnapshotForCurrentWorkspace(snapshot: ICleanSlateSessionSnapshot): boolean {
        const normalize = (value: string | undefined): string | undefined => {
            const normalized = value?.trim().replace(/[\\/]+$/, '').toLowerCase();
            return normalized || undefined;
        };
        const workspace = this.workspaceContextService.getWorkspace();
        const currentValues = new Set([
            this.getWorkspaceId(),
            this.getProjectRoot(),
            this.getWorkDir(),
            workspace.id,
            this.getWorkspaceName()
        ].map(normalize).filter((value): value is string => !!value));
        return this.getSessionProjectValues(snapshot)
            .map(normalize)
            .some((value): value is string => !!value && currentValues.has(value));
    }

    private persistAppliedPublishedSession(session: ICleanSlateLiveSession): void {
        const snapshot = this.buildSessionSnapshot(session, this.getWorkspaceName());
        if (this.surface === 'agentManager' || !this.isActiveSession(session)) {
            if (this.hasVisibleSessionContent(snapshot)) {
                this.onDidUpdateInactiveSession?.(snapshot);
            }
            return;
        }

        this.storageService.store(
            CLEANSLATE_ACTIVE_SESSION_STORAGE_KEY,
            JSON.stringify(snapshot),
            StorageScope.WORKSPACE,
            StorageTarget.MACHINE
        );
        this.queueActiveSessionSave(snapshot);
    }

    private isSessionPayloadCurrent(session: ICleanSlateLiveSession, snapshot: ICleanSlateSessionSnapshot): boolean {
        const rightTranscript = snapshot.transcript?.length
            ? snapshot.transcript
            : deriveCleanSlateTranscriptFromHistory(snapshot.history);
        return this.snapshotCodec.areHistoriesEqual(session.threadService.getRawHistoryReference(), snapshot.history)
            && this.snapshotCodec.areTranscriptsEqual(this.getEffectiveTranscriptHistory(session), rightTranscript)
            && this.isLiveSessionRunning(session) === (snapshot.isGenerating === true)
            && this.getRestoredSessionStatus(session.status) === this.getRestoredSessionStatus(snapshot.status);
    }

    private hasVisibleSessionContent(snapshot: Pick<ICleanSlateSessionSnapshot, 'history' | 'transcript'>): boolean {
        const isVisible = (message: ICleanSlateTranscriptMessage): boolean =>
            !message.isInternalState
            && (
                typeof message.content === 'string' && message.content.trim().length > 0
                || typeof message.renderPayload === 'string' && message.renderPayload.trim().length > 0
                || Array.isArray(message.images) && message.images.length > 0
            );
        return snapshot.history.some(isVisible) || (snapshot.transcript?.some(isVisible) ?? false);
    }

    private registerSession(session: ICleanSlateLiveSession): void {
        this.sessions.set(session.id, session);
    }

    private get activeSession(): ICleanSlateLiveSession {
        const session = this.sessions.get(this.activeSessionId);
        if (!session) {
            throw new Error(`CleanSlate active session ${this.activeSessionId} was not found.`);
        }
        return session;
    }

    private isActiveSession(session: ICleanSlateLiveSession): boolean {
        return session.id === this.activeSessionId;
    }

    private isLiveSessionRunning(session: ICleanSlateLiveSession): boolean {
        // Keep controller state as a defensive fallback while run-state transitions notify views.
        return this.runState.isRunning(session.id) || session.controller.getIsGenerating();
    }

    private startRun(session: ICleanSlateLiveSession) {
        if (session.controller.getIsGenerating()) {
            throw new CleanSlateSessionAlreadyRunningError(session.id);
        }
        try {
            session.liveOwnerId = undefined;
            const run = this.runState.start(session.id, session.workspaceId);
            session.controller.setExternalGeneratingState(true);
            this.notifySessionChanged(session);
            return run;
        } catch (error) {
            if (error instanceof CleanSlateSessionAlreadyRunningError) {
                throw new Error('This chat already has a running agent. Stop it or wait for it to finish before sending another message.');
            }
            throw error;
        }
    }

    private finishRun(session: ICleanSlateLiveSession, runId: string, status: Exclude<CleanSlateSessionRunStatus, 'idle' | 'running'>, reason?: string): void {
		const finished = this.runState.finish(session.id, runId, status, reason);
		if (finished) {
			session.controller.setExternalGeneratingState(false);
		}
        if (this.disposeAfterRuns && !this.hasOwnedRunningSessions()) {
            super.dispose();
        }
    }

    private getRestoredSessionStatus(status: CleanSlateSessionState | undefined): CleanSlateSessionState {
        if (status === 'running' || status === 'starting' || status === 'stopping') {
            return 'detached';
        }
        return status ?? 'detached';
    }

    private isAbortLikeError(error: unknown): boolean {
        if (!error || typeof error !== 'object') {
            return false;
        }
        const name = 'name' in error ? String((error as { name?: unknown }).name) : '';
        const message = 'message' in error ? String((error as { message?: unknown }).message) : '';
        return name === 'AbortError' || /abort|cancel|interrupt/i.test(message);
    }

    private createLiveSession(
        sessionId: string = this.createSessionId(),
        planMode = false,
        reasoningLevel: CleanSlateReasoningLevel = 'low',
        metadata: ICleanSlateSessionWorkspaceMetadata & Partial<Pick<ICleanSlateLiveSession, 'parentSessionId' | 'createdAt' | 'status' | 'title'>> = {}
    ): ICleanSlateLiveSession {
		const workspaceMetadata = this.normalizeWorkspaceMetadata(metadata);
		const workspaceContextService = new CleanSlateSessionWorkspaceContextService(this.workspaceContextService, workspaceMetadata);
		const contextService = new CleanSlateSessionContextService(this.cleanSlateContextService, workspaceContextService);
		const instantiationStore = new DisposableStore();
		const sessionInstantiationService = this.instantiationService.createChild(
			new ServiceCollection(
				[IWorkspaceContextService, workspaceContextService],
				[ICleanSlateContextService, contextService],
				[ICleanSlateIndexService, new SyncDescriptor(CleanSlateIndexServiceProxy)]
			),
			instantiationStore
		);
        const threadService = new CleanSlateThreadService();
        const taskSessionService = new CleanSlateTaskSessionService();
        let agent: CleanSlateAgent;

        try {
            // @ts-ignore: Argument count mismatch due to decorated properties
            agent = sessionInstantiationService.createInstance(CleanSlateAgent, threadService, taskSessionService);
            agent.setSessionId(sessionId);
            agent.setToolSurface(this.surface);
            // The agent's injected IWorkspaceContextService is the session-scoped override; give it
            // the real IDE-open workspace too so tools can tell same-project from cross-project
            // before revealing files/artifacts in the editor.
            agent.setIdeWorkspaceContextService(this.workspaceContextService);
        } catch (error) {
            instantiationStore.dispose();
            console.error('%c[CleanSlate] %cAgent Instantiation Failed!', 'color: #EF4444; font-weight: bold;', 'color: inherit;', error);
            throw error;
        }

        const controller = new CleanSlateChatController(
            this.codeEditorService,
            this.editCodeService,
            this.notificationService,
            agent,
            threadService,
            taskSessionService,
            workspaceContextService,
            sessionId,
            this.commandApprovalService
        );

        let liveSession: ICleanSlateLiveSession | undefined;
        const threadHistoryListener = threadService.onDidChangeHistory(() => {
            if (liveSession) {
                this.notifySessionChanged(liveSession);
            }
        });
        const controllerStateListener = controller.onDidChangeState(() => {
            if (liveSession) {
                this.notifySessionChanged(liveSession);
            }
        });
		const childAgentListener = agent.onDidChangeChildAgent(event => {
			if (liveSession) { this.presentChildAgentEvent(liveSession, event); }
		});
		instantiationStore.add(childAgentListener);

        liveSession = {
            id: sessionId,
            parentSessionId: metadata.parentSessionId,
            createdAt: metadata.createdAt ?? Date.now(),
            workspaceId: workspaceMetadata.workspaceId,
            projectRoot: workspaceMetadata.projectRoot,
            workDir: workspaceMetadata.workDir,
            workspaceName: workspaceMetadata.workspaceName,
            threadService,
            taskSessionService,
            agent,
            controller,
            instantiationStore,
            title: metadata.title,
            planMode,
            reasoningLevel,
            transcriptHistory: [],
            status: metadata.status ?? 'starting',
            threadHistoryListener,
            controllerStateListener
        };

        return liveSession;
    }

    private createLiveSessionFromSnapshot(snapshot: ICleanSlateSessionSnapshot, fromLiveUpdate = false): ICleanSlateLiveSession {
        const executionState = normalizeCleanSlateSessionExecutionState(snapshot);
        const session = this.createLiveSession(snapshot.id, executionState.planMode, executionState.reasoningLevel, {
            parentSessionId: snapshot.parentSessionId,
            createdAt: snapshot.createdAt,
            workspaceId: snapshot.workspaceId,
            projectRoot: snapshot.projectRoot,
            workDir: snapshot.workDir,
            workspaceName: snapshot.workspaceName,
            status: this.getRestoredSessionStatus(snapshot.status),
            title: this.deriveStableTitleText('', snapshot.history) || snapshot.title
        });
        session.threadService.setHistory(this.snapshotCodec.cloneHistoryWithTranscriptImages(snapshot.history, snapshot.transcript));
        session.transcriptHistory = this.snapshotCodec.cloneTranscript(snapshot.transcript?.length ? snapshot.transcript : deriveCleanSlateTranscriptFromHistory(snapshot.history));
        session.taskSessionService.restoreStateSnapshot(this.snapshotCodec.cloneObject(snapshot.taskState ?? snapshot.threadState), { markActiveTaskInterrupted: !fromLiveUpdate });
		session.agent.restoreRuntimeSnapshot(this.snapshotCodec.cloneObject(snapshot.agentRuntimeState));
        session.agentDefinition = snapshot.agent;
        session.agent.setSessionId(session.id);
        session.agent.setAgentDefinition(snapshot.agent);
        return session;
    }

    private ensureSessionTitle(
        session: ICleanSlateLiveSession,
        activeObjective?: string,
        history?: readonly { role: string; content: string }[]
    ): string {
        if (session.title && !this.isPlaceholderTitle(session.title)) {
            return session.title;
        }

        const titleText = this.deriveStableTitleText(
            activeObjective ?? session.taskSessionService.getRunSummary().objective ?? '',
            history ?? session.threadService.getRawHistoryReference()
        );
        if (titleText) {
            session.title = titleText.length > 90 ? `${titleText.slice(0, 90)}...` : titleText;
            return session.title;
        }

        return session.title ?? 'Agent';
    }

    private deriveStableTitleText(activeObjective: string, history: readonly { role: string; content: string }[]): string {
        const firstUserMessage = history.find(message => message.role === 'user' && message.content.trim().length > 0)?.content ?? '';
        return normalizeCleanSlateVisibleWhitespace(getCleanSlateVisibleUserRequestText(firstUserMessage || activeObjective));
    }

    private isPlaceholderTitle(title: string): boolean {
        const normalized = title.trim().toLowerCase();
        return normalized === 'agent' || normalized === 'untitled chat';
    }

	private createSessionScopedRenderer(session: ICleanSlateLiveSession, renderer: IResponseRenderer, forceVisible = false): IResponseRenderer {
		const isVisible = () => (forceVisible || this.isActiveSession(session))
            && (renderer as IResponseRenderer & { isVisible?: () => boolean }).isVisible?.() !== false;
        const visibleTargets = new WeakMap<HTMLElement, HTMLElement>();
        const findTranscriptMessageElement = (renderer as IResponseRenderer & {
            findTranscriptMessageElement?: (transcriptId: string) => HTMLElement | undefined;
        }).findTranscriptMessageElement?.bind(renderer);
        // Painting and durability have different latency requirements. Keep the
        // visible transcript frame-paced, while persisting only the latest payload
        // in each short window. A settled render always flushes synchronously.
        const pendingStreamingPayloads = new Map<string, ChatResponse>();
        let streamingPayloadTimer: ReturnType<typeof setTimeout> | undefined;
        const persistExistingTranscriptPayload = (transcriptId: string, data: ChatResponse, isStreaming: boolean, emitStateChange: boolean): void => {
            const renderPayload = stringifyCleanSlateTranscriptRenderPayload(data, isStreaming, { preserveStreamingState: isStreaming });
            if (renderPayload) {
                this.updateTranscriptMessageForSession(session, transcriptId, { renderPayload }, emitStateChange);
            }
        };
        const flushStreamingPayloads = (): void => {
            streamingPayloadTimer = undefined;
            const pending = [...pendingStreamingPayloads];
            pendingStreamingPayloads.clear();
            for (const [transcriptId, data] of pending) {
                persistExistingTranscriptPayload(transcriptId, data, true, false);
            }
        };
        const queueStreamingPayload = (transcriptId: string, data: ChatResponse): void => {
            pendingStreamingPayloads.set(transcriptId, data);
            if (streamingPayloadTimer !== undefined) {
                return;
            }
            streamingPayloadTimer = setTimeout(flushStreamingPayloads, CLEANSLATE_STREAMING_TRANSCRIPT_SAVE_INTERVAL_MS);
        };
        const removePendingStreamingPayload = (transcriptId: string): void => {
            pendingStreamingPayloads.delete(transcriptId);
            if (pendingStreamingPayloads.size === 0 && streamingPayloadTimer !== undefined) {
                clearTimeout(streamingPayloadTimer);
                streamingPayloadTimer = undefined;
            }
        };

        return {
            addMessage: (text: string, role: 'user' | 'cleanSlate', images?: string[]): HTMLElement => {
				const element = isVisible()
                    ? renderer.addMessage(text, role, images)
                    : this.createDetachedMessageElement(role);
                const transcriptId = this.recordTranscriptMessageForSession(session, {
                    role: role === 'cleanSlate' ? 'assistant' : role,
                    content: text,
                    images
                });
                if (transcriptId) {
                    element.dataset.cleanSlateTranscriptId = transcriptId;
                }
                return element;
            },
            addUserSelectionMessage: (display, images?: string[]): HTMLElement => {
				const element = isVisible() && renderer.addUserSelectionMessage
                    ? renderer.addUserSelectionMessage(display, images)
                    : this.createDetachedMessageElement('user');
                const content = [display.label, display.command].filter(Boolean).join(' ');
                const transcriptId = this.recordTranscriptMessageForSession(session, {
                    role: 'user',
                    content,
                    images,
                    renderPayload: stringifyCleanSlateUserSelectionDisplay(display)
                });
                if (transcriptId) {
                    element.dataset.cleanSlateTranscriptId = transcriptId;
                }
                return element;
            },
            addSystemConfirmation: (title: string, message: string, icon?: string): HTMLElement => {
				return isVisible()
                    ? renderer.addSystemConfirmation(title, message, icon)
                    : document.createElement('div');
            },
			showTransportRetry: (status): void => {
				if (isVisible()) {
					renderer.showTransportRetry(status);
				}
			},
			clearTransportRetry: (): void => {
				if (isVisible()) {
					renderer.clearTransportRetry();
				}
			},
			addModelTerminated: (message, onContinue): HTMLElement => {
				return isVisible()
					? renderer.addModelTerminated(message, onContinue)
					: document.createElement('div');
			},
            renderJSONResponse: (data, isStreaming, targetMessage) => {
                let renderTarget = targetMessage;
				if (isVisible()) {
                    const transcriptId = targetMessage?.dataset.cleanSlateTranscriptId;
                    const restoredTarget = transcriptId ? findTranscriptMessageElement?.(transcriptId) : undefined;
                    if (restoredTarget) {
                        renderTarget = restoredTarget;
                        if (targetMessage) {
                            visibleTargets.set(targetMessage, restoredTarget);
                        }
                    } else if (targetMessage && !targetMessage.isConnected) {
                        const existingVisibleTarget = visibleTargets.get(targetMessage);
                        if (existingVisibleTarget?.isConnected) {
                            renderTarget = existingVisibleTarget;
                        } else {
                            renderTarget = renderer.addMessage('', 'cleanSlate');
                            if (transcriptId) {
                                renderTarget.dataset.cleanSlateTranscriptId = transcriptId;
                            }
                            visibleTargets.set(targetMessage, renderTarget);
                        }
                    }
                    renderer.renderJSONResponse(data, isStreaming, renderTarget);
                }

                const existingTranscriptId = targetMessage?.dataset.cleanSlateTranscriptId ?? renderTarget?.dataset.cleanSlateTranscriptId;
                if (existingTranscriptId) {
                    if (isStreaming) {
                        queueStreamingPayload(existingTranscriptId, data);
                    } else {
                        removePendingStreamingPayload(existingTranscriptId);
                        persistExistingTranscriptPayload(existingTranscriptId, data, false, true);
                    }
                    return;
                }

                const renderPayload = stringifyCleanSlateTranscriptRenderPayload(data, isStreaming, { preserveStreamingState: isStreaming });
                if (!renderPayload) {
                    return;
                }

                const transcriptId = this.recordTranscriptMessageForSession(session, {
                    role: 'assistant',
                    content: '',
                    renderPayload
                });
                if (transcriptId) {
                    if (targetMessage) {
                        targetMessage.dataset.cleanSlateTranscriptId = transcriptId;
                    }
                    if (renderTarget) {
                        renderTarget.dataset.cleanSlateTranscriptId = transcriptId;
                    }
                }
            },
            removeStreamingPlaceholders: () => {
				if (isVisible()) {
                    renderer.removeStreamingPlaceholders();
                }
            },
            scrollToBottom: () => {
				if (isVisible()) {
                    renderer.scrollToBottom();
                }
            }
        };
    }

    private createDetachedMessageElement(role: 'user' | 'cleanSlate'): HTMLElement {
        const element = document.createElement('div');
        element.className = `cleanSlate-chat-message ${role}`;
        return element;
    }

    private clearActiveSessionSnapshot(): void {
        if (this.surface === 'agentManager') {
            return;
        }
        this.storageService.remove(CLEANSLATE_ACTIVE_SESSION_STORAGE_KEY, StorageScope.WORKSPACE);
        this.pendingActiveSessionSave = undefined;
        this.persistenceQueue = this.persistenceQueue
            .catch(() => undefined)
            .then(() => this.cleanSlateMainService.clearActiveThreadSession(this.getWorkspaceId()))
            .catch(error => console.warn('[CleanSlate] Failed to clear persisted active session:', error));
    }

    private loadActiveSessionSnapshot(): ICleanSlateSessionSnapshot | undefined {
        const raw = this.storageService.get(CLEANSLATE_ACTIVE_SESSION_STORAGE_KEY, StorageScope.WORKSPACE);
        if (!raw) {
            return undefined;
        }

        try {
            const parsed = JSON.parse(raw);
            if (!parsed
                || !Array.isArray(parsed.history)
                || typeof parsed.id !== 'string'
                || typeof parsed.title !== 'string'
                || typeof parsed.savedAt !== 'number'
            ) {
                return undefined;
            }

            const workspaceName = this.getWorkspaceName();
            if (parsed.workspaceName && workspaceName && parsed.workspaceName !== workspaceName) {
                return undefined;
            }

            const executionState = normalizeCleanSlateSessionExecutionState(parsed);
            const snapshot: ICleanSlateSessionSnapshot = {
                id: parsed.id,
                parentSessionId: typeof parsed.parentSessionId === 'string' ? parsed.parentSessionId : undefined,
                createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : parsed.savedAt,
                title: parsed.title,
                savedAt: parsed.savedAt,
                updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : parsed.savedAt,
                workspaceId: typeof parsed.workspaceId === 'string' ? parsed.workspaceId : this.getWorkspaceId(),
                projectRoot: typeof parsed.projectRoot === 'string' ? parsed.projectRoot : this.getProjectRoot(),
                workDir: typeof parsed.workDir === 'string' ? parsed.workDir : this.getWorkDir(),
                status: this.getRestoredSessionStatus(isCleanSlateSessionState(parsed.status) ? parsed.status : undefined),
                sessionKey: typeof parsed.sessionKey === 'string' ? parsed.sessionKey : parsed.id,
                history: this.snapshotCodec.cloneHistory(parsed.history),
                transcript: Array.isArray(parsed.transcript)
                    ? this.snapshotCodec.cloneTranscript(parsed.transcript)
                    : deriveCleanSlateTranscriptFromHistory(parsed.history),
                transcriptVersion: typeof parsed.transcriptVersion === 'number' ? parsed.transcriptVersion : undefined,
                taskState: this.snapshotCodec.cloneObject(parsed.taskState),
                threadState: this.snapshotCodec.cloneObject(parsed.threadState),
                planMode: executionState.planMode,
                reasoningLevel: executionState.reasoningLevel,
                agent: parsed.agent,
                workspaceName: parsed.workspaceName,
                isGenerating: false
            };
            return this.hasVisibleSessionContent(snapshot) && !this.isDeletedSessionSnapshot(snapshot) ? snapshot : undefined;
        } catch {
            return undefined;
        }
    }

    private getWorkspaceName(): string | undefined {
        return this.workspaceContextService.getWorkspace().folders[0]?.name;
    }

    private getWorkspaceId(): string {
        const workspace = this.workspaceContextService.getWorkspace();
        const projectRoot = this.getProjectRoot();
        if (projectRoot) {
            return projectRoot;
        }
        if (workspace.folders.length === 0) {
            return 'no-project';
        }
        return workspace.id || this.getWorkspaceName() || 'default';
    }

    private getProjectRoot(): string | undefined {
        return this.workspaceContextService.getWorkspace().folders[0]?.uri.toString();
    }

    private getWorkDir(): string | undefined {
        return this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
    }

    private normalizeWorkspaceMetadata(metadata: ICleanSlateSessionWorkspaceMetadata): Required<ICleanSlateSessionWorkspaceMetadata> {
        const hasExplicitMetadata = this.hasExplicitWorkspaceMetadata(metadata);
        const isNoProject = this.isNoProjectWorkspaceMetadata(metadata);
        const projectRoot = isNoProject
            ? ''
            : metadata.projectRoot ?? (hasExplicitMetadata ? '' : this.getProjectRoot() ?? '');
        const workDir = isNoProject
            ? ''
            : metadata.workDir ?? (hasExplicitMetadata ? this.resolveWorkspaceUri(projectRoot)?.fsPath ?? '' : this.getWorkDir() ?? this.resolveWorkspaceUri(projectRoot)?.fsPath ?? '');
        const workspaceName = metadata.workspaceName
            ?? (hasExplicitMetadata ? undefined : this.getWorkspaceName())
            ?? this.resolveWorkspaceName(projectRoot, workDir);
        const workspaceId = metadata.workspaceId?.trim()
            || projectRoot.trim()
            || workDir.trim()
            || (hasExplicitMetadata ? 'no-project' : this.getWorkspaceId());
        return {
            workspaceId,
            projectRoot,
            workDir,
            workspaceName
        };
    }

    private hasExplicitWorkspaceMetadata(metadata: ICleanSlateSessionWorkspaceMetadata): boolean {
        return metadata.workspaceId !== undefined
            || metadata.projectRoot !== undefined
            || metadata.workDir !== undefined
            || metadata.workspaceName !== undefined;
    }

    private isNoProjectWorkspaceMetadata(metadata: ICleanSlateSessionWorkspaceMetadata): boolean {
        const workspaceId = metadata.workspaceId?.trim().toLowerCase();
        const workspaceName = metadata.workspaceName?.trim().toLowerCase();
        return workspaceId === 'no-project' || workspaceName === 'no project';
    }

    private resolveWorkspaceUri(projectRoot: string | undefined): URI | undefined {
        const trimmed = projectRoot?.trim();
        if (!trimmed) {
            return undefined;
        }
        try {
            const uri = URI.parse(trimmed);
            if (uri.scheme) {
                return uri;
            }
        } catch {
            // Fall through to local path handling.
        }
        return this.isAbsolutePathLike(trimmed) ? URI.file(trimmed) : undefined;
    }

    private resolveWorkspaceName(projectRoot: string | undefined, workDir: string | undefined): string {
        const trimmedWorkDir = workDir?.trim();
        const uri = this.resolveWorkspaceUri(projectRoot)
            ?? (trimmedWorkDir && this.isAbsolutePathLike(trimmedWorkDir) ? URI.file(trimmedWorkDir) : undefined);
        return uri ? basename(uri) : 'No project';
    }

    private isAbsolutePathLike(value: string): boolean {
        return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
    }

    private getEffectiveTranscriptHistory(session: ICleanSlateLiveSession): ICleanSlateTranscriptMessage[] {
        return session.transcriptHistory.length > 0
            ? session.transcriptHistory
            : deriveCleanSlateTranscriptFromHistory(session.threadService.getRawHistoryReference());
    }

    private createSessionId(): string {
        return generateUuid();
    }

    private createTranscriptMessageId(): string {
        return `transcript-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private async initializePersistentActiveSession(storageSession: ICleanSlateSessionSnapshot | undefined): Promise<void> {
        const revisionAtStart = this.activeSessionRevision;
        try {
            const persisted = await this.cleanSlateMainService.loadActiveThreadSession(this.getWorkspaceId());
            if (this.activeSessionRevision !== revisionAtStart) {
                return;
            }
            if (!this.isCurrentHistoryStill(storageSession)) {
                return;
            }
            const dbSession = this.fromPersistedSession(persisted);
            if (dbSession) {
                const storageTime = storageSession?.savedAt ?? 0;
                const dbTime = persisted?.updatedAt ?? dbSession.savedAt;
                if (!storageSession || dbTime >= storageTime) {
                    this.restoreSession(dbSession);
                    return;
                }
            }

            if (storageSession && storageSession.history.length > 0) {
                this.queueActiveSessionSave(storageSession);
            }
        } catch (error) {
            console.warn('[CleanSlate] Failed to initialize persisted active session:', error);
        }
    }

    private queueActiveSessionSave(snapshot: ICleanSlateSessionSnapshot): void {
        this.pendingActiveSessionSave = snapshot;
        if (this.activeSessionSaveScheduled) {
            return;
        }

        this.activeSessionSaveScheduled = true;
        this.persistenceQueue = this.persistenceQueue
            .catch(() => undefined)
            .then(() => this.delay(CLEANSLATE_ACTIVE_SESSION_SAVE_DEBOUNCE_MS))
            .then(() => this.flushActiveSessionSaveLoop())
            .catch(error => console.warn('[CleanSlate] Failed to persist active session:', error));
    }

    private async flushActiveSessionSaveLoop(): Promise<void> {
        try {
            while (this.pendingActiveSessionSave) {
                const snapshot = this.pendingActiveSessionSave;
                this.pendingActiveSessionSave = undefined;
                if (this.isDeletedSessionSnapshot(snapshot) || !this.hasVisibleSessionContent(snapshot)) {
                    continue;
                }
                await this.cleanSlateMainService.saveActiveThreadSession(this.getSnapshotWorkspaceId(snapshot), this.toPersistedSession(snapshot));
            }
        } finally {
            this.activeSessionSaveScheduled = false;
            if (this.pendingActiveSessionSave) {
                this.queueActiveSessionSave(this.pendingActiveSessionSave);
            }
        }
    }

    private toPersistedSession(snapshot: ICleanSlateSessionSnapshot): ICleanSlatePersistedSession {
        const executionState = normalizeCleanSlateSessionExecutionState(snapshot);
        return {
            id: snapshot.id,
            parentSessionId: snapshot.parentSessionId,
            createdAt: snapshot.createdAt,
            title: snapshot.title,
            savedAt: snapshot.savedAt,
            updatedAt: Date.now(),
            workspaceId: snapshot.workspaceId,
            projectRoot: snapshot.projectRoot,
            workDir: snapshot.workDir,
            status: this.getRestoredSessionStatus(snapshot.status),
            isGenerating: undefined,
            sessionKey: snapshot.sessionKey,
            workspaceName: snapshot.workspaceName,
            planMode: executionState.planMode,
            reasoningLevel: executionState.reasoningLevel,
            history: this.snapshotCodec.cloneHistory(snapshot.history),
            transcript: this.snapshotCodec.cloneTranscript(snapshot.transcript?.length ? snapshot.transcript : deriveCleanSlateTranscriptFromHistory(snapshot.history)),
            transcriptVersion: snapshot.transcriptVersion ?? 1,
            taskState: this.snapshotCodec.cloneObject(snapshot.taskState),
            threadState: this.snapshotCodec.cloneObject(snapshot.threadState),
			agentRuntimeState: this.snapshotCodec.cloneObject(snapshot.agentRuntimeState),
            agent: this.snapshotCodec.cloneObject(snapshot.agent)
        };
    }

    private getSnapshotWorkspaceId(snapshot: ICleanSlateSessionSnapshot): string {
        return snapshot.projectRoot?.trim()
            || snapshot.workDir?.trim()
            || snapshot.workspaceId?.trim()
            || this.getWorkspaceId();
    }

    private fromPersistedSession(session: ICleanSlatePersistedSession | undefined): ICleanSlateSessionSnapshot | undefined {
        if (!session
            || typeof session.id !== 'string'
            || typeof session.title !== 'string'
            || typeof session.savedAt !== 'number'
            || !Array.isArray(session.history)
        ) {
            return undefined;
        }

        const executionState = normalizeCleanSlateSessionExecutionState(session);
        const snapshot: ICleanSlateSessionSnapshot = {
            id: session.id,
            parentSessionId: typeof session.parentSessionId === 'string' ? session.parentSessionId : undefined,
            createdAt: typeof session.createdAt === 'number' ? session.createdAt : session.savedAt,
            title: session.title,
            savedAt: session.updatedAt ?? session.savedAt,
            updatedAt: session.updatedAt ?? session.savedAt,
            workspaceId: typeof session.workspaceId === 'string' ? session.workspaceId : this.getWorkspaceId(),
            projectRoot: typeof session.projectRoot === 'string' ? session.projectRoot : this.getProjectRoot(),
            workDir: typeof session.workDir === 'string' ? session.workDir : this.getWorkDir(),
            status: this.getRestoredSessionStatus(isCleanSlateSessionState(session.status) ? session.status : undefined),
            sessionKey: typeof session.sessionKey === 'string' ? session.sessionKey : session.id,
            history: this.snapshotCodec.cloneHistory(session.history),
            transcript: Array.isArray(session.transcript)
                ? this.snapshotCodec.cloneTranscript(session.transcript)
                : deriveCleanSlateTranscriptFromHistory(session.history),
            transcriptVersion: typeof session.transcriptVersion === 'number' ? session.transcriptVersion : undefined,
            taskState: this.snapshotCodec.cloneObject(session.taskState) as ICleanSlateSessionSnapshot['taskState'],
            threadState: this.snapshotCodec.cloneObject(session.threadState) as ICleanSlateSessionSnapshot['threadState'],
			agentRuntimeState: this.snapshotCodec.cloneObject(session.agentRuntimeState) as ICleanSlateSessionSnapshot['agentRuntimeState'],
            planMode: executionState.planMode,
            reasoningLevel: executionState.reasoningLevel,
            agent: this.snapshotCodec.cloneObject(session.agent) as AgentDefinition | undefined,
            workspaceName: session.workspaceName,
            isGenerating: false
        };
        return this.hasVisibleSessionContent(snapshot) && !this.isDeletedSessionSnapshot(snapshot) ? snapshot : undefined;
    }

    private isDeletedSessionSnapshot(snapshot: ICleanSlateSessionSnapshot): boolean {
        const sessionTime = snapshot.updatedAt ?? snapshot.savedAt ?? snapshot.createdAt;
        return this.deletedSessionIds.has(snapshot.id)
            || isCleanSlateSessionDeletedByGlobalCutoff(this.deletedBefore, sessionTime)
            || isCleanSlateSessionDeletedByProjectCutoff(this.deletedProjectCutoffs, this.getSessionProjectValues(snapshot), sessionTime);
    }

    private getSessionProjectValues(snapshot: ICleanSlateSessionSnapshot): string[] {
        return [
            snapshot.projectRoot,
            snapshot.workDir,
            snapshot.workspaceId,
            snapshot.workspaceName
        ].filter((value): value is string => !!value?.trim());
    }

    private isCurrentHistoryStill(storageSession: ICleanSlateSessionSnapshot | undefined): boolean {
        return this.snapshotCodec.areHistoriesEqual(
            this.activeSession.threadService.getRawHistoryReference(),
            storageSession?.history ?? []
        );
    }

}

/**
 * Session boundary for host editor context. Agent Manager can keep project A
 * open in the IDE while a thread operates on project B; the global context
 * service still reports project A's active/open editors. Filter that host state
 * through the session-scoped workspace before it reaches prompts or tools.
 */
export class CleanSlateSessionContextService implements ICleanSlateContextService {
    declare readonly _serviceBrand: undefined;

    constructor(
        private readonly fallback: ICleanSlateContextService,
        private readonly workspaceContextService: IWorkspaceContextService
    ) { }

    async getContext(): Promise<ICleanSlateContext> {
        const context = await this.fallback.getContext();
        const activeFile = context.activeFile && this.workspaceContextService.isInsideWorkspace(context.activeFile.uri)
            ? context.activeFile
            : undefined;
        const openFiles = context.openFiles.filter(file => this.workspaceContextService.isInsideWorkspace(file.uri));
        return { activeFile, openFiles };
    }
}

class CleanSlateSessionWorkspaceContextService implements IWorkspaceContextService {
    declare readonly _serviceBrand: undefined;

    readonly onDidChangeWorkbenchState: Event<WorkbenchState>;
    readonly onDidChangeWorkspaceName: Event<void>;
    readonly onWillChangeWorkspaceFolders: Event<IWorkspaceFoldersWillChangeEvent>;
    readonly onDidChangeWorkspaceFolders: Event<IWorkspaceFoldersChangeEvent>;
    private readonly workspace: IWorkspace;

    constructor(
        private readonly fallback: IWorkspaceContextService,
        metadata: Required<ICleanSlateSessionWorkspaceMetadata>
    ) {
        this.onDidChangeWorkbenchState = fallback.onDidChangeWorkbenchState;
        this.onDidChangeWorkspaceName = fallback.onDidChangeWorkspaceName;
        this.onWillChangeWorkspaceFolders = fallback.onWillChangeWorkspaceFolders;
        this.onDidChangeWorkspaceFolders = fallback.onDidChangeWorkspaceFolders;
        this.workspace = this.createWorkspace(metadata);
    }

    getCompleteWorkspace(): Promise<IWorkspace> {
        return Promise.resolve(this.workspace);
    }

    getWorkspace(): IWorkspace {
        return this.workspace;
    }

    getWorkbenchState(): WorkbenchState {
        return this.workspace.folders.length > 0 ? WorkbenchState.FOLDER : this.fallback.getWorkbenchState();
    }

    getWorkspaceFolder(resource: URI): IWorkspaceFolder | null {
        return this.workspace.folders.find(folder => isEqualOrParent(resource, folder.uri)) ?? null;
    }

    isCurrentWorkspace(workspaceIdOrFolder: IWorkspaceIdentifier | ISingleFolderWorkspaceIdentifier | URI): boolean {
        if (URI.isUri(workspaceIdOrFolder)) {
            return this.workspace.folders.some(folder => folder.uri.toString() === workspaceIdOrFolder.toString());
        }
        return workspaceIdOrFolder.id === this.workspace.id;
    }

    isInsideWorkspace(resource: URI): boolean {
        return this.getWorkspaceFolder(resource) !== null;
    }

    private createWorkspace(metadata: Required<ICleanSlateSessionWorkspaceMetadata>): IWorkspace {
        const folderUri = this.resolveFolderUri(metadata);
        const folders = folderUri ? [this.createFolder(folderUri, metadata.workspaceName)] : [];
        return {
            id: metadata.workspaceId,
            folders,
            transient: true,
            configuration: null
        };
    }

    private createFolder(uri: URI, name: string): IWorkspaceFolder {
        return {
            uri,
            name: name || basename(uri),
            index: 0,
            toResource: relativePath => joinPath(uri, relativePath)
        };
    }

    private resolveFolderUri(metadata: Required<ICleanSlateSessionWorkspaceMetadata>): URI | undefined {
        const root = metadata.projectRoot.trim();
        if (root) {
            try {
                const uri = URI.parse(root);
                if (uri.scheme) {
                    return uri;
                }
            } catch {
                return URI.file(root);
            }
        }
        return metadata.workDir.trim() ? URI.file(metadata.workDir.trim()) : undefined;
    }
}
