import { test, expect } from './fixtures.mjs';

for (const width of [220, 360]) {
	test(`PR status preserves compact sidebar rows at ${width}px`, async ({ page }, testInfo) => {
		await page.evaluate(async width => {
			await import('/qa/browser-fixtures.mjs');
			const { CleanSlateAgentManagerSidebarView } = await import('/vs/workbench/contrib/cleanSlate/browser/agentManager/cleanSlateAgentManagerSidebarView.js');
			const root = document.getElementById('fixture');
			root.style.cssText = `width:${width}px;padding:12px;background:var(--vscode-sideBar-background);--cleanSlate-agent-manager-active-bg:rgba(128,128,128,.18);--cleanSlate-agent-manager-text:var(--vscode-foreground);--cleanSlate-agent-manager-row-radius:6px`;
			const entry = { id: 'project', label: 'musclememory' };
			const sessions = ['selected', 'other'].map(id => ({ id, title: 'Clean up agent memory', savedAt: 1, history: [] }));
			globalThis.sidebarQA = new CleanSlateAgentManagerSidebarView(root);
			sidebarQA.render({ groups: [{ key: 'project', label: 'musclememory', entry, sessions }], filter: '', activeSessionId: 'selected', selectedWorkspaceKey: 'project',
				getGroupEntry: () => entry, getWorkspaceEntryKey: () => 'project', isRunningSession: () => false,
				onSelectWorkspace() {}, onNewChatForWorkspace() {}, onRestoreSession() {}, onDeleteSession() {}, onShowProjectActions() {}, onPrefetchSessions() {} });
		}, width);
		const row = page.locator('[data-session-id="selected"]');
		const before = await row.boundingBox();
		for (const state of ['MERGED', 'OPEN', 'CLOSED', 'MERGED']) {
			await page.evaluate(state => sidebarQA.updatePullRequest('selected', state), state);
			const after = await row.boundingBox();
			expect(after.height).toBe(before.height);
			expect(after.height).toBeLessThanOrEqual(30);
			const title = await row.locator('.session-title').boundingBox();
			const badge = await row.locator('.session-pr-status').boundingBox();
			expect(title.width).toBeGreaterThan(width - 150);
			expect(badge.x).toBeGreaterThanOrEqual(title.x + title.width);
			expect(Math.abs(badge.y + badge.height / 2 - title.y - title.height / 2)).toBeLessThan(2);
			await expect(row.locator('.session-pr-status')).toHaveCount(1);
		}
		await page.screenshot({ path: testInfo.outputPath(`sidebar-fixed-${width}.png`), clip: { x: 0, y: 0, width, height: 180 } });
		await page.evaluate(() => sidebarQA.updateActiveState('selected', 'project', id => id === 'selected'));
		expect((await row.boundingBox()).height).toBe(before.height);
		await page.evaluate(() => { sidebarQA.updateActiveState('selected', 'project', () => false); sidebarQA.updatePullRequest('selected', 'UNKNOWN'); });
		await expect(row.locator('.session-pr-status')).toHaveCount(0);
		expect((await row.boundingBox()).height).toBe(before.height);
	});
}
