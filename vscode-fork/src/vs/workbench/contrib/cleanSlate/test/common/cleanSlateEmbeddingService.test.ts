/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CleanSlateEmbeddingService } from '../../../../services/cleanSlate/common/ai/cleanSlateEmbeddingService.js';

suite('CleanSlateEmbeddingService', () => {
	test('uses bundled local embeddings without provider API keys', async () => {
		const cache = new Map<string, number[]>();
		let localCalls = 0;
		const service = new CleanSlateEmbeddingService(
			{
				getResolvedConfiguration: async () => ({ embeddingProvider: 'local', embeddingModel: 'Xenova/bge-small-en-v1.5' })
			} as any,
			{
				localEmbeddings: async (options: { texts: string[] }) => {
					localCalls++;
					return {
						model: 'Xenova/bge-small-en-v1.5',
						dimensions: 3,
						embeddings: options.texts.map(() => [0.1, 0.2, 0.3])
					};
				}
			} as any,
			{
				getQueryEmbedding: async (query: string, profile?: string) => cache.get(`${profile}:${query}`),
				saveQueryEmbedding: async (query: string, embedding: number[], profile?: string) => {
					cache.set(`${profile}:${query}`, embedding);
				}
			} as any,
			{ error() { } } as any
		);

		const profile = await service.getEmbeddingProfile();
		const first = await service.getEmbedding('function readFile(path: string) { return fs.readFileSync(path); }');
		const second = await service.getEmbedding('function readFile(path: string) { return fs.readFileSync(path); }');

		assert.strictEqual(profile, 'local:Xenova/bge-small-en-v1.5');
		assert.strictEqual(localCalls, 1);
		assert.deepStrictEqual(second, first);
	});
});
