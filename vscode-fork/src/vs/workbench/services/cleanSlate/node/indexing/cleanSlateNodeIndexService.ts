/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { URI } from '../../../../../base/common/uri.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IRequestOptions } from '../../../../../base/parts/request/common/request.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { CleanSlateCodeParser } from '../../common/indexing/cleanSlateCodeParser.js';
import { ICleanSlateConfiguration, ICleanSlateIndexService, ICleanSlateMainService, ICleanSlateVectorStore, ISearchResult, IVectorEntry } from '../../common/core/cleanSlateAI.js';

export interface ICleanSlateNodeIndexOptions {
	workspaceFolders: string[];
	config: ICleanSlateConfiguration;
}

export class NodeCleanSlateIndexService extends Disposable implements ICleanSlateIndexService {

	declare readonly _serviceBrand: undefined;
	private static readonly LOCAL_EMBEDDING_MODEL = 'Xenova/bge-small-en-v1.5';
	private static readonly MAX_FILE_SIZE_BYTES = 200 * 1024;

	private readonly _onDidStatusChange = this._register(new Emitter<boolean>());
	readonly onDidStatusChange: Event<boolean> = this._onDidStatusChange.event;

	private _isIndexing = false;
	private _workspaceFiles = new Map<string, URI>();
	private _workspaceMapped = false;
	private _workspaceMapPromise: Promise<void> | undefined;
	private _workspaceScopeKey: string | undefined;
	private _workspaceMapPromiseScopeKey: string | undefined;
	private lastOptions: ICleanSlateNodeIndexOptions | undefined;

	constructor(
		@ICleanSlateVectorStore private readonly vectorStore: ICleanSlateVectorStore,
		@ICleanSlateMainService private readonly cleanSlateMainService: ICleanSlateMainService,
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	get isIndexing(): boolean {
		return this._isIndexing;
	}

	async indexWorkspace(): Promise<void> {
		if (!this.lastOptions) {
			this.logService.warn('CleanSlate node index requested without workspace/config options.');
			return;
		}
		return this.indexWorkspaceWithOptions(this.lastOptions);
	}

	async search(query: string, limit?: number, threshold?: number): Promise<ISearchResult[]> {
		if (!this.lastOptions) {
			this.logService.warn('CleanSlate node search requested without workspace/config options.');
			return [];
		}
		return this.searchWithOptions({ ...this.lastOptions, query, limit, threshold });
	}

	async indexWorkspaceWithOptions(options: ICleanSlateNodeIndexOptions): Promise<void> {
		this.lastOptions = options;
		if (options.config.ragEnabled === false) {
			this.logService.info('Skipping workspace indexing because RAG is disabled.');
			return;
		}
		const workspaceFolders = this.resolveWorkspaceFolders(options.workspaceFolders || []);
		const workspaceScopeKey = this.getWorkspaceScopeKey(workspaceFolders);
		if (this._workspaceMapPromise && this._workspaceMapPromiseScopeKey === workspaceScopeKey) {
			return this._workspaceMapPromise;
		}
		if (this._workspaceMapPromise) {
			await this._workspaceMapPromise;
		}
		if (this._workspaceMapped && this._workspaceScopeKey === workspaceScopeKey) {
			return;
		}

		this.setIndexing(true);
		this.logService.info(`Starting node workspace file map for lazy semantic indexing (${workspaceFolders.length} folder(s), scope ${workspaceScopeKey}).`);
		this._workspaceMapPromiseScopeKey = workspaceScopeKey;
		this._workspaceMapPromise = (async () => {
			try {
				this._workspaceFiles.clear();
				for (const folder of workspaceFolders) {
					await this.walkDirectory(folder);
				}
				this._workspaceMapped = true;
				this._workspaceScopeKey = workspaceScopeKey;
				this.logService.info(`Workspace mapped in node indexer. Found ${this._workspaceFiles.size} manageable files for scope ${workspaceScopeKey}.`);
			} catch (error) {
				this._workspaceMapped = false;
				this.logService.error(`Error during node indexing initialization: ${error}`);
			} finally {
				this.setIndexing(false);
				this._workspaceMapPromise = undefined;
				this._workspaceMapPromiseScopeKey = undefined;
			}
		})();
		return this._workspaceMapPromise;
	}

	async searchWithOptions(options: ICleanSlateNodeIndexOptions & { query: string; limit?: number; threshold?: number }): Promise<ISearchResult[]> {
		this.lastOptions = options;
		if (options.config.ragEnabled === false) {
			return [];
		}

		await this.indexWorkspaceWithOptions(options);
		const requestedLimit = options.limit ?? 8;
		const threshold = options.threshold ?? 0.65;
		const workspaceScopeKey = this._workspaceScopeKey ?? this.getWorkspaceScopeKey(this.resolveWorkspaceFolders(options.workspaceFolders || []));
		const profile = this.getWorkspaceEmbeddingProfile(this.getEmbeddingProfile(options.config), workspaceScopeKey);
		const queryEmbedding = await this.getEmbedding(options.query, options.config, profile);
		let results = await this.vectorStore.search(queryEmbedding, requestedLimit, threshold, profile);

		if (results.length < requestedLimit) {
			const candidates = await this.selectCandidateFilesForQuery(options.query, Math.max(24, requestedLimit * 4), profile);
			if (candidates.length > 0) {
				await this.indexCandidateFiles(candidates, options.config, profile);
				results = await this.vectorStore.search(queryEmbedding, requestedLimit, threshold, profile);
			}
		}

		this.logService.debug(`CleanSlate node index found ${results.length} lazy vector results above threshold ${threshold}.`);
		return results.map(entry => ({
			uri: URI.parse(entry.uri),
			content: entry.content,
			score: entry.score,
			range: entry.metadata ? { startLineNumber: entry.metadata.startLine, endLineNumber: entry.metadata.endLine } : undefined
		}));
	}

	private setIndexing(value: boolean): void {
		if (this._isIndexing !== value) {
			this._isIndexing = value;
			this._onDidStatusChange.fire(value);
		}
	}

	private async walkDirectory(uri: URI): Promise<void> {
		if (!this.isSupportedFolder(uri.fsPath)) {
			return;
		}
		let entries: fs.Dirent[];
		try {
			entries = await fs.promises.readdir(uri.fsPath, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			const childPath = path.join(uri.fsPath, entry.name);
			if (entry.isDirectory()) {
				if (this.isSupportedFolder(childPath)) {
					await this.walkDirectory(URI.file(childPath));
				}
			} else if (entry.isFile()) {
				const childUri = URI.file(childPath);
				if (this.isSupportedFile(childUri)) {
					this._workspaceFiles.set(childUri.toString(), childUri);
				}
			}
		}
	}

	private resolveWorkspaceFolders(workspaceFolders: string[] = []): URI[] {
		const folders = workspaceFolders
			.map(folder => this.parseWorkspaceFolder(folder))
			.filter((folder): folder is URI => !!folder);
		if (folders.length > 0) {
			return folders;
		}

		const cwd = typeof process?.cwd === 'function' ? process.cwd() : '';
		if (cwd) {
			this.logService.warn(`CleanSlate node indexer received no workspace folders; falling back to process cwd: ${cwd}`);
			return [URI.file(cwd)];
		}
		return [];
	}

	private parseWorkspaceFolder(folder: string): URI | undefined {
		if (!folder || typeof folder !== 'string') {
			return undefined;
		}
		try {
			const uri = URI.parse(folder);
			if (uri.scheme === 'file' && uri.fsPath) {
				return uri;
			}
		} catch {
			// Fall through to fs path parsing.
		}

		return path.isAbsolute(folder) ? URI.file(folder) : undefined;
	}

	private isSupportedFolder(filePath: string): boolean {
		const base = path.basename(filePath);
		return !['node_modules', '.git', 'out', 'build', '.vscode', 'dist'].includes(base)
			&& !filePath.includes('Library/Application Support');
	}

	private isSupportedFile(uri: URI): boolean {
		const filePath = uri.fsPath;
		if (!this.isSupportedFolder(path.dirname(filePath))) {
			return false;
		}

		const supportedExtensions = /\.(ts|js|py|dart|css|html|md|txt)$/;
		if (supportedExtensions.test(filePath)) {
			return true;
		}
		return filePath.endsWith('.json')
			&& !filePath.includes('package-lock.json')
			&& !filePath.includes('composer.lock')
			&& !filePath.includes('schemas-associations.json');
	}

	private async selectCandidateFilesForQuery(query: string, limit: number, profile: string): Promise<URI[]> {
		const terms = this.extractQueryTerms(query);
		if (terms.length === 0) {
			return Array.from(this._workspaceFiles.values()).slice(0, limit);
		}

		const scored: { uri: URI; score: number }[] = [];
		for (const uri of this._workspaceFiles.values()) {
			const score = this.scoreFileForQuery(uri, terms);
			if (score <= 0 || await this.isCurrentForProfile(uri, profile)) {
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
			if (term.length >= 2 && !seen.has(term)) {
				seen.add(term);
				terms.push(term);
			}
		}
		return terms.slice(0, 12);
	}

	private scoreFileForQuery(uri: URI, terms: string[]): number {
		const filePath = uri.fsPath.toLowerCase();
		const fileName = path.basename(filePath);
		let score = 0;
		for (const term of terms) {
			if (fileName.includes(term)) {
				score += 6;
			}
			if (filePath.includes(term)) {
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
			const text = await fs.promises.readFile(uri.fsPath, 'utf8');
			const { hashAsync } = await import('../../../../../base/common/hash.js');
			const currentHash = await hashAsync(text);
			const existingHash = await this.vectorStore.getHash(uri.toString(), profile);
			return existingHash === currentHash;
		} catch {
			return false;
		}
	}

	private async indexCandidateFiles(files: URI[], config: ICleanSlateConfiguration, profile: string): Promise<void> {
		const concurrency = config.embeddingProvider === 'openai' ? 3 : 1;
		let cursor = 0;
		const runWorker = async () => {
			while (cursor < files.length) {
				const uri = files[cursor++];
				if (uri) {
					await this.indexFileWithRetry(uri, config, profile);
				}
			}
		};

		const workers: Promise<void>[] = [];
		for (let i = 0; i < Math.min(concurrency, files.length); i++) {
			workers.push(runWorker());
		}
		await Promise.all(workers);
	}

	private async indexFileWithRetry(uri: URI, config: ICleanSlateConfiguration, profile: string, attempt = 1): Promise<void> {
		try {
			await this.indexFile(uri, config, profile);
		} catch (error: any) {
			if (error?.code === 'ENOENT') {
				this._workspaceFiles.delete(uri.toString());
				return;
			}
			const message = error?.message || String(error);
			if (message.includes('429') && attempt <= 5) {
				const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
				this.logService.warn(`Rate limit hit indexing ${uri.fsPath}. Retrying in ${Math.round(delay)}ms (attempt ${attempt}/5).`);
				await this.delay(delay);
				return this.indexFileWithRetry(uri, config, profile, attempt + 1);
			}
			this.logService.error(`Failed to generate embeddings for ${uri.fsPath}: ${message}`);
		}
	}

	private async indexFile(uri: URI, config: ICleanSlateConfiguration, profile: string): Promise<void> {
		const stat = await fs.promises.stat(uri.fsPath);
		if (stat.size > NodeCleanSlateIndexService.MAX_FILE_SIZE_BYTES) {
			this.logService.debug(`Skipping large file during indexing: ${uri.fsPath} (${Math.round(stat.size / 1024)}KB)`);
			return;
		}

		const text = await fs.promises.readFile(uri.fsPath, 'utf8');
		const { hashAsync } = await import('../../../../../base/common/hash.js');
		const currentHash = await hashAsync(text);
		const existingHash = await this.vectorStore.getHash(uri.toString(), profile);
		if (existingHash === currentHash) {
			return;
		}

		await this.vectorStore.deleteByUri(uri.toString(), profile);
		const semanticChunks = CleanSlateCodeParser.parse(text, '');
		if (semanticChunks.length === 0) {
			return;
		}

		const embeddings = await this.getEmbeddings(semanticChunks.map(chunk => chunk.content), config, profile);
		const entries: IVectorEntry[] = semanticChunks.map((chunk, index) => ({
			uri: uri.toString(),
			content: chunk.content,
			embedding: embeddings[index],
			hash: currentHash,
			profile,
			metadata: {
				startLine: chunk.startLine,
				endLine: chunk.endLine,
				type: chunk.type,
				name: chunk.name
			}
		}));

		await this.vectorStore.save(entries);
	}

	private getEmbeddingProfile(config: ICleanSlateConfiguration): string {
		const provider = config.embeddingProvider || 'local';
		const model = config.embeddingModel || (provider === 'local'
			? NodeCleanSlateIndexService.LOCAL_EMBEDDING_MODEL
			: provider === 'gemini' ? 'gemini-embedding-001' : 'text-embedding-3-small');
		return `${provider}:${model}`;
	}

	private getWorkspaceEmbeddingProfile(embeddingProfile: string, workspaceScopeKey: string): string {
		return `${embeddingProfile}|workspace:${workspaceScopeKey}`;
	}

	private getWorkspaceScopeKey(workspaceFolders: URI[]): string {
		const serialized = workspaceFolders
			.map(folder => folder.toString())
			.sort()
			.join('\n');
		return serialized ? this.hashString(serialized) : 'empty';
	}

	private hashString(value: string): string {
		let hash = 2166136261;
		for (let i = 0; i < value.length; i++) {
			hash ^= value.charCodeAt(i);
			hash = Math.imul(hash, 16777619);
		}
		return (hash >>> 0).toString(36);
	}

	private async getEmbedding(text: string, config: ICleanSlateConfiguration, profile: string): Promise<number[]> {
		const embeddings = await this.getEmbeddings([text], config, profile);
		return embeddings[0];
	}

	private async getEmbeddings(texts: string[], config: ICleanSlateConfiguration, profile: string): Promise<number[][]> {
		const results: number[][] = new Array(texts.length).fill(null);
		const misses: { text: string; index: number }[] = [];
		for (let i = 0; i < texts.length; i++) {
			const cached = await this.vectorStore.getQueryEmbedding(texts[i], profile);
			if (cached) {
				results[i] = cached;
			} else {
				misses.push({ text: texts[i], index: i });
			}
		}
		if (misses.length === 0) {
			return results;
		}

		const fetched = await this.fetchEmbeddings(misses.map(miss => miss.text), config);
		for (let i = 0; i < misses.length; i++) {
			const { text, index } = misses[i];
			const embedding = fetched[i];
			results[index] = embedding;
			this.vectorStore.saveQueryEmbedding(text, embedding, profile).catch(error =>
				this.logService.error(`Failed to cache query embedding: ${error}`)
			);
		}
		return results;
	}

	private async fetchEmbeddings(texts: string[], config: ICleanSlateConfiguration): Promise<number[][]> {
		switch (config.embeddingProvider || 'local') {
			case 'local':
				return this.cleanSlateMainService.localEmbeddings({
					model: config.embeddingModel || NodeCleanSlateIndexService.LOCAL_EMBEDDING_MODEL,
					texts
				}, CancellationToken.None).then(response => response.embeddings);
			case 'openai':
				return this.getOpenAIEmbeddings(texts, config);
			case 'azureOpenAI':
				return this.getAzureOpenAIEmbeddings(texts, config);
			case 'gemini':
				return this.getGeminiEmbeddings(texts, config);
			default:
				throw new Error('Select Local, OpenAI, Azure OpenAI, or Gemini as the CleanSlate embedding provider in CleanSlate Settings.');
		}
	}

	private async fetchWithRetry(url: string, options: { method?: string; headers?: Record<string, string>; body?: string }, maxRetries = 3): Promise<string> {
		let lastError: unknown;
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				const request: IRequestOptions = {
					url,
					type: options.method || 'GET',
					headers: options.headers,
					data: options.body,
					timeout: 30000
				};
				const response = await this.cleanSlateMainService.proxyRequest(request, CancellationToken.None);
				const statusCode = response.res.statusCode;
				if (statusCode && statusCode >= 200 && statusCode < 300) {
					return response.data;
				}
				if (statusCode === 429 || (statusCode && statusCode >= 500)) {
					await this.delay(Math.pow(2, attempt) * 1000 + Math.random() * 1000);
					continue;
				}
				throw new Error(`Embedding request failed (${statusCode}): ${response.data || 'Unknown error'}`);
			} catch (error) {
				lastError = error;
				await this.delay(Math.pow(2, attempt) * 1000 + Math.random() * 1000);
			}
		}
		throw lastError instanceof Error ? lastError : new Error(String(lastError));
	}

	private async getOpenAIEmbeddings(texts: string[], config: ICleanSlateConfiguration): Promise<number[][]> {
		const provider = config.providers?.openai;
		const apiKey = provider?.apiKey;
		if (!apiKey) {
			throw new Error('OpenAI API key is missing for embeddings.');
		}
		const baseUrl = (provider?.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
		const data = await this.fetchWithRetry(`${baseUrl}/embeddings`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
			body: JSON.stringify({ model: config.embeddingModel || 'text-embedding-3-small', input: texts })
		});
		const json = JSON.parse(data);
		return json.data.map((item: any) => item.embedding);
	}

	private async getAzureOpenAIEmbeddings(texts: string[], config: ICleanSlateConfiguration): Promise<number[][]> {
		const provider = config.providers?.azureOpenAI;
		if (!provider?.apiKey || !provider.endpoint || !provider.embeddingDeploymentName) {
			throw new Error('Azure OpenAI embedding configuration is incomplete.');
		}
		const endpoint = provider.endpoint.replace(/\/+$/, '');
		const deployment = provider.embeddingDeploymentName;
		const url = `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/embeddings?api-version=${encodeURIComponent(provider.apiVersion || '2024-12-01-preview')}`;
		const data = await this.fetchWithRetry(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'api-key': provider.apiKey },
			body: JSON.stringify({ input: texts })
		});
		const json = JSON.parse(data);
		return json.data.map((item: any) => item.embedding);
	}

	private async getGeminiEmbeddings(texts: string[], config: ICleanSlateConfiguration): Promise<number[][]> {
		const apiKey = config.providers?.gemini?.apiKey;
		if (!apiKey) {
			throw new Error('Google API key is missing for embeddings.');
		}
		const configuredModel = config.embeddingModel || 'gemini-embedding-001';
		const model = configuredModel.startsWith('models/') ? configuredModel : `models/${configuredModel}`;
		const results: number[][] = [];
		for (let i = 0; i < texts.length; i += 100) {
			const batch = texts.slice(i, i + 100);
			const data = await this.fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/${model}:batchEmbedContents?key=${apiKey}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					requests: batch.map(text => ({ model, content: { parts: [{ text }] } }))
				})
			});
			const json = JSON.parse(data);
			results.push(...json.embeddings.map((embedding: any) => embedding.values));
		}
		return results;
	}

	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}
