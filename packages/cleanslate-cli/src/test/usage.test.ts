/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { formatManagedUsage } from '../usage.js';

test('managed Free usage shows allowance percentage without internal budget values', () => {
	const result = formatManagedUsage({
		plan: { id: 'free', name: 'Free' }, managed_ai: true,
		usage: { monthly_used_percent: 25 },
		resets_at: { monthly: '2026-09-11T00:00:00.000Z' }
	}, Date.parse('2026-09-09T00:00:00.000Z'));
	assert.match(result, /Monthly allowance: 25% used/);
	assert.match(result, /\[█████░{15}\] 25%/);
	assert.doesNotMatch(result, /1000000|750000|budget/);
});

test('managed Pro usage follows authoritative remaining limits and shows credits', () => {
	const result = formatManagedUsage({
		plan: { id: 'pro', name: 'Pro' }, managed_ai: true, can_use_managed_ai: true,
		usage: { daily_requests: 99, weekly_requests: 99 },
		limits: { daily_action_limit: 50, weekly_action_limit: 200, remaining_daily_actions: 42, remaining_weekly_actions: 170 },
		credits: { balance_cents: 425 }
	});
	assert.match(result, /Session limit: 8 of 50 used/);
	assert.match(result, /\[███░{17}\] 16%/);
	assert.match(result, /Weekly limit: 30 of 200 used/);
	assert.match(result, /\[███░{17}\] 15%/);
	assert.match(result, /Usage credits: \$4\.25/);
});
