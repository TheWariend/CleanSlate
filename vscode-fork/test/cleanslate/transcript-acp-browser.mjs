// Production transcript rendering for legacy imports and live ACP checkpoints.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const fork = new URL('../../', import.meta.url);
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
try {
	const page = await browser.newPage();
	const errors = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.route('http://cleanslate.test/**', async route => {
		const url = new URL(route.request().url());
		if (url.pathname.endsWith('.css')) { await route.fulfill({ contentType: 'text/javascript', body: 'export {};' }); return; }
		if (url.pathname === '/') {
			await route.fulfill({ contentType: 'text/html', body: `<script type="importmap">{"imports":{"@cleanslate/sdk/":"/sdk/"}}</script>
				<style>:root { --vscode-foreground:#ddd; --vscode-descriptionForeground:#999; --vscode-editor-background:#171717; }
				body { margin:20px; font:14px/1.5 Arial,sans-serif; background:#171717; color:#ddd; }
				section { width:680px; } .cleanSlate-chat-messages { height:500px; overflow:auto; }</style>` });
			return;
		}
		const file = url.pathname.startsWith('/sdk/') ? new URL(`../packages/cleanslate-sdk/dist/${url.pathname.slice(5)}`, fork) : new URL(`out${url.pathname}`, fork);
		try { await route.fulfill({ contentType: 'text/javascript', body: await readFile(file, 'utf8') }); }
		catch (error) { await route.fulfill({ status: 404, body: String(error) }); }
	});
	await page.goto('http://cleanslate.test/');
	const result = await page.evaluate(async () => {
		globalThis._VSCODE_FILE_ROOT = 'http://cleanslate.test/';
		const { renderMarkdown } = await import('/vs/base/browser/markdownRenderer.js');
		const { CLEANSLATE_CHAT_STYLES } = await import('/vs/workbench/contrib/cleanSlate/browser/chat/styles/cleanSlateChatStyles.js');
		const { CleanSlateTranscriptRenderer } = await import('/vs/workbench/contrib/cleanSlate/browser/chat/renderers/cleanSlateTranscriptRenderer.js');
		const { CleanSlateTranscriptView } = await import('/vs/workbench/contrib/cleanSlate/browser/chat/view/sections/cleanSlateTranscriptView.js');
		const styles = document.head.appendChild(document.createElement('style'));
		styles.textContent = CLEANSLATE_CHAT_STYLES;
		const check = (value, message) => { if (!value) throw new Error(message); };
		const fixture = () => {
			const host = document.body.appendChild(document.createElement('section'));
			const renderer = new CleanSlateTranscriptRenderer({ read: () => [] }, {}, { render(markdown, options) {
				const result = renderMarkdown(markdown, { ...options, codeBlockRenderer: async (_language, value) => {
					const pre = document.createElement('pre'); pre.textContent = value; return pre;
				} });
				result.element.classList.add('rendered-markdown');
				return result;
			} }, { async writeText() {} });
			const view = new CleanSlateTranscriptView(host, renderer, () => {});
			return { host, renderer, view };
		};
		const marker = '<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>';
		const textRow = (id, text) => ({ id, role: 'assistant', content: text, renderPayload: JSON.stringify({ timeline: [{ id, type: 'assistant_text', content: text }] }) });
		const toolRow = id => ({ role: 'assistant', content: `Tool: exec_command\nTool result (${id}):\npassed`, renderPayload: JSON.stringify({
			timeline: [{ id, type: 'tool', toolName: 'execute', content: 'Run Store checks', externalTool: true, toolStatus: 'completed', output: 'All checks passed.' }]
		}) });
		const legacy = fixture();
		const history = [{ role: 'user', content: marker }, { role: 'user', content: 'Fix Store' }, textRow('progress', 'I’ll check Store.'),
			...Array.from({ length: 12 }, (_, index) => toolRow(`tool-${index}`)), textRow('marker', marker), textRow('answer', 'Store is fixed.'),
			{ role: 'user', content: 'Who added Subscription?' }, textRow('explanation-1', 'Issam added its standalone setting.'), textRow('explanation-2', 'Azher later added the mobile entry.')];
		const original = JSON.stringify(history);
		legacy.view.restore(history);
		check(legacy.host.querySelectorAll('.cleanSlate-work-summary').length === 1, 'Legacy import still creates one Worked row per tool or narration');
		check(legacy.host.querySelectorAll('.cleanSlate-chat-message.cleanSlate').length === 3, 'Imported tools remain separate assistant bubbles');
		check(!legacy.host.textContent.includes('external_codex_apps_open_page'), 'Codex desktop marker leaked into imported prose');
		check(JSON.stringify(history) === original, 'Rendering changed the original handoff history');
		const work = legacy.host.querySelector('.cleanSlate-work-summary');
		check(!work.open && work.querySelectorAll('.type-tool').length === 12, 'The work disclosure lost tool details or started expanded');
		check(legacy.host.querySelector('[data-block-id="answer"]').parentElement.classList.contains('cleanSlate-message-transcript'), 'Final answer was hidden in activity');
		check(Number(getComputedStyle(work.querySelector('summary'), '::after').opacity) > 0, 'Expansion affordance is invisible until hover');
		work.querySelector('summary').click();
		check(work.open && work.querySelector('.cleanSlate-work-summary-body').getBoundingClientRect().height > 0, 'Work disclosure cannot be expanded');
		const toolDetails = work.querySelector('.cleanSlate-external-tool-details');
		toolDetails.querySelector('summary').click();
		check(toolDetails.open && toolDetails.textContent.includes('All checks passed.'), 'Tool output is inaccessible after import grouping');
		const answer = legacy.host.querySelector('[data-block-id="answer"]');
		const target = answer.closest('.cleanSlate-chat-message');
		const { coalesceExternalAgentTranscript } = await import('/sdk/externalAgents/externalAgentPresentation.js');
		const checkpoint = JSON.parse(coalesceExternalAgentTranscript(history)[1].renderPayload);
		const heading = work.querySelector('summary');
		heading.focus();
		for (let index = 0; index < 4; index++) legacy.renderer.renderJSONResponse(checkpoint, false, legacy.view.element, target);
		check(target.querySelector('.cleanSlate-work-summary') === work && work.open, 'Repeated checkpoints reset work expansion or replaced the disclosure');
		check(document.activeElement === heading && toolDetails.isConnected && toolDetails.open, 'Repeated checkpoints lost focus or tool expansion');
		check(target.querySelector('[data-block-id="answer"]') === answer, 'Repeated checkpoints replaced final answer markdown');

		const live = fixture();
		const liveTarget = live.view.addMessage('', 'cleanSlate');
		const progress = { id: 'live-progress', type: 'assistant_text', content: 'Checking the shell.', isStreaming: true };
		const tool = { id: 'live-tool', type: 'tool', content: 'Run checks', externalTool: true, toolStatus: 'running', isStreaming: true };
		live.renderer.renderJSONResponse({ timeline: [progress, tool] }, true, live.view.element, liveTarget);
		check(!live.host.querySelector('.cleanSlate-work-summary') && live.host.textContent.includes('Run checks'), 'Live work was prematurely collapsed');
		const final = { id: 'live-answer', type: 'assistant_text', content: 'The shell checks passed.\n\n', isStreaming: true };
		tool.toolStatus = 'completed'; tool.isStreaming = false; progress.isStreaming = false;
		for (let length = '<external_'.length; length <= marker.length; length++) {
			final.content = `The shell checks passed.\n\n${marker.slice(0, length)}`;
			live.renderer.renderJSONResponse({ timeline: [progress, tool, final] }, true, live.view.element, liveTarget);
			check(!live.host.textContent.includes('external_codex_apps_'), 'A streaming app marker flashed in the answer');
		}
		final.isStreaming = false;
		live.renderer.renderJSONResponse({ timeline: [progress, tool, final], transcriptStatus: 'completed' }, false, live.view.element, liveTarget);
		check(live.host.querySelectorAll('.cleanSlate-work-summary').length === 1, 'Live completion produced duplicate work summaries');
		check(live.host.querySelector('[data-block-id="live-answer"]').textContent.includes('shell checks passed'), 'Final text vanished with the app marker');
		const failed = { id: 'failed-tool', type: 'tool', content: 'Tests failed', externalTool: true, toolStatus: 'failed', status: 'failed', isStreaming: false };
		const interrupted = { id: 'cancelled-tool', type: 'tool', content: 'Build stopped', externalTool: true, status: 'interrupted', isStreaming: false };
		live.renderer.renderJSONResponse({ timeline: [progress, tool, failed, interrupted, final], transcriptStatus: 'interrupted' }, false, live.view.element, liveTarget);
		for (const id of ['failed-tool', 'cancelled-tool']) check(!live.host.querySelector(`[data-block-id="${id}"]`).closest('.cleanSlate-work-summary'), 'A failure or interruption was hidden in completed activity');

		const examples = fixture();
		examples.view.restore([textRow('example', `Example:\n\n\`\`\`xml\n${marker}\n\`\`\``)]);
		await new Promise(resolve => setTimeout(resolve, 100));
		check(examples.host.querySelector('pre')?.textContent.includes(marker), 'A documented marker was removed from a code example');
		check(!examples.host.querySelector('.cleanSlate-work-summary'), 'Text-only reply created a Worked disclosure');
		const empty = fixture();
		empty.view.restore([textRow('empty-marker', marker)]);
		check(empty.host.querySelectorAll('.cleanSlate-chat-message.cleanSlate').length === 0, 'Marker-only history left a blank assistant bubble');
		const { CleanSlateAgentManagerSessionMapper } = await import('/vs/workbench/contrib/cleanSlate/browser/agentManager/cleanSlateAgentManagerSessionMapper.js');
		const mapper = new CleanSlateAgentManagerSessionMapper();
		const mapped = mapper.toSessionSnapshot({ id: 'legacy-import', title: marker, history, savedAt: 1, updatedAt: 1 });
		check(mapped.title === 'Fix Store', 'Legacy app metadata still names the sidebar/tab');
		const { CleanSlateChatSessionProvider } = await import('/vs/workbench/contrib/cleanSlate/browser/chat/providers/cleanSlateChatSessionProvider.js');
		const provider = Object.create(CleanSlateChatSessionProvider.prototype);
		check(provider.deriveStableTitleText('', history) === 'Fix Store', 'An opened legacy chat derives its title from navigation metadata');

		const palette = fixture();
		const generic = document.head.appendChild(document.createElement('style'));
		generic.textContent = 'a, a:link, a:visited { color: #551a8b; }';
		document.documentElement.style.setProperty('--vscode-textLink-foreground', '#551a8b');
		document.documentElement.style.setProperty('--vscode-textLink-activeForeground', '#551a8b');
		palette.view.restore([textRow('links', 'Created the [Store backend merge request](http://cleanslate.test/).\n\nRead the [setup guide](https://example.com/docs).')]);
		const colors = [];
		for (const [foreground, background] of [['#ddd', '#242424'], ['#242424', '#fff'], ['#fff', '#000']]) {
			document.documentElement.style.setProperty('--vscode-foreground', foreground);
			document.documentElement.style.setProperty('--vscode-editor-background', background);
			palette.host.style.color = foreground; palette.host.style.backgroundColor = background;
			for (const link of palette.host.querySelectorAll('a')) {
				const style = getComputedStyle(link);
				const proseColor = getComputedStyle(link.parentElement).color;
				check(style.color === proseColor, `Chat links inherited the generic purple IDE/browser color: ${style.color}, expected ${proseColor}`);
				check(style.textDecorationLine === 'underline', 'Neutral links cannot be distinguished from prose');
				link.focus();
				check(getComputedStyle(link).outlineStyle === 'solid', 'Links have no keyboard focus indicator');
				colors.push(style.color);
			}
		}
		const output = palette.view.addMessage('', 'cleanSlate');
		palette.renderer.renderJSONResponse({ timeline: [{ id: 'tool-link', type: 'tool', content: 'Read docs', externalTool: true, toolStatus: 'completed', output: '[Store docs](https://example.com/store)' }], transcriptStatus: 'completed' }, false, palette.view.element, output);
		const outputLink = output.querySelector('.cleanSlate-tool-result a');
		check(getComputedStyle(outputLink).color === getComputedStyle(outputLink.parentElement).color, 'Expanded tool links still use generic purple');
		generic.remove();
		for (const instance of [legacy, live, examples, empty, palette]) { instance.view.clear(); instance.host.remove(); }
		return { legacyToolCount: 12, workSummaries: 1, preservedHistory: true, linkColors: colors };
	});
	assert.deepEqual(errors, []);
	assert.equal(result.workSummaries, 1);
	console.log('Passed: ACP import turn grouping, live/settled activity, output expansion and focus, visible failures, prose marker filtering and preserved code examples.', result);
} finally { await browser.close(); }
