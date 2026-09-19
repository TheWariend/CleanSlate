/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import type { ICleanSlateMainService } from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { cleanSlateRepositoryUrl, openCleanSlateEnvironmentUrl, readCleanSlateEnvironmentGit, runCleanSlateEnvironmentGitAction, formatCleanSlateEnvironmentUsage } from '../../browser/agentManager/cleanSlateEnvironmentModel.js';

const execute = promisify(execFile);

suite('CleanSlate Environment usage', () => {
	test('Pro shows separate session and weekly windows, not monthly budget', () => {
		assert.deepStrictEqual(formatCleanSlateEnvironmentUsage({ plan: { id: 'pro' }, usage: { monthly_used_percent: 15, daily_requests: 99 }, limits: { daily_action_limit: 100, remaining_daily_actions: 96, weekly_action_limit: 1000, remaining_weekly_actions: 340 } }), { detail: 'Usage is currently unavailable', windows: [{ label: 'Session', usedPercent: 4, resetsAt: undefined }, { label: 'Weekly', usedPercent: 66, resetsAt: undefined }] });
	});
	test('Free shows its monthly allowance', () => {
		assert.deepStrictEqual(formatCleanSlateEnvironmentUsage({ plan: { id: 'free' }, usage: { monthly_used_percent: 15 } }), { detail: 'Account usage', windows: [{ label: 'Monthly allowance', usedPercent: 15, resetsAt: undefined }] });
	});
	test('missing counters are not reported as zero usage', () => {
		assert.deepStrictEqual(formatCleanSlateEnvironmentUsage({ plan: { id: 'pro' }, limits: { daily_action_limit: 100 } }), { detail: 'Usage is currently unavailable', windows: [] });
		assert.deepStrictEqual(formatCleanSlateEnvironmentUsage({}), { detail: 'Usage is currently unavailable', windows: [] });
	});
	test('request counts are a fallback and percentages stay bounded', () => {
		assert.deepStrictEqual(formatCleanSlateEnvironmentUsage({ plan: { id: 'pro' }, usage: { weekly_requests: 120 }, limits: { weekly_action_limit: 100 } }), { detail: 'Usage is currently unavailable', windows: [{ label: 'Weekly', usedPercent: 100, resetsAt: undefined }] });
	});
});

suite('CleanSlate Environment actions', () => {
	let directory: string;
	let repository: string;
	let service: ICleanSlateMainService;
	const git = async (...args: string[]) => (await execute('git', args, { cwd: repository })).stdout.trim();
	setup(async () => {
		directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cleanslate-environment-')));
		repository = path.join(directory, 'repo with spaces');
		await fs.mkdir(repository);
		await git('init', '--initial-branch=main');
		await git('config', 'user.name', 'Environment Test');
		await git('config', 'user.email', 'test@example.invalid');
		await git('config', 'commit.gpgsign', 'false');
		await fs.writeFile(path.join(repository, 'file.txt'), 'first\n');
		await git('add', '.'); await git('commit', '-m', 'Initial');
		service = { executeCommand: async (options: { command: string; cwd: string }) => {
			try { const result = await execute('/bin/sh', ['-c', options.command], { cwd: options.cwd }); return { success: true, stdout: result.stdout, stderr: result.stderr }; }
			catch (error) { const result = error as { stdout?: string; stderr?: string }; return { success: false, stdout: result.stdout ?? '', stderr: result.stderr ?? String(error) }; }
		} } as unknown as ICleanSlateMainService;
	});
	teardown(async () => { await fs.rm(directory, { recursive: true, force: true }); });

	test('reads working changes, stages, and commits only staged content', async () => {
		await fs.writeFile(path.join(repository, 'file.txt'), 'changed\n');
		assert.strictEqual((await readCleanSlateEnvironmentGit(service, repository))?.changed, 1);
		await runCleanSlateEnvironmentGitAction(service, repository, () => true, 'stage');
		await fs.writeFile(path.join(repository, 'unstaged.txt'), 'keep unstaged\n');
		const message = "User's commit $(echo should-not-run)";
		await runCleanSlateEnvironmentGitAction(service, repository, () => true, 'commit', message);
		assert.strictEqual(await git('log', '-1', '--format=%s'), message);
		assert.strictEqual(await git('show', 'HEAD:file.txt'), 'changed');
		assert.match(await git('status', '--porcelain'), /\?\? unstaged.txt/);
	});

	test('switches an advertised branch and rejects conflicts without discarding work', async () => {
		await git('checkout', '-b', "feature/it's-working");
		await fs.writeFile(path.join(repository, 'file.txt'), 'branch content\n');
		await git('commit', '-am', 'Branch update'); await git('checkout', 'main');
		await runCleanSlateEnvironmentGitAction(service, repository, () => true, 'branch', "feature/it's-working");
		assert.strictEqual(await git('branch', '--show-current'), "feature/it's-working");
		await fs.writeFile(path.join(repository, 'file.txt'), 'local edit\n');
		await assert.rejects(runCleanSlateEnvironmentGitAction(service, repository, () => true, 'branch', 'main'), /overwritten|commit|stash/i);
		assert.strictEqual(await fs.readFile(path.join(repository, 'file.txt'), 'utf8'), 'local edit\n');
	});

	test('publishes to a local bare remote, then pushes to the existing upstream', async () => {
		const remote = path.join(directory, 'remote.git');
		await git('init', '--bare', remote); await git('remote', 'add', 'origin', remote);
		await runCleanSlateEnvironmentGitAction(service, repository, () => true, 'push');
		assert.strictEqual(await git('rev-parse', '--abbrev-ref', '@{upstream}'), 'origin/main');
		await fs.writeFile(path.join(repository, 'file.txt'), 'second\n'); await git('commit', '-am', 'Second');
		await runCleanSlateEnvironmentGitAction(service, repository, () => true, 'push');
		assert.strictEqual(await git('--git-dir', remote, 'rev-parse', 'main'), await git('rev-parse', 'HEAD'));
	});

	test('rejects missing remote, empty commits, and stale task actions', async () => {
		await assert.rejects(runCleanSlateEnvironmentGitAction(service, repository, () => true, 'push'), /remote/);
		await assert.rejects(runCleanSlateEnvironmentGitAction(service, repository, () => true, 'commit', 'Empty'), /Stage/);
		await assert.rejects(runCleanSlateEnvironmentGitAction(service, repository, () => false, 'stage'), /task changed/);
		assert.strictEqual(await git('status', '--porcelain'), '');
	});

	test('reads linked worktrees with spaces and staged renames', async () => {
		const linked = path.join(directory, 'linked workspace');
		await git('worktree', 'add', '-b', 'linked', linked);
		await git('mv', 'file.txt', 'new file.txt');
		const state = await readCleanSlateEnvironmentGit(service, repository);
		assert.strictEqual(state?.changed, 1); assert.strictEqual(state?.staged, 1);
		assert.ok(state?.worktrees.some(tree => tree.path === linked && tree.branch === 'linked'));
	});

	test('does not report Git execution failure as an empty repository', async () => {
		const broken = { executeCommand: async () => ({ success: false, stderr: 'git: command not found', stdout: '' }) } as unknown as ICleanSlateMainService;
		await assert.rejects(readCleanSlateEnvironmentGit(broken, repository), /command not found/);
	});

	test('converts repository URLs without credentials and retains web ports', () => {
		assert.strictEqual(cleanSlateRepositoryUrl('git@example.com:team/repo.git'), 'https://example.com/team/repo');
		assert.strictEqual(cleanSlateRepositoryUrl('https://user:secret@example.com:8443/team/repo.git'), 'https://example.com:8443/team/repo');
		assert.strictEqual(cleanSlateRepositoryUrl('/local/repo'), undefined);
	});

	test('opens the exact web address and surfaces native failures', async () => {
		let opened = '';
		await openCleanSlateEnvironmentUrl('https://example.com/team/repo', async value => { opened = value; return true; });
		assert.strictEqual(opened, 'https://example.com/team/repo');
		await assert.rejects(openCleanSlateEnvironmentUrl('https://example.com', async () => false), /could not open/);
		await assert.rejects(openCleanSlateEnvironmentUrl('command:run', async () => true), /supported web address/);
		await assert.rejects(openCleanSlateEnvironmentUrl('https://user:password@example.com', async () => true), /supported web address/);
	});
});
