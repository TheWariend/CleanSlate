import { test as base, expect, _electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';

const browserFavicon = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#1ba89b"/><circle cx="16" cy="16" r="8" fill="white"/><!--${'x'.repeat(26_000)}--></svg>`;

const fork = fileURLToPath(new URL('../../../', import.meta.url));
const product = JSON.parse(await (await import('node:fs/promises')).readFile(join(fork, 'product.json'), 'utf8'));
const executablePath = process.env.CLEANSLATE_ELECTRON_PATH ?? join(fork, '.build/electron', process.platform === 'darwin'
	? `${product.nameLong}.app/Contents/MacOS/${product.nameShort}`
	: process.platform === 'win32' ? `${product.nameShort}.exe` : product.applicationName);

const test = base.extend({
	browserPins: [[], { option: true }],
	app: async ({ browserPins }, use, testInfo) => {
		const root = await mkdtemp(join(tmpdir(), 'cleanslate-qa-'));
		await mkdir(join(root, 'profile/User'), { recursive: true });
		await mkdir(join(root, 'workspace'));
		await writeFile(join(root, 'workspace/qa.txt'), 'Existing editor functionality must keep working.\n');
		await writeFile(join(root, 'profile/User/settings.json'), JSON.stringify({
			'workbench.startupEditor': 'none', 'workbench.colorTheme': 'Default Dark Modern',
			'update.mode': 'none', 'telemetry.telemetryLevel': 'off', 'security.workspace.trust.enabled': false,
		}));
		if (browserPins.length) {
			await mkdir(join(root, 'profile/User/globalStorage'), { recursive: true });
			const database = new DatabaseSync(join(root, 'profile/User/globalStorage/state.vscdb'));
			try {
				database.exec('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');
				database.prepare('INSERT INTO ItemTable VALUES (?, ?)').run('cleanSlate.browser.pinnedSites', JSON.stringify(browserPins));
				database.prepare('INSERT INTO ItemTable VALUES (?, ?)').run('__$__isNewStorageMarker', 'false');
				database.prepare('INSERT INTO ItemTable VALUES (?, ?)').run('__$__targetStorageMarker', JSON.stringify({ 'cleanSlate.browser.pinnedSites': 1 }));
			} finally { database.close(); }
		}
		const app = await _electron.launch({
			executablePath, args: [fork, join(root, 'workspace'), `--user-data-dir=${join(root, 'profile')}`, `--extensions-dir=${join(root, 'extensions')}`,
				'--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--no-sandbox'],
			env: { ...process.env, ELECTRON_RUN_AS_NODE: '', NODE_OPTIONS: '', VSCODE_DEV: '1', VSCODE_CLI: '1', NODE_ENV: 'development' },
			timeout: 60_000,
		});
		let logs = '';
		for (const stream of [app.process().stdout, app.process().stderr]) { stream?.on('data', chunk => { logs = (logs + chunk.toString()).slice(-1_000_000); }); }
		app.on('window', page => {
			page.on('pageerror', error => { logs += `\nRenderer error: ${error.stack}`; });
		});
		await app.context().tracing.start({ screenshots: true, snapshots: true });
		try { await use(app); }
		finally {
			for (const [index, window] of app.windows().entries()) {
				if (!window.isClosed()) { await testInfo.attach(`desktop-${index}`, { body: await window.screenshot(), contentType: 'image/png' }).catch(() => {}); }
			}
			const trace = testInfo.outputPath('trace.zip');
			try {
				await app.context().tracing.stop({ path: trace });
				await testInfo.attach('trace', { path: trace, contentType: 'application/zip' });
			} finally {
				await writeFile(testInfo.outputPath('app.log'), logs);
				await testInfo.attach('app-log', { path: testInfo.outputPath('app.log'), contentType: 'text/plain' });
				await app.close();
				await rm(root, { recursive: true, force: true });
			}
		}
	},
	page: async ({ app }, use) => {
		const page = await app.firstWindow();
		await expect(page.locator('.monaco-workbench')).toBeVisible({ timeout: 60_000 });
		await app.evaluate(({ BrowserWindow, app }) => {
			app.focus({ steal: true });
			BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('workbench'))?.focus();
		});
		await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.webContents.getURL().includes('workbench') && window.isFocused()))).toBe(true);
		await use(page);
	},
});

async function command(page, title) {
	await page.keyboard.press('F1');
	const input = page.locator('.quick-input-widget input');
	await expect(input).toBeVisible();
	await input.fill(`>${title}`);
	await expect(page.locator('.quick-input-list .monaco-list-row').first()).toContainText(title);
	await input.press('Enter');
	await expect(input).toBeHidden();
}

async function openManager(page) {
	const manager = page.locator('.cleanSlate-agent-manager-surface');
	if (!await manager.isVisible()) { await command(page, 'Open Agent Manager'); }
	await expect(manager).toBeVisible();
	await expect(manager.locator('textarea.cleanSlate-chat-input').first()).toBeVisible();
	return manager;
}

test('first launch, settings navigation and returning to the chat retain the composer', async ({ page }) => {
	const manager = await openManager(page);
	const input = manager.locator('textarea.cleanSlate-chat-input').first();
	await input.fill('Draft that must survive settings');
	await manager.getByRole('button', { name: 'Settings', exact: true }).click();
	for (const name of ['General', 'Models', 'API Keys', 'Verification', 'Indexing & Docs']) {
		await page.locator('.cleanSlate-settings-nav-item').filter({ hasText: name }).click();
		await expect(page.locator('.cleanSlate-settings-page-section-title')).toHaveText(name);
	}
	await page.locator('.cleanSlate-settings-back, .cleanSlate-settings-panel-close').first().click();
	await expect(input).toBeVisible();
	await expect(input).toHaveValue('Draft that must survive settings');
});

test('Agent Manager can return to the editor, open a file, and come back', async ({ page }, testInfo) => {
	const manager = await openManager(page);
	const sidebarColor = await manager.locator('.cleanSlate-agent-manager-nav').evaluate(element => getComputedStyle(element).backgroundColor);
	await page.locator('.cleanSlate-agent-manager-exit').click();
	await expect(manager).toBeHidden();
	await expect(page.locator('.part.sidebar')).toHaveCSS('background-color', sidebarColor);
	await page.getByRole('treeitem', { name: 'qa.txt', exact: true }).dblclick();
	await expect(page.locator('.monaco-editor').filter({ has: page.locator('.view-lines') }).first()).toBeVisible();
	await testInfo.attach('ide-shared-sidebar', { body: await page.screenshot(), contentType: 'image/png' });
	await openManager(page);
	await expect(manager.locator('.cleanSlate-agent-manager-new-chat')).toBeVisible();
});

test('thread tabs create independent drafts, support keyboard navigation and retain the workspace pane', async ({ page, app }) => {
	await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1440, 900); });
	const manager = await openManager(page);
	await expect(manager.locator('.cleanSlate-agent-manager-startup-loading')).toBeHidden();
	const tabs = manager.getByRole('tablist', { name: 'Threads', exact: true });
	const threads = tabs.getByRole('tab');
	const input = manager.locator('textarea.cleanSlate-chat-input').first();
	const sidebarThreads = manager.locator('button.cleanSlate-agent-manager-session');
	await expect(threads).toHaveCount(1);
	await expect(sidebarThreads).toHaveCount(0);
	await input.fill('First thread draft');
	await manager.getByRole('button', { name: 'New thread', exact: true }).click();
	await expect(threads).toHaveCount(2);
	await expect(input).toHaveValue('');
	await input.fill('Second thread draft');
	await expect(sidebarThreads).toHaveCount(0);
	await threads.first().click();
	await expect(input).toHaveValue('First thread draft');
	await threads.first().focus();
	await page.keyboard.press('ArrowRight');
	await expect(threads.last()).toHaveAttribute('aria-selected', 'true');
	await expect(threads.last()).toBeFocused();
	await expect(input).toHaveValue('Second thread draft');
	await manager.getByRole('button', { name: 'Toggle workspace pane', exact: true }).click();
	await expect(manager.locator('.cleanSlate-agent-manager-right-pane')).toBeVisible();
	await threads.first().click();
	await expect(manager.locator('.cleanSlate-agent-manager-right-pane')).toBeHidden();
	await threads.last().click();
	await expect(manager.locator('.cleanSlate-agent-manager-right-pane')).toBeVisible();
	await tabs.locator('.cleanSlate-agent-manager-thread-tab').first().hover();
	await tabs.locator('.cleanSlate-agent-manager-thread-close').first().click();
	await expect(threads).toHaveCount(1);
	await expect(sidebarThreads).toHaveCount(0);
	await expect(input).toHaveValue('Second thread draft');
	await tabs.locator('.cleanSlate-agent-manager-thread-close').click();
	await expect(threads).toHaveCount(1);
	await expect(input).toHaveValue('');
	await manager.getByRole('button', { name: 'Hide history', exact: true }).click();
	await expect(tabs).toBeVisible();
	await manager.getByRole('button', { name: 'New thread', exact: true }).click();
	await expect(threads).toHaveCount(2);
	await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(800, 720); });
	await expect(manager.getByRole('button', { name: 'New thread', exact: true })).toBeInViewport();
	await expect(threads.last()).toBeInViewport();
});

test('browser tabs navigate native pages and preserve the thread and other browser tabs', async ({ page, app }, testInfo) => {
	let releaseFavicon;
	const faviconReady = new Promise(resolve => { releaseFavicon = resolve; });
	const server = createServer((request, response) => {
		if (request.url === '/icons/page.svg') {
			void faviconReady.then(() => { response.writeHead(200, { 'Content-Type': 'image/svg+xml' }); response.end(browserFavicon); });
			return;
		}
		if (request.url === '/favicon.ico') { response.writeHead(404); response.end(); return; }
		const name = request.url === '/two' ? 'Second browser page' : 'First browser page';
		response.writeHead(200, { 'Content-Type': 'text/html' });
		response.end(`<title>${name}</title><link rel="icon" href="/icons/page.svg" type="image/svg+xml"><h1>${name}</h1><input id="draft"><a href="/two">Next page</a>`);
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const origin = `http://127.0.0.1:${server.address().port}`;
	const nativePages = () => app.evaluate(({ BrowserWindow, webContents }, origin) => {
		const views = BrowserWindow.getAllWindows().flatMap(window => window.contentView.children);
		return webContents.getAllWebContents().filter(contents => contents.getURL().startsWith(origin)).map(contents => {
			const view = views.find(view => view.webContents?.id === contents.id);
			return { id: contents.id, title: contents.getTitle(), url: contents.getURL(), visible: view?.getVisible(), bounds: view?.getBounds() };
		});
	}, origin);
	try {
		await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1440, 900); });
		const manager = await openManager(page);
		await expect(manager.locator('.cleanSlate-agent-manager-startup-loading')).toBeHidden();
		const sidebarColor = await manager.locator('.cleanSlate-agent-manager-nav').evaluate(element => getComputedStyle(element).backgroundColor);
		const input = manager.locator('textarea.cleanSlate-chat-input').first();
		await input.fill('Thread draft alongside browser tabs');
		const tabs = manager.getByRole('tablist', { name: 'Threads', exact: true });
		const browserTabs = manager.getByRole('tablist', { name: 'Browser tabs', exact: true });
		const nav = manager.locator('.cleanSlate-agent-manager-nav');
		const main = manager.locator('.cleanSlate-agent-manager-main');
		const layout = async () => ({ sidebar: (await nav.boundingBox()).width, canvas: await main.boundingBox(), firstTab: await tabs.getByRole('tab').first().boundingBox() });
		const threadLayout = await layout();
		await manager.getByRole('button', { name: 'New browser tab', exact: true }).click();
		const search = manager.getByRole('combobox', { name: 'Search the web or enter a URL', exact: true });
		const address = manager.getByRole('textbox', { name: 'Search or enter address', exact: true });
		await expect(search).toBeFocused();
		await expect.poll(layout).toEqual(threadLayout);
		for (const selector of ['.cleanSlate-agent-manager-exit', '.cleanSlate-agent-manager-pane-toggle', '[aria-label="Environment"]']) {
			await expect(manager.locator(selector)).toBeHidden();
		}
		const resize = manager.getByRole('separator', { name: 'Resize sidebar', exact: true });
		await resize.focus();
		await resize.press('ArrowRight');
		const sharedWidth = threadLayout.sidebar + 16;
		await expect.poll(async () => (await nav.boundingBox()).width).toBe(sharedWidth);
		await tabs.getByRole('tab', { name: 'New thread', exact: true }).click();
		await expect.poll(async () => (await nav.boundingBox()).width).toBe(sharedWidth);
		await expect(manager.locator('.cleanSlate-agent-manager-exit')).toBeVisible();
		await expect(manager.getByRole('button', { name: 'Environment', exact: true })).toBeVisible();
		await manager.getByRole('button', { name: 'Toggle workspace pane', exact: true }).click();
		await expect(manager.locator('.cleanSlate-agent-manager-right-pane')).toBeVisible();
		await tabs.getByRole('tab', { name: 'Browser', exact: true }).click();
		await expect(manager.locator('.cleanSlate-agent-manager-right-pane')).toBeHidden();
		await expect.poll(async () => (await nav.boundingBox()).width).toBe(sharedWidth);
		await tabs.getByRole('tab', { name: 'New thread', exact: true }).click();
		await expect(manager.locator('.cleanSlate-agent-manager-right-pane')).toBeVisible();
		await manager.getByRole('button', { name: 'Toggle workspace pane', exact: true }).click();
		await tabs.getByRole('tab', { name: 'Browser', exact: true }).click();
		await expect(manager.locator('.cleanSlate-agent-manager-nav')).toHaveCSS('background-color', sidebarColor);
		await testInfo.attach('browser-start-page', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
		const cardBounds = await manager.locator('.cleanSlate-browser-start-search').boundingBox();
		await testInfo.attach('browser-home-detail', {
			body: await page.screenshot({ animations: 'disabled', clip: { x: cardBounds.x - 40, y: cardBounds.y - 40, width: cardBounds.width + 80, height: cardBounds.height + 80 } }),
			contentType: 'image/png'
		});
		await search.fill(`${origin.replace('http://', '')}/one`);
		await search.press('Enter');
		await expect(browserTabs.getByRole('tab', { name: 'First browser page', exact: true })).toBeVisible();
		await expect.poll(async () => (await nativePages()).some(view => view.visible && view.bounds.width > 900)).toBe(true);
		await manager.getByRole('button', { name: 'Pin current page', exact: true }).click();
		const pinnedPage = manager.getByRole('button', { name: 'Open pinned site: First browser page', exact: true });
		await expect(pinnedPage).toBeVisible();
		await expect(pinnedPage.locator('img')).toHaveCount(0);
		releaseFavicon();
		await expect(pinnedPage.locator('img')).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/);
		await expect.poll(() => pinnedPage.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
		await expect(browserTabs.getByRole('tab', { name: 'First browser page', exact: true }).locator('img')).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/);
		const profile = await app.evaluate(({ app }) => app.getPath('userData'));
		await expect.poll(() => {
			const database = new DatabaseSync(join(profile, 'User/globalStorage/state.vscdb'), { readOnly: true });
			try {
				const row = database.prepare('SELECT value FROM ItemTable WHERE key = ?').get('cleanSlate.browser.pinnedSites');
				return row && JSON.parse(String(row.value))[0]?.favicon;
			} finally { database.close(); }
		}).toBe(`data:image/svg+xml;base64,${Buffer.from(browserFavicon).toString('base64')}`);
		await testInfo.attach('browser-page', { body: await page.screenshot(), contentType: 'image/png' });
		await address.fill(`${origin}/two`);
		await address.press('Enter');
		await expect(browserTabs.getByRole('tab', { name: 'Second browser page', exact: true })).toBeVisible();
		await manager.getByRole('button', { name: 'Go back', exact: true }).click();
		await expect(browserTabs.getByRole('tab', { name: 'First browser page', exact: true })).toBeVisible();
		await manager.getByRole('button', { name: 'Go forward', exact: true }).click();
		await expect(browserTabs.getByRole('tab', { name: 'Second browser page', exact: true })).toBeVisible();
		await manager.getByRole('button', { name: 'Reload page', exact: true }).click();
		await expect.poll(async () => (await nativePages()).find(view => view.visible)?.title).toBe('Second browser page');
		await manager.getByRole('button', { name: 'New browser tab', exact: true }).click();
		await expect(search).toHaveValue('');
		await search.fill(`${origin}/one`);
		await search.press('Enter');
		await expect(browserTabs.getByRole('tab')).toHaveCount(2);
		await expect(browserTabs.getByRole('tab', { name: 'First browser page', exact: true })).toHaveAttribute('aria-selected', 'true');
		const tabSearch = manager.getByRole('textbox', { name: 'Search tabs', exact: true });
		await tabSearch.fill('Second browser');
		await expect(browserTabs.getByRole('tab')).toHaveCount(1);
		await expect(browserTabs.getByRole('tab', { name: 'Second browser page', exact: true })).toBeVisible();
		await tabSearch.fill('not-a-real-tab');
		await expect(browserTabs).toContainText('No matching tabs');
		await tabSearch.press('Escape');
		await expect(browserTabs.getByRole('tab')).toHaveCount(2);
		await browserTabs.getByRole('tab', { name: 'Second browser page', exact: true }).click();
		await expect.poll(async () => (await nativePages()).filter(view => view.visible).map(view => view.title)).toEqual(['Second browser page']);
		await manager.getByRole('button', { name: 'Settings', exact: true }).click();
		await expect.poll(async () => (await nativePages()).some(view => view.visible)).toBe(false);
		await page.getByRole('button', { name: 'Back to app', exact: true }).click();
		await expect.poll(async () => (await nativePages()).some(view => view.visible)).toBe(true);
		await tabs.getByRole('tab', { name: 'New thread', exact: true }).click();
		await expect(input).toHaveValue('Thread draft alongside browser tabs');
		await expect.poll(async () => (await nativePages()).some(view => view.visible)).toBe(false);
		await tabs.getByRole('tab', { name: 'Browser', exact: true }).click();
		await browserTabs.getByRole('button', { name: 'Close Second browser page', exact: true }).click();
		await expect(tabs.getByRole('tab')).toHaveCount(2);
		await expect.poll(async () => (await nativePages()).length).toBe(1);
		await expect(browserTabs.getByRole('tab', { name: 'First browser page', exact: true })).toHaveAttribute('aria-selected', 'true');
		await manager.getByRole('button', { name: 'New browser tab', exact: true }).click();
		await expect(search).toBeFocused();
		await expect(manager.getByRole('option').filter({ hasText: 'First browser page' }).locator('img')).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/);
		await testInfo.attach('browser-home-with-sites', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
		await search.fill('First browser');
		await expect(manager.getByRole('option').filter({ hasText: 'First browser page' })).toBeVisible();
		await search.press('ArrowDown');
		await search.press('Enter');
		await expect(browserTabs.getByRole('tab', { name: 'First browser page', exact: true })).toHaveAttribute('aria-selected', 'true');
		await expect(browserTabs.getByRole('tab')).toHaveCount(2);
		await manager.getByRole('button', { name: 'Open pinned site: First browser page', exact: true }).click();
		await expect(browserTabs.getByRole('tab')).toHaveCount(2);
		await manager.getByRole('button', { name: 'Open pinned site: First browser page', exact: true }).hover();
		await manager.getByRole('button', { name: 'Unpin First browser page', exact: true }).click();
		await expect(manager.getByRole('button', { name: 'Open pinned site: First browser page', exact: true })).toHaveCount(0);
		await manager.getByRole('button', { name: 'New thread', exact: true }).click();
		await expect(input).toBeVisible();
		await expect(input).toHaveValue('');
		await expect.poll(async () => (await nativePages()).some(view => view.visible)).toBe(false);
	} finally {
		releaseFavicon();
		server.closeAllConnections();
		await new Promise(resolve => server.close(resolve));
	}
});

test.describe('saved browser favicons', () => {
	test.use({ browserPins: [[
		{ url: 'https://icons.example.test/docs', title: 'Saved documentation' },
		{ url: 'https://offline.example.test/', title: 'Offline bookmark' },
		{ url: 'https://saved.example.test/', title: 'Cached bookmark', favicon: `data:image/svg+xml;base64,${Buffer.from(browserFavicon).toString('base64')}` },
	], { scope: 'test' }] });

	test('older pins recover site icons and cached icons work without a network request', async ({ page, app }, testInfo) => {
		const profile = await app.evaluate(({ app }) => app.getPath('userData'));
		const database = new DatabaseSync(join(profile, 'User/globalStorage/state.vscdb'), { readOnly: true });
		try {
			const row = database.prepare('SELECT value FROM ItemTable WHERE key = ?').get('cleanSlate.browser.pinnedSites');
			expect(row && JSON.parse(String(row.value)).length).toBe(3);
		} finally { database.close(); }
		await app.evaluate(({ BrowserWindow }, icon) => {
			globalThis.faviconRequests = [];
			const session = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('workbench')).webContents.session;
			session.protocol.handle('https', request => {
				globalThis.faviconRequests.push({ url: request.url, referrer: request.referrer });
				return request.url === 'https://icons.example.test/favicon.ico'
					? new Response(icon, { headers: { 'Content-Type': 'image/svg+xml' } }) : Response.error();
			});
		}, browserFavicon);
		await page.reload();
		await expect(page.locator('.monaco-workbench')).toBeVisible();
		const manager = await openManager(page);
		await manager.getByRole('button', { name: 'New browser tab', exact: true }).click();
		for (const title of ['Saved documentation', 'Cached bookmark']) {
			const pin = manager.getByRole('button', { name: `Open pinned site: ${title}`, exact: true });
			const suggestion = manager.getByRole('option').filter({ hasText: title });
			for (const site of [pin, suggestion]) {
				await expect.poll(() => site.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
			}
		}
		const recovered = manager.getByRole('button', { name: 'Open pinned site: Saved documentation', exact: true }).locator('img');
		await expect(recovered).toHaveAttribute('src', 'https://icons.example.test/favicon.ico');
		const offline = manager.getByRole('button', { name: 'Open pinned site: Offline bookmark', exact: true });
		await expect(offline.locator('img')).toHaveCount(0);
		await expect(offline.locator('.cleanSlate-browser-site-icon')).toHaveText('O');
		const requests = await app.evaluate(() => globalThis.faviconRequests);
		expect(requests.some(request => request.url.includes('saved.example.test'))).toBe(false);
		expect(requests.every(request => !request.referrer)).toBe(true);
		await testInfo.attach('browser-favicons', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
	});
});

test('browser home shows real search controls, keyboard shortcuts and a narrow light layout', async ({ page, app }, testInfo) => {
	const manager = await openManager(page);
	await expect(manager.locator('.cleanSlate-agent-manager-startup-loading')).toBeHidden();
	await manager.getByRole('button', { name: 'New browser tab', exact: true }).click();
	await expect(manager.locator('.cleanSlate-browser-start-results')).toBeHidden();
	await expect(manager.locator('.cleanSlate-browser-start').getByRole('button')).toHaveCount(1);
	await expect(manager.locator('.cleanSlate-browser-start select')).toHaveCount(0);
	expect((await manager.locator('.cleanSlate-browser-start-search').boundingBox()).height).toBeLessThan(160);
	const search = manager.getByRole('combobox', { name: 'Search the web or enter a URL', exact: true });
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+l' : 'Control+l');
	await expect(search).toBeFocused();
	await search.press(process.platform === 'darwin' ? 'Meta+Shift+p' : 'Control+Shift+p');
	let picker = page.locator('.quick-input-widget input');
	await expect(picker).toBeVisible();
	await picker.fill('>Preferences: Color Theme');
	await page.getByRole('option', { name: /^Preferences: Color Theme,/ }).click();
	await expect(page.locator('.quick-input-list')).toContainText('Light Modern');
	picker = page.locator('.quick-input-widget input');
	await picker.fill('Light Modern');
	await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Light Modern' }).first().click();
	await expect(picker).toBeHidden();
	await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(900, 720); });
	await expect(search).toBeVisible();
	await expect(search).toBeInViewport();
	await expect(manager.getByRole('button', { name: 'New browser tab', exact: true })).toBeInViewport();
	await expect(manager.getByRole('textbox', { name: 'Search tabs', exact: true })).toBeInViewport();
	await testInfo.attach('browser-light-narrow', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
});

test('search, empty results, window resize and navigation toggles keep core controls reachable', async ({ page, app }) => {
	const manager = await openManager(page);
	const search = manager.getByPlaceholder('Search', { exact: true });
	await search.fill('no-such-chat-qa');
	await expect(manager).toContainText('No chats match');
	await search.fill('');
	await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1000, 720); });
	await expect(manager.locator('textarea.cleanSlate-chat-input').first()).toBeVisible();
	await manager.getByRole('button', { name: 'Toggle workspace pane', exact: true }).click();
	await manager.getByRole('button', { name: 'Toggle workspace pane', exact: true }).click();
	await expect(manager.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
	await expect(page.locator('.cleanSlate-agent-manager-exit')).toBeVisible();
});

test('provider setup, streaming, cancellation and provider error recovery work together', async ({ page }) => {
	let hold = false;
	let reject = false;
	let requests = 0;
	const server = createServer(async (request, response) => {
		for await (const _chunk of request) { /* Drain the request body. */ }
		if (!request.url.endsWith('/chat/completions')) {
			response.writeHead(200, { 'Content-Type': 'application/json' });
			response.end(JSON.stringify({ data: [{ id: 'qa-canary', object: 'model' }] }));
			return;
		}
		requests++;
		if (reject) {
			response.writeHead(401, { 'Content-Type': 'application/json' });
			response.end(JSON.stringify({ error: { message: 'QA authentication rejected.' } }));
			return;
		}
		response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
		const chunk = (content, finish_reason = null) => `data: ${JSON.stringify({ id: 'qa-turn', object: 'chat.completion.chunk', model: 'qa-canary', choices: [{ index: 0, delta: { content }, finish_reason }] })}\n\n`;
		response.write(chunk(hold ? 'QA cancellable turn.' : 'QA canary response.'));
		if (!hold) { response.end(chunk('', 'stop') + 'data: [DONE]\n\n'); }
	});
	await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
	try {
		const manager = await openManager(page);
		await manager.getByRole('button', { name: 'Settings', exact: true }).click();
		await page.locator('.cleanSlate-settings-nav-item[data-section="models"]').click();
		await page.locator('.cleanSlate-settings-row').filter({ hasText: /^Provider/ }).locator('.cleanSlate-select').click();
		await page.locator('.cleanSlate-select-option').filter({ hasText: 'Custom API' }).click();
		const rows = page.locator('.cleanSlate-settings-row');
		await rows.filter({ hasText: /^Model/ }).locator('input').fill('qa-canary');
		await rows.filter({ hasText: /^Model/ }).locator('input').blur();
		await rows.filter({ hasText: 'Base URL' }).locator('input').fill(`http://127.0.0.1:${server.address().port}/v1`);
		await rows.filter({ hasText: 'Base URL' }).locator('input').blur();
		await page.locator('.cleanSlate-settings-nav-item[data-section="apiKeys"]').click();
		await page.getByPlaceholder('Optional API key', { exact: true }).fill('qa-fake-key');
		await page.getByPlaceholder('Optional API key', { exact: true }).blur();
		await page.getByRole('button', { name: 'Back to app', exact: true }).click();
		const input = manager.locator('textarea.cleanSlate-chat-input').first();
		const sidebarThreads = manager.locator('button.cleanSlate-agent-manager-session');
		await expect(sidebarThreads).toHaveCount(0);
		await input.fill('Say exactly QA canary response without tools.');
		await manager.getByRole('button', { name: 'Send message', exact: true }).click();
		await expect(manager.locator('.cleanSlate-chat-messages')).toContainText('QA canary response.', { timeout: 20_000 });
		await expect(sidebarThreads).toHaveCount(1);
		await expect(sidebarThreads.first()).toContainText('Say exactly QA canary response');
		await expect(manager.getByRole('button', { name: 'Send message', exact: true })).toBeVisible({ timeout: 20_000 });
		expect(requests).toBeGreaterThan(0);
		hold = true;
		await input.fill('Start another response.');
		await manager.getByRole('button', { name: 'Send message', exact: true }).click();
		await expect(manager.locator('.cleanSlate-chat-messages')).toContainText('QA cancellable turn.', { timeout: 20_000 });
		await manager.getByRole('button', { name: 'Stop generation', exact: true }).click();
		await expect(manager.getByRole('button', { name: 'Send message', exact: true })).toBeVisible();
		hold = false;
		const before = requests;
		await input.fill('Reply again after cancellation.');
		await manager.getByRole('button', { name: 'Send message', exact: true }).click();
		await expect.poll(() => requests).toBeGreaterThan(before);
		await expect(manager.getByRole('button', { name: 'Send message', exact: true })).toBeVisible({ timeout: 20_000 });
		reject = true;
		await input.fill('Exercise a provider failure.');
		await manager.getByRole('button', { name: 'Send message', exact: true }).click();
		await expect(manager.locator('.cleanSlate-chat-messages')).toContainText('QA authentication rejected.', { timeout: 20_000 });
		await expect(manager.getByRole('button', { name: 'Send message', exact: true })).toBeVisible();
		reject = false;
		const failedRequests = requests;
		await input.fill('Retry after provider recovery.');
		await manager.getByRole('button', { name: 'Send message', exact: true }).click();
		await expect.poll(() => requests).toBeGreaterThan(failedRequests);
		await expect(manager.getByRole('button', { name: 'Send message', exact: true })).toBeVisible({ timeout: 20_000 });
	} finally {
		server.closeAllConnections();
		await new Promise(resolve => server.close(resolve));
	}
});
