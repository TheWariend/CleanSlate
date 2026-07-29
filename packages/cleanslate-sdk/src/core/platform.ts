/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Slate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Replaces `vs/base/common/platform`.
 *
 * The original module carries VS Code's locale resolution, which is the only
 * reason it imports `vs/nls`. The runtime needs none of that — just which OS it
 * is on, so that URI can reproduce Windows path semantics.
 *
 * The three sources are the original's, in the original's order: an editor
 * renderer exposes the OS on its sandbox bridge, Node exposes it on `process`,
 * and a plain browser only has the user agent. Getting this wrong on Windows
 * means URI stops recognising drive letters, so the sandbox branch is not
 * optional for the editor surface.
 */

interface ISandboxBridge {
	process?: { platform?: string };
}

function detectPlatform(): string {
	const sandbox = (globalThis as { vscode?: ISandboxBridge }).vscode;
	if (sandbox?.process?.platform) {
		return sandbox.process.platform;
	}

	if (typeof process !== 'undefined' && process.platform) {
		return process.platform;
	}

	const userAgent = (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent;
	if (userAgent) {
		if (userAgent.indexOf('Windows') >= 0) {
			return 'win32';
		}
		if (userAgent.indexOf('Macintosh') >= 0) {
			return 'darwin';
		}
	}

	return 'linux';
}

const platform = detectPlatform();

export const isWindows = platform === 'win32';
export const isMacintosh = platform === 'darwin';
export const isLinux = platform === 'linux';
