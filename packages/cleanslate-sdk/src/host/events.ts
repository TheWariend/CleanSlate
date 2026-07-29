/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Slate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../core/lifecycle.js';

/**
 * An event, as seen across the host boundary.
 *
 * The runtime has its own `Event<T>` in `core/event.ts`, vendored from the
 * editor, and so does the editor itself — two copies of the same declaration,
 * which TypeScript treats as two different types. They differ only in the third
 * parameter, `disposables?: IDisposable[] | DisposableStore`: `DisposableStore`
 * is a class with private fields, so it is compared by identity, and neither
 * copy's `Event` is assignable to the other's in either direction.
 *
 * Contracts a surface implements therefore use this instead. It declares only
 * the one parameter anything actually passes across the boundary, which makes
 * it assignable both ways: an editor `Event` can satisfy it, and it can satisfy
 * an editor `Event`. Inside the runtime, keep using `Event<T>` — `Emitter`
 * produces one, and it is assignable to this.
 */
export interface Subscribable<T> {
	(listener: (e: T) => unknown): IDisposable;
}
