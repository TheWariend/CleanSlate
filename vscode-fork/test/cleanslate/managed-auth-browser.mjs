import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const fork = new URL('../../', import.meta.url);
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
try {
	const page = await browser.newPage();
	await page.route('http://cleanslate.test/**', async route => {
		const path = new URL(route.request().url()).pathname;
		if (path === '/') { await route.fulfill({ contentType: 'text/html', body: '<script type="importmap">{"imports":{"@cleanslate/sdk/":"/sdk/"}}</script>' }); return; }
		if (path.endsWith('.css')) { await route.fulfill({ contentType: 'text/javascript', body: 'export {}' }); return; }
		try {
			const file = path.startsWith('/sdk/') ? new URL(`../packages/cleanslate-sdk/dist/${path.slice(5)}`, fork) : new URL(`out${path}`, fork);
			await route.fulfill({ contentType: 'text/javascript', body: await readFile(file, 'utf8') });
		} catch (error) { await route.fulfill({ status: 404, body: String(error) }); }
	});
	await page.goto('http://cleanslate.test/');
	const result = await page.evaluate(async () => {
		globalThis._VSCODE_FILE_ROOT = 'http://cleanslate.test/';
		const { CleanSlateConfigurationService } = await import('/vs/workbench/services/cleanSlate/browser/core/cleanSlateConfigurationService.js');
		const { Emitter } = await import('/vs/base/common/event.js');
		const changes = new Emitter();
		const refresh = new Emitter();
		const key = 'cleanSlate.auth.jwt';
		const secrets = new Map([[key, 'old']]);
		const stored = new Map([['cleanSlate.auth.account', JSON.stringify({ email: 'test@example.test' })]]);
		let calls = 0;
		const service = new CleanSlateConfigurationService({ getValue: () => ({}) }, {
			getBoolean: () => true, get: name => stored.get(name), store: (name, value) => stored.set(name, value)
		}, {
			onDidChangeSecret: changes.event, get: async name => secrets.get(name),
			set: async (name, value) => { secrets.set(name, value); }, delete: async name => secrets.delete(name)
		}, {
			onDidRefreshManagedToken: refresh.event,
			refreshCleanSlateManagedToken: async previousToken => {
				calls++;
				const response = { previousToken, token: 'fresh', expires_at: '2030-01-01T00:00:00Z' };
				refresh.fire(response);
				return response;
			},
			proxyRequest: () => { throw new Error('IDE independently refreshed instead of using the shared host'); }
		}, { info() {}, warn() {}, error(error) { throw new Error(error); } });
		await service.getResolvedConfiguration();
		const refreshed = await service.refreshManagedToken('old');
		if (refreshed !== 'fresh' || secrets.get(key) !== 'fresh' || calls !== 1) throw new Error('Shared refresh was not persisted');
		if (service.getManagedAccount().expiresAt !== '2030-01-01T00:00:00Z') throw new Error('Account expiry not updated');
		// A load begun before rotation must not restore its captured old token.
		const loading = service.loadSecrets();
		refresh.fire({ previousToken: 'fresh', token: 'newest' });
		await loading;
		if (service.getConfiguration().providers.cleanslate.apiKey !== 'newest') throw new Error('Stale secret load overwrote refreshed token');
		secrets.set(key, 'different-account');
		changes.fire(key);
		await service.getResolvedConfiguration();
		refresh.fire({ previousToken: 'newest', token: 'late-old-account' });
		if (secrets.get(key) !== 'different-account') throw new Error('Old refresh replaced different account');
		secrets.delete(key);
		changes.fire(key);
		await service.getResolvedConfiguration();
		refresh.fire({ previousToken: 'different-account', token: 'late-signout' });
		await Promise.resolve();
		await Promise.resolve();
		if (secrets.has(key)) throw new Error('Refresh undid sign-out');
		return calls;
	});
	assert.equal(result, 1);
	console.log('Passed: shared refresh, token persistence, expiry metadata, stale secret load, different account and sign-out.');
} finally { await browser.close(); }
