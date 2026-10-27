// Real SQLite and desktop IPC: imports survive restart, preserve native session
// identity, and never overwrite a chat that has continued in CleanSlate.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeCleanSlateMainService } from '../../out/vs/workbench/services/cleanSlate/node/core/cleanSlateMainService.js';
import { CleanSlateMainChannel, CleanSlateMainChannelClient } from '../../out/vs/workbench/services/cleanSlate/node/core/cleanSlateMainChannel.js';
import { URI } from '../../out/vs/base/common/uri.js';
import { CancellationToken } from '../../out/vs/base/common/cancellation.js';

const root = await mkdtemp(join(tmpdir(), 'cleanslate-import-ipc-'));
const profile = join(root, 'profile');
const dataHome = join(root, 'codex');
const log = { trace() {}, debug() {}, info() {}, warn() {}, error() {} };
const createService = () => new NodeCleanSlateMainService({}, { args: {}, userDataPath: profile, userRoamingDataHome: URI.file(profile) }, log);
const clientFor = service => {
	const server = new CleanSlateMainChannel(service);
	return new CleanSlateMainChannelClient({ listen: (event, args) => server.listen({}, event, args), call: (command, args) => server.call({}, command, args, CancellationToken.None) });
};
let service;
try {
	await mkdir(profile);
	await mkdir(join(dataHome, 'sessions'), { recursive: true });
	for (let index = 0; index < 55; index++) {
		await writeFile(join(dataHome, 'sessions', `rollout-${index}.jsonl`), [
			{ type: 'session_meta', payload: { id: `original-${index}`, source: 'cli', cwd: root, timestamp: '2026-10-01T00:00:00Z' } },
			{ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `Fix issue ${index}` }] } },
			{ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'I can help.' }] } }
		].map(value => JSON.stringify(value)).join('\n'));
	}
	service = createService();
	let client = clientFor(service);
	const updates = [];
	client.onDidPublishThreadSession(update => updates.push(update));
	const discovered = await client.discoverExternalAgentHistory({ source: 'codex', dataHome });
	assert.equal(discovered.sessions.length, 55);
	const [first, ...rest] = discovered.sessions;
	const concurrent = await Promise.all([client.importExternalAgentHistory(first), client.importExternalAgentHistory(first)]);
	assert.equal(concurrent.filter(result => result.imported).length, 1);
	for (const entry of rest) { assert.equal((await client.importExternalAgentHistory(entry)).imported, true); }
	assert.equal((await client.listThreadSessions()).length, 55);
	assert.equal(updates.length, 55);
	const original = await client.loadThreadSession(first.id);
	assert.equal(original.externalAgentSessionId, first.sessionId);
	assert.equal(original.externalAgent.dataHome, first.dataHome);
	assert.equal(original.history[0].content, first.title);
	const continued = { ...original, history: [...original.history, { role: 'user', content: 'A follow-up from CleanSlate' }], updatedAt: Date.now() };
	await client.saveActiveThreadSession(root, continued);
	assert.equal((await client.importExternalAgentHistory(first)).imported, false);
	assert.equal((await client.loadThreadSession(first.id)).history.at(-1).content, 'A follow-up from CleanSlate');
	for (let index = 0; index < 52; index++) {
		await client.archiveThreadSession(root, { id: `native-${index}`, title: 'Native chat', savedAt: Date.now(), updatedAt: Date.now(), projectRoot: root, history: [{ role: 'user', content: 'Hello' }] });
	}
	assert.equal((await client.listThreadSessions()).filter(session => session.id.startsWith('import-')).length, 55);
	service.dispose();
	service = createService();
	client = clientFor(service);
	const restored = await client.loadThreadSession(first.id);
	assert.equal(restored.externalAgentSessionId, first.sessionId);
	assert.equal(restored.externalAgent.dataHome, first.dataHome);
	assert.equal(restored.history.at(-1).content, 'A follow-up from CleanSlate');
	await client.removeThreadSession(first.id);
	assert.equal((await client.importExternalAgentHistory(first)).imported, true);
	console.log('Passed: Claude/Codex history IPC, real SQLite restart, concurrent deduplication, continued-chat protection, retention of 55 imports and deliberate reimport.');
} finally {
	service?.dispose();
	await rm(root, { recursive: true, force: true });
}
