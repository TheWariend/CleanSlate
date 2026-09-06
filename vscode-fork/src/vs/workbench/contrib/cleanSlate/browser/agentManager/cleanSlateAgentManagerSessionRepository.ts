/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICleanSlateMainService, ICleanSlatePersistedSession } from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { ICleanSlateSessionSnapshot } from '../chat/types/cleanSlateChatSessionTypes.js';
import { CleanSlateAgentManagerProjectProvider } from './cleanSlateAgentManagerProjectProvider.js';
import { CleanSlateAgentManagerSessionMapper } from './cleanSlateAgentManagerSessionMapper.js';
import { ICleanSlateWorkspaceEntry } from './cleanSlateAgentManagerTypes.js';

export interface ICleanSlateAgentManagerSessionLoadResult {
	sessions: ICleanSlateSessionSnapshot[];
	globalListingUnavailable: boolean;
}

/** Loads and merges Agent Manager sessions across global and legacy workspace stores. */
export class CleanSlateAgentManagerSessionRepository {
	constructor(
		private readonly mainService: ICleanSlateMainService,
		private readonly sessionMapper: CleanSlateAgentManagerSessionMapper,
		private readonly projectProvider: CleanSlateAgentManagerProjectProvider
	) { }

	public async load(
		entries: readonly ICleanSlateWorkspaceEntry[],
		localSessions: Iterable<ICleanSlateSessionSnapshot>,
		overlaySessions: readonly ICleanSlateSessionSnapshot[],
		isDeleted: (session: ICleanSlateSessionSnapshot) => boolean,
		globalListingUnavailable: boolean
	): Promise<ICleanSlateAgentManagerSessionLoadResult> {
		const byId = new Map<string, ICleanSlateSessionSnapshot>();
		const titleSources = new Map<string, ICleanSlateSessionSnapshot>();
		const insert = (session: ICleanSlateSessionSnapshot | undefined, preferIncoming = false): void => {
			if (!session || session.parentSessionId || isDeleted(session)) {
				return;
			}
			const titleSource = titleSources.get(session.id);
			if (!titleSource || this.sessionMapper.mergeSessionTitle(titleSource, session) !== titleSource) {
				titleSources.set(session.id, session);
			}
			const existing = byId.get(session.id);
			const next = existing && preferIncoming ? this.projectProvider.preservePersistedWorkspaceIdentity(existing, session) : session;
			const existingRichness = existing ? this.getSessionRichness(existing) : -1;
			const nextRichness = this.getSessionRichness(next);
			if (!existing
				|| nextRichness > existingRichness
				|| nextRichness === existingRichness && (preferIncoming || (next.updatedAt ?? next.savedAt ?? 0) >= (existing.updatedAt ?? existing.savedAt ?? 0))) {
				byId.set(next.id, next);
			}
		};
		for (const session of localSessions) {
			insert(session);
		}
		const insertPersisted = (session: ICleanSlatePersistedSession): void => {
			try {
				insert(this.sessionMapper.toSessionSnapshot(session));
			} catch (error) {
				console.warn('[CleanSlate] Skipping unreadable Agent Manager session:', error);
			}
		};

		let loadedGlobalSessions = false;
		if (!globalListingUnavailable) {
			try {
				for (const session of await this.mainService.listThreadSessions()) {
					insertPersisted(session);
				}
				loadedGlobalSessions = true;
			} catch (error) {
				if (this.isMissingMainChannelCall(error, 'listThreadSessions')) {
					globalListingUnavailable = true;
					console.warn('[CleanSlate] Agent Manager global session listing is unavailable in this build; falling back to workspace-scoped sessions.');
				} else {
					console.warn('[CleanSlate] Failed to load Agent Manager workspace sessions:', error);
				}
			}
		}
		if (!loadedGlobalSessions) {
			await this.loadWorkspaceScopedSessions(entries, insertPersisted);
		}
		for (const session of overlaySessions) {
			insert(session, true);
		}
		return {
			// Keep the rich transcript, but independently select the latest known title.
			sessions: [...byId.values()].map(session => this.sessionMapper.mergeSessionTitle(session, titleSources.get(session.id)!))
				.sort((left, right) => (right.updatedAt ?? right.savedAt ?? 0) - (left.updatedAt ?? left.savedAt ?? 0)),
			globalListingUnavailable
		};
	}

	private getSessionRichness(session: ICleanSlateSessionSnapshot): number {
		const messages = session.transcript?.length ? session.transcript : session.history;
		return messages.reduce((total, message) => {
			if (message.isInternalState) {
				return total;
			}
			return total + Math.max(message.content?.trim().length ?? 0, message.renderPayload?.trim().length ?? 0);
		}, 0);
	}

	public async loadActive(entry: ICleanSlateWorkspaceEntry, isDeleted: (session: ICleanSlateSessionSnapshot) => boolean): Promise<ICleanSlateSessionSnapshot | undefined> {
		for (const key of this.projectProvider.dedupeProjectValues(this.getWorkspaceEntryLookupKeys(entry))) {
			try {
				const active = this.sessionMapper.toSessionSnapshot(await this.mainService.loadActiveThreadSession(key));
				if (active && !active.parentSessionId && !isDeleted(active) && this.projectProvider.isSessionInWorkspaceEntry(active, entry)) {
					return active;
				}
			} catch {
				// Global listing remains the fallback; scoped lookup is compatibility-only.
			}
		}
		return undefined;
	}

	public getWorkspaceEntryLookupKeys(entry: ICleanSlateWorkspaceEntry): string[] {
		return [entry.workspaceId, entry.id, entry.label, entry.description, entry.folderUri?.toString(), entry.folderUri?.fsPath, entry.workspaceUri?.toString(), entry.workspaceUri?.fsPath]
			.filter((value): value is string => !!value?.trim());
	}

	private async loadWorkspaceScopedSessions(entries: readonly ICleanSlateWorkspaceEntry[], insert: (session: ICleanSlatePersistedSession) => void): Promise<void> {
		const keys = this.projectProvider.dedupeProjectValues(entries.flatMap(entry => this.getWorkspaceEntryLookupKeys(entry)));
		for (const key of keys) {
			try {
				const active = await this.mainService.loadActiveThreadSession(key);
				if (active) {
					insert(active);
				}
				for (const session of await this.mainService.listArchivedThreadSessions(key)) {
					insert(session);
				}
			} catch {
				// Global listing is primary; scoped loads are best-effort compatibility.
			}
		}
	}

	private isMissingMainChannelCall(error: unknown, command: string): boolean {
		const message = error instanceof Error ? error.message : String(error);
		return message.includes(`Call not found: ${command}`);
	}
}
