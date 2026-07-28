/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Slate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createCleanSlateNodeToolContext, ICleanSlateNodeRuntimeOptions } from './cleanSlateNodeToolContext.js';

export { CleanSlateHeadlessRuntime } from './cleanSlateHeadlessRunner.js';
export { createCleanSlateNodeToolContext } from './cleanSlateNodeToolContext.js';
export type { ICleanSlateNodeRuntimeOptions } from './cleanSlateNodeToolContext.js';
export { CleanSlateNodeTextModel } from './cleanSlateNodeTextModel.js';
export {
	CleanSlateNodeFileService,
	CleanSlateNodeModelService,
	CleanSlateNodeTextFileService
} from './cleanSlateNodeFileServices.js';
export { CleanSlateNodeCommandService } from './cleanSlateNodeCommandService.js';

/**
 * Assembles a tool context rooted at a directory on disk.
 *
 * This is the seam a terminal or server front-end builds on: the filesystem
 * backs the models, a child process runs commands, and the capabilities that
 * only exist to move an editor's UI are present but inert.
 *
 * The model provider is not assembled here — a surface supplies its own, since
 * where credentials come from and how a request is proxied is the surface's
 * concern.
 */
export function createNodeHost(options: ICleanSlateNodeRuntimeOptions) {
	return createCleanSlateNodeToolContext(options);
}
