/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Event, Emitter } from '../../../../../base/common/event.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { ICleanSlateConfigurationService, ICleanSlateIndexService, ISearchResult } from '../../common/core/cleanSlateAI.js';
import { ICleanSlateChannelService } from '../../common/core/cleanSlateChannelService.js';

export class CleanSlateIndexServiceProxy extends Disposable implements ICleanSlateIndexService {

	readonly _serviceBrand: undefined;
	private _isIndexing = false;
	private readonly _onDidStatusChange = this._register(new Emitter<boolean>());
	readonly onDidStatusChange: Event<boolean> = this._onDidStatusChange.event;

	constructor(
		@ICleanSlateChannelService private readonly channelService: ICleanSlateChannelService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@ICleanSlateConfigurationService private readonly configService: ICleanSlateConfigurationService
	) {
		super();
		const channel = this.tryGetChannel();
		if (channel) {
			const remoteStatus = channel.listen<boolean>('onDidStatusChange');
			this._register(remoteStatus(value => {
				// Keep the local snapshot in sync for synchronous UI checks.
				this._isIndexing = value;
				this._onDidStatusChange.fire(value);
			}));
		}
	}

	get isIndexing(): boolean {
		return this._isIndexing;
	}

	async indexWorkspace(): Promise<void> {
		const channel = this.tryGetChannel();
		if (!channel) {
			return;
		}

		try {
			await channel.call('indexWorkspace', { options: await this.getNodeIndexOptions() });
		} catch {
			// Indexing is an optional acceleration path. A dead index backend must not
			// take chat or agent execution down with it.
			this._isIndexing = false;
			this._onDidStatusChange.fire(false);
		}
	}

	async search(query: string, limit?: number, threshold?: number): Promise<ISearchResult[]> {
		const channel = this.tryGetChannel();
		if (!channel) {
			return [];
		}

		try {
			return await channel.call('search', { query, limit, threshold, options: await this.getNodeIndexOptions() });
		} catch {
			return [];
		}
	}

	private async getNodeIndexOptions() {
		return {
			workspaceFolders: this.contextService.getWorkspace().folders.map(folder => folder.uri.toString()),
			config: await this.configService.getResolvedConfiguration()
		};
	}

	private tryGetChannel() {
		try {
			return this.channelService.getChannel('cleanSlateIndex');
		} catch {
			return undefined;
		}
	}
}
