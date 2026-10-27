import { test, expect, expectUsable } from './fixtures.mjs';

async function runImport(page, scenario) {
	return page.evaluate(async scenario => {
		const { showCleanSlateChatImport } = await import('/vs/workbench/contrib/cleanSlate/browser/settings/cleanSlateChatImport.js');
		const { URI } = await import('/vs/base/common/uri.js');
		const events = [];
		let picks = 0;
		let cancel;
		const entries = ['existing', 'first', 'second'].map(id => ({ id, source: 'codex', sessionId: `native-${id}`, dataHome: '/accounts/second', path: `/accounts/second/sessions/rollout-${id}.jsonl`, title: id, cwd: '/projects/app', createdAt: 1, updatedAt: 1 }));
		const services = {
			cleanSlateMainService: {
				discoverExternalAgentHistory: async query => { events.push(['scan', query]); return { sessions: scenario === 'empty' ? [] : entries, warnings: [] }; },
				listThreadSessions: async () => [{ id: 'existing' }],
				importExternalAgentHistory: async entry => {
					events.push(['import', entry.id]);
					if (scenario === 'partial' && entry.id === 'first') { throw new Error('Unreadable history'); }
					if (scenario === 'cancel-progress') { cancel(); }
					return { id: entry.id, imported: true, warnings: [] };
				}
			},
			quickInputService: { pick: async (items, options) => {
				picks++;
				if (picks === 1) { return scenario === 'cancel-source' ? undefined : items.find(item => item.source === (scenario === 'claude-default' ? 'claude' : 'codex') && item.custom === (scenario !== 'claude-default')); }
				events.push(['choices', items.map(item => item.entry.id), options.canPickMany]);
				events.push(['picker-options', options.placeHolder, items.map(item => item.detail)]);
				return scenario === 'cancel-selection' ? undefined : items;
			} },
			fileDialogService: { showOpenDialog: async () => { events.push(['folder-picker']); return scenario === 'cancel-folder' ? undefined : [URI.file('/accounts/second')]; } },
			notificationService: Object.fromEntries(['info', 'warn', 'error'].map(kind => [kind, value => events.push([kind, value])])),
			progressService: { withProgress: async (_options, run, onCancel) => { cancel = onCancel; return run({ report() {} }); } }
		};
		await showCleanSlateChatImport({ get: id => { const service = services[String(id)]; if (!service) { throw new Error(`Missing ${id}`); } return service; } }, scenario === 'project' ? '/projects/app' : undefined);
		return events;
	}, scenario);
}

test('custom account import filters duplicates and uses the chosen local folder', async ({ page }) => {
	const events = await runImport(page, 'success');
	expect(events.find(event => event[0] === 'scan')[1]).toEqual({ source: 'codex', dataHome: '/accounts/second' });
	expect(events.find(event => event[0] === 'choices')).toEqual(['choices', ['first', 'second'], true]);
	expect(events.filter(event => event[0] === 'import')).toEqual([['import', 'first'], ['import', 'second']]);
	expect(events.at(-1)[1]).toContain('Imported 2 chats');
});

test('project import retains the project filter when choosing another account', async ({ page }) => {
	const events = await runImport(page, 'project');
	expect(events.find(event => event[0] === 'scan')[1]).toEqual({ source: 'codex', dataHome: '/accounts/second', projectRoot: '/projects/app' });
	const picker = events.find(event => event[0] === 'picker-options');
	expect(picker[1]).toBe('Search chats');
	expect(picker[2].every(detail => detail.startsWith('app · ') && !detail.includes('/projects'))).toBe(true);
});

test('choosing Claude scans the default account without opening a folder picker', async ({ page }) => {
	const events = await runImport(page, 'claude-default');
	expect(events.find(event => event[0] === 'scan')[1]).toEqual({ source: 'claude' });
	expect(events.some(event => event[0] === 'folder-picker')).toBe(false);
	expect(events.filter(event => event[0] === 'import')).toHaveLength(2);
});

test('project opening asks for trust before import, shares prompts, and stops on declined trust', async ({ page }) => {
	const result = await page.evaluate(async () => {
		const { prepareCleanSlateProject } = await import('/vs/workbench/contrib/cleanSlate/browser/settings/cleanSlateProjectOpen.js');
		const { URI } = await import('/vs/base/common/uri.js');
		const events = [];
		let grantTrust = false;
		const saved = new Map();
		const services = {
			storageService: { getBoolean: key => saved.get(key) === true, store: (key, value) => saved.set(key, value) },
			workspaceTrustManagementService: { workspaceTrustInitialized: Promise.resolve(), getUriTrustInfo: async () => ({ trusted: false }), isWorkspaceTrusted: () => true },
			workspaceTrustEnablementService: { isWorkspaceTrustEnabled: () => true },
			workspaceTrustRequestService: {
				requestResourcesTrust: async ({ uri }) => { events.push(['trust', uri.fsPath]); return grantTrust; },
				requestWorkspaceTrust: async () => { events.push(['workspace-trust']); return true; }
			},
			dialogService: { confirm: async () => { events.push(['import-prompt']); return { confirmed: true }; } },
			notificationService: { error: error => events.push(['error', error]) },
			instantiationService: { invokeFunction: async (_fn, project) => events.push(['import', project]) }
		};
		const accessor = { get: id => services[String(id)] };
		const uri = URI.file('/projects/app');
		const declined = await prepareCleanSlateProject(accessor, uri);
		const afterDecline = [...events];
		grantTrust = true;
		await Promise.all([prepareCleanSlateProject(accessor, uri), prepareCleanSlateProject(accessor, uri)]);
		await prepareCleanSlateProject(accessor, uri, true);
		return { declined, afterDecline, events };
	});
	expect(result.declined).toBe(false);
	expect(result.afterDecline).toEqual([['trust', '/projects/app']]);
	expect(result.events.filter(event => event[0] === 'import-prompt')).toHaveLength(1);
	expect(result.events.filter(event => event[0] === 'import')).toEqual([['import', '/projects/app']]);
	expect(result.events.at(-1)).toEqual(['workspace-trust']);
});

test('Agent Manager folder clicks expose usable trust and import dialogs and complete switching', async ({ page }) => {
	await page.evaluate(async () => {
		await import('/qa/browser-fixtures.mjs');
		const { Dialog } = await import('/vs/base/browser/ui/dialog/dialog.js');
		const { prepareCleanSlateProject } = await import('/vs/workbench/contrib/cleanSlate/browser/settings/cleanSlateProjectOpen.js');
		const { URI } = await import('/vs/base/common/uri.js');
		const host = document.getElementById('fixture');
		host.className = 'monaco-workbench cleanSlate-agent-manager-host-active';
		const editor = host.appendChild(document.createElement('div'));
		editor.className = 'part editor';
		editor.textContent = 'Hidden IDE editor';
		const manager = host.appendChild(document.createElement('div'));
		manager.className = 'cleanSlate-agent-manager-surface';
		const folder = manager.appendChild(document.createElement('button'));
		folder.textContent = 'Other project';
		folder.style.cssText = 'width:180px;height:40px;margin:40px';
		const trusted = new Set();
		const saved = new Map();
		globalThis.projectSwitches = 0;
		const show = async (message, buttons) => {
			const dialog = new Dialog(host, message, buttons, { cancelId: 1, type: 'info', buttonStyles: {}, checkboxStyles: {}, inputBoxStyles: {}, dialogStyles: { dialogBackground: '#333', dialogForeground: '#fff' } });
			try { return (await dialog.show()).button === 0; } finally { dialog.dispose(); }
		};
		const services = {
			storageService: { getBoolean: key => saved.get(key) === true, store: (key, value) => saved.set(key, value) },
			workspaceTrustManagementService: { workspaceTrustInitialized: Promise.resolve(), getUriTrustInfo: async uri => ({ trusted: trusted.has(uri.toString()) }), isWorkspaceTrusted: () => true },
			workspaceTrustEnablementService: { isWorkspaceTrustEnabled: () => true },
			workspaceTrustRequestService: { requestResourcesTrust: async ({ uri }) => {
				if (trusted.has(uri.toString())) { return true; }
				if (!await show('Do you trust this project?', ['Trust Folder & Continue', 'Cancel'])) { return false; }
				trusted.add(uri.toString()); return true;
			} },
			dialogService: { confirm: async options => ({ confirmed: await show(options.message, [options.primaryButton, options.cancelButton]) }) },
			notificationService: { error: error => { throw new Error(error); } },
			instantiationService: { invokeFunction: async () => {} }
		};
		folder.onclick = async () => {
			if (await prepareCleanSlateProject({ get: id => services[String(id)] }, URI.file('/projects/other'))) { globalThis.projectSwitches++; }
		};
	});
	const folder = page.getByRole('button', { name: 'Other project', exact: true });
	await folder.click();
	const trust = page.getByRole('button', { name: 'Trust Folder & Continue', exact: true });
	await expectUsable(trust);
	await trust.click();
	await expectUsable(page.getByRole('button', { name: 'Import threads', exact: true }));
	await page.getByRole('button', { name: 'Not now', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.projectSwitches)).toBe(1);
	await expect(page.locator('.part.editor')).toBeHidden();
	await folder.click();
	await expect.poll(() => page.evaluate(() => globalThis.projectSwitches)).toBe(2);
	await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('the first-time project import choice survives reloading the window', async ({ page }) => {
	const open = () => page.evaluate(async () => {
		const { prepareCleanSlateProject } = await import('/vs/workbench/contrib/cleanSlate/browser/settings/cleanSlateProjectOpen.js');
		const { URI } = await import('/vs/base/common/uri.js');
		let prompts = 0;
		const services = {
			storageService: { getBoolean: key => localStorage.getItem(key) === 'true', store: (key, value) => localStorage.setItem(key, String(value)) },
			workspaceTrustManagementService: { workspaceTrustInitialized: Promise.resolve(), getUriTrustInfo: async () => ({ trusted: true }), isWorkspaceTrusted: () => true },
			workspaceTrustEnablementService: { isWorkspaceTrustEnabled: () => true },
			workspaceTrustRequestService: { requestResourcesTrust: async () => true },
			dialogService: { confirm: async options => { prompts++; return { confirmed: options.primaryButton === 'Trust Folder & Continue' }; } },
			notificationService: { error: error => { throw new Error(error); } },
			instantiationService: { invokeFunction: async () => {} }
		};
		const opened = await prepareCleanSlateProject({ get: id => services[String(id)] }, URI.file('/projects/persisted'));
		return { opened, prompts };
	});
	expect(await open()).toEqual({ opened: true, prompts: 2 });
	await page.reload();
	expect(await open()).toEqual({ opened: true, prompts: 0 });
});

test('Agent Manager quick pickers have an opaque surface over the transcript', async ({ page }) => {
	await page.evaluate(async () => {
		await import('/qa/browser-fixtures.mjs');
		const host = document.getElementById('fixture');
		host.className = 'monaco-workbench mac cleanSlate-agent-manager-host-active';
		const manager = host.appendChild(document.createElement('div'));
		manager.className = 'cleanSlate-agent-manager-surface';
		manager.textContent = 'Transcript behind the picker';
		const picker = host.appendChild(document.createElement('div'));
		picker.className = 'quick-input-widget';
		picker.style.cssText = 'position:absolute;top:30px;left:30px;width:400px;height:200px;background-color:transparent';
		picker.innerHTML = '<div class="quick-input-title">Select chats to import</div><div class="quick-input-header"><input placeholder="Search chats"></div>';
	});
	const picker = page.locator('.quick-input-widget');
	await expect(picker).toBeVisible();
	expect(await picker.evaluate(element => getComputedStyle(element).backgroundColor)).toMatch(/^rgb\(/);
	await expectUsable(page.getByPlaceholder('Search chats'));
});

test('inherited folder trust still asks once per project, and cancelling stops before import', async ({ page }) => {
	const result = await page.evaluate(async () => {
		const { prepareCleanSlateProject } = await import('/vs/workbench/contrib/cleanSlate/browser/settings/cleanSlateProjectOpen.js');
		const { URI } = await import('/vs/base/common/uri.js');
		const saved = new Map(), prompts = [];
		let acceptTrust = false;
		const services = {
			storageService: { getBoolean: key => saved.get(key) === true, store: (key, value) => saved.set(key, value) },
			workspaceTrustManagementService: { workspaceTrustInitialized: Promise.resolve(), getUriTrustInfo: async () => ({ trusted: true }), isWorkspaceTrusted: () => true },
			workspaceTrustEnablementService: { isWorkspaceTrustEnabled: () => true },
			workspaceTrustRequestService: { requestResourcesTrust: async () => true, requestWorkspaceTrust: async () => true },
			dialogService: { confirm: async options => { prompts.push([options.primaryButton, options.detail]); return { confirmed: options.primaryButton === 'Trust Folder & Continue' && acceptTrust }; } },
			notificationService: { error: error => { throw new Error(error); } },
			instantiationService: { invokeFunction: async () => { throw new Error('No import was selected'); } }
		};
		const accessor = { get: id => services[String(id)] }, first = URI.file('/projects/aircard');
		const cancelled = await prepareCleanSlateProject(accessor, first);
		const afterCancel = prompts.length;
		acceptTrust = true;
		const accepted = await prepareCleanSlateProject(accessor, first);
		await prepareCleanSlateProject(accessor, first);
		const afterRepeat = prompts.length;
		await prepareCleanSlateProject(accessor, URI.file('/projects/other'));
		return { cancelled, accepted, afterCancel, afterRepeat, prompts };
	});
	expect(result.cancelled).toBe(false);
	expect(result.accepted).toBe(true);
	expect(result.afterCancel).toBe(1);
	expect(result.afterRepeat).toBe(3);
	expect(result.prompts.map(([button]) => button)).toEqual(['Trust Folder & Continue', 'Trust Folder & Continue', 'Import threads', 'Trust Folder & Continue', 'Import threads']);
	expect(result.prompts[1][1]).toContain('/projects/aircard');
});

test('cancelling any selection leaves history untouched; empty folders have a useful message', async ({ page }) => {
	for (const scenario of ['cancel-source', 'cancel-folder', 'cancel-selection', 'empty']) {
		const events = await runImport(page, scenario);
		expect(events.filter(event => event[0] === 'import')).toEqual([]);
		if (scenario === 'empty') { expect(events.at(-1)[1]).toContain('No local Claude or Codex chats'); }
	}
});

test('one failed chat does not block the next and cancelling progress stops further imports', async ({ page }) => {
	const partial = await runImport(page, 'partial');
	expect(partial.filter(event => event[0] === 'import')).toHaveLength(2);
	expect(partial.at(-1)[0]).toBe('warn');
	expect(partial.at(-1)[1]).toContain('Imported 1 chat');
	expect(partial.at(-1)[1]).toContain('Unreadable history');
	const cancelled = await runImport(page, 'cancel-progress');
	expect(cancelled.filter(event => event[0] === 'import')).toEqual([['import', 'first']]);
});

test('imported chats hand off to Slate and another agent without losing shared history', async ({ page }) => {
	const result = await page.evaluate(async () => {
		const { CleanSlateChatSessionProvider } = await import('/vs/workbench/contrib/cleanSlate/browser/chat/providers/cleanSlateChatSessionProvider.js');
		const history = [{ role: 'user', content: 'Original request' }, { role: 'assistant', content: 'Work from Codex' }];
		const closed = [];
		let resets = 0;
		const session = { id: 'import-codex-one', runtime: 'external', externalAgent: { transport: 'acp', agentId: 'codex', dataHome: '/accounts/second' }, externalAgentSessionId: 'original-id',
			controller: { getHistory: () => history }, agent: { restoreRuntimeSnapshot: () => { resets++; } },
			threadService: { addMessage: (role, content) => history.push({ role, content }) }, transcriptHistory: [] };
		const provider = Object.create(CleanSlateChatSessionProvider.prototype);
		Object.defineProperty(provider, 'activeSession', { value: session });
		Object.assign(provider, { handoffs: new Set(), isLiveSessionRunning: () => false, cleanSlateMainService: { closeExternalAgentSession: async id => closed.push(id) }, externalContextUsage: new Map(), storageService: { remove() {} }, persistSession() {}, notifySessionChanged() {} });
		await provider.handoffAgent(undefined, 'Slate');
		const native = { runtime: session.runtime, externalAgent: session.externalAgent, externalSessionId: session.externalAgentSessionId };
		await provider.handoffAgent({ transport: 'acp', agentId: 'claude' }, 'Claude');
		return { native, runtime: session.runtime, config: session.externalAgent, externalSessionId: session.externalAgentSessionId, history, closed, resets };
	});
	expect(result.native).toEqual({ runtime: 'native', externalAgent: undefined, externalSessionId: undefined });
	expect(result.runtime).toBe('external');
	expect(result.config).toEqual({ transport: 'acp', agentId: 'claude' });
	expect(result.externalSessionId).toBeUndefined();
	expect(result.history.slice(0, 2)).toEqual([{ role: 'user', content: 'Original request' }, { role: 'assistant', content: 'Work from Codex' }]);
	expect(result.closed).toHaveLength(2);
	expect(result.resets).toBe(2);
});
