/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { IServerChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { ICleanSlateVectorStore } from '../../common/core/cleanSlateAI.js';

export class CleanSlateVectorStoreChannel implements IServerChannel {

    constructor(private service: ICleanSlateVectorStore) { }

    listen<T>(_: unknown, event: string): Event<T> {
        throw new Error(`Event not found: ${event}`);
    }

    call(_: unknown, command: string, arg?: any): Promise<any> {
        switch (command) {
            case 'save': return this.service.save(arg);
            case 'load': return this.service.load();
            case 'search': return this.service.search(arg.queryEmbedding, arg.limit, arg.threshold, arg.profile);
            case 'getHash': return this.service.getHash(arg.uri, arg.profile);
            case 'deleteByUri': return this.service.deleteByUri(arg.uri, arg.profile);
            case 'getQueryEmbedding': return this.service.getQueryEmbedding(arg.query, arg.profile);
            case 'saveQueryEmbedding': return this.service.saveQueryEmbedding(arg.query, arg.embedding, arg.profile);
            case 'clear': return this.service.clear();
        }

        throw new Error(`Call not found: ${command}`);
    }
}
