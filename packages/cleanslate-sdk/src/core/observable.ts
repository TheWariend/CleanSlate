/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Slate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from './lifecycle.js';

/**
 * Stands in for `vs/base/common/observable`, which is a facade over the
 * `observableInternal` package.
 *
 * The vendored `event.ts` uses these three names only in type positions, to
 * support `Event.fromObservable`. Declaring the shapes here keeps `event.ts`
 * identical to upstream without vendoring the observable library — the runtime
 * bridges events to its own transports and never constructs an observable.
 */

export interface IObserver {
	beginUpdate<T>(observable: IObservable<T>): void;
	handlePossibleChange<T>(observable: IObservable<T>): void;
	handleChange<T, TChange>(observable: IObservableWithChange<T, TChange>, change: TChange): void;
	endUpdate<T>(observable: IObservable<T>): void;
}

export interface IObservableWithChange<T, TChange = unknown> {
	get(): T;
	reportChanges(): void;
	addObserver(observer: IObserver): void;
	removeObserver(observer: IObserver): void;
	read(reader: unknown): T;
	readonly TChange?: TChange;
}

export type IObservable<T> = IObservableWithChange<T, unknown>;

/** Observables are disposable-adjacent in upstream; kept for signature parity. */
export type IObservableDisposable = IDisposable;
