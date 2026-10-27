import { test, expect } from './fixtures.mjs';

async function mountHistory(page) {
	return page.evaluate(async () => {
		await import('/qa/browser-fixtures.mjs');
		const { CleanSlateTranscriptView } = await import('/vs/workbench/contrib/cleanSlate/browser/chat/view/sections/cleanSlateTranscriptView.js');
		const root = document.getElementById('fixture');
		root.className = 'cleanSlate-chat-view';
		root.style.cssText = 'display:flex;flex-direction:column;height:600px';
		// Plain user messages keep the check focused on navigation/windowing rather
		// than a mocked markdown implementation. The real transcript DOM is used.
		const view = new CleanSlateTranscriptView(root, { disposeMarkdownRenders() {} }, () => {});
		const history = Array.from({ length: 1000 }, (_, index) => ({ id: `message-${index}`, role: 'user', content: `Message ${index} with enough text to be a full visible row` }));
		globalThis.navigationQA = { view, history };
		view.restore(history, undefined, false, 'large-chat');
		await new Promise(requestAnimationFrame);
		return { stored: history.length, visible: view.element.querySelectorAll('[data-clean-slate-transcript-id]').length };
	});
}

test('a thousand-message chat opens with a bounded transcript and can load older messages', async ({ page }) => {
	expect(await mountHistory(page)).toEqual({ stored: 1000, visible: 60 });
	await expect(page.locator('[data-clean-slate-transcript-id="message-999"]')).toBeVisible();
	await expect(page.locator('[data-clean-slate-transcript-id="message-0"]')).toHaveCount(0);
	await page.evaluate(() => { navigationQA.view.element.scrollTop = 0; });
	await page.getByRole('button', { name: 'Show earlier messages (940)', exact: true }).click();
	await expect(page.locator('[data-clean-slate-transcript-id]')).toHaveCount(120);
	await expect(page.locator('[data-clean-slate-transcript-id="message-940"]')).toBeInViewport();
	await page.evaluate(() => {
		const { view, history } = navigationQA;
		view.restore(history, undefined, false, 'large-chat');
	});
	await expect(page.locator('[data-clean-slate-transcript-id]')).toHaveCount(120);
	await page.evaluate(() => navigationQA.view.restore(navigationQA.history, undefined, false, 'other-chat'));
	await expect(page.locator('[data-clean-slate-transcript-id]')).toHaveCount(60);
	await page.evaluate(() => {
		const { view, history } = navigationQA;
		view.restore(history, undefined, false, 'large-chat');
		while (view.element.querySelector('.cleanSlate-load-earlier-messages')) {
			view.element.querySelector('.cleanSlate-load-earlier-messages').click();
		}
	});
	await expect(page.locator('[data-clean-slate-transcript-id]')).toHaveCount(1000);
});

test('moving across sidebar rows cancels speculative loads and hovering warms only one chat', async ({ page }) => {
	const result = await page.evaluate(async () => {
		const { CleanSlateAgentManagerSidebarView } = await import('/vs/workbench/contrib/cleanSlate/browser/agentManager/cleanSlateAgentManagerSidebarView.js');
		const root = document.getElementById('fixture');
		const view = new CleanSlateAgentManagerSidebarView(root);
		const sessions = Array.from({ length: 250 }, (_, index) => ({ id: `chat-${index}`, title: `Chat ${index}`, savedAt: index, history: [{ role: 'user', content: 'Hello' }] }));
		const entry = { id: 'project', label: 'Project' };
		const prefetched = [];
		view.render({ groups: [{ key: 'project', label: 'Project', entry, sessions }], filter: '', activeSessionId: 'chat-0', selectedWorkspaceKey: 'project',
			getGroupEntry: () => entry, getWorkspaceEntryKey: () => 'project', isRunningSession: () => false,
			onSelectWorkspace() {}, onNewChatForWorkspace() {}, onRestoreSession() {}, onDeleteSession() {}, onShowProjectActions() {},
			onPrefetchSessions: sessions => prefetched.push(sessions.map(session => session.id)) });
		const rows = [...root.querySelectorAll('.cleanSlate-agent-manager-session')];
		for (const row of rows.slice(0, 40)) { row.dispatchEvent(new PointerEvent('pointerenter')); row.dispatchEvent(new PointerEvent('pointerleave')); }
		await new Promise(resolve => setTimeout(resolve, 160));
		const afterSweep = [...prefetched];
		rows[42].dispatchEvent(new PointerEvent('pointerenter'));
		await new Promise(resolve => setTimeout(resolve, 160));
		return { afterSweep, prefetched };
	});
	expect(result.afterSweep).toEqual([]);
	expect(result.prefetched).toEqual([['chat-42']]);
});

test('transcript cache detects edits and returns independent copies with stable message ids', async ({ page }) => {
	const result = await page.evaluate(async () => {
		const { CleanSlateChatSessionSnapshotCodec } = await import('/vs/workbench/contrib/cleanSlate/browser/chat/providers/cleanSlateChatSessionSnapshotCodec.js');
		const codec = new CleanSlateChatSessionSnapshotCodec();
		const history = [{ role: 'user', content: 'Original', images: ['image-a'] }];
		const first = codec.cloneTranscript(history);
		const second = codec.cloneTranscript(history);
		second[0].content = 'Changed returned copy';
		second[0].images.push('image-b');
		const third = codec.cloneTranscript(history);
		history[0].content = 'Edited source';
		const edited = codec.cloneTranscript(history);
		history.push({ role: 'assistant', content: 'Response' });
		return { stableId: first[0].id === third[0].id, untouched: third[0].content, images: third[0].images, edited: edited[0].content, count: codec.cloneTranscript(history).length };
	});
	expect(result).toEqual({ stableId: true, untouched: 'Original', images: ['image-a'], edited: 'Edited source', count: 2 });
});

test('switching away from an unchanged stopped chat avoids rewriting the archive', async ({ page }) => {
	const result = await page.evaluate(async () => {
		const { CleanSlateChatHistoryProvider } = await import('/vs/workbench/contrib/cleanSlate/browser/chat/providers/cleanSlateChatHistoryProvider.js');
		const stored = new Map();
		let stores = 0, archives = 0;
		const provider = new CleanSlateChatHistoryProvider({ get: key => stored.get(key), getObject: () => undefined, store: (key, value) => { stores++; stored.set(key, value); } },
			{ getWorkspace: () => ({ id: 'project', folders: [] }) },
			{ listArchivedThreadSessions: async () => [], archiveThreadSession: async () => { archives++; } });
		await provider.whenReady();
		let snapshot = { id: 'chat', title: 'Chat', savedAt: 1, updatedAt: 1, status: 'detached', history: [{ role: 'user', content: 'Original' }], transcript: [{ id: 'm1', role: 'user', content: 'Original' }] };
		provider.upsertArchivedSession(snapshot);
		await provider.persistenceQueue;
		stores = 0; archives = 0;
		const sessionProvider = { buildCurrentSessionSnapshot: () => ({ ...snapshot, savedAt: Date.now(), updatedAt: Date.now() }) };
		for (let index = 0; index < 30; index++) { provider.archiveCurrentSession(sessionProvider); }
		await provider.persistenceQueue;
		const unchanged = { stores, archives };
		snapshot = { ...snapshot, history: [...snapshot.history, { role: 'user', content: 'Follow-up' }], transcript: [...snapshot.transcript, { id: 'm2', role: 'user', content: 'Follow-up' }] };
		provider.archiveCurrentSession(sessionProvider);
		await provider.persistenceQueue;
		return { unchanged, changed: { stores, archives } };
	});
	expect(result.unchanged).toEqual({ stores: 0, archives: 0 });
	expect(result.changed).toEqual({ stores: 1, archives: 1 });
});

test('Agent Manager shares loads, preserves hydrated content, bounds its cache, and batches sidebar renders', async ({ page }) => {
	const result = await page.evaluate(async () => {
		const { CleanSlateAgentWorkspaceOverlay } = await import('/vs/workbench/contrib/cleanSlate/browser/agentManager/cleanSlateAgentWorkspaceOverlay.js');
		const { CleanSlateAgentManagerSessionMapper } = await import('/vs/workbench/contrib/cleanSlate/browser/agentManager/cleanSlateAgentManagerSessionMapper.js');
		const manager = Object.create(CleanSlateAgentWorkspaceOverlay.prototype);
		Object.assign(manager, {
			sessionMapper: new CleanSlateAgentManagerSessionMapper(), sessionCache: new Map(), hydratedSessionIds: new Set(), warmSessionOrder: new Set(),
			sessionHydrationPromises: new Map(), openWorkspaceTabIds: [], targetWindow: window, root: document.getElementById('fixture'),
			workspaceDataVersion: 0, globalThreadSessionsUnavailable: false, projectTreeRendering: false, projectTreeRenderPending: false,
			sidebarViewModel: { getActiveSessionId: () => 'active', isSessionRunning: () => false }, isDeletedSession: () => false,
			withKnownWorkspaceEntries: entries => entries, historyProvider: { getArchivedSessions: () => [] },
			projectProvider: { preservePersistedWorkspaceIdentity: (_summary, hydrated) => hydrated }
		});
		const summary = { id: 'chat', title: 'Chat', savedAt: 1, updatedAt: 1, history: [{ role: 'user', content: 'Chat' }] };
		const full = { ...summary, transcript: [{ id: 'm1', role: 'user', content: 'Original' }, { id: 'm2', role: 'assistant', content: 'Full response' }], history: [{ role: 'user', content: 'Original' }, { role: 'assistant', content: 'Full response' }] };
		let loads = 0, release;
		manager.cleanSlateMainService = { loadThreadSession: () => { loads++; return new Promise(resolve => { release = resolve; }); } };
		const first = manager.hydrateSession(summary), second = manager.hydrateSession(summary);
		const shared = first === second;
		release(full);
		await first;
		manager.rememberSessions([{ ...summary, title: 'Renamed', updatedAt: 2 }]);
		const retained = manager.sessionCache.get('chat');
		const preserved = retained.transcript.at(-1).content;
		for (let index = 0; index < 40; index++) { manager.rememberSessions([{ ...full, id: `warm-${index}` }]); }
		const warmCount = manager.warmSessionOrder.size;
		const evicted = !manager.hydratedSessionIds.has('chat') && manager.sessionCache.get('chat').transcript === undefined;
		let listings = 0, finishListing;
		manager.sessionRepository = { load: () => { listings++; return new Promise(resolve => { finishListing = resolve; }); } };
		const listOne = manager.getWorkspaceSessions(), listTwo = manager.getWorkspaceSessions();
		finishListing({ sessions: [full], globalListingUnavailable: false });
		const listed = await listOne;
		await listTwo;
		let renders = 0, finishRender;
		manager.renderProjectTree = () => { renders++; return new Promise(resolve => { finishRender = resolve; }); };
		for (let index = 0; index < 100; index++) { manager.renderSessions(); }
		await new Promise(requestAnimationFrame);
		const initialRenders = renders;
		for (let index = 0; index < 100; index++) { manager.renderSessions(); }
		finishRender();
		await new Promise(resolve => setTimeout(resolve, 40));
		const coalescedRenders = renders;
		finishRender();
		await Promise.resolve();
		return { shared, loads, preserved, title: retained.title, warmCount, evicted, listings, metadataOnly: listed[0].transcript === undefined,
			initialRenders, coalescedRenders };
	});
	expect(result).toEqual({ shared: true, loads: 1, preserved: 'Full response', title: 'Renamed', warmCount: 24, evicted: true, listings: 1, metadataOnly: true, initialRenders: 1, coalescedRenders: 2 });
});

test('Agent Manager loads a metadata index and persists only the changed chat to SQLite', async ({ page }) => {
	const result = await page.evaluate(async () => {
		const { CleanSlateChatHistoryProvider } = await import('/vs/workbench/contrib/cleanSlate/browser/chat/providers/cleanSlateChatHistoryProvider.js');
		let listings = 0, archives = 0, legacyReads = 0, stores = 0;
		const writes = [];
		const provider = new CleanSlateChatHistoryProvider({ get: key => { if (key === 'cleanSlate.chat.archivedSessions') { legacyReads++; } }, getObject: () => undefined, store: () => { stores++; } },
			{ getWorkspace: () => ({ id: 'project', folders: [] }) }, {
				listThreadSessions: async () => { listings++; return []; },
				listArchivedThreadSessions: async () => { throw new Error('Must not eagerly hydrate archived chats'); },
				archiveThreadSession: async (_workspace, session) => { archives++; writes.push(session); }
			}, true);
		await provider.whenReady();
		const snapshot = { id: 'chat', title: 'Chat', savedAt: 1, updatedAt: 1, status: 'detached', planMode: false, reasoningLevel: 'medium',
			history: [{ role: 'user', content: 'Original' }, { role: 'assistant', content: 'Full response' }],
			transcript: [{ id: 'm1', role: 'user', content: 'Original' }, { id: 'm2', role: 'assistant', content: 'Full response' }] };
		provider.upsertArchivedSession(snapshot);
		await provider.persistenceQueue;
		provider.archiveSessionIfChanged(snapshot);
		await provider.persistenceQueue;
		const index = provider.archivedSessions[0];
		return { listings, archives, legacyReads, stores, indexHasTranscript: !!index.transcript, storedResponse: writes[0].transcript.at(-1).content };
	});
	expect(result).toEqual({ listings: 1, archives: 1, legacyReads: 0, stores: 0, indexHasTranscript: false, storedResponse: 'Full response' });
});

test('tab summaries and sync requests avoid copying the runtime or the full transcript', async ({ page }) => {
	const result = await page.evaluate(async () => {
		const { CleanSlateChatSessionProvider } = await import('/vs/workbench/contrib/cleanSlate/browser/chat/providers/cleanSlateChatSessionProvider.js');
		const provider = Object.create(CleanSlateChatSessionProvider.prototype);
		const messages = Array.from({ length: 1000 }, (_, index) => ({ role: 'user', content: `Message ${index}` }));
		const session = { id: 'chat', title: 'Chat', createdAt: 1, workspaceId: 'project', projectRoot: '/projects/app', status: 'detached', planMode: false, reasoningLevel: 'medium',
			threadService: { getRawHistoryReference: () => messages }, transcriptHistory: messages,
			controller: { getHistory: () => { throw new Error('Summary cloned the history'); } },
			agent: { getRuntimeSnapshot: () => { throw new Error('Summary copied the agent runtime'); } } };
		provider.sessions = new Map([['chat', session]]); provider.activeSessionId = 'chat';
		provider.isLiveSessionRunning = () => false;
		const summary = provider.buildCurrentSessionSummary();
		return { id: summary.id, historyCount: summary.history.length, hasTranscript: !!summary.transcript, hasRuntime: !!summary.agentRuntimeState };
	});
	expect(result).toEqual({ id: 'chat', historyCount: 1, hasTranscript: false, hasRuntime: false });
});
