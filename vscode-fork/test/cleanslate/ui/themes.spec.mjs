import { readdir, readFile } from 'node:fs/promises';
import { parse } from '../../../out/vs/base/common/json.js';
import { test, expect, expectUsable } from './fixtures.mjs';

// Use the shipped theme files, including their includes, rather than approximating
// light/high-contrast with a handful of hand-written CSS variables.
const extensions = new URL('../../../extensions/', import.meta.url);
async function colorsFor(file) {
	const data = parse(await readFile(file, 'utf8'));
	return { ...(data.include ? await colorsFor(new URL(data.include, file)) : {}), ...data.colors };
}
const palettes = [];
for (const name of (await readdir(extensions)).filter(name => name.startsWith('theme-')).sort()) {
	const folder = new URL(`${name}/`, extensions);
	const manifest = JSON.parse(await readFile(new URL('package.json', folder), 'utf8'));
	for (const theme of manifest.contributes?.themes ?? []) {
		palettes.push({ name: theme.id ?? `${name}/${theme.path}`, kind: theme.uiTheme, colors: await colorsFor(new URL(theme.path, folder)) });
	}
}
palettes.push({ name: 'Custom plum and cream', kind: 'vs', colors: {
	'editor.background': '#fff8e7', 'editor.foreground': '#34203c', 'foreground': '#34203c',
	'sideBar.background': '#eee2ce', 'sideBar.foreground': '#34203c', 'input.background': '#fffef7', 'input.foreground': '#34203c',
	'editorWidget.background': '#f0e3f3', 'button.background': '#653378', 'button.foreground': '#ffffff',
	'button.hoverBackground': '#542267', 'list.activeSelectionBackground': '#653378', 'list.activeSelectionForeground': '#ffffff',
	'focusBorder': '#8b2461', 'titleBar.activeBackground': '#d7c1df', 'activityBar.background': '#ccb7d1'
} });

test.beforeEach(async ({ page }) => {
	await page.evaluate(async () => {
		await import('/qa/browser-fixtures.mjs');
		await import('/vs/workbench/common/theme.js');
		const { Color } = await import('/vs/base/common/color.js');
		const { getColorRegistry } = await import('/vs/platform/theme/common/colorRegistry.js');
		const registry = getColorRegistry();
		qa.setTheme = palette => {
			document.body.className = `monaco-workbench mac ${palette.kind}`;
			document.body.style.colorScheme = ['vs-dark', 'hc-black'].includes(palette.kind) ? 'dark' : 'light';
			const cache = new Map();
			const theme = {
				type: { vs: 'light', 'vs-dark': 'dark', 'hc-black': 'hcDark', 'hc-light': 'hcLight' }[palette.kind],
				defines: id => typeof palette.colors[id] === 'string',
				getColor(id) {
					if (cache.has(id)) { return cache.get(id); }
					cache.set(id, undefined);
					const value = typeof palette.colors[id] === 'string' ? Color.fromHex(palette.colors[id]) : registry.resolveDefaultColor(id, theme);
					cache.set(id, value);
					return value;
				}
			};
			for (const { id } of registry.getColors()) {
				// Match the real workbench: theme tokens belong to the workbench host,
				// never to the document root where they could mask alias scope bugs.
				document.documentElement.style.setProperty(`--vscode-${id.replaceAll('.', '-')}`, 'initial');
				document.body.style.setProperty(`--vscode-${id.replaceAll('.', '-')}`, theme.getColor(id)?.toString() ?? 'initial');
			}
			for (const [id, value] of Object.entries(palette.colors)) {
				if (typeof value === 'string') { document.body.style.setProperty(`--vscode-${id.replaceAll('.', '-')}`, value); }
			}
		};
		qa.tokenColor = (id, fallback) => {
			const probe = document.body.appendChild(document.createElement('span'));
			probe.style.color = `var(--vscode-${id.replaceAll('.', '-')}, ${fallback ? `var(--vscode-${fallback.replaceAll('.', '-')})` : 'transparent'})`;
			const value = getComputedStyle(probe).color;
			probe.remove();
			return value;
		};
	});
});

for (const palette of palettes) {
	test(`complete chat and settings adapt to ${palette.name}`, async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: ['vs-dark', 'hc-black'].includes(palette.kind) ? 'dark' : 'light' });
		await page.evaluate(async palette => {
			qa.setTheme(palette);
			(await import('/qa/browser-fixtures.mjs')).mountComposer();
			qa.command.update({ id: 'theme-command', command: 'npm run build', cwd: '/qa/theme-project' });
		}, palette);
		const token = (id, fallback) => page.evaluate(({ id, fallback }) => qa.tokenColor(id, fallback), { id, fallback });
		await expect(page.locator('.cleanSlate-input-box')).toHaveCSS('background-color', await token('input.background'));
		await expect(page.locator('textarea')).toHaveCSS('color', await token('input.foreground'));
		await expect(page.locator('.cleanSlate-command-approval')).toHaveCSS('background-color', await token('editorWidget.background'));
		await expect(page.locator('.cleanSlate-command-approval-title')).toHaveCSS('color', await token('foreground'));
		const submit = page.locator('.cleanSlate-command-approval-submit');
		await expect(submit).toHaveCSS('color', await token('button.foreground'));
		await expect(submit).toHaveCSS('background-color', await token('button.background'));
		await expect(page.locator('.cleanSlate-command-approval-option.selected')).toHaveCSS('background-color', await token('list.activeSelectionBackground', 'editor.background'));
		await expect(page.locator('.cleanSlate-command-approval-option.selected')).toHaveCSS('color', await token('list.activeSelectionForeground', 'foreground'));
		for (const choice of ['cancel', 'approve']) {
			await page.locator(`.cleanSlate-command-approval-option[data-choice="${choice}"]`).click();
			await expect(page.locator('.cleanSlate-command-approval-option.selected')).toHaveCSS('color', await token('list.activeSelectionForeground', 'foreground'));
			await expect(page.locator('.cleanSlate-command-approval-option.selected .cleanSlate-command-approval-index')).toHaveCSS('color', await token('list.activeSelectionBackground', 'editor.background'));
		}
		await submit.focus();
		await page.keyboard.press('Tab');
		await page.keyboard.press('Shift+Tab');
		await expect(submit).toHaveCSS('outline-color', await token('focusBorder'));
		await expect(submit).toHaveCSS('outline-style', 'solid');
		await expect(submit).toHaveCSS('outline-width', '2px');
		await expectUsable(submit);
		await submit.hover();
		await expect(submit).toHaveCSS('background-color', await token('button.hoverBackground'));

		await testInfo.attach('chat-theme', { body: await page.screenshot(), contentType: 'image/png' });
		await page.evaluate(async () => {
			qa.command.update(undefined);
			await (await import('/qa/browser-fixtures.mjs')).mountSettings('pro');
		});
		await page.locator('.cleanSlate-settings-nav-item').filter({ hasText: 'API Keys' }).click();
		const key = page.getByPlaceholder('OpenAI API key', { exact: true });
		await expect(key).toHaveCSS('background-color', await token('input.background'));
		await expect(key).toHaveCSS('color', await token('input.foreground'));
		await key.focus();
		await expect(key).toHaveCSS('outline-color', await token('focusBorder'));
		await expect(key).toHaveCSS('outline-width', '2px');
		await expectUsable(key);
		await testInfo.attach('settings-theme', { body: await page.screenshot(), contentType: 'image/png' });
	});
}

test('switching theme live updates mounted controls and keeps drafts and approval selection', async ({ page }) => {
	await page.evaluate(async () => {
		(await import('/qa/browser-fixtures.mjs')).mountComposer();
		qa.composer.setValue('Keep this draft when the theme changes');
		qa.command.update({ id: 'live-theme', command: 'npm test', cwd: '/qa/theme-project' });
		qa.originalInput = qa.composer.getInputElement();
	});
	for (const palette of palettes.filter(p => ['Default Dark Modern', 'Default Light Modern', 'Default High Contrast', 'Default High Contrast Light', 'Custom plum and cream'].includes(p.name))) {
		await page.emulateMedia({ colorScheme: ['vs-dark', 'hc-black'].includes(palette.kind) ? 'dark' : 'light' });
		await page.evaluate(palette => qa.setTheme(palette), palette);
		await expect(page.locator('textarea')).toHaveValue('Keep this draft when the theme changes');
		expect(await page.evaluate(() => qa.originalInput === qa.composer.getInputElement())).toBe(true);
		await expect(page.locator('.cleanSlate-command-approval-option.selected')).toHaveCount(1);
		await expect(page.locator('.cleanSlate-command-approval-submit')).toHaveCSS('background-color', await page.evaluate(() => qa.tokenColor('button.background')));
	}
});
