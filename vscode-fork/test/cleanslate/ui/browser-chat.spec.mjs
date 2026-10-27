import { test, expect, expectUsable } from './fixtures.mjs';

test('keeps the project Side chat and its launcher separate from Browser chat', async ({ page }) => {
	await page.evaluate(async () => (await import('/qa/browser-fixtures.mjs')).mountIntegratedBrowserChat());
	await page.evaluate(() => { qa.manager.activeWorkspaceBrowserTabId = undefined; qa.manager.selectRightPaneTab('sideChat', true); });
	await expect(page.locator('.cleanSlate-agent-manager-right-title')).toHaveText('Side chat');
	await expect(page.locator('.cleanSlate-agent-manager-right-header')).toBeVisible();
	await expect(page.locator('.cleanSlate-agent-manager-right-tab-add')).toBeVisible();
	await expect(page.locator('.cleanSlate-chat-view-title')).toHaveCount(0);
	expect(await page.evaluate(() => qa.manager.sessionProvider.listBrowserChats().length)).toBe(0);
	expect(await page.evaluate(() => qa.manager.sessionProvider.sideChats.get(qa.manager.sideChatTranscriptSessionId).parentSessionId === qa.manager.sessionProvider.activeSession.id)).toBe(true);
	await page.locator('.cleanSlate-agent-manager-right-tab-add').click();
	await expect(page.locator('.cleanSlate-agent-manager-right-tab-add')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Side chat', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Browser chat', exact: true })).toHaveCount(0);
	await page.evaluate(() => qa.disposeBrowserChat());
});

test('uses the shared ACP picker, restores its agent, and confines host tools to the browser', async ({ page }) => {
	await page.evaluate(async () => (await import('/qa/browser-fixtures.mjs')).mountIntegratedBrowserChat());
	await page.getByRole('button', { name: 'Chat about this page' }).click();
	await page.getByRole('button', { name: 'Agent: CleanSlate', exact: true }).click();
	await page.getByRole('button', { name: 'QA ACP', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Agent: QA ACP', exact: true })).toBeVisible();
	await expect.poll(() => page.evaluate(() => qa.externalStarts.length)).toBeGreaterThan(0);
	const start = await page.evaluate(() => qa.externalStarts.at(-1));
	expect(start.cwd).toBeUndefined();
	expect(start.hostTools.tools.every(tool => tool.name.startsWith('browser_') || ['web_search', 'web_fetch', 'cleanslate_context'].includes(tool.name))).toBe(true);
	expect(start.hostTools.tools.map(tool => tool.name)).not.toContain('browser_upload');
	expect(await page.evaluate(() => qa.manager.sessionProvider.activeSession.externalAgent)).toBeUndefined();
	await page.getByPlaceholder('Ask anything', { exact: true }).fill('Summarize this browser page');
	await page.getByRole('button', { name: 'Send message', exact: true }).click();
	await expect(page.locator('.cleanSlate-chat-messages')).toContainText('ACP browser answer.');
	const prompt = await page.evaluate(() => qa.externalPrompts.at(-1).prompt);
	expect(prompt).toContain('Readable article');
	expect(prompt).toContain('concisely');
	for (const secret of ['PARENT_TASK_SECRET', '/project-private', 'cleanSlateWorkspaceBrowser.ts', 'same project']) { expect(prompt).not.toContain(secret); }
	await page.getByPlaceholder('Ask anything', { exact: true }).fill('ACP saved draft');
	await page.evaluate(() => qa.restartBrowserProvider());
	await expect(page.getByRole('button', { name: 'Agent: QA ACP', exact: true })).toBeVisible();
	await expect(page.getByPlaceholder('Ask anything', { exact: true })).toHaveValue('ACP saved draft');
	// Reject an unadvertised IDE tool before displaying any approval or dispatching it.
	await page.evaluate(() => { qa.acpHostTool = 'read_file'; });
	await page.getByPlaceholder('Ask anything', { exact: true }).fill('Read the page');
	await page.getByRole('button', { name: 'Send message', exact: true }).click();
	await expect.poll(() => page.evaluate(() => qa.externalHostResponses.at(-1)?.error)).toContain('unavailable');
	await expect(page.locator('.cleanSlate-command-approval')).not.toHaveClass(/visible/);
	// Browser access uses the same approval controls as the IDE chat panel.
	await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible();
	await page.evaluate(() => { qa.acpHostTool = 'browser_get_url'; });
	await page.getByPlaceholder('Ask anything', { exact: true }).fill('Read this tab URL');
	await page.getByRole('button', { name: 'Send message', exact: true }).click();
	await expect(page.locator('.cleanSlate-command-approval')).toHaveClass(/visible/);
	await page.locator('.cleanSlate-command-approval-submit').click();
	await expect.poll(() => page.evaluate(() => qa.externalHostResponses.at(-1)?.result?.url)).toBe('about:srcdoc');
	await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Agent: QA ACP', exact: true }).click();
	await page.locator('.cleanSlate-agent-choice').filter({ hasText: 'CleanSlate' }).click();
	await expect(page.getByRole('button', { name: 'Agent: CleanSlate', exact: true })).toBeVisible();
	await expect(page.locator('.cleanSlate-chat-messages')).toContainText('ACP browser answer.');
	await page.evaluate(() => qa.disposeBrowserChat());
});

test('opens chat beside the page and captures only readable text and the current selection', async ({ page }) => {
	await page.evaluate(async () => (await import('/qa/browser-fixtures.mjs')).mountBrowserChat());
	const chatButton = page.getByRole('button', { name: 'Chat about this page' });
	await expectUsable(chatButton);
	await chatButton.click();
	await expect(chatButton).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByRole('checkbox', { name: 'Include current page' })).toHaveCount(0);
	const context = await page.evaluate(async () => {
		const doc = qa.pageFrame.contentDocument;
		const range = doc.createRange();
		range.selectNodeContents(doc.getElementById('passage'));
		const selection = qa.pageFrame.contentWindow.getSelection();
		selection.removeAllRanges(); selection.addRange(range);
		return qa.readPage();
	});
	expect(context).toContain('Readable article');
	expect(context).toContain('"selection":"A selected passage for chat."');
	for (const secret of ['hidden secret', 'display secret', 'visibility secret', 'aria secret', 'password secret', 'form secret', 'choice secret']) {
		expect(context).not.toContain(secret);
	}

	await page.evaluate(() => qa.disposeBrowserChat());
});

test('refreshes current page text for each new message', async ({ page }) => {
	await page.evaluate(async () => (await import('/qa/browser-fixtures.mjs')).mountBrowserChat());
	await page.getByRole('button', { name: 'Chat about this page' }).click();
	const before = await page.evaluate(() => qa.readPage());
	await page.evaluate(() => { qa.pageFrame.contentDocument.getElementById('passage').textContent = 'The updated article is now visible.'; });
	const after = await page.evaluate(() => qa.readPage());
	expect(after).toContain('The updated article is now visible.');
	expect(after).not.toBe(before);

	await page.evaluate(() => qa.disposeBrowserChat());
});

test('renders the production Browser chat and isolates every model turn from the IDE and parent task', async ({ page }) => {
	await page.evaluate(async () => (await import('/qa/browser-fixtures.mjs')).mountIntegratedBrowserChat());
	await page.getByRole('button', { name: 'Chat about this page' }).click();
	await expectUsable(page.getByRole('button', { name: 'New Chat', exact: true }));
	await expect(page.locator('.cleanSlate-browser-chat-history-menu')).toHaveCount(0);
	await expect(page.locator('.cleanSlate-agent-manager-side-chat-host')).toHaveCount(0);
	await expect(page.locator('.cleanSlate-browser-chat-body > .cleanSlate-transcript-shell')).toHaveCount(1);
	await expect(page.locator('.cleanSlate-browser-chat-body > .cleanSlate-chat-input-container')).not.toHaveClass(/compact/);
	await expectUsable(page.getByRole('button', { name: 'Delete chat', exact: true }));
	await expect(page.locator('.cleanSlate-agent-manager-right-title')).toHaveText('Browser chat');
	await expect(page.locator('.cleanSlate-agent-manager-right-tab-add')).toHaveCount(0);
	await expect(page.locator('.cleanSlate-agent-manager-right-header')).toBeHidden();
	await expectUsable(page.getByRole('button', { name: 'Close browser chat', exact: true }));
	await page.getByPlaceholder('Ask anything', { exact: true }).fill('Summarize this page');
	await page.getByRole('button', { name: 'Send message', exact: true }).click();
	await expect(page.locator('.cleanSlate-chat-messages')).toContainText('The article describes a selected passage.');
	await expect(page.locator('.cleanSlate-chat-view-title-label')).toHaveText('Summarize this page');
	await page.getByPlaceholder('Ask anything', { exact: true }).fill('Explain the passage');
	await page.getByRole('button', { name: 'Send message', exact: true }).click();
	await expect.poll(() => page.evaluate(() => qa.requests.length)).toBe(2);
	const requests = await page.evaluate(() => qa.requests);
	for (const request of requests) {
		const prompt = JSON.stringify(request.messages);
		expect(prompt).toContain('Readable article');
		expect(prompt).toContain('concisely');
		for (const secret of ['PARENT_TASK_SECRET', '/project-private', 'cleanSlateWorkspaceBrowser.ts', '[WORKSPACE MEMORY]', '[JIT SEMANTIC']) { expect(prompt).not.toContain(secret); }
		expect(request.tools.every(tool => tool.name.startsWith('browser_') || ['web_search', 'web_fetch'].includes(tool.name))).toBe(true);
		expect(request.tools.map(tool => tool.name)).not.toContain('browser_upload');
	}
	const ids = await page.evaluate(() => qa.manager.sessionProvider.listBrowserChats().map(chat => chat.id));
	expect(await page.evaluate(ids => qa.published.some(update => ids.includes(update.session?.id)), ids)).toBe(false);
	await page.evaluate(() => qa.disposeBrowserChat());
});

test('preserves conversations and drafts through close, new chat, provider restart and confirmed deletion', async ({ page }) => {
	await page.evaluate(async () => (await import('/qa/browser-fixtures.mjs')).mountIntegratedBrowserChat());
	const toggle = page.getByRole('button', { name: 'Chat about this page' });
	await toggle.click();
	const input = page.getByPlaceholder('Ask anything', { exact: true });
	await input.fill('Remember the article');
	await page.getByRole('button', { name: 'Send message', exact: true }).click();
	await expect(page.locator('.cleanSlate-chat-messages')).toContainText('The article describes a selected passage.');
	await input.fill('Unsent browser draft');
	await page.locator('input[type="file"]').setInputFiles({ name: 'draft.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') });
	await expect(page.locator('.cleanSlate-image-preview')).toHaveCount(1);
	const first = await page.evaluate(() => qa.manager.sessionProvider.getBrowserChatId());
	await toggle.click(); await toggle.click();
	await expect(input).toHaveValue('Unsent browser draft');
	await page.getByRole('button', { name: 'New Chat', exact: true }).click();
	await expect(input).toHaveValue('');
	await expect(page.locator('.cleanSlate-image-preview')).toHaveCount(0);
	await expect(page.locator('.cleanSlate-chat-messages')).toHaveText('');
	await input.fill('Second saved draft');
	await page.getByRole('button', { name: 'History', exact: true }).click();
	await expect(page.locator('.cleanSlate-history-item')).toHaveCount(2);
	await page.locator('.cleanSlate-history-item').filter({ hasText: 'Remember the article' }).click();
	await expect(input).toHaveValue('Unsent browser draft');
	await page.evaluate(() => qa.restartBrowserProvider());
	await expect(input).toHaveValue('Unsent browser draft');
	await expect(page.locator('.cleanSlate-image-preview')).toHaveCount(1);
	await expect(page.locator('.cleanSlate-chat-messages')).toContainText('The article describes a selected passage.');
	expect(await page.evaluate(() => qa.manager.sessionProvider.getBrowserChatId())).toBe(first);
	await page.getByRole('button', { name: 'Delete chat', exact: true }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(input).toHaveValue('Unsent browser draft');
	await page.getByRole('button', { name: 'Delete chat', exact: true }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Delete chat' }).click();
	await page.getByRole('button', { name: 'History', exact: true }).click();
	await expect(page.locator('.cleanSlate-history-item')).toHaveCount(1);
	await page.keyboard.press('Escape');
	await page.evaluate(() => qa.restartBrowserProvider());
	expect(await page.evaluate(first => qa.manager.sessionProvider.listBrowserChats().some(chat => chat.id === first), first)).toBe(false);
	await page.evaluate(() => qa.disposeBrowserChat());
});

test('resizes the production panel without remounting, updates native bounds, and finishes on release or blur', async ({ page }) => {
	await page.evaluate(async () => (await import('/qa/browser-fixtures.mjs')).mountIntegratedBrowserChat());
	await page.getByRole('button', { name: 'Chat about this page' }).click();
	await page.getByPlaceholder('Ask anything', { exact: true }).fill('Draft survives resizing');
	await page.evaluate(() => {
		qa.originalInput = qa.manager.sideChatComposerView.getInputElement();
		qa.nativeLayouts.length = 0;
		qa.widthUpdates = 0;
		const setWidth = qa.manager.setRightPaneWidth.bind(qa.manager);
		qa.manager.setRightPaneWidth = (...args) => { qa.widthUpdates++; return setWidth(...args); };
		const handle = qa.manager.rightResizeHandle;
		handle.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 900, bubbles: true }));
		for (let index = 0; index < 30; index++) { window.dispatchEvent(new MouseEvent('mousemove', { clientX: 800 + index })); }
	});
	await expect.poll(() => page.evaluate(() => qa.nativeLayouts.length)).toBeGreaterThan(0);
	expect(await page.evaluate(() => qa.widthUpdates)).toBeLessThan(5);
	expect(await page.evaluate(() => qa.originalInput === qa.manager.sideChatComposerView.getInputElement())).toBe(true);
	await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup')));
	await expect(page.locator('#fixture')).not.toHaveClass(/resizing-right/);
	await expect(page.getByPlaceholder('Ask anything', { exact: true })).toHaveValue('Draft survives resizing');
	await page.evaluate(() => {
		qa.manager.rightResizeHandle.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
		window.dispatchEvent(new MouseEvent('mousemove', { clientX: 950 }));
		window.dispatchEvent(new Event('blur'));
	});
	await expect(page.locator('#fixture')).not.toHaveClass(/resizing-right/);
	await page.evaluate(() => { qa.manager.setRightPaneWidth(300, false); });
	for (const control of [page.getByRole('button', { name: 'New Chat', exact: true }), page.getByRole('button', { name: 'Delete chat', exact: true }), page.getByRole('button', { name: 'Send message', exact: true })]) { await expectUsable(control); }
	await expect(page.locator('.cleanSlate-browser-chat-context')).toHaveCount(0);
	const overflow = await page.locator('.cleanSlate-browser-chat-body').evaluate(element => element.scrollWidth - element.clientWidth);
	expect(overflow).toBeLessThanOrEqual(1);
	await page.screenshot({ path: 'test/cleanslate/results/browser-chat-narrow.png' });
	await page.evaluate(() => qa.disposeBrowserChat());
});

test('keeps a production response on its captured tab when the user switches pages mid-response', async ({ page }) => {
	await page.evaluate(async () => (await import('/qa/browser-fixtures.mjs')).mountIntegratedBrowserChat());
	await page.getByRole('button', { name: 'Chat about this page' }).click();
	const originalId = await page.evaluate(() => qa.browser.getActiveBrowserModel().id);
	await page.evaluate(() => { qa.holdReply = true; qa.modelScript = [{ tool: 'browser_get_url' }, { text: 'Read the original tab.' }]; });
	await page.getByPlaceholder('Ask anything', { exact: true }).fill('Read this tab URL');
	await page.getByRole('button', { name: 'Send message', exact: true }).click();
	await expect.poll(() => page.evaluate(() => !!qa.releaseReply)).toBe(true);
	const newId = await page.evaluate(async () => (await qa.browser.openTab('https://example.test/second')).id);
	await page.evaluate(() => { qa.holdReply = false; qa.releaseReply(); });
	await expect(page.locator('.cleanSlate-chat-messages')).toContainText('Read the original tab.');
	const toolMessages = await page.evaluate(() => qa.requests.at(-1).messages.filter(message => message.role === 'tool'));
	expect(JSON.stringify(toolMessages)).toContain(originalId);
	expect(JSON.stringify(toolMessages)).not.toContain(newId);
	expect(await page.evaluate(() => qa.browser.getActiveBrowserModel().id)).toBe(newId);
	await page.evaluate(() => { qa.pageFrame.contentDocument.getElementById('passage').textContent = 'Current page after switching tabs.'; });
	await page.getByPlaceholder('Ask anything', { exact: true }).fill('What does the current page say?');
	await page.getByRole('button', { name: 'Send message', exact: true }).click();
	await expect.poll(() => page.evaluate(() => JSON.stringify(qa.requests.at(-1)?.messages))).toContain('Current page after switching tabs.');
	await page.evaluate(() => qa.disposeBrowserChat());
});

// Native browser views cover DOM outside the chat. Check every editor picker
// against the pane bounds, including the reasoning popup shown in the report.
test('uses the editor history and keeps editor pickers inside the resized browser chat', async ({ page }) => {
	await page.evaluate(async () => (await import('/qa/browser-fixtures.mjs')).mountIntegratedBrowserChat());
	await page.getByRole('button', { name: 'Chat about this page' }).click();
	const chat = page.locator('.cleanSlate-browser-chat-body');
	await chat.getByPlaceholder('Ask anything', { exact: true }).fill('First saved draft');
	for (const width of [440, 300]) {
		await page.evaluate(width => qa.manager.setRightPaneWidth(width, false), width);
		await expect(chat).toHaveJSProperty('clientWidth', width);
		for (const [control, popup] of [
			['.reasoning-dropdown', '.cleanSlate-reasoning-effort-overlay'],
			['.model-dropdown', '.cleanSlate-model-selector-overlay'],
			['.cleanSlate-agent-dropdown', '.cleanSlate-agent-selector-overlay']
		]) {
			await chat.locator(control).click();
			const overlay = page.locator(popup);
			await expect(overlay).toBeVisible();
			const paneBounds = await chat.boundingBox();
			const popupBounds = await overlay.boundingBox();
			expect(popupBounds.x).toBeGreaterThanOrEqual(paneBounds.x);
			expect(popupBounds.x + popupBounds.width).toBeLessThanOrEqual(paneBounds.x + paneBounds.width);
			await expectUsable(overlay);
			await chat.locator('.cleanSlate-chat-view-title-label').click();
			await expect(overlay).toHaveCount(0);
		}
		await chat.getByRole('button', { name: 'History', exact: true }).click();
		const history = page.locator('.cleanSlate-history-overlay');
		await expect(history.getByPlaceholder('Search Agents...')).toBeVisible();
		await expect(history.locator('.cleanSlate-history-item')).toHaveCount(1);
		const paneBounds = await chat.boundingBox();
		const historyBounds = await history.boundingBox();
		expect(historyBounds.x).toBeGreaterThanOrEqual(paneBounds.x);
		expect(historyBounds.x + historyBounds.width).toBeLessThanOrEqual(paneBounds.x + paneBounds.width);
		await page.keyboard.press('Escape');
	}
	await chat.locator('.reasoning-dropdown').click();
	await page.evaluate(() => qa.manager.setRightPaneWidth(440, false));
	await expect(page.locator('.cleanSlate-reasoning-effort-overlay')).toHaveCount(0);
	await chat.locator('.reasoning-dropdown').click();
	await chat.getByRole('button', { name: 'Close browser chat', exact: true }).click();
	await expect(page.locator('.cleanSlate-reasoning-effort-overlay')).toHaveCount(0);
	await page.evaluate(() => qa.disposeBrowserChat());
});

test('does not save duplicate empty chats and keeps the editor input small until typing', async ({ page }) => {
	await page.evaluate(async () => (await import('/qa/browser-fixtures.mjs')).mountIntegratedBrowserChat());
	await page.getByRole('button', { name: 'Chat about this page' }).click();
	const chat = page.locator('.cleanSlate-browser-chat-body');
	const input = chat.getByPlaceholder('Ask anything', { exact: true });
	const first = await page.evaluate(() => qa.manager.sessionProvider.getBrowserChatId());
	for (let index = 0; index < 3; index++) { await chat.getByRole('button', { name: 'New Chat', exact: true }).click(); }
	expect(await page.evaluate(() => qa.manager.sessionProvider.getBrowserChatId())).toBe(first);
	await chat.getByRole('button', { name: 'History', exact: true }).click();
	await expect(page.locator('.cleanSlate-history-item')).toHaveCount(0);
	await page.keyboard.press('Escape');
	expect((await input.boundingBox()).height).toBeLessThan(40);
	await input.fill(Array.from({ length: 20 }, () => 'A long browser chat draft.').join('\n'));
	expect((await input.boundingBox()).height).toBeGreaterThan(100);
	await input.fill('');
	expect((await input.boundingBox()).height).toBeLessThan(40);
	await input.fill('Name this browser chat');
	await chat.getByRole('button', { name: 'Send message', exact: true }).click();
	await expect(chat.locator('.cleanSlate-chat-view-title-label')).toHaveText('Name this browser chat');
	await expect(chat.getByRole('button', { name: 'Send message', exact: true })).toBeVisible();
	await chat.getByRole('button', { name: 'New Chat', exact: true }).click();
	await chat.getByRole('button', { name: 'History', exact: true }).click();
	await expect(page.locator('.cleanSlate-history-item')).toHaveCount(1);
	await page.locator('.cleanSlate-history-item').click();
	await expect(chat.locator('.cleanSlate-chat-view-title-label')).toHaveText('Name this browser chat');
	await page.evaluate(() => qa.restartBrowserProvider());
	await chat.getByRole('button', { name: 'History', exact: true }).click();
	await expect(page.locator('.cleanSlate-history-item')).toHaveCount(1);
	await page.keyboard.press('Escape');
	await page.evaluate(() => qa.disposeBrowserChat());
});

test('restores the project tools layout and keeps browser panel width and conversation separate', async ({ page }) => {
	await page.evaluate(async () => (await import('/qa/browser-fixtures.mjs')).mountIntegratedBrowserChat());
	await page.evaluate(() => {
		qa.manager.activeWorkspaceBrowserTabId = undefined;
		qa.manager.selectRightPaneTab('sideChat', true);
		qa.manager.setRightPaneWidth(440, true);
	});
	await expect(page.locator('.cleanSlate-agent-manager-right-title')).toHaveText('Side chat');
	await page.evaluate(() => qa.manager.showWorkspaceBrowserTab(qa.browser.getActiveBrowserModel().id));
	await page.getByRole('button', { name: 'Chat about this page' }).click();
	await page.getByPlaceholder('Ask anything', { exact: true }).fill('Keep my browser draft');
	const id = await page.evaluate(() => qa.manager.sessionProvider.getBrowserChatId());
	await page.evaluate(() => qa.manager.setRightPaneWidth(300, true));
	await page.getByRole('button', { name: 'History', exact: true }).click();
	await page.evaluate(() => qa.manager.showThreadContent());
	await expect(page.locator('.cleanSlate-history-overlay')).toBeHidden();
	await expect(page.locator('.cleanSlate-agent-manager-right-title')).toHaveText('Side chat');
	await expect(page.locator('.cleanSlate-agent-manager-right-body')).not.toHaveClass(/editor-chat/);
	await expect(page.locator('.cleanSlate-agent-manager-right-pane')).toHaveJSProperty('clientWidth', 440);
	await expect(page.locator('.cleanSlate-browser-chat-body')).toHaveCount(0);
	await page.evaluate(() => qa.manager.showWorkspaceBrowserTab(qa.browser.getActiveBrowserModel().id));
	await expect(page.locator('#fixture')).toHaveClass(/right-pane-visible/);
	await expect(page.locator('.cleanSlate-agent-manager-right-pane')).toHaveJSProperty('clientWidth', 300);
	await expect(page.getByPlaceholder('Ask anything', { exact: true })).toHaveValue('Keep my browser draft');
	expect(await page.evaluate(() => qa.manager.sessionProvider.getBrowserChatId())).toBe(id);
	await page.evaluate(() => qa.disposeBrowserChat());
});

test('hides page chat on the new-tab screen and restores the editor layout after visiting Projects', async ({ page }) => {
	await page.evaluate(async () => (await import('/qa/browser-fixtures.mjs')).mountIntegratedBrowserChat());
	await page.getByRole('button', { name: 'Chat about this page' }).click();
	const chat = page.locator('.cleanSlate-browser-chat-body');
	const input = chat.getByPlaceholder('Ask anything', { exact: true });
	await input.fill('Remember this browser conversation');
	await chat.getByRole('button', { name: 'Send message', exact: true }).click();
	await expect(chat.locator('.cleanSlate-chat-messages')).toContainText('The article describes a selected passage.');
	await input.fill('Keep this draft');
	const first = await page.evaluate(() => ({ tab: qa.browser.activeTabId, chat: qa.manager.sessionProvider.getBrowserChatId() }));
	await page.evaluate(async () => {
		const id = await qa.browser.openTab();
		qa.manager.showWorkspaceBrowserTab(id);
	});
	await expect(page.locator('#fixture')).not.toHaveClass(/right-pane-visible/);
	await expect(chat).toBeHidden();
	await expect(page.getByRole('button', { name: 'Chat about this page' })).toBeDisabled();
	await page.evaluate(tab => qa.manager.showWorkspaceBrowserTab(tab), first.tab);
	await expect(chat).toBeVisible();
	await expect(input).toHaveValue('Keep this draft');
	for (let index = 0; index < 3; index++) {
		await page.evaluate(() => qa.manager.showThreadContent());
		await expect(page.locator('#fixture')).not.toHaveClass(/right-pane-visible/);
		await page.evaluate(tab => qa.manager.showWorkspaceBrowserTab(tab), first.tab);
		await chat.getByRole('button', { name: 'Close browser chat', exact: true }).click();
		await page.getByRole('button', { name: 'Chat about this page' }).click();
		await expect(page.locator('.cleanSlate-agent-manager-right-body')).toHaveClass(/editor-chat/);
		await expect(page.locator('.cleanSlate-agent-manager-right-body')).toHaveCSS('padding', '0px');
		await expect(input).toHaveValue('Keep this draft');
		await expect(chat.locator('.model-dropdown')).toContainText('QA Model');
		await expect(chat.getByRole('button', { name: 'Scroll to bottom', exact: true })).toBeHidden();
		expect((await input.boundingBox()).height).toBeLessThan(40);
	}
	expect(await page.evaluate(() => qa.manager.sessionProvider.getBrowserChatId())).toBe(first.chat);
	const fadeMatchesSurface = await chat.evaluate(element => getComputedStyle(element.querySelector('.cleanSlate-transcript-bottom-fade')).backgroundImage.includes(getComputedStyle(element).backgroundColor));
	expect(fadeMatchesSurface).toBe(true);
	await page.evaluate(() => qa.disposeBrowserChat());
});

for (const runtime of ['native', 'acp']) {
	test(`keeps the draft and conversation unchanged when the ${runtime} page is still loading`, async ({ page }) => {
		await page.evaluate(async () => (await import('/qa/browser-fixtures.mjs')).mountIntegratedBrowserChat());
		await page.getByRole('button', { name: 'Chat about this page' }).click();
		const chat = page.locator('.cleanSlate-browser-chat-body');
		if (runtime === 'acp') {
			await chat.getByRole('button', { name: 'Agent: CleanSlate', exact: true }).click();
			await page.getByRole('button', { name: 'QA ACP', exact: true }).click();
		}
		const input = chat.getByPlaceholder('Ask anything', { exact: true });
		await input.fill('Send this when ready');
		await page.evaluate(() => { qa.browser.getActiveBrowserModel().loading = true; });
		await chat.getByRole('button', { name: 'Send message', exact: true }).click();
		await expect.poll(() => page.evaluate(() => qa.notifications.at(-1))).toContain('finish loading');
		await expect(input).toHaveValue('Send this when ready');
		await expect(chat.locator('.cleanSlate-chat-messages')).toHaveText('');
		await expect(chat.locator('.cleanSlate-chat-view-title-label')).toHaveText('Browser chat');
		expect(await page.evaluate(() => qa.requests.length + qa.externalPrompts.length)).toBe(0);
		expect(await page.evaluate(() => qa.manager.sessionProvider.getSideChatTranscript(qa.manager.sessionProvider.getBrowserChatId()))).toEqual([]);
		await page.evaluate(() => { qa.browser.getActiveBrowserModel().loading = false; });
		await chat.getByRole('button', { name: 'Send message', exact: true }).click();
		await expect(chat.locator('.cleanSlate-chat-messages')).toContainText(runtime === 'acp' ? 'ACP browser answer.' : 'The article describes a selected passage.');
		await expect(chat.locator('.cleanSlate-chat-view-title-label')).toHaveText('Send this when ready');
		await page.evaluate(() => qa.disposeBrowserChat());
	});
}
