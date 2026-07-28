/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AgentPhase } from '../agent/cleanSlatePrompts.js';
import { CleanSlateTaskKind, CleanSlateTaskLifecycleStatus, CleanSlateTurnIntent, CleanSlateWorkspaceShape } from './cleanSlateTaskState.js';
import { CleanSlateVerificationTargetTracker } from './cleanSlateVerificationTargetTracker.js';
import { CleanSlateTaskEvidenceCodec } from './cleanSlateTaskEvidenceCodec.js';

export interface ICleanSlateRunCheckpoint {
    id: string;
    timestamp: number;
    kind: 'lifecycle' | 'phase' | 'progress' | 'tool' | 'error' | 'resume';
    phase: AgentPhase;
    status: CleanSlateTaskLifecycleStatus;
    summary: string;
    toolName?: string;
    currentWorkItem?: string;
}

export interface ICleanSlateTaskFileChange {
    path: string;
    added?: number;
    deleted?: number;
}

export interface ICleanSlatePendingRecoveryState {
    prompt: string;
    updatedAt: number;
    toolName?: string;
    code?: string;
}

export type CleanSlateVerificationTargetStatus = 'pending' | 'verified' | 'stale';

export interface ICleanSlateVerificationTarget {
    id: string;
    kind: 'browser';
    scope: 'shared-ui' | 'route';
    description: string;
    sourcePaths: string[];
    routeHints: string[];
    requiresRootTraversal: boolean;
    status: CleanSlateVerificationTargetStatus;
    updatedAt: number;
    lastVerifiedAt?: number;
    lastVerifiedUrl?: string;
}

export type CleanSlateEvidencePhase = AgentPhase | 'CHAT';

export type CleanSlateEvidenceKind =
    | 'assistant_turn_start'
    | 'assistant_turn_complete'
    | 'tool_start'
    | 'tool_result'
    | 'read'
    | 'mutation'
    | 'command'
    | 'browser'
    | 'artifact'
    | 'diagnostic'
    | 'completion'
    | 'error';

export interface ICleanSlateEvidenceLedgerEntry {
    id: string;
    timestamp: number;
    kind: CleanSlateEvidenceKind;
    phase: CleanSlateEvidencePhase;
    status: CleanSlateTaskLifecycleStatus;
    taskId?: string;
    runId?: string;
    toolName?: string;
    toolCallId?: string;
    success?: boolean;
    summary?: string;
    error?: string;
    code?: string;
    input?: unknown;
    result?: unknown;
    paths?: string[];
    filesChanged?: ICleanSlateTaskFileChange[];
    command?: string;
    cwd?: string;
    processId?: string;
    pid?: number;
    exitCode?: number;
    durationMs?: number;
    url?: string;
    screenshotCount?: number;
    browserPageCount?: number;
    turnId?: string;
    turnIndex?: number;
}

export interface ICleanSlateTaskSessionSnapshot {
    taskId?: string;
    runId?: string;
    startedAt?: number;
    phase: AgentPhase;
    status: CleanSlateTaskLifecycleStatus;
    awaitingApproval: boolean;
    taskKind: CleanSlateTaskKind;
    workspaceShape: CleanSlateWorkspaceShape;
    lastCheckpointAt: number;
    objective?: string;
    toDo?: string[];
    discoveredPaths?: string[];
    semanticHighlights?: string[];
    executionFilesChanged?: ICleanSlateTaskFileChange[];
    currentWorkItem?: string;
    lastSummary?: string;
    lastError?: string;
    lastToolName?: string;
    resumeCount?: number;
    checkpoints?: ICleanSlateRunCheckpoint[];
    lastUserTurn?: string;
    lastAssistantTurn?: string;
    lastIntent?: CleanSlateTurnIntent;
    runLedger?: ICleanSlateRunLedgerEntry[];
    evidenceLedger?: ICleanSlateEvidenceLedgerEntry[];
    pendingRecovery?: ICleanSlatePendingRecoveryState;
    verificationTargets?: ICleanSlateVerificationTarget[];
}

export interface ICleanSlateRunSummary {
    taskId?: string;
    runId?: string;
    startedAt: number;
    phase: AgentPhase;
    status: CleanSlateTaskLifecycleStatus;
    objective?: string;
    currentWorkItem?: string;
    toDo: string[];
    discoveredPaths?: string[];
    semanticHighlights?: string[];
    lastSummary?: string;
    lastError?: string;
    lastToolName?: string;
    awaitingApproval: boolean;
    resumeCount: number;
    lastCheckpointAt: number;
    hasPendingRecovery: boolean;
    hasPendingVerification: boolean;
    pendingVerificationTargetCount: number;
    pendingRecovery?: ICleanSlatePendingRecoveryState;
    verificationTargets?: ICleanSlateVerificationTarget[];
}

export interface ICleanSlateRunLedgerEntry extends ICleanSlateRunSummary {
    taskKind: CleanSlateTaskKind;
    workspaceShape: CleanSlateWorkspaceShape;
    archivedAt: number;
}

export class CleanSlateTaskSessionService {
    private static readonly MAX_CHECKPOINTS = 25;
    private static readonly MAX_RUN_LEDGER_ENTRIES = 30;
    private static readonly MAX_DISCOVERED_PATHS = 300;
    private static readonly MAX_SEEDED_DISCOVERED_PATHS = 120;
    private static readonly MAX_SEMANTIC_HIGHLIGHTS = 120;
    private static readonly MAX_SEEDED_SEMANTIC_HIGHLIGHTS = 60;
    private static readonly MAX_EVIDENCE_LEDGER_ENTRIES = 200;
    private readonly verificationTargetTracker = new CleanSlateVerificationTargetTracker();
    private readonly evidenceCodec = new CleanSlateTaskEvidenceCodec();
    private taskId: string | undefined;
    private runId: string | undefined;
    private startedAt = 0;
    private currentPhase: AgentPhase = AgentPhase.PLANNING;
    private currentStatus: CleanSlateTaskLifecycleStatus = CleanSlateTaskLifecycleStatus.IDLE;
    private awaitingApproval = false;
    private currentTaskKind: CleanSlateTaskKind = CleanSlateTaskKind.UNKNOWN;
    private currentWorkspaceShape: CleanSlateWorkspaceShape = CleanSlateWorkspaceShape.UNKNOWN;
    private lastCheckpointAt = 0;
    private objective: string | undefined;
    private toDo: string[] = [];
    private discoveredPaths: string[] = [];
    private semanticHighlights: string[] = [];
    private executionFilesChanged: ICleanSlateTaskFileChange[] = [];
    private currentWorkItem: string | undefined;
    private lastSummary: string | undefined;
    private lastError: string | undefined;
    private lastToolName: string | undefined;
    private resumeCount = 0;
    private checkpoints: ICleanSlateRunCheckpoint[] = [];
    private lastUserTurn: string | undefined;
    private lastAssistantTurn: string | undefined;
    private lastIntent: CleanSlateTurnIntent | undefined;
    private runLedger: ICleanSlateRunLedgerEntry[] = [];
    private evidenceLedger: ICleanSlateEvidenceLedgerEntry[] = [];
    private pendingRecovery: ICleanSlatePendingRecoveryState | undefined;
    private verificationTargets: ICleanSlateVerificationTarget[] = [];

    reset(): void {
        this.taskId = undefined;
        this.runId = undefined;
        this.startedAt = 0;
        this.currentPhase = AgentPhase.PLANNING;
        this.currentStatus = CleanSlateTaskLifecycleStatus.IDLE;
        this.awaitingApproval = false;
        this.currentTaskKind = CleanSlateTaskKind.UNKNOWN;
        this.currentWorkspaceShape = CleanSlateWorkspaceShape.UNKNOWN;
        this.lastCheckpointAt = 0;
        this.objective = undefined;
        this.toDo = [];
        this.discoveredPaths = [];
        this.semanticHighlights = [];
        this.executionFilesChanged = [];
        this.currentWorkItem = undefined;
        this.lastSummary = undefined;
        this.lastError = undefined;
        this.lastToolName = undefined;
        this.resumeCount = 0;
        this.checkpoints = [];
        this.lastUserTurn = undefined;
        this.lastAssistantTurn = undefined;
        this.lastIntent = undefined;
        this.runLedger = [];
        this.evidenceLedger = [];
        this.pendingRecovery = undefined;
        this.verificationTargets = [];
    }

    startNewTask(
        taskKind: CleanSlateTaskKind,
        workspaceShape: CleanSlateWorkspaceShape,
		initialUserTurn?: string
    ): void {
        this.archiveCurrentRunIfNeeded(this.getArchiveStatusForTaskSwitch());
        const seededDiscoveredPaths = workspaceShape === CleanSlateWorkspaceShape.EXISTING
            ? this.collectRecentDiscoveredPathsForNewTask()
            : [];
        const seededSemanticHighlights = workspaceShape === CleanSlateWorkspaceShape.EXISTING
            ? this.collectRecentSemanticHighlightsForNewTask()
            : [];
        this.taskId = this.generateTaskId();
        this.runId = this.generateRunId();
        this.startedAt = Date.now();
        this.currentPhase = AgentPhase.PLANNING;
        this.awaitingApproval = false;
        this.currentTaskKind = taskKind;
        this.currentWorkspaceShape = workspaceShape;
        this.currentStatus = taskKind === CleanSlateTaskKind.CHAT
            ? CleanSlateTaskLifecycleStatus.CHAT
            : CleanSlateTaskLifecycleStatus.PLANNING;
        this.objective = initialUserTurn?.trim() || this.objective;
        this.lastUserTurn = initialUserTurn?.trim() || this.lastUserTurn;
        this.lastAssistantTurn = undefined;
        this.toDo = [];
        this.discoveredPaths = seededDiscoveredPaths;
        this.semanticHighlights = seededSemanticHighlights;
        this.executionFilesChanged = [];
        this.currentWorkItem = undefined;
        this.lastSummary = undefined;
        this.lastError = undefined;
        this.lastToolName = undefined;
        this.resumeCount = 0;
        this.checkpoints = [];
        this.lastIntent = undefined;
        this.evidenceLedger = [];
        this.pendingRecovery = undefined;
        this.verificationTargets = [];
        this.checkpoint('lifecycle', this.objective ? `Started new task: ${this.objective}` : 'Started new task');
    }

    getTaskId(): string | undefined {
        return this.taskId;
    }

    getRunId(): string | undefined {
        return this.runId;
    }

    getPhase(): AgentPhase {
        return this.currentPhase;
    }

    setPhase(phase: AgentPhase): void {
        const previousPhase = this.currentPhase;
        this.currentPhase = phase;
        if (this.awaitingApproval) {
            this.currentStatus = CleanSlateTaskLifecycleStatus.AWAITING_APPROVAL;
        } else if (!this.isTerminalStatus(this.currentStatus) && this.currentStatus !== CleanSlateTaskLifecycleStatus.INTERRUPTED) {
            this.currentStatus = this.phaseToStatus(phase);
        }
        if (previousPhase !== phase) {
            this.checkpoint('phase', `Transitioned from ${previousPhase} to ${phase}`);
        } else {
            this.checkpoint();
        }
    }

    getStatus(): CleanSlateTaskLifecycleStatus {
        return this.currentStatus;
    }

    markAwaitingApproval(): void {
        this.currentPhase = AgentPhase.PLANNING;
        this.awaitingApproval = true;
        this.currentStatus = CleanSlateTaskLifecycleStatus.AWAITING_APPROVAL;
        this.checkpoint('lifecycle', 'Plan drafted and awaiting approval');
    }

    approvePlan(): void {
        this.awaitingApproval = false;
        this.currentPhase = AgentPhase.EXECUTION;
        this.currentStatus = CleanSlateTaskLifecycleStatus.EXECUTING;
        this.checkpoint('lifecycle', 'Plan approved');
    }

    resumeCurrentTask(): void {
        if (this.awaitingApproval) {
            this.currentStatus = CleanSlateTaskLifecycleStatus.AWAITING_APPROVAL;
        } else if (this.currentStatus === CleanSlateTaskLifecycleStatus.INTERRUPTED || this.currentStatus === CleanSlateTaskLifecycleStatus.IDLE) {
            this.currentStatus = this.phaseToStatus(this.currentPhase);
        }
        this.resumeCount += 1;
        this.checkpoint('resume', `Resumed task in ${this.currentPhase}`);
    }

    markInterrupted(): void {
        if (this.awaitingApproval || this.isTerminalStatus(this.currentStatus) || this.currentTaskKind === CleanSlateTaskKind.CHAT) {
            return;
        }
        this.currentStatus = CleanSlateTaskLifecycleStatus.INTERRUPTED;
        this.checkpoint('lifecycle', `Task interrupted during ${this.currentPhase}`);
    }

    markCompleted(): void {
        this.awaitingApproval = false;
        this.currentStatus = CleanSlateTaskLifecycleStatus.COMPLETED;
        this.checkpoint('lifecycle', 'Task completed');
    }

    markFailed(): void {
        this.awaitingApproval = false;
        this.currentStatus = CleanSlateTaskLifecycleStatus.FAILED;
        this.checkpoint('error', this.lastError || 'Task failed');
    }

    markCancelled(): void {
        this.awaitingApproval = false;
        this.currentStatus = CleanSlateTaskLifecycleStatus.CANCELLED;
        this.checkpoint('lifecycle', 'Task cancelled');
    }

    isAwaitingApproval(): boolean {
        return this.awaitingApproval;
    }

    setAwaitingApproval(awaiting: boolean): void {
        this.awaitingApproval = awaiting;
        if (awaiting) {
            this.currentPhase = AgentPhase.PLANNING;
            this.currentStatus = CleanSlateTaskLifecycleStatus.AWAITING_APPROVAL;
        } else if (!this.isTerminalStatus(this.currentStatus) && this.currentStatus !== CleanSlateTaskLifecycleStatus.INTERRUPTED) {
            this.currentStatus = this.phaseToStatus(this.currentPhase);
        }
        this.checkpoint('lifecycle', awaiting ? 'Awaiting approval' : `Approval cleared in ${this.currentPhase}`);
    }

    getTaskKind(): CleanSlateTaskKind {
        return this.currentTaskKind;
    }

    setTaskKind(taskKind: CleanSlateTaskKind): void {
        this.currentTaskKind = taskKind;
        if (taskKind === CleanSlateTaskKind.CHAT) {
            this.currentStatus = CleanSlateTaskLifecycleStatus.CHAT;
        }
        this.checkpoint();
    }

    getWorkspaceShape(): CleanSlateWorkspaceShape {
        return this.currentWorkspaceShape;
    }

    setWorkspaceShape(workspaceShape: CleanSlateWorkspaceShape): void {
        this.currentWorkspaceShape = workspaceShape;
        this.checkpoint();
    }

    recordUserTurn(text: string): void {
        if (text.trim().length > 0) {
            if (!this.objective || this.isTerminalStatus(this.currentStatus)) {
                this.objective = text;
            }
            this.lastUserTurn = text;
            this.checkpoint();
        }
    }

    recordAssistantTurn(text: string): void {
        if (text.trim().length > 0) {
            this.lastAssistantTurn = text;
            this.checkpoint();
        }
    }

    recordAssistantSummary(summary: string | undefined): void {
        if (typeof summary === 'string' && summary.trim().length > 0) {
            const normalized = summary.trim();
            if (this.lastSummary === normalized) {
                return;
            }
            this.lastSummary = normalized;
            this.checkpoint('progress', normalized);
        }
    }

    recordProgressSummary(summary: string | undefined): void {
        this.recordAssistantSummary(summary);
    }

    getLastUserTurn(): string | undefined {
        return this.lastUserTurn;
    }

    getLastAssistantTurn(): string | undefined {
        return this.lastAssistantTurn;
    }

    recordIntent(intent: CleanSlateTurnIntent): void {
        this.lastIntent = intent;
        this.checkpoint();
    }

    updateObjective(objective: string | undefined): void {
        if (typeof objective === 'string' && objective.trim().length > 0) {
            this.objective = objective.trim();
            this.checkpoint();
        }
    }

    getObjective(): string | undefined {
        return this.objective;
    }

    updateToDo(toDo: string[] | undefined): void {
        const normalized = Array.isArray(toDo)
            ? toDo
                .map(item => typeof item === 'string' ? item.trim() : '')
                .filter(item => item.length > 0)
            : [];

        if (this.areStringArraysEqual(this.toDo, normalized)) {
            return;
        }

        this.toDo = normalized;
        this.currentWorkItem = this.deriveCurrentWorkItem(normalized);
        this.checkpoint('progress', this.currentWorkItem ? `Updated to do: ${this.currentWorkItem}` : 'Updated to do list');
    }

    recordDiscoveredPaths(paths: string[] | undefined): void {
        if (!Array.isArray(paths) || paths.length === 0) {
            return;
        }

        let changed = false;
        for (const candidate of paths) {
            if (typeof candidate !== 'string') {
                continue;
            }
            const trimmed = candidate.trim();
            if (!trimmed) {
                continue;
            }
            const normalized = trimmed.replace(/\\/g, '/');
            const key = normalized.toLowerCase();
            const existingIndex = this.discoveredPaths.findIndex(path => path.replace(/\\/g, '/').toLowerCase() === key);
            if (existingIndex !== -1) {
                if (existingIndex !== this.discoveredPaths.length - 1) {
                    this.discoveredPaths.splice(existingIndex, 1);
                    this.discoveredPaths.push(normalized);
                    changed = true;
                }
                continue;
            }
            this.discoveredPaths.push(normalized);
            changed = true;
        }

        if (!changed) {
            return;
        }

        if (this.discoveredPaths.length > CleanSlateTaskSessionService.MAX_DISCOVERED_PATHS) {
            this.discoveredPaths.splice(0, this.discoveredPaths.length - CleanSlateTaskSessionService.MAX_DISCOVERED_PATHS);
        }
    }

    getDiscoveredPaths(): string[] {
        return [...this.discoveredPaths];
    }

    recordSemanticHighlights(highlights: string[] | undefined): void {
        if (!Array.isArray(highlights) || highlights.length === 0) {
            return;
        }

        let changed = false;
        for (const candidate of highlights) {
            if (typeof candidate !== 'string') {
                continue;
            }
            const normalized = candidate.trim();
            if (!normalized) {
                continue;
            }
            const key = normalized.toLowerCase();
            const existingIndex = this.semanticHighlights.findIndex(item => item.toLowerCase() === key);
            if (existingIndex !== -1) {
                if (existingIndex !== this.semanticHighlights.length - 1) {
                    this.semanticHighlights.splice(existingIndex, 1);
                    this.semanticHighlights.push(normalized);
                    changed = true;
                }
                continue;
            }
            this.semanticHighlights.push(normalized);
            changed = true;
        }

        if (!changed) {
            return;
        }

        if (this.semanticHighlights.length > CleanSlateTaskSessionService.MAX_SEMANTIC_HIGHLIGHTS) {
            this.semanticHighlights.splice(0, this.semanticHighlights.length - CleanSlateTaskSessionService.MAX_SEMANTIC_HIGHLIGHTS);
        }
    }

    getSemanticHighlights(): string[] {
        return [...this.semanticHighlights];
    }

    recordExecutionFilesChanged(filesChanged: ICleanSlateTaskFileChange[] | undefined): void {
        if (!Array.isArray(filesChanged)) {
            return;
        }

        const normalized: ICleanSlateTaskFileChange[] = [];
        const seen = new Set<string>();
        for (const change of filesChanged) {
            if (!change || typeof change.path !== 'string') {
                continue;
            }
            const path = change.path.trim().replace(/\\/g, '/');
            if (!path) {
                continue;
            }
            const key = path.toLowerCase();
            const existingIndex = normalized.findIndex(item => item.path.toLowerCase() === key);
            const normalizedChange: ICleanSlateTaskFileChange = {
                path,
                added: typeof change.added === 'number' ? change.added : undefined,
                deleted: typeof change.deleted === 'number' ? change.deleted : undefined
            };
            if (seen.has(key) && existingIndex !== -1) {
                normalized.splice(existingIndex, 1);
            } else {
                seen.add(key);
            }
            normalized.push(normalizedChange);
        }

        if (normalized.length === 0) {
            return;
        }

        this.executionFilesChanged = normalized;
    }

    getExecutionFilesChanged(): ICleanSlateTaskFileChange[] {
        return [...this.executionFilesChanged];
    }

    setPendingRecovery(prompt: string | undefined, metadata?: { toolName?: string; code?: string }): void {
        const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
        if (!normalizedPrompt) {
            this.clearPendingRecovery();
            return;
        }

        const nextState: ICleanSlatePendingRecoveryState = {
            prompt: normalizedPrompt,
            updatedAt: Date.now(),
            toolName: typeof metadata?.toolName === 'string' && metadata.toolName.trim().length > 0 ? metadata.toolName.trim() : undefined,
            code: typeof metadata?.code === 'string' && metadata.code.trim().length > 0 ? metadata.code.trim() : undefined
        };

        if (this.pendingRecovery
            && this.pendingRecovery.prompt === nextState.prompt
            && this.pendingRecovery.toolName === nextState.toolName
            && this.pendingRecovery.code === nextState.code) {
            return;
        }

        this.pendingRecovery = nextState;
        this.checkpoint('error', `Recovery required${nextState.toolName ? ` after ${nextState.toolName}` : ''}`);
    }

    clearPendingRecovery(): void {
        if (!this.pendingRecovery) {
            return;
        }
        this.pendingRecovery = undefined;
        this.checkpoint('progress', 'Recovery requirement cleared');
    }

    hasPendingRecovery(): boolean {
        return !!this.pendingRecovery;
    }

    getPendingRecovery(): ICleanSlatePendingRecoveryState | undefined {
        return this.pendingRecovery ? { ...this.pendingRecovery } : undefined;
    }

    getVerificationTargets(): ICleanSlateVerificationTarget[] {
        return this.verificationTargets.map(target => ({
            ...target,
            sourcePaths: [...target.sourcePaths],
            routeHints: [...target.routeHints]
        }));
    }

    getPendingVerificationTargets(): ICleanSlateVerificationTarget[] {
        return this.getVerificationTargets().filter(target => target.status !== 'verified');
    }

    hasPendingVerification(): boolean {
        return this.verificationTargets.some(target => target.status !== 'verified');
    }

    registerVerificationTargetsForPaths(paths: string[] | undefined, objective?: string): void {
        const update = this.verificationTargetTracker.register(this.verificationTargets, paths, objective);
        this.verificationTargets = update.targets;
        if (update.changed) {
            this.checkpoint('progress', 'Browser verification required for updated UI surfaces');
        }
    }

    getToDo(): string[] {
        return [...this.toDo];
    }

    getCurrentWorkItem(): string | undefined {
        return this.currentWorkItem;
    }

    recordToolStart(toolName: string, summary?: string): void {
        if (!toolName) {
            return;
        }
        this.lastToolName = toolName;
        this.checkpoint('tool', summary || `Started tool ${toolName}`, toolName);
    }

    recordToolResult(toolName: string, success: boolean, summary?: string): void {
        if (!toolName) {
            return;
        }
        this.lastToolName = toolName;
        if (!success && summary) {
            this.lastError = summary;
        }
        this.checkpoint('tool', summary || `${toolName} ${success ? 'succeeded' : 'failed'}`, toolName);
    }

    recordError(error: string | undefined): void {
        if (typeof error === 'string' && error.trim().length > 0) {
            this.lastError = error.trim();
            this.checkpoint('error', this.lastError);
        }
    }

    getLastError(): string | undefined {
        return this.lastError;
    }

    getLastSummary(): string | undefined {
        return this.lastSummary;
    }

    getCheckpoints(): ICleanSlateRunCheckpoint[] {
        return [...this.checkpoints];
    }

    getRunSummary(): ICleanSlateRunSummary {
        return {
            taskId: this.taskId,
            runId: this.runId,
            startedAt: this.startedAt,
            phase: this.currentPhase,
            status: this.currentStatus,
            objective: this.objective,
            currentWorkItem: this.currentWorkItem,
            toDo: [...this.toDo],
            discoveredPaths: [...this.discoveredPaths],
            semanticHighlights: [...this.semanticHighlights],
            lastSummary: this.lastSummary,
            lastError: this.lastError,
            lastToolName: this.lastToolName,
            awaitingApproval: this.awaitingApproval,
            resumeCount: this.resumeCount,
            lastCheckpointAt: this.lastCheckpointAt,
            hasPendingRecovery: this.hasPendingRecovery(),
            hasPendingVerification: this.hasPendingVerification(),
            pendingVerificationTargetCount: this.getPendingVerificationTargets().length,
            pendingRecovery: this.getPendingRecovery(),
            verificationTargets: this.getVerificationTargets()
        };
    }

    getRunLedger(): ICleanSlateRunLedgerEntry[] {
        return [...this.runLedger];
    }

    getEvidenceLedger(): ICleanSlateEvidenceLedgerEntry[] {
        return this.evidenceLedger.map(entry => this.cloneEvidenceEntry(entry));
    }

    recordEvidence(entry: Partial<ICleanSlateEvidenceLedgerEntry> & { kind: CleanSlateEvidenceKind }): void {
        const timestamp = typeof entry.timestamp === 'number' && Number.isFinite(entry.timestamp)
            ? entry.timestamp
            : Date.now();
        const normalizedFilesChanged = this.evidenceCodec.normalizeFileChanges(entry.filesChanged);
        const normalizedPaths = this.evidenceCodec.normalizeEvidencePaths(entry.paths);
        const normalizedEntry: ICleanSlateEvidenceLedgerEntry = {
            id: typeof entry.id === 'string' && entry.id.trim().length > 0
                ? entry.id.trim()
                : `evidence-${timestamp}-${Math.random().toString(16).slice(2, 8)}`,
            timestamp,
            kind: entry.kind,
            phase: this.normalizeEvidencePhase(entry.phase),
            status: this.isValidStatus(entry.status) ? entry.status : this.currentStatus,
            taskId: typeof entry.taskId === 'string' ? entry.taskId : this.taskId,
            runId: typeof entry.runId === 'string' ? entry.runId : this.runId,
            toolName: this.evidenceCodec.trimOptional(entry.toolName),
            toolCallId: this.evidenceCodec.trimOptional(entry.toolCallId),
            success: typeof entry.success === 'boolean' ? entry.success : undefined,
            summary: this.evidenceCodec.trimOptional(entry.summary),
            error: this.evidenceCodec.trimOptional(entry.error),
            code: this.evidenceCodec.trimOptional(entry.code),
            input: this.evidenceCodec.sanitizeEvidenceValue(entry.input),
            result: this.evidenceCodec.sanitizeEvidenceValue(entry.result),
            paths: normalizedPaths.length > 0 ? normalizedPaths : undefined,
            filesChanged: normalizedFilesChanged.length > 0 ? normalizedFilesChanged : undefined,
            command: this.evidenceCodec.trimOptional(entry.command),
            cwd: this.evidenceCodec.trimOptional(entry.cwd),
            processId: this.evidenceCodec.trimOptional(entry.processId),
            pid: typeof entry.pid === 'number' && Number.isFinite(entry.pid) ? entry.pid : undefined,
            exitCode: typeof entry.exitCode === 'number' && Number.isFinite(entry.exitCode) ? entry.exitCode : undefined,
            durationMs: typeof entry.durationMs === 'number' && Number.isFinite(entry.durationMs) ? entry.durationMs : undefined,
            url: this.evidenceCodec.trimOptional(entry.url),
            screenshotCount: typeof entry.screenshotCount === 'number' && Number.isFinite(entry.screenshotCount) ? entry.screenshotCount : undefined,
            browserPageCount: typeof entry.browserPageCount === 'number' && Number.isFinite(entry.browserPageCount) ? entry.browserPageCount : undefined,
            turnId: this.evidenceCodec.trimOptional(entry.turnId),
            turnIndex: typeof entry.turnIndex === 'number' && Number.isFinite(entry.turnIndex) ? entry.turnIndex : undefined
        };

        this.evidenceLedger.push(normalizedEntry);
        if (this.evidenceLedger.length > CleanSlateTaskSessionService.MAX_EVIDENCE_LEDGER_ENTRIES) {
            this.evidenceLedger.splice(0, this.evidenceLedger.length - CleanSlateTaskSessionService.MAX_EVIDENCE_LEDGER_ENTRIES);
        }

        if (normalizedFilesChanged.length > 0) {
            this.recordExecutionFilesChanged(this.evidenceCodec.mergeFileChanges(this.executionFilesChanged, normalizedFilesChanged));
        }
        if (normalizedEntry.kind === 'browser' && normalizedEntry.success !== false) {
            const verificationUpdate = this.verificationTargetTracker.recordBrowserEvidence(this.verificationTargets, normalizedEntry);
            this.verificationTargets = verificationUpdate.targets;
            if (verificationUpdate.changed) {
                this.checkpoint('progress', 'Browser verification refreshed for updated UI surfaces');
            }
        }
    }

    checkpoint(kind: ICleanSlateRunCheckpoint['kind'] = 'progress', summary?: string, toolName?: string): void {
        this.lastCheckpointAt = Date.now();
        if (summary) {
            this.pushCheckpoint({
                id: `checkpoint-${this.lastCheckpointAt}-${Math.random().toString(16).slice(2, 6)}`,
                timestamp: this.lastCheckpointAt,
                kind,
                phase: this.currentPhase,
                status: this.currentStatus,
                summary,
                toolName,
                currentWorkItem: this.currentWorkItem
            });
        }
    }

    getStateSnapshot(): ICleanSlateTaskSessionSnapshot {
        return {
            taskId: this.taskId,
            runId: this.runId,
            startedAt: this.startedAt,
            phase: this.currentPhase,
            status: this.currentStatus,
            awaitingApproval: this.awaitingApproval,
            taskKind: this.currentTaskKind,
            workspaceShape: this.currentWorkspaceShape,
            lastCheckpointAt: this.lastCheckpointAt,
            objective: this.objective,
            toDo: [...this.toDo],
            discoveredPaths: [...this.discoveredPaths],
            semanticHighlights: [...this.semanticHighlights],
            executionFilesChanged: [...this.executionFilesChanged],
            currentWorkItem: this.currentWorkItem,
            lastSummary: this.lastSummary,
            lastError: this.lastError,
            lastToolName: this.lastToolName,
            resumeCount: this.resumeCount,
            checkpoints: [...this.checkpoints],
            lastUserTurn: this.lastUserTurn,
            lastAssistantTurn: this.lastAssistantTurn,
            lastIntent: this.lastIntent,
            runLedger: [...this.runLedger],
            evidenceLedger: this.getEvidenceLedger(),
            pendingRecovery: this.getPendingRecovery(),
            verificationTargets: this.getVerificationTargets()
        };
    }

    restoreStateSnapshot(
        snapshot?: Partial<ICleanSlateTaskSessionSnapshot>,
        options?: { markActiveTaskInterrupted?: boolean }
    ): void {
        this.taskId = typeof snapshot?.taskId === 'string' && snapshot.taskId.trim().length > 0
            ? snapshot.taskId
            : this.generateTaskId();
        this.runId = typeof snapshot?.runId === 'string' && snapshot.runId.trim().length > 0
            ? snapshot.runId
            : this.generateRunId();
        this.startedAt = typeof snapshot?.startedAt === 'number' && Number.isFinite(snapshot.startedAt)
            ? snapshot.startedAt
            : Date.now();
        const normalizedPhase = this.normalizeLegacyPhase(snapshot?.phase);
        this.currentPhase = this.isValidPhase(normalizedPhase) ? normalizedPhase : AgentPhase.PLANNING;
        this.awaitingApproval = typeof snapshot?.awaitingApproval === 'boolean' ? snapshot.awaitingApproval : false;
        this.currentTaskKind = this.isValidTaskKind(snapshot?.taskKind) ? snapshot.taskKind : CleanSlateTaskKind.UNKNOWN;
        this.currentWorkspaceShape = this.isValidWorkspaceShape(snapshot?.workspaceShape) ? snapshot.workspaceShape : CleanSlateWorkspaceShape.UNKNOWN;
        const normalizedStatus = this.normalizeLegacyStatus(snapshot?.status);
        this.currentStatus = this.isValidStatus(normalizedStatus)
            ? normalizedStatus
            : (this.awaitingApproval ? CleanSlateTaskLifecycleStatus.AWAITING_APPROVAL : this.phaseToStatus(this.currentPhase));
        this.lastCheckpointAt = typeof snapshot?.lastCheckpointAt === 'number' ? snapshot.lastCheckpointAt : Date.now();
        this.objective = typeof snapshot?.objective === 'string' ? snapshot.objective : undefined;
        this.toDo = Array.isArray(snapshot?.toDo)
            ? snapshot.toDo.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            : [];
        this.discoveredPaths = Array.isArray(snapshot?.discoveredPaths)
            ? snapshot.discoveredPaths
                .filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
                .map(path => path.trim().replace(/\\/g, '/'))
                .slice(-CleanSlateTaskSessionService.MAX_DISCOVERED_PATHS)
            : [];
        this.semanticHighlights = Array.isArray(snapshot?.semanticHighlights)
            ? snapshot.semanticHighlights
                .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
                .map(item => item.trim())
                .slice(-CleanSlateTaskSessionService.MAX_SEMANTIC_HIGHLIGHTS)
            : [];
        this.executionFilesChanged = Array.isArray(snapshot?.executionFilesChanged)
            ? snapshot.executionFilesChanged.flatMap((change): ICleanSlateTaskFileChange[] => {
                if (!change || typeof change.path !== 'string') {
                    return [];
                }
                const path = change.path.trim().replace(/\\/g, '/');
                if (!path) {
                    return [];
                }
                return [{
                    path,
                    added: typeof change.added === 'number' ? change.added : undefined,
                    deleted: typeof change.deleted === 'number' ? change.deleted : undefined
                }];
            })
            : [];
        this.currentWorkItem = typeof snapshot?.currentWorkItem === 'string'
            ? snapshot.currentWorkItem
            : this.deriveCurrentWorkItem(this.toDo);
        this.lastSummary = typeof snapshot?.lastSummary === 'string' ? snapshot.lastSummary : undefined;
        this.lastError = typeof snapshot?.lastError === 'string' ? snapshot.lastError : undefined;
        this.lastToolName = typeof snapshot?.lastToolName === 'string' ? snapshot.lastToolName : undefined;
        this.resumeCount = typeof snapshot?.resumeCount === 'number' ? snapshot.resumeCount : 0;
        this.checkpoints = Array.isArray(snapshot?.checkpoints)
            ? snapshot.checkpoints.flatMap((checkpoint): ICleanSlateRunCheckpoint[] => {
                if (!checkpoint
                    || typeof checkpoint.id !== 'string'
                    || typeof checkpoint.timestamp !== 'number'
                    || typeof checkpoint.summary !== 'string') {
                    return [];
                }

                const phase = this.normalizeLegacyPhase(checkpoint.phase);
                const status = this.normalizeLegacyStatus(checkpoint.status);
                if (!this.isValidPhase(phase) || !this.isValidStatus(status)) {
                    return [];
                }

                return [{
                    ...checkpoint,
                    phase,
                    status
                }];
            })
            : [];
        this.lastUserTurn = typeof snapshot?.lastUserTurn === 'string' ? snapshot.lastUserTurn : undefined;
        this.lastAssistantTurn = typeof snapshot?.lastAssistantTurn === 'string' ? snapshot.lastAssistantTurn : undefined;
        this.lastIntent = this.isValidIntent(snapshot?.lastIntent) ? snapshot.lastIntent : undefined;
        this.pendingRecovery = this.normalizePendingRecovery(snapshot?.pendingRecovery);
        this.verificationTargets = this.verificationTargetTracker.normalize(snapshot?.verificationTargets);
        this.runLedger = Array.isArray(snapshot?.runLedger)
            ? snapshot.runLedger.flatMap((entry): ICleanSlateRunLedgerEntry[] => {
                const normalizedEntry = this.normalizeLegacyRunLedgerEntry(entry);
                return normalizedEntry ? [normalizedEntry] : [];
            })
            : [];
        this.evidenceLedger = Array.isArray(snapshot?.evidenceLedger)
            ? snapshot.evidenceLedger.flatMap((entry): ICleanSlateEvidenceLedgerEntry[] => {
                const normalizedEntry = this.normalizeEvidenceEntry(entry);
                return normalizedEntry ? [normalizedEntry] : [];
            }).slice(-CleanSlateTaskSessionService.MAX_EVIDENCE_LEDGER_ENTRIES)
            : [];
        const evidenceFilesChanged = this.evidenceLedger.flatMap(entry => entry.filesChanged ?? []);
        if (evidenceFilesChanged.length > 0) {
            this.executionFilesChanged = this.evidenceCodec.mergeFileChanges(this.executionFilesChanged, evidenceFilesChanged);
        }

        if (options?.markActiveTaskInterrupted && this.shouldMarkInterruptedAfterRestore()) {
            this.currentStatus = CleanSlateTaskLifecycleStatus.INTERRUPTED;
            this.lastCheckpointAt = Date.now();
            this.pushCheckpoint({
                id: `checkpoint-${this.lastCheckpointAt}-${Math.random().toString(16).slice(2, 6)}`,
                timestamp: this.lastCheckpointAt,
                kind: 'resume',
                phase: this.currentPhase,
                status: this.currentStatus,
                summary: `Restored interrupted task in ${this.currentPhase}`,
                currentWorkItem: this.currentWorkItem
            });
        }
    }

    private normalizeEvidenceEntry(entry: unknown): ICleanSlateEvidenceLedgerEntry | undefined {
        if (!entry || typeof entry !== 'object') {
            return undefined;
        }

        const candidate = entry as Partial<ICleanSlateEvidenceLedgerEntry>;
        if (!this.isValidEvidenceKind(candidate.kind)) {
            return undefined;
        }

        const timestamp = typeof candidate.timestamp === 'number' && Number.isFinite(candidate.timestamp)
            ? candidate.timestamp
            : Date.now();
        const filesChanged = this.evidenceCodec.normalizeFileChanges(candidate.filesChanged);
        const paths = this.evidenceCodec.normalizeEvidencePaths(candidate.paths);

        return {
            id: typeof candidate.id === 'string' && candidate.id.trim().length > 0
                ? candidate.id.trim()
                : `evidence-${timestamp}-${Math.random().toString(16).slice(2, 8)}`,
            timestamp,
            kind: candidate.kind,
            phase: this.normalizeEvidencePhase(candidate.phase),
            status: this.isValidStatus(candidate.status) ? candidate.status : this.currentStatus,
            taskId: this.evidenceCodec.trimOptional(candidate.taskId),
            runId: this.evidenceCodec.trimOptional(candidate.runId),
            toolName: this.evidenceCodec.trimOptional(candidate.toolName),
            toolCallId: this.evidenceCodec.trimOptional(candidate.toolCallId),
            success: typeof candidate.success === 'boolean' ? candidate.success : undefined,
            summary: this.evidenceCodec.trimOptional(candidate.summary),
            error: this.evidenceCodec.trimOptional(candidate.error),
            code: this.evidenceCodec.trimOptional(candidate.code),
            input: this.evidenceCodec.sanitizeEvidenceValue(candidate.input),
            result: this.evidenceCodec.sanitizeEvidenceValue(candidate.result),
            paths: paths.length > 0 ? paths : undefined,
            filesChanged: filesChanged.length > 0 ? filesChanged : undefined,
            command: this.evidenceCodec.trimOptional(candidate.command),
            cwd: this.evidenceCodec.trimOptional(candidate.cwd),
            processId: this.evidenceCodec.trimOptional(candidate.processId),
            pid: typeof candidate.pid === 'number' && Number.isFinite(candidate.pid) ? candidate.pid : undefined,
            exitCode: typeof candidate.exitCode === 'number' && Number.isFinite(candidate.exitCode) ? candidate.exitCode : undefined,
            durationMs: typeof candidate.durationMs === 'number' && Number.isFinite(candidate.durationMs) ? candidate.durationMs : undefined,
            url: this.evidenceCodec.trimOptional(candidate.url),
            screenshotCount: typeof candidate.screenshotCount === 'number' && Number.isFinite(candidate.screenshotCount) ? candidate.screenshotCount : undefined,
            browserPageCount: typeof candidate.browserPageCount === 'number' && Number.isFinite(candidate.browserPageCount) ? candidate.browserPageCount : undefined,
            turnId: this.evidenceCodec.trimOptional(candidate.turnId),
            turnIndex: typeof candidate.turnIndex === 'number' && Number.isFinite(candidate.turnIndex) ? candidate.turnIndex : undefined
        };
    }

    private normalizePendingRecovery(value: unknown): ICleanSlatePendingRecoveryState | undefined {
        if (!value || typeof value !== 'object') {
            return undefined;
        }

        const candidate = value as Partial<ICleanSlatePendingRecoveryState>;
        const prompt = typeof candidate.prompt === 'string' ? candidate.prompt.trim() : '';
        if (!prompt) {
            return undefined;
        }

        return {
            prompt,
            updatedAt: typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt) ? candidate.updatedAt : Date.now(),
            toolName: this.evidenceCodec.trimOptional(candidate.toolName),
            code: this.evidenceCodec.trimOptional(candidate.code)
        };
    }

    private shouldMarkInterruptedAfterRestore(): boolean {
        if (this.awaitingApproval || this.currentTaskKind === CleanSlateTaskKind.CHAT) {
            return false;
        }

        return this.currentStatus === CleanSlateTaskLifecycleStatus.PLANNING
            || this.currentStatus === CleanSlateTaskLifecycleStatus.EXECUTING
            || this.currentStatus === CleanSlateTaskLifecycleStatus.VERIFYING;
    }

    private phaseToStatus(phase: AgentPhase): CleanSlateTaskLifecycleStatus {
        switch (phase) {
            case AgentPhase.EXECUTION:
                return CleanSlateTaskLifecycleStatus.EXECUTING;
            case AgentPhase.VERIFICATION:
                return CleanSlateTaskLifecycleStatus.VERIFYING;
            case AgentPhase.PLANNING:
            default:
                return CleanSlateTaskLifecycleStatus.PLANNING;
        }
    }

    private generateTaskId(): string {
        return `task-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    }

    private generateRunId(): string {
        return `run-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    }

    private isTerminalStatus(status: CleanSlateTaskLifecycleStatus): boolean {
        return status === CleanSlateTaskLifecycleStatus.COMPLETED
            || status === CleanSlateTaskLifecycleStatus.FAILED
            || status === CleanSlateTaskLifecycleStatus.CANCELLED;
    }

    private deriveCurrentWorkItem(toDo: string[]): string | undefined {
        const active = toDo.find(item => /^\s*\[(?:\s|\/)\]/.test(item))
            ?? toDo.find(item => /^\s*\[x\]/i.test(item))
            ?? toDo.at(-1);

        if (!active) {
            return undefined;
        }

        const clean = active.replace(/^\s*[-*]?\s*\[[xX/\s]\]\s*/, '').trim();
        return clean || undefined;
    }

    private pushCheckpoint(checkpoint: ICleanSlateRunCheckpoint): void {
        this.checkpoints.push(checkpoint);
        if (this.checkpoints.length > CleanSlateTaskSessionService.MAX_CHECKPOINTS) {
            this.checkpoints.splice(0, this.checkpoints.length - CleanSlateTaskSessionService.MAX_CHECKPOINTS);
        }
    }

    private cloneEvidenceEntry(entry: ICleanSlateEvidenceLedgerEntry): ICleanSlateEvidenceLedgerEntry {
        return {
            ...entry,
            input: this.evidenceCodec.sanitizeEvidenceValue(entry.input),
            result: this.evidenceCodec.sanitizeEvidenceValue(entry.result),
            paths: entry.paths ? [...entry.paths] : undefined,
            filesChanged: entry.filesChanged ? entry.filesChanged.map(change => ({ ...change })) : undefined
        };
    }

    private archiveCurrentRunIfNeeded(statusOverride?: CleanSlateTaskLifecycleStatus): void {
        const entry = this.createRunLedgerEntry(statusOverride);
        if (!entry) {
            return;
        }

        const existingIndex = this.runLedger.findIndex(run => run.runId === entry.runId);
        if (existingIndex !== -1) {
            this.runLedger.splice(existingIndex, 1);
        }

        this.runLedger.unshift(entry);
        if (this.runLedger.length > CleanSlateTaskSessionService.MAX_RUN_LEDGER_ENTRIES) {
            this.runLedger.length = CleanSlateTaskSessionService.MAX_RUN_LEDGER_ENTRIES;
        }
    }

    private collectRecentDiscoveredPathsForNewTask(): string[] {
        const merged: string[] = [];
        const seen = new Set<string>();
        const addPath = (candidate: unknown) => {
            if (typeof candidate !== 'string') {
                return;
            }
            const normalized = candidate.trim().replace(/\\/g, '/');
            if (!normalized) {
                return;
            }
            const key = normalized.toLowerCase();
            if (seen.has(key)) {
                const existingIndex = merged.findIndex(path => path.toLowerCase() === key);
                if (existingIndex !== -1) {
                    merged.splice(existingIndex, 1);
                }
            } else {
                seen.add(key);
            }
            merged.push(normalized);
        };
        const addPathList = (paths: unknown) => {
            if (!Array.isArray(paths)) {
                return;
            }
            for (const path of paths) {
                addPath(path);
            }
        };

        for (let i = this.runLedger.length - 1; i >= 0; i--) {
            addPathList(this.runLedger[i].discoveredPaths);
        }
        addPathList(this.discoveredPaths);

        if (merged.length > CleanSlateTaskSessionService.MAX_SEEDED_DISCOVERED_PATHS) {
            merged.splice(0, merged.length - CleanSlateTaskSessionService.MAX_SEEDED_DISCOVERED_PATHS);
        }
        return merged;
    }

    private collectRecentSemanticHighlightsForNewTask(): string[] {
        const merged: string[] = [];
        const seen = new Set<string>();
        const addHighlight = (candidate: unknown) => {
            if (typeof candidate !== 'string') {
                return;
            }
            const normalized = candidate.trim();
            if (!normalized) {
                return;
            }
            const key = normalized.toLowerCase();
            if (seen.has(key)) {
                const existingIndex = merged.findIndex(item => item.toLowerCase() === key);
                if (existingIndex !== -1) {
                    merged.splice(existingIndex, 1);
                }
            } else {
                seen.add(key);
            }
            merged.push(normalized);
        };
        const addHighlightList = (values: unknown) => {
            if (!Array.isArray(values)) {
                return;
            }
            for (const value of values) {
                addHighlight(value);
            }
        };

        for (let i = this.runLedger.length - 1; i >= 0; i--) {
            addHighlightList(this.runLedger[i].semanticHighlights);
        }
        addHighlightList(this.semanticHighlights);

        if (merged.length > CleanSlateTaskSessionService.MAX_SEEDED_SEMANTIC_HIGHLIGHTS) {
            merged.splice(0, merged.length - CleanSlateTaskSessionService.MAX_SEEDED_SEMANTIC_HIGHLIGHTS);
        }
        return merged;
    }

    private createRunLedgerEntry(statusOverride?: CleanSlateTaskLifecycleStatus): ICleanSlateRunLedgerEntry | undefined {
        if (!this.taskId || !this.runId) {
            return undefined;
        }

        if (this.currentTaskKind === CleanSlateTaskKind.CHAT || this.currentStatus === CleanSlateTaskLifecycleStatus.IDLE) {
            return undefined;
        }

        const status = statusOverride ?? this.currentStatus;
        return {
            taskId: this.taskId,
            runId: this.runId,
            startedAt: this.startedAt || this.lastCheckpointAt || Date.now(),
            phase: this.currentPhase,
            status,
            objective: this.objective,
            currentWorkItem: this.currentWorkItem,
            toDo: [...this.toDo],
            discoveredPaths: [...this.discoveredPaths],
            semanticHighlights: [...this.semanticHighlights],
            lastSummary: this.lastSummary,
            lastError: this.lastError,
            lastToolName: this.lastToolName,
            awaitingApproval: this.awaitingApproval,
            resumeCount: this.resumeCount,
            lastCheckpointAt: this.lastCheckpointAt,
            hasPendingRecovery: this.hasPendingRecovery(),
            hasPendingVerification: this.hasPendingVerification(),
            pendingVerificationTargetCount: this.getPendingVerificationTargets().length,
            taskKind: this.currentTaskKind,
            workspaceShape: this.currentWorkspaceShape,
            archivedAt: Date.now()
        };
    }

    private getArchiveStatusForTaskSwitch(): CleanSlateTaskLifecycleStatus | undefined {
        if (!this.taskId || this.currentStatus === CleanSlateTaskLifecycleStatus.IDLE || this.currentTaskKind === CleanSlateTaskKind.CHAT) {
            return undefined;
        }

        if (this.isTerminalStatus(this.currentStatus) || this.currentStatus === CleanSlateTaskLifecycleStatus.INTERRUPTED) {
            return this.currentStatus;
        }

        if (this.awaitingApproval) {
            return CleanSlateTaskLifecycleStatus.AWAITING_APPROVAL;
        }

        return CleanSlateTaskLifecycleStatus.INTERRUPTED;
    }

    private areStringArraysEqual(left: string[], right: string[]): boolean {
        if (left.length !== right.length) {
            return false;
        }

        for (let i = 0; i < left.length; i++) {
            if (left[i] !== right[i]) {
                return false;
            }
        }

        return true;
    }

    private isValidPhase(value: unknown): value is AgentPhase {
        return value === AgentPhase.PLANNING
            || value === AgentPhase.EXECUTION
            || value === AgentPhase.VERIFICATION;
    }

    private normalizeEvidencePhase(value: unknown): CleanSlateEvidencePhase {
        if (value === 'CHAT') {
            return 'CHAT';
        }
        const phase = this.normalizeLegacyPhase(value);
        return this.isValidPhase(phase) ? phase : this.currentPhase;
    }

    private isValidEvidenceKind(value: unknown): value is CleanSlateEvidenceKind {
        return value === 'assistant_turn_start'
            || value === 'assistant_turn_complete'
            || value === 'tool_start'
            || value === 'tool_result'
            || value === 'read'
            || value === 'mutation'
            || value === 'command'
            || value === 'browser'
            || value === 'artifact'
            || value === 'diagnostic'
            || value === 'completion'
            || value === 'error';
    }

    private isValidTaskKind(value: unknown): value is CleanSlateTaskKind {
        return value === CleanSlateTaskKind.UNKNOWN
            || value === CleanSlateTaskKind.CHAT
            || value === CleanSlateTaskKind.MODIFY_EXISTING
            || value === CleanSlateTaskKind.BOOTSTRAP_PROJECT;
    }

    private isValidWorkspaceShape(value: unknown): value is CleanSlateWorkspaceShape {
        return value === CleanSlateWorkspaceShape.UNKNOWN
            || value === CleanSlateWorkspaceShape.EMPTY
            || value === CleanSlateWorkspaceShape.EXISTING;
    }

    private isValidStatus(value: unknown): value is CleanSlateTaskLifecycleStatus {
        return value === CleanSlateTaskLifecycleStatus.IDLE
            || value === CleanSlateTaskLifecycleStatus.CHAT
            || value === CleanSlateTaskLifecycleStatus.PLANNING
            || value === CleanSlateTaskLifecycleStatus.AWAITING_APPROVAL
            || value === CleanSlateTaskLifecycleStatus.EXECUTING
            || value === CleanSlateTaskLifecycleStatus.VERIFYING
            || value === CleanSlateTaskLifecycleStatus.INTERRUPTED
            || value === CleanSlateTaskLifecycleStatus.COMPLETED
            || value === CleanSlateTaskLifecycleStatus.FAILED
            || value === CleanSlateTaskLifecycleStatus.CANCELLED;
    }

    private isValidIntent(value: unknown): value is CleanSlateTurnIntent {
        return value === CleanSlateTurnIntent.APPROVE_PLAN
            || value === CleanSlateTurnIntent.CONTINUE_CURRENT
            || value === CleanSlateTurnIntent.START_NEW_TASK
            || value === CleanSlateTurnIntent.CANCEL_CURRENT
            || value === CleanSlateTurnIntent.RERUN_LAST_TASK
            || value === CleanSlateTurnIntent.REVISE_PLAN;
    }

    private isValidRunLedgerEntry(value: unknown): value is ICleanSlateRunLedgerEntry {
        if (!value || typeof value !== 'object') {
            return false;
        }

        const entry = value as Partial<ICleanSlateRunLedgerEntry>;
        return typeof entry.runId === 'string'
            && typeof entry.startedAt === 'number'
            && typeof entry.archivedAt === 'number'
            && this.isValidPhase(entry.phase)
            && this.isValidStatus(entry.status)
            && this.isValidTaskKind(entry.taskKind)
            && this.isValidWorkspaceShape(entry.workspaceShape);
    }

    private normalizeLegacyPhase(value: unknown): AgentPhase | undefined {
        if (value === 'PREPARING') {
            return AgentPhase.EXECUTION;
        }
        return this.isValidPhase(value) ? value : undefined;
    }

    private normalizeLegacyStatus(value: unknown): CleanSlateTaskLifecycleStatus | undefined {
        if (value === 'PREPARING') {
            return CleanSlateTaskLifecycleStatus.EXECUTING;
        }
        return this.isValidStatus(value) ? value : undefined;
    }

    private normalizeLegacyRunLedgerEntry(value: unknown): ICleanSlateRunLedgerEntry | undefined {
        if (!value || typeof value !== 'object') {
            return undefined;
        }

        const entry = value as Partial<ICleanSlateRunLedgerEntry>;
        const phase = this.normalizeLegacyPhase(entry.phase);
        const status = this.normalizeLegacyStatus(entry.status);
        if (!phase || !status) {
            return undefined;
        }

        const normalizedEntry: Partial<ICleanSlateRunLedgerEntry> = {
            ...entry,
            phase,
            status
        };

        return this.isValidRunLedgerEntry(normalizedEntry) ? normalizedEntry : undefined;
    }
}
