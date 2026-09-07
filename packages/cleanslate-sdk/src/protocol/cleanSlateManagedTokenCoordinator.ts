/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ICleanSlateManagedTokenRefreshResult } from './cleanSlateAI.js';

export type ICleanSlateManagedTokenRefreshResponse = ICleanSlateManagedTokenRefreshResult;

/** Shares successful credential rotations and in-flight refreshes between an
 * account's consumers. Unknown tokens never inherit another account's token. */
export class CleanSlateManagedTokenCoordinator {
	private readonly rotations = new Map<string, ICleanSlateManagedTokenRefreshResponse>();
	private readonly requests = new Map<string, Promise<ICleanSlateManagedTokenRefreshResponse>>();
	private generation = 0;

	constructor(private readonly rotate: (previousToken: string) => Promise<ICleanSlateManagedTokenRefreshResponse>) { }

	resolve(token: string): string {
		return this.resolveResponse(token)?.token ?? token;
	}

	refresh(token: string): Promise<ICleanSlateManagedTokenRefreshResponse> {
		const known = this.resolveResponse(token);
		const current = known?.token ?? token;
		const pending = this.requests.get(current);
		if (pending) {
			return pending;
		}
		if (current !== token && known) {
			return Promise.resolve(known);
		}
		const generation = this.generation;
		// Defer the callback until the request is indexed so synchronous callbacks
		// and concurrent consumers cannot start a second rotation of the same token.
		const request = Promise.resolve().then(() => this.rotate(current)).then(response => {
			if (!response.token) {
				throw new Error('CleanSlate received an invalid session-refresh response. Try again.');
			}
			if (generation === this.generation) {
				this.rotations.set(current, { ...response });
			}
			return response;
		}).finally(() => {
			if (this.requests.get(current) === request) {
				this.requests.delete(current);
			}
		});
		this.requests.set(current, request);
		return request;
	}

	clear(): void {
		this.generation++;
		this.rotations.clear();
		this.requests.clear();
	}

	private resolveResponse(token: string): ICleanSlateManagedTokenRefreshResponse | undefined {
		let response: ICleanSlateManagedTokenRefreshResponse | undefined;
		const visited = new Set<string>();
		while (!visited.has(token)) {
			visited.add(token);
			const next = this.rotations.get(token);
			if (!next) {
				break;
			}
			response = next;
			token = next.token;
		}
		return response;
	}
}
