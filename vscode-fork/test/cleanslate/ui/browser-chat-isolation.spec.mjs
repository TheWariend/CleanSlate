import { test, expect } from './fixtures.mjs';

async function mountIsolation(page) {
	await page.evaluate(async () => {
		await (await import('/qa/browser-fixtures.mjs')).mountIntegratedBrowserChat();
		const source = qa.manager.sessionProvider;
		const browserId = source.getBrowserChatId();
		source.browserChats.get(browserId).threadService.addMessage('user', 'BROWSER_ONLY_REQUEST');
		qa.browserSnapshot = source.getBrowserChatSnapshots()[0];
		qa.createIde = async (localSnapshot, databaseSnapshot) => {
			const values = new Map();
			if (localSnapshot) { values.set('cleanSlate.chat.activeSession', JSON.stringify(localSnapshot)); }
			const storage = { ...source.storageService,
				get: (key, _scope, fallback) => values.get(key) ?? fallback,
				store: (key, value) => values.set(key, value), remove: key => values.delete(key) };
			const saved = [];
			const main = { ...source.cleanSlateMainService,
				loadActiveThreadSession: async () => databaseSnapshot,
				saveActiveThreadSession: async (_workspace, snapshot) => { saved.push(snapshot); },
				clearActiveThreadSession: async () => {} };
			const workspace = { ...source.workspaceContextService, getWorkspace: () => ({ id: 'empty-window', folders: [] }) };
			const ide = new source.constructor(source.instantiationService, source.codeEditorService, source.editCodeService,
				source.notificationService, storage, workspace, source.cleanSlateContextService, main, source.commandApprovalService);
			await ide.whenReady();
			return { ide, saved };
		};
	});
}

test('restoring a browser snapshot cannot replace an IDE conversation or enter handoff', async ({ page }) => {
	await mountIsolation(page);
	const result = await page.evaluate(async () => {
		const { ide, saved } = await qa.createIde();
		try {
			ide.restoreSession({ ...qa.browserSnapshot, id: 'ide-chat', title: 'IDE task', workspaceId: 'no-project',
				history: [{ role: 'user', content: 'IDE_ONLY_REQUEST' }], transcript: [] });
			ide.restoreSession(qa.browserSnapshot);
			await ide.publishActiveSessionForIdeHandoff();
			await ide.persistenceQueue;
			return { id: ide.getActiveSessionId(), history: ide.getHistory(),
				savedIds: saved.map(snapshot => snapshot.id),
				browserHistory: qa.manager.sessionProvider.getBrowserChatSnapshots()[0].history };
		} finally { ide.dispose(); qa.disposeBrowserChat(); }
	});
	expect(result.id).toBe('ide-chat');
	expect(JSON.stringify(result.history)).toContain('IDE_ONLY_REQUEST');
	expect(JSON.stringify(result.history)).not.toContain('BROWSER_ONLY_REQUEST');
	expect(result.savedIds.every(id => id === 'ide-chat')).toBe(true);
	expect(JSON.stringify(result.browserHistory)).toContain('BROWSER_ONLY_REQUEST');
});

for (const location of ['local storage', 'database']) {
	test(`empty IDE startup ignores a browser snapshot in ${location}`, async ({ page }) => {
		await mountIsolation(page);
		const result = await page.evaluate(async location => {
			const browser = qa.browserSnapshot;
			const { ide } = await qa.createIde(location === 'local storage' ? browser : undefined, location === 'database' ? browser : undefined);
			try {
				const before = ide.getActiveSessionId();
				// Old publishers can still broadcast snapshots after this window starts.
				ide.applyPublishedThreadSession({ originId: 'agentManager:handoff', session: browser, makeActive: true });
				return { id: ide.getActiveSessionId(), before, browserId: browser.id, history: ide.getHistory(),
					registered: ide.sessions.has(browser.id), browserCount: qa.manager.sessionProvider.listBrowserChats().length };
			} finally { ide.dispose(); qa.disposeBrowserChat(); }
		}, location);
		expect(result.id).not.toBe(result.browserId);
		expect(result.id).toBe(result.before);
		expect(result.history).toEqual([]);
		expect(result.registered).toBe(false);
		expect(result.browserCount).toBe(1);
	});

	test(`empty IDE startup still restores its ordinary chat from ${location}`, async ({ page }) => {
		await mountIsolation(page);
		const result = await page.evaluate(async location => {
			const normal = { ...qa.browserSnapshot, id: 'ide-chat', workspaceId: 'no-project', title: 'IDE task',
				history: [{ role: 'user', content: 'IDE_ONLY_REQUEST' }], transcript: [] };
			const { ide } = await qa.createIde(location === 'local storage' ? normal : undefined, location === 'database' ? normal : undefined);
			try { return { id: ide.getActiveSessionId(), history: ide.getHistory() }; }
			finally { ide.dispose(); qa.disposeBrowserChat(); }
		}, location);
		expect(result.id).toBe('ide-chat');
		expect(JSON.stringify(result.history)).toContain('IDE_ONLY_REQUEST');
	});
}

test('IDE history and project lists exclude stale browser sessions without hiding regular chats', async ({ page }) => {
	await mountIsolation(page);
	const result = await page.evaluate(async () => {
		const { CleanSlateChatHistoryProvider } = await import('/vs/workbench/contrib/cleanSlate/browser/chat/providers/cleanSlateChatHistoryProvider.js');
		const { CleanSlateAgentManagerSessionMapper } = await import('/vs/workbench/contrib/cleanSlate/browser/agentManager/cleanSlateAgentManagerSessionMapper.js');
		const browser = qa.browserSnapshot;
		const normal = { ...browser, id: 'ide-chat', workspaceId: 'no-project', title: 'IDE task' };
		const source = qa.manager.sessionProvider;
		const values = new Map([['cleanSlate.chat.archivedSessions', JSON.stringify([browser, normal])]]);
		const history = new CleanSlateChatHistoryProvider({ ...source.storageService,
			get: (key, _scope, fallback) => values.get(key) ?? fallback,
			store: (key, value) => values.set(key, value) },
		{ getWorkspace: () => ({ id: 'empty-window', folders: [] }) },
		{ listArchivedThreadSessions: async () => [browser, normal], archiveThreadSession: async () => {} });
		await history.whenReady();
		history.upsertArchivedSession(browser);
		const mapper = new CleanSlateAgentManagerSessionMapper();
		const result = { index: history.getSessionIndex(browser).map(session => session.id),
			browserMapped: !!mapper.toSessionSnapshot(browser), normalMapped: mapper.toSessionSnapshot(normal)?.id };
		qa.disposeBrowserChat();
		return result;
	});
	expect(result).toEqual({ index: ['ide-chat'], browserMapped: false, normalMapped: 'ide-chat' });
});
