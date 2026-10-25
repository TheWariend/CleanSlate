import { test, expect, expectUsable } from './fixtures.mjs';

test.beforeEach(async ({ page }) => {
	await page.evaluate(async () => (await import('/qa/browser-fixtures.mjs')).mountSettings());
});

test('every settings section remains reachable after navigating between features', async ({ page }) => {
	for (const name of ['General', 'Usage', 'Agents', 'Models', 'API Keys', 'Verification', 'Indexing & Docs', 'General']) {
		const button = page.locator('.cleanSlate-settings-nav-item').filter({ hasText: name });
		await expectUsable(button);
		await button.click();
		await expect(button).toHaveClass(/active/);
		await expect(page.locator('.cleanSlate-settings-page-section-title')).toContainText(name === 'Usage' ? 'Plan usage limits' : name);
	}
});

test('provider changes preserve model controls and API keys stay masked', async ({ page }) => {
	await page.locator('.cleanSlate-settings-nav-item').filter({ hasText: 'Models' }).click();
	const provider = page.locator('.cleanSlate-settings-row').filter({ hasText: /^Provider/ }).locator('.cleanSlate-select');
	await provider.click();
	await expectUsable(page.locator('.cleanSlate-select-option').filter({ hasText: 'Custom API' }));
	await page.locator('.cleanSlate-select-option').filter({ hasText: 'Custom API' }).click();
	await expect.poll(() => page.evaluate(() => qa.config.provider)).toBe('custom');
	await page.locator('.cleanSlate-settings-nav-item').filter({ hasText: 'API Keys' }).click();
	const key = page.getByPlaceholder('OpenAI API key', { exact: true });
	await expect(key).toHaveAttribute('type', 'password');
	await key.fill('qa-fake-key');
	await key.blur();
	await expect.poll(() => page.evaluate(() => qa.config.providers.openai.apiKey)).toBe('qa-fake-key');
	await page.locator('.cleanSlate-settings-nav-item').filter({ hasText: 'General' }).click();
	await page.locator('.cleanSlate-settings-nav-item').filter({ hasText: 'API Keys' }).click();
	await expect(page.getByPlaceholder('OpenAI API key', { exact: true })).toHaveValue('qa-fake-key');
});

test('verification switches keep their state across section changes', async ({ page }) => {
	await page.locator('.cleanSlate-settings-nav-item').filter({ hasText: 'Verification' }).click();
	const toggle = page.locator('.cleanSlate-settings-row').filter({ hasText: 'Fail On Warnings' }).getByRole('switch');
	await expect(toggle).toHaveAttribute('aria-checked', 'true');
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-checked', 'false');
	await page.locator('.cleanSlate-settings-nav-item').filter({ hasText: 'Models' }).click();
	await page.locator('.cleanSlate-settings-nav-item').filter({ hasText: 'Verification' }).click();
	await expect(toggle).toHaveAttribute('aria-checked', 'false');
});

test('custom agent form can be opened, cancelled and reopened', async ({ page }) => {
	await page.locator('.cleanSlate-settings-nav-item').filter({ hasText: 'Agents' }).click();
	await page.getByRole('button', { name: /Add custom agent$/ }).click();
	await expectUsable(page.getByRole('button', { name: /Add agent$/ }));
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(page.getByRole('button', { name: /Add agent$/ })).toBeHidden();
	await page.getByRole('button', { name: /Add custom agent$/ }).click();
	await expectUsable(page.getByRole('button', { name: /Add agent$/ }));
});

test('service failure leaves settings navigation and account recovery visible', async ({ page }) => {
	await page.evaluate(async () => { document.getElementById('fixture').replaceChildren(); await (await import('/qa/browser-fixtures.mjs')).mountSettings('unavailable'); });
	await page.locator('.cleanSlate-settings-nav-item').filter({ hasText: 'Models' }).click();
	await expect(page.locator('.cleanSlate-settings-content')).toContainText('unavailable');
	await expectUsable(page.locator('.cleanSlate-settings-nav-item').filter({ hasText: 'General' }));
	await page.locator('.cleanSlate-settings-nav-item').filter({ hasText: 'General' }).click();
	await expectUsable(page.getByRole('button', { name: 'Sign out', exact: true }));
});

test('models settings appearance @visual', async ({ page }) => {
	await page.locator('.cleanSlate-settings-nav-item').filter({ hasText: 'Models' }).click();
	await expect(page.locator('.cleanSlate-settings-content')).toContainText('qa-model');
	await expect(page.locator('#fixture')).toHaveScreenshot('settings-models.png');
});
