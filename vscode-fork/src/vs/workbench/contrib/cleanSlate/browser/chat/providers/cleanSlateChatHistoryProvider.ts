/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../../base/common/event.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import type { ICleanSlateMainService, ICleanSlatePersistedSession } from '../../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import {
    deriveCleanSlateTranscriptFromHistory,
    ICleanSlateSessionSnapshot,
    isCleanSlateSessionState,
    normalizeCleanSlateSessionExecutionState,
    normalizeCleanSlateTranscriptOrder
} from '../types/cleanSlateChatSessionTypes.js';
import {
    isCleanSlateSessionDeletedByGlobalCutoff,
    isCleanSlateSessionDeletedByProjectCutoff,
    loadCleanSlateDeletedBefore,
    loadCleanSlateDeletedProjectCutoffs,
    loadCleanSlateDeletedSessionIds,
    rememberCleanSlateDeletedSessionId
} from './cleanSlateChatDeletionStore.js';
import { CleanSlateChatSessionProvider } from './cleanSlateChatSessionProvider.js';

const CLEANSLATE_HISTORY_STORAGE_KEY = 'cleanSlate.chat.archivedSessions';

export class CleanSlateChatHistoryProvider {
    private archivedSessions: ICleanSlateSessionSnapshot[] = [];
    private readonly deletedSessionIds: Set<string>;
    private readonly deletedProjectCutoffs: Map<string, number>;
    private readonly deletedBefore: number;
    private isRestoringSession = false;
    private persistenceQueue: Promise<void> = Promise.resolve();
    private readonly readyPromise: Promise<void>;
    private readonly _onDidChangeState = new Emitter<void>();
    readonly onDidChangeState: Event<void> = this._onDidChangeState.event;

    constructor(
        private readonly storageService: IStorageService,
        private readonly workspaceContextService: IWorkspaceContextService,
        private readonly cleanSlateMainService: ICleanSlateMainService
    ) {
        this.deletedSessionIds = loadCleanSlateDeletedSessionIds(this.storageService);
        this.deletedProjectCutoffs = loadCleanSlateDeletedProjectCutoffs(this.storageService);
        this.deletedBefore = loadCleanSlateDeletedBefore(this.storageService);
        this.archivedSessions = this.loadArchivedSessions().filter(session => !this.isDeletedSession(session));
        this.persistArchivedSessions();
        this.readyPromise = this.initializePersistentArchivedSessions();
    }

    whenReady(): Promise<void> {
        return this.readyPromise;
    }

    getArchivedSessions(): readonly ICleanSlateSessionSnapshot[] {
        return this.getCurrentWorkspaceSessions(this.archivedSessions);
    }

    getSessionIndex(activeSession: ICleanSlateSessionSnapshot | undefined): readonly ICleanSlateSessionSnapshot[] {
        const active = this.cloneSnapshot(activeSession);
        const byId = new Map<string, ICleanSlateSessionSnapshot>();
        const orderedIds: string[] = [];

        const insert = (session: ICleanSlateSessionSnapshot | undefined): void => {
            const cloned = this.cloneSnapshot(session);
            if (!cloned || this.isDeletedSession(cloned) || !this.hasVisibleSessionContent(cloned)) {
                return;
            }
            const existing = byId.get(cloned.id);
            if (!existing) {
                byId.set(cloned.id, cloned);
                orderedIds.push(cloned.id);
                return;
            }
            if (active && cloned.id === active.id) {
                return;
            }
            byId.set(cloned.id, this.chooseRicherSession(existing, cloned));
        };

        insert(active);
        for (const session of this.getCurrentWorkspaceSessions(this.archivedSessions)) {
            insert(session);
        }

        return orderedIds
            .map(id => byId.get(id))
            .filter((session): session is ICleanSlateSessionSnapshot => !!session);
    }

    hasArchivedSessions(): boolean {
        return this.getCurrentWorkspaceSessions(this.archivedSessions).length > 0;
    }

    getIsRestoringSession(): boolean {
        return this.isRestoringSession;
    }

    setRestoringSession(isRestoringSession: boolean): void {
        this.isRestoringSession = isRestoringSession;
        this._onDidChangeState.fire();
    }

    getCurrentSessionSnapshot(sessionProvider: CleanSlateChatSessionProvider): ICleanSlateSessionSnapshot {
        return sessionProvider.buildCurrentSessionSnapshot(this.getWorkspaceName());
    }

    archiveCurrentSession(sessionProvider: CleanSlateChatSessionProvider): void {
        this.upsertArchivedSession(this.getCurrentSessionSnapshot(sessionProvider));
    }

    upsertArchivedSession(snapshot: ICleanSlateSessionSnapshot | undefined): void {
        snapshot = this.cloneSnapshot(snapshot);
        if (!snapshot || !this.hasVisibleSessionContent(snapshot)) {
            return;
        }
        if (this.isDeletedSession(snapshot)) {
            return;
        }

        const existingIndex = this.archivedSessions.findIndex(session => session.id === snapshot.id);
        if (existingIndex !== -1) {
            const existing = this.archivedSessions.splice(existingIndex, 1)[0];
            const now = Date.now();
            const updatedSnapshot = {
                ...snapshot,
                id: existing.id,
                createdAt: existing.createdAt ?? snapshot.createdAt ?? snapshot.savedAt,
                savedAt: now,
                updatedAt: now,
                sessionKey: snapshot.sessionKey ?? existing.sessionKey ?? existing.id
            };
            this.archivedSessions.unshift(updatedSnapshot);
            this.persistArchivedSessions();
            this.queueArchiveSession(updatedSnapshot);
            this._onDidChangeState.fire();
            return;
        }

        this.archivedSessions.unshift(snapshot);
        if (this.archivedSessions.length > 50) {
            this.archivedSessions.length = 50;
        }

        this.persistArchivedSessions();
        this.queueArchiveSession(snapshot);
        this._onDidChangeState.fire();
    }

    removeArchivedSession(sessionId: string): void {
        rememberCleanSlateDeletedSessionId(this.storageService, this.deletedSessionIds, sessionId);
        this.archivedSessions = this.archivedSessions.filter(session => session.id !== sessionId);
        this.persistArchivedSessions();
        this.persistenceQueue = this.persistenceQueue
            .catch(() => undefined)
            .then(() => this.cleanSlateMainService.removeThreadSession(sessionId))
            .catch(error => console.warn('[CleanSlate] Failed to remove persisted archived session:', error));
        this._onDidChangeState.fire();
    }

    getWorkspaceName(): string | undefined {
        return this.workspaceContextService.getWorkspace().folders[0]?.name;
    }

    private getWorkspaceId(): string {
        const workspace = this.workspaceContextService.getWorkspace();
        return workspace.folders[0]?.uri.toString() || workspace.id || this.getWorkspaceName() || 'default';
    }

    private getCurrentWorkspaceSessions(sessions: readonly ICleanSlateSessionSnapshot[]): ICleanSlateSessionSnapshot[] {
        return sessions.filter(session => this.isSessionInCurrentWorkspace(session));
    }

    private isSessionInCurrentWorkspace(session: ICleanSlateSessionSnapshot): boolean {
        const workspace = this.workspaceContextService.getWorkspace();
        const folder = workspace.folders[0];
        if (!folder) {
            return this.isNoProjectSession(session);
        }

        const sessionPaths = this.dedupeProjectValues([
            ...this.expandResourceProjectValue(session.projectRoot),
            ...this.expandResourceProjectValue(session.workDir)
        ]);
        const currentPaths = this.dedupeProjectValues([
            ...this.expandResourceProjectValue(folder.uri.toString()),
            ...this.expandResourceProjectValue(folder.uri.fsPath)
        ]);
        if (sessionPaths.length > 0) {
            return this.intersects(sessionPaths, currentPaths);
        }

        const sessionNames = this.dedupeProjectValues([...this.expandProjectValue(session.workspaceName)]);
        const currentNames = this.dedupeProjectValues([...this.expandProjectValue(folder.name)]);
        const sessionIds = this.dedupeProjectValues([...this.expandProjectValue(session.workspaceId)]);
        const currentIds = this.dedupeProjectValues([
            ...this.expandProjectValue(folder.uri.toString()),
            ...this.expandProjectValue(folder.uri.fsPath),
            ...this.expandProjectValue(workspace.id),
            ...currentNames
        ]);

        if (sessionIds.length > 0) {
            if (!this.intersects(sessionIds, currentIds)) {
                return false;
            }
            return sessionNames.length === 0 || currentNames.length === 0 || this.intersects(sessionNames, currentNames);
        }

        if (sessionNames.length > 0) {
            return this.intersects(sessionNames, currentNames);
        }

        // Legacy workspace-scoped storage entries had no workspace metadata. Keep them visible
        // for the active workspace, but do not let explicitly tagged foreign sessions through.
        return true;
    }

    private isNoProjectSession(session: ICleanSlateSessionSnapshot): boolean {
        const workspaceId = session.workspaceId?.trim().toLowerCase();
        const workspaceName = session.workspaceName?.trim().toLowerCase();
        return workspaceId === 'no-project'
            || workspaceName === 'no project'
            || (!session.projectRoot?.trim() && !session.workDir?.trim() && !workspaceId && !workspaceName);
    }

    private isDeletedSession(session: ICleanSlateSessionSnapshot): boolean {
        const sessionTime = session.updatedAt ?? session.savedAt ?? session.createdAt;
        return this.deletedSessionIds.has(session.id)
            || isCleanSlateSessionDeletedByGlobalCutoff(this.deletedBefore, sessionTime)
            || isCleanSlateSessionDeletedByProjectCutoff(this.deletedProjectCutoffs, this.getSessionProjectValues(session), sessionTime);
    }

    private getSessionProjectValues(session: ICleanSlateSessionSnapshot): string[] {
        return [
            session.projectRoot,
            session.workDir,
            session.workspaceId,
            session.workspaceName
        ].filter((value): value is string => !!value?.trim());
    }

    private intersects(left: readonly string[], right: readonly string[]): boolean {
        return left.some(value => right.includes(value));
    }

    private expandResourceProjectValue(value: string | undefined): string[] {
        if (!this.isResourceProjectValue(value)) {
            return [];
        }
        return this.expandProjectValue(value);
    }

    private isResourceProjectValue(value: string | undefined): boolean {
        const trimmed = value?.trim();
        if (!trimmed) {
            return false;
        }
        try {
            if (URI.parse(trimmed).scheme) {
                return true;
            }
        } catch {
            // Fall through to path checks.
        }
        return /[\\/]/.test(trimmed);
    }

    private expandProjectValue(value: string | undefined): string[] {
        const trimmed = value?.trim();
        if (!trimmed) {
            return [];
        }
        const values = [trimmed.toLowerCase()];
        try {
            const uri = URI.parse(trimmed);
            if (uri.scheme) {
                values.push(...this.expandPathValue(uri.fsPath || uri.path));
            }
        } catch {
            // Fall through to local path expansion.
        }
        values.push(...this.expandPathValue(trimmed));
        return this.dedupeProjectValues(values);
    }

    private expandPathValue(value: string | undefined): string[] {
        const trimmed = value?.trim();
        if (!trimmed) {
            return [];
        }
        const values = [trimmed.toLowerCase()];
        const path = trimmed.replace(/[/\\]+$/, '');
        const name = path.split(/[\\/]/).filter(Boolean).at(-1)?.trim().toLowerCase();
        if (name) {
            values.push(name);
        }
        return values;
    }

    private dedupeProjectValues(values: readonly (string | undefined)[]): string[] {
        return [...new Set(values.filter((value): value is string => !!value))];
    }

    private hasVisibleSessionContent(snapshot: ICleanSlateSessionSnapshot): boolean {
        const hasHistoryContent = snapshot.history.some(message =>
            !message.isInternalState
            && typeof message.content === 'string'
            && message.content.trim().length > 0
        );
        if (hasHistoryContent) {
            return true;
        }

        return (snapshot.transcript ?? []).some(message =>
            !message.isInternalState
            && (typeof message.content === 'string' && message.content.trim().length > 0
                || typeof message.renderPayload === 'string' && message.renderPayload.trim().length > 0
                || Array.isArray(message.images) && message.images.length > 0)
        );
    }

    private loadArchivedSessions(): ICleanSlateSessionSnapshot[] {
        const raw = this.storageService.get(CLEANSLATE_HISTORY_STORAGE_KEY, StorageScope.WORKSPACE);
        if (!raw) {
            return [];
        }

        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                return [];
            }

            return parsed
                .map((session: unknown) => this.cloneSnapshot(session as ICleanSlateSessionSnapshot, false))
                .filter((session): session is ICleanSlateSessionSnapshot => !!session)
                .slice(0, 50);
        } catch {
            return [];
        }
    }

    private persistArchivedSessions(): void {
        this.storageService.store(
            CLEANSLATE_HISTORY_STORAGE_KEY,
            JSON.stringify(this.archivedSessions),
            StorageScope.WORKSPACE,
            StorageTarget.MACHINE
        );
    }

    private cloneSnapshot(snapshot: ICleanSlateSessionSnapshot | undefined, preserveVolatileState = true): ICleanSlateSessionSnapshot | undefined {
        if (!snapshot
            || typeof snapshot.id !== 'string'
            || typeof snapshot.title !== 'string'
            || typeof snapshot.savedAt !== 'number'
            || !Array.isArray(snapshot.history)
        ) {
            return undefined;
        }

        const executionState = normalizeCleanSlateSessionExecutionState(snapshot);
        const status = this.getSnapshotStatus(snapshot.status, preserveVolatileState);
        const isGenerating = preserveVolatileState && status === 'running' && snapshot.isGenerating === true;
        try {
            return JSON.parse(JSON.stringify({
                id: snapshot.id,
                parentSessionId: snapshot.parentSessionId,
                createdAt: typeof snapshot.createdAt === 'number' ? snapshot.createdAt : snapshot.savedAt,
                title: snapshot.title,
                savedAt: snapshot.savedAt,
                updatedAt: typeof snapshot.updatedAt === 'number' ? snapshot.updatedAt : snapshot.savedAt,
                workspaceId: this.getSnapshotWorkspaceId(snapshot),
                projectRoot: snapshot.projectRoot,
                workDir: snapshot.workDir,
                status,
                sessionKey: snapshot.sessionKey ?? snapshot.id,
                history: snapshot.history,
                transcript: normalizeCleanSlateTranscriptOrder(snapshot.transcript?.length
                    ? snapshot.transcript
                    : deriveCleanSlateTranscriptFromHistory(snapshot.history)),
                transcriptVersion: snapshot.transcriptVersion ?? 1,
                taskState: snapshot.taskState,
                threadState: snapshot.threadState,
                planMode: executionState.planMode,
                reasoningLevel: executionState.reasoningLevel,
                agent: snapshot.agent,
                workspaceName: snapshot.workspaceName,
                isGenerating: isGenerating ? true : undefined
            })) as ICleanSlateSessionSnapshot;
        } catch {
            return {
                id: snapshot.id,
                parentSessionId: snapshot.parentSessionId,
                createdAt: typeof snapshot.createdAt === 'number' ? snapshot.createdAt : snapshot.savedAt,
                title: snapshot.title,
                savedAt: snapshot.savedAt,
                updatedAt: typeof snapshot.updatedAt === 'number' ? snapshot.updatedAt : snapshot.savedAt,
                workspaceId: this.getSnapshotWorkspaceId(snapshot),
                projectRoot: snapshot.projectRoot,
                workDir: snapshot.workDir,
                status,
                sessionKey: snapshot.sessionKey ?? snapshot.id,
                history: [...snapshot.history],
                transcript: normalizeCleanSlateTranscriptOrder(snapshot.transcript?.length
                    ? snapshot.transcript
                    : deriveCleanSlateTranscriptFromHistory(snapshot.history)),
                transcriptVersion: snapshot.transcriptVersion ?? 1,
                taskState: snapshot.taskState,
                threadState: snapshot.threadState,
                planMode: executionState.planMode,
                reasoningLevel: executionState.reasoningLevel,
                agent: snapshot.agent,
                workspaceName: snapshot.workspaceName,
                isGenerating: isGenerating ? true : undefined
            };
        }
    }

    private getSnapshotStatus(status: ICleanSlateSessionSnapshot['status'], preserveVolatileState: boolean): ICleanSlateSessionSnapshot['status'] {
        if (!isCleanSlateSessionState(status)) {
            return undefined;
        }
        if (!preserveVolatileState && (status === 'running' || status === 'starting' || status === 'stopping')) {
            return 'detached';
        }
        return status;
    }

    private async initializePersistentArchivedSessions(): Promise<void> {
        try {
            const persisted = await this.cleanSlateMainService.listArchivedThreadSessions(this.getWorkspaceId());
            const dbSessions = persisted
                .map(session => this.fromPersistedSession(session))
                .filter((session): session is ICleanSlateSessionSnapshot => !!session && !this.isDeletedSession(session));

            const mergedSessions = this.mergeArchivedSessions(this.archivedSessions, dbSessions);
            if (mergedSessions.length > 0) {
                this.archivedSessions = mergedSessions.slice(0, 50);
                this.persistArchivedSessions();
                this._onDidChangeState.fire();
            }

            for (const session of this.archivedSessions) {
                if (!this.isDeletedSession(session)) {
                    this.queueArchiveSession(session);
                }
            }
        } catch (error) {
            console.warn('[CleanSlate] Failed to initialize persisted archived sessions:', error);
        }
    }

    private mergeArchivedSessions(
        localSessions: readonly ICleanSlateSessionSnapshot[],
        dbSessions: readonly ICleanSlateSessionSnapshot[]
    ): ICleanSlateSessionSnapshot[] {
        const byId = new Map<string, ICleanSlateSessionSnapshot>();
        for (const session of [...localSessions, ...dbSessions]) {
            const cloned = this.cloneSnapshot(session);
            if (!cloned || this.isDeletedSession(cloned)) {
                continue;
            }

            const existing = byId.get(cloned.id);
            byId.set(cloned.id, existing ? this.chooseRicherSession(existing, cloned) : cloned);
        }

        return [...byId.values()]
            .sort((a, b) => (b.updatedAt ?? b.savedAt) - (a.updatedAt ?? a.savedAt))
            .slice(0, 50);
    }

    private chooseRicherSession(left: ICleanSlateSessionSnapshot, right: ICleanSlateSessionSnapshot): ICleanSlateSessionSnapshot {
        const leftScore = this.getSessionRichnessScore(left);
        const rightScore = this.getSessionRichnessScore(right);
        if (rightScore !== leftScore) {
            return rightScore > leftScore ? right : left;
        }
        return right.savedAt >= left.savedAt ? right : left;
    }

    private getSessionRichnessScore(session: ICleanSlateSessionSnapshot): number {
        const transcript = session.transcript?.length
            ? session.transcript
            : deriveCleanSlateTranscriptFromHistory(session.history);
        const renderPayloadCount = transcript.filter(message => typeof message.renderPayload === 'string' && message.renderPayload.trim().length > 0).length;
        const elidedCount = transcript.filter(message => message.content.includes('[Tool output elided') || message.content.includes('Elided to save space')).length;
        return transcript.length * 10 + renderPayloadCount * 25 - elidedCount * 20;
    }

    private queueArchiveSession(snapshot: ICleanSlateSessionSnapshot): void {
        if (this.isDeletedSession(snapshot)) {
            return;
        }
        const persisted = this.toPersistedSession(snapshot);
        const workspaceId = this.getSnapshotWorkspaceId(snapshot);
        this.persistenceQueue = this.persistenceQueue
            .catch(() => undefined)
            .then(() => this.cleanSlateMainService.archiveThreadSession(workspaceId, persisted))
            .catch(error => console.warn('[CleanSlate] Failed to persist archived session:', error));
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
            status: this.getSnapshotStatus(snapshot.status, false),
            sessionKey: snapshot.sessionKey,
            workspaceName: snapshot.workspaceName,
            planMode: executionState.planMode,
            reasoningLevel: executionState.reasoningLevel,
            history: snapshot.history.map(message => ({
                role: message.role,
                content: message.content,
                isInternalState: message.isInternalState,
                renderPayload: message.renderPayload,
                images: message.images
            })),
            transcript: normalizeCleanSlateTranscriptOrder(snapshot.transcript?.length
                ? snapshot.transcript
                : deriveCleanSlateTranscriptFromHistory(snapshot.history)).map(message => ({
                    id: message.id,
                    role: message.role,
                    content: message.content,
                    isInternalState: message.isInternalState,
                    renderPayload: message.renderPayload,
                    images: message.images
                })),
            transcriptVersion: snapshot.transcriptVersion ?? 1,
            taskState: snapshot.taskState,
            threadState: snapshot.threadState,
            agent: snapshot.agent
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
        return this.cloneSnapshot({
            id: session.id,
            parentSessionId: session.parentSessionId,
            createdAt: session.createdAt,
            title: session.title,
            savedAt: session.updatedAt ?? session.savedAt,
            updatedAt: session.updatedAt ?? session.savedAt,
            workspaceId: session.workspaceId,
            projectRoot: session.projectRoot,
            workDir: session.workDir,
            status: isCleanSlateSessionState(session.status) ? session.status : undefined,
            sessionKey: session.sessionKey,
            history: session.history.map(message => ({
                role: message.role,
                content: message.content,
                isInternalState: message.isInternalState,
                renderPayload: message.renderPayload,
                images: message.images
            })),
            transcript: Array.isArray(session.transcript)
                ? normalizeCleanSlateTranscriptOrder(session.transcript)
                : deriveCleanSlateTranscriptFromHistory(session.history),
            transcriptVersion: session.transcriptVersion,
            taskState: session.taskState as ICleanSlateSessionSnapshot['taskState'],
            threadState: session.threadState as ICleanSlateSessionSnapshot['threadState'],
            planMode: executionState.planMode,
            reasoningLevel: executionState.reasoningLevel,
            agent: session.agent as ICleanSlateSessionSnapshot['agent'],
            workspaceName: session.workspaceName
        });
    }
}
