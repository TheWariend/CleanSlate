/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Slate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Replaces `vs/base/common/platform`.
 *
 * The original module carries VS Code's locale resolution, which is the only
 * reason it imports `vs/nls`. The runtime needs none of that — just which OS it
 * is on, so that URI can reproduce Windows path semantics. Written against
 * `process` directly because the SDK targets Node.
 */

const platform = typeof process !== 'undefined' && process.platform ? process.platform : 'linux';

export const isWindows = platform === 'win32';
export const isMacintosh = platform === 'darwin';
export const isLinux = platform === 'linux';
