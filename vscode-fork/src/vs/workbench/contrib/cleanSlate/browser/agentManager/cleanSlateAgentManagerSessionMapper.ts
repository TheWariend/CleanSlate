/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import type { ICleanSlatePersistedSession, ICleanSlatePersistedThreadMessage } from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { deriveCleanSlateTranscriptFromHistory, normalizeCleanSlateSessionExecutionState, type ICleanSlateSessionMessage, type ICleanSlateSessionSnapshot, type ICleanSlateTranscriptMessage } from '../chat/types/cleanSlateChatSessionTypes.js';

export class CleanSlateAgentManagerSessionMapper {

	toSessionSnapshot(session: ICleanSlatePersistedSession | undefined): ICleanSlateSessionSnapshot | undefined {
		if (!session || typeof session.id !== 'string') {
			return undefined;
		}
		const history = Array.isArray(session.history)
			? session.history.map(message => this.toSessionMessage(message)).filter((message): message is ICleanSlateSessionMessage => !!message)
			: [];
		const transcript = Array.isArray(session.transcript)
			? session.transcript.map(message => this.toTranscriptMessage(message)).filter((message): message is ICleanSlateTranscriptMessage => !!message)
			: undefined;
		const effectiveTranscript = transcript?.length ? transcript : deriveCleanSlateTranscriptFromHistory(history);
		if (!this.hasVisibleSessionContentData(history, effectiveTranscript)) {
			return undefined;
		}
		const savedAt = Number.isFinite(session.savedAt) ? session.savedAt : Date.now();
		const updatedAt = Number.isFinite(session.updatedAt) ? session.updatedAt : savedAt;
		const title = typeof session.title === 'string' && session.title.trim()
			? session.title
			: this.deriveSessionTitle(history);
		const executionState = normalizeCleanSlateSessionExecutionState(session);
		return {
			id: session.id,
			parentSessionId: session.parentSessionId,
			createdAt: session.createdAt,
			title,
			savedAt,
			updatedAt,
			workspaceId: session.workspaceId,
			projectRoot: session.projectRoot,
			workDir: session.workDir,
			status: this.toRestoredSessionStatus(session.status),
			sessionKey: session.sessionKey,
			history,
			transcript: effectiveTranscript,
			transcriptVersion: session.transcriptVersion,
			taskState: session.taskState as ICleanSlateSessionSnapshot['taskState'],
			threadState: session.threadState as ICleanSlateSessionSnapshot['threadState'],
			agentRuntimeState: session.agentRuntimeState as ICleanSlateSessionSnapshot['agentRuntimeState'],
			planMode: executionState.planMode,
			reasoningLevel: executionState.reasoningLevel,
			agent: session.agent as ICleanSlateSessionSnapshot['agent'],
			workspaceName: session.workspaceName,
			isGenerating: false
		};
	}

	toPersistedSession(snapshot: ICleanSlateSessionSnapshot): ICleanSlatePersistedSession {
		const executionState = normalizeCleanSlateSessionExecutionState(snapshot);
		return {
			id: snapshot.id,
			parentSessionId: snapshot.parentSessionId,
			createdAt: snapshot.createdAt,
			title: snapshot.title,
			savedAt: snapshot.savedAt,
			updatedAt: Date.now(),
			workspaceId: snapshot.workspaceId,
			projectRoot: snapshot.projectRoot,
			workDir: snapshot.workDir,
			status: this.toRestoredSessionStatus(snapshot.status),
			isGenerating: undefined,
			sessionKey: snapshot.sessionKey,
			workspaceName: snapshot.workspaceName,
			planMode: executionState.planMode,
			reasoningLevel: executionState.reasoningLevel,
			history: this.toPersistedMessages(snapshot.history),
			transcript: this.toPersistedMessages(snapshot.transcript?.length ? snapshot.transcript : deriveCleanSlateTranscriptFromHistory(snapshot.history)),
			transcriptVersion: snapshot.transcriptVersion ?? 1,
			taskState: snapshot.taskState,
			threadState: snapshot.threadState,
			agentRuntimeState: snapshot.agentRuntimeState,
			agent: snapshot.agent
		};
	}

	hasVisibleSessionContent(session: ICleanSlateSessionSnapshot): boolean {
		return this.hasVisibleSessionContentData(
			session.history,
			session.transcript?.length ? session.transcript : deriveCleanSlateTranscriptFromHistory(session.history)
		);
	}

	private toPersistedMessages(messages: readonly ICleanSlateSessionMessage[]): ICleanSlatePersistedThreadMessage[] {
		return messages.map(message => ({
			role: message.role,
			content: message.content,
			isInternalState: message.isInternalState,
			renderPayload: message.renderPayload,
			images: Array.isArray(message.images) ? message.images.filter((image): image is string => typeof image === 'string') : undefined
		}));
	}

	private toRestoredSessionStatus(status: ICleanSlateSessionSnapshot['status']): ICleanSlateSessionSnapshot['status'] {
		if (status === 'running' || status === 'starting' || status === 'stopping') {
			return 'detached';
		}
		return status ?? 'detached';
	}

	private hasVisibleSessionContentData(
		history: readonly ICleanSlateSessionMessage[],
		transcript: readonly ICleanSlateSessionMessage[]
	): boolean {
		return [...history, ...transcript].some(message =>
			!message.isInternalState
			&& (
				typeof message.content === 'string' && message.content.trim().length > 0
				|| typeof message.renderPayload === 'string' && message.renderPayload.trim().length > 0
				|| Array.isArray(message.images) && message.images.length > 0
			)
		);
	}

	private toSessionMessage(message: ICleanSlatePersistedThreadMessage | undefined): ICleanSlateSessionMessage | undefined {
		if (!message || typeof message.content !== 'string') {
			return undefined;
		}
		return {
			role: typeof message.role === 'string' ? message.role : 'system',
			content: message.content,
			isInternalState: message.isInternalState === true ? true : undefined,
			renderPayload: typeof message.renderPayload === 'string' ? message.renderPayload : undefined,
			images: Array.isArray(message.images) ? message.images.filter((image): image is string => typeof image === 'string') : undefined
		};
	}

	private toTranscriptMessage(message: ICleanSlatePersistedThreadMessage | undefined): ICleanSlateTranscriptMessage | undefined {
		const normalized = this.toSessionMessage(message);
		if (!normalized) {
			return undefined;
		}
		return {
			...normalized,
			id: typeof message?.id === 'string' ? message.id : undefined
		};
	}

	private deriveSessionTitle(history: readonly ICleanSlateSessionMessage[]): string {
		const firstUserMessage = history.find(message => message.role === 'user' && message.content.trim());
		const title = firstUserMessage?.content.trim().replace(/\s+/g, ' ');
		return title
			? title.slice(0, 90)
			: localize('cleanSlate.agentManager.untitled', 'Untitled chat');
	}
}
