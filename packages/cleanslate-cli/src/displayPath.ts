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
 * Paths outside the current home directory are left unchanged and may still
 * contain personal information.
 */
export function displayPath(target: string, home: string = os.homedir()): string {
	if (!target) {
		return target;
	}
	if (!home || !path.isAbsolute(target)) {
		return target;
	}

	const relative = path.relative(home, target);
	if (!relative) {
		return '~';
	}
	if (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
		return `~${path.sep}${relative}`;
	}

	return target;
}
