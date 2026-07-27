/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../../../../platform/ipc/common/mainProcessService.js';
import { InstantiationType, registerSingleton } from '../../../../../platform/instantiation/common/extensions.js';
import { ICleanSlateChannelService } from '../../common/core/cleanSlateChannelService.js';

export class CleanSlateChannelService implements ICleanSlateChannelService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IMainProcessService private readonly mainProcessService: IMainProcessService
	) { }

	getChannel(channelName: string): IChannel {
		return this.mainProcessService.getChannel(channelName);
	}
}

registerSingleton(ICleanSlateChannelService, CleanSlateChannelService, InstantiationType.Delayed);
