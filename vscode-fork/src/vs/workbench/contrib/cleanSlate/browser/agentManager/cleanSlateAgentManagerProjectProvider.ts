/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import type { ICleanSlateSessionSnapshot } from '../chat/types/cleanSlateChatSessionTypes.js';
import type { ICleanSlateProjectThreadGroup, ICleanSlateWorkspaceEntry, ICleanSlateWorkspaceIdentity } from './cleanSlateAgentManagerTypes.js';

export class CleanSlateAgentManagerProjectProvider {

	private readonly projectOrder = new Map<string, number>();
	private readonly sessionStableTimes = new Map<string, number>();
	private nextProjectOrder = 0;

	buildProjectThreadGroups(entries: readonly ICleanSlateWorkspaceEntry[], sessions: readonly ICleanSlateSessionSnapshot[]): ICleanSlateProjectThreadGroup[] {
		const groups = new Map<string, ICleanSlateProjectThreadGroup & { sessions: ICleanSlateSessionSnapshot[] }>();
		const aliases = new Map<string, string>();
		const resolveAlias = (values: readonly string[]): string | undefined => {
			for (const value of values) {
				const key = aliases.get(value);
				if (key) {
					return key;
				}
			}
			return undefined;
		};
		const registerAliases = (key: string, values: readonly string[]): void => {
			aliases.set(key, key);
			for (const value of values) {
				aliases.set(value, key);
			}
		};
		for (const entry of entries) {
			const entryLabel = this.getWorkspaceEntryLabel(entry);
			const values = this.getWorkspaceEntryValues(entry);
			const id = resolveAlias(values) ?? this.getWorkspaceEntryKey(entry);
			const existing = groups.get(id);
			if (existing) {
				groups.set(id, {
					...existing,
					label: existing.current ? existing.label : entryLabel,
					description: existing.description ?? entry.description,
					current: existing.current || entry.current,
					entry: existing.current ? existing.entry : (entry.current ? entry : existing.entry ?? entry)
				});
			} else {
				groups.set(id, { id, label: entryLabel, description: entry.description, current: entry.current, entry, sessions: [] });
			}
			registerAliases(id, values);
		}
		for (const session of sessions) {
			const entry = entries.find(candidate => this.isSessionInWorkspaceEntry(session, candidate));
			const values = this.dedupeProjectValues([
				...this.getSessionProjectValues(session),
				...(entry ? this.getWorkspaceEntryValues(entry) : [])
			]);
			const id = resolveAlias(values) ?? (entry ? this.getWorkspaceEntryKey(entry) : this.getSessionProjectId(session));
			const existing = groups.get(id);
			if (existing) {
				existing.sessions.push(session);
				registerAliases(id, values);
				continue;
			}
			groups.set(id, {
				id,
				label: entry ? this.getWorkspaceEntryLabel(entry) : this.getSessionProjectLabel(session),
				description: entry?.description ?? session.projectRoot ?? session.workDir,
				entry,
				current: entry?.current,
				sessions: [session]
			});
			registerAliases(id, values);
		}
		const sortedGroups = [...groups.values()]
			.filter(group => !!group.entry || group.sessions.length > 0)
			.map(group => ({
				...group,
				sessions: this.sortProjectSessions(group.sessions)
			}))
			.sort((a, b) => {
				if (!!a.current !== !!b.current) {
					return a.current ? -1 : 1;
				}
				const aLatest = a.sessions[0]?.updatedAt ?? a.sessions[0]?.savedAt ?? 0;
				const bLatest = b.sessions[0]?.updatedAt ?? b.sessions[0]?.savedAt ?? 0;
				return bLatest - aLatest;
			});
		return this.sortProjectsInStableOrder(sortedGroups);
	}

	filterProjectThreadGroups(groups: readonly ICleanSlateProjectThreadGroup[], filter: string): ICleanSlateProjectThreadGroup[] {
		if (!filter) {
			return [...groups];
		}
		const visible: ICleanSlateProjectThreadGroup[] = [];
		for (const group of groups) {
			const projectMatches = this.containsFilter(filter, group.label, group.description);
			const sessions = projectMatches ? group.sessions : group.sessions.filter(session => this.matchesSessionFilter(session, filter));
			if (projectMatches || sessions.length > 0) {
				visible.push({ ...group, sessions });
			}
		}
		return visible;
	}

	getWorkspaceEntriesForSessions(entries: readonly ICleanSlateWorkspaceEntry[], sessions: readonly ICleanSlateSessionSnapshot[]): ICleanSlateWorkspaceEntry[] {
		const sessionEntries = sessions
			.map(session => this.createWorkspaceEntryFromSession(session))
			.filter((entry): entry is ICleanSlateWorkspaceEntry => !!entry);
		return this.mergeWorkspaceEntries([...entries, ...sessionEntries]);
	}

	mergeWorkspaceEntries(entries: readonly ICleanSlateWorkspaceEntry[]): ICleanSlateWorkspaceEntry[] {
		const byKey = new Map<string, ICleanSlateWorkspaceEntry>();
		const aliases = new Map<string, string>();
		for (const entry of entries) {
			const values = this.getWorkspaceEntryValues(entry);
			const key = values.map(value => aliases.get(value)).find((value): value is string => !!value) ?? this.getWorkspaceEntryKey(entry);
			const existing = byKey.get(key);
			if (!existing || entry.current || (!existing.current && !this.getWorkspaceEntryUri(existing) && !!this.getWorkspaceEntryUri(entry))) {
				byKey.set(key, entry);
			}
			aliases.set(key, key);
			for (const value of values) {
				aliases.set(value, key);
			}
		}
		return [...byKey.values()];
	}

	getWorkspaceEntryForSession(
		session: ICleanSlateSessionSnapshot,
		workspaceEntries: readonly ICleanSlateWorkspaceEntry[],
		preferredEntry?: ICleanSlateWorkspaceEntry
	): ICleanSlateWorkspaceEntry | undefined {
		if (this.isNoProjectSession(session)) {
			return preferredEntry && this.isNoProjectEntry(preferredEntry)
				? preferredEntry
				: workspaceEntries.find(entry => this.isNoProjectEntry(entry)) ?? this.createNoProjectWorkspaceEntry();
		}
		if (preferredEntry && !preferredEntry.current && this.isSessionInWorkspaceEntry(session, preferredEntry)) {
			return preferredEntry;
		}
		const matchingRecentEntry = workspaceEntries.find(entry => !entry.current && this.isSessionInWorkspaceEntry(session, entry));
		if (matchingRecentEntry) {
			return matchingRecentEntry;
		}
		return (preferredEntry && this.isSessionInWorkspaceEntry(session, preferredEntry) ? preferredEntry : undefined)
			?? workspaceEntries.find(entry => this.isSessionInWorkspaceEntry(session, entry))
			?? this.createWorkspaceEntryFromSession(session);
	}

	containsWorkspaceEntry(entries: readonly ICleanSlateWorkspaceEntry[], target: ICleanSlateWorkspaceEntry): boolean {
		return entries.some(entry => this.getWorkspaceEntryKey(entry) === this.getWorkspaceEntryKey(target) || this.haveIntersectingWorkspaceValues(entry, target));
	}

	getRememberedSessionForWorkspace(
		sessions: readonly ICleanSlateSessionSnapshot[],
		entry: ICleanSlateWorkspaceEntry,
		activeSessionByWorkspaceKey: ReadonlyMap<string, string>
	): ICleanSlateSessionSnapshot | undefined {
		const rememberedSessionId = activeSessionByWorkspaceKey.get(this.getWorkspaceEntryKey(entry));
		if (!rememberedSessionId) {
			return undefined;
		}
		return sessions.find(session => session.id === rememberedSessionId && this.isSessionInWorkspaceEntry(session, entry));
	}

	getMostRecentSessionForWorkspace(sessions: readonly ICleanSlateSessionSnapshot[], entry: ICleanSlateWorkspaceEntry): ICleanSlateSessionSnapshot | undefined {
		return sessions
			.filter(session => this.isSessionInWorkspaceEntry(session, entry))
			.sort((a, b) => (b.updatedAt ?? b.savedAt ?? 0) - (a.updatedAt ?? a.savedAt ?? 0))[0];
	}

	preservePersistedWorkspaceIdentity(existing: ICleanSlateSessionSnapshot, incoming: ICleanSlateSessionSnapshot): ICleanSlateSessionSnapshot {
		if (!existing.projectRoot && !existing.workDir && !existing.workspaceName && !existing.workspaceId) {
			return incoming;
		}
		return {
			...incoming,
			workspaceId: existing.workspaceId ?? incoming.workspaceId,
			projectRoot: existing.projectRoot ?? incoming.projectRoot,
			workDir: existing.workDir ?? incoming.workDir,
			workspaceName: existing.workspaceName ?? incoming.workspaceName
		};
	}

	getWorkspaceEntryKey(entry: ICleanSlateWorkspaceEntry | undefined): string {
		if (entry && this.isNoProjectEntry(entry)) {
			return 'no-project';
		}
		return this.normalizeProjectValue(entry?.folderUri?.toString())
			?? this.normalizeProjectValue(entry?.workspaceUri?.toString())
			?? this.normalizeProjectValue(entry?.id)
			?? this.normalizeProjectValue(entry?.label)
			?? 'no-project';
	}

	getWorkspaceEntryUri(entry: ICleanSlateWorkspaceEntry): URI | undefined {
		return entry.folderUri ?? entry.workspaceUri;
	}

	getWorkspaceEntryLabel(entry: ICleanSlateWorkspaceEntry): string {
		return this.isNoProjectEntry(entry)
			? localize('cleanSlate.agentManager.noProject', 'No project')
			: entry.label;
	}

	createWorkspaceEntryFromSession(session: ICleanSlateSessionSnapshot): ICleanSlateWorkspaceEntry | undefined {
		if (this.isNoProjectSession(session)) {
			return this.createNoProjectWorkspaceEntry();
		}
		const uri = this.getSessionWorkspaceUri(session);
		if (!uri) {
			return undefined;
		}
		return {
			id: uri.toString(),
			label: this.getSessionProjectLabel(session),
			description: uri.fsPath || uri.toString(),
			folderUri: uri,
			workspaceId: session.workspaceId
		};
	}

	createNoProjectWorkspaceEntry(): ICleanSlateWorkspaceEntry {
		return {
			id: 'no-project',
			label: localize('cleanSlate.agentManager.noProject', 'No project'),
			workspaceId: 'no-project'
		};
	}

	isSessionInWorkspaceEntry(session: ICleanSlateSessionSnapshot, entry: ICleanSlateWorkspaceEntry): boolean {
		const sessionIdentity = this.getSessionWorkspaceIdentity(session);
		const entryIdentity = this.getWorkspaceEntryIdentity(entry);
		if (sessionIdentity.path.length > 0) {
			return this.intersects(sessionIdentity.path, entryIdentity.path);
		}
		if (sessionIdentity.name.length > 0) {
			return this.intersects(sessionIdentity.name, entryIdentity.name);
		}
		return this.intersects(sessionIdentity.id, entryIdentity.id);
	}

	isNoProjectEntry(entry: ICleanSlateWorkspaceEntry): boolean {
		if (entry.folderUri || entry.workspaceUri) {
			return false;
		}
		const label = entry.label.trim().toLowerCase();
		return !label || label === 'cleanslate' || label === 'no project';
	}

	isNoProjectSession(session: ICleanSlateSessionSnapshot): boolean {
		const workspaceId = session.workspaceId?.trim().toLowerCase();
		const name = session.workspaceName?.trim().toLowerCase();
		if (workspaceId === 'no-project' || name === 'no project') {
			return true;
		}
		if (this.getSessionWorkspaceUri(session)) {
			return false;
		}
		return !name || name === 'cleanslate' || name === 'no project';
	}

	getSessionWorkspaceUri(session: ICleanSlateSessionSnapshot): URI | undefined {
		const root = session.projectRoot?.trim();
		if (root) {
			try {
				const uri = URI.parse(root);
				if (uri.scheme) {
					return uri;
				}
			} catch {
				return this.isAbsolutePathLike(root) ? URI.file(root) : undefined;
			}
			return this.isAbsolutePathLike(root) ? URI.file(root) : undefined;
		}
		const workDir = session.workDir?.trim();
		return workDir && this.isAbsolutePathLike(workDir) ? URI.file(workDir) : undefined;
	}

	dedupeProjectValues(values: readonly (string | undefined)[]): string[] {
		return [...new Set(values.filter((value): value is string => !!value))];
	}

	containsFilter(filter: string, ...values: readonly (string | undefined)[]): boolean {
		return values.some(value => !!value && value.toLowerCase().includes(filter));
	}

	private haveIntersectingWorkspaceValues(left: ICleanSlateWorkspaceEntry, right: ICleanSlateWorkspaceEntry): boolean {
		return this.intersects(this.getWorkspaceEntryValues(left), this.getWorkspaceEntryValues(right));
	}

	private sortProjectsInStableOrder(groups: readonly ICleanSlateProjectThreadGroup[]): ICleanSlateProjectThreadGroup[] {
		for (const group of groups) {
			if (!this.projectOrder.has(group.id)) {
				this.projectOrder.set(group.id, this.nextProjectOrder++);
			}
		}
		return [...groups].sort((a, b) => {
			return (this.projectOrder.get(a.id) ?? 0) - (this.projectOrder.get(b.id) ?? 0);
		});
	}

	private sortProjectSessions(sessions: readonly ICleanSlateSessionSnapshot[]): ICleanSlateSessionSnapshot[] {
		return [...sessions].sort((a, b) => {
			const createdDelta = this.getStableSessionTime(b) - this.getStableSessionTime(a);
			if (createdDelta !== 0) {
				return createdDelta;
			}
			return b.id.localeCompare(a.id);
		});
	}

	private getStableSessionTime(session: ICleanSlateSessionSnapshot): number {
		const existing = this.sessionStableTimes.get(session.id);
		if (typeof existing === 'number') {
			return existing;
		}
		const stableTime = session.createdAt ?? session.savedAt ?? session.updatedAt ?? 0;
		this.sessionStableTimes.set(session.id, stableTime);
		return stableTime;
	}

	private getSessionProjectId(session: ICleanSlateSessionSnapshot): string {
		return this.getSessionProjectValues(session)[0]
			?? 'no-project';
	}

	private getSessionProjectLabel(session: ICleanSlateSessionSnapshot): string {
		if (this.isNoProjectSession(session)) {
			return localize('cleanSlate.agentManager.noProject', 'No project');
		}
		return session.workspaceName
			?? this.getResourceLabel(session.projectRoot)
			?? this.getResourceLabel(session.workDir)
			?? localize('cleanSlate.agentManager.unknownProject', 'Project');
	}

	private getSessionProjectValues(session: ICleanSlateSessionSnapshot): string[] {
		const identity = this.getSessionWorkspaceIdentity(session);
		return identity.path.length > 0 ? [...identity.path] : (identity.name.length > 0 ? [...identity.name] : [...identity.id]);
	}

	private getWorkspaceEntryValues(entry: ICleanSlateWorkspaceEntry): string[] {
		const identity = this.getWorkspaceEntryIdentity(entry);
		return this.dedupeProjectValues([...identity.path, ...identity.name, ...identity.id]);
	}

	private getSessionWorkspaceIdentity(session: ICleanSlateSessionSnapshot): ICleanSlateWorkspaceIdentity {
		if (this.isNoProjectSession(session)) {
			return { path: [], id: ['no-project'], name: ['no project'] };
		}
		const path = this.dedupeProjectValues([
			...this.expandResourceProjectValue(session.projectRoot),
			...this.expandResourceProjectValue(session.workDir)
		]);
		const name = this.dedupeProjectValues([...this.expandProjectValue(session.workspaceName)]);
		const id = path.length || name.length ? [] : this.dedupeProjectValues([...this.expandProjectValue(session.workspaceId)]);
		return { path, id, name };
	}

	private getWorkspaceEntryIdentity(entry: ICleanSlateWorkspaceEntry): ICleanSlateWorkspaceIdentity {
		if (this.isNoProjectEntry(entry)) {
			return { path: [], id: ['no-project'], name: ['no project'] };
		}
		const path = this.dedupeProjectValues([
			...this.expandResourceProjectValue(entry.id),
			...this.expandResourceProjectValue(entry.description),
			...this.expandResourceProjectValue(entry.folderUri?.toString()),
			...this.expandResourceProjectValue(entry.folderUri?.fsPath),
			...this.expandResourceProjectValue(entry.workspaceUri?.toString()),
			...this.expandResourceProjectValue(entry.workspaceUri?.fsPath)
		]);
		const name = this.dedupeProjectValues([...this.expandProjectValue(entry.label)]);
		const id = path.length || name.length ? [] : this.dedupeProjectValues([...this.expandProjectValue(entry.workspaceId)]);
		return { path, id, name };
	}

	private intersects(left: readonly string[], right: readonly string[]): boolean {
		return left.some(value => right.includes(value));
	}

	private expandResourceProjectValue(value: string | undefined): string[] {
		if (!this.isResourceProjectValue(value)) {
			return [];
		}
		return this.expandProjectValue(value);
	}

	private isResourceProjectValue(value: string | undefined): boolean {
		const trimmed = value?.trim();
		if (!trimmed) {
			return false;
		}
		try {
			if (URI.parse(trimmed).scheme) {
				return true;
			}
		} catch {
			// Fall through to path checks.
		}
		return /[\\/]/.test(trimmed);
	}

	private normalizeProjectValue(value: string | undefined): string | undefined {
		const trimmed = value?.trim();
		return trimmed ? trimmed.toLowerCase() : undefined;
	}

	private expandProjectValue(value: string | undefined): string[] {
		const trimmed = value?.trim();
		if (!trimmed) {
			return [];
		}
		const normalized = trimmed.toLowerCase();
		const values = [normalized];
		try {
			const uri = URI.parse(trimmed);
			if (uri.scheme) {
				values.push(...this.expandPathValue(uri.fsPath || uri.path));
			}
		} catch {
			// Fall through to local path expansion.
		}
		values.push(...this.expandPathValue(trimmed));
		return this.dedupeProjectValues(values);
	}

	private expandPathValue(value: string | undefined): string[] {
		const trimmed = value?.trim();
		if (!trimmed) {
			return [];
		}
		const normalized = trimmed.toLowerCase();
		const values = [normalized];
		const path = trimmed.replace(/[/\\]+$/, '');
		const name = path.split(/[\\/]/).filter(Boolean).at(-1);
		const normalizedName = this.normalizeProjectValue(name);
		if (normalizedName) {
			values.push(normalizedName);
		}
		return values;
	}

	private getResourceLabel(value: string | undefined): string | undefined {
		const trimmed = value?.trim();
		if (!trimmed) {
			return undefined;
		}
		try {
			const uri = URI.parse(trimmed);
			if (uri.scheme) {
				return basename(uri);
			}
		} catch {
			// Fall through to local path handling.
		}
		return basename(URI.file(trimmed));
	}

	private matchesSessionFilter(session: ICleanSlateSessionSnapshot, filter: string): boolean {
		if (!filter) {
			return true;
		}
		const lastUser = session.history.find(message => message.role === 'user')?.content ?? '';
		return this.containsFilter(filter, session.title, session.workspaceName, session.taskState?.objective, lastUser);
	}

	private isAbsolutePathLike(value: string): boolean {
		return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
	}
}
