/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { join } from '../../../../../base/common/path.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { IEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { ICleanSlatePersistedSession, ICleanSlatePersistedThreadMessage, normalizeCleanSlateExecutionState } from '../../common/core/cleanSlateAI.js';
import { resolveArchivedSessionWorkspaceId } from '@cleanslate/sdk/protocol/cleanSlateThreadSession.js';

type SQLiteDatabase = any;

interface IThreadSessionRow {
    id: string;
    parentSessionId: string | null;
    createdAt: number | null;
    workspaceId: string;
    projectRoot: string | null;
    workDir: string | null;
    status: string | null;
    sessionKey: string | null;
    title: string;
    savedAt: number;
    updatedAt: number;
    workspaceName: string | null;
    planMode: number | null;
    reasoningLevel: string | null;
    taskState: string | null;
    threadState: string | null;
    agent: string | null;
    transcript: string | null;
    transcriptVersion: number | null;
    isActive: number;
    isArchived: number;
}

interface IThreadMessageRow {
    role: string;
    content: string;
    isInternalState: number | null;
    renderPayload: string | null;
}

export class CleanSlateThreadPersistenceStore extends Disposable {
    private static readonly SQLITE_BUSY_TIMEOUT_MS = 10_000;
    private static readonly SQLITE_BUSY_RETRY_COUNT = 6;

    private readonly dbPath: string;
    private readonly workspaceStorageHome: string;
    private readonly globalStorageStateDbPath: string;
    private dbPromise: Promise<SQLiteDatabase> | undefined;
    private writeQueue: Promise<void> = Promise.resolve();

    constructor(
        @IEnvironmentService environmentService: IEnvironmentService,
        @ILogService private readonly logService: ILogService
    ) {
        super();
        this.dbPath = joinPath(environmentService.userRoamingDataHome, 'cleanSlate.threads.v1.db').fsPath;
        this.workspaceStorageHome = joinPath(environmentService.userRoamingDataHome, 'workspaceStorage').fsPath;
        this.globalStorageStateDbPath = joinPath(environmentService.userRoamingDataHome, 'globalStorage', 'state.vscdb').fsPath;
    }

    async loadActiveSession(workspaceId: string): Promise<ICleanSlatePersistedSession | undefined> {
        const db = await this.getDb();
        const legacyNoProjectMatch = this.isNoProjectWorkspaceId(workspaceId)
            ? `OR (
                (projectRoot IS NULL OR projectRoot = '')
                AND (workDir IS NULL OR workDir = '')
                AND (
                    workspaceName IS NULL
                    OR trim(workspaceName) = ''
                    OR lower(workspaceName) = 'cleanslate'
                    OR lower(workspaceName) = 'no project'
                )
             )`
            : '';
        const row = await this.get<IThreadSessionRow>(
            db,
            `SELECT * FROM ThreadSessions
             WHERE isActive = 1
             AND (
                workspaceId = ?
                OR lower(workspaceName) = lower(?)
                OR lower(projectRoot) = lower(?)
                OR lower(workDir) = lower(?)
                ${legacyNoProjectMatch}
             )
             ORDER BY updatedAt DESC LIMIT 1`,
            [workspaceId, workspaceId, workspaceId, workspaceId]
        );
        return row ? this.hydrateSession(db, row) : undefined;
    }

    async loadSession(sessionId: string): Promise<ICleanSlatePersistedSession | undefined> {
        const db = await this.getDb();
        const row = await this.get<IThreadSessionRow>(
            db,
            `SELECT * FROM ThreadSessions WHERE id = ? LIMIT 1`,
            [sessionId]
        );
        return row ? this.hydrateSession(db, row) : undefined;
    }

    async saveActiveSession(workspaceId: string, session: ICleanSlatePersistedSession): Promise<void> {
        await this.enqueueWrite(async db => {
            const existing = await this.get<Pick<IThreadSessionRow, 'isArchived'>>(db, `SELECT isArchived FROM ThreadSessions WHERE id = ?`, [session.id]);
            await this.writeSession(db, workspaceId, session, {
                isActive: true,
                isArchived: existing?.isArchived === 1
            });
        });
    }

    async clearActiveSession(workspaceId: string): Promise<void> {
        await this.enqueueWrite(async db => {
            await this.run(db, `UPDATE ThreadSessions SET isActive = 0, updatedAt = ? WHERE workspaceId = ? AND isActive = 1`, [Date.now(), workspaceId]);
        });
    }

    async listArchivedSessions(workspaceId: string): Promise<ICleanSlatePersistedSession[]> {
        const db = await this.getDb();
        const rows = await this.all<IThreadSessionRow>(
            db,
            `SELECT * FROM ThreadSessions
             WHERE isArchived = 1
             AND (
                workspaceId = ?
                OR lower(workspaceName) = lower(?)
                OR lower(projectRoot) = lower(?)
                OR lower(workDir) = lower(?)
             )
             ORDER BY savedAt DESC LIMIT 50`,
            [workspaceId, workspaceId, workspaceId, workspaceId]
        );
        const sessions: ICleanSlatePersistedSession[] = [];
        for (const row of rows) {
            const session = await this.hydrateSession(db, row);
            if (session) {
                sessions.push(session);
            }
        }
        return sessions;
    }

    async listSessions(): Promise<ICleanSlatePersistedSession[]> {
        const db = await this.getDb();
        const rows = await this.all<IThreadSessionRow>(
            db,
            `SELECT * FROM ThreadSessions ORDER BY updatedAt DESC`
        );
        return rows.map(row => this.summarizeSession(row));
    }

    async archiveSession(workspaceId: string, session: ICleanSlatePersistedSession): Promise<void> {
        await this.enqueueWrite(async db => {
            const existing = await this.get<Pick<IThreadSessionRow, 'isActive'>>(db, `SELECT isActive FROM ThreadSessions WHERE id = ?`, [session.id]);
            await this.writeSession(db, workspaceId, session, {
                isActive: existing?.isActive === 1,
                isArchived: true
            });
            await this.pruneArchivedSessions(db, workspaceId);
        });
    }

    async removeArchivedSession(workspaceId: string, sessionId: string): Promise<void> {
        await this.enqueueWrite(async db => {
            const existing = await this.get<IThreadSessionRow>(db, `SELECT isActive FROM ThreadSessions WHERE id = ? AND workspaceId = ?`, [sessionId, workspaceId]);
            if (!existing) {
                return;
            }

            await this.run(db, 'BEGIN IMMEDIATE');
            try {
                if (existing.isActive === 1) {
                    await this.run(db, `UPDATE ThreadSessions SET isArchived = 0, updatedAt = ? WHERE id = ? AND workspaceId = ?`, [Date.now(), sessionId, workspaceId]);
                } else {
                    await this.run(db, `DELETE FROM ThreadMessages WHERE sessionId = ?`, [sessionId]);
                    await this.run(db, `DELETE FROM ThreadSessions WHERE id = ? AND workspaceId = ?`, [sessionId, workspaceId]);
                }
                await this.run(db, 'COMMIT');
            } catch (error) {
                await this.rollback(db);
                throw error;
            }
        });
    }

    async removeSession(sessionId: string): Promise<void> {
        await this.enqueueWrite(async db => {
            await this.run(db, 'BEGIN IMMEDIATE');
            try {
                await this.run(db, `DELETE FROM ThreadMessages WHERE sessionId = ?`, [sessionId]);
                await this.run(db, `DELETE FROM ThreadSessions WHERE id = ?`, [sessionId]);
                await this.run(db, 'COMMIT');
            } catch (error) {
                await this.rollback(db);
                throw error;
            }
        });
    }

    override dispose(): void {
        const promise = this.dbPromise;
        this.dbPromise = undefined;
        if (promise) {
            void promise.then(db => {
                try {
                    db.close();
                } catch (error) {
                    this.logService.warn(`CleanSlate thread persistence close failed: ${String(error)}`);
                }
            });
        }
        super.dispose();
    }

    private async getDb(): Promise<SQLiteDatabase> {
        if (!this.dbPromise) {
            this.dbPromise = this.initDb();
        }
        return this.dbPromise;
    }

    private async initDb(): Promise<SQLiteDatabase> {
        try {
            const sqlite3 = await import('@vscode/sqlite3');
            const db = await new Promise<SQLiteDatabase>((resolve, reject) => {
                const database = new sqlite3.default.Database(this.dbPath, (error: any) => {
                    if (error) {
                        this.logService.error(`Failed to open CleanSlate thread SQLite database: ${error}`);
                        reject(error);
                        return;
                    }

                    resolve(database);
                });
            });
            if (typeof db.configure === 'function') {
                db.configure('busyTimeout', CleanSlateThreadPersistenceStore.SQLITE_BUSY_TIMEOUT_MS);
            }
            await this.run(db, `PRAGMA busy_timeout = ${CleanSlateThreadPersistenceStore.SQLITE_BUSY_TIMEOUT_MS}`);
            await this.run(db, `PRAGMA journal_mode = WAL`);
            await this.run(db, `PRAGMA synchronous = NORMAL`);
            await this.run(db, `PRAGMA foreign_keys = ON`);
            await this.run(db, `CREATE TABLE IF NOT EXISTS ThreadSessions (
                id TEXT PRIMARY KEY,
                parentSessionId TEXT,
                createdAt INTEGER,
                workspaceId TEXT NOT NULL,
                projectRoot TEXT,
                workDir TEXT,
                status TEXT,
                sessionKey TEXT,
                title TEXT NOT NULL,
                savedAt INTEGER NOT NULL,
                updatedAt INTEGER NOT NULL,
                workspaceName TEXT,
                planMode INTEGER NOT NULL DEFAULT 0,
                reasoningLevel TEXT NOT NULL DEFAULT 'low',
                taskState TEXT,
                threadState TEXT,
                agent TEXT,
                transcript TEXT,
                transcriptVersion INTEGER,
                isActive INTEGER NOT NULL DEFAULT 0,
                isArchived INTEGER NOT NULL DEFAULT 0
            )`);
            await this.ensureColumn(db, 'ThreadSessions', 'parentSessionId', 'TEXT');
            await this.ensureColumn(db, 'ThreadSessions', 'createdAt', 'INTEGER');
            await this.ensureColumn(db, 'ThreadSessions', 'projectRoot', 'TEXT');
            await this.ensureColumn(db, 'ThreadSessions', 'workDir', 'TEXT');
            await this.ensureColumn(db, 'ThreadSessions', 'status', 'TEXT');
            await this.ensureColumn(db, 'ThreadSessions', 'sessionKey', 'TEXT');
            await this.ensureColumn(db, 'ThreadSessions', 'planMode', 'INTEGER NOT NULL DEFAULT 0');
            await this.ensureColumn(db, 'ThreadSessions', 'reasoningLevel', `TEXT NOT NULL DEFAULT 'low'`);
            await this.ensureColumn(db, 'ThreadSessions', 'transcript', 'TEXT');
            await this.ensureColumn(db, 'ThreadSessions', 'transcriptVersion', 'INTEGER');
            await this.dropThreadSessionExecutionProfileColumn(db);
            await this.run(db, `CREATE INDEX IF NOT EXISTS idx_thread_sessions_workspace_active ON ThreadSessions(workspaceId, isActive, updatedAt)`);
            await this.run(db, `CREATE INDEX IF NOT EXISTS idx_thread_sessions_workspace_archived ON ThreadSessions(workspaceId, isArchived, savedAt)`);
            await this.run(db, `CREATE TABLE IF NOT EXISTS ThreadMessages (
                sessionId TEXT NOT NULL,
                sequence INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                isInternalState INTEGER,
                renderPayload TEXT,
                PRIMARY KEY(sessionId, sequence),
                FOREIGN KEY(sessionId) REFERENCES ThreadSessions(id) ON DELETE CASCADE
            )`);
            await this.run(db, `CREATE TABLE IF NOT EXISTS ThreadMeta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )`);
            await this.importWorkspaceStorageSessions(db);
            this.logService.info(`CleanSlate thread persistence initialized at ${this.dbPath}`);
            return db;
        } catch (error) {
            this.logService.error(`CleanSlate thread SQLite persistence is unavailable: ${String(error)}`);
            throw error;
        }
    }

    private async ensureColumn(db: SQLiteDatabase, tableName: string, columnName: string, definition: string): Promise<void> {
        const columns = await this.all<{ name: string }>(db, `PRAGMA table_info(${tableName})`);
        if (columns.some(column => column.name === columnName)) {
            return;
        }

        await this.run(db, `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }

    private async dropThreadSessionExecutionProfileColumn(db: SQLiteDatabase): Promise<void> {
        const columns = await this.all<{ name: string }>(db, `PRAGMA table_info(ThreadSessions)`);
        if (!columns.some(column => column.name === 'executionProfile')) {
            return;
        }

        try {
            await this.run(db, `ALTER TABLE ThreadSessions DROP COLUMN executionProfile`);
            return;
        } catch (error) {
            this.logService.warn(`CleanSlate thread persistence could not drop executionProfile directly; rebuilding table: ${String(error)}`);
        }

        const preservedColumns = [
            'id',
            'parentSessionId',
            'createdAt',
            'workspaceId',
            'projectRoot',
            'workDir',
            'status',
            'sessionKey',
            'title',
            'savedAt',
            'updatedAt',
            'workspaceName',
            'planMode',
            'reasoningLevel',
            'taskState',
            'threadState',
            'agent',
            'transcript',
            'transcriptVersion',
            'isActive',
            'isArchived'
        ].join(', ');

        await this.run(db, `PRAGMA foreign_keys = OFF`);
        await this.run(db, 'BEGIN IMMEDIATE');
        try {
            await this.run(db, `CREATE TABLE ThreadSessions_next (
                id TEXT PRIMARY KEY,
                parentSessionId TEXT,
                createdAt INTEGER,
                workspaceId TEXT NOT NULL,
                projectRoot TEXT,
                workDir TEXT,
                status TEXT,
                sessionKey TEXT,
                title TEXT NOT NULL,
                savedAt INTEGER NOT NULL,
                updatedAt INTEGER NOT NULL,
                workspaceName TEXT,
                planMode INTEGER NOT NULL DEFAULT 0,
                reasoningLevel TEXT NOT NULL DEFAULT 'low',
                taskState TEXT,
                threadState TEXT,
                agent TEXT,
                transcript TEXT,
                transcriptVersion INTEGER,
                isActive INTEGER NOT NULL DEFAULT 0,
                isArchived INTEGER NOT NULL DEFAULT 0
            )`);
            await this.run(db, `INSERT INTO ThreadSessions_next (${preservedColumns}) SELECT ${preservedColumns} FROM ThreadSessions`);
            await this.run(db, `DROP TABLE ThreadSessions`);
            await this.run(db, `ALTER TABLE ThreadSessions_next RENAME TO ThreadSessions`);
            await this.run(db, 'COMMIT');
        } catch (error) {
            await this.rollback(db);
            throw error;
        } finally {
            await this.run(db, `PRAGMA foreign_keys = ON`);
        }
    }

    private enqueueWrite<T>(operation: (db: SQLiteDatabase) => Promise<T>): Promise<T> {
        const queued = this.writeQueue
            .catch(() => undefined)
            .then(async () => {
                const db = await this.getDb();
                return operation(db);
            });
        this.writeQueue = queued.then(() => undefined, () => undefined);
        return queued;
    }

    private async writeSession(
        db: SQLiteDatabase,
        workspaceId: string,
        session: ICleanSlatePersistedSession,
        flags: { isActive: boolean; isArchived: boolean }
    ): Promise<void> {
        const normalized = this.normalizeSession(session);
        const updatedAt = normalized.updatedAt ?? Date.now();

        await this.run(db, 'BEGIN IMMEDIATE');
        try {
            if (flags.isActive) {
                await this.run(db, `UPDATE ThreadSessions SET isActive = 0, updatedAt = ? WHERE workspaceId = ? AND id <> ?`, [updatedAt, workspaceId, normalized.id]);
            }

            await this.run(
                db,
                `INSERT INTO ThreadSessions (
                    id, parentSessionId, createdAt, workspaceId, projectRoot, workDir, status, sessionKey,
                    title, savedAt, updatedAt, workspaceName, planMode, reasoningLevel,
                    taskState, threadState, agent, transcript, transcriptVersion, isActive, isArchived
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    parentSessionId = excluded.parentSessionId,
                    createdAt = excluded.createdAt,
                    workspaceId = excluded.workspaceId,
                    projectRoot = excluded.projectRoot,
                    workDir = excluded.workDir,
                    status = excluded.status,
                    sessionKey = excluded.sessionKey,
                    title = excluded.title,
                    savedAt = excluded.savedAt,
                    updatedAt = excluded.updatedAt,
                    workspaceName = excluded.workspaceName,
                    planMode = excluded.planMode,
                    reasoningLevel = excluded.reasoningLevel,
                    taskState = excluded.taskState,
                    threadState = excluded.threadState,
                    agent = excluded.agent,
                    transcript = excluded.transcript,
                    transcriptVersion = excluded.transcriptVersion,
                    isActive = excluded.isActive,
                    isArchived = excluded.isArchived`,
                [
                    normalized.id,
                    normalized.parentSessionId ?? null,
                    normalized.createdAt ?? normalized.savedAt,
                    workspaceId,
                    normalized.projectRoot ?? null,
                    normalized.workDir ?? null,
                    normalized.status ?? null,
                    normalized.sessionKey ?? normalized.id,
                    normalized.title,
                    normalized.savedAt,
                    updatedAt,
                    normalized.workspaceName ?? null,
                    normalized.planMode ? 1 : 0,
                    normalized.reasoningLevel,
                    this.toJson(normalized.taskState),
                    this.toJson(normalized.threadState),
                    this.toJson(normalized.agent),
                    this.toJson(normalized.transcript),
                    normalized.transcriptVersion ?? null,
                    flags.isActive ? 1 : 0,
                    flags.isArchived ? 1 : 0
                ]
            );

            await this.run(db, `DELETE FROM ThreadMessages WHERE sessionId = ?`, [normalized.id]);
            for (let i = 0; i < normalized.history.length; i++) {
                const message = normalized.history[i];
                await this.run(
                    db,
                    `INSERT INTO ThreadMessages (sessionId, sequence, role, content, isInternalState, renderPayload) VALUES (?, ?, ?, ?, ?, ?)`,
                    [
                        normalized.id,
                        i,
                        message.role,
                        message.content,
                        message.isInternalState ? 1 : 0,
                        message.renderPayload ?? null
                    ]
                );
            }

            await this.run(db, 'COMMIT');
        } catch (error) {
            await this.rollback(db);
            throw error;
        }
    }

    /**
     * Chats live authoritatively in each project window's workspace-scoped storage and only reach
     * this shared store while that window is open. Without this import, the Agent Manager (which
     * lists sessions across all projects from this store) shows an incomplete chat list for any
     * project whose window has not been opened since the shared store was created or last cleared.
     */
    private async importWorkspaceStorageSessions(db: SQLiteDatabase): Promise<void> {
        try {
            const lastImportedAt = await this.getWorkspaceStorageImportedAt(db);
            // Bump when the import/merge logic changes so existing installs re-scan every workspace
            // once and re-evaluate rows the mtime guard would otherwise skip.
            const importLogicVersion = 2;
            const forceFullScan = await this.getWorkspaceStorageImportVersion(db) < importLogicVersion;
            const importStartedAt = Date.now();
            const deletion = await this.readDeletedSessionMarkers();
            const entries = await fs.readdir(this.workspaceStorageHome, { withFileTypes: true }).catch(() => []);
            let imported = 0;
            for (const entry of entries) {
                if (!entry.isDirectory()) {
                    continue;
                }
                const storageDir = join(this.workspaceStorageHome, entry.name);
                const stateDbPath = join(storageDir, 'state.vscdb');
                const stateDbStat = await fs.stat(stateDbPath).catch(() => undefined);
                if (!stateDbStat || (!forceFullScan && stateDbStat.mtimeMs <= lastImportedAt)) {
                    continue;
                }
                const sessions = await this.readWorkspaceStorageSessions(stateDbPath);
                if (!sessions.length) {
                    continue;
                }
                const fallbackRoot = await this.readWorkspaceFolderUri(join(storageDir, 'workspace.json'));
                for (const session of sessions) {
                    if (this.isSessionDeleted(session, deletion)) {
                        continue;
                    }
                    if (await this.importWorkspaceStorageSession(db, session, fallbackRoot)) {
                        imported++;
                    }
                }
            }
            const purged = await this.purgeDeletedSessions(db, deletion.ids);
            await this.run(
                db,
                `INSERT INTO ThreadMeta (key, value) VALUES ('workspaceStorageImportedAt', ?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
                [String(importStartedAt)]
            );
            await this.run(
                db,
                `INSERT INTO ThreadMeta (key, value) VALUES ('workspaceStorageImportVersion', ?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
                [String(importLogicVersion)]
            );
            if (imported > 0 || purged > 0) {
                this.logService.info(`CleanSlate thread persistence imported ${imported} and purged ${purged} deleted session(s) from workspace storage.`);
            }
        } catch (error) {
            this.logService.warn(`CleanSlate thread persistence could not import workspace storage sessions: ${String(error)}`);
        }
    }

    private async getWorkspaceStorageImportedAt(db: SQLiteDatabase): Promise<number> {
        const row = await this.get<{ value: string }>(db, `SELECT value FROM ThreadMeta WHERE key = 'workspaceStorageImportedAt'`);
        const value = Number(row?.value);
        return Number.isFinite(value) ? value : 0;
    }

    private async getWorkspaceStorageImportVersion(db: SQLiteDatabase): Promise<number> {
        const row = await this.get<{ value: string }>(db, `SELECT value FROM ThreadMeta WHERE key = 'workspaceStorageImportVersion'`);
        const value = Number(row?.value);
        return Number.isFinite(value) ? value : 0;
    }

    /**
     * Deletion is recorded in the browser's globalStorage as tombstones (per-session ids and a
     * global "deleted before" cutoff), separately from the physical row removal. Honoring them here
     * keeps the import from resurrecting a chat the user deleted whose copy still lingers in another
     * project's workspace storage.
     */
    private async readDeletedSessionMarkers(): Promise<{ ids: Set<string>; deletedBefore: number }> {
        const result = { ids: new Set<string>(), deletedBefore: 0 };
        let stateDb: SQLiteDatabase | undefined;
        try {
            const sqlite3 = await import('@vscode/sqlite3');
            stateDb = await new Promise<SQLiteDatabase>((resolve, reject) => {
                const database = new sqlite3.default.Database(this.globalStorageStateDbPath, sqlite3.default.OPEN_READONLY, (error: any) => {
                    error ? reject(error) : resolve(database);
                });
            });
            const rows = await this.all<{ key: string; value: string }>(
                stateDb,
                `SELECT key, value FROM ItemTable WHERE key IN ('cleanSlate.chat.deletedSessionIds', 'cleanSlate.chat.deletedBefore')`
            );
            for (const row of rows) {
                if (row.key === 'cleanSlate.chat.deletedSessionIds') {
                    const parsed = JSON.parse(row.value);
                    if (Array.isArray(parsed)) {
                        for (const id of parsed) {
                            if (typeof id === 'string' && id.trim()) {
                                result.ids.add(id);
                            }
                        }
                    }
                } else if (row.key === 'cleanSlate.chat.deletedBefore') {
                    const value = Number(row.value);
                    if (Number.isFinite(value)) {
                        result.deletedBefore = value;
                    }
                }
            }
        } catch {
            // No tombstone store yet, or it is unreadable; import without deletion filtering.
        } finally {
            try {
                stateDb?.close();
            } catch {
                // Best-effort close of a read-only handle.
            }
        }
        return result;
    }

    /** Removes rows for explicitly tombstoned session ids so deletions are honored in the shared store. */
    private async purgeDeletedSessions(db: SQLiteDatabase, deletedIds: ReadonlySet<string>): Promise<number> {
        if (deletedIds.size === 0) {
            return 0;
        }
        let purged = 0;
        for (const id of deletedIds) {
            const existing = await this.get<{ id: string }>(db, `SELECT id FROM ThreadSessions WHERE id = ?`, [id]);
            if (!existing) {
                continue;
            }
            await this.run(db, 'BEGIN IMMEDIATE');
            try {
                await this.run(db, `DELETE FROM ThreadMessages WHERE sessionId = ?`, [id]);
                await this.run(db, `DELETE FROM ThreadSessions WHERE id = ?`, [id]);
                await this.run(db, 'COMMIT');
                purged++;
            } catch (error) {
                await this.rollback(db);
                this.logService.warn(`CleanSlate thread persistence could not purge deleted session ${id}: ${String(error)}`);
            }
        }
        return purged;
    }

    private isSessionDeleted(session: ICleanSlatePersistedSession, deletion: { ids: Set<string>; deletedBefore: number }): boolean {
        if (typeof session?.id === 'string' && deletion.ids.has(session.id)) {
            return true;
        }
        if (deletion.deletedBefore <= 0) {
            return false;
        }
        const sessionTime = Number.isFinite(session?.updatedAt) ? session.updatedAt
            : (Number.isFinite(session?.savedAt) ? session.savedAt : undefined);
        return typeof sessionTime === 'number' && sessionTime <= deletion.deletedBefore;
    }

    private async importWorkspaceStorageSession(
        db: SQLiteDatabase,
        session: ICleanSlatePersistedSession,
        fallbackRoot: string | undefined
    ): Promise<boolean> {
        try {
            if (!session
                || typeof session.id !== 'string' || !session.id.trim()
                || typeof session.title !== 'string' || !session.title.trim()
                || !Array.isArray(session.history)
            ) {
                return false;
            }
            const hasWorkspaceIdentity = !!(session.projectRoot?.trim() || session.workDir?.trim() || session.workspaceId?.trim() || session.workspaceName?.trim());
            const enriched: ICleanSlatePersistedSession = hasWorkspaceIdentity || !fallbackRoot
                ? session
                : { ...session, projectRoot: fallbackRoot, workspaceName: this.getPathLabel(fallbackRoot) };
            const workspaceId = resolveArchivedSessionWorkspaceId(enriched);
            const incomingUpdatedAt = (Number.isFinite(enriched.updatedAt) ? enriched.updatedAt : undefined)
                ?? (Number.isFinite(enriched.savedAt) ? enriched.savedAt : undefined)
                ?? 0;
            const existing = await this.get<Pick<IThreadSessionRow, 'updatedAt' | 'isActive' | 'transcript'> & { messageCount: number }>(
                db,
                `SELECT s.updatedAt, s.isActive, s.transcript,
                        (SELECT count(*) FROM ThreadMessages m WHERE m.sessionId = s.id) AS messageCount
                 FROM ThreadSessions s WHERE s.id = ?`,
                [enriched.id]
            );
            if (existing && !this.shouldReplaceExistingSession(existing, enriched, incomingUpdatedAt)) {
                return false;
            }
            await this.writeSession(db, workspaceId, {
                ...enriched,
                status: enriched.status === 'running' || enriched.status === 'starting' || enriched.status === 'stopping' ? 'detached' : enriched.status,
                isGenerating: undefined
            }, {
                isActive: existing?.isActive === 1,
                isArchived: true
            });
            return true;
        } catch (error) {
            this.logService.warn(`CleanSlate thread persistence skipped an unreadable workspace storage session: ${String(error)}`);
            return false;
        }
    }

    /**
     * The same chat can diverge between the shared store and a project's workspace storage when it
     * was live in two windows (e.g. edited in the IDE while opened read-only in the Agent Manager),
     * and the shorter copy can carry the newer timestamp. Timestamp alone would keep that truncated
     * copy, so prefer whichever copy has more rendered conversation, and only fall back to recency
     * when they are comparably rich.
     */
    private shouldReplaceExistingSession(
        existing: { updatedAt: number; transcript: string | null; messageCount: number },
        incoming: ICleanSlatePersistedSession,
        incomingUpdatedAt: number
    ): boolean {
        const existingRichness = this.getPersistedRowRichness(existing);
        const incomingRichness = this.getSnapshotRichness(incoming);
        if (incomingRichness > existingRichness) {
            return true;
        }
        if (incomingRichness < existingRichness) {
            return false;
        }
        return incomingUpdatedAt > existing.updatedAt;
    }

    private getPersistedRowRichness(row: { transcript: string | null; messageCount: number }): number {
        const transcript = this.fromJson(row.transcript);
        if (Array.isArray(transcript)) {
            return this.getMessagesRichness(transcript as ICleanSlatePersistedThreadMessage[]);
        }
        return row.messageCount;
    }

    private getSnapshotRichness(session: ICleanSlatePersistedSession): number {
        const transcript = Array.isArray(session.transcript) && session.transcript.length > 0
            ? session.transcript
            : session.history;
        return this.getMessagesRichness(Array.isArray(transcript) ? transcript : []);
    }

    /** Approximates how much rendered conversation a message list carries (payload/content volume of visible turns). */
    private getMessagesRichness(messages: readonly ICleanSlatePersistedThreadMessage[]): number {
        let richness = 0;
        for (const message of messages) {
            if (!message || message.isInternalState) {
                continue;
            }
            const payloadLength = typeof message.renderPayload === 'string' ? message.renderPayload.trim().length : 0;
            const contentLength = typeof message.content === 'string' ? message.content.trim().length : 0;
            richness += Math.max(payloadLength, contentLength);
        }
        return richness;
    }

    private async readWorkspaceStorageSessions(stateDbPath: string): Promise<ICleanSlatePersistedSession[]> {
        let stateDb: SQLiteDatabase | undefined;
        try {
            const sqlite3 = await import('@vscode/sqlite3');
            stateDb = await new Promise<SQLiteDatabase>((resolve, reject) => {
                const database = new sqlite3.default.Database(stateDbPath, sqlite3.default.OPEN_READONLY, (error: any) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve(database);
                });
            });
            const row = await this.get<{ value: string }>(stateDb, `SELECT value FROM ItemTable WHERE key = 'cleanSlate.chat.archivedSessions'`);
            if (!row?.value) {
                return [];
            }
            const parsed = JSON.parse(row.value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            // Workspace storage may be missing, locked, or unreadable; skip it.
            return [];
        } finally {
            try {
                stateDb?.close();
            } catch {
                // Best-effort close of a read-only handle.
            }
        }
    }

    private async readWorkspaceFolderUri(workspaceJsonPath: string): Promise<string | undefined> {
        try {
            const parsed = JSON.parse(await fs.readFile(workspaceJsonPath, 'utf8'));
            const folder = (parsed as { folder?: unknown })?.folder;
            return typeof folder === 'string' && folder.trim() ? folder : undefined;
        } catch {
            return undefined;
        }
    }

    private getPathLabel(value: string): string | undefined {
        try {
            const path = decodeURIComponent(new URL(value).pathname);
            return path.split('/').filter(Boolean).at(-1);
        } catch {
            return value.replace(/[/\\]+$/, '').split(/[\\/]/).filter(Boolean).at(-1);
        }
    }

    private async hydrateSession(db: SQLiteDatabase, row: IThreadSessionRow): Promise<ICleanSlatePersistedSession | undefined> {
        const executionState = normalizeCleanSlateExecutionState({
            planMode: row.planMode === 1,
            reasoningLevel: row.reasoningLevel
        });

        const messages = await this.all<IThreadMessageRow>(
            db,
            `SELECT role, content, isInternalState, renderPayload FROM ThreadMessages WHERE sessionId = ? ORDER BY sequence ASC`,
            [row.id]
        );

        return {
            id: row.id,
            parentSessionId: row.parentSessionId ?? undefined,
            createdAt: row.createdAt ?? row.savedAt,
            title: row.title,
            savedAt: row.savedAt,
            updatedAt: row.updatedAt,
            workspaceId: row.workspaceId,
            projectRoot: row.projectRoot ?? undefined,
            workDir: row.workDir ?? undefined,
            status: this.normalizeSessionState(row.status),
            sessionKey: row.sessionKey ?? row.id,
            workspaceName: row.workspaceName ?? undefined,
            planMode: executionState.planMode,
            reasoningLevel: executionState.reasoningLevel,
            history: messages.map(message => ({
                role: message.role,
                content: message.content,
                isInternalState: message.isInternalState === 1 ? true : undefined,
                renderPayload: message.renderPayload ?? undefined
            })),
            transcript: this.fromJson(row.transcript) as ICleanSlatePersistedSession['transcript'],
            transcriptVersion: typeof row.transcriptVersion === 'number' ? row.transcriptVersion : undefined,
            taskState: this.fromJson(row.taskState),
            threadState: this.fromJson(row.threadState),
            agent: this.fromJson(row.agent)
        };
    }

    private summarizeSession(row: IThreadSessionRow): ICleanSlatePersistedSession {
        const executionState = normalizeCleanSlateExecutionState({
            planMode: row.planMode === 1,
            reasoningLevel: row.reasoningLevel
        });
        const title = row.title?.trim() || 'Untitled chat';
        return {
            id: row.id,
            parentSessionId: row.parentSessionId ?? undefined,
            createdAt: row.createdAt ?? row.savedAt,
            title,
            savedAt: row.savedAt,
            updatedAt: row.updatedAt,
            workspaceId: row.workspaceId,
            projectRoot: row.projectRoot ?? undefined,
            workDir: row.workDir ?? undefined,
            status: this.normalizeSessionState(row.status),
            sessionKey: row.sessionKey ?? row.id,
            workspaceName: row.workspaceName ?? undefined,
            planMode: executionState.planMode,
            reasoningLevel: executionState.reasoningLevel,
            history: [{
                role: 'user',
                content: title
            }],
            transcript: undefined,
            transcriptVersion: typeof row.transcriptVersion === 'number' ? row.transcriptVersion : undefined,
            taskState: undefined,
            threadState: undefined,
            agent: undefined
        };
    }

    private normalizeSession(session: ICleanSlatePersistedSession): ICleanSlatePersistedSession {
        const executionState = normalizeCleanSlateExecutionState(session);
        const savedAt = Number.isFinite(session.savedAt) ? session.savedAt : Date.now();
        const updatedAt = Number.isFinite(session.updatedAt) ? session.updatedAt : Date.now();

        return {
            id: this.nonEmptyString(session.id, 'session id'),
            parentSessionId: typeof session.parentSessionId === 'string' && session.parentSessionId.trim().length > 0 ? session.parentSessionId : undefined,
            createdAt: Number.isFinite(session.createdAt) ? session.createdAt : savedAt,
            title: this.nonEmptyString(session.title, 'session title'),
            savedAt,
            updatedAt,
            workspaceId: typeof session.workspaceId === 'string' ? session.workspaceId : undefined,
            projectRoot: typeof session.projectRoot === 'string' ? session.projectRoot : undefined,
            workDir: typeof session.workDir === 'string' ? session.workDir : undefined,
            status: this.normalizeSessionState(session.status),
            sessionKey: typeof session.sessionKey === 'string' && session.sessionKey.trim().length > 0 ? session.sessionKey : session.id,
            workspaceName: typeof session.workspaceName === 'string' ? session.workspaceName : undefined,
            planMode: executionState.planMode,
            reasoningLevel: executionState.reasoningLevel,
            history: Array.isArray(session.history) ? session.history.map(message => this.normalizeMessage(message)) : [],
            transcript: Array.isArray(session.transcript) ? session.transcript.map(message => this.normalizeMessage(message)) : undefined,
            transcriptVersion: Number.isFinite(session.transcriptVersion) ? session.transcriptVersion : undefined,
            taskState: session.taskState,
            threadState: session.threadState,
            agent: session.agent
        };
    }

    private normalizeMessage(message: ICleanSlatePersistedThreadMessage): ICleanSlatePersistedThreadMessage {
        return {
            role: typeof message.role === 'string' ? message.role : 'system',
            content: typeof message.content === 'string' ? message.content : '',
            isInternalState: message.isInternalState === true ? true : undefined,
            renderPayload: typeof message.renderPayload === 'string' ? message.renderPayload : undefined,
            images: Array.isArray(message.images) ? message.images.filter((image): image is string => typeof image === 'string') : undefined,
            id: typeof message.id === 'string' ? message.id : undefined
        };
    }

    private normalizeSessionState(value: unknown): ICleanSlatePersistedSession['status'] {
        return value === 'starting'
            || value === 'running'
            || value === 'detached'
            || value === 'stopping'
            || value === 'stopped'
            ? value
            : undefined;
    }

    private isNoProjectWorkspaceId(workspaceId: string): boolean {
        const normalized = workspaceId.trim().toLowerCase();
        return normalized === 'no-project' || normalized === 'no project';
    }

    private nonEmptyString(value: unknown, label: string): string {
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new Error(`Invalid CleanSlate ${label}.`);
        }
        return value;
    }

    private async pruneArchivedSessions(db: SQLiteDatabase, workspaceId: string): Promise<void> {
        const staleRows = await this.all<{ id: string; isActive: number }>(
            db,
            `SELECT id, isActive FROM ThreadSessions
             WHERE workspaceId = ? AND isArchived = 1
             ORDER BY savedAt DESC
             LIMIT -1 OFFSET 50`,
            [workspaceId]
        );

        for (const row of staleRows) {
            if (row.isActive === 1) {
                await this.run(db, `UPDATE ThreadSessions SET isArchived = 0, updatedAt = ? WHERE id = ? AND workspaceId = ?`, [Date.now(), row.id, workspaceId]);
            } else {
                await this.run(db, `DELETE FROM ThreadMessages WHERE sessionId = ?`, [row.id]);
                await this.run(db, `DELETE FROM ThreadSessions WHERE id = ? AND workspaceId = ?`, [row.id, workspaceId]);
            }
        }
    }

    private toJson(value: unknown): string | null {
        if (value === undefined) {
            return null;
        }
        try {
            return JSON.stringify(value);
        } catch {
            return null;
        }
    }

    private fromJson(value: string | null): unknown {
        if (!value) {
            return undefined;
        }
        try {
            return JSON.parse(value);
        } catch {
            return undefined;
        }
    }

    private run(db: SQLiteDatabase, sql: string, params: readonly unknown[] = []): Promise<void> {
        return this.withSQLiteBusyRetry(() => new Promise((resolve, reject) => {
            db.run(sql, params, (error: any) => error ? reject(error) : resolve());
        }));
    }

    private get<T>(db: SQLiteDatabase, sql: string, params: readonly unknown[] = []): Promise<T | undefined> {
        return this.withSQLiteBusyRetry(() => new Promise((resolve, reject) => {
            db.get(sql, params, (error: any, row: T | undefined) => error ? reject(error) : resolve(row));
        }));
    }

    private all<T>(db: SQLiteDatabase, sql: string, params: readonly unknown[] = []): Promise<T[]> {
        return this.withSQLiteBusyRetry(() => new Promise((resolve, reject) => {
            db.all(sql, params, (error: any, rows: T[]) => error ? reject(error) : resolve(rows ?? []));
        }));
    }

    private async rollback(db: SQLiteDatabase): Promise<void> {
        try {
            await this.run(db, 'ROLLBACK');
        } catch {
        }
    }

    private async withSQLiteBusyRetry<T>(operation: () => Promise<T>): Promise<T> {
        let lastError: unknown;
        for (let attempt = 0; attempt <= CleanSlateThreadPersistenceStore.SQLITE_BUSY_RETRY_COUNT; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                if (!this.isSQLiteBusyError(error) || attempt === CleanSlateThreadPersistenceStore.SQLITE_BUSY_RETRY_COUNT) {
                    throw error;
                }
                await this.delay(40 * Math.pow(2, attempt) + Math.random() * 25);
            }
        }

        throw lastError;
    }

    private isSQLiteBusyError(error: unknown): boolean {
        const code = typeof (error as any)?.code === 'string' ? (error as any).code : '';
        const message = String((error as any)?.message ?? error).toLowerCase();
        return code === 'SQLITE_BUSY' || message.includes('sqlite_busy') || message.includes('database is locked');
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
