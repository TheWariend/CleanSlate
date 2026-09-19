/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ICleanSlateMainService } from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import type { ICleanSlateManagedEntitlements } from '@cleanslate/sdk/protocol/cleanSlateAI.js';
import type { IExternalAgentUsage } from '@cleanslate/sdk/externalAgents/externalAgentTypes.js';

/** Match the plan-specific account limits shown in Settings. */
export function formatCleanSlateEnvironmentUsage(value: ICleanSlateManagedEntitlements): IExternalAgentUsage {
	const reset = (date?: string): number | undefined => {
		const time = date ? Date.parse(date) : NaN;
		return Number.isFinite(time) ? time / 1000 : undefined;
	};
	if (value.plan?.id === 'free') {
		const percent = value.usage?.monthly_used_percent;
		return typeof percent === 'number' && Number.isFinite(percent)
			? { detail: 'Account usage', windows: [{ label: 'Monthly allowance', usedPercent: Math.max(0, Math.min(100, percent)), resetsAt: reset(value.resets_at?.monthly ?? value.period?.end) }] }
			: { detail: 'Usage is currently unavailable', windows: [] };
	}
	const windows = [
		{ label: 'Session', limit: value.limits?.daily_action_limit, remaining: value.limits?.remaining_daily_actions, requests: value.usage?.daily_requests, resetsAt: reset(value.resets_at?.daily) },
		{ label: 'Weekly', limit: value.limits?.weekly_action_limit, remaining: value.limits?.remaining_weekly_actions, requests: value.usage?.weekly_requests, resetsAt: reset(value.resets_at?.weekly) }
	];
	return { detail: 'Usage is currently unavailable', windows: windows.flatMap(({ label, limit, remaining, requests, resetsAt }) => {
		if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) { return []; }
		const used = typeof remaining === 'number' && Number.isFinite(remaining) ? limit - remaining : requests;
		return typeof used === 'number' && Number.isFinite(used)
			? [{ label, usedPercent: Math.max(0, Math.min(100, used / limit * 100)), resetsAt }]
			: [];
	}) };
}

export interface ICleanSlateEnvironmentGit {
	readonly branch: string;
	readonly branches: readonly string[];
	readonly worktrees: readonly { path: string; branch: string }[];
	readonly remote?: string;
	readonly staged: number;
	readonly changed: number;
	readonly remotes: readonly string[];
	readonly upstream?: string;
}

/** Accept web and SSH Git remotes, dropping credentials and never opening other schemes. */
export function cleanSlateRepositoryUrl(remote: string): string | undefined {
	const ssh = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(remote);
	try {
		const url = new URL(ssh && !remote.includes('://') ? `https://${ssh[1]}/${ssh[2]}` : remote);
		if (!['http:', 'https:', 'ssh:'].includes(url.protocol)) { return undefined; }
		const port = url.protocol === 'ssh:' ? '' : url.port ? `:${url.port}` : '';
		return `${url.protocol === 'http:' ? 'http' : 'https'}://${url.hostname}${port}${url.pathname.replace(/\.git\/?$/, '')}`;
	} catch { return undefined; }
}

export async function readCleanSlateEnvironmentGit(service: ICleanSlateMainService, cwd: string): Promise<ICleanSlateEnvironmentGit | undefined> {
	const run = async (command: string, optional = false) => {
		const result = await service.executeCommand({ command, cwd, timeoutMs: 8000 });
		if (!result.success && !optional) { throw new Error(result.stderr || 'Could not read repository state.'); }
		return result.success ? result.stdout : undefined;
	};
	const inside = await service.executeCommand({ command: 'git rev-parse --is-inside-work-tree', cwd, timeoutMs: 8000 });
	if (!inside.success) {
		if (/not a git repository/i.test(inside.stderr)) { return undefined; }
		throw new Error(inside.stderr || 'Could not read repository state.');
	}
	if (inside.stdout.trim() !== 'true') { return undefined; }
	const [branch, branches, worktrees, remote, status, remotes, upstream] = await Promise.all([
		run('git symbolic-ref --quiet --short HEAD', true),
		run('git for-each-ref --format="%(refname:short)" refs/heads/'),
		run('git worktree list --porcelain -z'),
		run('git remote get-url origin', true),
		run('git status --porcelain=v1 -z'),
		run('git remote'),
		run('git rev-parse --abbrev-ref --symbolic-full-name @{upstream}', true)
	]);
	let staged = 0;
	let changed = 0;
	const entries = (status ?? '').split('\0');
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		if (entry.length < 3) { continue; }
		changed++;
		if (entry[0] !== ' ' && entry[0] !== '?') { staged++; }
		if (/[RC]/.test(entry.slice(0, 2))) { i++; }
	}
	const remoteNames = (remotes ?? '').split('\n').filter(Boolean);
	const repositoryRemote = remote || (remoteNames.length === 1
		? await run(`git remote get-url -- '${remoteNames[0].replace(/'/g, `'\\''`)}'`, true)
		: undefined);
	return {
		branch: branch?.trim() || 'Detached HEAD',
		branches: (branches ?? '').split('\n').filter(Boolean),
		worktrees: (worktrees ?? '').split('\0\0').flatMap(block => {
			const fields = block.split('\0');
			const worktreePath = fields.find(field => field.startsWith('worktree '))?.slice(9);
			const name = fields.find(field => field.startsWith('branch refs/heads/'))?.slice(18);
			return worktreePath && !fields.includes('bare') ? [{ path: worktreePath, branch: name ?? 'Detached HEAD' }] : [];
		}),
		remote: repositoryRemote ? cleanSlateRepositoryUrl(repositoryRemote.trim()) : undefined,
		staged, changed, remotes: remoteNames, upstream: upstream?.trim() || undefined
	};
}

export type CleanSlateEnvironmentGitAction = 'branch' | 'stage' | 'commit' | 'push';

/** Execute only an explicit UI action against its captured repository. */
export async function runCleanSlateEnvironmentGitAction(service: ICleanSlateMainService, cwd: string, isCurrent: () => boolean, action: CleanSlateEnvironmentGitAction, value?: string): Promise<void> {
	const run = async (command: string) => {
		if (!isCurrent()) { throw new Error('The active task changed. Reopen Environment.'); }
		const result = await service.executeCommand({ command, cwd, timeoutMs: action === 'push' ? 120000 : 30000 });
		if (!result.success) { throw new Error(result.stderr || result.stdout || 'Git command failed.'); }
	};
	const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;
	if (!isCurrent()) { throw new Error('The active task changed. Reopen Environment.'); }
	const state = await readCleanSlateEnvironmentGit(service, cwd);
	if (!state) { throw new Error('This task has no Git repository.'); }
	switch (action) {
		case 'branch':
			if (!value || !state.branches.includes(value)) { throw new Error('The selected branch no longer exists. Reopen the branch picker.'); }
			await run(`git switch -- ${quote(value)}`); break;
		case 'stage': await run('git add --all -- :/'); break;
		case 'commit':
			if (!value?.trim()) { throw new Error('Enter a commit message.'); }
			if (!state.staged) { throw new Error('Stage changes before committing.'); }
			await run(`git commit -m ${quote(value.trim())}`); break;
		case 'push': {
			if (state.branch === 'Detached HEAD') { throw new Error('Switch to a branch before pushing.'); }
			if (state.upstream) { await run('git push'); break; }
			const remote = state.remotes.includes('origin') ? 'origin' : state.remotes.length === 1 ? state.remotes[0] : undefined;
			if (!remote) { throw new Error('Configure a remote and upstream before pushing this branch.'); }
			await run(`git push --set-upstream -- ${quote(remote)} ${quote(`HEAD:refs/heads/${state.branch}`)}`); break;
		}
	}
}

export async function openCleanSlateEnvironmentUrl(value: string, open: (url: string) => Promise<boolean>): Promise<void> {
	const url = new URL(value);
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) { throw new Error('This link is not a supported web address.'); }
	if (!await open(url.href)) { throw new Error('The browser could not open this link.'); }
}
