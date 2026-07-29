/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Slate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isMacintosh, isWindows } from './platform.js';

/**
 * Replaces `vs/base/common/process`.
 *
 * `path.ts` needs three things — `cwd()`, `env` and `platform` — and must get
 * them without assuming Node is present: the SDK runs in an editor renderer as
 * well as in a terminal. The original reads the same three through VS Code's
 * sandbox bridge; here the bridge is absent, so a renderer falls through to the
 * web branch and gets the same answers the original gives there.
 */

interface INodeProcessLike {
	platform: string;
	arch?: string;
	env: Record<string, string | undefined>;
	cwd(): string;
	versions?: { node?: string };
}

declare const process: INodeProcessLike | undefined;

const nodeProcess = typeof process !== 'undefined' && typeof process?.versions?.node === 'string'
	? process
	: undefined;

/**
 * The working directory in Node; `/` everywhere else, as in the original.
 *
 * @skipMangle
 */
export const cwd: () => string = nodeProcess
	? () => nodeProcess.env['VSCODE_CWD'] || nodeProcess.cwd()
	: () => '/';

/** The environment in Node; empty everywhere else, as in the original. */
export const env: Record<string, string | undefined> = nodeProcess ? nodeProcess.env : {};

/** The OS in Node; derived from the platform booleans everywhere else. */
export const platform: string = nodeProcess
	? nodeProcess.platform
	: (isWindows ? 'win32' : isMacintosh ? 'darwin' : 'linux');

/** The architecture in Node; `undefined` everywhere else, as in the original. */
export const arch: string | undefined = nodeProcess ? nodeProcess.arch : undefined;
