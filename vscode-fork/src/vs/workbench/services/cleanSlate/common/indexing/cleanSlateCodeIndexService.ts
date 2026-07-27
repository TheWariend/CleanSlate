/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICleanSlateIndexService, ISearchResult, ICleanSlateEmbeddingService, ICleanSlateVectorStore, ICleanSlateLogger, IVectorEntry, ICleanSlateConfigurationService } from '../core/cleanSlateAI.js';
import { CleanSlateCodeParser } from './cleanSlateCodeParser.js';
import { FileSystemProviderErrorCode, IFileService, toFileSystemProviderErrorCode } from '../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../../base/common/uri.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../base/common/event.js';

export class CleanSlateIndexService extends Disposable implements ICleanSlateIndexService {

    _serviceBrand: undefined;
    private _isIndexing: boolean = false; // Controls UI Blocking
    private _isQueueRunning: boolean = false; // Controls Background task
    private _fileQueue: URI[] = [];
    private readonly _queuedFileKeys = new Set<string>();
    private readonly _workspaceFiles = new Map<string, URI>();
    private _workspaceMapPromise: Promise<void> | undefined;
    private _workspaceMapped = false;

    private readonly _onDidStatusChange = this._register(new Emitter<boolean>());
    readonly onDidStatusChange: Event<boolean> = this._onDidStatusChange.event;

    get isIndexing(): boolean {
        return this._isIndexing;
    }

    private setIndexing(value: boolean) {
        if (this._isIndexing !== value) {
            this._isIndexing = value;
            this._onDidStatusChange.fire(value);
        }
    }

    constructor(
        @ICleanSlateEmbeddingService private readonly embeddingService: ICleanSlateEmbeddingService,
        @ICleanSlateVectorStore private readonly vectorStore: ICleanSlateVectorStore,
        @IFileService private readonly fileService: IFileService,
        @IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
        @ICleanSlateLogger private readonly logger: ICleanSlateLogger,
        @ICleanSlateConfigurationService private readonly configService: ICleanSlateConfigurationService
    ) {
        super();
        this.initialize();
    }

    private async initialize(): Promise<void> {
        // Background sync: listen for file changes
        this._register(this.fileService.onDidFilesChange(e => {
            for (const resource of e.rawAdded) {
                if (this.isSupportedFile(resource)) {
                    this._workspaceFiles.set(resource.toString(), resource);
                    this.queueFileForIndexing(resource);
                }
            }
            for (const resource of e.rawUpdated) {
                if (this.isSupportedFile(resource)) {
                    this._workspaceFiles.set(resource.toString(), resource);
                    this.queueFileForIndexing(resource);
                }
            }
            for (const resource of e.rawDeleted) {
                if (this.isSupportedFile(resource)) this.removeFile(resource);
            }
        }));

        this.logger.info('CleanSlate Vector Index Service initialized with lazy vector search.');
    }

    private isSupportedFile(uri: URI): boolean {
        if (uri.scheme !== 'file') return false;

        const path = uri.fsPath;
        if (path.includes('node_modules') ||
            path.includes('.git') ||
            path.includes('out') ||
            path.includes('build') ||
            path.includes('Library/Application Support') ||
            path.includes('.vscode-oss') ||
            path.includes('.vscode') ||
            path.includes('dist')) {
            return false;
        }

        const supportedExtensions = /\.(ts|js|py|dart|css|html|md|txt)$/;
        if (!supportedExtensions.test(path)) {
            if (path.endsWith('.json')) {
                return !path.includes('package-lock.json') &&
                    !path.includes('composer.lock') &&
                    !path.includes('schemas-associations.json');
            }
            return false;
        }

        return true;
    }

    async indexWorkspace(): Promise<void> {
        if (this.configService.getConfiguration().ragEnabled === false) {
            this.logger.info('Skipping workspace indexing because RAG is disabled.');
            return;
        }
        if (this._workspaceMapPromise) {
            return this._workspaceMapPromise;
        }
        if (this._workspaceMapped) {
            return;
        }
        this.setIndexing(true);
        this.logger.info('Starting workspace file map for lazy semantic indexing...');

        this._workspaceMapPromise = (async () => {
            try {
                this._workspaceFiles.clear();
                const folders = this.contextService.getWorkspace().folders;

                // Fast filesystem walk
                for (const folder of folders) {
                    await this.walkDirectory(folder.uri);
                }

                this._workspaceMapped = true;
                this.logger.info(`Workspace mapped. Found ${this._workspaceFiles.size} manageable files for lazy semantic indexing.`);
            } catch (e) {
                this.logger.error(`Error during background indexing initialization: ${e}`);
            } finally {
                this.setIndexing(false);
                this._workspaceMapPromise = undefined;
            }
        })();

        return this._workspaceMapPromise;
    }

    private async walkDirectory(uri: URI): Promise<void> {
        try {
            const stat = await this.fileService.resolve(uri);
            if (stat.children) {
                for (const child of stat.children) {
                    if (child.isDirectory) {
                        if (!['node_modules', '.git', 'out', 'build', '.vscode', 'dist'].includes(child.name)) {
                            await this.walkDirectory(child.resource);
                        }
                    } else if (this.isSupportedFile(child.resource)) {
                        this._workspaceFiles.set(child.resource.toString(), child.resource);
                    }
                }
            }
        } catch (e) {
            // Unreadable directory or restricted permissions, safely ignore
        }
    }

    private queueFileForIndexing(uri: URI): void {
        if (this.configService.getConfiguration().ragEnabled === false) {
            return;
        }
        const key = uri.toString();
        if (this._queuedFileKeys.has(key)) {
            return;
        }
        this._queuedFileKeys.add(key);
        this._fileQueue.push(uri);
        if (!this._isQueueRunning) {
            this.processQueue();
        }
    }

    private async processQueue(): Promise<void> {
        if (this._isQueueRunning) return;
        this._isQueueRunning = true;
        
        const config = this.configService.getConfiguration();
        if (config.ragEnabled === false) {
            this._fileQueue = [];
            this._isQueueRunning = false;
            this.logger.info('Skipping vector queue because RAG is disabled.');
            return;
        }
        let concurrency = 5;
        let sleepBetweenFiles = 0;
        
        // Dynamically adjust parallel workers based on embedding provider APIs
        // to gracefully avoid 429 Too Many Requests spam.
        switch (config.embeddingProvider) {
            case 'local':
                concurrency = 1;
                break;
            case 'openai': 
                concurrency = 5; // Safe default even for Tier 1 Rate Limits
                break;
            case 'azureOpenAI':
                concurrency = 1;
                sleepBetweenFiles = 150;
                break;
            case 'gemini': 
                concurrency = 1; 
                sleepBetweenFiles = 4000; // Gemini Free Limit: 15 Requests Per Minute (~1 per 4 seconds)
                break;
        }

        const runWorker = async () => {
             while (this._fileQueue.length > 0) {
                 const fileUri = this._fileQueue.shift();
                 if (!fileUri) return;
                 try {
                     await this.indexFileWithRetry(fileUri);
                 } finally {
                     this._queuedFileKeys.delete(fileUri.toString());
                 }
                 
                 if (sleepBetweenFiles > 0) {
                     await new Promise(r => setTimeout(r, sleepBetweenFiles));
                 }
             }
        };

        const workers = [];
        for (let i = 0; i < concurrency; i++) {
             workers.push(runWorker());
        }

        await Promise.all(workers);
        this._isQueueRunning = false;
        this.logger.info('Background vector processing complete.');
    }

    private async indexFileWithRetry(uri: URI, attempt = 1): Promise<void> {
        try {
            await this.indexFile(uri);
        } catch (e: any) {
            if (toFileSystemProviderErrorCode(e) === FileSystemProviderErrorCode.FileNotFound) {
                this.removeFile(uri);
                this.logger.debug(`Skipping missing file during background indexing: ${uri.fsPath}`);
                return;
            }

            const errorMsg = e.message || String(e);
            if (errorMsg.includes('429') && attempt <= 5) { // Handle aggressive API limits via exponential backoff
                 const backoffDelay = Math.pow(2, attempt) * 1000 + (Math.random() * 1000); // Add jitter
                 this.logger.warn(`Rate limit (429) hit processing ${uri.fsPath}. Retrying in ${Math.round(backoffDelay)}ms (Attempt ${attempt}/5)...`);
                 await new Promise(r => setTimeout(r, backoffDelay));
                 return this.indexFileWithRetry(uri, attempt + 1);
            }
            this.logger.error(`Failed to generate embeddings for ${uri.fsPath}: ${e}`);
        }
    }

    private async indexFile(uri: URI): Promise<void> {
        // Safe-guard out-of-memory issues for gigantic monolithic files
        const stat = await this.fileService.resolve(uri);
        if (stat.size !== undefined && stat.size > 200 * 1024) {
            this.logger.debug(`Skipping file size boundary logic: ${uri.fsPath} (${Math.round(stat.size / 1024)}KB)`);
            return;
        }

        const content = await this.fileService.readFile(uri);
        const text = content.value.toString();

        const { hashAsync } = await import('../../../../../base/common/hash.js');
        const currentHash = await hashAsync(text);
        const profile = await this.embeddingService.getEmbeddingProfile();
        const existingHash = await this.vectorStore.getHash(uri.toString(), profile);

        if (existingHash === currentHash) {
            return; // Cache hit, bypass embedding call
        }

        this.logger.debug(`Generating semantic chunks for: ${uri.fsPath}`);

        await this.vectorStore.deleteByUri(uri.toString(), profile);

        const semanticChunks = CleanSlateCodeParser.parse(text, '');
        if (semanticChunks.length === 0) return;

        const chunkTexts = semanticChunks.map(c => c.content);
        const embeddings = await this.embeddingService.getEmbeddings(chunkTexts);

        const entries: IVectorEntry[] = [];
        for (let i = 0; i < semanticChunks.length; i++) {
            const chunk = semanticChunks[i];
            const embedding = embeddings[i];
            const entry: IVectorEntry = {
                uri: uri.toString(),
                content: chunk.content,
                embedding,
                hash: currentHash,
                profile,
                metadata: {
                    startLine: chunk.startLine,
                    endLine: chunk.endLine, // metadata fixes
                    type: chunk.type,
                    name: chunk.name
                }
            };
            entries.push(entry);
        }

        await this.vectorStore.save(entries);
    }

    private removeFile(uri: URI): void {
        const uriStr = uri.toString();
        this._workspaceFiles.delete(uriStr);
        this._queuedFileKeys.delete(uriStr);
    }

    async search(query: string, limit?: number, threshold: number = 0.65): Promise<ISearchResult[]> {
        if (this.configService.getConfiguration().ragEnabled === false) {
            return [];
        }
        this.logger.info(`Calculating semantic vector similarities for: "${query}"`);
        await this.indexWorkspace();
        const requestedLimit = limit ?? 8;
        const profile = await this.embeddingService.getEmbeddingProfile();

        const queryEmbedding = await this.embeddingService.getEmbedding(query);
        let results = await this.vectorStore.search(queryEmbedding, requestedLimit, threshold, profile);

        if (results.length < requestedLimit) {
            const candidates = await this.selectCandidateFilesForQuery(query, Math.max(24, requestedLimit * 4), profile);
            if (candidates.length > 0) {
                await this.indexCandidateFiles(candidates);
                results = await this.vectorStore.search(queryEmbedding, requestedLimit, threshold, profile);
            }
        }

        this.logger.debug(`Found ${results.length} lazy vector results above threshold ${threshold}.`);
        return results.map(entry => ({
            uri: URI.parse(entry.uri),
            content: entry.content,
            score: entry.score,
            range: entry.metadata ? { startLineNumber: entry.metadata.startLine, endLineNumber: entry.metadata.endLine } : undefined
        }));
    }

    private async selectCandidateFilesForQuery(query: string, limit: number, profile: string): Promise<URI[]> {
        const terms = this.extractQueryTerms(query);
        if (terms.length === 0) {
            return Array.from(this._workspaceFiles.values()).slice(0, limit);
        }

        const scored: { uri: URI; score: number }[] = [];
        for (const uri of this._workspaceFiles.values()) {
            const score = this.scoreFileForQuery(uri, terms);
            if (score <= 0) {
                continue;
            }
            if (await this.isCurrentForProfile(uri, profile)) {
                continue;
            }
            scored.push({ uri, score });
        }

        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, limit).map(item => item.uri);
    }

    private extractQueryTerms(query: string): string[] {
        const seen = new Set<string>();
        const terms: string[] = [];
        for (const raw of query.toLowerCase().split(/[^a-z0-9_.$/-]+/)) {
            const term = raw.trim();
            if (term.length < 2 || seen.has(term)) {
                continue;
            }
            seen.add(term);
            terms.push(term);
        }
        return terms.slice(0, 12);
    }

    private scoreFileForQuery(uri: URI, terms: string[]): number {
        const path = uri.fsPath.toLowerCase();
        const segments = path.split(/[\\/]/);
        const fileName = segments[segments.length - 1] ?? path;
        let score = 0;

        for (const term of terms) {
            if (fileName.includes(term)) {
                score += 6;
            }
            if (path.includes(term)) {
                score += 2;
            }
        }

        if (/(test|spec)\.(ts|js|py|dart)$/.test(fileName)) {
            score *= 0.85;
        }

        return score;
    }

    private async isCurrentForProfile(uri: URI, profile: string): Promise<boolean> {
        try {
            const content = await this.fileService.readFile(uri);
            const text = content.value.toString();
            const { hashAsync } = await import('../../../../../base/common/hash.js');
            const currentHash = await hashAsync(text);
            const existingHash = await this.vectorStore.getHash(uri.toString(), profile);
            return existingHash === currentHash;
        } catch {
            return false;
        }
    }

    private async indexCandidateFiles(files: URI[]): Promise<void> {
        const config = this.configService.getConfiguration();
        const concurrency = config.embeddingProvider === 'openai' ? 3 : 1;
        let cursor = 0;

        const runWorker = async () => {
            while (cursor < files.length) {
                const uri = files[cursor++];
                if (uri) {
                    await this.indexFileWithRetry(uri);
                }
            }
        };

        const workers: Promise<void>[] = [];
        for (let i = 0; i < Math.min(concurrency, files.length); i++) {
            workers.push(runWorker());
        }
        await Promise.all(workers);
    }
}
