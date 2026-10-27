/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { getZoomFactor, onDidChangeZoomLevel } from '../../../../../base/browser/browser.js';
import { CodeWindow } from '../../../../../base/browser/window.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../../base/common/platform.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { FileAccess } from '../../../../../base/common/network.js';
import { IWebWorkerClient } from '../../../../../base/common/worker/webWorker.js';
import { IWebWorkerService } from '../../../../../platform/webWorker/browser/webWorkerService.js';
import { WebWorkerDescriptor } from '../../../../../platform/webWorker/browser/webWorkerDescriptor.js';
import { localize } from '../../../../../nls.js';
import { BrowserViewUri } from '../../../../../platform/browserView/common/browserViewUri.js';
import { IBrowserViewBounds } from '../../../../../platform/browserView/common/browserView.js';
import { IStorageService, StorageScope, StorageTarget, WillSaveStateReason } from '../../../../../platform/storage/common/storage.js';
import { IBrowserViewModel, IBrowserViewWorkbenchService } from '../../../browserView/common/browserView.js';
import { ICleanSlateThreadTab } from './cleanSlateAgentManagerThreadTabsView.js';
import { resolveCleanSlateBrowserAddress } from './cleanSlateBrowserAddress.js';
import { CleanSlateBrowserStartView, cleanSlateStoredFavicon, ICleanSlateBrowserShortcut, renderCleanSlateSiteIcon } from './cleanSlateBrowserStartView.js';
import { cleanSlateBrowserBookmarksKey, readCleanSlateBrowserBookmarks } from './cleanSlateBrowserBookmarks.js';
import { IBrowserBookmark } from '../../../../../platform/native/common/browserIntegration.js';
import { BrowserOverlayManager } from '../../../browserView/browser/overlayManager.js';
import { CleanSlateBrowserHistory } from './cleanSlateBrowserHistory.js';
import type { ICleanSlateBrowserHistoryWorker } from './cleanSlateBrowserHistoryWorker.js';

import { cleanSlateBrowserImportedTabsKey, ICleanSlateImportedTab, readCleanSlateImportedTabs } from './cleanSlateBrowserData.js';

/** Owns the native pages shown by browser tabs in the main workspace. */
export class CleanSlateWorkspaceBrowser extends Disposable {
	private readonly pinsKey = 'cleanSlate.browser.pinnedSites';
	private pins: ICleanSlateBrowserShortcut[] = [];
	private bookmarks: IBrowserBookmark[] = [];
	private readonly history: CleanSlateBrowserHistory;
	private importedTabs: ICleanSlateImportedTab[] = [];
	private readonly loadingImportedTabs = new Set<string>();
	private historyList: HTMLElement | undefined;
	private renderedPins = '';
	private readonly models = new Map<string, IBrowserViewModel>();
	private readonly listeners = new Map<string, DisposableStore>();
	private readonly viewDisposables = this._register(new DisposableStore());
	private readonly opened = this._register(new Emitter<{ id: string; background: boolean }>());
	readonly onDidOpenTab = this.opened.event;
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChange = this.changed.event;
	private readonly closed = this._register(new Emitter<string>());
	readonly onDidRequestCloseTab = this.closed.event;
	private readonly showThread = this._register(new Emitter<void>());
	readonly onDidRequestShowThread = this.showThread.event;
	private readonly settings = this._register(new Emitter<void>());
	readonly onDidRequestSettings = this.settings.event;
	private readonly chat = this._register(new Emitter<void>());
	readonly onDidRequestChat = this.chat.event;
	private root: HTMLElement | undefined;
	private sidebar: HTMLElement | undefined;
	private sidebarTabs: HTMLElement | undefined;
	private pinnedSites: HTMLElement | undefined;
	private bookmarkList: HTMLElement | undefined;
	private startView: CleanSlateBrowserStartView | undefined;
	private tabSearch: HTMLInputElement | undefined;
	private tabCount: HTMLElement | undefined;
	private pinButton: HTMLButtonElement | undefined;
	private chatButton: HTMLButtonElement | undefined;
	private chatVisible = false;
	private viewport: HTMLElement | undefined;
	private address: HTMLInputElement | undefined;
	private back: HTMLButtonElement | undefined;
	private forward: HTMLButtonElement | undefined;
	private reload: HTMLButtonElement | undefined;
	private message: HTMLElement | undefined;
	private targetWindow: CodeWindow | undefined;
	private activeId: string | undefined;
	private visible = false;
	private modalActive = false;
	private layoutVersion = 0;
	private navigationVersion = 0;
	private layoutFrame: number | undefined;
	private updateFrame: number | undefined;
	private layoutRunning = false;
	private layoutRequested = false;
	private lastLayout: { id: string; bounds: IBrowserViewBounds } | undefined;
	private presentedId: string | undefined;
	private overlayManager: BrowserOverlayManager | undefined;
	private overlayActive = false;
	private historyDirty = true;
	private bookmarksDirty = true;
	private libraryQuery = '';
	private readonly dirtyTabs = new Set<string>();
	private chromeDirty = false;
	private tabsChanged = false;
	private allTabsDirty = false;
	private historyWorker: IWebWorkerClient<ICleanSlateBrowserHistoryWorker> | undefined;
	private disposed = false;

	constructor(private readonly service: IBrowserViewWorkbenchService, private readonly storage: IStorageService, webWorkerService: IWebWorkerService) {
		super();
		this.bookmarks = readCleanSlateBrowserBookmarks(storage);
		this.history = this._register(new CleanSlateBrowserHistory(storage, (base, changes) => {
			this.historyWorker ??= this._register(webWorkerService.createWorkerClient<ICleanSlateBrowserHistoryWorker>(new WebWorkerDescriptor({
				esmModuleLocation: FileAccess.asBrowserUri('vs/workbench/contrib/cleanSlate/browser/agentManager/cleanSlateBrowserHistoryWorker.js'),
				label: 'CleanSlateBrowserHistory'
			})));
			return this.historyWorker.proxy.$serialize(base, changes);
		}));
		this.importedTabs = readCleanSlateImportedTabs(storage);
		this._register(this.history.onDidChange(() => {
			this.historyDirty = true;
			this.scheduleUpdate();
		}));
		this._register(storage.onDidChangeValue(StorageScope.PROFILE, cleanSlateBrowserImportedTabsKey, this._store)(() => {
			const old = new Set(this.importedTabs.map(tab => tab.id));
			this.importedTabs = readCleanSlateImportedTabs(storage);
			for (const tab of this.importedTabs) { if (!old.has(tab.id)) { this.opened.fire({ id: tab.id, background: true }); } }
			this.scheduleUpdate(undefined, true);
		}));
		this._register(storage.onDidChangeValue(StorageScope.PROFILE, cleanSlateBrowserBookmarksKey, this._store)(() => {
			this.bookmarks = readCleanSlateBrowserBookmarks(storage);
			this.bookmarksDirty = true;
			this.scheduleUpdate();
		}));
		try {
			const parsed: unknown = JSON.parse(storage.get(this.pinsKey, StorageScope.PROFILE, '[]'));
			if (Array.isArray(parsed)) {
				this.pins = parsed.flatMap((pin): ICleanSlateBrowserShortcut[] => {
					if (typeof pin?.url !== 'string' || typeof pin?.title !== 'string' || !/^(https?:|file:)/i.test(pin.url)) { return []; }
					return [{ url: pin.url, title: pin.title, favicon: typeof pin.favicon === 'string' ? pin.favicon : undefined }];
				}).slice(0, 24);
			}
		} catch { /* Unreadable bookmarks start with an empty list. */ }
	}

	get activeTabId(): string | undefined { return this.activeId; }
	getActiveBrowserModel(): IBrowserViewModel | undefined { return this.activeId ? this.models.get(this.activeId) : undefined; }
	hasActivePage(): boolean { const model = this.getActiveBrowserModel(); return !!model?.url && model.url !== 'about:blank'; }
	getBrowserModels(): readonly IBrowserViewModel[] { return Array.from(this.models.values()); }

	setChatVisible(visible: boolean): void {
		this.chatVisible = visible;
		this.chatButton?.classList.toggle('active', visible);
		this.chatButton?.setAttribute('aria-pressed', String(visible));
	}

	mount(parent: HTMLElement, sidebarHost: HTMLElement): void {
		this.setVisible(false);
		this.viewDisposables.clear();
		this.root?.remove();
		this.sidebar?.remove();
		this.targetWindow = dom.getWindow(parent);
		if (this.updateFrame !== undefined) { this.targetWindow.cancelAnimationFrame(this.updateFrame); this.updateFrame = undefined; }
		this.historyDirty = this.bookmarksDirty = true;
		this.lastLayout = undefined;
		const root = this.root = dom.append(parent, dom.$('.cleanSlate-workspace-browser'));
		root.hidden = true;
		const toolbar = dom.append(root, dom.$('.cleanSlate-workspace-browser-toolbar'));
		this.back = this.button(toolbar, Codicon.arrowLeft, localize('cleanSlate.browser.back', 'Go back'), () => this.run(model => model.goBack()));
		this.forward = this.button(toolbar, Codicon.arrowRight, localize('cleanSlate.browser.forward', 'Go forward'), () => this.run(model => model.goForward()));
		this.reload = this.button(toolbar, Codicon.refresh, localize('cleanSlate.browser.reload', 'Reload page'), () => this.run(model => model.reload()));
		const form = dom.append(toolbar, dom.$('form.cleanSlate-workspace-browser-address')) as HTMLFormElement;
		dom.append(form, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.globe)}`));
		const address = this.address = dom.append(form, dom.$('input')) as HTMLInputElement;
		address.type = 'text';
		address.placeholder = localize('cleanSlate.browser.addressPlaceholder', 'Search or enter a website address');
		address.setAttribute('aria-label', localize('cleanSlate.browser.address', 'Search or enter address'));
		address.spellcheck = false;
		address.autocomplete = 'off';
		form.onsubmit = event => { event.preventDefault(); void this.navigate(address.value); };
		this.pinButton = this.button(toolbar, Codicon.pin, localize('cleanSlate.browser.pinPage', 'Pin current page'), () => this.togglePin());
		this.chatButton = this.button(toolbar, Codicon.commentDiscussion, localize('cleanSlate.browser.chatPage', 'Chat about this page'), () => this.chat.fire());
		this.chatButton.classList.add('cleanSlate-browser-chat-button');
		dom.append(this.chatButton, dom.$('span')).textContent = localize('cleanSlate.browser.chat', 'Chat');
		this.setChatVisible(this.chatVisible);
		const viewport = this.viewport = dom.append(root, dom.$('.cleanSlate-workspace-browser-viewport'));
		this.startView = new CleanSlateBrowserStartView(viewport, {
			navigate: value => void this.navigate(value),
			selectTab: id => this.opened.fire({ id, background: false })
		});
		this.message = dom.append(viewport, dom.$('.cleanSlate-workspace-browser-message'));
		const sidebar = this.sidebar = dom.$('.cleanSlate-browser-sidebar');
		sidebarHost.insertBefore(sidebar, sidebarHost.querySelector('.cleanSlate-agent-manager-footer'));
		const space = dom.append(sidebar, dom.$('.cleanSlate-browser-space'));
		dom.append(space, dom.$('span')).textContent = localize('cleanSlate.browser.spaceTitle', 'Browser');
		const returnButton = dom.append(space, dom.$('button.cleanSlate-browser-return')) as HTMLButtonElement;
		returnButton.type = 'button';
		dom.append(returnButton, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.arrowLeft)}`));
		dom.append(returnButton, dom.$('span')).textContent = localize('cleanSlate.browser.threads', 'Threads');
		returnButton.setAttribute('aria-label', localize('cleanSlate.browser.returnThreads', 'Back to threads'));
		returnButton.title = localize('cleanSlate.browser.returnThreads', 'Back to threads');
		returnButton.onclick = () => this.showThread.fire();
		this.pinnedSites = dom.append(sidebar, dom.$('.cleanSlate-browser-pins'));
		this.renderedPins = '';
		const searchTabs = dom.append(sidebar, dom.$('.cleanSlate-browser-tab-search'));
		dom.append(searchTabs, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.search)}`));
		this.tabSearch = dom.append(searchTabs, dom.$('input')) as HTMLInputElement;
		this.tabSearch.placeholder = localize('cleanSlate.browser.searchTabsAndBookmarks', 'Search tabs and bookmarks');
		this.tabSearch.setAttribute('aria-label', this.tabSearch.placeholder);
		this.tabSearch.oninput = () => this.renderSidebar();
		this.tabSearch.onkeydown = event => {
			if (event.key === 'Escape') { this.tabSearch!.value = ''; this.renderSidebar(); }
		};
		const caption = dom.append(sidebar, dom.$('.cleanSlate-browser-tabs-caption'));
		dom.append(caption, dom.$('span')).textContent = localize('cleanSlate.browser.tabsCaption', 'Open tabs');
		this.tabCount = dom.append(caption, dom.$('span.cleanSlate-browser-tab-count'));
		this.sidebarTabs = dom.append(sidebar, dom.$('.cleanSlate-browser-tabs'));
		this.sidebarTabs.setAttribute('role', 'tablist');
		this.sidebarTabs.setAttribute('aria-label', localize('cleanSlate.browser.tabs', 'Browser tabs'));
		this.sidebarTabs.setAttribute('aria-orientation', 'vertical');
		const newTab = dom.append(sidebar, dom.$('button.cleanSlate-browser-new-tab')) as HTMLButtonElement;
		newTab.type = 'button';
		dom.append(newTab, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.add)}`)).setAttribute('aria-hidden', 'true');
		dom.append(newTab, dom.$('span')).textContent = localize('cleanSlate.browser.newTabRow', 'New tab');
		newTab.onclick = () => void this.openTab().catch(error => this.showError(error));
		this.bookmarkList = dom.append(sidebar, dom.$('.cleanSlate-browser-bookmarks'));
		this.historyList = dom.append(sidebar, dom.$('.cleanSlate-browser-bookmarks'));
		this.overlayManager = this.viewDisposables.add(new BrowserOverlayManager(this.targetWindow));
		this.viewDisposables.add(this.overlayManager.onDidChangeOverlayState(() => this.checkOverlays()));
		for (const tab of this.importedTabs) { this.opened.fire({ id: tab.id, background: true }); }
		const imports = dom.append(sidebar, dom.$('button.cleanSlate-browser-new-tab.cleanSlate-browser-import')) as HTMLButtonElement;
		imports.type = 'button';
		dom.append(imports, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.cloudDownload)}`)).setAttribute('aria-hidden', 'true');
		dom.append(imports, dom.$('span')).textContent = localize('cleanSlate.browser.importData', 'Import browser data…');
		imports.onclick = () => this.settings.fire();
		const observer = new this.targetWindow.ResizeObserver(() => this.layout());
		observer.observe(viewport);
		this.viewDisposables.add({ dispose: () => observer.disconnect() });
		this.viewDisposables.add(onDidChangeZoomLevel(windowId => {
			if (windowId === this.targetWindow?.vscodeWindowId) { this.layout(); }
		}));
		this.viewDisposables.add(dom.addDisposableListener(this.targetWindow, 'keydown', event => {
			if (this.visible && this.handleKey(event as KeyboardEvent)) {
				event.preventDefault();
				event.stopPropagation();
			}
		}, true));
		this.update();
		this.renderSidebar();
	}

	hasTab(id: string): boolean { return this.models.has(id) || this.importedTabs.some(tab => tab.id === id); }

	getTabs(): ICleanSlateThreadTab[] {
		return [...Array.from(this.models.values(), model => ({
			id: model.id,
			title: model.title || (model.url && model.url !== 'about:blank' ? model.url : localize('cleanSlate.browser.newTab', 'New browser tab')),
			running: model.loading,
			browser: true
		})), ...this.importedTabs.filter(tab => !this.models.has(tab.id)).map(tab => ({ id: tab.id, title: tab.title, running: this.loadingImportedTabs.has(tab.id), browser: true }))];
	}

	async openTab(url?: string, background = false): Promise<IBrowserViewModel | undefined> {
		const model = await this.service.getOrCreateBrowserViewModel(`cleanslate.workspace.browser.${generateUuid()}`);
		if (this.disposed) { model.dispose(); return; }
		this.track(model, background);
		if (url) {
			try { await model.loadURL(url); }
			catch (error) { if (this.activeId === model.id) { this.showError(error); } }
		}
		return model;
	}

	activate(id: string): void {
		if (!this.models.has(id)) {
			const imported = this.importedTabs.find(tab => tab.id === id);
			if (!imported) { return; }
			const previous = this.activeId && this.models.get(this.activeId);
			if (previous) { void previous.setVisible(false); }
			this.activeId = id;
			if (!this.loadingImportedTabs.has(id)) { void this.loadImportedTab(imported); }
			this.update(); this.renderSidebar(); return;
		}
		const previous = this.activeId && this.models.get(this.activeId);
		this.activeId = id;
		this.navigationVersion++;
		this.layoutVersion++;
		if (previous && previous.id !== id) { void previous.setVisible(false); }
		if (this.address && (!previous || previous.id !== id)) {
			const model = this.models.get(id)!;
			this.address.value = model.url === 'about:blank' ? '' : model.url;
			this.startView?.reset();
		}
		this.update();
		this.renderSidebar();
		this.layout();
		this.changed.fire();
	}

	private async loadImportedTab(tab: ICleanSlateImportedTab): Promise<void> {
		this.loadingImportedTabs.add(tab.id);
		try {
			const model = await this.service.getOrCreateBrowserViewModel(tab.id);
			if (this.disposed || !this.importedTabs.some(item => item.id === tab.id)) { model.dispose(); return; }
			this.track(model, true);
			await model.loadURL(tab.url);
			if (this.activeId === tab.id) { this.activate(tab.id); }
		} catch (error) { if (this.activeId === tab.id) { this.showError(error); } }
		finally { this.loadingImportedTabs.delete(tab.id); this.renderSidebar(); }
	}

	closeTab(id: string): void {
		if (this.importedTabs.some(tab => tab.id === id)) {
			this.storage.store(cleanSlateBrowserImportedTabsKey, JSON.stringify(this.importedTabs.filter(tab => tab.id !== id)), StorageScope.PROFILE, StorageTarget.MACHINE);
			void this.storage.flush(WillSaveStateReason.SHUTDOWN);
		}
		const model = this.models.get(id);
		this.models.delete(id);
		this.listeners.get(id)?.dispose();
		this.listeners.delete(id);
		model?.dispose();
		this.renderSidebar();
		this.changed.fire();
	}

	setVisible(visible: boolean): void {
		this.visible = visible;
		if (!visible) { this.modalActive = false; }
		this.layoutVersion++;
		if (this.root) { this.root.hidden = !visible; }
		if (!visible) {
			this.hidePages();
		} else {
			this.checkOverlays();
			this.update();
			this.layout();
			const model = this.activeId ? this.models.get(this.activeId) : undefined;
			if (!model?.url || model.url === 'about:blank') { this.focusAddress(); }
		}
	}

	setModalActive(active: boolean): void {
		this.modalActive = active; this.layoutVersion++;
		if (active) { this.hidePages(); }
		else { this.layout(); }
	}

	private hidePages(): void {
		this.presentedId = undefined;
		for (const model of this.models.values()) {
			if (model.visible) { void model.setVisible(false); }
		}
	}

	private checkOverlays(): void {
		if (!this.viewport || !this.visible) { return; }
		const active = !!this.overlayManager?.getOverlappingOverlays(this.viewport).length;
		if (active === this.overlayActive) { return; }
		this.overlayActive = active;
		this.layoutVersion++;
		if (active) { this.hidePages(); }
		else { this.layout(); }
	}

	focusAddress(): void {
		if (this.startView && !this.startView.element.hidden) { this.startView.focus(); }
		else { this.address?.focus(); this.address?.select(); }
	}

	layout(): void {
		if (!this.visible || this.modalActive || this.overlayActive || !this.targetWindow) { return; }
		this.layoutRequested = true;
		if (this.layoutFrame !== undefined || this.layoutRunning) { return; }
		this.layoutFrame = this.targetWindow.requestAnimationFrame(() => {
			this.layoutFrame = undefined;
			this.layoutRequested = false;
			this.layoutRunning = true;
			void this.layoutPage().catch(error => this.showError(error)).finally(() => {
				this.layoutRunning = false;
				if (this.layoutRequested) { this.layout(); }
			});
		});
	}

	private async layoutPage(): Promise<void> {
		const model = this.activeId ? this.models.get(this.activeId) : undefined;
		const win = this.targetWindow;
		this.checkOverlays();
		if (!model || !win || !this.viewport?.isConnected || !this.visible || this.modalActive || this.overlayActive) { return; }
		if (!model.url || model.url === 'about:blank' || model.error) { this.presentedId = undefined; if (model.visible) { await model.setVisible(false); } return; }
		const version = this.layoutVersion;
		const rect = this.viewport.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) { this.presentedId = undefined; if (model.visible) { await model.setVisible(false); } return; }
		const bounds = { windowId: win.vscodeWindowId, x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height), zoomFactor: getZoomFactor(win) };
		const previous = this.lastLayout;
		if (previous?.id !== model.id || (Object.keys(bounds) as (keyof IBrowserViewBounds)[]).some(key => bounds[key] !== previous.bounds[key])) {
			await model.layout(bounds);
			this.lastLayout = { id: model.id, bounds };
		}
		if (version !== this.layoutVersion || this.activeId !== model.id) { return; }
		const showing = !model.visible;
		if (showing) { await model.setVisible(true); }
		if (version !== this.layoutVersion || this.activeId !== model.id) { return; }
		if (showing || this.presentedId !== model.id) {
			await model.bringToFront();
			this.presentedId = model.id;
		}
	}

	private scheduleUpdate(model?: IBrowserViewModel, tabsChanged = false): void {
		if (model) { this.dirtyTabs.add(model.id); this.chromeDirty ||= this.activeId === model.id; }
		this.tabsChanged ||= tabsChanged;
		this.allTabsDirty ||= !model && tabsChanged;
		if (this.updateFrame !== undefined || !this.targetWindow || this.disposed) { return; }
		this.updateFrame = this.targetWindow.requestAnimationFrame(() => {
			this.updateFrame = undefined;
			if (this.chromeDirty) { this.update(); }
			this.chromeDirty = false;
			this.renderSidebar(this.allTabsDirty ? undefined : this.dirtyTabs);
			this.allTabsDirty = false;
			this.dirtyTabs.clear();
			if (this.tabsChanged) { this.tabsChanged = false; this.changed.fire(); }
		});
	}

	private track(model: IBrowserViewModel, background: boolean): void {
		if (this.models.has(model.id)) { return; }
		this.models.set(model.id, model);
		const store = new DisposableStore();
		this.listeners.set(model.id, store);
		const updatePage = () => { this.scheduleUpdate(model, true); if (this.activeId === model.id) { this.layout(); } };
		store.add(model.onDidChangeNavigationState(updatePage));
		store.add(model.onDidChangeLoadingState(() => { this.recordHistory(model); updatePage(); }));
		store.add(model.onDidChangeTitle(() => { this.refreshPin(model); this.recordHistory(model); this.scheduleUpdate(model); }));
		store.add(model.onDidChangeFavicon(() => { this.refreshPin(model); this.scheduleUpdate(model); }));
		store.add(model.onDidKeyCommand(event => {
			if (this.activeId === model.id && this.visible) { this.handleKey(event); }
		}));
		store.add(model.onDidRequestNewPage(event => {
			const id = BrowserViewUri.getId(event.resource);
			if (id) {
				void this.service.getOrCreateBrowserViewModel(id).then(child => {
					if (this.disposed) { child.dispose(); return; }
					this.track(child, event.location === 'background');
				}).catch(error => this.showError(error));
			}
		}));
		store.add(model.onDidClose(() => this.closed.fire(model.id)));
		store.add(model.onWillDispose(() => {
			if (this.models.has(model.id)) {
				this.models.delete(model.id);
				this.closed.fire(model.id);
			}
		}));
		this.opened.fire({ id: model.id, background });
		this.renderSidebar();
	}

	private handleKey(event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
		if (!(isMacintosh ? event.metaKey : event.ctrlKey) || event.shiftKey || event.altKey) { return false; }
		if (event.key.toLowerCase() === 'l') { this.focusAddress(); return true; }
		if (event.key.toLowerCase() === 't') { void this.openTab().catch(error => this.showError(error)); return true; }
		if (event.key.toLowerCase() === 'w' && this.activeId) { this.closed.fire(this.activeId); return true; }
		return false;
	}

	private async navigate(value: string): Promise<void> {
		const id = this.activeId;
		const request = ++this.navigationVersion;
		if (this.address) { this.address.value = value.trim(); }
		try {
			const url = resolveCleanSlateBrowserAddress(value);
			const model = this.activeId ? this.models.get(this.activeId) : undefined;
			if (!model) { return; }
			this.address!.value = url;
			await model.loadURL(url);
			if (this.models.has(model.id) && this.activeId === model.id && request === this.navigationVersion) { this.update(); this.layout(); }
		} catch (error) {
			if (id === this.activeId && request === this.navigationVersion) { this.showError(error); }
		}
	}

	private run(action: (model: IBrowserViewModel) => Promise<void>): void {
		const model = this.activeId ? this.models.get(this.activeId) : undefined;
		if (model) { void action(model).catch(error => { if (this.activeId === model.id) { this.showError(error); } }); }
	}

	private update(): void {
		const model = this.activeId ? this.models.get(this.activeId) : undefined;
		if (!this.root || !this.address || !this.message) { return; }
		this.root.classList.toggle('loading', !!model && model.loading);
		if (this.back) { this.back.disabled = !model || !model.canGoBack; }
		if (this.forward) { this.forward.disabled = !model || !model.canGoForward; }
		if (this.reload) { this.reload.disabled = !model || !model.url || model.url === 'about:blank'; }
		if (this.address.ownerDocument.activeElement !== this.address) {
			this.address.value = model && model.url !== 'about:blank' ? model.url : '';
		}
		const empty = !this.hasActivePage();
		if (this.chatButton) { this.chatButton.disabled = empty; }
		this.root.classList.toggle('new-tab', empty);
		if (this.startView) {
			const wasHidden = this.startView.element.hidden;
			this.startView.element.hidden = !empty;
			if (empty && wasHidden) { this.startView.refresh(); }
		}
		if (this.address.parentElement) { this.address.parentElement.hidden = empty; }
		if (this.pinButton) {
			this.pinButton.disabled = empty;
			const pinned = !!model && this.pins.some(pin => pin.url === model.url);
			this.pinButton.classList.toggle('active', pinned);
			this.pinButton.setAttribute('aria-pressed', String(pinned));
			this.pinButton.title = pinned ? localize('cleanSlate.browser.unpinPage', 'Unpin current page') : localize('cleanSlate.browser.pinPage', 'Pin current page');
			this.pinButton.setAttribute('aria-label', this.pinButton.title);
		}
		this.message.hidden = !model?.error;
		dom.clearNode(this.message);
		if (model && model.error) {
			dom.append(this.message, dom.$('h2')).textContent = localize('cleanSlate.browser.loadFailed', 'Could not load this page');
			dom.append(this.message, dom.$('p')).textContent = model.error.errorDescription;
		}
	}

	private togglePin(): void {
		const model = this.activeId ? this.models.get(this.activeId) : undefined;
		if (!model?.url || model.url === 'about:blank') { return; }
		const existing = this.pins.findIndex(pin => pin.url === model.url);
		if (existing >= 0) { this.pins.splice(existing, 1); }
		else { this.pins.push({ url: model.url, title: model.title || model.url, favicon: cleanSlateStoredFavicon(model.favicon) }); }
		this.storage.store(this.pinsKey, JSON.stringify(this.pins), StorageScope.PROFILE, StorageTarget.MACHINE);
		this.update();
		this.renderSidebar();
	}

	private refreshPin(model: IBrowserViewModel): void {
		const imported = this.importedTabs.find(tab => tab.id === model.id);
		if (imported && model.url && model.url !== 'about:blank' && (imported.url !== model.url || model.title && imported.title !== model.title)) {
			this.storage.store(cleanSlateBrowserImportedTabsKey, JSON.stringify(this.importedTabs.map(tab => tab.id === model.id ? { ...tab, url: model.url, title: model.title || tab.title } : tab)), StorageScope.PROFILE, StorageTarget.MACHINE);
		}
		const bookmarkIndex = this.bookmarks.findIndex(bookmark => bookmark.url === model.url);
		const bookmarkIcon = cleanSlateStoredFavicon(model.favicon);
		if (bookmarkIndex >= 0 && bookmarkIcon && this.bookmarks[bookmarkIndex].favicon !== bookmarkIcon) {
			const bookmarks = this.bookmarks.slice();
			bookmarks[bookmarkIndex] = { ...bookmarks[bookmarkIndex], favicon: bookmarkIcon };
			this.storage.store(cleanSlateBrowserBookmarksKey, JSON.stringify(bookmarks), StorageScope.PROFILE, StorageTarget.MACHINE);
		}
		const index = this.pins.findIndex(pin => pin.url === model.url);
		if (index < 0) { return; }
		const pin = this.pins[index];
		const favicon = cleanSlateStoredFavicon(model.favicon) ?? pin.favicon;
		const title = model.title || pin.title;
		if (favicon === pin.favicon && title === pin.title) { return; }
		this.pins[index] = { url: pin.url, title, favicon };
		this.storage.store(this.pinsKey, JSON.stringify(this.pins), StorageScope.PROFILE, StorageTarget.MACHINE);
	}

	private renderSidebar(dirtyTabs?: ReadonlySet<string>): void {
		if (!this.sidebarTabs || !this.pinnedSites) { return; }
		const query = this.tabSearch?.value.trim().toLowerCase() ?? '';
		const tabs = this.getTabs();
		const importedTabs = new Map(this.importedTabs.map(tab => [tab.id, tab]));
		if (this.tabCount) { this.tabCount.textContent = String(tabs.length); }
		const oldRows = new Map(Array.from(this.sidebarTabs.children).map(row => [(row as HTMLElement).dataset.tabId, row as HTMLElement]));
		const shortcuts: ICleanSlateBrowserShortcut[] = [];
		for (const tab of tabs) {
			const live = this.models.get(tab.id);
			const imported = importedTabs.get(tab.id);
			const model = { id: tab.id, url: live?.url || imported?.url || '', title: tab.title, favicon: live?.favicon, loading: live?.loading || this.loadingImportedTabs.has(tab.id) };
			if (model.url && model.url !== 'about:blank') { shortcuts.push({ id: model.id, url: model.url, title: tab.title, favicon: model.favicon }); }
			if (query && !`${tab.title} ${model.url}`.toLowerCase().includes(query)) { continue; }
			const row = oldRows.get(model.id) ?? dom.$('.cleanSlate-browser-tab-row');
			oldRows.delete(model.id);
			if (row.parentElement && dirtyTabs && !dirtyTabs.has(model.id)) { continue; }
			row.dataset.tabId = model.id;
			row.classList.toggle('active', model.id === this.activeId);
			const button = row.querySelector<HTMLButtonElement>('[role="tab"]') ?? dom.append(row, dom.$('button.cleanSlate-browser-tab-select')) as HTMLButtonElement;
			button.type = 'button';
			button.setAttribute('role', 'tab');
			button.setAttribute('aria-selected', String(model.id === this.activeId));
			button.tabIndex = model.id === this.activeId ? 0 : -1;
			button.title = `${tab.title}\n${model.url}`;
			button.setAttribute('aria-label', tab.title);
			const icon = button.querySelector<HTMLElement>('.cleanSlate-browser-tab-icon') ?? dom.append(button, dom.$('span.cleanSlate-browser-tab-icon'));
			icon.className = 'cleanSlate-browser-tab-icon cleanSlate-browser-site-icon';
			if (model.loading) {
				dom.clearNode(icon);
				icon.className += ` ${ThemeIcon.asClassName(Codicon.loading)} codicon-modifier-spin`;
			} else { renderCleanSlateSiteIcon(icon, { url: model.url, title: tab.title, favicon: model.favicon }); }
			const label = button.querySelector<HTMLElement>('.cleanSlate-browser-tab-label') ?? dom.append(button, dom.$('span.cleanSlate-browser-tab-label'));
			label.textContent = tab.title;
			button.onclick = () => this.opened.fire({ id: model.id, background: false });
			button.onkeydown = event => {
				const ids = Array.from(this.sidebarTabs!.children).map(row => (row as HTMLElement).dataset.tabId!);
				const index = ids.indexOf(model.id);
				const next = event.key === 'ArrowDown' ? ids[(index + 1) % ids.length] : event.key === 'ArrowUp' ? ids[(index + ids.length - 1) % ids.length] : undefined;
				if (next) {
					event.preventDefault();
					this.opened.fire({ id: next, background: false });
					Array.from(this.sidebarTabs!.children).find(row => (row as HTMLElement).dataset.tabId === next)?.querySelector<HTMLElement>('[role="tab"]')?.focus();
				}
				if (event.key === 'Delete') { event.preventDefault(); this.closed.fire(model.id); }
			};
			const close = row.querySelector<HTMLButtonElement>('.cleanSlate-browser-tab-close') ?? dom.append(row, dom.$('button.cleanSlate-browser-tab-close')) as HTMLButtonElement;
			close.type = 'button';
			close.tabIndex = model.id === this.activeId ? 0 : -1;
			close.setAttribute('aria-label', localize('cleanSlate.browser.closeTab', 'Close {0}', tab.title));
			if (!close.firstChild) { dom.append(close, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.close)}`)); }
			close.onclick = () => this.closed.fire(model.id);
			if (!row.parentElement) { this.sidebarTabs.appendChild(row); }
		}
		for (const row of oldRows.values()) { row.remove(); }
		let empty = this.sidebarTabs.querySelector<HTMLElement>('.cleanSlate-browser-tabs-empty');
		if (query && !this.sidebarTabs.querySelector('[role="tab"]')) {
			empty ??= dom.append(this.sidebarTabs, dom.$('.cleanSlate-browser-tabs-empty'));
			empty.textContent = localize('cleanSlate.browser.noTabs', 'No matching tabs');
		}
		// Suggestions consume only their first few matches; never copy all history on a tab update.
		const self = this;
		this.startView?.setSites(function* () {
			yield* shortcuts.filter(site => site.id !== self.activeId);
			yield* self.pins;
			for (const bookmark of self.bookmarks) { yield { ...bookmark, kind: 'bookmark' as const }; }
			for (const page of self.history.entries()) { yield { ...page, kind: 'history' as const }; }
		});
		if (query !== this.libraryQuery) { this.bookmarksDirty = this.historyDirty = true; this.libraryQuery = query; }
		if (this.bookmarksDirty) { this.bookmarksDirty = false; this.renderBookmarks(query); }
		if (this.historyDirty) { this.historyDirty = false; this.renderHistory(query); }
		const pinsKey = JSON.stringify(this.pins);
		if (pinsKey === this.renderedPins) { return; }
		this.renderedPins = pinsKey;
		const oldPins = new Map(Array.from(this.pinnedSites.querySelectorAll<HTMLElement>('.cleanSlate-browser-pin-wrap')).map(pin => [pin.dataset.url, pin]));
		this.pinnedSites.querySelector('.cleanSlate-browser-pins-empty')?.remove();
		for (const pin of this.pins) {
			const wrap = oldPins.get(pin.url) ?? dom.append(this.pinnedSites, dom.$('.cleanSlate-browser-pin-wrap'));
			oldPins.delete(pin.url);
			wrap.dataset.url = pin.url;
			const button = wrap.querySelector<HTMLButtonElement>('.cleanSlate-browser-pin') ?? dom.append(wrap, dom.$('button.cleanSlate-browser-pin')) as HTMLButtonElement;
			button.type = 'button';
			button.title = pin.title;
			button.setAttribute('aria-label', localize('cleanSlate.browser.openPin', 'Open pinned site: {0}', pin.title));
			renderCleanSlateSiteIcon(button.querySelector<HTMLElement>('.cleanSlate-browser-site-icon') ?? dom.append(button, dom.$('.cleanSlate-browser-site-icon')), pin);
			const label = button.querySelector<HTMLElement>('.cleanSlate-browser-pin-label') ?? dom.append(button, dom.$('span.cleanSlate-browser-pin-label'));
			if (label.textContent !== pin.title) { label.textContent = pin.title; }
			button.onclick = () => {
				const existing = Array.from(this.models.values()).find(model => model.url === pin.url);
				if (existing) { this.opened.fire({ id: existing.id, background: false }); }
				else { void this.openTab(pin.url).catch(error => this.showError(error)); }
			};
			const remove = wrap.querySelector<HTMLButtonElement>('.cleanSlate-browser-unpin') ?? dom.append(wrap, dom.$('button.cleanSlate-browser-unpin')) as HTMLButtonElement;
			remove.type = 'button';
			remove.setAttribute('aria-label', localize('cleanSlate.browser.unpinNamedPage', 'Unpin {0}', pin.title));
			if (!remove.firstChild) { dom.append(remove, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.close)}`)); }
			remove.onclick = () => {
				this.pins = this.pins.filter(site => site.url !== pin.url);
				this.storage.store(this.pinsKey, JSON.stringify(this.pins), StorageScope.PROFILE, StorageTarget.MACHINE);
				this.renderSidebar();
				this.update();
			};
		}
		for (const pin of oldPins.values()) { pin.remove(); }
		if (!this.pins.length) {
			const hint = dom.append(this.pinnedSites, dom.$('.cleanSlate-browser-pins-empty'));
			dom.append(hint, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.pin)}`));
			dom.append(hint, dom.$('span')).textContent = localize('cleanSlate.browser.pinsHint', 'Pin your favorite pages here');
		}
	}

	private renderHistory(query: string): void {
		if (!this.historyList) { return; }
		if (!this.history.size) { dom.clearNode(this.historyList); return; }
		const details = this.historyList.querySelector<HTMLDetailsElement>('details') ?? dom.append(this.historyList, dom.$('details')) as HTMLDetailsElement;
		if (query) { details.open = true; }
		const summary = details.querySelector('summary') ?? dom.append(details, dom.$('summary'));
		this.librarySummary(details, summary, localize('cleanSlate.browser.historyCount', 'History ({0})', this.history.size), () => this.renderHistory(this.libraryQuery));
		const content = details.querySelector<HTMLElement>('.cleanSlate-browser-bookmark-content') ?? dom.append(details, dom.$('.cleanSlate-browser-bookmark-content'));
		details.ontoggle = () => this.renderHistory(this.libraryQuery);
		if (!details.open) { return; }
		const oldRows = this.savedRows(content);
		let count = 0;
		let next = content.firstElementChild;
		for (const page of this.history.entries()) {
			if (query && !`${page.title} ${page.url}`.toLowerCase().includes(query)) { continue; }
			if (count++ < 100) {
				const row = this.savedRow(oldRows, page, true);
				if (row !== next) { content.insertBefore(row, next); }
				next = row.nextElementSibling;
			}
			if (!query && count === 100) { count = this.history.size; break; }
		}
		for (const row of oldRows.values()) { row.remove(); }
		this.libraryHint(content, count, true);
	}

	private recordHistory(model: IBrowserViewModel): void {
		if (model.loading || model.error || !/^https?:\/\//i.test(model.url)) { return; }
		this.history.record(model.url, model.title);
	}

	private renderBookmarks(query: string): void {
		if (!this.bookmarkList) { return; }
		if (!this.bookmarks.length) { dom.clearNode(this.bookmarkList); return; }
		const library = this.bookmarkList.querySelector<HTMLDetailsElement>('details') ?? dom.append(this.bookmarkList, dom.$('details')) as HTMLDetailsElement;
		library.dataset.folder = 'library';
		if (query) { library.open = true; }
		const summary = library.querySelector('summary') ?? dom.append(library, dom.$('summary'));
		this.librarySummary(library, summary, localize('cleanSlate.browser.bookmarkCount', 'Bookmarks ({0})', this.bookmarks.length), () => this.renderBookmarks(this.libraryQuery));
		const content = library.querySelector<HTMLElement>('.cleanSlate-browser-bookmark-content') ?? dom.append(library, dom.$('.cleanSlate-browser-bookmark-content'));
		library.ontoggle = () => this.renderBookmarks(this.libraryQuery);
		if (!library.open) { return; }
		const matches = this.bookmarks.filter(bookmark => !query || `${bookmark.title} ${bookmark.url} ${bookmark.folders.join(' ')}`.toLowerCase().includes(query));
		const oldRows = this.savedRows(content);
		const oldFolders = new Map(Array.from(content.querySelectorAll<HTMLDetailsElement>('details')).map(folder => [folder.dataset.folder!, folder]));
		const folders = new Map<string, HTMLElement>([['', content]]);
		for (const bookmark of matches.slice(0, 100)) {
			let parent = content;
			for (let depth = 0; depth < bookmark.folders.length; depth++) {
				const key = JSON.stringify(bookmark.folders.slice(0, depth + 1));
				let folder = folders.get(key);
				if (!folder) {
					const details = oldFolders.get(key) ?? dom.$('details') as HTMLDetailsElement;
					oldFolders.delete(key);
					details.dataset.folder = key;
					if (query) { details.open = true; }
					const label = details.querySelector('summary') ?? dom.append(details, dom.$('summary'));
					this.librarySummary(details, label, bookmark.folders[depth]);
					folder = details.querySelector<HTMLElement>('.cleanSlate-browser-bookmark-folder') ?? dom.append(details, dom.$('.cleanSlate-browser-bookmark-folder'));
					if (details.parentElement !== parent) { parent.appendChild(details); }
					folders.set(key, folder);
				}
				parent = folder;
			}
			const row = this.savedRow(oldRows, bookmark, false);
			if (row.parentElement !== parent) { parent.appendChild(row); }
		}
		for (const row of oldRows.values()) { row.remove(); }
		for (const folder of oldFolders.values()) { folder.remove(); }
		this.libraryHint(content, matches.length, false);
	}

	private librarySummary(details: HTMLDetailsElement, summary: HTMLElement, title: string, render?: () => void): void {
		const icon = summary.querySelector<HTMLElement>('.codicon') ?? dom.append(summary, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.chevronRight)}`));
		icon.setAttribute('aria-hidden', 'true');
		const label = summary.querySelector<HTMLElement>('.cleanSlate-browser-library-label') ?? dom.append(summary, dom.$('span.cleanSlate-browser-library-label'));
		label.textContent = title;
		// Install once so rerenders preserve an in-flight animation and its target state.
		if (summary.onclick) { return; }
		let animation: Animation | undefined;
		let expanded = details.open;
		summary.onclick = event => {
			event.preventDefault();
			expanded = animation ? !expanded : !details.open;
			const from = details.getBoundingClientRect().height;
			animation?.cancel();
			details.open = true;
			render?.();
			const to = expanded ? details.getBoundingClientRect().height : summary.getBoundingClientRect().height;
			details.classList.toggle('cleanSlate-browser-library-collapsing', !expanded);
			const finish = () => {
				details.open = expanded;
				details.classList.remove('cleanSlate-browser-library-collapsing');
				animation = undefined;
			};
			if (dom.getWindow(details).matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
			animation = details.animate([{ height: `${from}px`, overflow: 'hidden' }, { height: `${to}px`, overflow: 'hidden' }], { duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
			animation.onfinish = finish;
		};
	}

	private savedRows(content: HTMLElement): Map<string, HTMLElement> {
		return new Map(Array.from(content.querySelectorAll<HTMLElement>('.cleanSlate-browser-bookmark-row')).map(row => [row.dataset.url!, row]));
	}

	private savedRow(rows: Map<string, HTMLElement>, page: ICleanSlateBrowserShortcut, history: boolean): HTMLElement {
		const row = rows.get(page.url) ?? dom.$('.cleanSlate-browser-bookmark-row');
		rows.delete(page.url);
		row.dataset.url = page.url;
		const button = row.querySelector<HTMLButtonElement>('.cleanSlate-browser-bookmark') ?? dom.append(row, dom.$('button.cleanSlate-browser-bookmark')) as HTMLButtonElement;
		button.type = 'button'; button.title = page.url;
		const icon = button.querySelector<HTMLElement>('.cleanSlate-browser-site-icon') ?? dom.append(button, dom.$('span.cleanSlate-browser-site-icon'));
		renderCleanSlateSiteIcon(icon, page);
		const label = button.querySelector<HTMLElement>('.cleanSlate-browser-tab-label') ?? dom.append(button, dom.$('span.cleanSlate-browser-tab-label'));
		if (label.textContent !== page.title) { label.textContent = page.title; }
		button.onclick = () => {
			const existing = Array.from(this.models.values()).find(model => model.url === page.url);
			if (existing) { this.opened.fire({ id: existing.id, background: false }); }
			else { void this.openTab(page.url).catch(error => this.showError(error)); }
		};
		const remove = row.querySelector<HTMLButtonElement>('.cleanSlate-browser-bookmark-remove') ?? dom.append(row, dom.$('button.cleanSlate-browser-bookmark-remove')) as HTMLButtonElement;
		remove.type = 'button';
		remove.setAttribute('aria-label', history ? localize('cleanSlate.browser.removeHistory', 'Remove from history: {0}', page.title) : localize('cleanSlate.browser.removeBookmark', 'Remove bookmark: {0}', page.title));
		if (!remove.firstChild) { dom.append(remove, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.close)}`)); }
		remove.onclick = () => {
			if (history) { this.history.remove(page.url); }
			else { this.storage.store(cleanSlateBrowserBookmarksKey, JSON.stringify(this.bookmarks.filter(item => item.url !== page.url)), StorageScope.PROFILE, StorageTarget.MACHINE); }
		};
		return row;
	}

	private libraryHint(content: HTMLElement, count: number, history: boolean): void {
		let hint = content.querySelector<HTMLParagraphElement>(':scope > p');
		if (count > 0 && count <= 100) { hint?.remove(); return; }
		hint ??= dom.append(content, dom.$('p'));
		hint.textContent = count === 0
			? history ? localize('cleanSlate.browser.noHistory', 'No matching history') : localize('cleanSlate.browser.noBookmarks', 'No matching bookmarks')
			: history ? localize('cleanSlate.browser.moreHistory', 'Showing 100 of {0}. Search to find a page.', count) : localize('cleanSlate.browser.moreBookmarks', 'Showing 100 of {0}. Search to find a bookmark.', count);
	}

	private showError(error: unknown): void {
		this.layoutVersion++;
		if (!this.message) { return; }
		this.message.hidden = false;
		if (this.startView) { this.startView.element.hidden = true; }
		if (this.address?.parentElement) { this.address.parentElement.hidden = false; }
		dom.clearNode(this.message);
		dom.append(this.message, dom.$('h2')).textContent = localize('cleanSlate.browser.loadFailed', 'Could not load this page');
		dom.append(this.message, dom.$('p')).textContent = error instanceof Error ? error.message : String(error);
		this.button(this.message, Codicon.edit, localize('cleanSlate.browser.editAddress', 'Edit address'), () => this.focusAddress());
		const model = this.activeId ? this.models.get(this.activeId) : undefined;
		if (model) { void model.setVisible(false); }
	}

	private button(parent: HTMLElement, icon: ThemeIcon, label: string, onClick: () => void): HTMLButtonElement {
		const button = dom.append(parent, dom.$('button.cleanSlate-agent-manager-browser-button')) as HTMLButtonElement;
		button.type = 'button';
		button.title = label;
		button.setAttribute('aria-label', label);
		dom.append(button, dom.$(`span${ThemeIcon.asCSSSelector(icon)}`));
		button.onclick = onClick;
		return button;
	}

	override dispose(): void {
		this.disposed = true;
		this.setVisible(false);
		if (this.layoutFrame !== undefined) { this.targetWindow?.cancelAnimationFrame(this.layoutFrame); }
		if (this.updateFrame !== undefined) { this.targetWindow?.cancelAnimationFrame(this.updateFrame); }
		for (const id of this.models.keys()) { this.closeTab(id); }
		this.root?.remove();
		this.sidebar?.remove();
		super.dispose();
	}
}
