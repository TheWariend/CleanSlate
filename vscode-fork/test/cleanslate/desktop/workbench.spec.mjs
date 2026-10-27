import { test as base, expect, _electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';

const browserFavicon = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#1ba89b"/><circle cx="16" cy="16" r="8" fill="white"/><!--${'x'.repeat(26_000)}--></svg>`;

function browserSessionFixture(url) {
	const ints = (...values) => { const buffer = Buffer.alloc(values.length * 4); values.forEach((value, index) => buffer.writeInt32LE(value, index * 4)); return buffer; };
	const string = (value, utf16 = false) => { const data = Buffer.from(value, utf16 ? 'utf16le' : 'utf8'); const padded = Buffer.alloc((data.length + 3) & ~3); data.copy(padded); return Buffer.concat([ints(utf16 ? value.length : data.length), padded]); };
	const command = (id, payload) => { const prefix = Buffer.alloc(3); prefix.writeUInt16LE(payload.length + 1); prefix[2] = id; return Buffer.concat([prefix, payload]); };
	const navigation = Buffer.concat([ints(10, 0), string(url), string('Imported session', true), string(''), ints(0)]);
	return Buffer.concat([Buffer.from('SNSS'), ints(3), command(0, ints(1, 10)), command(6, Buffer.concat([ints(navigation.length), navigation])), command(7, ints(10, 0))]);
}

const fork = fileURLToPath(new URL('../../../', import.meta.url));
const product = JSON.parse(await (await import('node:fs/promises')).readFile(join(fork, 'product.json'), 'utf8'));
const executablePath = process.env.CLEANSLATE_ELECTRON_PATH ?? join(fork, '.build/electron', process.platform === 'darwin'
	? `${product.nameLong}.app/Contents/MacOS/${product.nameShort}`
	: process.platform === 'win32' ? `${product.nameShort}.exe` : product.applicationName);

const test = base.extend({
	browserPins: [[], { option: true }],
	browserHistory: [[], { option: true }],
	browserBookmarks: [[], { option: true }],
	browserSetup: [false, { option: true }],
	openBrowserAtStartup: [false, { option: true }],
	app: async ({ browserPins, browserHistory, browserBookmarks, browserSetup, openBrowserAtStartup }, use, testInfo) => {
		const root = await mkdtemp(join(tmpdir(), 'cleanslate-qa-'));
		const importHome = join(root, 'browser-home');
		const importServer = browserSetup ? createServer((request, response) => {
			if (request.url === '/favicon.ico') { response.writeHead(200, { 'Content-Type': 'image/svg+xml' }); response.end(browserFavicon); return; }
			response.writeHead(200, { 'Content-Type': 'text/html' });
			response.end('<title>Imported guide</title><h1>Imported bookmark page</h1>');
		}) : undefined;
		if (importServer) { await new Promise(resolve => importServer.listen(0, '127.0.0.1', resolve)); }
		const importOrigin = importServer ? `http://127.0.0.1:${importServer.address().port}` : '';
		const bookmarkHTML = join(root, 'bookmarks.html');
		if (browserSetup) {
			await mkdir(importHome, { recursive: true });
		}
		const customProfile = join(root, 'custom-profile');
		await mkdir(customProfile);
		await writeFile(join(customProfile, 'Bookmarks'), JSON.stringify({ roots: { other: { type: 'folder', name: 'Custom folder', children: [{ type: 'url', name: 'Custom page', url: 'https://custom.example.test/' }] } } }));
		if (browserSetup && browserSetup !== 'empty') {
			for (const parts of [['Library', 'Application Support', 'Example Navigator', 'User Data'], ['.config', 'Example Navigator', 'User Data'], ['AppData', 'Local', 'Example Navigator', 'User Data']]) {
				const profile = join(importHome, ...parts);
				await mkdir(join(profile, 'Default', 'Sessions'), { recursive: true });
				await writeFile(join(profile, 'Default', 'Preferences'), '{}');
				await writeFile(join(profile, 'Default', 'Sessions', 'Session_100'), browserSessionFixture(`${importOrigin}/session`));
				const history = new DatabaseSync(join(profile, 'Default', 'History'));
				history.exec("CREATE TABLE urls (url TEXT, title TEXT, last_visit_time INTEGER, visit_count INTEGER)");
				history.prepare('INSERT INTO urls VALUES (?, ?, ?, ?)').run(`${importOrigin}/visited`, 'Previously visited page', 13300000000000000, 3);
				history.close();
				await writeFile(join(profile, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Research profile' } } } }));
				await writeFile(join(profile, 'Default/Bookmarks'), JSON.stringify({ roots: { bookmark_bar: { type: 'folder', name: 'Work', children: [
					{ type: 'url', name: 'Imported guide', url: `${importOrigin}/guide` }, { type: 'url', name: 'Unsupported', url: 'javascript:alert(1)' }
				] } } }));
				if (browserSetup === 'mixed') {
					await mkdir(join(profile, 'Personal', 'Sessions'), { recursive: true });
					await writeFile(join(profile, 'Personal', 'Preferences'), '{}');
				}
			}
			if (process.platform === 'darwin') {
				const bundle = join(importHome, 'Applications', 'Example Navigator.app', 'Contents');
				await mkdir(join(bundle, 'Resources'), { recursive: true });
				await writeFile(join(bundle, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleName</key><string>Example Navigator</string><key>CFBundleIdentifier</key><string>org.example.navigator</string><key>CFBundleIconFile</key><string>Brand.png</string><key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array><string>http</string><string>https</string></array></dict></array></dict></plist>`);
				await writeFile(join(bundle, 'Resources', 'Brand.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5S8AAAAASUVORK5CYII=', 'base64'));
			}
			await writeFile(bookmarkHTML, `<DL><DT><H3>References</H3><DL><DT><A HREF="${importOrigin}/guide">Imported guide</A><DT><A HREF="${importOrigin}/reference">Imported reference</A></DL></DL>`);
		}
		await mkdir(join(root, 'profile/User'), { recursive: true });
		await mkdir(join(root, 'workspace'));
		await writeFile(join(root, 'workspace/qa.txt'), 'Existing editor functionality must keep working.\n');
		await writeFile(join(root, 'profile/User/settings.json'), JSON.stringify({
			'workbench.startupEditor': 'none', 'workbench.colorTheme': 'Default Dark Modern',
			'update.mode': 'none', 'telemetry.telemetryLevel': 'off', 'security.workspace.trust.enabled': false,
		}));
		if (browserPins.length || browserHistory.length || browserBookmarks.length) {
			await mkdir(join(root, 'profile/User/globalStorage'), { recursive: true });
			const database = new DatabaseSync(join(root, 'profile/User/globalStorage/state.vscdb'));
			try {
				database.exec('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');
				database.prepare('INSERT INTO ItemTable VALUES (?, ?)').run('cleanSlate.browser.pinnedSites', JSON.stringify(browserPins));
				database.prepare('INSERT INTO ItemTable VALUES (?, ?)').run('cleanSlate.browser.history', JSON.stringify(browserHistory));
				database.prepare('INSERT INTO ItemTable VALUES (?, ?)').run('cleanSlate.browser.bookmarks', JSON.stringify(browserBookmarks));
				database.prepare('INSERT INTO ItemTable VALUES (?, ?)').run('__$__isNewStorageMarker', 'false');
				database.prepare('INSERT INTO ItemTable VALUES (?, ?)').run('__$__targetStorageMarker', JSON.stringify({ 'cleanSlate.browser.pinnedSites': 1, 'cleanSlate.browser.history': 1, 'cleanSlate.browser.bookmarks': 1 }));
			} finally { database.close(); }
		}
		const app = await _electron.launch({
			executablePath, args: [fork, join(root, 'workspace'), `--user-data-dir=${join(root, 'profile')}`, `--extensions-dir=${join(root, 'extensions')}`,
				'--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--no-sandbox',
				...(openBrowserAtStartup ? ['--open-url', '--', `${importOrigin}/startup?windowId=_blank&continueOn=keep`] : [])],
			env: { ...process.env, ...(browserSetup ? { XDG_CONFIG_HOME: join(importHome, '.config'), LOCALAPPDATA: join(importHome, 'AppData/Local'), APPDATA: join(importHome, 'AppData/Roaming') } : {}), ELECTRON_RUN_AS_NODE: '', NODE_OPTIONS: '', VSCODE_DEV: '1', VSCODE_CLI: '1', NODE_ENV: 'development' },
			timeout: 60_000,
		});
		if (browserSetup) {
			await app.evaluate(({ app, dialog }, setup) => {
				app.setPath('home', setup.home);
				globalThis.browserImportFixtureOrigin = setup.origin;
				globalThis.cancelBrowserImport = false;
				dialog.showOpenDialog = async (...args) => ({ canceled: globalThis.cancelBrowserImport, filePaths: globalThis.cancelBrowserImport ? [] : [args.at(-1).properties?.includes('openDirectory') ? setup.folder : setup.file] });
				if (process.platform === 'darwin') {
					globalThis.defaultBrowserSchemes = [];
					app.isDefaultProtocolClient = scheme => globalThis.defaultBrowserSchemes.includes(scheme);
					app.setAsDefaultProtocolClient = scheme => { globalThis.defaultBrowserSchemes.push(scheme); return true; };
				}
			}, { home: importHome, origin: importOrigin, file: bookmarkHTML, folder: customProfile });
		}
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
				if (importServer) { importServer.closeAllConnections(); await new Promise(resolve => importServer.close(resolve)); }
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

test('macOS sidebar exposes native material through theme changes and keeps the canvas opaque', async ({ page, app }) => {
	test.skip(process.platform !== 'darwin', 'Native sidebar material is macOS-specific.');
	const manager = await openManager(page);
	await expect(manager.locator('.cleanSlate-agent-manager-startup-loading')).toBeHidden();
	const nativeBackground = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
		.find(window => window.webContents.getURL().includes('workbench'))?.getBackgroundColor());
	const layerAlphas = () => page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = 1;
		const context = canvas.getContext('2d');
		return Object.fromEntries(Object.entries({
			body: 'body', workbench: '.monaco-workbench', surface: '.cleanSlate-agent-manager-surface',
			sidebar: '.cleanSlate-agent-manager-nav', canvas: '.cleanSlate-agent-manager-main',
		}).map(([name, selector]) => {
			context.clearRect(0, 0, 1, 1);
			context.fillStyle = getComputedStyle(document.querySelector(selector)).backgroundColor;
			context.fillRect(0, 0, 1, 1);
			return [name, context.getImageData(0, 0, 1, 1).data[3]];
		}));
	});
	const expectNativeSidebar = async () => {
		// Electron omits alpha here; renderer layers below verify their transparency.
		await expect.poll(nativeBackground).toBe('#000000');
		await expect.poll(layerAlphas).toEqual({ body: 0, workbench: 0, surface: 0, sidebar: 51, canvas: 255 });
	};
	await expectNativeSidebar();
	const settingsPath = join(await app.evaluate(({ app }) => app.getPath('userData')), 'User/settings.json');
	const settings = JSON.parse(await (await import('node:fs/promises')).readFile(settingsPath, 'utf8'));
	await writeFile(settingsPath, JSON.stringify({ ...settings, 'workbench.colorTheme': 'Default Light Modern' }));
	await expect(page.locator('.monaco-workbench')).toHaveClass(/(?:^|\s)vs(?:\s|$)/);
	await expectNativeSidebar();
	await page.reload();
	await openManager(page);
	await expect(manager.locator('.cleanSlate-agent-manager-startup-loading')).toBeHidden();
	await expectNativeSidebar();
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
		const tabSearch = manager.getByRole('textbox', { name: 'Search tabs and bookmarks', exact: true });
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
	await expect(manager.getByRole('textbox', { name: 'Search tabs and bookmarks', exact: true })).toBeInViewport();
	await testInfo.attach('browser-light-narrow', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
});

test.describe('browser integration', () => {
	test.use({ browserSetup: true });

	test('migrates a dynamically discovered browser, restores tabs and history, and deduplicates imports', async ({ page, app }, testInfo) => {
		const manager = await openManager(page);
		await manager.getByRole('button', { name: 'New browser tab', exact: true }).click();
		await manager.getByRole('button', { name: 'Import browser data…', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Import browser data', exact: true });
		await expect(dialog.getByRole('button', { name: /Example Navigator/ })).toBeVisible();
		if (process.platform === 'darwin') { await expect.poll(() => dialog.getByRole('button', { name: /Example Navigator/ }).locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true); }
		await testInfo.attach('import-browser-picker', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
		await dialog.getByRole('button', { name: /Example Navigator/ }).click();
		await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
		await expect(dialog.getByRole('checkbox', { name: 'Research profile', exact: true })).toBeChecked();
		await expect(dialog.getByRole('checkbox', { name: /^Open tabs/ })).toBeChecked();
		await expect(dialog.getByRole('checkbox', { name: /^Browsing history/ })).toBeChecked();
		await expect(dialog.getByRole('checkbox', { name: /password|extension/i })).toHaveCount(0);
		await dialog.getByRole('checkbox', { name: 'Research profile', exact: true }).uncheck();
		await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
		await dialog.getByRole('checkbox', { name: 'Research profile', exact: true }).check();
		await testInfo.attach('import-data-selection', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
		await dialog.getByRole('button', { name: 'Import', exact: true }).click();
		await expect(dialog.getByRole('heading', { name: 'Your data is ready', exact: true })).toBeVisible();
		await expect(dialog.locator('.cs-import-result')).toHaveCount(3);
		for (const row of await dialog.locator('.cs-import-result').all()) { await expect(row).toContainText('1 imported'); }
		await testInfo.attach('import-complete', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
		await dialog.getByRole('button', { name: 'Import another', exact: true }).click();
		await dialog.getByRole('button', { name: /Example Navigator/ }).click();
		await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
		await dialog.getByRole('button', { name: 'Import', exact: true }).click();
		await expect(dialog).toContainText('3 duplicates and 1 unsupported links skipped.');
		await dialog.getByRole('button', { name: 'Import another', exact: true }).click();
		await dialog.getByRole('button', { name: 'From a bookmarks HTML file…', exact: true }).click();
		await expect(dialog).toContainText('1 imported');
		await expect(dialog).toContainText('1 duplicates and 0 unsupported links skipped.');
		await dialog.getByRole('button', { name: 'Import another', exact: true }).click();
		await app.evaluate(() => { globalThis.cancelBrowserImport = true; });
		await dialog.getByRole('button', { name: 'From a bookmarks HTML file…', exact: true }).click();
		await expect(dialog.getByRole('heading', { name: 'Your browser. Right at home.' })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(dialog).toHaveCount(0);
		await expect(manager.getByRole('tab', { name: 'Imported session', exact: true })).toBeVisible();
		await manager.getByRole('tab', { name: 'Imported session', exact: true }).click();
		const origin = await app.evaluate(() => globalThis.browserImportFixtureOrigin);
		await expect(manager.getByRole('textbox', { name: 'Search or enter address', exact: true })).toHaveValue(`${origin}/session`);
		await expect(manager.getByRole('tab', { name: 'Imported guide', exact: true })).toBeVisible();
		await manager.getByRole('button', { name: 'New browser tab', exact: true }).click();
		const search = manager.getByRole('combobox', { name: 'Search the web or enter a URL', exact: true });
		await search.fill('Previously visited');
		await expect(manager.getByRole('option').filter({ hasText: 'Previously visited page' })).toContainText('History');
		await page.reload();
		await expect(manager.locator('textarea.cleanSlate-chat-input').first()).toBeVisible();
		await manager.getByRole('button', { name: 'New browser tab', exact: true }).click();
		await expect(manager.locator('.cleanSlate-browser-bookmarks summary').first()).toContainText('Bookmarks (2)');
		await expect(manager.getByRole('tab', { name: 'Imported guide', exact: true })).toBeVisible();
		await manager.getByRole('button', { name: 'Close Imported guide', exact: true }).click();
		await expect(manager.getByRole('tab', { name: 'Imported guide', exact: true })).toHaveCount(0);
		await command(page, 'Developer: Reload Window');
		await expect(manager.locator('textarea.cleanSlate-chat-input').first()).toBeVisible();
		await manager.getByRole('button', { name: 'New browser tab', exact: true }).click();
		await expect(manager.getByRole('tab', { name: 'Imported guide', exact: true })).toHaveCount(0);
	});

	test('requests default-browser registration and verifies both web schemes', async ({ page, app }) => {
		test.skip(process.platform !== 'darwin', 'macOS protocol registration flow');
		const manager = await openManager(page);
		await manager.getByRole('button', { name: 'New browser tab', exact: true }).click();
		await manager.getByRole('button', { name: 'Import browser data…', exact: true }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
		await manager.getByRole('button', { name: 'Settings', exact: true }).click();
		await page.locator('.cleanSlate-settings-nav-item[data-section=browser]').click();
		const settings = page.locator('.cleanSlate-browser-settings');
		await expect(settings).toContainText('CleanSlate is not your default browser.');
		await settings.getByRole('button', { name: 'Make default browser', exact: true }).click();
		await expect(settings).toContainText('CleanSlate is your default browser.');
		expect(await app.evaluate(() => globalThis.defaultBrowserSchemes)).toEqual(['http', 'https']);
		await expect(settings.getByRole('button', { name: 'Make default browser', exact: true })).toBeDisabled();
	});

	test('opens external web links in browser tabs without treating web query parameters as app commands', async ({ page, app }) => {
		const manager = await openManager(page);
		const origin = await app.evaluate(() => globalThis.browserImportFixtureOrigin);
		const url = `${origin}/external?windowId=_blank&continueOn=keep#reference`;
		await app.evaluate(({ app }, url) => { app.emit('open-url', { preventDefault() {} }, url); }, url);
		await expect(manager.getByRole('textbox', { name: 'Search or enter address', exact: true })).toHaveValue(url);
		await expect(manager.getByRole('tablist', { name: 'Browser tabs', exact: true }).getByRole('tab', { name: 'Imported guide', exact: true })).toBeVisible();
		expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.webContents.getURL().includes('workbench')).length)).toBe(1);
	});
});

test.describe('browser cold startup', () => {
	test.use({ browserSetup: true, openBrowserAtStartup: true });
	test('opens an operating-system web link when launching the application', async ({ page, app }) => {
		const manager = page.locator('.cleanSlate-agent-manager-surface');
		const origin = await app.evaluate(() => globalThis.browserImportFixtureOrigin);
		await expect(manager.getByRole('textbox', { name: 'Search or enter address', exact: true })).toHaveValue(`${origin}/startup?windowId=_blank&continueOn=keep`);
		await expect(manager.getByRole('tablist', { name: 'Browser tabs', exact: true }).getByRole('tab', { name: 'Imported guide', exact: true })).toBeVisible();
	});
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


test.describe('browser import discovery', () => {
	test.use({ browserSetup: 'empty' });
	test('offers a working custom profile picker without an empty selector or a browser whitelist', async ({ page, app }, testInfo) => {
		const manager = await openManager(page);
		await manager.getByRole('button', { name: 'New browser tab', exact: true }).click();
		await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 720));
		await manager.getByRole('button', { name: 'Import browser data…', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Import browser data', exact: true });
		await expect(dialog).toContainText('No supported profiles found');
		await expect(dialog.getByRole('combobox')).toHaveCount(0);
		await expect(dialog.getByRole('button', { name: 'Choose a profile folder…' })).toBeInViewport();
		await expect(dialog.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
		await testInfo.attach('import-empty-narrow', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
		await dialog.getByRole('button', { name: 'Choose a profile folder…' }).click();
		await expect(dialog.getByRole('button', { name: /custom-profile/ })).toBeVisible();
		await dialog.getByRole('button', { name: /custom-profile/ }).click();
		await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
		await expect(dialog.getByRole('checkbox', { name: /^Bookmarks and folders/ })).toBeChecked();
		await expect(dialog).toContainText('Open tabs');
		await expect(dialog.getByRole('checkbox', { name: /^Open tabs/ })).toHaveCount(0);
		await dialog.getByRole('button', { name: 'Import', exact: true }).click();
		await expect(dialog).toContainText('1 imported');
	});
});

test.describe('browser profiles with missing categories', () => {
	test.use({ browserSetup: 'mixed' });
	test('imports available data and reports a repeated import without false errors', async ({ page }) => {
		const manager = await openManager(page);
		await manager.getByRole('button', { name: 'New browser tab', exact: true }).click();
		await manager.getByRole('button', { name: 'Import browser data…', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Import browser data', exact: true });
		for (const heading of ['Your data is ready', 'Everything is already here']) {
			await dialog.getByRole('button', { name: /Example Navigator/ }).click();
			await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
			await dialog.locator('.cs-import-profiles summary').click();
			await expect(dialog.getByRole('checkbox', { name: 'Personal', exact: true })).toBeChecked();
			await expect(dialog).toContainText('Available in 1 of 2 selected profiles.');
			await dialog.getByRole('button', { name: 'Import', exact: true }).click();
			await expect(dialog.getByRole('heading', { name: heading, exact: true })).toBeVisible();
			await expect(dialog.getByRole('alert')).toHaveCount(0);
			if (heading === 'Your data is ready') { await dialog.getByRole('button', { name: 'Import another', exact: true }).click(); }
		}
	});
});

test('browser pages keep readable default colors and preserve website dark backgrounds', async ({ page, app }) => {
	const server = createServer((request, response) => {
		if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
		const styles = request.url === '/dark' ? 'html{background:#181818;color:#eee}'
			: request.url === '/dark-body' ? 'body{background:#181818;color:#eee}'
				: request.url === '/scheme' ? 'html{color-scheme:dark}' : '';
		response.writeHead(200, { 'Content-Type': 'text/html' });
		response.end(`<title>Page colors</title><style>${styles}</style><h1>Readable text</h1>`);
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const origin = `http://127.0.0.1:${server.address().port}`;
	const canvasPixel = () => app.evaluate(async ({ webContents }, origin) => {
		const contents = webContents.getAllWebContents().find(contents => contents.getURL().startsWith(origin));
		return Array.from((await contents.capturePage({ x: 100, y: 200, width: 1, height: 1 })).toBitmap().subarray(0, 3));
	}, origin);
	try {
		const manager = await openManager(page);
		await manager.getByRole('button', { name: 'New browser tab', exact: true }).click();
		const address = manager.getByRole('combobox', { name: 'Search the web or enter a URL', exact: true });
		await address.fill(origin);
		await address.press('Enter');
		await expect(manager.getByRole('tab', { name: 'Page colors', exact: true })).toBeVisible();
		const nativePage = app.context().pages().find(page => page.url().startsWith(origin));
		await expect.poll(canvasPixel).toEqual([255, 255, 255]);
		await expect(nativePage.locator('h1')).toHaveCSS('color', 'rgb(0, 0, 0)');
		for (const path of ['/dark', '/dark-body']) {
			await nativePage.goto(`${origin}${path}`);
			// Native capture can round a channel by one during color conversion.
			await expect.poll(async () => (await canvasPixel()).every(value => Math.abs(value - 24) <= 2)).toBe(true);
			await expect(nativePage.locator('h1')).toHaveCSS('color', 'rgb(238, 238, 238)');
		}
		await nativePage.goto(`${origin}/scheme`);
		await expect.poll(async () => (await canvasPixel()).every(value => value < 80)).toBe(true);
		const textColor = await nativePage.locator('h1').evaluate(element => getComputedStyle(element).color);
		expect(textColor.match(/\d+/g).slice(0, 3).every(value => Number(value) > 200)).toBe(true);
		await nativePage.goto(origin);
		await expect.poll(canvasPixel).toEqual([255, 255, 255]);
	} finally {
		server.closeAllConnections();
		await new Promise(resolve => server.close(resolve));
	}
});

test('browser pages cannot swallow pointer input with window-drag styles', async ({ page, app }) => {
	const server = createServer((request, response) => {
		if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
		response.writeHead(200, { 'Content-Type': 'text/html' });
		response.end(`<title>Page drag regions</title>
			<style>
				header { position:fixed; inset:0 0 auto; height:60px; pointer-events:none; z-index:10; -webkit-app-region:drag !important; }
				button { position:absolute; top:8px; left:296px; padding:12px; -webkit-app-region:no-drag; }
				button:hover { background:rgb(0, 180, 120); }
				body::before { content:''; -webkit-app-region:drag !important; }
			</style>
			<header style="-webkit-app-region:drag !important"></header>
			<button onclick="this.textContent='Clicked'">Sidebar toggle</button>`);
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const origin = `http://127.0.0.1:${server.address().port}`;
	try {
		const manager = await openManager(page);
		await manager.getByRole('button', { name: 'New browser tab', exact: true }).click();
		const address = manager.getByRole('combobox', { name: 'Search the web or enter a URL', exact: true });
		await address.fill(origin);
		await address.press('Enter');
		await expect(manager.getByRole('tab', { name: 'Page drag regions', exact: true })).toBeVisible();
		const nativePage = app.context().pages().find(page => page.url().startsWith(origin));
		const assertNoDrag = async () => {
			await expect(nativePage.locator('header')).toHaveCSS('-webkit-app-region', 'no-drag');
			expect(await nativePage.evaluate(() => getComputedStyle(document.body, '::before').webkitAppRegion)).toBe('no-drag');
		};
		await assertNoDrag();
		await nativePage.evaluate(() => {
			const header = document.createElement('header');
			header.style.setProperty('-webkit-app-region', 'drag', 'important');
			document.body.appendChild(header);
		});
		await expect(nativePage.locator('header').last()).toHaveCSS('-webkit-app-region', 'no-drag');
		await nativePage.getByRole('button', { name: 'Sidebar toggle', exact: true }).hover();
		await expect(nativePage.locator('button')).toHaveCSS('background-color', 'rgb(0, 180, 120)');
		await nativePage.locator('button').click();
		await expect(nativePage.locator('button')).toHaveText('Clicked');
		await nativePage.goto(`${origin}/next`);
		await assertNoDrag();
		await nativePage.reload();
		await assertNoDrag();
	} finally {
		server.closeAllConnections();
		await new Promise(resolve => server.close(resolve));
	}
});

test.describe('browser responsiveness', () => {
	test.use({
		browserHistory: [Array.from({ length: 50_000 }, (_, index) => ({ url: `http://history.example.test/${index}`, title: `History ${index}`, lastVisit: 100_000 - index, visits: 1 })), { scope: 'test' }],
		browserBookmarks: [{ url: 'http://bookmarks.example.test/', title: 'Saved reference', folders: [] }],
	});

	test('preserves clicks during title updates, avoids native relayout, and yields to overlays with large history', async ({ page, app }) => {
		const server = createServer((request, response) => {
			if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
			response.writeHead(200, { 'Content-Type': 'text/html' });
			response.end('<title>Responsive page</title><style>button{margin:40px;padding:20px}button:hover{background:rgb(0, 180, 120)}</style><button onmouseenter="window.enters=(window.enters||0)+1" onclick="window.clicks=(window.clicks||0)+1">Page button</button>');
		});
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		const origin = `http://127.0.0.1:${server.address().port}`;
		const nativeVisible = () => app.evaluate(({ BrowserWindow }, origin) => BrowserWindow.getAllWindows().flatMap(window => window.contentView.children).some(view => view.webContents?.getURL().startsWith(origin) && view.getVisible()), origin);
		const title = value => app.evaluate(async ({ webContents }, { origin, value }) => {
			await webContents.getAllWebContents().find(contents => contents.getURL().startsWith(origin)).executeJavaScript(`document.title = ${JSON.stringify(value)}`);
		}, { origin, value });

		const pointerState = () => app.evaluate(async ({ webContents }, origin) => webContents.getAllWebContents().find(contents => contents.getURL().startsWith(origin)).executeJavaScript('({ color: getComputedStyle(document.querySelector("button")).backgroundColor, clicks: window.clicks || 0, enters: window.enters || 0 })'), origin);
		try {
			const manager = await openManager(page);
			await manager.getByRole('button', { name: 'New browser tab', exact: true }).click();
			await expect(manager.locator('summary').filter({ hasText: /^History \(/ })).toHaveText('History (50000)');
			const search = manager.getByRole('combobox', { name: 'Search the web or enter a URL', exact: true });
			await search.fill(origin);
			await search.press('Enter');
			const tabs = manager.getByRole('tablist', { name: 'Browser tabs', exact: true });
			await expect(tabs.getByRole('tab', { name: 'Responsive page', exact: true })).toBeVisible();
			await expect.poll(nativeVisible).toBe(true);
			await manager.getByRole('button', { name: 'Pin current page', exact: true }).click();
			const bookmarks = manager.locator('summary').filter({ hasText: /^Bookmarks \(/ });
			const history = manager.locator('summary').filter({ hasText: /^History \(/ });
			await bookmarks.click();
			await expect(manager.getByRole('button', { name: 'Saved reference', exact: true })).toBeVisible();
			await page.evaluate(() => {
				globalThis.browserStableControls = [...document.querySelectorAll('.cleanSlate-browser-bookmarks summary, .cleanSlate-browser-pin, .cleanSlate-browser-bookmark')];
			});
			await app.evaluate(({ BrowserWindow }, origin) => {
				const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('workbench'));
				const view = window.contentView.children.find(view => view.webContents?.getURL().startsWith(origin));
				globalThis.browserNativeUpdates = 0;
				for (const [object, key] of [[window.contentView, 'addChildView'], [window.contentView, 'removeChildView'], [view, 'setBounds'], [view.webContents, 'setZoomFactor']]) {
					const original = object[key];
					object[key] = function (...args) { globalThis.browserNativeUpdates++; return original.apply(this, args); };
				}
			}, origin);
			await expect.poll(nativeVisible).toBe(true);
			const nativePage = app.context().pages().find(page => page.url().startsWith(origin));
			await nativePage.getByRole('button', { name: 'Page button', exact: true }).hover();
			await expect.poll(async () => (await pointerState()).color).toBe('rgb(0, 180, 120)');
			await nativePage.mouse.down();
			for (let index = 0; index < 8; index++) {
				await title(`Title ${index}`);
				await expect(tabs.getByRole('tab', { name: `Title ${index}`, exact: true })).toBeVisible();
			}
			await nativePage.mouse.up();
			await expect.poll(async () => (await pointerState()).clicks).toBe(1);
			expect((await pointerState()).color).toBe('rgb(0, 180, 120)');
			await expect.poll(() => app.evaluate(() => globalThis.browserNativeUpdates)).toBe(0);
			expect(await page.evaluate(() => globalThis.browserStableControls.every(control => control.isConnected))).toBe(true);
			await expect.poll(async () => (await Promise.all(page.workers().map(worker => worker.evaluate(() => self.name)))).includes('CleanSlateBrowserHistory')).toBe(true);
			await manager.getByRole('button', { name: 'Open pinned site: Title 7', exact: true }).hover();
			await expect(manager.getByRole('button', { name: 'Unpin Title 7', exact: true })).toHaveCSS('opacity', '1');
			await title('Title after hover');
			await expect(manager.getByRole('button', { name: 'Unpin Title after hover', exact: true })).toHaveCSS('opacity', '1');

			const box = await history.boundingBox();
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
			await page.mouse.down();
			await title('Title during click');
			await expect(tabs.getByRole('tab', { name: 'Title during click', exact: true })).toBeVisible();
			await page.mouse.up();
			await expect(history.locator('..')).toHaveAttribute('open', '');

			await page.keyboard.press('F1');
			await expect(page.locator('.quick-input-widget')).toBeVisible();
			await expect.poll(nativeVisible).toBe(false);
			await page.keyboard.press('Escape');
			await expect.poll(nativeVisible).toBe(true);

			await manager.getByRole('textbox', { name: 'Search tabs and bookmarks', exact: true }).fill('History 49998');
			await expect(manager.getByRole('button', { name: 'History 49998', exact: true })).toBeVisible();
			await manager.getByRole('textbox', { name: 'Search tabs and bookmarks', exact: true }).press('Escape');
			await manager.getByRole('button', { name: 'New browser tab', exact: true }).click();
			await search.fill('Title during click');
			const suggestion = manager.getByRole('option').filter({ hasText: 'Title during click' });
			const option = await suggestion.elementHandle();
			const suggestionBox = await suggestion.boundingBox();
			await page.mouse.move(suggestionBox.x + suggestionBox.width / 2, suggestionBox.y + suggestionBox.height / 2);
			await page.mouse.down();
			await title('Title during click updated');
			await expect(suggestion).toContainText('Title during click updated');
			expect(await option.evaluate(element => element.isConnected)).toBe(true);
			await page.mouse.up();
			await expect(tabs.getByRole('tab', { name: 'Title during click updated', exact: true })).toHaveAttribute('aria-selected', 'true');
			await expect.poll(nativeVisible).toBe(true);
		} finally {
			server.closeAllConnections();
			await new Promise(resolve => server.close(resolve));
		}
	});
});
