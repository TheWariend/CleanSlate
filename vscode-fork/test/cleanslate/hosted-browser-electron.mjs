// Run with the development Electron executable. Uses an isolated profile,
// a scripted model, and a local HTML file; it never calls a model provider.
import { app, BrowserWindow, WebContentsView } from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NodeCleanSlateMainService } from '../../out/vs/workbench/services/cleanSlate/node/core/cleanSlateMainService.js';
import { BrowserViewMainService } from '../../out/vs/platform/browserView/electron-main/browserViewMainService.js';
import { BrowserView } from '../../out/vs/platform/browserView/electron-main/browserView.js';
import { CleanSlateThreadPersistenceStore } from '../../out/vs/workbench/services/cleanSlate/node/core/cleanSlateThreadPersistenceStore.js';
import { URI } from '../../out/vs/base/common/uri.js';
import { Emitter } from '../../out/vs/base/common/event.js';
import { createNodeProviderConfiguration } from '@cleanslate/sdk/node/cleanSlateNodeAgentRuntime.js';
import { CleanSlateNodeBrowserAutomation } from '@cleanslate/sdk/node/cleanSlateNodeBrowserAutomation.js';

async function main() {
const root = await mkdtemp(join(tmpdir(), 'cleanslate-browser-host-'));
app.setPath('userData', root);
app.commandLine.appendSwitch('remote-debugging-port', '0');
const deadline = setTimeout(() => { console.error('Integrated browser test timed out'); app.exit(1); }, 30000);
let service;
let window;
let exitCode = 0;
try {
	await app.whenReady();
	window = new BrowserWindow({ show: false, width: 1000, height: 750 });
	await window.loadURL('data:text/html,<title>Agent Manager test view</title>');
	const views = new Map();
	const owners = Object.create(BrowserViewMainService.prototype);
	owners.agentOwnedViews = new Set();
	owners.browserViews = {
		get: id => views.has(id) ? { setVisible: visible => views.get(id).setVisible(visible) } : undefined,
		deleteAndDispose: id => { const view = views.get(id); if (view) { window.contentView.removeChildView(view); view.webContents.close(); views.delete(id); } }
	};
	const log = { trace() {}, debug() {}, info() {}, warn() {}, error() {} };
	const persistence = new CleanSlateThreadPersistenceStore({ userRoamingDataHome: URI.file(root) }, log);
	try {
		for (const transcriptOnly of [false, true]) {
			const messages = [{ role: 'user', content: 'open neon strike' }];
			await persistence.saveActiveSession('test', { id: `old-${transcriptOnly}`, title: 'Agent', savedAt: 1,
				history: transcriptOnly ? [] : messages, transcript: messages });
		}
		await persistence.saveActiveSession('test', { id: 'custom', title: 'My custom title', savedAt: 1,
			history: [{ role: 'user', content: 'open neon strike' }] });
		const native = { version: 1, messages: [{ role: 'user', content: 'Open Neon Strike' },
			{ role: 'assistant', content: 'Use shooting-game-3d.html' }] };
		await persistence.saveActiveSession('test', { id: 'native', title: 'Game', savedAt: 1, history: [], agentRuntimeState: native });
		assert.deepEqual((await persistence.loadSession('native')).agentRuntimeState, native);
		console.log('Passed: native agent conversation survives SQLite save/load.');
		const titles = new Map((await persistence.listSessions()).map(session => [session.id, session.title]));
		assert.equal(titles.get('old-false'), 'open neon strike');
		assert.equal(titles.get('old-true'), 'open neon strike');
		assert.equal(titles.get('custom'), 'My custom title');
		console.log('Passed: SQLite old-chat placeholder titles resolve before hydration; custom titles preserved.');
	} finally { persistence.dispose(); }
	service = new NodeCleanSlateMainService({}, { userDataPath: root, userRoamingDataHome: URI.file(root) }, log);
	service.threadPersistenceStore = { archiveSession: async () => {} };
	service.getModelsDevModelMetadata = async () => undefined;
	owners.getOrCreateBrowserView = async id => {
		const view = new WebContentsView();
		views.set(id, view);
		window.contentView.addChildView(view);
		view.setBounds({ x: 0, y: 0, width: 1000, height: 750 });
		view.webContents.on('did-frame-finish-load', (_event, main) => {
			if (main) void view.webContents.executeJavaScript(`globalThis.__cleanSlateBrowserViewId=${JSON.stringify(id)}`);
		});
	};
	owners.loadURL = (id, url) => views.get(id).webContents.loadURL(url);
	service.configureHostedBrowserViews({
		create: (id, sessionId) => owners.createAgentBrowserView(id, sessionId),
		release: id => owners.releaseAgentBrowserView(id),
		pointer: async (id, x, y, click) => {
			const native = Object.create(BrowserView.prototype);
			native._view = views.get(id);
			await native.presentAutomationPointer(x, y, click);
		}
	});
	const game = join(root, 'game.html');
	await writeFile(game, '<title>Neon Strike Test</title><button onclick="window.clicks=(window.clicks||0)+1;this.textContent=\'Started\'">Play game</button>');
	let requests = 0;
	let resolveOpened;
	const opened = new Promise(resolve => { resolveOpened = resolve; });
	service.onDidPublishThreadSession(update => { if (update.live?.browser) { resolveOpened(update); } });
	service.openAICompatibleChatStream = () => {
		const call = ++requests;
		const emitter = new Emitter();
		setTimeout(() => {
			const part = call === 1
				? { type: 'tool_call', call: { id: 'open-game', toolName: 'browser_open', input: { url: pathToFileURL(game).href } } }
				: call === 2
					? { type: 'tool_call', call: { id: 'click-game', toolName: 'browser_click', input: { selector: 'button' } } }
					: { type: 'text', content: 'The game is open.', phase: 'final_answer' };
			emitter.fire(`data: ${JSON.stringify(part)}\n\n`);
			emitter.fire(null);
		}, 0);
		return emitter.event;
	};
	const session = { id: 'game-test', title: 'Open the game', savedAt: Date.now(), workDir: root, history: [],
		transcript: [{ id: 'user-1', role: 'user', content: 'Open the game' }] };
	const accepted = await service.startHostedAgentRun({ session, surface: 'agentManager', text: 'Open the game',
		configuration: { ...createNodeProviderConfiguration({ provider: 'openai', model: 'test', apiKey: 'test' }), ragEnabled: false } });
	const update = await opened;
	await service.agentHost.whenSettled(session.id);
	const final = service.agentHost.getSnapshot(session.id);
	assert.equal(accepted.session.title, 'Open the game');
	assert.equal(final.live.isRunning, false);
	assert.equal(final.live.browser.viewId, update.live.browser.viewId);
	const view = views.get(final.live.browser.viewId);
	assert.ok(view, 'The game must be in an application-owned native view');
	assert.equal(await view.webContents.executeJavaScript('document.title'), 'Neon Strike Test');
	assert.equal(await view.webContents.executeJavaScript('!!document.getElementById("__cleanslate_browser_mouse")?.shadowRoot?.querySelector(".ring")'), true);
	assert.equal(await view.webContents.executeJavaScript('window.clicks'), 1, 'Cursor animation must not dispatch duplicate clicks');
	const payload = JSON.parse(final.session.transcript.at(-1).renderPayload);
	assert.equal(payload.timeline.find(block => block.toolName === 'browser_open').type, 'browser');
	assert.equal(payload.timeline.find(block => block.toolName === 'browser_open').browserStatus, 'completed');
	const pageId = view.webContents.id;
	const page = await service.browserService.pageForView(final.live.browser.viewId);
	const automation = new CleanSlateNodeBrowserAutomation({ createPage: async () => ({ page, id: final.live.browser.viewId }) });
	await automation.open(pathToFileURL(game).href);
	const snapshot = await automation.snapshot('ide');
	const button = snapshot.elements.find(element => element.tagName === 'button');
	assert.ok(button);
	assert.deepEqual({ width: snapshot.viewport.width, height: snapshot.viewport.height }, await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
	await page.evaluate(() => {
		const inserted = document.createElement('button');
		inserted.textContent = 'Wrong target';
		inserted.onclick = () => { window.wrongTarget = true; };
		document.body.prepend(inserted);
	});
	await automation.click('ide', { elementId: button.id });
	assert.equal(await page.evaluate(() => window.wrongTarget), undefined);
	assert.equal(await page.evaluate(() => window.clicks), 1);
	await automation.snapshot('ide');
	await assert.rejects(automation.click('ide', { elementId: button.id }), /stale/);
	const fresh = await automation.snapshot('ide');
	const target = fresh.elements.find(element => element.text === 'Started' && element.tagName === 'button');
	await page.locator(`[data-cleanslate-snapshot-id="${target.id}"]`).evaluate(element => element.remove());
	await assert.rejects(automation.click('ide', { elementId: target.id }), /removed or replaced/);
	await automation.open(pathToFileURL(game).href);
	await automation.click('ide', { role: 'button', name: 'Play game', exact: true });
	console.log('Passed: actual embedded viewport, stable snapshot target after DOM insertion, stale/replaced IDs rejected, semantic clicks preserved.');
	await owners.destroyBrowserView(final.live.browser.viewId); // Renderer/editor disposal during handoff.
	assert.equal(view.webContents.isDestroyed(), false);
	await window.loadURL('data:text/html,<title>Different project IDE</title>');
	view.setVisible(true);
	assert.equal(view.webContents.id, pageId);
	assert.equal(await view.webContents.executeJavaScript('document.querySelector("button").textContent'), 'Started');
	await view.webContents.executeJavaScript('document.querySelector("button").click()');
	assert.equal(await view.webContents.executeJavaScript('document.querySelector("button").textContent'), 'Started');
	assert.equal(requests, 3);
	await owners.releaseAgentBrowserView(final.live.browser.viewId);
	assert.equal(views.size, 0);
	console.log('Passed: SDK browser_open uses the native application page; visible activity and title; same page survives renderer disposal and project change; page remains interactive; explicit host release closes it.');
} catch (error) {
	console.error(error);
	exitCode = 1;
} finally {
	clearTimeout(deadline);
	service?.dispose();
	window?.destroy();
	await rm(root, { recursive: true, force: true });
	app.exit(exitCode);
}
}
void main().catch(error => { console.error(error); app.exit(1); });
