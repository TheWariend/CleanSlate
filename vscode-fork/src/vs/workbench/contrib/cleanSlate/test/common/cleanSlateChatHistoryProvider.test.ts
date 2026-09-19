/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { URI } from '../../../../../base/common/uri.js';
import { StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { CleanSlateThreadPersistenceStore } from '../../../../services/cleanSlate/node/core/cleanSlateThreadPersistenceStore.js';
import { CleanSlateChatHistoryProvider } from '../../browser/chat/providers/cleanSlateChatHistoryProvider.js';
import { ICleanSlateSessionSnapshot } from '../../browser/chat/types/cleanSlateChatSessionTypes.js';

suite('CleanSlateChatHistoryProvider', () => {
	test('keeps separate sessions when two chats use the same prompt', async () => {
		const provider = new CleanSlateChatHistoryProvider(
			createStorageService(),
			createWorkspaceContextService(),
			createMainService()
		);
		await provider.whenReady();

		provider.upsertArchivedSession(createSnapshot('session-a', 'implement dark mode'));
		provider.upsertArchivedSession(createSnapshot('session-b', 'implement dark mode'));

		assert.deepStrictEqual(
			provider.getArchivedSessions().map(session => session.id),
			['session-b', 'session-a']
		);
	});

	test('builds a session index from identity without duplicating the active session', async () => {
		const provider = new CleanSlateChatHistoryProvider(
			createStorageService(),
			createWorkspaceContextService(),
			createMainService()
		);
		await provider.whenReady();

		const archived = createSnapshot('session-a', 'implemented dark mode');
		const active: ICleanSlateSessionSnapshot = {
			...createSnapshot('session-a', 'implemented dark mode'),
			transcript: [
				{ id: 'session-a-user', role: 'user', content: 'implemented dark mode' },
				{ id: 'session-a-assistant', role: 'assistant', content: 'Not yet.' }
			]
		};

		provider.upsertArchivedSession(archived);

		const sessions = provider.getSessionIndex(active);

		assert.deepStrictEqual(sessions.map(session => session.id), ['session-a']);
		assert.deepStrictEqual(sessions[0].transcript?.map(message => message.content), ['implemented dark mode', 'Not yet.']);
	});

	test('preserves external agent identity while archiving and restoring a chat', async () => {
		const storage = createStorageService();
		const provider = new CleanSlateChatHistoryProvider(
			storage,
			createWorkspaceContextService(),
			createMainService()
		);
		await provider.whenReady();

		provider.upsertArchivedSession({
			...createSnapshot('external-session', 'Review changes'),
			externalAgent: { transport: 'acp', agentId: 'external-test' },
			externalAgentSessionId: 'agent-session-1'
		});

		const archived = provider.getArchivedSessions()[0];
		assert.strictEqual(archived.runtime, 'external');
		assert.deepStrictEqual(archived.externalAgent, { transport: 'acp', agentId: 'external-test' });
		assert.strictEqual(archived.externalAgentSessionId, 'agent-session-1');
		const cached = JSON.parse(storage.get('cleanSlate.chat.archivedSessions', StorageScope.WORKSPACE) ?? '[]');
		assert.deepStrictEqual(cached[0].externalAgent, { transport: 'acp', agentId: 'external-test' });
	});

	test('persists external agent identity in the shared session database', async () => {
		const directory = await fs.mkdtemp(join(tmpdir(), 'cleanslate-thread-store-'));
		const store = new CleanSlateThreadPersistenceStore({
			userRoamingDataHome: URI.file(directory)
		} as any, {
			info() { },
			warn() { },
			error() { }
		} as any);
		try {
			await store.archiveSession('file:///workspace', {
				id: 'external-session',
				title: 'Review changes',
				savedAt: 1,
				history: [{ role: 'user', content: 'Review changes' }],
				runtime: 'external',
				externalAgent: { transport: 'acp', agentId: 'external-test' },
				externalAgentSessionId: 'agent-session-1'
			});
			const restored = await store.loadSession('external-session');
			assert.strictEqual(restored?.runtime, 'external');
			assert.deepStrictEqual(restored?.externalAgent, { transport: 'acp', agentId: 'external-test' });
			assert.strictEqual(restored?.externalAgentSessionId, 'agent-session-1');
			const summary = (await store.listSessions())[0];
			assert.deepStrictEqual(summary.externalAgent, { transport: 'acp', agentId: 'external-test' });
		} finally {
			store.dispose();
			await new Promise(resolve => setTimeout(resolve, 0));
			await fs.rm(directory, { recursive: true, force: true });
		}
	});

	test('does not resurrect locally cached sessions after deletion', async () => {
		const deleted = createSnapshot('deleted-session', 'remove this project');
		const storage = createStorageService({
			'cleanSlate.chat.archivedSessions': JSON.stringify([deleted]),
			'cleanSlate.chat.deletedSessionIds': JSON.stringify([deleted.id])
		});
		const mainService = createMainService();
		const provider = new CleanSlateChatHistoryProvider(
			storage,
			createWorkspaceContextService(),
			mainService
		);
		await provider.whenReady();

		assert.deepStrictEqual(provider.getArchivedSessions(), []);
		assert.deepStrictEqual(mainService.archivedSessionIds, []);
		assert.deepStrictEqual(JSON.parse(storage.get('cleanSlate.chat.archivedSessions', StorageScope.WORKSPACE) ?? '[]'), []);
	});

	test('does not resurrect workspace cached sessions after global clear', async () => {
		const deleted = createSnapshot('old-workspace-session', 'old project chat', Date.now() - 10_000);
		const storage = createStorageService({
			'cleanSlate.chat.archivedSessions': JSON.stringify([deleted]),
			'cleanSlate.chat.deletedBefore': String(Date.now())
		});
		const mainService = createMainService();
		const provider = new CleanSlateChatHistoryProvider(
			storage,
			createWorkspaceContextService(),
			mainService
		);
		await provider.whenReady();

		assert.deepStrictEqual(provider.getArchivedSessions(), []);
		assert.deepStrictEqual(mainService.archivedSessionIds, []);
		assert.deepStrictEqual(JSON.parse(storage.get('cleanSlate.chat.archivedSessions', StorageScope.WORKSPACE) ?? '[]'), []);
	});
});

function createSnapshot(id: string, prompt: string, savedAt: number = Date.now()): ICleanSlateSessionSnapshot {
	return {
		id,
		title: prompt,
		savedAt,
		updatedAt: savedAt,
		history: [{ role: 'user', content: prompt }],
		transcript: [{ id: `${id}-user`, role: 'user', content: prompt }],
		transcriptVersion: 1,
		planMode: true,
		reasoningLevel: 'medium',
		workspaceName: 'workspace'
	};
}

function createStorageService(initialValues: Record<string, string> = {}): any {
	const values = new Map<string, string>(Object.entries(initialValues));
	return {
		get(key: string, _scope: StorageScope) {
			return values.get(key);
		},
		store(key: string, value: string, _scope: StorageScope, _target: StorageTarget) {
			values.set(key, value);
		},
		remove(key: string, _scope: StorageScope) {
			values.delete(key);
		}
	};
}

function createWorkspaceContextService(): any {
	return {
		getWorkspace() {
			return {
				id: 'workspace-id',
				folders: [{ name: 'workspace', uri: { toString: () => 'file:///workspace' } }]
			};
		}
	};
}

function createMainService(): any {
	const archivedSessionIds: string[] = [];
	return {
		archivedSessionIds,
		async listThreadSessions() {
			return [];
		},
		async listArchivedThreadSessions() {
			return [];
		},
		async archiveThreadSession(_workspaceId: string, session: ICleanSlateSessionSnapshot) {
			archivedSessionIds.push(session.id);
		},
		async removeThreadSession() {
		},
		async removeArchivedThreadSession() {
		}
	};
}
