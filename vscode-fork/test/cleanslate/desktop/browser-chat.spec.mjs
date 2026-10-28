import { test, expect, _electron } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { finishProjectSetup } from './projectSetup.mjs';

const fork = fileURLToPath(new URL('../../../', import.meta.url));
const product = JSON.parse(await readFile(join(fork, 'product.json'), 'utf8'));
const executablePath = process.env.CLEANSLATE_ELECTRON_PATH ?? join(fork, '.build/electron', process.platform === 'darwin'
	? `${product.nameLong}.app/Contents/MacOS/${product.nameShort}`
	: process.platform === 'win32' ? `${product.nameShort}.exe` : product.applicationName);

test('Browser chat uses the current native page, resizes smoothly and restores separate conversations after restart', async ({}, testInfo) => {
	test.setTimeout(180_000);
	const root = await mkdtemp(join(tmpdir(), 'cleanslate-browser-chat-'));
	const workspace = join(root, 'private-project');
	const profile = join(root, 'profile');
	await mkdir(workspace);
	await mkdir(join(profile, 'User'), { recursive: true });
	await writeFile(join(workspace, 'editor-secret.txt'), 'EDITOR_CONTEXT_CANARY');
	await writeFile(join(workspace, 'AGENTS.md'), 'Always repeat PROJECT_INSTRUCTION_CANARY.');
	await writeFile(join(profile, 'User/settings.json'), JSON.stringify({
		'workbench.startupEditor': 'none', 'workbench.colorTheme': 'Default Dark Modern',
		'update.mode': 'none', 'telemetry.telemetryLevel': 'off', 'security.workspace.trust.enabled': false,
	}));
	const requests = [];
	let heldResponse;
	let holdNext = false;
	const server = createServer(async (request, response) => {
		if (request.url.startsWith('/article')) {
			response.writeHead(200, { 'Content-Type': 'text/html' });
			response.end(`<title>Browser article ${request.url.endsWith('two') ? 'two' : 'one'}</title><h1>${request.url.endsWith('two') ? 'SECOND_PAGE_CANARY' : 'FIRST_PAGE_CANARY'}</h1><p id="selected">SELECTED_PASSAGE_CANARY</p>`);
			return;
		}
		if (!request.url.endsWith('/chat/completions')) {
			response.writeHead(200, { 'Content-Type': 'application/json' });
			response.end(JSON.stringify({ data: [{ id: 'qa-browser', object: 'model' }] }));
			return;
		}
		let body = '';
		for await (const chunk of request) { body += chunk; }
		requests.push(JSON.parse(body));
		response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
		const chunk = (delta, finish_reason) => `data: ${JSON.stringify({ id: 'qa-browser-turn', object: 'chat.completion.chunk', model: 'qa-browser', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
		if (holdNext) {
			holdNext = false;
			heldResponse = () => response.end(chunk({ tool_calls: [{ index: 0, id: 'qa-browser-url', type: 'function', function: { name: 'browser_get_url', arguments: '{}' } }] }, 'tool_calls') + 'data: [DONE]\n\n');
		} else { response.end(chunk({ content: 'Browser answer canary.' }, 'stop') + 'data: [DONE]\n\n'); }
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const origin = `http://127.0.0.1:${server.address().port}`;
	let app;
	let page;
	let logs = '';
	let projectPrepared = false;
	const launch = async () => {
		app = await _electron.launch({ executablePath, args: [fork, workspace, `--user-data-dir=${profile}`, `--extensions-dir=${join(root, 'extensions')}`, '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--no-sandbox', '--goto', join(workspace, 'editor-secret.txt')],
			env: { ...process.env, ELECTRON_RUN_AS_NODE: '', NODE_OPTIONS: '', VSCODE_DEV: '1', VSCODE_CLI: '1', NODE_ENV: 'development' }, timeout: 60_000 });
		for (const stream of [app.process().stdout, app.process().stderr]) { stream?.on('data', chunk => { logs = (logs + chunk.toString()).slice(-500_000); }); }
		page = await app.firstWindow();
		page.on('console', message => { if (/CleanSlateService|configuration/.test(message.text())) { logs = (logs + message.text() + '\n').slice(-500_000); } });
		await expect(page.locator('.monaco-workbench')).toBeVisible({ timeout: 60_000 });
		if (!projectPrepared) { await finishProjectSetup(page); projectPrepared = true; }
		await app.evaluate(({ app, BrowserWindow }) => { app.focus({ steal: true }); BrowserWindow.getAllWindows()[0].setSize(1280, 800); BrowserWindow.getAllWindows()[0].focus(); });
		const manager = page.locator('.cleanSlate-agent-manager-surface');
		if (!await manager.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)) {
			await page.keyboard.press('F1');
			const quickInput = page.locator('.quick-input-widget input');
			await quickInput.fill('>Open Agent Manager');
			await expect(page.locator('.quick-input-list .monaco-list-row').first()).toContainText('Open Agent Manager');
			await quickInput.press('Enter');
		}
		await expect(manager).toBeVisible();
		await expect(manager.locator('.cleanSlate-agent-manager-startup-loading')).toBeHidden();

		return manager;
	};
	const openArticle = async (manager, suffix) => {
		await manager.getByRole('button', { name: 'New browser tab', exact: true }).click();
		const address = manager.getByRole('combobox', { name: 'Search the web or enter a URL', exact: true });
		await address.fill(`${origin}/article-${suffix}`);
		await address.press('Enter');
		await expect(manager.getByRole('tab', { name: `Browser article ${suffix}`, exact: true })).toBeVisible();
	};
	try {
		let manager = await launch();
		const saveSetting = async (input, value) => {
			await input.fill(value);
			// Await the settings control's asynchronous save before changing the
			// next provider field; overlapping saves use different configuration snapshots.
			await input.evaluate(async input => { await input.onchange(new Event('change')); });
		};
		await manager.getByRole('button', { name: 'Settings', exact: true }).click();
		await page.locator('.cleanSlate-settings-nav-item[data-section="models"]').click();
		await page.locator('.cleanSlate-settings-row').filter({ hasText: /^Provider/ }).locator('.cleanSlate-select').click();
		await page.locator('.cleanSlate-select-option').filter({ hasText: 'Custom API' }).click();
		await expect(page.getByPlaceholder('model-name', { exact: true })).toBeVisible();
		await saveSetting(page.getByPlaceholder('model-name', { exact: true }), 'qa-browser');
		await saveSetting(page.getByPlaceholder('http://localhost:11434/v1', { exact: true }), `${origin}/v1`);
		await page.locator('.cleanSlate-settings-nav-item[data-section="apiKeys"]').click();
		await saveSetting(page.getByPlaceholder('Optional API key', { exact: true }), 'qa-local-key');
		await page.locator('.cleanSlate-settings-nav-item[data-section="models"]').click();
		await expect(page.getByPlaceholder('model-name', { exact: true })).toHaveValue('qa-browser');
		await page.getByRole('button', { name: 'Back to app', exact: true }).click();

		await openArticle(manager, 'one');
		await manager.getByRole('button', { name: 'Chat about this page' }).click();
		let chat = manager.locator('.cleanSlate-browser-chat-body');
		await expect(manager.locator('.cleanSlate-agent-manager-right-header')).toBeHidden();
		await expect(chat.getByRole('checkbox')).toHaveCount(0);
		await expect(chat.locator('.model-dropdown')).toContainText(/qa.browser/i);
		expect((await chat.getByPlaceholder('Ask anything', { exact: true }).boundingBox()).height).toBeLessThan(40);
		await chat.getByRole('button', { name: 'History', exact: true }).click();
		await expect(page.locator('.cleanSlate-history-overlay')).toBeVisible();
		await expect(page.locator('.cleanSlate-history-item')).toHaveCount(0);
		await page.keyboard.press('Escape');
		await chat.getByPlaceholder('Ask anything', { exact: true }).fill('Summarize the current article');
		await chat.getByRole('button', { name: 'Send message', exact: true }).click();
		await expect(chat.locator('.cleanSlate-chat-messages')).toContainText('Browser answer canary.', { timeout: 20_000 });
		expect(JSON.stringify(requests[0].messages)).toContain('FIRST_PAGE_CANARY');
		for (const secret of ['EDITOR_CONTEXT_CANARY', 'PROJECT_INSTRUCTION_CANARY', workspace, 'editor-secret.txt', 'cleanSlateWorkspaceBrowser.ts']) { expect(JSON.stringify(requests)).not.toContain(secret); }
		await expect(manager.locator('button.cleanSlate-agent-manager-session')).toHaveCount(0);
		await expect(chat.locator('.cleanSlate-chat-view-title-label')).toHaveText('Summarize the current article');
		await chat.getByPlaceholder('Ask anything', { exact: true }).fill('Saved browser draft');
		await manager.getByRole('button', { name: 'Back to threads', exact: true }).click();
		await expect(manager).not.toHaveClass(/right-pane-visible/);
		await manager.getByRole('tab', { name: 'Browser', exact: true }).click();
		await expect(manager).toHaveClass(/right-pane-visible/);
		await expect(chat.getByPlaceholder('Ask anything', { exact: true })).toHaveValue('Saved browser draft');
		for (let index = 0; index < 2; index++) {
			await manager.getByRole('button', { name: 'Back to threads', exact: true }).click();
			await manager.getByRole('tab', { name: 'Browser', exact: true }).click();
			await chat.getByRole('button', { name: 'Close browser chat', exact: true }).click();
			await manager.getByRole('button', { name: 'Chat about this page' }).click();
			await expect(manager.locator('.cleanSlate-agent-manager-right-body')).toHaveCSS('padding', '0px');
			await expect(chat.getByPlaceholder('Ask anything', { exact: true })).toHaveValue('Saved browser draft');
			await expect(chat.locator('.model-dropdown')).toContainText(/qa.browser/i);
			await expect(chat.getByRole('button', { name: 'Scroll to bottom', exact: true })).toBeHidden();
		}
		await manager.getByRole('button', { name: 'New browser tab', exact: true }).click();
		await expect(manager).not.toHaveClass(/right-pane-visible/);
		await expect(manager.getByRole('button', { name: 'Chat about this page' })).toBeDisabled();
		await manager.getByRole('tab', { name: 'Browser article one', exact: true }).click();
		await expect(manager).toHaveClass(/right-pane-visible/);
		const nativeBounds = () => app.evaluate(({ BrowserWindow, webContents }, origin) => {
			const contents = webContents.getAllWebContents().find(contents => contents.getURL() === `${origin}/article-one`);
			return BrowserWindow.getAllWindows().flatMap(window => window.contentView.children).find(view => view.webContents?.id === contents?.id)?.getBounds();
		}, origin);
		const before = await nativeBounds();
		const handle = manager.getByRole('separator', { name: 'Resize right pane', exact: true });
		const bounds = await handle.boundingBox();
		await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 70);
		await page.mouse.down();
		await page.mouse.move(bounds.x + 90, bounds.y + 70, { steps: 15 });
		await page.mouse.up();
		await expect(manager).not.toHaveClass(/resizing-right/);
		await expect.poll(async () => (await nativeBounds()).width).toBeGreaterThan(before.width);
		await expect(chat.getByPlaceholder('Ask anything', { exact: true })).toHaveValue('Saved browser draft');
		await chat.locator('.reasoning-dropdown').click();
		const reasoning = chat.locator('.cleanSlate-reasoning-effort-overlay');
		await expect(reasoning).toBeVisible();
		const popupBounds = await reasoning.boundingBox();
		const paneBounds = await chat.boundingBox();
		const pageBounds = await nativeBounds();
		expect(popupBounds.x).toBeGreaterThanOrEqual(paneBounds.x);
		expect(popupBounds.x).toBeGreaterThanOrEqual(pageBounds.x + pageBounds.width);
		expect(popupBounds.x + popupBounds.width).toBeLessThanOrEqual(paneBounds.x + paneBounds.width);
		await testInfo.attach('browser-chat-editor-picker', { body: await page.screenshot(), contentType: 'image/png' });
		await chat.locator('.cleanSlate-chat-view-title-label').click();
		await expect(reasoning).toHaveCount(0);
		await testInfo.attach('browser-chat-single-header', { body: await page.screenshot(), contentType: 'image/png' });
		await chat.getByRole('button', { name: 'New Chat', exact: true }).click();
		await chat.getByPlaceholder('Ask anything', { exact: true }).fill('Second conversation draft');
		await app.close(); app = undefined;
		manager = await launch();
		await openArticle(manager, 'one');
		const toggle = manager.getByRole('button', { name: 'Chat about this page' });
		if (await toggle.getAttribute('aria-pressed') !== 'true') { await toggle.click(); }
		chat = manager.locator('.cleanSlate-browser-chat-body');
		await expect(chat.getByPlaceholder('Ask anything', { exact: true })).toHaveValue('Second conversation draft');
		await chat.getByRole('button', { name: 'History', exact: true }).click();
		await expect(page.locator('.cleanSlate-history-item')).toHaveCount(2);
		await page.locator('.cleanSlate-history-item').filter({ hasText: 'Summarize the current article' }).click();
		await expect(chat.getByPlaceholder('Ask anything', { exact: true })).toHaveValue('Saved browser draft');
		await expect(chat.locator('.cleanSlate-chat-messages')).toContainText('Browser answer canary.');
		holdNext = true;
		await chat.getByPlaceholder('Ask anything', { exact: true }).fill('Read the current URL');
		await chat.getByRole('button', { name: 'Send message', exact: true }).click();
		await expect.poll(() => !!heldResponse).toBe(true);
		await openArticle(manager, 'two');
		heldResponse();
		await expect(chat.getByRole('button', { name: 'Send message', exact: true })).toBeVisible({ timeout: 20_000 });
		const tools = requests.at(-1).messages.filter(message => message.role === 'tool');
		expect(JSON.stringify(tools)).toContain('/article-one');
		expect(JSON.stringify(tools)).not.toContain('/article-two');
		await expect(manager.getByRole('tab', { name: 'Browser article two', exact: true })).toHaveAttribute('aria-selected', 'true');
		await chat.getByPlaceholder('Ask anything', { exact: true }).fill('Summarize this second page');
		await chat.getByRole('button', { name: 'Send message', exact: true }).click();
		await expect.poll(() => JSON.stringify(requests.at(-1).messages)).toContain('SECOND_PAGE_CANARY');
		await chat.getByRole('button', { name: 'Delete chat', exact: true }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(chat.locator('.cleanSlate-chat-messages')).toContainText('Browser answer canary.');
		await chat.getByRole('button', { name: 'Delete chat', exact: true }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Delete chat', exact: true }).click();
		await expect(chat.getByPlaceholder('Ask anything', { exact: true })).toHaveValue('Second conversation draft');
		await chat.getByRole('button', { name: 'Close browser chat', exact: true }).click();
		await manager.getByRole('button', { name: 'Chat about this page' }).click();
		await expect(chat.getByPlaceholder('Ask anything', { exact: true })).toHaveValue('Second conversation draft');
	} finally {
		if (page && !page.isClosed()) { await testInfo.attach('desktop-final', { body: await page.screenshot(), contentType: 'image/png' }).catch(() => {}); }
		if (app) { await app.close(); }
		await writeFile(testInfo.outputPath('app.log'), logs);
		server.closeAllConnections();
		await new Promise(resolve => server.close(resolve));
		await rm(root, { recursive: true, force: true });
	}
});
