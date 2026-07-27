/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { ICleanSlateVectorStore, IVectorEntry, IVectorSearchResult } from '../../common/core/cleanSlateAI.js';

export class NodeCleanSlateVectorStore implements ICleanSlateVectorStore {
    _serviceBrand: undefined;
    private static readonly SQLITE_BUSY_TIMEOUT_MS = 10_000;
    private static readonly DEFAULT_PROFILE = 'legacy';

    private readonly dbPath: string;
    private dbPromise: Promise<any> | undefined;

    constructor(
        @IEnvironmentService private readonly environmentService: IEnvironmentService,
        @ILogService private readonly logService: ILogService
    ) {
        this.dbPath = joinPath(this.environmentService.userRoamingDataHome, 'cleanSlate.vector.v1.db').fsPath;
    }

    private async getDb(): Promise<any> {
        if (!this.dbPromise) {
            this.dbPromise = this.initDb();
        }
        return this.dbPromise;
    }

    private async initDb(): Promise<any> {
        try {
            const sqlite3 = await import('@vscode/sqlite3');
            return new Promise((resolve, reject) => {
                const db = new sqlite3.default.Database(this.dbPath, (err: any) => {
                    if (err) {
                        this.logService.error(`Failed to open SQLite database: ${err}`);
                        return reject(err);
                    }

                    if (typeof db.configure === 'function') {
                        db.configure('busyTimeout', NodeCleanSlateVectorStore.SQLITE_BUSY_TIMEOUT_MS);
                    }
                    db.serialize(() => {
                        db.run(`PRAGMA busy_timeout = ${NodeCleanSlateVectorStore.SQLITE_BUSY_TIMEOUT_MS}`);
                        db.run(`PRAGMA journal_mode = WAL`);
                        db.run(`PRAGMA synchronous = NORMAL`);
                        db.run(`CREATE TABLE IF NOT EXISTS FileHashes (uri TEXT PRIMARY KEY, hash TEXT, profile TEXT DEFAULT '${NodeCleanSlateVectorStore.DEFAULT_PROFILE}')`);
                        db.run(`CREATE TABLE IF NOT EXISTS VectorEntries (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            uri TEXT,
                            content TEXT,
                            embedding BLOB,
                            profile TEXT DEFAULT '${NodeCleanSlateVectorStore.DEFAULT_PROFILE}',
                            metadata TEXT
                        )`);
                        db.run(`CREATE TABLE IF NOT EXISTS QueryCache (
                            query TEXT,
                            embedding BLOB,
                            timestamp INTEGER,
                            profile TEXT DEFAULT '${NodeCleanSlateVectorStore.DEFAULT_PROFILE}',
                            PRIMARY KEY(query, profile)
                        )`);
                        this.ensureColumn(db, 'FileHashes', 'profile', `TEXT DEFAULT '${NodeCleanSlateVectorStore.DEFAULT_PROFILE}'`, (err2?: any) => {
                            if (err2) return reject(err2);
                            this.ensureColumn(db, 'VectorEntries', 'profile', `TEXT DEFAULT '${NodeCleanSlateVectorStore.DEFAULT_PROFILE}'`, (err3?: any) => {
                                if (err3) return reject(err3);
                                this.ensureColumn(db, 'QueryCache', 'profile', `TEXT DEFAULT '${NodeCleanSlateVectorStore.DEFAULT_PROFILE}'`, (err4?: any) => {
                                    if (err4) return reject(err4);
                                    db.run(`CREATE INDEX IF NOT EXISTS idx_uri ON VectorEntries(uri)`);
                                    db.run(`CREATE INDEX IF NOT EXISTS idx_vector_profile ON VectorEntries(profile)`);
                                    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_hash_uri_profile ON FileHashes(uri, profile)`, (err5: any) => {
                                        if (err5) reject(err5);
                                        else {
                                            this.logService.info(`SQLite Vector Store initialized at ${this.dbPath}`);
                                            resolve(db);
                                        }
                                    });
                                });
                            });
                        });
                    });
                });
            });
        } catch (e) {
            this.logService.error(`SQLite is not available in this environment: ${e}`);
            throw e;
        }
    }

    private ensureColumn(db: any, table: string, column: string, definition: string, callback?: (err?: any) => void): void {
        db.all(`PRAGMA table_info(${table})`, (err: any, rows: any[]) => {
            if (err) {
                callback?.(err);
                return;
            }
            if (rows.some(row => row.name === column)) {
                callback?.();
                return;
            }
            db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, callback);
        });
    }

    async save(entries: IVectorEntry[]): Promise<void> {
        if (entries.length === 0) return;

        const entriesByUri = new Map<string, IVectorEntry[]>();
        for (const entry of entries) {
            const bucket = entriesByUri.get(entry.uri);
            if (bucket) {
                bucket.push(entry);
            } else {
                entriesByUri.set(entry.uri, [entry]);
            }
        }

        const db = await this.getDb();
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                const stmt = db.prepare('INSERT INTO VectorEntries (uri, content, embedding, profile, metadata) VALUES (?, ?, ?, ?, ?)');

                for (const [uri, uriEntries] of entriesByUri) {
                    const profile = uriEntries[0]?.profile || NodeCleanSlateVectorStore.DEFAULT_PROFILE;
                    db.run('DELETE FROM VectorEntries WHERE uri = ? AND profile = ?', [uri, profile]);
                    for (const entry of uriEntries) {
                        // Convert float array to BLOB
                        const embeddingBlob = new Uint8Array(new Float32Array(entry.embedding).buffer);
                        stmt.run([entry.uri, entry.content, embeddingBlob, entry.profile || profile, JSON.stringify(entry.metadata)]);
                    }

                    const hash = uriEntries[0]?.hash;
                    if (hash) {
                        db.run('INSERT OR REPLACE INTO FileHashes (uri, hash, profile) VALUES (?, ?, ?)', [this.profileKey(uri, profile), hash, profile]);
                    }
                }

                stmt.finalize();
                db.run('COMMIT', (err: any) => {
                    if (err) {
                        this.logService.error(`Failed to save entries to SQLite: ${err}`);
                        reject(err);
                    } else {
                        this.logService.info(`Saved ${entries.length} entries to SQLite across ${entriesByUri.size} file(s).`);
                        resolve();
                    }
                });
            });
        });
    }

    async load(): Promise<IVectorEntry[]> {
        const db = await this.getDb();
        return new Promise((resolve, reject) => {
            db.all('SELECT uri, content, embedding, metadata FROM VectorEntries', (err: any, rows: any[]) => {
                if (err) {
                    this.logService.error(`Failed to load entries from SQLite: ${err}`);
                    return reject(err);
                }

                const results = rows.map((row: any) => ({
                    uri: row.uri,
                    content: row.content,
                    embedding: Array.from(new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4)),
                    metadata: JSON.parse(row.metadata)
                }));
                resolve(results);
            });
        });
    }

    async search(queryEmbedding: number[], limit?: number, threshold: number = 0.65, profile: string = NodeCleanSlateVectorStore.DEFAULT_PROFILE): Promise<IVectorSearchResult[]> {
        const db = await this.getDb();
        const maxResults = limit && limit > 0 ? limit : 200;
        const results: IVectorSearchResult[] = [];

        return new Promise((resolve, reject) => {
            db.each(
                'SELECT uri, content, embedding, metadata FROM VectorEntries WHERE profile = ?',
                [profile],
                (err: any, row: any) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    const embedding = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
                    const score = this.fastCosineSimilarity(queryEmbedding, embedding);
                    if (score < threshold) {
                        return;
                    }

                    results.push({
                        uri: row.uri,
                        content: row.content,
                        score,
                        metadata: this.parseMetadata(row.metadata)
                    });
                    results.sort((a, b) => b.score - a.score);
                    if (results.length > maxResults) {
                        results.length = maxResults;
                    }
                },
                (err: any) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(results);
                }
            );
        });
    }

    async getHash(uri: string, profile: string = NodeCleanSlateVectorStore.DEFAULT_PROFILE): Promise<string | undefined> {
        try {
            const db = await this.getDb();
            return new Promise((resolve, reject) => {
                db.get('SELECT hash FROM FileHashes WHERE uri = ?', [this.profileKey(uri, profile)], (err: any, row: any) => {
                    if (err) return reject(err);
                    resolve(row?.hash);
                });
            });
        } catch (e) {
            return undefined;
        }
    }

    async deleteByUri(uri: string, profile: string = NodeCleanSlateVectorStore.DEFAULT_PROFILE): Promise<void> {
        const db = await this.getDb();
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run('DELETE FROM VectorEntries WHERE uri = ? AND profile = ?', [uri, profile]);
                db.run('DELETE FROM FileHashes WHERE uri = ?', [this.profileKey(uri, profile)], (err: any) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });
    }

    async getQueryEmbedding(query: string, profile: string = NodeCleanSlateVectorStore.DEFAULT_PROFILE): Promise<number[] | undefined> {
        try {
            const db = await this.getDb();
            return new Promise((resolve, reject) => {
                db.get('SELECT embedding FROM QueryCache WHERE query = ?', [this.profileKey(query, profile)], (err: any, row: any) => {
                    if (err) return reject(err);
                    if (!row?.embedding) return resolve(undefined);
                    
                    const embedding = Array.from(new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4));
                    resolve(embedding);
                });
            });
        } catch (e) {
            return undefined;
        }
    }

    async saveQueryEmbedding(query: string, embedding: number[], profile: string = NodeCleanSlateVectorStore.DEFAULT_PROFILE): Promise<void> {
        try {
            const db = await this.getDb();
            const embeddingBlob = new Uint8Array(new Float32Array(embedding).buffer);
            return new Promise((resolve, reject) => {
                db.run('INSERT OR REPLACE INTO QueryCache (query, embedding, timestamp, profile) VALUES (?, ?, ?, ?)',
                    [this.profileKey(query, profile), embeddingBlob, Date.now(), profile], (err: any) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        } catch (e) {
            this.logService.error(`Failed to save query embedding to SQLite: ${e}`);
        }
    }

    private parseMetadata(value: unknown): any {
        if (typeof value !== 'string' || value.length === 0) {
            return undefined;
        }
        try {
            return JSON.parse(value);
        } catch {
            return undefined;
        }
    }

    private profileKey(value: string, profile: string): string {
        return `${profile}\u0000${value}`;
    }

    private fastCosineSimilarity(v1: number[], v2: Float32Array): number {
        let dotProduct = 0;
        let mag1 = 0;
        let mag2 = 0;
        const len = Math.min(v1.length, v2.length);
        for (let i = 0; i < len; i++) {
            const val1 = v1[i];
            const val2 = v2[i];
            dotProduct += val1 * val2;
            mag1 += val1 * val1;
            mag2 += val2 * val2;
        }
        if (mag1 === 0 || mag2 === 0) {
            return 0;
        }
        return dotProduct / (Math.sqrt(mag1) * Math.sqrt(mag2));
    }

    async clear(): Promise<void> {
        const db = await this.getDb();
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run('DELETE FROM VectorEntries');
                db.run('DELETE FROM FileHashes');
                db.run('DELETE FROM QueryCache', (err: any) => {
                    if (err) reject(err);
                    else {
                        this.logService.info('Vector store cleared.');
                        resolve();
                    }
                });
            });
        });
    }
}
