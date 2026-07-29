/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Slate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Replaces `vs/base/common/hash`.
 *
 * Only `stringHash` is used (by the line diff, to key lines cheaply). The
 * original module also carries SHA-1 and structural hashing, which is why it
 * pulls in `buffer` and `strings`; none of that is needed here.
 *
 * The algorithm is reproduced exactly rather than substituted, because diff
 * results are keyed on it and a different hash would change how lines pair up.
 */

/** Combines a number into a running hash. */
export function numberHash(val: number, initialHashVal: number): number {
	return (((initialHashVal << 5) - initialHashVal) + val) | 0; // hashVal * 31 + ch, keep as int32
}

/** Combines a string into a running hash. */
export function stringHash(s: string, hashVal: number): number {
	hashVal = numberHash(149417, hashVal);
	for (let i = 0, length = s.length; i < length; i++) {
		hashVal = numberHash(s.charCodeAt(i), hashVal);
	}
	return hashVal;
}
