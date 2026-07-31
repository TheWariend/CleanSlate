/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICleanSlateVectorStore, IVectorEntry, IVectorSearchResult } from '../protocol/cleanSlateAI.js';

/** In-process vector storage for headless hosts that do not inject a persistent store. */
export class CleanSlateMemoryVectorStore implements ICleanSlateVectorStore {
	declare readonly _serviceBrand: undefined;
	private entries: IVectorEntry[] = [];
	private readonly hashes = new Map<string, string>();
	private readonly queryEmbeddings = new Map<string, number[]>();

	async save(entries: IVectorEntry[]): Promise<void> {
		const replaced = new Set(entries.map(entry => this.key(entry.uri, entry.profile)));
		this.entries = this.entries.filter(existing => !replaced.has(this.key(existing.uri, existing.profile)));
		this.entries.push(...entries.map(entry => ({ ...entry, embedding: [...entry.embedding] })));
		for (const entry of entries) {
			if (entry.hash) {
				this.hashes.set(this.key(entry.uri, entry.profile), entry.hash);
			}
		}
	}

	async load(): Promise<IVectorEntry[]> {
		return this.entries.map(entry => ({ ...entry, embedding: [...entry.embedding] }));
	}

	async search(queryEmbedding: number[], limit = 200, threshold = 0.65, profile = 'legacy'): Promise<IVectorSearchResult[]> {
		return this.entries
			.filter(entry => (entry.profile || 'legacy') === profile)
			.map(entry => ({
				uri: entry.uri,
				content: entry.content,
				score: this.cosineSimilarity(queryEmbedding, entry.embedding),
				metadata: entry.metadata
			}))
			.filter(entry => entry.score >= threshold)
			.sort((left, right) => right.score - left.score)
			.slice(0, Math.max(1, limit));
	}

	async clear(): Promise<void> {
		this.entries = [];
		this.hashes.clear();
		this.queryEmbeddings.clear();
	}

	async getHash(uri: string, profile = 'legacy'): Promise<string | undefined> {
		return this.hashes.get(this.key(uri, profile));
	}

	async deleteByUri(uri: string, profile = 'legacy'): Promise<void> {
		this.entries = this.entries.filter(entry => entry.uri !== uri || (entry.profile || 'legacy') !== profile);
		this.hashes.delete(this.key(uri, profile));
	}

	async getQueryEmbedding(query: string, profile = 'legacy'): Promise<number[] | undefined> {
		const embedding = this.queryEmbeddings.get(this.key(query, profile));
		return embedding ? [...embedding] : undefined;
	}

	async saveQueryEmbedding(query: string, embedding: number[], profile = 'legacy'): Promise<void> {
		this.queryEmbeddings.set(this.key(query, profile), [...embedding]);
	}

	private key(value: string, profile = 'legacy'): string {
		return `${profile}\u0000${value}`;
	}

	private cosineSimilarity(left: number[], right: number[]): number {
		let dot = 0;
		let leftMagnitude = 0;
		let rightMagnitude = 0;
		const length = Math.min(left.length, right.length);
		for (let index = 0; index < length; index++) {
			dot += left[index] * right[index];
			leftMagnitude += left[index] * left[index];
			rightMagnitude += right[index] * right[index];
		}
		return leftMagnitude && rightMagnitude ? dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude)) : 0;
	}
}
