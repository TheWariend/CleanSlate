/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ICleanSlateVectorStore, IVectorEntry, IVectorSearchResult } from '../../common/core/cleanSlateAI.js';
import { ICleanSlateChannelService } from '../../common/core/cleanSlateChannelService.js';
import { IChannel } from '../../../../../base/parts/ipc/common/ipc.js';

export class CleanSlateVectorStoreProxy extends Disposable implements ICleanSlateVectorStore {

    readonly _serviceBrand: undefined;
    private readonly channel: IChannel;

    constructor(
        @ICleanSlateChannelService channelService: ICleanSlateChannelService
    ) {
        super();
        this.channel = channelService.getChannel('cleanSlateVectorStore');
    }

    save(entries: IVectorEntry[]): Promise<void> {
        return this.channel.call('save', entries);
    }

    load(): Promise<IVectorEntry[]> {
        return this.channel.call('load');
    }

    search(queryEmbedding: number[], limit?: number, threshold?: number, profile?: string): Promise<IVectorSearchResult[]> {
        return this.channel.call('search', { queryEmbedding, limit, threshold, profile });
    }

    clear(): Promise<void> {
        return this.channel.call('clear');
    }

    getHash(uri: string, profile?: string): Promise<string | undefined> {
        return this.channel.call('getHash', { uri, profile });
    }

    deleteByUri(uri: string, profile?: string): Promise<void> {
        return this.channel.call('deleteByUri', { uri, profile });
    }

    getQueryEmbedding(query: string, profile?: string): Promise<number[] | undefined> {
        return this.channel.call('getQueryEmbedding', { query, profile });
    }

    saveQueryEmbedding(query: string, embedding: number[], profile?: string): Promise<void> {
        return this.channel.call('saveQueryEmbedding', { query, embedding, profile });
    }
}
