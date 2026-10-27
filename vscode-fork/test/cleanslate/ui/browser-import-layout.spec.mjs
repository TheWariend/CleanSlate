import { test, expect, expectUsable } from './fixtures.mjs';

async function mount(page) {
	await page.evaluate(async () => {
		const { CleanSlateBrowserImportDialog } = await import('/vs/workbench/contrib/cleanSlate/browser/settings/cleanSlateBrowserImportDialog.js');
		globalThis.importDialog = new CleanSlateBrowserImportDialog(document.getElementById('fixture'), {
			nativeHost: { getBrowserImportSources: async () => [], chooseBrowserImportFolder: async () => undefined }, storage: {},
		}, () => {}, { sources: [] });
	});
	await expect(page.getByRole('heading', { name: 'Import browser data' })).toBeFocused();
	await page.locator('dialog').evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
}

test('import help and rescans keep the dialog and footer in place', async ({ page }) => {
	await mount(page);
	const dialog = page.locator('dialog');
	const footer = page.locator('.cs-import-footer');
	const before = await dialog.boundingBox();
	const footerBefore = await footer.boundingBox();
	await page.getByText('Browser compatibility', { exact: true }).click();
	await expect(page.getByText(/Chrome, Edge and other Chromium/)).toBeVisible();
	await expect.poll(() => dialog.boundingBox()).toEqual(before);
	await expect.poll(() => footer.boundingBox()).toEqual(footerBefore);
	await page.getByRole('button', { name: /Choose a profile folder/ }).click();
	await expect(page.getByText('Browser compatibility', { exact: true })).toBeVisible();
	await expect.poll(() => dialog.boundingBox()).toEqual(before);
	await expect.poll(() => footer.boundingBox()).toEqual(footerBefore);
	await expectUsable(page.getByRole('button', { name: 'Done', exact: true }));
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
});

test('small windows keep actions visible while the body scrolls', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 420 });
	await mount(page);
	await page.getByText('Browser compatibility', { exact: true }).click();
	await expectUsable(page.getByRole('button', { name: 'Done', exact: true }));
	await expectUsable(page.getByRole('button', { name: 'Close import', exact: true }));
	const bounds = await page.locator('dialog').boundingBox();
	expect(bounds.x).toBeGreaterThanOrEqual(0);
	expect(bounds.y).toBeGreaterThanOrEqual(0);
	expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
	expect(bounds.y + bounds.height).toBeLessThanOrEqual(420);
});

test('browser cards edit profiles without moving the import frame', async ({ page }, testInfo) => {
	await page.evaluate(async () => {
		const { CleanSlateBrowserImportDialog } = await import('/vs/workbench/contrib/cleanSlate/browser/settings/cleanSlateBrowserImportDialog.js');
		const sources = ['Personal', 'Work'].map((profile, index) => ({ id: `chrome-${index}`, browserId: 'chrome', browser: 'Chrome', profile, available: { tabs: true, bookmarks: true, history: true } }));
		globalThis.importDialog = new CleanSlateBrowserImportDialog(document.getElementById('fixture'), { nativeHost: {}, storage: {} }, () => {}, { sources });
	});
	await page.locator('dialog').evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
	const frame = await page.locator('dialog').boundingBox();
	await page.screenshot({ path: testInfo.outputPath('browser-cards.png') });
	await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
	await page.getByRole('button', { name: 'Edit Chrome profiles' }).click();
	await expect(page.getByRole('checkbox', { name: 'Work', exact: true })).toBeChecked();
	await page.screenshot({ path: testInfo.outputPath('profile-editor.png') });
	await page.getByRole('checkbox', { name: 'Work', exact: true }).uncheck();
	await page.getByRole('button', { name: 'Done', exact: true }).click();
	await expect.poll(() => page.locator('dialog').boundingBox()).toEqual(frame);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await expect(page.getByRole('button', { name: /1 profile selected/ })).toBeVisible();
	await page.getByRole('button', { name: /1 profile selected/ }).click();
	await expect(page.getByRole('checkbox', { name: 'Work', exact: true })).not.toBeChecked();
	await page.keyboard.press('Escape');
	await expect(page.locator('.cs-import-profile-editor')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
});
