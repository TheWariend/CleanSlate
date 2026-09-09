/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ICleanSlateManagedEntitlements } from '@cleanslate/sdk';

function resetLabel(value: string | undefined, now: number): string {
	if (!value) { return 'reset time unavailable'; }
	const resetAt = new Date(value).getTime();
	if (!Number.isFinite(resetAt)) { return 'resets soon'; }
	let seconds = Math.ceil((resetAt - now) / 1000);
	if (seconds <= 0) { return 'resetting'; }
	const days = Math.floor(seconds / 86400); seconds -= days * 86400;
	const hours = Math.floor(seconds / 3600); seconds -= hours * 3600;
	const minutes = Math.floor(seconds / 60);
	const parts: string[] = [];
	if (days) { parts.push(`${days}d`); }
	if (days || hours) { parts.push(`${hours}h`); }
	parts.push(`${minutes}m`);
	return `resets in ${parts.join(' ')}`;
}

function usedActions(limit: number, remaining: number | undefined, requests: number | undefined): number {
	const used = typeof remaining === 'number' && Number.isFinite(remaining) ? limit - remaining : Number(requests || 0);
	return Math.min(limit, Math.max(0, used));
}

function usedBudgetPercent(value: ICleanSlateManagedEntitlements): number {
	const percent = Number(value.usage?.monthly_used_percent);
	return Number.isFinite(percent) ? Math.min(100, Math.max(0, Math.round(percent))) : 0;
}

function usageBar(percent: number, width = 20): string {
	const normalized = Math.min(100, Math.max(0, percent));
	const filled = Math.round((normalized / 100) * width);
	return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}] ${Math.round(normalized)}%`;
}

export function formatManagedUsage(value: ICleanSlateManagedEntitlements, now = Date.now()): string {
	const freeWithoutManagedAccess = !value.plan && !value.managed_ai;
	const managedFree = value.plan?.id === 'free';
	const lines = [`Usage · ${value.plan?.name || 'Free plan'}`];
	if (freeWithoutManagedAccess) {
		lines.push('Managed AI is not enabled for this account.');
		return lines.join('\n');
	}
	if (managedFree) {
		const usedPercent = usedBudgetPercent(value);
		lines.push(`Monthly allowance: ${usedPercent}% used · ${resetLabel(value.resets_at?.monthly ?? value.period?.end, now)}`);
		lines.push(`  ${usageBar(usedPercent)}`);
	} else {
		const dailyLimit = Number(value.limits?.daily_action_limit || 0);
		const weeklyLimit = Number(value.limits?.weekly_action_limit || 0);
		if (dailyLimit > 0) {
			const used = usedActions(dailyLimit, value.limits?.remaining_daily_actions, value.usage?.daily_requests);
			lines.push(`Session limit: ${used} of ${dailyLimit} used · ${resetLabel(value.resets_at?.daily, now)}`);
			lines.push(`  ${usageBar((used / dailyLimit) * 100)}`);
		}
		if (weeklyLimit > 0) {
			const used = usedActions(weeklyLimit, value.limits?.remaining_weekly_actions, value.usage?.weekly_requests);
			lines.push(`Weekly limit: ${used} of ${weeklyLimit} used · ${resetLabel(value.resets_at?.weekly, now)}`);
			lines.push(`  ${usageBar((used / weeklyLimit) * 100)}`);
		}
		lines.push(`Usage credits: $${(Number(value.credits?.balance_cents || 0) / 100).toFixed(2)}`);
	}
	if (!value.can_use_managed_ai && value.managed_ai_reason) {
		lines.push(`Access: ${value.managed_ai_reason.replaceAll('_', ' ')}`);
	}
	return lines.join('\n');
}
