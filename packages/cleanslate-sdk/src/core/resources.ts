/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Slate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as paths from './path.js';
import { URI, uriToFsPath } from './uri.js';
import { isWindows } from './platform.js';

/**
 * Replaces `vs/base/common/resources`.
 *
 * The original is a general URI-path library parameterised by a case-sensitivity
 * predicate, and reaching it drags in `extpath`, `network`, `strings`, VS Code's
 * `path` port and — through `platform` — `vs/nls`. That is ~25 files to get six
 * functions.
 *
 * This reimplements exactly those six on the vendored `path` port. Two
 * simplifications are safe and deliberate:
 *
 * - The exported helpers in the original all bind to `extUri`, which is
 *   constructed with `() => false` for path casing. So path comparison here is
 *   always case-sensitive, matching what the callers actually got.
 * - Only the `file` scheme takes the OS-path branch; every other scheme is
 *   treated as posix, which is what the original does via `Schemas.file`.
 *
 * Authority comparison stays case-insensitive, as in the original.
 */

const FILE_SCHEME = 'file';

/** `uri.fsPath` but preserving drive-letter casing, as the original does. */
function originalFSPath(uri: URI): string {
	return uriToFsPath(uri, true);
}

function isEqualAuthority(a1: string | undefined, a2: string | undefined): boolean {
	return a1 === a2 || (a1 !== undefined && a2 !== undefined && a1.toLowerCase() === a2.toLowerCase());
}

/** `osPath` with every separator turned into a forward slash. */
function toSlashes(osPath: string): string {
	return osPath.replace(/[\\/]/g, '/');
}

/**
 * Whether `parentCandidate` is `base` or one of its ancestors. Case-sensitive,
 * and it will not treat `/foo/barbaz` as living under `/foo/bar`.
 */
function pathIsEqualOrParent(base: string, parentCandidate: string, separator: string): boolean {
	if (base === parentCandidate) {
		return true;
	}
	if (!base || !parentCandidate) {
		return false;
	}
	if (parentCandidate.length > base.length) {
		return false;
	}
	if (parentCandidate.charAt(parentCandidate.length - 1) !== separator) {
		parentCandidate += separator;
	}
	return base.indexOf(parentCandidate) === 0;
}

export function isEqualOrParent(base: URI, parentCandidate: URI, ignoreFragment: boolean = false): boolean {
	if (base.scheme !== parentCandidate.scheme) {
		return false;
	}
	if (base.scheme === FILE_SCHEME) {
		return pathIsEqualOrParent(originalFSPath(base), originalFSPath(parentCandidate), paths.sep)
			&& base.query === parentCandidate.query
			&& (ignoreFragment || base.fragment === parentCandidate.fragment);
	}
	if (isEqualAuthority(base.authority, parentCandidate.authority)) {
		return pathIsEqualOrParent(base.path, parentCandidate.path, '/')
			&& base.query === parentCandidate.query
			&& (ignoreFragment || base.fragment === parentCandidate.fragment);
	}
	return false;
}

export function joinPath(resource: URI, ...pathFragment: string[]): URI {
	return URI.joinPath(resource, ...pathFragment);
}

export function basename(resource: URI): string {
	return paths.posix.basename(resource.path);
}

export function extname(resource: URI): string {
	return paths.posix.extname(resource.path);
}

export function basenameOrAuthority(resource: URI): string {
	return basename(resource) || resource.authority;
}

export function dirname(resource: URI): URI {
	if (resource.path.length === 0) {
		return resource;
	}
	let dir: string;
	if (resource.scheme === FILE_SCHEME) {
		dir = URI.file(paths.dirname(originalFSPath(resource))).path;
	} else {
		dir = paths.posix.dirname(resource.path);
		if (resource.authority && dir.length && dir.charCodeAt(0) !== /* '/' */ 47) {
			// A URI with an authority must have an empty or absolute path.
			dir = '/';
		}
	}
	return resource.with({ path: dir });
}

export function normalizePath(resource: URI): URI {
	if (!resource.path.length) {
		return resource;
	}
	let normalized: string;
	if (resource.scheme === FILE_SCHEME) {
		normalized = URI.file(paths.normalize(originalFSPath(resource))).path;
	} else {
		normalized = paths.posix.normalize(resource.path);
	}
	return resource.with({ path: normalized });
}

export function relativePath(from: URI, to: URI): string | undefined {
	if (from.scheme !== to.scheme || !isEqualAuthority(from.authority, to.authority)) {
		return undefined;
	}
	if (from.scheme === FILE_SCHEME) {
		const relative = paths.relative(originalFSPath(from), originalFSPath(to));
		return isWindows ? toSlashes(relative) : relative;
	}
	return paths.posix.relative(from.path || '/', to.path || '/');
}
