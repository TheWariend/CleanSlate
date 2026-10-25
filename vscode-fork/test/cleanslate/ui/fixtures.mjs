import { test as base, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const fork = new URL('../../../', import.meta.url);
const contentTypes = { '.png': 'image/png', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.ttf': 'font/ttf' };

export const test = base.extend({
	page: async ({ page, colorScheme }, use) => {
		const errors = [];
		const missing = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.route('**/*', async route => {
			const url = new URL(route.request().url());
			if (url.origin !== 'http://cleanslate.test') {
				missing.push(`Unexpected external request: ${url.href}`);
				await route.abort();
				return;
			}
			if (url.pathname === '/favicon.ico') { await route.fulfill({ status: 204 }); return; }
			if (url.pathname === '/') {
				await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head>
					<script type="importmap">{"imports":{"@cleanslate/sdk/":"/sdk/","assert":"/qa/assert.js"}}</script>
					<style>
					:root { color-scheme:${colorScheme}; --vscode-font-family:Arial,sans-serif; --vscode-font-size:13px;
					--vscode-foreground:${colorScheme === 'light' ? '#242424' : '#dedede'};
					--vscode-descriptionForeground:${colorScheme === 'light' ? '#555' : '#aaa'};
					--vscode-editor-background:${colorScheme === 'light' ? '#fff' : '#191919'};
					--vscode-editor-foreground:var(--vscode-foreground); --vscode-sideBar-background:${colorScheme === 'light' ? '#f4f4f4' : '#202020'};
					--vscode-input-background:${colorScheme === 'light' ? '#eee' : '#282828'}; --vscode-input-foreground:var(--vscode-foreground);
					--vscode-button-background:#1768cb; --vscode-button-foreground:#fff; --vscode-focusBorder:#3989ff;
					--vscode-panel-border:#7775; --vscode-textLink-foreground:#3989ff; --vscode-list-hoverBackground:#8882;
					--vscode-dropdown-background:var(--vscode-sideBar-background); --vscode-editorWidget-background:var(--vscode-sideBar-background);
					}
					html,body,#fixture { margin:0; width:100%; height:100%; font:13px Arial,sans-serif; background:var(--vscode-editor-background); color:var(--vscode-foreground); }
					button,input,textarea { font:inherit; } * { box-sizing:border-box; }
					</style></head><body><div id="fixture"></div></body></html>` });
				return;
			}
			let file;
			if (url.pathname === '/qa/browser-fixtures.mjs') { file = new URL('./browser-fixtures.mjs', import.meta.url); }
			else if (url.pathname === '/qa/assert.js') { file = new URL('../results/assert.js', import.meta.url); }
			else if (url.pathname === '/qa/mocha.js') { file = new URL('node_modules/mocha/mocha.js', fork); }
			else if (url.pathname.startsWith('/sdk/')) { file = new URL(`../packages/cleanslate-sdk/dist/${url.pathname.slice(5)}`, fork); }
			else { file = new URL(`out${url.pathname}`, fork); }
			try {
				if (url.pathname.endsWith('.css') && route.request().resourceType() === 'stylesheet') {
					await route.fulfill({ contentType: 'text/css', body: await readFile(file) });
				} else if (url.pathname.endsWith('.css')) {
					const css = await readFile(file, 'utf8');
					await route.fulfill({ contentType: 'text/javascript', body: `const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style);export default {};` });
				} else {
					const extension = url.pathname.slice(url.pathname.lastIndexOf('.'));
					await route.fulfill({ contentType: contentTypes[extension] ?? 'text/javascript', body: await readFile(file) });
				}
			} catch (error) {
				missing.push(url.pathname);
				await route.fulfill({ status: 404, body: `Missing fixture dependency ${fileURLToPath(file)}: ${error.message}` });
			}
		});
		await page.goto('http://cleanslate.test/');
		await page.addStyleTag({ url: 'http://cleanslate.test/vs/base/browser/ui/codicons/codicon/codicon.css' });
		await page.evaluate(() => document.fonts.ready);
		await page.evaluate(() => { globalThis._VSCODE_FILE_ROOT = 'http://cleanslate.test/'; });
		await use(page);
		expect(errors, 'Uncaught browser errors').toEqual([]);
		expect(missing, 'Missing assets or unexpected network requests').toEqual([]);
	},
});

export { expect };

// Visibility alone misses controls covered by a sibling or clipped by overflow.
export async function expectUsable(locator) {
	await expect(locator).toBeVisible();
	await locator.scrollIntoViewIfNeeded();
	await expect.poll(() => locator.evaluate(element => {
		const r = element.getBoundingClientRect();
		const x = r.x + r.width / 2, y = r.y + r.height / 2;
		const style = getComputedStyle(element);
		const hit = document.elementFromPoint(x, y);
		return r.width >= 12 && r.height >= 12 && x >= 0 && x < innerWidth && y >= 0 && y < innerHeight
			&& Number(style.opacity) > 0 && (hit === element || element.contains(hit));
	}), 'Control is clipped, covered, transparent or outside the viewport').toBe(true);
}
