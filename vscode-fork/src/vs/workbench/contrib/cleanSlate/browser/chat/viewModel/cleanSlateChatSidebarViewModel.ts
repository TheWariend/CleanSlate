/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../../base/common/uri.js';
import type { CleanSlateReasoningLevel } from '../../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { AgentDefinition } from '../../composer/registry/agentSchema.js';
import { ICleanSlateRunSummary } from '../../core/cleanSlateTaskSessionService.js';
import { CleanSlateChatComposerProvider, type ICleanSlateEditorSelectionReference } from '../providers/cleanSlateChatComposerProvider.js';
import { CleanSlateChatHistoryProvider } from '../providers/cleanSlateChatHistoryProvider.js';
import { CleanSlateChatModelProvider, ICleanSlateModelDropdownState } from '../providers/cleanSlateChatModelProvider.js';
import { CleanSlateChatSessionProvider, type ICleanSlateSessionWorkspaceMetadata } from '../providers/cleanSlateChatSessionProvider.js';
import { CleanSlateChatSettingsProvider, ICleanSlateChatSettingsState } from '../providers/cleanSlateChatSettingsProvider.js';
import { ICleanSlateSessionSnapshot, ICleanSlateTranscriptMessage } from '../types/cleanSlateChatSessionTypes.js';
import { IResponseRenderer } from '../types/cleanSlateChatTypes.js';
import type { ICleanSlateCommandApprovalRequest } from '../../core/cleanSlateCommandApprovalService.js';

export interface ICleanSlateChatSidebarState {
	readonly planMode: boolean;
	readonly reasoningLevel: CleanSlateReasoningLevel;
	readonly phase: string;
	readonly isGenerating: boolean;
	readonly canApprovePlan: boolean;
	readonly title: string;
	readonly currentWorkItem?: string;
	readonly currentAgent?: AgentDefinition;
	readonly runSummary: ICleanSlateRunSummary;
	readonly history: readonly { role: string; content: string }[];
	readonly model: ICleanSlateModelDropdownState;
	readonly settings: ICleanSlateChatSettingsState;
	readonly pendingImages: readonly string[];
	readonly pendingSelectionReferences: readonly ICleanSlateEditorSelectionReference[];
	readonly pendingEdits: readonly { uri: URI; added: number; deleted: number }[];
	readonly archivedSessions: readonly ICleanSlateSessionSnapshot[];
	readonly isRestoringSession: boolean;
}

export class CleanSlateChatSidebarViewModel {
	constructor(
		private readonly sessionProvider: CleanSlateChatSessionProvider,
		private readonly historyProvider: CleanSlateChatHistoryProvider,
		private readonly composerProvider: CleanSlateChatComposerProvider,
		private readonly settingsProvider: CleanSlateChatSettingsProvider,
		private readonly modelProvider: CleanSlateChatModelProvider
	) {
		this.composerProvider.setActiveSession(this.sessionProvider.getActiveSessionId(), false);
		this.syncExecutionStateFromSettings();
	}

	whenReady(): Promise<void> {
		return Promise.all([
			this.sessionProvider.whenReady(),
			this.historyProvider.whenReady()
		]).then(() => undefined);
	}

	getActiveSessionId(): string {
		return this.sessionProvider.getActiveSessionId();
	}

	consumeExternalActiveSessionRefresh(): boolean {
		return this.sessionProvider.consumeExternalActiveSessionRefresh();
	}

	getState(): ICleanSlateChatSidebarState {
		this.composerProvider.setActiveSession(this.sessionProvider.getActiveSessionId(), false);
		const settings = this.settingsProvider.getState();
		return {
			planMode: this.sessionProvider.getCurrentPlanMode(),
			reasoningLevel: this.sessionProvider.getCurrentReasoningLevel(),
			phase: this.sessionProvider.getPhase(),
			isGenerating: this.sessionProvider.getIsGenerating(),
			canApprovePlan: this.sessionProvider.canApprovePlan(),
			title: this.sessionProvider.getCurrentTitle(),
			currentWorkItem: this.sessionProvider.getCurrentWorkItem(),
			currentAgent: this.sessionProvider.getCurrentAgent(),
			runSummary: this.sessionProvider.getRunSummary(),
			history: this.sessionProvider.getHistory(),
			model: this.modelProvider.getState(),
			settings,
			pendingImages: this.composerProvider.getPendingImages(),
			pendingSelectionReferences: this.composerProvider.getPendingSelectionReferences(),
			pendingEdits: this.sessionProvider.getPendingEditsInfo(),
			archivedSessions: this.historyProvider.getArchivedSessions(),
			isRestoringSession: this.historyProvider.getIsRestoringSession()
		};
	}

	startNewChat(workspaceMetadata: ICleanSlateSessionWorkspaceMetadata = {}, options: { readonly archiveCurrent?: boolean } = {}): void {
		const reasoningLevel = this.getReasoningLevel();
		if (options.archiveCurrent !== false) {
			this.archiveCurrentSession();
		}
		this.sessionProvider.startNewChat(false, reasoningLevel, workspaceMetadata);
		this.composerProvider.setActiveSession(this.sessionProvider.getActiveSessionId());
		void this.settingsProvider.updatePlanMode(false);
	}

	archiveCurrentSession(): void {
		this.sessionProvider.setExecutionState(this.getPlanMode(), this.getReasoningLevel());
		this.historyProvider.archiveCurrentSession(this.sessionProvider);
	}

	restoreSession(session: ICleanSlateSessionSnapshot): void {
		this.sessionProvider.restoreSession(session);
		this.composerProvider.setActiveSession(this.sessionProvider.getActiveSessionId());
		void this.settingsProvider.updatePlanMode(session.planMode);
		void this.settingsProvider.updateReasoningLevel(session.reasoningLevel);
	}

	syncExecutionStateFromSettings(): void {
		this.sessionProvider.setExecutionState(this.getPlanMode(), this.getReasoningLevel());
	}

	updatePlanMode(planMode: boolean): Promise<void> {
		this.sessionProvider.setExecutionState(planMode, this.getReasoningLevel());
		return this.settingsProvider.updatePlanMode(planMode);
	}

	updateReasoningLevel(reasoningLevel: CleanSlateReasoningLevel): Promise<void> {
		this.sessionProvider.setExecutionState(this.getPlanMode(), reasoningLevel);
		return this.settingsProvider.updateReasoningLevel(reasoningLevel);
	}

	runWithRestoringSession<T>(callback: () => T): T {
		this.historyProvider.setRestoringSession(true);
		try {
			return callback();
		} finally {
			this.historyProvider.setRestoringSession(false);
		}
	}

	removeArchivedSession(sessionId: string): void {
		this.historyProvider.removeArchivedSession(sessionId);
	}

	getCurrentSessionSnapshot(): ICleanSlateSessionSnapshot {
		this.sessionProvider.setExecutionState(this.getPlanMode(), this.getReasoningLevel());
		return this.historyProvider.getCurrentSessionSnapshot(this.sessionProvider);
	}

	buildHistoryOverlayData(): {
		activeSessionId: string;
		sessions: readonly ICleanSlateSessionSnapshot[];
		workspaceName: string;
	} {
		const currentSession = this.getCurrentSessionSnapshot();
		return {
			activeSessionId: currentSession.id,
			sessions: this.historyProvider.getSessionIndex(currentSession),
			workspaceName: this.historyProvider.getWorkspaceName() || 'No project'
		};
	}

	getHistory(): { role: string; content: string }[] {
		return this.sessionProvider.getHistory();
	}

	getRawHistoryReference(): { role: string; content: string; isInternalState?: boolean; renderPayload?: string }[] {
		return this.sessionProvider.getRawHistoryReference();
	}

	getTranscriptHistory(): ICleanSlateTranscriptMessage[] {
		return this.sessionProvider.getTranscriptHistory();
	}

	recordTranscriptMessage(message: Omit<ICleanSlateTranscriptMessage, 'id'> & { id?: string }): string | undefined {
		return this.sessionProvider.recordTranscriptMessage(message);
	}

	updateTranscriptMessage(id: string | undefined, update: Partial<Omit<ICleanSlateTranscriptMessage, 'id' | 'role'>>): void {
		this.sessionProvider.updateTranscriptMessage(id, update);
	}

	getLastAssistantTurn(): string | undefined {
		return this.sessionProvider.getLastAssistantTurn();
	}

	getRunSummary(): ICleanSlateRunSummary {
		return this.sessionProvider.getRunSummary();
	}

	getPhase(): string {
		return this.sessionProvider.getPhase();
	}

	getIsGenerating(): boolean {
		return this.sessionProvider.getIsGenerating();
	}

	isSessionRunning(sessionId: string | undefined): boolean {
		return this.sessionProvider.isSessionRunning(sessionId);
	}

	canApprovePlan(): boolean {
		return this.sessionProvider.canApprovePlan();
	}

	getPendingImages(): readonly string[] {
		return this.composerProvider.getPendingImages();
	}

	removePendingImage(index: number): void {
		this.composerProvider.removePendingImage(index);
	}

	clearPendingImages(): void {
		this.composerProvider.clearPendingImages();
	}

	addPendingImage(imageDataUrl: string): void {
		this.composerProvider.addPendingImage(imageDataUrl);
	}

	getPendingSelectionReferences(): readonly ICleanSlateEditorSelectionReference[] {
		return this.composerProvider.getPendingSelectionReferences();
	}

	addPendingSelectionReference(reference: ICleanSlateEditorSelectionReference): void {
		this.composerProvider.addPendingSelectionReference(reference);
	}

	removePendingSelectionReference(index: number): void {
		this.composerProvider.removePendingSelectionReference(index);
	}

	clearPendingSelectionReferences(): void {
		this.composerProvider.clearPendingSelectionReferences();
	}

	getPendingEditsInfo(): { uri: URI; added: number; deleted: number }[] {
		return this.sessionProvider.getPendingEditsInfo();
	}

	getPendingEditsDiffs(): { uri: URI; added: number; deleted: number; diff: string; beforeContent: string; afterContent: string }[] {
		return this.sessionProvider.getPendingEditsDiffs();
	}

	abortGeneration(renderer: IResponseRenderer): void {
		this.sessionProvider.abortGeneration(renderer);
	}

	applyLastResponse(): void {
		this.sessionProvider.applyLastResponse();
	}

	acceptAll(): void {
		this.sessionProvider.acceptAll();
	}

	rejectAll(): void {
		this.sessionProvider.rejectAll();
	}

	approveCommand(blockId: string): void {
		this.sessionProvider.approveCommand(blockId);
	}

	approveCommandForSession(blockId: string): void {
		this.sessionProvider.approveCommandForSession(blockId);
	}

	rejectCommand(blockId: string): void {
		this.sessionProvider.rejectCommand(blockId);
	}

	hasPendingCommandApproval(): boolean {
		return this.sessionProvider.hasPendingCommandApproval();
	}

	getPendingCommandApproval(): ICleanSlateCommandApprovalRequest | undefined {
		return this.sessionProvider.getPendingCommandApproval();
	}

	resolvePendingCommandApprovalFromChat(text: string, renderer?: IResponseRenderer): boolean {
		return this.sessionProvider.resolvePendingCommandApprovalFromChat(text, renderer);
	}

	sendMessage(
		text: string,
		renderer: IResponseRenderer,
		onGeneratingChange?: (isGenerating: boolean) => void,
		images?: string[]
	): Promise<void> {
		this.sessionProvider.setExecutionState(this.getPlanMode(), this.getReasoningLevel());
		return this.sessionProvider.sendMessage(text, renderer, onGeneratingChange, images);
	}

	approvePlan(
		renderer: IResponseRenderer,
		planStepsContext: string = '',
		onGeneratingChange?: (isGenerating: boolean) => void
	): Promise<void> {
		this.sessionProvider.setExecutionState(this.getPlanMode(), this.getReasoningLevel());
		return this.sessionProvider.approvePlan(renderer, planStepsContext, onGeneratingChange);
	}

	private getPlanMode(): boolean {
		return this.settingsProvider.getState().planMode;
	}

	private getReasoningLevel(): CleanSlateReasoningLevel {
		return this.settingsProvider.getState().reasoningLevel;
	}
}
