/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Emitter } from '../core/event.js';
import { URI } from '../core/uri.js';
import { ICleanSlateConfiguration, ICleanSlateIndexService, ICleanSlateVectorStore, ISearchResult, IVectorEntry } from '../protocol/cleanSlateAI.js';
import { CleanSlateCodeParser } from '../protocol/cleanSlateCodeParser.js';
import { CleanSlateMemoryVectorStore } from './cleanSlateMemoryVectorStore.js';

export interface ICleanSlateNodeIndexOptions {
	workspaceFolders: string[];
	config: ICleanSlateConfiguration;
}

export interface ICleanSlateEmbeddingRequest {
	url: string;
	method: string;
	headers?: Record<string, string>;
	body?: string;
	timeoutMs: number;
}

export interface ICleanSlateEmbeddingResponse {
	statusCode: number;
	data: string;
}

/** The only host-specific part of embedding generation: network and bundled-model transport. */
export interface ICleanSlateEmbeddingTransport {
	request(request: ICleanSlateEmbeddingRequest): Promise<ICleanSlateEmbeddingResponse>;
	localEmbeddings?(model: string, texts: string[]): Promise<number[][]>;
}

export interface ICleanSlateIndexLogger {
	debug(message: string): void;
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
}

export interface ICleanSlateNodeIndexServiceOptions {
	workspaceFolders?: string[];
	configuration: ICleanSlateConfiguration | (() => ICleanSlateConfiguration);
	vectorStore?: ICleanSlateVectorStore;
	embeddingTransport: ICleanSlateEmbeddingTransport;
	logger?: ICleanSlateIndexLogger;
}

const consoleLogger: ICleanSlateIndexLogger = {
	debug: message => console.debug(message),
	info: message => console.info(message),
	warn: message => console.warn(message),
	error: message => console.error(message)
};

class NonRetryableEmbeddingError extends Error { }

/**
 * Shared Node semantic indexer. Hosts inject storage, transport, configuration and logging;
 * workspace mapping, chunking, embedding profiles, retries and lazy vector search live here.
 */
export class CleanSlateNodeIndexService implements ICleanSlateIndexService {
	declare readonly _serviceBrand: undefined;
	static readonly LOCAL_EMBEDDING_MODEL = 'Xenova/bge-small-en-v1.5';
	private static readonly MAX_FILE_SIZE_BYTES = 200 * 1024;

	private readonly statusEmitter = new Emitter<boolean>();
	readonly onDidStatusChange = this.statusEmitter.event;
	private _isIndexing = false;
	private readonly workspaceFiles = new Map<string, URI>();
	private workspaceMapped = false;
	private workspaceMapPromise: Promise<void> | undefined;
	private workspaceScopeKey: string | undefined;
	private workspaceMapPromiseScopeKey: string | undefined;
	private lastOptions: ICleanSlateNodeIndexOptions | undefined;
	private readonly vectorStore: ICleanSlateVectorStore;
	private readonly logger: ICleanSlateIndexLogger;

	constructor(
		private readonly rootPath: string,
		private readonly serviceOptions: ICleanSlateNodeIndexServiceOptions
	) {
		this.vectorStore = serviceOptions.vectorStore ?? new CleanSlateMemoryVectorStore();
		this.logger = serviceOptions.logger ?? consoleLogger;
	}

	get isIndexing(): boolean {
		return this._isIndexing;
	}

	async indexWorkspace(): Promise<void> {
		return this.indexWorkspaceWithOptions(this.currentOptions());
	}

	async search(query: string, limit?: number, threshold?: number): Promise<ISearchResult[]> {
		return this.searchWithOptions({ ...this.currentOptions(), query, limit, threshold });
	}

	async indexWorkspaceWithOptions(options: ICleanSlateNodeIndexOptions): Promise<void> {
		this.lastOptions = options;
		if (options.config.ragEnabled === false) {
			this.logger.info('Skipping workspace indexing because RAG is disabled.');
			return;
		}
		const workspaceFolders = this.resolveWorkspaceFolders(options.workspaceFolders || []);
		const workspaceScopeKey = this.getWorkspaceScopeKey(workspaceFolders);
		if (this.workspaceMapPromise && this.workspaceMapPromiseScopeKey === workspaceScopeKey) {
			return this.workspaceMapPromise;
		}
		if (this.workspaceMapPromise) {
			await this.workspaceMapPromise;
		}
		if (this.workspaceMapped && this.workspaceScopeKey === workspaceScopeKey) {
			return;
		}

		this.setIndexing(true);
		this.logger.info(`Starting node workspace file map for lazy semantic indexing (${workspaceFolders.length} folder(s), scope ${workspaceScopeKey}).`);
		this.workspaceMapPromiseScopeKey = workspaceScopeKey;
		this.workspaceMapPromise = (async () => {
			try {
				this.workspaceFiles.clear();
				for (const folder of workspaceFolders) {
					await this.walkDirectory(folder);
				}
				this.workspaceMapped = true;
				this.workspaceScopeKey = workspaceScopeKey;
				this.logger.info(`Workspace mapped in node indexer. Found ${this.workspaceFiles.size} manageable files for scope ${workspaceScopeKey}.`);
			} catch (error) {
				this.workspaceMapped = false;
				this.logger.error(`Error during node indexing initialization: ${String(error)}`);
			} finally {
				this.setIndexing(false);
				this.workspaceMapPromise = undefined;
				this.workspaceMapPromiseScopeKey = undefined;
			}
		})();
		return this.workspaceMapPromise;
	}

	async searchWithOptions(options: ICleanSlateNodeIndexOptions & { query: string; limit?: number; threshold?: number }): Promise<ISearchResult[]> {
		this.lastOptions = options;
		if (options.config.ragEnabled === false) {
			return [];
		}

		await this.indexWorkspaceWithOptions(options);
		const requestedLimit = options.limit ?? 8;
		const threshold = options.threshold ?? 0.65;
		const workspaceScopeKey = this.workspaceScopeKey ?? this.getWorkspaceScopeKey(this.resolveWorkspaceFolders(options.workspaceFolders || []));
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

		this.logger.debug(`CleanSlate node index found ${results.length} lazy vector results above threshold ${threshold}.`);
		return results.map(entry => ({
			uri: URI.parse(entry.uri),
			content: entry.content,
			score: entry.score,
			range: entry.metadata ? { startLineNumber: entry.metadata.startLine, endLineNumber: entry.metadata.endLine } : undefined
		}));
	}

	private currentOptions(): ICleanSlateNodeIndexOptions {
		const config = typeof this.serviceOptions.configuration === 'function'
			? this.serviceOptions.configuration()
			: this.serviceOptions.configuration;
		return {
			workspaceFolders: this.serviceOptions.workspaceFolders ?? this.lastOptions?.workspaceFolders ?? [this.rootPath],
			config
		};
	}

	private setIndexing(value: boolean): void {
		if (this._isIndexing !== value) {
			this._isIndexing = value;
			this.statusEmitter.fire(value);
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
					this.workspaceFiles.set(childUri.toString(), childUri);
				}
			}
		}
	}

	private resolveWorkspaceFolders(workspaceFolders: string[]): URI[] {
		const folders = workspaceFolders.map(folder => this.parseWorkspaceFolder(folder)).filter((folder): folder is URI => !!folder);
		if (folders.length > 0) {
			return folders;
		}
		if (this.rootPath) {
			this.logger.warn(`CleanSlate node indexer received no workspace folders; falling back to root path: ${this.rootPath}`);
			return [URI.file(this.rootPath)];
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
			// Fall through to absolute filesystem path parsing.
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
		if (/\.(ts|js|py|dart|css|html|md|txt)$/.test(filePath)) {
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
			return Array.from(this.workspaceFiles.values()).slice(0, limit);
		}
		const scored: { uri: URI; score: number }[] = [];
		for (const uri of this.workspaceFiles.values()) {
			const score = this.scoreFileForQuery(uri, terms);
			if (score <= 0 || await this.isCurrentForProfile(uri, profile)) {
				continue;
			}
			scored.push({ uri, score });
		}
		scored.sort((left, right) => right.score - left.score);
		return scored.slice(0, limit).map(item => item.uri);
	}

	private extractQueryTerms(query: string): string[] {
		const terms: string[] = [];
		const seen = new Set<string>();
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
		return /(test|spec)\.(ts|js|py|dart)$/.test(fileName) ? score * 0.85 : score;
	}

	private async isCurrentForProfile(uri: URI, profile: string): Promise<boolean> {
		try {
			const text = await fs.promises.readFile(uri.fsPath, 'utf8');
			return await this.vectorStore.getHash(uri.toString(), profile) === this.hashText(text);
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
		await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, () => runWorker()));
	}

	private async indexFileWithRetry(uri: URI, config: ICleanSlateConfiguration, profile: string, attempt = 1): Promise<void> {
		try {
			await this.indexFile(uri, config, profile);
		} catch (error: any) {
			if (error?.code === 'ENOENT') {
				this.workspaceFiles.delete(uri.toString());
				return;
			}
			const message = error?.message || String(error);
			if (message.includes('429') && attempt <= 5) {
				const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
				this.logger.warn(`Rate limit hit indexing ${uri.fsPath}. Retrying in ${Math.round(delay)}ms (attempt ${attempt}/5).`);
				await this.delay(delay);
				return this.indexFileWithRetry(uri, config, profile, attempt + 1);
			}
			this.logger.error(`Failed to generate embeddings for ${uri.fsPath}: ${message}`);
		}
	}

	private async indexFile(uri: URI, config: ICleanSlateConfiguration, profile: string): Promise<void> {
		const stat = await fs.promises.stat(uri.fsPath);
		if (stat.size > CleanSlateNodeIndexService.MAX_FILE_SIZE_BYTES) {
			this.logger.debug(`Skipping large file during indexing: ${uri.fsPath} (${Math.round(stat.size / 1024)}KB)`);
			return;
		}
		const text = await fs.promises.readFile(uri.fsPath, 'utf8');
		const currentHash = this.hashText(text);
		if (await this.vectorStore.getHash(uri.toString(), profile) === currentHash) {
			return;
		}
		await this.vectorStore.deleteByUri(uri.toString(), profile);
		const semanticChunks = CleanSlateCodeParser.parse(text, '');
		if (semanticChunks.length === 0) {
			return;
		}
		const embeddings = await this.getEmbeddings(semanticChunks.map(chunk => chunk.content), config, profile);
		if (embeddings.length !== semanticChunks.length) {
			throw new Error(`Embedding provider returned ${embeddings.length} vectors for ${semanticChunks.length} chunks.`);
		}
		const entries: IVectorEntry[] = semanticChunks.map((chunk, index) => ({
			uri: uri.toString(),
			content: chunk.content,
			embedding: embeddings[index],
			hash: currentHash,
			profile,
			metadata: { startLine: chunk.startLine, endLine: chunk.endLine, type: chunk.type, name: chunk.name }
		}));
		await this.vectorStore.save(entries);
	}

	getEmbeddingProfile(config: ICleanSlateConfiguration): string {
		const provider = config.embeddingProvider || 'local';
		const model = config.embeddingModel || (provider === 'local'
			? CleanSlateNodeIndexService.LOCAL_EMBEDDING_MODEL
			: provider === 'gemini' ? 'gemini-embedding-001' : 'text-embedding-3-small');
		return `${provider}:${model}`;
	}

	getWorkspaceEmbeddingProfile(embeddingProfile: string, workspaceScopeKey: string): string {
		return `${embeddingProfile}|workspace:${workspaceScopeKey}`;
	}

	private getWorkspaceScopeKey(workspaceFolders: URI[]): string {
		const serialized = workspaceFolders.map(folder => folder.toString()).sort().join('\n');
		return serialized ? this.hashString(serialized) : 'empty';
	}

	private hashString(value: string): string {
		let hash = 2166136261;
		for (let index = 0; index < value.length; index++) {
			hash ^= value.charCodeAt(index);
			hash = Math.imul(hash, 16777619);
		}
		return (hash >>> 0).toString(36);
	}

	private hashText(value: string): string {
		return createHash('sha256').update(value).digest('hex');
	}

	private async getEmbedding(text: string, config: ICleanSlateConfiguration, profile: string): Promise<number[]> {
		const embeddings = await this.getEmbeddings([text], config, profile);
		if (!embeddings[0]) {
			throw new Error('Embedding provider returned no query vector.');
		}
		return embeddings[0];
	}

	private async getEmbeddings(texts: string[], config: ICleanSlateConfiguration, profile: string): Promise<number[][]> {
		const results: number[][] = new Array(texts.length);
		const misses: { text: string; index: number }[] = [];
		for (let index = 0; index < texts.length; index++) {
			const cached = await this.vectorStore.getQueryEmbedding(texts[index], profile);
			if (cached) {
				results[index] = cached;
			} else {
				misses.push({ text: texts[index], index });
			}
		}
		if (misses.length === 0) {
			return results;
		}
		const fetched = await this.fetchEmbeddings(misses.map(miss => miss.text), config);
		if (fetched.length !== misses.length) {
			throw new Error(`Embedding provider returned ${fetched.length} vectors for ${misses.length} inputs.`);
		}
		for (let index = 0; index < misses.length; index++) {
			const miss = misses[index];
			const embedding = fetched[index];
			if (!Array.isArray(embedding) || embedding.length === 0 || embedding.some(value => !Number.isFinite(value))) {
				throw new Error(`Embedding provider returned an invalid vector at index ${index}.`);
			}
			results[miss.index] = embedding;
			void this.vectorStore.saveQueryEmbedding(miss.text, embedding, profile).catch(error =>
				this.logger.error(`Failed to cache query embedding: ${String(error)}`)
			);
		}
		return results;
	}

	private async fetchEmbeddings(texts: string[], config: ICleanSlateConfiguration): Promise<number[][]> {
		switch (config.embeddingProvider || 'local') {
			case 'local': {
				if (!this.serviceOptions.embeddingTransport.localEmbeddings) {
					throw new Error('Local embeddings are unavailable in this host. Configure OpenAI, Azure OpenAI, or Gemini embeddings.');
				}
				return this.serviceOptions.embeddingTransport.localEmbeddings(
					config.embeddingModel || CleanSlateNodeIndexService.LOCAL_EMBEDDING_MODEL,
					texts
				);
			}
			case 'openai': return this.getOpenAIEmbeddings(texts, config);
			case 'azureOpenAI': return this.getAzureOpenAIEmbeddings(texts, config);
			case 'gemini': return this.getGeminiEmbeddings(texts, config);
		}
	}

	private async fetchWithRetry(request: Omit<ICleanSlateEmbeddingRequest, 'timeoutMs'>, maxRetries = 3): Promise<string> {
		let lastError: unknown;
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				const response = await this.serviceOptions.embeddingTransport.request({ ...request, timeoutMs: 30_000 });
				if (response.statusCode >= 200 && response.statusCode < 300) {
					return response.data;
				}
				const message = `Embedding request failed (${response.statusCode}): ${response.data || 'Unknown error'}`;
				if (response.statusCode !== 429 && response.statusCode < 500) {
					throw new NonRetryableEmbeddingError(message);
				}
				lastError = new Error(message);
			} catch (error) {
				if (error instanceof NonRetryableEmbeddingError) {
					throw error;
				}
				lastError = error;
			}
			if (attempt < maxRetries) {
				await this.delay(Math.pow(2, attempt) * 1000 + Math.random() * 1000);
			}
		}
		throw lastError instanceof Error ? lastError : new Error(String(lastError));
	}

	private async getOpenAIEmbeddings(texts: string[], config: ICleanSlateConfiguration): Promise<number[][]> {
		const provider = config.providers?.openai;
		if (!provider?.apiKey) {
			throw new Error('OpenAI API key is missing for embeddings.');
		}
		const baseUrl = (provider.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
		const data = await this.fetchWithRetry({
			url: `${baseUrl}/embeddings`,
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
			body: JSON.stringify({ model: config.embeddingModel || 'text-embedding-3-small', input: texts })
		});
		return this.readEmbeddingArray(data, 'data', 'embedding');
	}

	private async getAzureOpenAIEmbeddings(texts: string[], config: ICleanSlateConfiguration): Promise<number[][]> {
		const provider = config.providers?.azureOpenAI;
		if (!provider?.apiKey || !provider.endpoint || !provider.embeddingDeploymentName) {
			throw new Error('Azure OpenAI embedding configuration is incomplete.');
		}
		const endpoint = provider.endpoint.replace(/\/+$/, '');
		const url = `${endpoint}/openai/deployments/${encodeURIComponent(provider.embeddingDeploymentName)}/embeddings?api-version=${encodeURIComponent(provider.apiVersion || '2024-12-01-preview')}`;
		const data = await this.fetchWithRetry({
			url,
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'api-key': provider.apiKey },
			body: JSON.stringify({ input: texts })
		});
		return this.readEmbeddingArray(data, 'data', 'embedding');
	}

	private async getGeminiEmbeddings(texts: string[], config: ICleanSlateConfiguration): Promise<number[][]> {
		const apiKey = config.providers?.gemini?.apiKey;
		if (!apiKey) {
			throw new Error('Google API key is missing for embeddings.');
		}
		const configuredModel = config.embeddingModel || 'gemini-embedding-001';
		const model = configuredModel.startsWith('models/') ? configuredModel : `models/${configuredModel}`;
		const results: number[][] = [];
		for (let index = 0; index < texts.length; index += 100) {
			const batch = texts.slice(index, index + 100);
			const data = await this.fetchWithRetry({
				url: `https://generativelanguage.googleapis.com/v1beta/${model}:batchEmbedContents?key=${apiKey}`,
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ requests: batch.map(text => ({ model, content: { parts: [{ text }] } })) })
			});
			const parsed = JSON.parse(data);
			if (!Array.isArray(parsed?.embeddings)) {
				throw new Error('Gemini embedding response did not contain embeddings.');
			}
			results.push(...parsed.embeddings.map((embedding: any) => embedding.values));
		}
		return results;
	}

	private readEmbeddingArray(data: string, arrayKey: string, embeddingKey: string): number[][] {
		const parsed = JSON.parse(data);
		if (!Array.isArray(parsed?.[arrayKey])) {
			throw new Error('Embedding response did not contain a data array.');
		}
		return parsed[arrayKey]
			.slice()
			.sort((left: any, right: any) => (left.index ?? 0) - (right.index ?? 0))
			.map((item: any) => item?.[embeddingKey]);
	}

	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}
