/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { ICleanSlateVectorStore, IVectorEntry, ICleanSlateLogger, IVectorSearchResult } from '../core/cleanSlateAI.js';

export class CleanSlateVectorStore implements ICleanSlateVectorStore {
    _serviceBrand: undefined;

    private static readonly STORAGE_KEY_PREFIX = 'cleanSlate.vector.';
    private static readonly HASH_KEY_PREFIX = 'cleanSlate.hash.';
    private static readonly REGISTRY_KEY = 'cleanSlate.indexedUris';
    private static readonly DEFAULT_PROFILE = 'legacy';

    constructor(
        @IStorageService private readonly storageService: IStorageService,
        @ICleanSlateLogger private readonly logger: ICleanSlateLogger
    ) { }

    private getRegistry(): Set<string> {
        const raw = this.storageService.get(CleanSlateVectorStore.REGISTRY_KEY, StorageScope.WORKSPACE);
        try {
            return new Set(raw ? JSON.parse(raw) : []);
        } catch {
            return new Set();
        }
    }

    private saveRegistry(registry: Set<string>): void {
        this.storageService.store(
            CleanSlateVectorStore.REGISTRY_KEY,
            JSON.stringify(Array.from(registry)),
            StorageScope.WORKSPACE,
            StorageTarget.MACHINE
        );
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

        try {
            const registry = this.getRegistry();
            for (const [uri, uriEntries] of entriesByUri) {
                const hash = uriEntries[0]?.hash;
                const profile = uriEntries[0]?.profile || CleanSlateVectorStore.DEFAULT_PROFILE;
                this.storageService.store(
                    this.profileKey(CleanSlateVectorStore.STORAGE_KEY_PREFIX, uri, profile),
                    JSON.stringify(uriEntries),
                    StorageScope.WORKSPACE,
                    StorageTarget.MACHINE
                );

                if (hash) {
                    this.storageService.store(
                        this.profileKey(CleanSlateVectorStore.HASH_KEY_PREFIX, uri, profile),
                        hash,
                        StorageScope.WORKSPACE,
                        StorageTarget.MACHINE
                    );
                }

                registry.add(uri);
                this.logger.debug(`Saved ${uriEntries.length} vector entries for ${uri} to storage.`);
            }

            this.saveRegistry(registry);
        } catch (e) {
            this.logger.error(`Failed to save vector entries to storage: ${e}`);
        }
    }

    async load(): Promise<IVectorEntry[]> {
        const allEntries: IVectorEntry[] = [];
        const registry = this.getRegistry();

        for (const uri of registry) {
            const raw = this.storageService.get(CleanSlateVectorStore.STORAGE_KEY_PREFIX + uri, StorageScope.WORKSPACE);
            if (raw) {
                try {
                    const entries = JSON.parse(raw);
                    allEntries.push(...entries);
                } catch (e) {
                    this.logger.error(`Failed to parse entries for ${uri}: ${e}`);
                }
            }
        }

        this.logger.info(`Loaded ${allEntries.length} entries for ${registry.size} files from persistent storage.`);
        return allEntries;
    }

    async search(queryEmbedding: number[], limit?: number, threshold: number = 0.65, profile: string = CleanSlateVectorStore.DEFAULT_PROFILE): Promise<IVectorSearchResult[]> {
        const entries = await this.load();
        const qualified: IVectorSearchResult[] = [];
        for (const entry of entries) {
            if ((entry.profile || CleanSlateVectorStore.DEFAULT_PROFILE) !== profile) {
                continue;
            }
            const score = this.fastCosineSimilarity(queryEmbedding, entry.embedding);
            if (score >= threshold) {
                qualified.push({
                    uri: entry.uri,
                    content: entry.content,
                    score,
                    metadata: entry.metadata
                });
            }
        }
        qualified.sort((a, b) => b.score - a.score);
        return limit && limit > 0 ? qualified.slice(0, limit) : qualified;
    }

    async getHash(uri: string, profile: string = CleanSlateVectorStore.DEFAULT_PROFILE): Promise<string | undefined> {
        return this.storageService.get(this.profileKey(CleanSlateVectorStore.HASH_KEY_PREFIX, uri, profile), StorageScope.WORKSPACE);
    }

    async deleteByUri(uri: string, profile: string = CleanSlateVectorStore.DEFAULT_PROFILE): Promise<void> {
        this.storageService.remove(this.profileKey(CleanSlateVectorStore.STORAGE_KEY_PREFIX, uri, profile), StorageScope.WORKSPACE);
        this.storageService.remove(this.profileKey(CleanSlateVectorStore.HASH_KEY_PREFIX, uri, profile), StorageScope.WORKSPACE);

        const registry = this.getRegistry();
        if (registry.delete(uri)) {
            this.saveRegistry(registry);
        }
    }

    async clear(): Promise<void> {
        this.logger.warn('Clear not implemented for IStorageService based VectorStore yet.');
    }

    async getQueryEmbedding(query: string, profile: string = CleanSlateVectorStore.DEFAULT_PROFILE): Promise<number[] | undefined> {
        const raw = this.storageService.get(this.profileKey(CleanSlateVectorStore.STORAGE_KEY_PREFIX, `query.${query}`, profile), StorageScope.WORKSPACE);
        try {
            return raw ? JSON.parse(raw) : undefined;
        } catch {
            return undefined;
        }
    }

    async saveQueryEmbedding(query: string, embedding: number[], profile: string = CleanSlateVectorStore.DEFAULT_PROFILE): Promise<void> {
        this.storageService.store(
            this.profileKey(CleanSlateVectorStore.STORAGE_KEY_PREFIX, `query.${query}`, profile),
            JSON.stringify(embedding),
            StorageScope.WORKSPACE,
            StorageTarget.MACHINE
        );
    }

    private profileKey(prefix: string, key: string, profile: string): string {
        return `${prefix}${profile}.${key}`;
    }

    private fastCosineSimilarity(v1: number[], v2: number[]): number {
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
}
