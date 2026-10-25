import { test, expect } from './fixtures.mjs';
import { readdir } from 'node:fs/promises';

const root = new URL('../../../src/vs/workbench/contrib/cleanSlate/test/browser/', import.meta.url);
const files = (await readdir(root, { recursive: true })).filter(file => file.endsWith('.test.ts')).sort();
if (!files.length) { throw new Error('No browser unit tests discovered'); }
for (const file of files) {
	test(`browser unit suite: ${file}`, async ({ page }) => {
		await page.addScriptTag({ url: 'http://cleanslate.test/qa/mocha.js' });
		const result = await page.evaluate(async file => {
			mocha.setup({ ui: 'tdd', timeout: 10_000 });
			await import(`/vs/workbench/contrib/cleanSlate/test/browser/${file.replace(/\.ts$/, '.js')}`);
			return new Promise(resolve => {
				const failures = [];
				const runner = mocha.run(() => resolve({ failures, tests: runner.stats.tests }));
				runner.on('fail', (test, error) => failures.push({ title: test.fullTitle(), error: error.stack }));
			});
		}, file);
		expect(result.tests, 'Browser suite must execute tests').toBeGreaterThan(0);
		expect(result.failures).toEqual([]);
	});
}
