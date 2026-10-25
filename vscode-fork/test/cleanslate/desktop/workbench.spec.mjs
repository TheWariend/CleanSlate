import { test as base, expect, _electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const fork = fileURLToPath(new URL('../../../', import.meta.url));
const product = JSON.parse(await (await import('node:fs/promises')).readFile(join(fork, 'product.json'), 'utf8'));
const executablePath = process.env.CLEANSLATE_ELECTRON_PATH ?? join(fork, '.build/electron', process.platform === 'darwin'
	? `${product.nameLong}.app/Contents/MacOS/${product.nameShort}`
	: process.platform === 'win32' ? `${product.nameShort}.exe` : product.applicationName);

const test = base.extend({
	app: async ({}, use, testInfo) => {
		const root = await mkdtemp(join(tmpdir(), 'cleanslate-qa-'));
		await mkdir(join(root, 'profile/User'), { recursive: true });
		await mkdir(join(root, 'workspace'));
		await writeFile(join(root, 'workspace/qa.txt'), 'Existing editor functionality must keep working.\n');
		await writeFile(join(root, 'profile/User/settings.json'), JSON.stringify({
			'workbench.startupEditor': 'none', 'workbench.colorTheme': 'Default Dark Modern',
			'update.mode': 'none', 'telemetry.telemetryLevel': 'off', 'security.workspace.trust.enabled': false,
		}));
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

test('Agent Manager can return to the editor, open a file, and come back', async ({ page }) => {
	const manager = await openManager(page);
	await page.locator('.cleanSlate-agent-manager-exit').click();
	await expect(manager).toBeHidden();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+p' : 'Control+p');
	const input = page.locator('.quick-input-widget input');
	await input.fill('qa.txt');
	await expect(page.locator('.quick-input-list')).toContainText('qa.txt');
	await input.press('Enter');
	await expect(page.locator('.monaco-editor').filter({ has: page.locator('.view-lines') }).first()).toBeVisible();
	await openManager(page);
	await expect(manager.locator('.cleanSlate-agent-manager-new-chat')).toBeVisible();
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
		await input.fill('Say exactly QA canary response without tools.');
		await manager.getByRole('button', { name: 'Send message', exact: true }).click();
		await expect(manager.locator('.cleanSlate-chat-messages')).toContainText('QA canary response.', { timeout: 20_000 });
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
