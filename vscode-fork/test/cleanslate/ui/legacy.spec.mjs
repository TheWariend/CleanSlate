import { test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const directory = new URL('../', import.meta.url);
for (const file of (await readdir(directory)).filter(file => file.endsWith('-browser.mjs')).sort()) {
	test(file, async ({}, testInfo) => {
		test.setTimeout(60_000);
		let result;
		try {
			result = await run(process.execPath, [fileURLToPath(new URL(file, directory))], { cwd: fileURLToPath(new URL('../../', directory)), timeout: 50_000, maxBuffer: 4 * 1024 * 1024 });
		} catch (error) {
			result = error;
			throw error;
		} finally {
			await testInfo.attach('script-output', { body: `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`, contentType: 'text/plain' });
		}
	});
}
