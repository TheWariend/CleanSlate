import { test, expect, expectUsable } from './fixtures.mjs';

async function mountPending(page) {
	await page.evaluate(async () => {
		const { CleanSlateBrowserSettingsView } = await import('/vs/workbench/contrib/cleanSlate/browser/settings/cleanSlateBrowserSettingsView.js');
		globalThis.browserSettings = new CleanSlateBrowserSettingsView(document.getElementById('fixture'), {
			nativeHost: {
				getDefaultBrowserState: async () => ({ isDefault: false, canSetDefault: true }),
				getBrowserImportSources: () => new Promise((resolve, reject) => { globalThis.finishScan = resolve; globalThis.failScan = reject; }),
			}, storage: {},
		});
	});
}

test('browser discovery shows stable placeholders and clears loading after success', async ({ page }) => {
	await mountPending(page);
	await expect(page.locator('.cs-browser-source-grid')).toHaveAttribute('aria-busy', 'true');
	await expect(page.locator('.cs-browser-source-skeleton')).toHaveCount(4);
	await expect(page.getByRole('status').filter({ hasText: 'Looking for browser profiles' })).toBeVisible();
	const before = await page.locator('.cs-browser-alternatives').boundingBox();
	await page.evaluate(() => finishScan(['Browser One', 'Browser Two', 'Browser Three', 'Browser Four'].map(browser => ({ id: browser, browserId: browser, browser, profile: 'Personal', available: { tabs: true, bookmarks: true, history: true } }))));
	await expect(page.locator('.cs-browser-source')).toHaveCount(4);
	await expect(page.locator('.cs-browser-source-skeleton')).toHaveCount(0);
	await expect(page.locator('.cs-browser-source-grid')).not.toHaveAttribute('aria-busy', 'true');
	await expect(page.locator('.cs-browser-scan-status')).toHaveText('');
	await expect.poll(() => page.locator('.cs-browser-alternatives').boundingBox()).toEqual(before);
	await expectUsable(page.getByRole('button', { name: 'Set as Default', exact: true }));
});

test('discovery failure leaves a usable retry and recovers without a stuck spinner', async ({ page }) => {
	await mountPending(page);
	await page.evaluate(() => failScan(new Error('test failure')));
	await expect(page.locator('.cs-browser-source-skeleton')).toHaveCount(0);
	await expectUsable(page.getByRole('button', { name: 'Retry', exact: true }));
	await page.getByRole('button', { name: 'Retry', exact: true }).click();
	await expect(page.locator('.cs-browser-source-grid')).toHaveAttribute('aria-busy', 'true');
	await page.evaluate(() => finishScan([]));
	await expect(page.locator('.cs-browser-source-grid')).not.toHaveAttribute('aria-busy', 'true');
	await expect(page.getByText(/No supported profiles found/)).toBeVisible();
	await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeHidden();
});
