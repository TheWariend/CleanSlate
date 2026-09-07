/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CleanSlateManagedTokenCoordinator } from '../protocol/cleanSlateManagedTokenCoordinator.js';

describe('CleanSlateManagedTokenCoordinator', () => {
	test('shares one in-flight rotation and resolves every successful ancestor to the latest token', async () => {
		const calls: string[] = [];
		const coordinator = new CleanSlateManagedTokenCoordinator(async token => {
			calls.push(token);
			return { token: `${token}-next`, expires_in: 3600 };
		});
		const first = coordinator.refresh('account-a');
		assert.equal(coordinator.refresh('account-a'), first);
		assert.deepEqual(await first, { token: 'account-a-next', expires_in: 3600 });
		await coordinator.refresh('account-a-next');
		assert.equal(coordinator.resolve('account-a'), 'account-a-next-next');
		assert.equal(coordinator.resolve('account-a-next'), 'account-a-next-next');
		assert.equal((await coordinator.refresh('account-a')).token, 'account-a-next-next');
		assert.deepEqual(calls, ['account-a', 'account-a-next']);
	});

	test('a stale consumer joins an in-flight rotation of the current descendant', async () => {
		let release: (() => void) | undefined;
		const coordinator = new CleanSlateManagedTokenCoordinator(async token => {
			if (token === 'fresh') {
				await new Promise<void>(resolve => { release = resolve; });
				return { token: 'newest' };
			}
			return { token: 'fresh' };
		});
		await coordinator.refresh('old');
		const next = coordinator.refresh('fresh');
		await Promise.resolve();
		assert.equal(coordinator.refresh('old'), next);
		release!();
		assert.equal((await next).token, 'newest');
	});

	test('failed refreshes are retryable and never inherit a different account token', async () => {
		let attempts = 0;
		const coordinator = new CleanSlateManagedTokenCoordinator(async token => {
			if (token === 'account-b') {
				attempts++;
				if (attempts === 1) throw new Error('session revoked');
			}
			return { token: `${token}-fresh` };
		});
		await coordinator.refresh('account-a');
		await assert.rejects(coordinator.refresh('account-b'), /session revoked/);
		assert.equal(coordinator.resolve('account-b'), 'account-b');
		assert.equal((await coordinator.refresh('account-b')).token, 'account-b-fresh');
		assert.equal(attempts, 2);
		assert.equal(coordinator.resolve('account-a'), 'account-a-fresh');
	});

	test('clearing drops token lineage and late responses cannot repopulate it', async () => {
		let release: (() => void) | undefined;
		const coordinator = new CleanSlateManagedTokenCoordinator(async () => {
			await new Promise<void>(resolve => { release = resolve; });
			return { token: 'fresh' };
		});
		const pending = coordinator.refresh('old');
		await Promise.resolve();
		coordinator.clear();
		release!();
		await pending;
		assert.equal(coordinator.resolve('old'), 'old');
	});
});
