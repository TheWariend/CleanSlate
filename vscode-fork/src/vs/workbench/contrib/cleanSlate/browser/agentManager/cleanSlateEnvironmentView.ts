/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import type { ICleanSlateEnvironmentGit, CleanSlateEnvironmentGitAction } from './cleanSlateEnvironmentModel.js';

export interface ICleanSlateEnvironmentOptions {
	readonly cwd?: string;
	readonly agent: string;
	readonly agentIconUrl?: string;
	readonly agentIconMonochrome?: boolean;
	readonly loadGit: () => Promise<ICleanSlateEnvironmentGit | undefined>;
	readonly loadChanges: () => Promise<{ added: number; deleted: number; count: number }>;
	readonly loadUsage: () => Promise<string | import('../../../../services/cleanSlate/common/externalAgents/externalAgentTypes.js').IExternalAgentUsage>;
	readonly loadServers: () => Promise<readonly { label: string; url?: string }[]>;
	readonly loadPullRequest: () => Promise<{ title: string; url: string; state: string } | undefined>;
	readonly onGit: (action: CleanSlateEnvironmentGitAction, value?: string) => Promise<void>;
	readonly onWorktree: (path: string) => void;
	readonly onChanges: () => void;
	readonly onOpenUrl: (url: string) => Promise<void>;
}

/** A task-scoped control surface. Details are fetched when opened and remain inside the card. */
export function renderCleanSlateEnvironment(body: HTMLElement, options: ICleanSlateEnvironmentOptions): void {
	dom.clearNode(body);
	const card = dom.append(body, dom.$('.cleanSlate-environment'));
	const header = dom.append(card, dom.$('.cleanSlate-environment-header'));
	dom.append(header, dom.$('span')).textContent = 'Environment';
	const row = (parent: HTMLElement, icon: ThemeIcon, label: string, action: () => void | Promise<void>, trailing = '') => {
		const button = dom.append(parent, dom.$('button.cleanSlate-environment-row')) as HTMLButtonElement;
		button.type = 'button';
		dom.append(button, dom.$(`span${ThemeIcon.asCSSSelector(icon)}`));
		const text = dom.append(button, dom.$('span.cleanSlate-environment-label'));
		text.textContent = label;
		text.title = label;
		const meta = dom.append(button, dom.$('span.cleanSlate-environment-meta'));
		meta.textContent = trailing;
		button.onclick = async () => {
			let error = parent.querySelector<HTMLElement>(':scope > .cleanSlate-environment-error');
			error?.remove();
			try {
				const pending = action();
				if (pending) { button.disabled = true; button.setAttribute('aria-busy', 'true'); await pending; }
			} catch (cause) {
				if (parent.isConnected) {
					error = dom.append(parent, dom.$('.cleanSlate-environment-detail.cleanSlate-environment-error'));
					error.setAttribute('role', 'status');
					error.textContent = cause instanceof Error ? cause.message : String(cause);
				}
			} finally { button.disabled = false; button.removeAttribute('aria-busy'); }
		};
		return { button, text, meta };
	};
	const section = (label: string) => {
		const el = dom.append(card, dom.$('section.cleanSlate-environment-section'));
		dom.append(el, dom.$('.cleanSlate-environment-caption')).textContent = label;
		return el;
	};
	const message = (parent: HTMLElement, text: string) => {
		const el = dom.append(parent, dom.$('.cleanSlate-environment-detail'));
		el.textContent = text;
		return el;
	};
	const applyAgentLogo = (button: HTMLButtonElement) => {
		if (!options.agentIconUrl) { return; }
		button.querySelector('.codicon')?.remove();
		const logo = dom.$('.cleanSlate-environment-agent-logo');
		if (options.agentIconMonochrome) {
			logo.classList.add('monochrome');
			logo.style.maskImage = `url(${options.agentIconUrl})`;
			logo.style.webkitMaskImage = logo.style.maskImage;
		} else {
			const image = dom.append(logo, dom.$('img')) as HTMLImageElement;
			image.src = options.agentIconUrl;
			image.alt = '';
		}
		button.prepend(logo);
	};
	const expandable = (parent: HTMLElement, icon: ThemeIcon, label: string, render: (host: HTMLElement) => Promise<void> | void) => {
		const host = dom.$('.cleanSlate-environment-expanded');
		host.hidden = true;
		const control = row(parent, icon, label, () => {
			host.hidden = !host.hidden;
			control.button.setAttribute('aria-expanded', String(!host.hidden));
			control.meta.textContent = host.hidden ? '⌄' : '⌃';
			if (!host.hidden) {
				dom.clearNode(host);
				const content = dom.append(host, dom.$('div'));
				Promise.resolve().then(() => render(content)).catch(error => { if (content.isConnected) { dom.clearNode(content); message(content, error instanceof Error ? error.message : 'Could not load. Close and reopen to retry.'); } });
			}
		}, '⌄');
		control.button.setAttribute('aria-expanded', 'false');
		dom.append(parent, host);
		return control;
	};
	const changes = row(card, Codicon.diffMultiple, 'Changes', options.onChanges, '…');
	changes.button.disabled = !options.cwd;
	void options.loadChanges().then(stats => {
		if (!card.isConnected) { return; }
		dom.clearNode(changes.meta);
		dom.append(changes.meta, dom.$('span.cleanSlate-environment-added')).textContent = `+${stats.added}`;
		dom.append(changes.meta, dom.$('span.cleanSlate-environment-deleted')).textContent = `−${stats.deleted}`;
		changes.button.title = `${stats.count} changed files`;
	}).catch(() => { changes.meta.textContent = 'Unavailable'; });
	const gitHost = dom.append(card, dom.$('.cleanSlate-environment-git'));
	message(gitHost, options.cwd ? 'Loading repository…' : 'No project selected');
	void options.loadGit().then(git => {
		if (!card.isConnected) { return; }
		dom.clearNode(gitHost);
		if (!git) { message(gitHost, 'No Git repository'); return; }
		expandable(gitHost, Codicon.repoForked, git.worktrees.length > 1 ? 'Worktree' : 'Local workspace', host => {
			for (const worktree of git.worktrees) {
				const item = row(host, Codicon.folder, worktree.branch, () => options.onWorktree(worktree.path));
				item.button.title = worktree.path;
				message(host, worktree.path);
			}
		});
		expandable(gitHost, Codicon.gitBranch, git.branch, host => {
			for (const branch of git.branches) {
				const item = row(host, Codicon.gitBranch, branch, () => options.onGit('branch', branch), branch === git.branch ? '✓' : '');
				item.button.disabled = branch === git.branch;
			}
		});
		expandable(gitHost, Codicon.cloudUpload, 'Commit and push', host => {
			message(host, `${git.staged} staged files · ${git.changed} changed files`);
			const stage = row(host, Codicon.add, 'Stage all changes', () => options.onGit('stage'));
			stage.button.disabled = git.changed === 0;
			const input = dom.append(host, dom.$('input.cleanSlate-environment-input')) as HTMLInputElement;
			input.placeholder = 'Commit message';
			input.setAttribute('aria-label', 'Commit message');
			const commit = row(host, Codicon.check, 'Commit staged changes', () => options.onGit('commit', input.value));
			commit.button.disabled = true;
			input.oninput = () => { commit.button.disabled = !input.value.trim() || git.staged === 0; };
			row(host, Codicon.diffMultiple, 'Review changes', options.onChanges);
			const push = row(host, Codicon.cloudUpload, git.upstream ? 'Push current branch' : 'Publish current branch', () => options.onGit('push'));
			push.button.disabled = git.remotes.length === 0 || git.branch === 'Detached HEAD';
			if (!git.remotes.length) { message(host, 'Configure a Git remote to publish this branch.'); }
			else if (git.branch === 'Detached HEAD') { message(host, 'Switch to a branch before pushing.'); }
		});
		if (git.remote) {
			const repository = section('Repository');
			const url = git.remote;
			row(repository, Codicon.repo, new URL(url).pathname.replace(/^\//, ''), () => options.onOpenUrl(url), '↗');
			const pr = section('Pull request');
			expandable(pr, Codicon.gitPullRequest, 'Current branch', async host => {
				const loading = message(host, 'Checking pull request…');
				const result = await options.loadPullRequest();
				loading.remove();
				if (result) {
					const link = row(host, result.state === 'MERGED' ? Codicon.gitMerge : result.state === 'CLOSED' ? Codicon.gitPullRequestClosed : Codicon.gitPullRequest, result.title, () => options.onOpenUrl(result.url), result.state);
					if (result.state === 'MERGED') { link.button.style.color = '#a78bfa'; }
				}
				else { message(host, 'No pull request for this branch.'); }
			});
		}
	}).catch(error => { if (gitHost.isConnected) { dom.clearNode(gitHost); message(gitHost, error instanceof Error ? error.message : 'Repository temporarily unavailable.'); } });
	expandable(card, Codicon.globe, 'Local servers', async host => {
		const loading = message(host, 'Checking task processes…');
		const servers = await options.loadServers();
		loading.remove();
		if (!servers.length) { message(host, 'No running servers for this task'); }
		for (const server of servers) {
			const link = row(host, Codicon.globe, server.label, () => server.url ? options.onOpenUrl(server.url) : undefined, server.url ? '↗' : '');
			link.button.disabled = !server.url;
		}
	});
	const usage = section('Usage');
	const usageRow = expandable(usage, Codicon.pieChart, options.agent, async host => {
		const result = await options.loadUsage();
		if (!host.isConnected) { return; }
		if (typeof result === 'string') { message(host, result); return; }
		if (!result.windows.length) { message(host, result.detail); return; }
		for (const window of result.windows) {
			message(host, `${window.label} · ${Math.round(window.usedPercent)}% used`);
			const meter = dom.append(host, dom.$('div'));
			meter.setAttribute('role', 'progressbar'); meter.setAttribute('aria-label', `${window.label} usage`); meter.setAttribute('aria-valuenow', String(window.usedPercent)); meter.setAttribute('aria-valuemin', '0'); meter.setAttribute('aria-valuemax', '100');
			meter.style.cssText = 'height:4px;border-radius:4px;background:var(--vscode-widget-border, rgba(128,128,128,.2));margin:0 7px 8px;overflow:hidden';
			const fill = dom.append(meter, dom.$('div'));
			fill.style.cssText = `height:100%;width:${window.usedPercent}%;background:var(--vscode-progressBar-background)`;
			if (window.resetsAt) { message(host, `Resets ${new Date(window.resetsAt * 1000).toLocaleString()}`); }
		}
	});
	applyAgentLogo(usageRow.button);
}
