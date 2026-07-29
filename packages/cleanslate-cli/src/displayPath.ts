/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import os from 'node:os';
import path from 'node:path';

/**
 * A path as it should appear on screen.
 *
 * Absolute paths under the home directory are abbreviated to `~`, the way a
 * shell prompt does. That keeps the account name out of the header — which
 * matters because the header is the part of the CLI that ends up in
 * screenshots, screen shares and bug reports.
 *
 * Anything outside the home directory is left alone: shortening it would be
 * misleading, and there is no name to hide.
 */
export function displayPath(target: string, home: string = os.homedir()): string {
	if (!target) {
		return target;
	}
	if (!home || !path.isAbsolute(target)) {
		return target;
	}

	const normalizedHome = home.replace(/[/\\]+$/, '');
	// Strip a trailing separator so `/home/me/` reads as `~`, not `~/`.
	const normalizedTarget = target.length > 1 ? target.replace(/[/\\]+$/, '') : target;
	if (normalizedTarget === normalizedHome) {
		return '~';
	}

	// Only abbreviate a real path segment, so `/Users/mazin-old` is not
	// mistaken for something under `/Users/mazin`.
	const prefix = normalizedHome + path.sep;
	if (normalizedTarget.startsWith(prefix)) {
		return '~' + path.sep + normalizedTarget.slice(prefix.length);
	}

	return target;
}
