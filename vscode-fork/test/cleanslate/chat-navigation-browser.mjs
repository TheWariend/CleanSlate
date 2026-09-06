// Run after transpiling the transcript view: node test/cleanslate/chat-navigation-browser.mjs
// Optional baseline: pass the path to an older compiled CleanSlateTranscriptView.js.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { CleanSlateHostedAgentRuntime } from '../../../packages/cleanslate-sdk/dist/node/cleanSlateHostedAgentRuntime.js';

const activityUpdates = [];
const activityHost = new CleanSlateHostedAgentRuntime(() => ({
	configureRun: async () => {}, restoreSessionSnapshot() {}, getPendingQuestion() {}, dispose() {},
	getSessionSnapshot: () => ({ version: 1, threadHistory: [] }),
	async *run() {
		yield { type: 'assistant_turn_start', turnId: 'first', phase: 'execution' };
		yield { type: 'reasoning', content: 'Inspect the source first.' };
		yield { type: 'chat_text', content: 'Let me inspect the source.' };
		yield { type: 'tool_start', toolName: 'list_dir', toolCallId: 'dir', input: { path: 'src' } };
		yield { type: 'assistant_turn_complete', turnId: 'first', phase: 'execution' };
		yield { type: 'tool_result', toolName: 'list_dir', toolCallId: 'dir', result: { success: true } };
		yield { type: 'tool_start', toolName: 'read_file_range', toolCallId: 'read', input: { path: 'src/app.ts', start_line: 4, end_line: 8 } };
		yield { type: 'tool_result', toolName: 'read_file_range', toolCallId: 'read', result: { success: true } };
		yield { type: 'assistant_turn_start', turnId: 'second', phase: 'execution' };
		yield { type: 'reasoning', content: 'Now check the result.' };
		yield { type: 'reasoning_reset' };
		yield { type: 'chat_text', content: 'Now check the result.' };
	}
}), update => activityUpdates.push(update));
await activityHost.start({ session: { id: 'activity', title: 'Inspect', savedAt: 1, workDir: '/workspace', history: [] }, text: 'inspect', configuration: {} });
await activityHost.whenSettled('activity');
activityHost.dispose();
const activityPayloads = activityUpdates.flatMap(update => update.session.transcript.filter(message => message.renderPayload).map(message => JSON.parse(message.renderPayload)));
const afterSearch = activityPayloads.find(payload => payload.timeline.at(-1)?.status === 'Explored');
assert.ok(afterSearch, 'missing tool-completion checkpoint');
assert.equal(afterSearch.timeline.some(block => block.type === 'assistant_text' && block.isStreaming), false,
	'preceding assistant text must not steal the exploration continuation light');

const fork = new URL('../../', import.meta.url);
const viewPath = 'vs/workbench/contrib/cleanSlate/browser/chat/view/sections/cleanSlateTranscriptView.js';
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
				.cleanSlate-chat-messages { height: 600px; width: 800px; overflow: auto; }
				.cleanSlate-chat-message-row { padding: 12px; border-bottom: 1px solid #ddd; }
				.cleanSlate-chat-message { white-space: pre-wrap; }
				.cleanSlate-agent-manager-delete-chat { display: inline-block; width: 20px; height: 20px; }
				</style><div id="host"></div>` });
			return;
		}
		try {
			const file = url.searchParams.has('baseline') && process.argv[2]
				? process.argv[2]
				: fileURLToPath(url.pathname.startsWith('/sdk/')
					? new URL(`../packages/cleanslate-sdk/dist/${url.pathname.slice(5)}`, fork)
					: new URL(`out${url.pathname}`, fork));
			await route.fulfill({ contentType: 'text/javascript', body: await readFile(file, 'utf8') });
		} catch (error) {
			await route.fulfill({ status: 404, body: String(error) });
		}
	});
	await page.goto('http://cleanslate.test/');
	await page.evaluate(async () => {
		globalThis._VSCODE_FILE_ROOT = 'http://cleanslate.test/';
		const { CleanSlateComposerView } = await import('/vs/workbench/contrib/cleanSlate/browser/chat/view/sections/cleanSlateComposerView.js');
		const host = document.body.appendChild(document.createElement('div'));
		let submitted = 0;
		let stopped = 0;
		const composer = new CleanSlateComposerView(host, {
			mountPanels() {}, onSubmit() { submitted++; }, onStop() { stopped++; },
			onImageAdded() {}, onImageRemoved() {}, onReasoningSelector() {}, onPlanModeCommand() {},
			onPlanModeDisabled() {}, onModelSelector() {}
		});
		composer.setCommandApprovalPending(true);
		composer.setGenerating(true);
		host.querySelector('[aria-label="Stop generation"]').click();
		if (stopped !== 1 || submitted !== 0) { throw new Error('Stop submitted the pending approval'); }
		composer.setCommandApprovalPending(false);
		composer.setGenerating(false);
		host.querySelector('[aria-label="Send message"]').click();
		if (submitted !== 1) { throw new Error('Send no longer submits'); }
		host.remove();
	});
	await page.evaluate(async payloads => {
		const { CLEANSLATE_CHAT_STYLES } = await import('/vs/workbench/contrib/cleanSlate/browser/chat/styles/cleanSlateChatStyles.js');
		const styles = document.head.appendChild(document.createElement('style'));
		styles.textContent = CLEANSLATE_CHAT_STYLES;
		styles.textContent += ':root { --vscode-foreground: #ddd; --vscode-descriptionForeground: #999; }';
		const { CleanSlateTranscriptFileRenderer } = await import('/vs/workbench/contrib/cleanSlate/browser/chat/renderers/cleanSlateTranscriptFileRenderer.js');
		const opened = [];
		const renderer = new CleanSlateTranscriptFileRenderer({ read: () => [] }, { openEditor: (...args) => opened.push(args) }, {
			disposeMarkdownRender() {}, setMarkdownIfChanged() { return false; },
			setTrustedHtmlIfChanged(el, html) { el.innerHTML = html; return true; }
		});
		const el = document.body.appendChild(document.createElement('div'));
		const live = payloads.flatMap(payload => payload.timeline).find(block => block.status === 'Exploring...');
		el.classList.add('is-active');
		renderer.updateFileBlock(live, el, true);
		if (getComputedStyle(el).display === 'none' || !el.querySelector('.activity-group') || !el.textContent.includes('Exploring 1 search')) {
			throw new Error('Production hosted exploration is invisible in the original file renderer');
		}
		el.classList.remove('is-active');
		renderer.updateFileBlock(payloads.at(-1).timeline.find(block => block.type === 'file'), el, false);
		if (!el.textContent.includes('Analyzed 1 file, 1 search')) { throw new Error('Completed activity summary missing'); }
		el.querySelector('summary').click();
		if (!el.querySelector('details').open) { throw new Error('Activity disclosure does not expand'); }
		el.querySelector('.clickable-file').click();
		if (opened[0]?.[0]?.resource.fsPath !== '/workspace/src/app.ts' || opened[0]?.[0]?.options.selection.startLineNumber !== 4) {
			throw new Error('Read activity did not open the original file and line range');
		}
		el.remove();
		const { CleanSlateTranscriptRenderer } = await import('/vs/workbench/contrib/cleanSlate/browser/chat/renderers/cleanSlateTranscriptRenderer.js');
		const transcriptRenderer = new CleanSlateTranscriptRenderer({ read: () => [] }, {}, {
			render(markdown) { const element = document.createElement('div'); element.textContent = markdown.value; return { element, dispose() {} }; }
		}, {});
		const { CleanSlateTranscriptView } = await import('/vs/workbench/contrib/cleanSlate/browser/chat/view/sections/cleanSlateTranscriptView.js');
		const container = document.body.appendChild(document.createElement('div'));
		const restoredView = new CleanSlateTranscriptView(container, transcriptRenderer, () => {});
		const workerWait = { id: 'worker-wait', role: 'assistant', content: '', renderPayload: JSON.stringify({
			lastToolName: 'wait_worker', timeline: [{ id: 'wait', type: 'tool', toolName: 'wait_worker', toolStatus: 'running', isStreaming: true }]
		}) };
		restoredView.restore([workerWait], undefined, true);
		if (!container.textContent.includes('Waiting for child agent')) { throw new Error('Worker wait renders as Thinking'); }
		restoredView.clear();
		const edit = { id: 'hosted-edit-test', role: 'assistant', content: '', renderPayload: JSON.stringify({ timeline: [
			{ id: 'edit-tool', type: 'file', path: '/workspace/settings.dart', status: 'Editing...', isStreaming: true }
		] }) };
		restoredView.setLiveThinkingIndicator(true);
		restoredView.restore([edit], undefined, true);
		restoredView.setLiveThinkingIndicator(true);
		if (!container.querySelector('.cleanSlate-timeline-block.is-active') || container.querySelector('[data-clean-slate-live-thinking="true"]')) {
			throw new Error('Agent Manager added fallback Thinking alongside the restored active edit');
		}
		restoredView.restore([edit], undefined, true);
		restoredView.setLiveThinkingIndicator(true);
		if (container.querySelector('[data-clean-slate-live-thinking="true"]')) { throw new Error('Repeated checkpoint recreated Thinking'); }
		restoredView.clear();
		restoredView.setLiveThinkingIndicator(true);
		if (!container.querySelector('[data-clean-slate-live-thinking="true"]')) { throw new Error('Waiting state lost its fallback'); }
		restoredView.setLiveThinkingIndicator(false);
		if (container.querySelector('[data-clean-slate-live-thinking="true"]')) { throw new Error('Stopped run retained fallback'); }
		restoredView.clear();
		const liveCheckpoint = payload => [{ id: 'hosted-live-animation', role: 'assistant', content: '', renderPayload: JSON.stringify(payload) }];
		const liveReasoning = payloads.find(payload => payload.timeline.some(block => block.type === 'reasoning' && block.isStreaming));
		const submitted = { id: 'animation-user', role: 'user', content: 'inspect' };
		restoredView.restore([submitted], undefined, true);
		restoredView.restore([submitted, ...liveCheckpoint(liveReasoning)], undefined, true);
		const entering = container.querySelector('.cleanSlate-timeline-block.is-entering');
		if (!entering || getComputedStyle(entering).animationName !== 'cleanSlateBlockIn') { throw new Error('First live block skipped its entrance animation'); }
		await new Promise(resolve => setTimeout(resolve, 250));
		restoredView.restore([submitted, ...liveCheckpoint(liveReasoning)], undefined, true);
		if (container.querySelector('.cleanSlate-timeline-block') !== entering || entering.classList.contains('is-entering')) { throw new Error('Streaming update restarted the block entrance'); }
		restoredView.clear();
		restoredView.restore(liveCheckpoint(liveReasoning), undefined, true);
		if (container.querySelector('.is-entering')) { throw new Error('Reopening a chat replayed live entry animations'); }
		await new Promise(resolve => requestAnimationFrame(resolve));
		const restoredThought = container.querySelector('.cleanSlate-reasoning-block');
		if (!restoredThought || restoredThought.classList.contains('is-collapsed') || !restoredThought.textContent.includes('Inspect the source first.')) {
			throw new Error('Agent Manager restore lost expanded live reasoning');
		}
		const liveTool = payloads.find(payload => payload.timeline.some(block => block.status === 'Exploring...'));
		// Reopening a running chat between tools must retain the original
		// exploration continuation light even though no individual tool is running.
		const betweenTools = payloads.find(payload => payload.timeline.at(-1)?.status === 'Explored');
		restoredView.clear();
		restoredView.restore(liveCheckpoint(betweenTools), undefined, true);
		const continuation = container.querySelector('.cleanSlate-timeline-block.is-active .cleanSlate-activity-label');
		if (!continuation || getComputedStyle(continuation).animationName !== 'cleanSlate-working-sheen') { throw new Error('Running chat lost exploration continuation light between tools on full restore'); }
		restoredView.restore(liveCheckpoint(betweenTools), undefined, false);
		if (container.querySelector('.cleanSlate-timeline-block.is-active')) { throw new Error('Completed chat kept exploration light'); }
		restoredView.clear();
		restoredView.restore(liveCheckpoint(liveReasoning), undefined, true);
		const reopenedThought = container.querySelector('.cleanSlate-reasoning-block');
		restoredView.restore(liveCheckpoint(liveTool), undefined, true);
		const restoredLabel = container.querySelector('.cleanSlate-timeline-block.is-active .cleanSlate-activity-label');
		if (!restoredLabel || getComputedStyle(restoredLabel).animationName !== 'cleanSlate-working-sheen') { throw new Error('Agent Manager restore lost active-tool shimmer'); }
		if (container.querySelector('.cleanSlate-reasoning-block') !== reopenedThought) { throw new Error('Live checkpoint replaced the reasoning DOM'); }
		restoredView.clear();
		container.remove();
		const thinking = document.body.appendChild(document.createElement('div'));
		const assistant = thinking.appendChild(document.createElement('div'));
		assistant.className = 'cleanSlate-chat-message cleanSlate';
		const first = payloads.find(payload => payload.timeline.some(block => block.type === 'reasoning' && block.isStreaming));
		transcriptRenderer.renderJSONResponse(first, true, thinking);
		await new Promise(resolve => requestAnimationFrame(resolve));
		if (!thinking.querySelector('.cleanSlate-reasoning-block.is-streaming') || !thinking.textContent.includes('Thinking')) { throw new Error('Initial thinking did not stream'); }
		const liveThought = thinking.querySelector('.cleanSlate-reasoning-block');
		if (liveThought.classList.contains('is-collapsed') || getComputedStyle(liveThought.querySelector('.cleanSlate-reasoning-body')).display === 'none'
			|| !liveThought.textContent.includes('Inspect the source first.')) { throw new Error('Live thought body was not visibly expanded'); }
		const tools = payloads.find(payload => payload.timeline.some(block => block.status === 'Exploring...'));
		transcriptRenderer.renderJSONResponse(tools, true, thinking);
		const activeLabel = thinking.querySelector('.cleanSlate-timeline-block.is-active .cleanSlate-activity-label');
		if (!activeLabel || getComputedStyle(activeLabel).animationName !== 'cleanSlate-working-sheen') { throw new Error('Original active-tool sheen is missing'); }
		const beforePosition = getComputedStyle(activeLabel).backgroundPosition;
		await new Promise(resolve => setTimeout(resolve, 150));
		if (getComputedStyle(activeLabel).backgroundPosition === beforePosition) { throw new Error('Tool sheen is not moving'); }
		await new Promise(resolve => setTimeout(resolve, 1900));
		const thought = thinking.querySelector('.cleanSlate-reasoning-block');
		if (!thought?.classList.contains('is-collapsed') || thought.classList.contains('is-streaming') || !thinking.textContent.includes('Thought briefly')) {
			throw new Error('Thinking did not settle and collapse when tool work started');
		}
		if (!thinking.textContent.includes('Exploring 1 search')) { throw new Error('Model-turn completion prematurely settled running tools'); }
		const second = payloads.find(payload => payload.timeline.some(block => block.id === 'reasoning-second'));
		transcriptRenderer.renderJSONResponse(second, true, thinking);
		if (thinking.querySelectorAll('.cleanSlate-reasoning-block').length !== 2) { throw new Error('Second thought replaced the first'); }
		transcriptRenderer.renderJSONResponse(payloads.at(-1), false, thinking);
		if (thinking.querySelectorAll('.cleanSlate-reasoning-block').length !== 1) { throw new Error('Promoted reasoning left a duplicate thought'); }
		transcriptRenderer.disposeMarkdownRenders();
		thinking.remove();
		styles.remove();
	}, activityPayloads);
	console.log('Passed: real hosted events render visible Exploring disclosure, completion, expansion and file navigation.');
	await page.evaluate(async () => {
		const { CleanSlateHistoryOverlayRenderer } = await import('/vs/workbench/contrib/cleanSlate/browser/chat/renderers/cleanSlateHistoryOverlayRenderer.js');
		let delegate, listeners;
		const popup = document.body.appendChild(document.createElement('div'));
		let hides = 0;
		const renderer = new CleanSlateHistoryOverlayRenderer({
			showContextView(next) { delegate = next; listeners = next.render(popup); },
			hideContextView() { hides++; listeners?.dispose(); popup.replaceChildren(); delegate?.onHide(); }
		});
		const anchor = document.getElementById('host');
		const data = { activeSessionId: undefined, workspaceName: 'Test', sessions: [{ id: 'old', title: 'Old chat', history: [] }] };
		for (let cycle = 0; cycle < 2; cycle++) {
			renderer.show(anchor, data, { onRestore() {}, onRemove() {} });
			if (!document.querySelector('.cleanSlate-history-search')) { throw new Error('History did not open'); }
			anchor.hidden = true;
			renderer.hide(); // Panel visibility/disposal cleanup.
			renderer.refresh(data);
			if (renderer.isVisible() || document.querySelector('.cleanSlate-history-overlay')) { throw new Error('History leaked after panel close'); }
			const before = hides;
			renderer.hide();
			if (hides !== before) { throw new Error('Hidden history dismissed an unrelated context view'); }
			anchor.hidden = false;
		}
		popup.remove();
	});
	console.log('Passed: history popup cleanup, refresh after close, reopen, and shared context-view ownership.');
	await page.evaluate(async viewPath => {
		const { CleanSlateTranscriptView } = await import(`/${viewPath}`);
		const host = document.getElementById('host');
		const view = new CleanSlateTranscriptView(host, { disposeMarkdownRenders() {} }, () => {});
		const { CleanSlateMessageSubmitController } = await import('/vs/workbench/contrib/cleanSlate/browser/chat/viewModel/cleanSlateMessageSubmitController.js');
		const recorded = [], sent = [];
		const submit = new CleanSlateMessageSubmitController({
			getActiveSessionId: () => 'task',
			recordTranscriptMessage: message => recorded.push({ ...message, id: 'card-continue' }),
			sendMessage: async text => { sent.push(text); }
		}, {}, { getRenderer: () => ({ addMessage() { throw new Error('Card continuation rendered a user bubble'); } }),
			onUpdateTitle() {} });
		let continuation;
		view.addModelTerminated('Stopped', () => { continuation = submit.sendSynthetic('continue'); });
		const button = host.querySelector('.cleanSlate-model-continue-button');
		button.click();
		button.click();
		await continuation;
		if (sent.length !== 1 || sent[0] !== 'continue' || recorded[0]?.isInternalState !== true) {
			throw new Error('Continue card must send one explicitly internal continuation');
		}
		for (const live of [true, false]) {
			view.restore(JSON.parse(JSON.stringify(recorded)), undefined, live);
			if (host.textContent.includes('continue')) { throw new Error('Card continuation leaked after restore'); }
		}
		for (const live of [true, false, true]) {
			view.restore([{ id: 'typed-continue', role: 'user', content: 'continue' }], undefined, live);
			if (!host.textContent.includes('continue')) { throw new Error('Typed continue disappeared during transcript restore'); }
		}
		view.restore([{ role: 'user', content: 'continue', isInternalState: true }]);
		if (host.textContent.includes('continue')) { throw new Error('Explicit internal turn became visible'); }
		const message = { id: 'hosted-error-quota', role: 'assistant', content: "429 You've reached your weekly usage limit. It resets 3 days from now, or add credits to keep going." };
		for (const live of [true, false]) {
			view.restore([message], undefined, live);
			const cards = host.querySelectorAll('.cleanSlate-quota-card');
			if (cards.length !== 1 || !cards[0].textContent.includes('resets 3 days')) {
				throw new Error('Hosted quota error must restore the existing card and reset information');
			}
		}
		view.restore([{ ...message, content: 'Connection refused' }]);
		if (host.querySelector('.cleanSlate-quota-card')) { throw new Error('Ordinary errors must not become quota cards'); }
		view.clear();
	}, viewPath);
	console.log('Passed: hosted weekly-limit card, reset detail, reconnect/restore, ordinary error classification.');
	const results = await page.evaluate(async ({ viewPath, baseline }) => {
		const results = [];
		for (const version of baseline ? ['baseline', 'current'] : ['current']) {
			const { CleanSlateTranscriptView } = await import(`/${viewPath}${version === 'baseline' ? '?baseline' : ''}`);
			const host = document.getElementById('host');
			host.replaceChildren();
			const view = new CleanSlateTranscriptView(host, { disposeMarkdownRenders() { } }, () => { });
			const history = Array.from({ length: 600 }, (_, index) => ({
				id: `message-${index}`,
				role: index % 2 ? 'assistant' : 'user',
				content: `Message ${index}: ${'Conversation content with several wrapped lines. '.repeat(12)}`
			}));
			let heightReads = 0;
			const heightGetter = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight').get;
			Object.defineProperty(view.element, 'scrollHeight', { get() { heightReads++; return heightGetter.call(this); } });
			const timings = [];
			let maxHeightReads = 0;
			for (let run = 0; run < 4; run++) {
				heightReads = 0;
				const start = performance.now();
				view.restore(history);
				timings.push(performance.now() - start);
				maxHeightReads = Math.max(maxHeightReads, heightReads);
				if (view.element.querySelectorAll('.cleanSlate-chat-message').length !== history.length) {
					throw new Error('Restoration lost or duplicated messages');
				}
				if (Math.abs(view.element.scrollHeight - view.element.clientHeight - view.element.scrollTop) > 2) {
					throw new Error('Restored conversation did not land at the bottom');
				}
				await new Promise(requestAnimationFrame);
			}
			view.addMessage('A new user message', 'user');
			if (Math.abs(view.element.scrollHeight - view.element.clientHeight - view.element.scrollTop) > 2) {
				throw new Error('Live user message no longer scrolls immediately');
			}
			view.element.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
			view.element.scrollTop = 0;
			view.addMessage('A streamed reply', 'cleanSlate');
			await new Promise(requestAnimationFrame);
			if (view.element.scrollTop !== 0) {
				throw new Error('Streaming interrupted manual scrolling');
			}
			results.push({ version, messages: history.length, maxHeightReads, medianMs: timings.sort((a, b) => a - b)[2] });
			view.clear();
		}
		return results;
	}, { viewPath, baseline: !!process.argv[2] });
	console.table(results);
	assert.ok(results.find(result => result.version === 'current').maxHeightReads < 20,
		'Restoration must batch layout reads independently of message count');
	console.log('Passed: repeated restores, bounded layout reads, bottom position, live messages, manual scrolling.');
	await page.evaluate(async viewPath => {
		const { CleanSlateTranscriptView } = await import(`/${viewPath}`);
		const host = document.getElementById('host');
		host.replaceChildren();
		const renders = [];
		const view = new CleanSlateTranscriptView(host, {
			disposeMarkdownRenders() { },
			renderJSONResponse(data, streaming) { renders.push({ data, streaming }); }
		}, () => { });
		const history = [{ role: 'assistant', content: '', renderPayload: JSON.stringify({
			timeline: [{ id: 'answer', type: 'assistant_text', content: 'Working', isStreaming: true }]
		}) }];
		view.restore(history, undefined, true);
		if (!renders.at(-1)?.streaming || renders.at(-1)?.data.timeline[0].isStreaming !== true) {
			throw new Error('Live IDE handoff incorrectly settled the running transcript');
		}
		view.restore(history);
		if (renders.at(-1)?.streaming || renders.at(-1)?.data.timeline[0].isStreaming !== false) {
			throw new Error('Saved history incorrectly revived a stale stream');
		}
		view.clear();
	}, viewPath);
	console.log('Passed: live handoff preserves streaming; saved history remains settled.');
	await page.evaluate(async viewPath => {
		const { CleanSlateTranscriptView } = await import(`/${viewPath}`);
		const host = document.getElementById('host');
		host.replaceChildren();
		const view = new CleanSlateTranscriptView(host, {
			disposeMarkdownRenders() { },
			renderJSONResponse(data, _streaming, _container, target) { target.textContent = data.timeline.map(block => block.content || '').join('\n'); }
		}, () => { });
		const history = Array.from({ length: 100 }, (_, index) => ({ id: `old-${index}`, role: 'user', content: 'Existing history '.repeat(20) }));
		const tail = content => ({ id: 'hosted-run', role: 'assistant', content: '', renderPayload: JSON.stringify({
			timeline: [{ id: 'answer', type: 'assistant_text', content, isStreaming: true }]
		}) });
		view.restore([...history, tail('Working')], undefined, true);
		const first = view.element.querySelector('.cleanSlate-chat-message');
		const response = view.element.querySelector('[data-clean-slate-transcript-id="hosted-run"]');
		view.element.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
		view.element.scrollTop = 0;
		view.restore([...history, tail('Still working after handoff')], undefined, true);
		await new Promise(requestAnimationFrame);
		if (view.element.querySelector('.cleanSlate-chat-message') !== first || !response.isConnected) {
			throw new Error('Hosted progress rebuilt existing messages');
		}
		if (view.element.scrollTop !== 0 || response.textContent !== 'Still working after handoff') {
			throw new Error('Hosted progress disturbed manual scrolling or lost content');
		}
		view.clear();
	}, viewPath);
	console.log('Passed: hosted progress updates the existing response and preserves manual scrolling.');

	await page.evaluate(async () => {
		const { CleanSlateAgentManagerSidebarView } = await import('/vs/workbench/contrib/cleanSlate/browser/agentManager/cleanSlateAgentManagerSidebarView.js');
		const host = document.getElementById('host');
		host.replaceChildren();
		const sidebar = new CleanSlateAgentManagerSidebarView(host);
		const entry = { id: 'workspace', label: 'Workspace' };
		const selected = [];
		const deleted = [];
		const options = {
			groups: [{ id: entry.id, label: entry.label, entry, sessions: [
				{ id: 'a', title: 'Chat A' }, { id: 'b', title: 'Chat B' }
			] }],
			filter: '', activeSessionId: 'a', selectedWorkspaceKey: entry.id,
			getGroupEntry: group => group.entry, getWorkspaceEntryKey: entry => entry.id,
			isRunningSession: () => false, onSelectWorkspace() { }, onNewChatForWorkspace() { },
			onPrefetchSessions() { }, onShowProjectActions() { },
			onRestoreSession: session => selected.push(session.title),
			onDeleteSession: session => deleted.push(session.id)
		};
		sidebar.render(options);
		window.sidebarTest = { sidebar, options, selected, deleted };
	});
	const chat = page.locator('button[data-session-id="b"] .session-title');
	await chat.hover();
	await page.mouse.down();
	// Model a session update arriving between the press and release of one click.
	await page.evaluate(() => {
		const { sidebar, options } = window.sidebarTest;
		options.groups[0].sessions[1] = { id: 'b', title: 'Updated chat B' };
		sidebar.render(options);
	});
	await page.mouse.up();
	assert.deepEqual(await page.evaluate(() => window.sidebarTest.selected), ['Updated chat B'],
		'A background sidebar refresh must not swallow the first click or use stale session data');
	await page.locator('button[data-session-id="b"] .cleanSlate-agent-manager-delete-chat').click();
	assert.deepEqual(await page.evaluate(() => window.sidebarTest.deleted), ['b']);
	assert.equal(await page.evaluate(() => window.sidebarTest.selected.length), 1, 'Delete must not open the chat');
	await page.locator('button[data-session-id="b"]').focus();
	await page.evaluate(() => {
		const { sidebar, options } = window.sidebarTest;
		sidebar.render(options);
	});
	assert.equal(await page.evaluate(() => document.activeElement?.dataset.sessionId), 'b', 'Refresh must preserve keyboard focus');
	await page.keyboard.press('Enter');
	assert.equal(await page.evaluate(() => window.sidebarTest.selected.length), 2, 'Keyboard activation must still work');
	const updatedIds = await page.evaluate(() => {
		const { sidebar, options } = window.sidebarTest;
		options.groups[0].sessions = [{ id: 'b', title: 'Chat B' }, { id: 'c', title: 'New chat C' }];
		sidebar.render(options);
		return Array.from(document.querySelectorAll('button[data-session-id]'), button => button.dataset.sessionId);
	});
	assert.deepEqual(updatedIds, ['b', 'c'], 'Refresh must remove deleted chats and insert new ones in order');
	await page.evaluate(() => {
		const { sidebar, options } = window.sidebarTest;
		sidebar.render({ ...options, groups: [], filter: 'missing' });
	});
	assert.equal(await page.locator('button[data-session-id]').count(), 0);
	await page.evaluate(() => {
		const { sidebar, options } = window.sidebarTest;
		sidebar.render(options);
	});
	assert.equal(await page.locator('button[data-session-id]').count(), 2);
	console.log('Passed: single-click navigation across refreshes, fresh session data, delete, keyboard focus/activation, additions/removals, filtering.');
} finally {
	await browser.close();
}
