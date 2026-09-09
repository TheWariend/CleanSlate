/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class ApprovalQueue<T> {
	private pending: Array<{ request: T; resolve: (approved: boolean) => void }> = [];
	constructor(private readonly show: (request: T | undefined) => void) {}

	request(request: T, signal?: AbortSignal): Promise<boolean> {
		if (signal?.aborted) { return Promise.resolve(false); }
		return new Promise(resolve => {
			const entry = { request, resolve: (approved: boolean) => {
				signal?.removeEventListener('abort', abort);
				resolve(approved);
			} };
			const abort = () => {
				const index = this.pending.indexOf(entry);
				if (index < 0) { return; }
				this.pending.splice(index, 1);
				if (index === 0) { this.show(this.pending[0]?.request); }
				entry.resolve(false);
			};
			signal?.addEventListener('abort', abort, { once: true });
			this.pending.push(entry);
			if (this.pending.length === 1) { this.show(request); }
		});
	}

	decide(approved: boolean): void {
		const current = this.pending.shift();
		this.show(this.pending[0]?.request);
		current?.resolve(approved);
	}

	cancel(): void {
		const pending = this.pending.splice(0);
		this.show(undefined);
		for (const entry of pending) { entry.resolve(false); }
	}
}
