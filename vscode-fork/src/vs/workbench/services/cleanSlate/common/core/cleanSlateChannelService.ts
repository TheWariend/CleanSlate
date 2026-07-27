/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';

export const ICleanSlateChannelService = createDecorator<ICleanSlateChannelService>('cleanSlateChannelService');

/**
 * Renderer-safe access to CleanSlate's desktop IPC channels.
 * The Electron implementation owns the main-process dependency.
 */
export interface ICleanSlateChannelService {
	readonly _serviceBrand: undefined;
	getChannel(channelName: string): IChannel;
}
