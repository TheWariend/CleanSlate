// Run after transpiling CleanSlateTranscriptView: node test/cleanslate/transcript-layout-browser.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const fork = new URL('../../', import.meta.url);
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
try {
	const page = await browser.newPage();
	await page.route('http://cleanslate.test/**', async route => {
		const url = new URL(route.request().url());
		if (url.pathname.endsWith('.css')) {
			await route.fulfill({ contentType: 'text/javascript', body: 'export {};' });
			return;
		}
		if (url.pathname === '/') {
			await route.fulfill({ contentType: 'text/html', body: `
				<script type="importmap">{"imports":{"@cleanslate/sdk/":"/sdk/"}}</script>
				<style>
				.cleanSlate-chat-messages { height: 320px; width: 600px; overflow: auto; }
				.cleanSlate-chat-message-row { padding: 12px; }
				.cleanSlate-chat-message { white-space: pre-wrap; }
				</style><div id="host"></div>` });
			return;
		}
		const file = url.pathname.startsWith('/sdk/')
			? new URL(`../packages/cleanslate-sdk/dist/${url.pathname.slice(5)}`, fork)
			: new URL(`out${url.pathname}`, fork);
		try {
			await route.fulfill({ contentType: 'text/javascript', body: await readFile(file, 'utf8') });
		} catch (error) {
			await route.fulfill({ status: 404, body: String(error) });
		}
	});
	await page.goto('http://cleanslate.test/');
	const result = await page.evaluate(async () => {
		globalThis._VSCODE_FILE_ROOT = 'http://cleanslate.test/';
		const { CleanSlateTranscriptView } = await import('/vs/workbench/contrib/cleanSlate/browser/chat/view/sections/cleanSlateTranscriptView.js');
		const host = document.getElementById('host');
		const view = new CleanSlateTranscriptView(host, { disposeMarkdownRenders() {} }, () => {});
		const nextFrame = () => new Promise(requestAnimationFrame);
		const bottomGap = () => view.element.scrollHeight - view.element.clientHeight - view.element.scrollTop;
		const waitForResize = (element, change) => new Promise(resolve => {
			let initialized = false;
			const observer = new ResizeObserver(() => {
				if (!initialized) {
					initialized = true;
					requestAnimationFrame(change);
					return;
				}
				// This observer is registered after the view's observer. Read during
				// the same before-paint delivery: a queued rAF pin is one paint late.
				observer.disconnect();
				resolve(bottomGap());
			});
			observer.observe(element);
		});
		view.restore(Array.from({ length: 20 }, (_, index) => ({ id: `old-${index}`, role: 'user', content: `Earlier message ${index}` })));
		const tail = view.addMessage('Reasoning', 'cleanSlate');
		view.scrollToBottom(true);
		await nextFrame();
		const growthGap = await waitForResize(tail.parentElement, () => {
			// A streamed text render happens inside its own animation frame.
			// Delayed markdown and image layouts have the same resize path.
			tail.textContent += '\nA new reasoning line.\nAnother reasoning line.';
		});
		await nextFrame();
		const collapseGap = await waitForResize(tail.parentElement, () => { tail.textContent = 'Thought briefly'; });
		await nextFrame();
		const viewportGap = await waitForResize(view.element, () => { view.element.style.height = '240px'; });
		await nextFrame();

		const top = view.element.querySelector('.cleanSlate-chat-message');
		top.style.height = '160px';
		await nextFrame();
		await nextFrame();
		view.element.dispatchEvent(new WheelEvent('wheel', { deltaY: -160 }));
		view.element.scrollTop = 240;
		await nextFrame();
		const anchor = view.element.children[5];
		const anchorBefore = anchor.getBoundingClientRect().top;
		const manualScrollBefore = view.element.scrollTop;
		await waitForResize(top.parentElement, () => { top.style.height = '80px'; });
		await nextFrame();
		const anchorShift = anchor.getBoundingClientRect().top - anchorBefore;
		const remainedAwayFromBottom = bottomGap() > 10 && view.element.scrollTop < manualScrollBefore;

		const placeholder = view.addMessage('', 'cleanSlate');
		placeholder.innerHTML = '<div class="cleanSlate-working-placeholder placeholder">Thinking</div>';
		const placeholderRow = placeholder.parentElement;
		view.removeStreamingPlaceholders();
		const placeholderRowRemoved = !placeholderRow.isConnected;
		view.clear();
		return { growthGap, collapseGap, viewportGap, anchorShift, remainedAwayFromBottom, placeholderRowRemoved };
	});
	assert.ok(Math.abs(result.growthGap) <= 2, `Reasoning growth painted ${result.growthGap}px away from the bottom`);
	assert.ok(Math.abs(result.collapseGap) <= 2, `Reasoning collapse painted ${result.collapseGap}px away from the bottom`);
	assert.ok(Math.abs(result.viewportGap) <= 2, `Viewport resize painted ${result.viewportGap}px away from the bottom`);
	assert.ok(Math.abs(result.anchorShift) <= 2 && result.remainedAwayFromBottom,
		`A collapse above manually scrolled content moved its visible anchor: ${JSON.stringify(result)}`);
	assert.equal(result.placeholderRowRemoved, true, 'Stopped Thinking left an empty row occupying transcript space');
	console.log('Passed: before-paint streaming/collapse/viewport pinning, manual scroll anchoring, stopped placeholder cleanup.');
} finally {
	await browser.close();
}
