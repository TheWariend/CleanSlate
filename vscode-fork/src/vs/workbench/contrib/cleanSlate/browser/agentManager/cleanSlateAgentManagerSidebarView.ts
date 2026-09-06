/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { localize } from '../../../../../nls.js';
import type { ICleanSlateSessionSnapshot } from '../chat/types/cleanSlateChatSessionTypes.js';
import type { ICleanSlateProjectThreadGroup, ICleanSlateWorkspaceEntry } from './cleanSlateAgentManagerTypes.js';

export interface ICleanSlateAgentManagerSidebarRenderOptions {
	readonly groups: readonly ICleanSlateProjectThreadGroup[];
	readonly filter: string;
	readonly activeSessionId: string;
	readonly selectedWorkspaceKey: string;
	readonly getGroupEntry: (group: ICleanSlateProjectThreadGroup) => ICleanSlateWorkspaceEntry | undefined;
	readonly getWorkspaceEntryKey: (entry: ICleanSlateWorkspaceEntry) => string;
	readonly isRunningSession: (session: ICleanSlateSessionSnapshot) => boolean;
	readonly onSelectWorkspace: (entry: ICleanSlateWorkspaceEntry) => void;
	readonly onNewChatForWorkspace: (entry: ICleanSlateWorkspaceEntry) => void;
	readonly onPrefetchSessions: (sessions: readonly ICleanSlateSessionSnapshot[]) => void;
	readonly onRestoreSession: (session: ICleanSlateSessionSnapshot, entry: ICleanSlateWorkspaceEntry | undefined) => void;
	readonly onDeleteSession: (session: ICleanSlateSessionSnapshot) => void;
	readonly onShowProjectActions: (group: ICleanSlateProjectThreadGroup, anchor: HTMLElement) => void;
}

export class CleanSlateAgentManagerSidebarView {

	private readonly projectElements = new Map<string, HTMLElement>();

	constructor(private readonly container: HTMLElement) { }

	render(options: ICleanSlateAgentManagerSidebarRenderOptions): void {
		const previousScrollTop = this.container.scrollTop;
		const label = this.container.querySelector<HTMLElement>('.cleanSlate-agent-manager-section-label')
			?? dom.$('.cleanSlate-agent-manager-section-label');
		label.textContent = localize('cleanSlate.agentManager.projects', 'Projects');
		const children: HTMLElement[] = [label];

		if (!options.groups.length) {
			const empty = dom.$('.cleanSlate-agent-manager-empty');
			empty.textContent = options.filter
				? localize('cleanSlate.agentManager.noMatches', 'No chats match')
				: localize('cleanSlate.agentManager.noProjects', 'No projects');
			this.projectElements.clear();
			this.reconcileChildren(this.container, [...children, empty]);
			this.container.scrollTop = previousScrollTop;
			return;
		}

		const groupIds = new Set(options.groups.map(group => group.id));
		for (const id of this.projectElements.keys()) {
			if (!groupIds.has(id)) {
				this.projectElements.delete(id);
			}
		}
		for (const group of options.groups) {
			children.push(this.renderProjectGroup(group, options));
		}
		this.reconcileChildren(this.container, children);
		this.container.scrollTop = previousScrollTop;
	}

	updateActiveState(activeSessionId: string, selectedWorkspaceKey: string, isRunningSession: (sessionId: string) => boolean): void {
		for (const chat of this.container.querySelectorAll<HTMLButtonElement>('button.cleanSlate-agent-manager-session')) {
			const isActive = chat.dataset.sessionId === activeSessionId;
			chat.classList.toggle('active', isActive);
			this.updateSessionRunningIndicator(chat, isRunningSession(chat.dataset.sessionId ?? ''));
		}
		for (const project of this.container.querySelectorAll<HTMLButtonElement>('button.cleanSlate-agent-manager-project')) {
			const hasActiveSession = !!project.parentElement?.querySelector('button.cleanSlate-agent-manager-session.active');
			project.classList.toggle('active', project.dataset.workspaceKey === selectedWorkspaceKey);
			project.classList.toggle('has-active-session', hasActiveSession);
		}
	}

	private renderProjectGroup(group: ICleanSlateProjectThreadGroup, options: ICleanSlateAgentManagerSidebarRenderOptions): HTMLElement {
		const groupEntry = options.getGroupEntry(group);
		const groupKey = groupEntry ? options.getWorkspaceEntryKey(groupEntry) : group.id;
		const project = this.projectElements.get(group.id) ?? dom.$('.cleanSlate-agent-manager-project-group');
		this.projectElements.set(group.id, project);
		const row = project.querySelector<HTMLButtonElement>('button.cleanSlate-agent-manager-project')
			?? dom.append(project, dom.$('button.cleanSlate-agent-manager-project')) as HTMLButtonElement;
		row.type = 'button';
		row.dataset.workspaceKey = groupKey;
		row.classList.toggle('active', groupKey === options.selectedWorkspaceKey);
		row.classList.toggle('has-active-session', group.sessions.some(session => session.id === options.activeSessionId));
		row.title = group.description ?? group.label;
		row.onclick = () => {
			if (groupEntry) {
				options.onSelectWorkspace(groupEntry);
			}
		};
		const icon = row.querySelector<HTMLElement>('.project-icon') ?? dom.append(row, dom.$('span.project-icon'));
		icon.className = `project-icon ${ThemeIcon.asClassName(group.current ? Codicon.repo : Codicon.folder)}`;
		const copy = row.querySelector<HTMLElement>('.project-copy') ?? dom.append(row, dom.$('.project-copy'));
		const title = copy.querySelector<HTMLElement>('.project-title') ?? dom.append(copy, dom.$('.project-title'));
		title.textContent = group.label;
		const menu = row.querySelector<HTMLElement>('.cleanSlate-agent-manager-project-menu')
			?? dom.append(row, dom.$('span.cleanSlate-agent-manager-project-menu'));
		menu.title = localize('cleanSlate.agentManager.projectActions', 'Project actions');
		menu.setAttribute('role', 'button');
		menu.setAttribute('aria-label', menu.title);
		if (!menu.firstChild) {
			dom.append(menu, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.ellipsis)}`));
		}
		menu.onclick = event => {
			event.preventDefault();
			event.stopPropagation();
			options.onShowProjectActions(group, menu);
		};
		const newChat = row.querySelector<HTMLElement>('.cleanSlate-agent-manager-project-new-chat')
			?? dom.append(row, dom.$('span.cleanSlate-agent-manager-project-new-chat'));
		newChat.title = localize('cleanSlate.agentManager.newProjectChat', 'New chat');
		newChat.setAttribute('role', 'button');
		newChat.setAttribute('aria-label', newChat.title);
		if (!newChat.firstChild) {
			dom.append(newChat, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.edit)}`));
		}
		newChat.onclick = event => {
			event.preventDefault();
			event.stopPropagation();
			if (groupEntry) {
				options.onNewChatForWorkspace(groupEntry);
			}
		};

		const chats = project.querySelector<HTMLElement>('.cleanSlate-agent-manager-project-chats')
			?? dom.append(project, dom.$('.cleanSlate-agent-manager-project-chats'));
		const existingChats = new Map(Array.from(chats.querySelectorAll<HTMLButtonElement>('button.cleanSlate-agent-manager-session'))
			.map(chat => [chat.dataset.sessionId, chat]));
		const nextChats: HTMLElement[] = [];
		for (let index = 0; index < group.sessions.length; index++) {
			const session = group.sessions[index];
			nextChats.push(this.renderSession(existingChats.get(session.id), session, group.sessions.slice(Math.max(0, index - 1), index + 2), groupEntry, groupKey, options));
		}
		this.reconcileChildren(chats, nextChats);
		return project;
	}

	private renderSession(
		existingChat: HTMLButtonElement | undefined,
		session: ICleanSlateSessionSnapshot,
		prefetchSessions: readonly ICleanSlateSessionSnapshot[],
		groupEntry: ICleanSlateWorkspaceEntry | undefined,
		groupKey: string,
		options: ICleanSlateAgentManagerSidebarRenderOptions
	): HTMLButtonElement {
		const isRunning = options.isRunningSession(session);
		const chat = existingChat ?? dom.$('button.cleanSlate-agent-manager-session') as HTMLButtonElement;
		chat.type = 'button';
		chat.dataset.sessionId = session.id;
		chat.dataset.workspaceKey = groupKey;
		chat.classList.toggle('active', session.id === options.activeSessionId);
		chat.classList.toggle('running', isRunning);
		const prefetch = () => options.onPrefetchSessions(prefetchSessions);
		chat.onpointerenter = prefetch;
		chat.onpointerdown = prefetch;
		chat.onfocus = prefetch;
		chat.onclick = () => options.onRestoreSession(session, groupEntry);
		const chatCopy = chat.querySelector<HTMLElement>('.session-copy') ?? dom.append(chat, dom.$('.session-copy'));
		const title = chatCopy.querySelector<HTMLElement>('.session-title') ?? dom.append(chatCopy, dom.$('.session-title'));
		title.textContent = session.title || localize('cleanSlate.agentManager.untitled', 'Untitled chat');
		const runningIndicator = chat.querySelector<HTMLElement>('.cleanSlate-agent-manager-session-running')
			?? dom.append(chat, dom.$('span.cleanSlate-agent-manager-session-running'));
		this.updateSessionRunningIndicator(chat, isRunning, runningIndicator);
		// Keep a compact trailing target for the hover-only delete action without
		// showing per-chat recency timestamps in the project list.
		const meta = chat.querySelector<HTMLElement>('.session-meta') ?? dom.append(chat, dom.$('span.session-meta'));
		const deleteChat = meta.querySelector<HTMLElement>('.cleanSlate-agent-manager-delete-chat')
			?? dom.append(meta, dom.$('span.cleanSlate-agent-manager-delete-chat'));
		deleteChat.title = localize('cleanSlate.agentManager.deleteChat', 'Delete chat');
		deleteChat.setAttribute('role', 'button');
		deleteChat.setAttribute('aria-label', deleteChat.title);
		if (!deleteChat.firstChild) {
			dom.append(deleteChat, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.trash)}`));
		}
		deleteChat.onclick = event => {
			event.preventDefault();
			event.stopPropagation();
			options.onDeleteSession(session);
		};
		return chat;
	}

	private reconcileChildren(container: HTMLElement, children: readonly HTMLElement[]): void {
		// Replacing a pressed button between pointerdown and click loses the gesture.
		// Keep surviving rows (and their focus) attached while refreshing session data.
		const retained = new Set(children);
		for (const child of Array.from(container.children)) {
			if (!retained.has(child as HTMLElement)) {
				child.remove();
			}
		}
		let next = container.firstElementChild;
		for (const child of children) {
			if (child !== next) {
				container.insertBefore(child, next);
			}
			next = child.nextElementSibling;
		}
	}

	private updateSessionRunningIndicator(chat: HTMLButtonElement, isRunning: boolean, indicator = chat.querySelector<HTMLElement>('.cleanSlate-agent-manager-session-running')): void {
		chat.classList.toggle('running', isRunning);
		if (!indicator) {
			return;
		}
		if (!isRunning) {
			dom.clearNode(indicator);
			indicator.removeAttribute('title');
			indicator.removeAttribute('aria-label');
			return;
		}
		indicator.title = localize('cleanSlate.agentManager.sessionRunning', 'Running');
		indicator.setAttribute('aria-label', indicator.title);
		if (!indicator.firstChild) {
			dom.append(indicator, dom.$('i.codicon.codicon-loading.codicon-modifier-spin'));
		}
	}
}
