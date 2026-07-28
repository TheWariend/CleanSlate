/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CleanSlateNodeBrowserAutomation } from '../node/cleanSlateNodeBrowserAutomation.js';

test('Node browser host opens, inspects and interacts with a real page', {
	skip: process.env['CLEANSLATE_BROWSER_E2E'] !== '1'
}, async () => {
	const browser = new CleanSlateNodeBrowserAutomation();
	try {
		const html = `<!doctype html><title>Browser test</title>
			<label>Name <input aria-label="Name"></label>
			<button onclick="document.querySelector('output').textContent='Hello '+document.querySelector('input').value">Go</button>
			<output></output>`;
		const opened = await browser.open(`data:text/html,${encodeURIComponent(html)}`);
		assert.equal(opened.title, 'Browser test');
		const snapshot = await browser.snapshot('ide');
		assert.equal(snapshot.bodyText.includes('Name'), true);
		await browser.fill('ide', { label: 'Name', value: 'CleanSlate' });
		await browser.click('ide', { role: 'button', name: 'Go' });
		const after = await browser.snapshot('ide');
		assert.equal(after.bodyText.includes('Hello CleanSlate'), true);
		const screenshot = await browser.screenshot('ide');
		assert.equal(screenshot.mimeType, 'image/jpeg');
		assert.equal(screenshot.base64.length > 100, true);
	} finally {
		await browser.dispose();
	}
});
