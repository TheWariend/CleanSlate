/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { IServerChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { IMCPClientService } from '../../common/core/cleanSlateAI.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';

export class CleanSlateMCPChannel implements IServerChannel {

    constructor(private service: IMCPClientService) { }

    listen<T>(_: unknown, event: string): Event<T> {
        throw new Error(`Event not found: ${event}`);
    }

    call(_: unknown, command: string, arg?: any, token: CancellationToken = CancellationToken.None): Promise<any> {
        switch (command) {
            case 'getTools': return this.service.getTools(token);
            case 'executeTool': return this.service.executeTool(arg.toolName, arg.input, token);
            case 'refreshServers': return this.service.refreshServers(token);
        }

        throw new Error(`Call not found: ${command}`);
    }
}
