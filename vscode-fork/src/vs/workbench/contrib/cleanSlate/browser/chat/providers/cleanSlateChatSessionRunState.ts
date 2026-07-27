/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';

export type CleanSlateSessionRunStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

export interface ICleanSlateSessionRunState {
	readonly sessionId: string;
	readonly runId: string;
	readonly workspaceId?: string;
	readonly status: CleanSlateSessionRunStatus;
	readonly startedAt: number;
	readonly updatedAt: number;
	readonly endedAt?: number;
	readonly reason?: string;
}

export class CleanSlateSessionAlreadyRunningError extends Error {
	constructor(readonly sessionId: string) {
		super(`CleanSlate session ${sessionId} already has a running turn.`);
	}
}

export class CleanSlateChatSessionRunState extends Disposable {

	private readonly runs = new Map<string, ICleanSlateSessionRunState>();
	private readonly _onDidChangeStatus = this._register(new Emitter<ICleanSlateSessionRunState>());
	readonly onDidChangeStatus: Event<ICleanSlateSessionRunState> = this._onDidChangeStatus.event;

	start(sessionId: string, workspaceId?: string): ICleanSlateSessionRunState {
		const existing = this.runs.get(sessionId);
		if (existing?.status === 'running') {
			throw new CleanSlateSessionAlreadyRunningError(sessionId);
		}
		const now = Date.now();
		return this.set({
			sessionId,
			workspaceId,
			runId: generateUuid(),
			status: 'running',
			startedAt: now,
			updatedAt: now
		});
	}

	finish(sessionId: string, runId: string, status: Exclude<CleanSlateSessionRunStatus, 'idle' | 'running'>, reason?: string): ICleanSlateSessionRunState | undefined {
		const existing = this.runs.get(sessionId);
		if (!existing || existing.runId !== runId) {
			return undefined;
		}
		const now = Date.now();
		return this.set({
			...existing,
			status,
			reason,
			updatedAt: now,
			endedAt: now
		});
	}

	cancel(sessionId: string, reason?: string): ICleanSlateSessionRunState | undefined {
		const existing = this.runs.get(sessionId);
		if (!existing || existing.status !== 'running') {
			return undefined;
		}
		return this.finish(sessionId, existing.runId, 'cancelled', reason);
	}

	clear(sessionId: string): void {
		this.runs.delete(sessionId);
	}

	isRunning(sessionId: string): boolean {
		return this.runs.get(sessionId)?.status === 'running';
	}

	get(sessionId: string): ICleanSlateSessionRunState | undefined {
		return this.runs.get(sessionId);
	}

	private set(state: ICleanSlateSessionRunState): ICleanSlateSessionRunState {
		this.runs.set(state.sessionId, state);
		this._onDidChangeStatus.fire(state);
		return state;
	}
}
