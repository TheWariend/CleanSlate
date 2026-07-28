/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Slate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Stands in for `vs/base/common/async` (2,645 lines).
 *
 * The vendored `event.ts` imports exactly one name from it, `CancelablePromise`,
 * and uses it only in a type position. Declaring it here keeps `event.ts`
 * byte-identical to upstream without pulling in the scheduling library.
 */
export interface CancelablePromise<T> extends Promise<T> {
	cancel(): void;
}
