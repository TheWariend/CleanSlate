/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../core/event.js';
import type { ICleanSlateThreadMessage } from './cleanSlateThreadService.js';

export type CleanSlateConversationKind = 'primary' | 'side-chat' | 'child-agent';

export interface ICleanSlateConversationBranch {
	id: string;
	parentId?: string;
	kind: CleanSlateConversationKind;
	title: string;
	createdAt: number;
	updatedAt: number;
	messages: ICleanSlateThreadMessage[];
}

/** A small, renderer-free conversation tree for SDK hosts. */
export class CleanSlateConversationBranchService {
	private readonly branches = new Map<string, ICleanSlateConversationBranch>();
	private readonly _onDidChangeBranch = new Emitter<ICleanSlateConversationBranch>();
	readonly onDidChangeBranch: Event<ICleanSlateConversationBranch> = this._onDidChangeBranch.event;

	constructor(
		private readonly createId: () => string = () => `conversation-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
		private readonly now: () => number = Date.now
	) { }

	createBranch(options: {
		parentId?: string;
		kind?: CleanSlateConversationKind;
		title?: string;
		inheritMessages?: boolean;
	} = {}): ICleanSlateConversationBranch {
		const parent = options.parentId ? this.branches.get(options.parentId) : undefined;
		if (options.parentId && !parent) {
			throw new Error(`Unknown parent conversation: ${options.parentId}`);
		}
		const timestamp = this.now();
		const branch: ICleanSlateConversationBranch = {
			id: this.createId(),
			parentId: options.parentId,
			kind: options.kind ?? (parent ? 'side-chat' : 'primary'),
			title: options.title?.trim() || (parent ? 'Side chat' : 'Conversation'),
			createdAt: timestamp,
			updatedAt: timestamp,
			messages: options.inheritMessages && parent ? parent.messages.map(message => ({ ...message, images: message.images ? [...message.images] : undefined })) : []
		};
		this.branches.set(branch.id, branch);
		return this.publish(branch);
	}

	getBranch(id: string): ICleanSlateConversationBranch | undefined {
		const branch = this.branches.get(id);
		return branch ? this.clone(branch) : undefined;
	}

	listBranches(parentId?: string): ICleanSlateConversationBranch[] {
		return Array.from(this.branches.values())
			.filter(branch => parentId === undefined || branch.parentId === parentId)
			.map(branch => this.clone(branch))
			.sort((left, right) => left.createdAt - right.createdAt);
	}

	appendMessage(id: string, message: ICleanSlateThreadMessage): ICleanSlateConversationBranch {
		const branch = this.branches.get(id);
		if (!branch) {
			throw new Error(`Unknown conversation: ${id}`);
		}
		branch.messages.push({ ...message, images: message.images ? [...message.images] : undefined });
		branch.updatedAt = this.now();
		return this.publish(branch);
	}

	removeBranch(id: string): boolean {
		if (Array.from(this.branches.values()).some(branch => branch.parentId === id)) {
			throw new Error('Remove child conversations before removing their parent.');
		}
		return this.branches.delete(id);
	}

	private publish(branch: ICleanSlateConversationBranch): ICleanSlateConversationBranch {
		const snapshot = this.clone(branch);
		this._onDidChangeBranch.fire(snapshot);
		return snapshot;
	}

	private clone(branch: ICleanSlateConversationBranch): ICleanSlateConversationBranch {
		return {
			...branch,
			messages: branch.messages.map(message => ({ ...message, images: message.images ? [...message.images] : undefined }))
		};
	}
}
