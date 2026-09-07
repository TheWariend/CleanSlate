// Exercises the desktop main-service factory and IPC methods with a scripted
// provider and a real SDK file tool. No account, network or UI process is needed.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeCleanSlateMainService } from '../../out/vs/workbench/services/cleanSlate/node/core/cleanSlateMainService.js';
import { CleanSlateMainChannel, CleanSlateMainChannelClient } from '../../out/vs/workbench/services/cleanSlate/node/core/cleanSlateMainChannel.js';
import { URI } from '../../out/vs/base/common/uri.js';
import { Emitter } from '../../out/vs/base/common/event.js';
import { CancellationToken } from '../../out/vs/base/common/cancellation.js';
import { createNodeProviderConfiguration } from '@cleanslate/sdk/node/cleanSlateNodeAgentRuntime.js';

const directory = await mkdtemp(join(tmpdir(), 'cleanslate-desktop-host-'));
const log = { trace() {}, debug() {}, info() {}, warn() {}, error() {} };
const service = new NodeCleanSlateMainService({}, { userDataPath: directory, userRoamingDataHome: URI.file(directory) }, log);
// Persistence is exercised through its public calls, without requiring an
// Electron-specific SQLite binary in this plain-Node integration test.
const archived = new Map();
const active = new Map();
service.threadPersistenceStore = {
	archiveSession: async (_workspace, session) => { archived.set(session.id, session); },
	saveActiveSession: async (workspace, session) => { active.set(workspace, session); },
	loadActiveSession: async workspace => active.get(workspace),
	loadSession: async id => archived.get(id)
};
service.getModelsDevModelMetadata = async () => undefined;
const server = new CleanSlateMainChannel(service);
const newClient = () => new CleanSlateMainChannelClient({
	listen: (event, args) => server.listen({}, event, args),
	call: (command, args) => server.call({}, command, args, CancellationToken.None)
});
let releaseProvider;
const released = new Promise(resolve => { releaseProvider = resolve; });
let providerCalls = 0;
service.openAICompatibleChatStream = () => {
	const call = ++providerCalls;
	const emitter = new Emitter();
	void released.then(() => setTimeout(() => {
		if (call === 1) {
			emitter.fire(`data: ${JSON.stringify({ type: 'tool_call', call: { id: 'write-result', toolName: 'write_file', input: {
				file_path: join(directory, 'result.txt'), content: 'The main-process agent survived the workspace view.', open: false
			} } })}\n\n`);
		} else {
			emitter.fire('data: {"type":"text","content":"Finished the requested file.","phase":"final_answer"}\n\n');
		}
		emitter.fire(null);
	}, 0));
	return emitter.event;
};
const timeout = setTimeout(() => { console.error('Hosted IPC test timed out'); process.exit(1); }, 15000);
try {
	// Settings windows and detached runtimes share the same rotating credential.
	let rotations = 0;
	service.proxyRequest = async () => {
		rotations++;
		await new Promise(resolve => setTimeout(resolve, 10));
		return { res: { statusCode: 200, headers: {} }, data: JSON.stringify({ token: `rotated-${rotations}`, expires_in: 900 }) };
	};
	const refreshEvents = [];
	const authSubscription = newClient().onDidRefreshManagedToken(event => refreshEvents.push(event));
	const authResults = await Promise.all([
		newClient().refreshCleanSlateManagedToken('old-token'),
		newClient().refreshCleanSlateManagedToken('old-token'),
		service.managedTokens.refresh('old-token')
	]);
	assert.equal(rotations, 1);
	assert.deepEqual(authResults.map(result => result.token), ['rotated-1', 'rotated-1', 'rotated-1']);
	assert.deepEqual(refreshEvents, [{ previousToken: 'old-token', token: 'rotated-1', expires_at: undefined, expires_in: 900 }]);
	await service.managedTokens.refresh('rotated-1');
	assert.equal((await newClient().refreshCleanSlateManagedToken('old-token')).token, 'rotated-2');
	assert.equal(rotations, 2);
	authSubscription.dispose();
	console.log('Passed: shared Settings/host refresh through IPC, one rotation, expiry event and stale-token recovery.');
	const before = newClient();
	let oldViewEvents = 0;
	const oldSubscription = before.onDidPublishThreadSession(() => oldViewEvents++);
	const session = { id: 'desktop-task', title: 'Desktop task', savedAt: Date.now(), workDir: directory, workspaceId: 'project-a',
		history: [], transcript: [{ id: 'user', role: 'user', content: 'Create result.txt' }] };
	const accepted = await before.startHostedAgentRun({ session, text: 'Create result.txt', configuration: {
		...createNodeProviderConfiguration({ provider: 'openai', model: 'test', apiKey: 'private-test-key' }), ragEnabled: false, editMode: 'auto'
	} });
	assert.equal(accepted.live.isRunning, true);
	oldSubscription.dispose();
	const oldCount = oldViewEvents;
	releaseProvider();
	await service.agentHost.whenSettled(session.id);
	assert.equal(await readFile(join(directory, 'result.txt'), 'utf8'), 'The main-process agent survived the workspace view.');
	assert.equal(oldViewEvents, oldCount);
	const after = newClient();
	const events = [];
	const subscription = after.onDidPublishThreadSession(update => events.push(update));
	await after.publishThreadSession({ originId: 'replacement-renderer', session, request: 'sync' });
	assert.equal(events.at(-1).live.runId, accepted.live.runId);
	assert.equal(events.at(-1).live.isRunning, false);
	assert.match(JSON.stringify(events.at(-1).session.transcript), /Finished the requested file/);
	await after.saveActiveThreadSession('project-a', session); // A stale renderer's pre-run state.
	await after.archiveThreadSession('project-a', session);
	await after.publishThreadSession({ originId: 'agentManager:handoff', session, makeActive: true });
	assert.equal(events.at(-1).makeActive, true);
	assert.equal(events.at(-1).live.runId, accepted.live.runId);
	for (const saved of [await after.loadThreadSession(session.id), await after.loadActiveThreadSession('project-a'), archived.get(session.id)]) {
		assert.equal(saved.agentRuntimeState.messages.some(message => message.role === 'tool'), true);
		assert.equal(JSON.stringify(saved).includes('private-test-key'), false);
	}
	assert.equal(providerCalls, 2);
	subscription.dispose();
	console.log('Passed: desktop host factory, SDK file write after view detachment, IPC reconnect, canonical saves and handoff, no tool replay or credential persistence.');
} finally {
	clearTimeout(timeout);
	service.dispose();
	await rm(directory, { recursive: true, force: true });
}
