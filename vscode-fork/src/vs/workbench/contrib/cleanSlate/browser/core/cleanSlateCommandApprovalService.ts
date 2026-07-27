/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';

export const ICleanSlateCommandApprovalService = createDecorator<ICleanSlateCommandApprovalService>('cleanSlateCommandApprovalService');

export interface ICleanSlateCommandApprovalRequest {
	readonly id: string;
	readonly sessionId?: string;
	readonly command: string;
	readonly cwd?: string;
	readonly reason?: string;
	readonly toolName?: string;
	readonly toolCallId?: string;
	readonly createdAt: number;
}

export interface ICleanSlateCommandApprovalResolution {
	readonly request: ICleanSlateCommandApprovalRequest;
	readonly approved: boolean;
}

export type CleanSlateCommandApprovalChatResult = 'approved' | 'rejected' | 'invalid' | 'none';

export interface ICleanSlateCommandApprovalService {
	readonly _serviceBrand: undefined;
	readonly onDidRequestApproval: Event<ICleanSlateCommandApprovalRequest>;
	readonly onDidResolveApproval: Event<ICleanSlateCommandApprovalResolution>;
	readonly onDidChangeApprovalRequests: Event<void>;
	requestApproval(request: {
		readonly id?: string;
		readonly sessionId?: string;
		readonly command: string;
		readonly cwd?: string;
		readonly reason?: string;
		readonly toolName?: string;
		readonly toolCallId?: string;
	}): Promise<boolean>;
	approve(id: string): boolean;
	approveForSession(id: string): boolean;
	reject(id: string): boolean;
	rejectAll(sessionId?: string): void;
	hasPendingApproval(sessionId?: string): boolean;
	getPendingApproval(sessionId?: string): ICleanSlateCommandApprovalRequest | undefined;
	getPendingApprovals(sessionId?: string): readonly ICleanSlateCommandApprovalRequest[];
	resolveFromChat(text: string, sessionId?: string): CleanSlateCommandApprovalChatResult;
}

interface IStoredCommandApproval {
	readonly request: ICleanSlateCommandApprovalRequest;
	readonly resolve: (approved: boolean) => void;
}

export class CleanSlateCommandApprovalService extends Disposable implements ICleanSlateCommandApprovalService {
	declare readonly _serviceBrand: undefined;

	private readonly pending = new Map<string, IStoredCommandApproval>();
	private readonly sessionApprovedCommands = new Set<string>();
	private readonly _onDidRequestApproval = this._register(new Emitter<ICleanSlateCommandApprovalRequest>());
	readonly onDidRequestApproval = this._onDidRequestApproval.event;
	private readonly _onDidResolveApproval = this._register(new Emitter<ICleanSlateCommandApprovalResolution>());
	readonly onDidResolveApproval = this._onDidResolveApproval.event;
	private readonly _onDidChangeApprovalRequests = this._register(new Emitter<void>());
	readonly onDidChangeApprovalRequests = this._onDidChangeApprovalRequests.event;
	private nextId = 1;

	requestApproval(request: {
		readonly id?: string;
		readonly sessionId?: string;
		readonly command: string;
		readonly cwd?: string;
		readonly reason?: string;
		readonly toolName?: string;
		readonly toolCallId?: string;
	}): Promise<boolean> {
		const command = request.command.trim();
		if (!command) {
			return Promise.resolve(false);
		}

		const approvalKey = this.getSessionApprovalKey({
			sessionId: request.sessionId,
			command,
			cwd: request.cwd,
			toolName: request.toolName
		});
		if (this.sessionApprovedCommands.has(approvalKey)) {
			return Promise.resolve(true);
		}

		const id = request.id || `cmd-approval-${Date.now()}-${this.nextId++}`;
		const approvalRequest: ICleanSlateCommandApprovalRequest = {
			id,
			sessionId: request.sessionId,
			command,
			cwd: request.cwd,
			reason: request.reason,
			toolName: request.toolName,
			toolCallId: request.toolCallId,
			createdAt: Date.now()
		};

		return new Promise<boolean>(resolve => {
			this.pending.set(id, { request: approvalRequest, resolve });
			this._onDidRequestApproval.fire(approvalRequest);
			this._onDidChangeApprovalRequests.fire();
		});
	}

	approve(id: string): boolean {
		return this.settle(id, true);
	}

	approveForSession(id: string): boolean {
		const entry = this.pending.get(id);
		if (!entry) {
			return false;
		}
		this.sessionApprovedCommands.add(this.getSessionApprovalKey(entry.request));
		return this.settle(id, true);
	}

	reject(id: string): boolean {
		return this.settle(id, false);
	}

	rejectAll(sessionId?: string): void {
		for (const [id, entry] of [...this.pending.entries()]) {
			if (!sessionId || entry.request.sessionId === sessionId) {
				this.settle(id, false);
			}
		}
	}

	hasPendingApproval(sessionId?: string): boolean {
		return this.getPendingApprovals(sessionId).length > 0;
	}

	getPendingApproval(sessionId?: string): ICleanSlateCommandApprovalRequest | undefined {
		const requests = this.getPendingApprovals(sessionId);
		return requests[requests.length - 1];
	}

	getPendingApprovals(sessionId?: string): readonly ICleanSlateCommandApprovalRequest[] {
		return [...this.pending.values()]
			.map(entry => entry.request)
			.filter(request => !sessionId || request.sessionId === sessionId);
	}

	resolveFromChat(text: string, sessionId?: string): CleanSlateCommandApprovalChatResult {
		const request = this.getPendingApproval(sessionId);
		if (!request) {
			return 'none';
		}

		const normalized = text.trim().toLowerCase().replace(/[.,]+/g, '').replace(/\s+/g, ' ');
		const plain = normalized.replace(/['\u2019]/g, '');
		if (/^(y|yes|run|approve|approved|ok|okay|continue|proceed|go|go ahead)$/i.test(plain)) {
			return this.approve(request.id) ? 'approved' : 'none';
		}
		if (/^(yes always|yes session|approve session|approve for session|always|dont ask again|yes dont ask again|yes and dont ask again|yes dont ask again this session|yes and dont ask again this session)$/i.test(plain)) {
			return this.approveForSession(request.id) ? 'approved' : 'none';
		}
		if (/^(n|no|cancel|reject|rejected|stop|deny|denied)$/i.test(plain)) {
			return this.reject(request.id) ? 'rejected' : 'none';
		}

		return 'invalid';
	}

	private settle(id: string, approved: boolean): boolean {
		const entry = this.pending.get(id);
		if (!entry) {
			return false;
		}

		this.pending.delete(id);
		entry.resolve(approved);
		queueMicrotask(() => {
			this._onDidResolveApproval.fire({ request: entry.request, approved });
			this._onDidChangeApprovalRequests.fire();
		});
		return true;
	}

	private getSessionApprovalKey(request: Pick<ICleanSlateCommandApprovalRequest, 'sessionId' | 'command' | 'cwd' | 'toolName'>): string {
		return [
			request.sessionId || '',
			request.cwd || '',
			request.toolName || '',
			request.command.trim()
		].join('\n');
	}
}
