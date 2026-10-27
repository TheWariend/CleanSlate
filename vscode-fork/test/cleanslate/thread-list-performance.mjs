// Exercise the real SQLite boundary with large histories. Listing must never
// transfer transcript/runtime blobs; opening a selected chat must retain them.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URI } from '../../out/vs/base/common/uri.js';
import { CleanSlateThreadPersistenceStore } from '../../out/vs/workbench/services/cleanSlate/node/core/cleanSlateThreadPersistenceStore.js';

const root = await mkdtemp(join(tmpdir(), 'cleanslate-thread-list-'));
const log = { trace() {}, debug() {}, info() {}, warn() {}, error() {} };
const store = new CleanSlateThreadPersistenceStore({ userRoamingDataHome: URI.file(root) }, log);
try {
	const content = 'Long imported response. '.repeat(12_000);
	for (let index = 0; index < 24; index++) {
		const history = [{ role: 'user', content: `Fix issue ${index}` }, { role: 'assistant', content }];
		await store.saveActiveSession(root, { id: `large-${index}`, title: index === 0 ? 'Agent' : `Chat ${index}`,
			savedAt: 1, updatedAt: index + 1, projectRoot: root, history, transcript: history,
			taskState: { large: content }, agentRuntimeState: { large: content } });
	}
	const all = store.all.bind(store);
	let returnedBytes = 0;
	store.all = async (...args) => {
		const rows = await all(...args);
		for (const row of rows) {
			for (const key of ['transcript', 'agentRuntimeState', 'taskState', 'threadState', 'agent']) {
				assert.equal(Object.hasOwn(row, key), false, `Listing fetched ${key}`);
			}
		}
		returnedBytes += Buffer.byteLength(JSON.stringify(rows));
		return rows;
	};
	const started = performance.now();
	const summaries = await store.listSessions();
	const elapsed = performance.now() - started;
	assert.equal(summaries.length, 24);
	assert.equal(summaries.find(session => session.id === 'large-0').title, 'Fix issue 0');
	assert.ok(returnedBytes < 24_000, `Metadata response was ${returnedBytes} bytes`);
	store.all = all;
	assert.equal((await store.loadSession('large-0')).transcript.at(-1).content, content);
	// Older databases can carry only a transcript with a placeholder title.
	const db = await store.getDb();
	await store.run(db, 'DELETE FROM ThreadMessages WHERE sessionId = ?', ['large-0']);
	assert.equal((await store.listSessions()).find(session => session.id === 'large-0').title, 'Fix issue 0');
	await store.run(db, 'UPDATE ThreadSessions SET transcript = ? WHERE id = ?', ['invalid JSON', 'large-0']);
	assert.equal((await store.listSessions()).find(session => session.id === 'large-0').title, 'Agent');
	console.log(`Passed: 24 large chats listed in ${elapsed.toFixed(1)}ms, ${returnedBytes} bytes of metadata; full hydration and legacy titles preserved.`);
} finally {
	store.dispose();
	await rm(root, { recursive: true, force: true });
}
