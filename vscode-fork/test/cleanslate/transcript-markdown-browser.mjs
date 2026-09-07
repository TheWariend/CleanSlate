// Run after transpiling the transcript renderer: node test/cleanslate/transcript-markdown-browser.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const fork = new URL('../../', import.meta.url);
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
try {
	const page = await browser.newPage();
	const pageErrors = [];
	page.on('pageerror', error => pageErrors.push(error.message));
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
				:root { --vscode-foreground:#ddd; --vscode-descriptionForeground:#999; --vscode-editor-background:#171717; }
				body { width:680px; margin:20px; font:14px/1.5 Arial,sans-serif; background:#171717; color:#ddd; }
				</style>` });
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
		const { renderMarkdown } = await import('/vs/base/browser/markdownRenderer.js');
		const { CLEANSLATE_CHAT_STYLES } = await import('/vs/workbench/contrib/cleanSlate/browser/chat/styles/cleanSlateChatStyles.js');
		const { CleanSlateTranscriptRenderer } = await import('/vs/workbench/contrib/cleanSlate/browser/chat/renderers/cleanSlateTranscriptRenderer.js');
		const styles = document.head.appendChild(document.createElement('style'));
		styles.textContent = CLEANSLATE_CHAT_STYLES;
		const nextFrame = () => new Promise(requestAnimationFrame);
		const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
		const check = (condition, message) => { if (!condition) throw new Error(message); };
		const fixtures = [];
		const fixture = () => {
			const host = document.body.appendChild(document.createElement('section'));
			const message = host.appendChild(document.createElement('div'));
			message.className = 'cleanSlate-chat-message cleanSlate';
			const copies = [];
			const links = [];
			const renders = [];
			const renderer = new CleanSlateTranscriptRenderer({ read: () => [] }, {}, {
				render(markdown, options) {
					const rendered = renderMarkdown(markdown, {
						...options,
						actionHandler: href => links.push(href),
						codeBlockRenderer: async (_language, value) => {
							const pre = document.createElement('pre');
							pre.textContent = value;
							return pre;
						}
					});
					// The IDE markdown service adds this class around the same base renderer.
					rendered.element.classList.add('rendered-markdown');
					const record = { element: rendered.element, disposed: false };
					renders.push(record);
					return { element: rendered.element, dispose() { record.disposed = true; rendered.dispose(); } };
				}
			}, { async writeText(text) { copies.push(text); } });
			const update = (id, type, content, isStreaming) => renderer.renderJSONResponse({
				timeline: [{ id, type, content, isStreaming }],
				...(!isStreaming ? { transcriptStatus: 'completed' } : {})
			}, isStreaming, host, message);
			const instance = { host, renderer, update, copies, links, renders };
			fixtures.push(instance);
			return instance;
		};

		const markdown = fixture();
		const first = 'This committed paragraph contains **bold text** and enough prose to exercise line wrapping in the actual transcript layout.';
		const content = `${first}\n\n\`\`\`js\nconst answer = 42;\n\`\`\`\n\nA final paragraph that continues to grow until the stream completes.`;
		markdown.update('answer', 'assistant_text', content, true);
		await pause(200);
		const paragraph = markdown.host.querySelector('.cleanSlate-stream-block p');
		const widget = markdown.host.querySelector('.cleanSlate-code-widget');
		const copy = widget?.querySelector('.cleanSlate-code-widget-copy');
		check(paragraph && widget && copy, 'Real markdown did not create committed paragraph and code widget');
		const codeOwner = markdown.renders.find(record => record.element.contains(widget));
		check(codeOwner && !codeOwner.disposed, 'Committed code renderer was already disposed while streaming');
		const answer = markdown.host.querySelector('[data-block-id="answer"]');
		const before = answer.getBoundingClientRect().height;
		const layout = () => Array.from(answer.querySelectorAll('.cleanSlate-stream-tail, .rendered-markdown, p'), element => ({
			tag: element.tagName, className: element.className, height: element.getBoundingClientRect().height,
			marginTop: getComputedStyle(element).marginTop, marginBottom: getComputedStyle(element).marginBottom
		}));
		const beforeLayout = layout();
		const paragraphTop = paragraph.getBoundingClientRect().top;
		markdown.update('answer', 'assistant_text', content, false);
		await nextFrame();
		const completionShift = answer.getBoundingClientRect().height - before;
		check(Math.abs(completionShift) <= 1, `Final markdown completion changed layout by ${completionShift}px: ${JSON.stringify({ before: beforeLayout, after: layout() })}`);
		check(markdown.host.querySelector('.cleanSlate-stream-block p') === paragraph, 'Completion replaced committed paragraph');
		check(markdown.host.querySelector('.cleanSlate-code-widget') === widget, 'Completion replaced committed code widget');
		check(Math.abs(paragraph.getBoundingClientRect().top - paragraphTop) <= 1, 'Completion moved committed paragraph');
		for (let index = 0; index < 4; index++) markdown.update('answer', 'assistant_text', content, false);
		check(!codeOwner.disposed && copy.isConnected, 'Repeated settled checkpoint disposed the retained code renderer');
		copy.click();
		await nextFrame();
		check(markdown.copies.length === 1 && markdown.copies[0].trim() === 'const answer = 42;', 'Retained code widget copy stopped working');
		const finalParagraphs = Array.from(markdown.host.querySelectorAll('p'), element => element.textContent);
		check(finalParagraphs.length === 2 && finalParagraphs[0].includes('committed paragraph') && finalParagraphs[1].startsWith('A final paragraph'),
			`Final output duplicated or dropped prose: ${JSON.stringify(finalParagraphs)}`);

		const references = fixture();
		const referenceStart = 'Read the [documentation][docs].\n\nThis paragraph arrives before the link definition.';
		references.update('reference', 'assistant_text', referenceStart, true);
		const referenceFinal = `${referenceStart}\n\n[docs]: https://example.com/docs`;
		references.update('reference', 'assistant_text', referenceFinal, true);
		references.update('reference', 'assistant_text', referenceFinal, false);
		const referenceLink = references.host.querySelector('a');
		check(referenceLink?.textContent === 'documentation', 'A reference defined later did not become a final markdown link');
		referenceLink.click();
		check(references.links[0] === 'https://example.com/docs', 'The final reference link lost its action handler');

		const reasoning = fixture();
		let reasoningText = '';
		for (let index = 0; index < 40; index++) {
			reasoningText += `${index ? ' ' : ''}step-${index}`;
			reasoning.update('thought', 'reasoning', reasoningText, true);
			await nextFrame();
		}
		await pause(220);
		const thought = reasoning.host.querySelector('.cleanSlate-reasoning-block');
		const body = thought.querySelector('.cleanSlate-reasoning-body');
		const viewport = thought.querySelector('.cleanSlate-reasoning-body-viewport');
		check(body.textContent === reasoningText, 'Rapid reasoning deltas duplicated or dropped text');
		check(body.childNodes.length <= 1 && body.querySelectorAll('.cleanSlate-stream-chunk').length === 0,
			'Finished reasoning fades accumulated unbounded chunk nodes');
		check(viewport.getAttribute('aria-hidden') === 'false', 'Live reasoning was hidden from assistive technology');
		reasoning.update('thought', 'reasoning', reasoningText, false);
		await pause(1900);
		check(thought.classList.contains('is-collapsed') && viewport.getAttribute('aria-hidden') === 'true', 'Completed reasoning stayed exposed after auto-collapse');
		thought.querySelector('button').click();
		check(viewport.getAttribute('aria-hidden') === 'false', 'Manual expansion did not expose reasoning content');
		reasoning.update('thought', 'reasoning', reasoningText, false);
		check(viewport.getAttribute('aria-hidden') === 'false', 'Settled checkpoint overrode the manually expanded thought');
		thought.querySelector('button').click();
		check(viewport.getAttribute('aria-hidden') === 'true', 'Manual collapse did not hide reasoning content');

		const restored = fixture();
		restored.update('restored', 'reasoning', 'Previously completed thought.', false);
		check(restored.host.querySelector('.cleanSlate-reasoning-body-viewport')?.getAttribute('aria-hidden') === 'true',
			'Restored completed reasoning remained exposed while collapsed');
		for (const instance of fixtures) { instance.renderer.disposeMarkdownRenders(); instance.host.remove(); }
		return { completionShift, reasoningNodeCount: body.childNodes.length, copied: markdown.copies[0].trim(), reference: references.links[0] };
	});
	assert.deepEqual(pageErrors, [], `Browser errors: ${pageErrors.join('; ')}`);
	assert.equal(result.copied, 'const answer = 42;');
	assert.equal(result.reference, 'https://example.com/docs');
	console.log('Passed: actual markdown completion geometry, committed paragraph/code identity, repeated checkpoints and copy, late reference definitions, reasoning accessibility, bounded streaming text.', result);
} finally {
	await browser.close();
}
