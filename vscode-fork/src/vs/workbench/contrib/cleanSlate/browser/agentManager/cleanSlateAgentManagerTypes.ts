/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import type { ICleanSlateSessionSnapshot } from '../chat/types/cleanSlateChatSessionTypes.js';

export interface ICleanSlateWorkspaceEntry {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly current?: boolean;
	readonly folderUri?: URI;
	readonly workspaceUri?: URI;
	readonly workspaceId?: string;
}

export interface ICleanSlateProjectThreadGroup {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly current?: boolean;
	readonly entry?: ICleanSlateWorkspaceEntry;
	readonly sessions: readonly ICleanSlateSessionSnapshot[];
}

export interface ICleanSlateWorkspaceIdentity {
	readonly path: readonly string[];
	readonly id: readonly string[];
	readonly name: readonly string[];
}

export type CleanSlateAgentManagerRightTab = 'review' | 'artifacts' | 'browser' | 'terminal' | 'file';
