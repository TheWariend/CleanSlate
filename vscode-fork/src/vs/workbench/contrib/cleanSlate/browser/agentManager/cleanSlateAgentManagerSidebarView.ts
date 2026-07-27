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
	readonly onRestoreSession: (session: ICleanSlateSessionSnapshot, entry: ICleanSlateWorkspaceEntry | undefined) => void;
	readonly onDeleteSession: (session: ICleanSlateSessionSnapshot) => void;
	readonly onShowProjectActions: (group: ICleanSlateProjectThreadGroup, anchor: HTMLElement) => void;
}

export class CleanSlateAgentManagerSidebarView {

	constructor(private readonly container: HTMLElement) { }

	render(options: ICleanSlateAgentManagerSidebarRenderOptions): void {
		const previousScrollTop = this.container.scrollTop;
		dom.clearNode(this.container);
		dom.append(this.container, dom.$('.cleanSlate-agent-manager-section-label')).textContent = localize('cleanSlate.agentManager.projects', 'Projects');

		if (!options.groups.length) {
			dom.append(this.container, dom.$('.cleanSlate-agent-manager-empty')).textContent = options.filter
				? localize('cleanSlate.agentManager.noMatches', 'No chats match')
				: localize('cleanSlate.agentManager.noProjects', 'No projects');
			this.container.scrollTop = previousScrollTop;
			return;
		}

		for (const group of options.groups) {
			this.renderProjectGroup(group, options);
		}
		this.container.scrollTop = previousScrollTop;
	}

	updateActiveState(activeSessionId: string, selectedWorkspaceKey: string, activeSessionRunning: boolean): void {
		for (const chat of this.container.querySelectorAll<HTMLButtonElement>('button.cleanSlate-agent-manager-session')) {
			const isActive = chat.dataset.sessionId === activeSessionId;
			chat.classList.toggle('active', isActive);
			if (isActive) {
				this.updateSessionRunningIndicator(chat, activeSessionRunning);
			}
		}
		for (const project of this.container.querySelectorAll<HTMLButtonElement>('button.cleanSlate-agent-manager-project')) {
			const hasActiveSession = !!project.parentElement?.querySelector('button.cleanSlate-agent-manager-session.active');
			project.classList.toggle('active', project.dataset.workspaceKey === selectedWorkspaceKey);
			project.classList.toggle('has-active-session', hasActiveSession);
		}
	}

	private renderProjectGroup(group: ICleanSlateProjectThreadGroup, options: ICleanSlateAgentManagerSidebarRenderOptions): void {
		const groupEntry = options.getGroupEntry(group);
		const groupKey = groupEntry ? options.getWorkspaceEntryKey(groupEntry) : group.id;
		const project = dom.append(this.container, dom.$('.cleanSlate-agent-manager-project-group'));
		const row = dom.append(project, dom.$('button.cleanSlate-agent-manager-project')) as HTMLButtonElement;
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
		dom.append(row, dom.$(`span${ThemeIcon.asCSSSelector(group.current ? Codicon.repo : Codicon.folder)}.project-icon`));
		const copy = dom.append(row, dom.$('.project-copy'));
		dom.append(copy, dom.$('.project-title')).textContent = group.label;
		const menu = dom.append(row, dom.$('span.cleanSlate-agent-manager-project-menu'));
		menu.title = localize('cleanSlate.agentManager.projectActions', 'Project actions');
		menu.setAttribute('role', 'button');
		menu.setAttribute('aria-label', menu.title);
		dom.append(menu, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.ellipsis)}`));
		menu.onclick = event => {
			event.preventDefault();
			event.stopPropagation();
			options.onShowProjectActions(group, menu);
		};
		const newChat = dom.append(row, dom.$('span.cleanSlate-agent-manager-project-new-chat'));
		newChat.title = localize('cleanSlate.agentManager.newProjectChat', 'New chat');
		newChat.setAttribute('role', 'button');
		newChat.setAttribute('aria-label', newChat.title);
		dom.append(newChat, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.edit)}`));
		newChat.onclick = event => {
			event.preventDefault();
			event.stopPropagation();
			if (groupEntry) {
				options.onNewChatForWorkspace(groupEntry);
			}
		};

		const chats = dom.append(project, dom.$('.cleanSlate-agent-manager-project-chats'));
		for (const session of group.sessions) {
			this.renderSession(chats, session, groupEntry, groupKey, options);
		}
	}

	private renderSession(
		container: HTMLElement,
		session: ICleanSlateSessionSnapshot,
		groupEntry: ICleanSlateWorkspaceEntry | undefined,
		groupKey: string,
		options: ICleanSlateAgentManagerSidebarRenderOptions
	): void {
		const isRunning = options.isRunningSession(session);
		const chat = dom.append(container, dom.$('button.cleanSlate-agent-manager-session')) as HTMLButtonElement;
		chat.type = 'button';
		chat.dataset.sessionId = session.id;
		chat.dataset.workspaceKey = groupKey;
		chat.classList.toggle('active', session.id === options.activeSessionId);
		chat.classList.toggle('running', isRunning);
		chat.onclick = () => options.onRestoreSession(session, groupEntry);
		const chatCopy = dom.append(chat, dom.$('.session-copy'));
		dom.append(chatCopy, dom.$('.session-title')).textContent = session.title || localize('cleanSlate.agentManager.untitled', 'Untitled chat');
		const runningIndicator = dom.append(chat, dom.$('span.cleanSlate-agent-manager-session-running'));
		this.updateSessionRunningIndicator(chat, isRunning, runningIndicator);
		// Keep a compact trailing target for the hover-only delete action without
		// showing per-chat recency timestamps in the project list.
		const meta = dom.append(chat, dom.$('span.session-meta'));
		const deleteChat = dom.append(meta, dom.$('span.cleanSlate-agent-manager-delete-chat'));
		deleteChat.title = localize('cleanSlate.agentManager.deleteChat', 'Delete chat');
		deleteChat.setAttribute('role', 'button');
		deleteChat.setAttribute('aria-label', deleteChat.title);
		dom.append(deleteChat, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.trash)}`));
		deleteChat.onclick = event => {
			event.preventDefault();
			event.stopPropagation();
			options.onDeleteSession(session);
		};
	}

	private updateSessionRunningIndicator(chat: HTMLButtonElement, isRunning: boolean, indicator = chat.querySelector<HTMLElement>('.cleanSlate-agent-manager-session-running')): void {
		chat.classList.toggle('running', isRunning);
		if (!indicator) {
			return;
		}
		dom.clearNode(indicator);
		if (!isRunning) {
			indicator.removeAttribute('title');
			indicator.removeAttribute('aria-label');
			return;
		}
		indicator.title = localize('cleanSlate.agentManager.sessionRunning', 'Running');
		indicator.setAttribute('aria-label', indicator.title);
		dom.append(indicator, dom.$('i.codicon.codicon-loading.codicon-modifier-spin'));
	}
}
