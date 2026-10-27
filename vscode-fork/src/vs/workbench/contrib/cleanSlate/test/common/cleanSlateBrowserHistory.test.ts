/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { IBrowserHistoryEntry } from '../../../../../platform/native/common/browserIntegration.js';
import { InMemoryStorageService, StorageScope, StorageTarget, WillSaveStateReason } from '../../../../../platform/storage/common/storage.js';
import { cleanSlateBrowserHistoryKey, readCleanSlateBrowserHistory } from '../../browser/agentManager/cleanSlateBrowserData.js';
import { CleanSlateBrowserHistory } from '../../browser/agentManager/cleanSlateBrowserHistory.js';

suite('CleanSlate browser history', () => {
	let storage: InMemoryStorageService;
	let history: CleanSlateBrowserHistory;
	let clock: sinon.SinonFakeTimers;

	setup(() => { storage = new InMemoryStorageService(); clock = sinon.useFakeTimers({ now: 100_000 }); });
	teardown(() => { history?.dispose(); storage.dispose(); clock.restore(); });

	test('coalesces title bursts into one write and keeps the latest title and visit count', async () => {
		history = new CleanSlateBrowserHistory(storage);
		const writes = sinon.spy(storage, 'store');
		for (let index = 0; index < 30; index++) { history.record('https://example.test/', `Title ${index}`); }
		assert.strictEqual(writes.callCount, 0);
		assert.strictEqual(history.size, 1);
		assert.strictEqual(Array.from(history.entries())[0].title, 'Title 29');
		await clock.tickAsync(750);
		assert.strictEqual(writes.callCount, 1);
		assert.deepStrictEqual(readCleanSlateBrowserHistory(storage), [{ url: 'https://example.test/', title: 'Title 29', lastVisit: 100_000, visits: 1 }]);
		history.record('https://example.test/', 'Title 29');
		await clock.tickAsync(750);
		assert.strictEqual(writes.callCount, 1);
	});

	test('merges another window or import with pending visits and removals', () => {
		history = new CleanSlateBrowserHistory(storage);
		history.record('https://removed.test/', 'Remove');
		history.remove('https://removed.test/');
		history.record('https://local.test/', 'Local');
		storage.store(cleanSlateBrowserHistoryKey, JSON.stringify([
			{ url: 'https://imported.test/', title: 'Imported', lastVisit: 10, visits: 2 },
			{ url: 'https://removed.test/', title: 'Old', lastVisit: 5, visits: 1 }
		]), StorageScope.PROFILE, StorageTarget.MACHINE);
		history.flush();
		assert.deepStrictEqual(readCleanSlateBrowserHistory(storage).map(page => page.url), ['https://local.test/', 'https://imported.test/']);
	});

	test('retains only the most recent 50,000 pages after adding a visit', () => {
		storage.store(cleanSlateBrowserHistoryKey, JSON.stringify(Array.from({ length: 50_000 }, (_, index) => ({ url: `https://example.test/${index}`, title: String(index), lastVisit: 50_000 - index, visits: 1 }))), StorageScope.PROFILE, StorageTarget.MACHINE);
		history = new CleanSlateBrowserHistory(storage);
		history.record('https://new.test/', 'New');
		history.flush();
		const pages = readCleanSlateBrowserHistory(storage);
		assert.strictEqual(pages.length, 50_000);
		assert.strictEqual(pages[0].url, 'https://new.test/');
		assert.strictEqual(pages.at(-1)?.url, 'https://example.test/49998');
	});

	test('flushes pending changes on shutdown before a worker reply can overwrite them', async () => {
		const reply = new DeferredPromise<string>();
		history = new CleanSlateBrowserHistory(storage, () => reply.p);
		history.record('https://example.test/', 'Before');
		await clock.tickAsync(750);
		history.record('https://example.test/', 'After');
		await storage.flush(WillSaveStateReason.SHUTDOWN);
		await reply.complete('[]');
		await clock.tickAsync(0);
		assert.strictEqual(readCleanSlateBrowserHistory(storage)[0].title, 'After');
	});

	test('discards an obsolete worker reply after a newer visit or external history change', async () => {
		const reply = new DeferredPromise<string>();
		const serializer = sinon.stub().returns(reply.p);
		history = new CleanSlateBrowserHistory(storage, serializer);
		history.record('https://local.test/', 'Before');
		await clock.tickAsync(750);
		history.record('https://local.test/', 'Latest');
		storage.store(cleanSlateBrowserHistoryKey, JSON.stringify([{ url: 'https://external.test/', title: 'External', lastVisit: 5, visits: 1 }]), StorageScope.PROFILE, StorageTarget.MACHINE);
		await reply.complete('[]');
		await clock.tickAsync(0);
		history.flush();
		assert.deepStrictEqual(readCleanSlateBrowserHistory(storage).map(page => page.title), ['Latest', 'External']);
	});

	test('uses the background serializer and falls back without losing a visit if it fails', async () => {
		const serializer = sinon.stub().callsFake(async (_base: string, changes: [string, IBrowserHistoryEntry | null][]) => JSON.stringify(changes.flatMap(([, page]) => page ? [page] : [])));
		history = new CleanSlateBrowserHistory(storage, serializer);
		history.record('https://example.test/', 'Saved by worker');
		await clock.tickAsync(750);
		assert.strictEqual(readCleanSlateBrowserHistory(storage)[0].title, 'Saved by worker');
		serializer.rejects(new Error('Worker unavailable'));
		history.record('https://example.test/', 'Saved by fallback');
		await clock.tickAsync(750);
		assert.strictEqual(readCleanSlateBrowserHistory(storage)[0].title, 'Saved by fallback');
	});
});
