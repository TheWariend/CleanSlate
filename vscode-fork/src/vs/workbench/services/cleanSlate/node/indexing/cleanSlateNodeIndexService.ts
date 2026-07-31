/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IRequestOptions } from '../../../../../base/parts/request/common/request.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import {
	CleanSlateNodeIndexService,
	ICleanSlateEmbeddingRequest,
	ICleanSlateNodeIndexOptions
} from '@cleanslate/sdk/node/cleanSlateNodeIndexService.js';
import { ICleanSlateIndexService, ICleanSlateMainService, ICleanSlateVectorStore, ISearchResult } from '../../common/core/cleanSlateAI.js';

export type { ICleanSlateNodeIndexOptions } from '@cleanslate/sdk/node/cleanSlateNodeIndexService.js';

/** Workbench DI and transport adapter for the SDK-owned semantic indexer. */
export class NodeCleanSlateIndexService extends Disposable implements ICleanSlateIndexService {

	declare readonly _serviceBrand: undefined;
	private readonly indexer: CleanSlateNodeIndexService;
	private lastOptions: ICleanSlateNodeIndexOptions | undefined;
	readonly onDidStatusChange: Event<boolean>;

	constructor(
		@ICleanSlateVectorStore vectorStore: ICleanSlateVectorStore,
		@ICleanSlateMainService cleanSlateMainService: ICleanSlateMainService,
		@ILogService logService: ILogService
	) {
		super();
		this.indexer = new CleanSlateNodeIndexService(process.cwd(), {
			configuration: () => this.lastOptions?.config ?? { provider: 'cleanslate' },
			vectorStore,
			embeddingTransport: {
				request: async (request: ICleanSlateEmbeddingRequest) => {
					const options: IRequestOptions = {
						url: request.url,
						type: request.method,
						headers: request.headers,
						data: request.body,
						timeout: request.timeoutMs
					};
					const response = await cleanSlateMainService.proxyRequest(options, CancellationToken.None);
					return { statusCode: response.res.statusCode ?? 0, data: response.data };
				},
				localEmbeddings: async (model, texts) => (await cleanSlateMainService.localEmbeddings({ model, texts }, CancellationToken.None)).embeddings
			},
			logger: {
				debug: message => logService.debug(message),
				info: message => logService.info(message),
				warn: message => logService.warn(message),
				error: message => logService.error(message)
			}
		});
		this.onDidStatusChange = this.indexer.onDidStatusChange as Event<boolean>;
	}

	get isIndexing(): boolean {
		return this.indexer.isIndexing;
	}

	async indexWorkspace(): Promise<void> {
		if (!this.lastOptions) {
			return;
		}
		return this.indexer.indexWorkspaceWithOptions(this.lastOptions);
	}

	async search(query: string, limit?: number, threshold?: number): Promise<ISearchResult[]> {
		if (!this.lastOptions) {
			return [];
		}
		return this.indexer.searchWithOptions({ ...this.lastOptions, query, limit, threshold });
	}

	async indexWorkspaceWithOptions(options: ICleanSlateNodeIndexOptions): Promise<void> {
		this.lastOptions = options;
		return this.indexer.indexWorkspaceWithOptions(options);
	}

	async searchWithOptions(options: ICleanSlateNodeIndexOptions & { query: string; limit?: number; threshold?: number }): Promise<ISearchResult[]> {
		this.lastOptions = options;
		return this.indexer.searchWithOptions(options);
	}
}
