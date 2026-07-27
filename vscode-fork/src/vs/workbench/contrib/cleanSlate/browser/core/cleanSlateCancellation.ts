/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';

export function cancellationTokenFromAbortSignal(signal?: AbortSignal): CancellationToken {
	if (!signal) {
		return CancellationToken.None;
	}
	if (signal.aborted) {
		return CancellationToken.Cancelled;
	}

	return {
		get isCancellationRequested(): boolean {
			return signal.aborted;
		},
		onCancellationRequested: (listener: (event: void) => unknown, thisArgs?: unknown, disposables?: IDisposable[]): IDisposable => {
			if (signal.aborted) {
				return CancellationToken.Cancelled.onCancellationRequested(listener, thisArgs, disposables);
			}
			const onAbort = () => listener.call(thisArgs, undefined);
			signal.addEventListener('abort', onAbort, { once: true });
			const disposable = toDisposable(() => signal.removeEventListener('abort', onAbort));
			disposables?.push(disposable);
			return disposable;
		}
	};
}

export function linkAbortSignals(...signals: Array<AbortSignal | undefined>): { signal: AbortSignal; dispose: () => void } {
	const activeSignals = signals.filter((signal): signal is AbortSignal => !!signal);
	if (activeSignals.length === 0) {
		const controller = new AbortController();
		return { signal: controller.signal, dispose: () => undefined };
	}

	const controller = new AbortController();
	const listeners: Array<{ signal: AbortSignal; listener: () => void }> = [];
	for (const signal of activeSignals) {
		if (signal.aborted) {
			controller.abort();
			break;
		}
		const listener = () => controller.abort();
		signal.addEventListener('abort', listener, { once: true });
		listeners.push({ signal, listener });
	}
	return {
		signal: controller.signal,
		dispose: () => {
			for (const entry of listeners) {
				entry.signal.removeEventListener('abort', entry.listener);
			}
		}
	};
}
