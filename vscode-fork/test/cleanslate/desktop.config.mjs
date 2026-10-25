import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './desktop',
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: 0,
	timeout: 90_000,
	outputDir: './results/desktop',
	reporter: [['list'], ['html', { outputFolder: './results/desktop-report', open: 'never' }], ['junit', { outputFile: './results/desktop.xml' }]],
});
