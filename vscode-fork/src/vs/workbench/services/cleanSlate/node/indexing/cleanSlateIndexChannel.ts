/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { IServerChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { ICleanSlateIndexService } from '../../common/core/cleanSlateAI.js';
import { ICleanSlateNodeIndexOptions } from './cleanSlateNodeIndexService.js';

export class CleanSlateIndexChannel implements IServerChannel {

	constructor(private readonly service: ICleanSlateIndexService) { }

	listen<T>(_: unknown, event: string): Event<T> {
		switch (event) {
			case 'onDidStatusChange':
				return this.service.onDidStatusChange as unknown as Event<T>;
		}

		throw new Error(`Event not found: ${event}`);
	}

	call(_: unknown, command: string, arg?: any): Promise<any> {
		switch (command) {
			case 'indexWorkspace':
				if (arg?.options && this.hasNodeOptions(this.service)) {
					return this.service.indexWorkspaceWithOptions(arg.options);
				}
				return this.service.indexWorkspace();
			case 'search':
				if (arg?.options && this.hasNodeOptions(this.service)) {
					return this.service.searchWithOptions({ ...arg.options, query: arg.query, limit: arg.limit, threshold: arg.threshold });
				}
				return this.service.search(arg.query, arg.limit, arg.threshold);
		}

		throw new Error(`Call not found: ${command}`);
	}

	private hasNodeOptions(service: ICleanSlateIndexService): service is ICleanSlateIndexService & {
		indexWorkspaceWithOptions(options: ICleanSlateNodeIndexOptions): Promise<void>;
		searchWithOptions(options: ICleanSlateNodeIndexOptions & { query: string; limit?: number; threshold?: number }): Promise<any>;
	} {
		return typeof (service as any).indexWorkspaceWithOptions === 'function'
			&& typeof (service as any).searchWithOptions === 'function';
	}
}
