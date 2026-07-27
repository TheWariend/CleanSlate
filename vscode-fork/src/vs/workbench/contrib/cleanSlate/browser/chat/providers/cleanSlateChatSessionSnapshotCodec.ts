/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from '../../../../../../base/common/uuid.js';
import {
	cloneCleanSlateSessionMessages,
	ICleanSlateSessionMessage,
	ICleanSlateTranscriptMessage,
	normalizeCleanSlateTranscriptOrder
} from '../types/cleanSlateChatSessionTypes.js';

/** Owns defensive cloning and structural equality for persisted chat-session state. */
export class CleanSlateChatSessionSnapshotCodec {
	public cloneHistory(history: readonly ICleanSlateSessionMessage[]): ICleanSlateSessionMessage[] {
		return cloneCleanSlateSessionMessages(history).map(message => ({
			role: message.role,
			content: message.content,
			isInternalState: message.isInternalState,
			renderPayload: message.renderPayload,
			images: message.images
		}));
	}

	public cloneHistoryWithTranscriptImages(
		history: readonly ICleanSlateSessionMessage[],
		transcript: readonly ICleanSlateTranscriptMessage[] | undefined
	): ICleanSlateSessionMessage[] {
		const cloned = this.cloneHistory(history);
		if (!transcript?.length) {
			return cloned;
		}
		let transcriptCursor = 0;
		return cloned.map(message => {
			const relativeTranscriptIndex = transcript.slice(transcriptCursor).findIndex(candidate => candidate.role === message.role && candidate.content === message.content);
			if (relativeTranscriptIndex === -1) {
				return message;
			}
			const transcriptIndex = transcriptCursor + relativeTranscriptIndex;
			transcriptCursor = transcriptIndex + 1;
			if (message.images?.length) {
				return message;
			}
			const images = transcript[transcriptIndex].images;
			return images?.length ? { ...message, images: [...images] } : message;
		});
	}

	public cloneTranscript(history: readonly ICleanSlateSessionMessage[]): ICleanSlateTranscriptMessage[] {
		return normalizeCleanSlateTranscriptOrder(cloneCleanSlateSessionMessages(history).map(message => ({
			id: typeof (message as ICleanSlateTranscriptMessage).id === 'string' ? (message as ICleanSlateTranscriptMessage).id : generateUuid(),
			role: message.role,
			content: message.content,
			isInternalState: message.isInternalState,
			renderPayload: message.renderPayload,
			images: message.images
		})));
	}

	public cloneObject<T>(snapshot: T | undefined): T | undefined {
		if (!snapshot || typeof snapshot !== 'object') {
			return snapshot;
		}
		try {
			return JSON.parse(JSON.stringify(snapshot)) as T;
		} catch {
			return snapshot;
		}
	}

	public areTranscriptsEqual(left: readonly ICleanSlateTranscriptMessage[], right: readonly ICleanSlateTranscriptMessage[]): boolean {
		if (left.length !== right.length) {
			return false;
		}
		return left.every((message, index) => message.id === right[index].id
			&& message.role === right[index].role
			&& message.content === right[index].content
			&& message.isInternalState === right[index].isInternalState
			&& message.renderPayload === right[index].renderPayload
			&& this.areStringArraysEqual(message.images, right[index].images));
	}

	public areHistoriesEqual(
		left: readonly { role: string; content: string; isInternalState?: boolean; renderPayload?: string; images?: string[] }[],
		right: readonly { role: string; content: string; isInternalState?: boolean; renderPayload?: string; images?: string[] }[]
	): boolean {
		if (left.length !== right.length) {
			return false;
		}
		return left.every((message, index) => message.role === right[index].role
			&& message.content === right[index].content
			&& message.isInternalState === right[index].isInternalState
			&& message.renderPayload === right[index].renderPayload
			&& this.areStringArraysEqual(message.images, right[index].images));
	}

	public areStringArraysEqual(first: readonly string[] | undefined, second: readonly string[] | undefined): boolean {
		if (!first?.length && !second?.length) {
			return true;
		}
		return !!first && !!second && first.length === second.length && first.every((value, index) => value === second[index]);
	}
}
