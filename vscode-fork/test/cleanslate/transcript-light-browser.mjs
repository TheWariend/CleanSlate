// Transpile the transcript renderer/styles first, then run with PLAYWRIGHT_CHANNEL=chrome.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const fork = new URL('../../', import.meta.url);
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
try {
	const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
	await page.route('http://cleanslate.test/**', async route => {
		const url = new URL(route.request().url());
		if (url.pathname === '/') {
			await route.fulfill({ contentType: 'text/html', body: '<script type="importmap">{"imports":{"@cleanslate/sdk/":"/sdk/"}}</script><div id="host"></div>' });
			return;
		}
		if (url.pathname.endsWith('.css')) {
			await route.fulfill({ contentType: 'text/javascript', body: 'export {};' });
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
		const { CLEANSLATE_CHAT_STYLES } = await import('/vs/workbench/contrib/cleanSlate/browser/chat/styles/cleanSlateChatStyles.js');
		const { CleanSlateTranscriptRenderer } = await import('/vs/workbench/contrib/cleanSlate/browser/chat/renderers/cleanSlateTranscriptRenderer.js');
		const styles = document.head.appendChild(document.createElement('style'));
		styles.textContent = CLEANSLATE_CHAT_STYLES + `
			:root { --vscode-foreground: #ddd; --vscode-descriptionForeground: #999; --vscode-editor-background: #191919; }
			body { margin: 48px; background: #191919; color: #ddd; font: 14px/1.6 system-ui; }
			#host { width: 700px; } .cleanSlate-timeline-block { margin: 16px 0; }
		`;
		const host = document.getElementById('host');
		const renderer = new CleanSlateTranscriptRenderer({ read: () => [] }, {}, {
			render(markdown) { const element = document.createElement('div'); element.textContent = markdown.value; return { element, dispose() {} }; }
		}, {});
		const assistant = host.appendChild(document.createElement('div'));
		assistant.className = 'cleanSlate-chat-message cleanSlate';
		const nextFrame = () => new Promise(requestAnimationFrame);
		const render = (block, live = true) => renderer.renderJSONResponse({ timeline: [block] }, live, host, assistant);
		const samples = {};
		const checkSweep = (label, name) => {
			const animation = label.getAnimations().find(item => item.animationName === name);
			if (!animation) { throw new Error(`Missing light on ${label.className}`); }
			const timing = animation.effect.getTiming();
			if (timing.easing !== 'linear' || timing.direction !== 'normal') { throw new Error(`Uneven sweep: ${JSON.stringify(timing)}`); }
			animation.pause();
			const positions = [0, 0.25, 0.5, 0.75].map(progress => {
				animation.currentTime = Number(timing.duration) * progress;
				return parseFloat(getComputedStyle(label).backgroundPositionX);
			});
			for (let i = 1; i < positions.length; i++) {
				if (Math.abs((positions[i - 1] - positions[i]) - 25) > 0.5) { throw new Error(`Light slows/stops during the pass: ${positions}`); }
			}
			animation.currentTime = 400;
			animation.play();
			return { animation, positions };
		};
		let block = { id: 'reasoning', type: 'reasoning', content: 'Reviewing the source.', isStreaming: true };
		render(block);
		await nextFrame();
		const reasoningLabel = host.querySelector('.cleanSlate-reasoning-label');
		const reasoningSweep = checkSweep(reasoningLabel, 'cleanSlateShimmer');
		for (let i = 0; i < 24; i++) {
			block = { ...block, content: block.content + ' More context.' };
			render(block);
			await nextFrame();
			if (host.querySelector('.cleanSlate-reasoning-label') !== reasoningLabel || !reasoningLabel.getAnimations().includes(reasoningSweep.animation)) { throw new Error('Reasoning deltas restarted the light'); }
		}
		samples.reasoning = reasoningSweep.positions;
		block = { id: 'group-activity-block-search', type: 'file', status: 'Exploring...', searchCount: 1, details: ['Search 1'], isStreaming: true };
		render(block);
		const activityLabel = host.querySelector('.cleanSlate-activity-label');
		const disclosure = host.querySelector('details');
		disclosure.open = true;
		const activitySweep = checkSweep(activityLabel, 'cleanSlate-working-sheen');
		for (let i = 2; i < 28; i++) {
			block = { ...block, searchCount: i, details: [...block.details, `Search ${i}`] };
			render(block);
			await nextFrame();
			if (host.querySelector('.cleanSlate-activity-label') !== activityLabel || !activityLabel.getAnimations().includes(activitySweep.animation) || !disclosure.open) { throw new Error('Tool updates reset light/disclosure'); }
		}
		render({ ...block, status: 'Explored', isStreaming: false });
		if (!activityLabel.getAnimations().includes(activitySweep.animation)) { throw new Error('Between-tool continuation reset the light'); }
		samples.tools = activitySweep.positions;
		block = { id: 'edit', type: 'file', status: 'Editing...', path: '/workspace/home.ts', added: 0, deleted: 0, isStreaming: true };
		render(block);
		const editLabel = host.querySelector('.analyzed-label');
		const editName = host.querySelector('.file-name');
		const editSweep = checkSweep(editLabel, 'cleanSlate-working-sheen');
		for (let i = 1; i <= 24; i++) {
			block = { ...block, added: i, deleted: i % 4, beforeContent: 'before', afterContent: `after ${i}` };
			render(block);
			await nextFrame();
			if (host.querySelector('.analyzed-label') !== editLabel || host.querySelector('.file-name') !== editName || !editLabel.getAnimations().includes(editSweep.animation)) { throw new Error('Edit deltas restarted light'); }
		}
		samples.edits = editSweep.positions;
		render({ ...block, status: 'Edited', isStreaming: false }, false);
		if (editLabel.getAnimations().some(a => a.animationName === 'cleanSlate-working-sheen')) { throw new Error('Completed edit kept its light'); }
		// Keep a live fixture for reduced-motion and screenshot checks below.
		render(block);
		globalThis.lightFixture = { renderer, host, render, block };
		return samples;
	});
	for (const positions of Object.values(result)) { assert.equal(positions.length, 4); }
	await page.emulateMedia({ reducedMotion: 'reduce' });
	const reduced = await page.evaluate(() => {
		const label = lightFixture.host.querySelector('.analyzed-label');
		const style = getComputedStyle(label);
		return { animation: style.animationName, background: style.backgroundImage, fill: style.webkitTextFillColor };
	});
	assert.equal(reduced.animation, 'none');
	assert.equal(reduced.background, 'none');
	assert.notEqual(reduced.fill, 'rgba(0, 0, 0, 0)');
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await page.screenshot({ path: '/tmp/cleanslate-light-regression.png' });
	console.log('Passed: constant-speed left-to-right light; uninterrupted reasoning/tool/edit updates; exploration continuation; completion and reduced motion.');
	console.log(JSON.stringify(result));
} finally {
	await browser.close();
}
