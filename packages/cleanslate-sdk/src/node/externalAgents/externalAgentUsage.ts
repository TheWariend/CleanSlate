/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { IExternalAgentUsage } from '../../externalAgents/externalAgentTypes.js';

interface ICodexRateLimitWindow {
	readonly usedPercent?: unknown;
	readonly windowDurationMins?: unknown;
	readonly resetsAt?: unknown;
}

interface ICodexRateLimit {
	readonly limitId?: unknown;
	readonly limitName?: unknown;
	readonly primary?: ICodexRateLimitWindow | null;
	readonly secondary?: ICodexRateLimitWindow | null;
}

function labelForWindow(limit: ICodexRateLimit, window: ICodexRateLimitWindow): string {
	if (typeof limit.limitName === 'string' && limit.limitName.trim()) { return limit.limitName.trim(); }
	const minutes = typeof window.windowDurationMins === 'number' ? window.windowDurationMins : 0;
	if (minutes >= 10080) { return 'Weekly'; }
	if (minutes >= 1440 && minutes % 1440 === 0) { const days = minutes / 1440; return `${days} ${days === 1 ? 'day' : 'days'}`; }
	if (minutes >= 60 && minutes % 60 === 0) { const hours = minutes / 60; return `${hours} ${hours === 1 ? 'hour' : 'hours'}`; }
	return typeof limit.limitId === 'string' && limit.limitId !== 'codex' ? limit.limitId : 'Allowance';
}

export function formatCodexRateLimits(value: unknown): IExternalAgentUsage {
	if (!value || typeof value !== 'object') { return { detail: 'No account limits reported.', windows: [] }; }
	const result = value as { rateLimits?: ICodexRateLimit | null; rateLimitsByLimitId?: Record<string, ICodexRateLimit> | null };
	const limits = result.rateLimitsByLimitId && typeof result.rateLimitsByLimitId === 'object'
		? Object.values(result.rateLimitsByLimitId)
		: result.rateLimits ? [result.rateLimits] : [];
	const windows: IExternalAgentUsage['windows'][number][] = [];
	const seen = new Set<string>();
	for (const limit of limits) {
		for (const window of [limit.primary, limit.secondary]) {
			if (!window || typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent)) { continue; }
			const label = labelForWindow(limit, window);
			const resetsAt = typeof window.resetsAt === 'number' && Number.isFinite(window.resetsAt) && window.resetsAt > 0 ? window.resetsAt : undefined;
			const key = `${label}:${window.windowDurationMins ?? ''}:${resetsAt ?? ''}`;
			if (seen.has(key)) { continue; }
			seen.add(key);
			windows.push({ label, usedPercent: Math.max(0, Math.min(100, window.usedPercent)), resetsAt });
		}
	}
	return { detail: windows.length ? 'Account usage' : 'No account limits reported.', windows };
}

/** Reads account limits through the documented Codex app-server protocol. Credentials stay inside Codex. */
export function readCodexAppServerUsage(command: string, args: readonly string[], runAsNode = false): Promise<IExternalAgentUsage> {
	return new Promise(resolve => {
		const env = runAsNode ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env;
		const child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
		const lines = createInterface({ input: child.stdout });
		let settled = false;
		const finish = (usage: IExternalAgentUsage) => {
			if (settled) { return; }
			settled = true;
			clearTimeout(timer);
			lines.close();
			child.kill();
			resolve(usage);
		};
		const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
		const timer = setTimeout(() => finish({ detail: 'Account usage is temporarily unavailable. Reopen to retry.', windows: [] }), 8000);
		child.once('error', () => finish({ detail: 'Codex is unavailable. Install or repair the Codex runtime.', windows: [] }));
		child.once('exit', () => finish({ detail: 'Account usage is temporarily unavailable. Reopen to retry.', windows: [] }));
		lines.on('line', line => {
			let message: { id?: number; result?: unknown; error?: { message?: string } };
			try { message = JSON.parse(line); } catch { return; }
			if (message.id === 1) {
				if (message.error) { finish({ detail: 'Codex could not initialize account usage.', windows: [] }); return; }
				send({ method: 'initialized', params: {} });
				send({ method: 'account/rateLimits/read', id: 2 });
			} else if (message.id === 2) {
				finish(message.error
					? { detail: 'Sign in to Codex with ChatGPT to view account usage.', windows: [] }
					: formatCodexRateLimits(message.result));
			}
		});
		send({ method: 'initialize', id: 1, params: { clientInfo: { name: 'cleanslate', title: 'CleanSlate', version: '1.0.0' } } });
	});
}
