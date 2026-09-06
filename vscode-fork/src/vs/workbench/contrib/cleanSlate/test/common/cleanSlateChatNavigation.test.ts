/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CleanSlateChatSessionProvider } from '../../browser/chat/providers/cleanSlateChatSessionProvider.js';
import { CleanSlateAgentManagerSessionMapper } from '../../browser/agentManager/cleanSlateAgentManagerSessionMapper.js';
import { CleanSlateAgentManagerSessionRepository } from '../../browser/agentManager/cleanSlateAgentManagerSessionRepository.js';
import { CleanSlateAgentManagerProjectProvider } from '../../browser/agentManager/cleanSlateAgentManagerProjectProvider.js';
import type { ICleanSlateSessionSnapshot } from '../../browser/chat/types/cleanSlateChatSessionTypes.js';

suite('CleanSlate chat navigation', () => {
	for (const cachedTitle of ['Agent', 'An earlier title']) {
		test(`loads the saved old-chat title over '${cachedTitle}' without loading its conversation`, async () => {
			const cached: ICleanSlateSessionSnapshot = {
				id: 'old-chat', title: cachedTitle, savedAt: 1, updatedAt: 1, planMode: false, reasoningLevel: 'medium',
				history: [{ role: 'user', content: 'Original request' }, { role: 'assistant', content: 'A long saved response to keep cached.' }]
			};
			const saved = { ...cached, title: 'My saved game chat', updatedAt: 3,
				history: [{ role: 'user', content: 'My saved game chat' }] };
			const repository = new CleanSlateAgentManagerSessionRepository({
				listThreadSessions: async () => [saved],
				loadThreadSession: () => assert.fail('Sidebar title must not require full hydration')
			} as any, new CleanSlateAgentManagerSessionMapper(), new CleanSlateAgentManagerProjectProvider());
			const overlay = { ...cached, title: 'Agent', updatedAt: 4 };
			const result = await repository.load([], [cached], [overlay], () => false, false);
			assert.strictEqual(result.sessions[0].title, saved.title);
			assert.strictEqual(result.sessions[0].history, cached.history);
			assert.strictEqual(cached.title, cachedTitle, 'Must not mutate archived snapshots');
			const repeated = await repository.load([], result.sessions, [overlay], () => false, false);
			assert.strictEqual(repeated.sessions[0].title, saved.title, 'Refreshing must not restore the placeholder');
		});
	}

	test('reads an existing title without accessing conversation history or task state', () => {
		const provider = Object.create(CleanSlateChatSessionProvider.prototype);
		provider.activeSessionId = 'chat';
		provider.sessions = new Map([['chat', {
			title: 'Fix the login screen',
			controller: { getHistory: () => assert.fail('Title refresh copied history') },
			taskSessionService: { getRunSummary: () => assert.fail('Title refresh read task state') }
		}]]);
		assert.strictEqual(provider.getCurrentTitle(), 'Fix the login screen');
	});

	test('derives a placeholder title from the first user request', () => {
		const provider = Object.create(CleanSlateChatSessionProvider.prototype);
		provider.activeSessionId = 'chat';
		provider.sessions = new Map([['chat', {
			title: 'Agent',
			transcriptHistory: [],
			controller: { getHistory: () => assert.fail('Title derivation copied history') },
			taskSessionService: { getRunSummary: () => ({ objective: 'Later task' }) },
			threadService: { getRawHistoryReference: () => [{ role: 'user', content: 'Fix login' }] }
		}]]);
		assert.strictEqual(provider.getCurrentTitle(), 'Fix login');
	});

	test('detects image-only and payload-only chats without building a snapshot', () => {
		const provider = Object.create(CleanSlateChatSessionProvider.prototype);
		const session = {
			threadService: { getRawHistoryReference: () => [{ role: 'system', content: 'Internal', isInternalState: true }] },
			transcriptHistory: [] as { role: string; content: string; images?: string[]; renderPayload?: string }[]
		};
		provider.activeSessionId = 'chat';
		provider.sessions = new Map([['chat', session]]);
		provider.buildSessionSnapshot = () => assert.fail('Content check built a snapshot');
		assert.strictEqual(provider.hasCurrentSessionContent(), false);
		session.transcriptHistory = [{ role: 'user', content: '', images: ['data:image/png;base64,test'] }];
		assert.strictEqual(provider.hasCurrentSessionContent(), true);
		session.transcriptHistory = [{ role: 'assistant', content: '', renderPayload: '{"summary":["Done"]}' }];
		assert.strictEqual(provider.hasCurrentSessionContent(), true);
	});

	for (const surface of ['agentManager', 'ide']) {
		test(`restores ${surface} selection with the appropriate persistence behavior`, () => {
			const provider = Object.create(CleanSlateChatSessionProvider.prototype);
			let saves = 0;
			let notifications = 0;
			const session = { id: 'chat', controller: { setExternalGeneratingState: () => { } } };
			provider.sessions = new Map([['chat', session]]);
			provider.deletedSessionIds = new Set();
			provider.activeSessionRevision = 0;
			provider.surface = surface;
			provider.refreshLiveSessionFromSnapshot = () => { };
			provider.runState = { isRunning: () => true };
			provider.persistSession = () => saves++;
			provider.requestLiveSessionSync = async () => { };
			provider._onDidChangeState = { fire: () => notifications++ };
			provider.restoreSession({ id: 'chat', planMode: false, reasoningLevel: 'medium' });
			assert.strictEqual(provider.getActiveSessionId(), 'chat');
			assert.strictEqual(provider.sessions.get('chat').status, 'running');
			assert.strictEqual(saves, surface === 'agentManager' ? 0 : 1);
			assert.strictEqual(notifications, 1);
		});
	}
});
