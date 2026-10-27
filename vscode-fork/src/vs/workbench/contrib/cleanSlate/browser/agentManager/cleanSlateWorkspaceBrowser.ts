/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { getZoomFactor } from '../../../../../base/browser/browser.js';
import { CodeWindow } from '../../../../../base/browser/window.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../../base/common/platform.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { localize } from '../../../../../nls.js';
import { BrowserViewUri } from '../../../../../platform/browserView/common/browserViewUri.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IBrowserViewModel, IBrowserViewWorkbenchService } from '../../../browserView/common/browserView.js';
import { ICleanSlateThreadTab } from './cleanSlateAgentManagerThreadTabsView.js';
import { resolveCleanSlateBrowserAddress } from './cleanSlateBrowserAddress.js';
import { CleanSlateBrowserStartView, cleanSlateStoredFavicon, ICleanSlateBrowserShortcut, renderCleanSlateSiteIcon } from './cleanSlateBrowserStartView.js';

/** Owns the native pages shown by browser tabs in the main workspace. */
export class CleanSlateWorkspaceBrowser extends Disposable {
	private readonly pinsKey = 'cleanSlate.browser.pinnedSites';
	private pins: ICleanSlateBrowserShortcut[] = [];
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
	private root: HTMLElement | undefined;
	private sidebar: HTMLElement | undefined;
	private sidebarTabs: HTMLElement | undefined;
	private pinnedSites: HTMLElement | undefined;
	private startView: CleanSlateBrowserStartView | undefined;
	private tabSearch: HTMLInputElement | undefined;
	private tabCount: HTMLElement | undefined;
	private pinButton: HTMLButtonElement | undefined;
	private viewport: HTMLElement | undefined;
	private address: HTMLInputElement | undefined;
	private back: HTMLButtonElement | undefined;
	private forward: HTMLButtonElement | undefined;
	private reload: HTMLButtonElement | undefined;
	private message: HTMLElement | undefined;
	private targetWindow: CodeWindow | undefined;
	private activeId: string | undefined;
	private visible = false;
	private layoutVersion = 0;
	private navigationVersion = 0;
	private layoutFrame: number | undefined;
	private disposed = false;

	constructor(private readonly service: IBrowserViewWorkbenchService, private readonly storage: IStorageService) {
		super();
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

	mount(parent: HTMLElement, sidebarHost: HTMLElement): void {
		this.setVisible(false);
		this.viewDisposables.clear();
		this.root?.remove();
		this.sidebar?.remove();
		this.targetWindow = dom.getWindow(parent);
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
		this.tabSearch.placeholder = localize('cleanSlate.browser.searchTabs', 'Search tabs');
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
		const observer = new this.targetWindow.ResizeObserver(() => this.layout());
		observer.observe(viewport);
		this.viewDisposables.add({ dispose: () => observer.disconnect() });
		this.viewDisposables.add(dom.addDisposableListener(this.targetWindow, 'keydown', event => {
			if (this.visible && this.handleKey(event as KeyboardEvent)) {
				event.preventDefault();
				event.stopPropagation();
			}
		}, true));
		this.update();
		this.renderSidebar();
	}

	hasTab(id: string): boolean { return this.models.has(id); }

	getTabs(): ICleanSlateThreadTab[] {
		return Array.from(this.models.values(), model => ({
			id: model.id,
			title: model.title || (model.url && model.url !== 'about:blank' ? model.url : localize('cleanSlate.browser.newTab', 'New browser tab')),
			running: model.loading,
			browser: true
		}));
	}

	async openTab(url?: string): Promise<void> {
		const model = await this.service.getOrCreateBrowserViewModel(`cleanslate.workspace.browser.${generateUuid()}`);
		if (this.disposed) { model.dispose(); return; }
		this.track(model, false);
		if (url) {
			try { await model.loadURL(url); }
			catch (error) { if (this.activeId === model.id) { this.showError(error); } }
		}
	}

	activate(id: string): void {
		if (!this.models.has(id)) { return; }
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
	}

	closeTab(id: string): void {
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
		this.layoutVersion++;
		if (this.root) { this.root.hidden = !visible; }
		if (!visible) {
			for (const model of this.models.values()) { void model.setVisible(false); }
		} else {
			this.update();
			this.layout();
			const model = this.activeId ? this.models.get(this.activeId) : undefined;
			if (!model?.url || model.url === 'about:blank') { this.focusAddress(); }
		}
	}

	focusAddress(): void {
		if (this.startView && !this.startView.element.hidden) { this.startView.focus(); }
		else { this.address?.focus(); this.address?.select(); }
	}

	layout(): void {
		if (!this.visible || !this.targetWindow) { return; }
		if (this.layoutFrame !== undefined) { this.targetWindow.cancelAnimationFrame(this.layoutFrame); }
		this.layoutFrame = this.targetWindow.requestAnimationFrame(() => {
			this.layoutFrame = undefined;
			void this.layoutPage().catch(error => this.showError(error));
		});
	}

	private async layoutPage(): Promise<void> {
		const model = this.activeId ? this.models.get(this.activeId) : undefined;
		const win = this.targetWindow;
		if (!model || !win || !this.viewport?.isConnected || !this.visible) { return; }
		if (!model.url || model.url === 'about:blank' || model.error) { await model.setVisible(false); return; }
		const version = ++this.layoutVersion;
		const rect = this.viewport.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) { await model.setVisible(false); return; }
		await model.layout({ windowId: win.vscodeWindowId, x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height), zoomFactor: getZoomFactor(win) });
		if (version !== this.layoutVersion || !this.visible || this.activeId !== model.id) { return; }
		await model.setVisible(true);
		if (version !== this.layoutVersion || !this.visible || this.activeId !== model.id) { await model.setVisible(false); return; }
		await model.bringToFront();
	}

	private track(model: IBrowserViewModel, background: boolean): void {
		if (this.models.has(model.id)) { return; }
		this.models.set(model.id, model);
		const store = new DisposableStore();
		this.listeners.set(model.id, store);
		const update = () => { if (this.activeId === model.id) { this.update(); this.layout(); } this.renderSidebar(); this.changed.fire(); };
		store.add(model.onDidChangeNavigationState(update));
		store.add(model.onDidChangeLoadingState(update));
		store.add(model.onDidChangeTitle(() => { this.refreshPin(model); update(); }));
		store.add(model.onDidChangeFavicon(() => { this.refreshPin(model); update(); }));
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
		const empty = !model || !model.url || model.url === 'about:blank';
		this.root.classList.toggle('new-tab', empty);
		if (this.startView) { this.startView.element.hidden = !empty; }
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
		const index = this.pins.findIndex(pin => pin.url === model.url);
		if (index < 0) { return; }
		const pin = this.pins[index];
		const favicon = cleanSlateStoredFavicon(model.favicon) ?? pin.favicon;
		const title = model.title || pin.title;
		if (favicon === pin.favicon && title === pin.title) { return; }
		this.pins[index] = { url: pin.url, title, favicon };
		this.storage.store(this.pinsKey, JSON.stringify(this.pins), StorageScope.PROFILE, StorageTarget.MACHINE);
	}

	private renderSidebar(): void {
		if (!this.sidebarTabs || !this.pinnedSites) { return; }
		const query = this.tabSearch?.value.trim().toLowerCase() ?? '';
		if (this.tabCount) { this.tabCount.textContent = String(this.models.size); }
		const oldRows = new Map(Array.from(this.sidebarTabs.children).map(row => [(row as HTMLElement).dataset.tabId, row as HTMLElement]));
		const shortcuts: ICleanSlateBrowserShortcut[] = [];
		for (const model of this.models.values()) {
			const tab = this.getTabs().find(tab => tab.id === model.id)!;
			if (model.url && model.url !== 'about:blank') { shortcuts.push({ id: model.id, url: model.url, title: tab.title, favicon: model.favicon }); }
			if (query && !`${tab.title} ${model.url}`.toLowerCase().includes(query)) { continue; }
			const row = oldRows.get(model.id) ?? dom.$('.cleanSlate-browser-tab-row');
			oldRows.delete(model.id);
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
		const urls = new Set(shortcuts.map(site => site.url));
		this.startView?.setSites([...shortcuts.filter(site => site.id !== this.activeId), ...this.pins.filter(pin => !urls.has(pin.url))]);
		const pinsKey = JSON.stringify(this.pins);
		if (pinsKey === this.renderedPins) { return; }
		this.renderedPins = pinsKey;
		dom.clearNode(this.pinnedSites);
		for (const pin of this.pins) {
			const wrap = dom.append(this.pinnedSites, dom.$('.cleanSlate-browser-pin-wrap'));
			const button = dom.append(wrap, dom.$('button.cleanSlate-browser-pin')) as HTMLButtonElement;
			button.type = 'button';
			button.title = pin.title;
			button.setAttribute('aria-label', localize('cleanSlate.browser.openPin', 'Open pinned site: {0}', pin.title));
			renderCleanSlateSiteIcon(dom.append(button, dom.$('.cleanSlate-browser-site-icon')), pin);
			dom.append(button, dom.$('span.cleanSlate-browser-pin-label')).textContent = pin.title;
			button.onclick = () => {
				const existing = Array.from(this.models.values()).find(model => model.url === pin.url);
				if (existing) { this.opened.fire({ id: existing.id, background: false }); }
				else { void this.openTab(pin.url).catch(error => this.showError(error)); }
			};
			const remove = dom.append(wrap, dom.$('button.cleanSlate-browser-unpin')) as HTMLButtonElement;
			remove.type = 'button';
			remove.setAttribute('aria-label', localize('cleanSlate.browser.unpinNamedPage', 'Unpin {0}', pin.title));
			dom.append(remove, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.close)}`));
			remove.onclick = () => {
				this.pins = this.pins.filter(site => site.url !== pin.url);
				this.storage.store(this.pinsKey, JSON.stringify(this.pins), StorageScope.PROFILE, StorageTarget.MACHINE);
				this.renderSidebar();
				this.update();
			};
		}
		if (!this.pins.length) {
			const hint = dom.append(this.pinnedSites, dom.$('.cleanSlate-browser-pins-empty'));
			dom.append(hint, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.pin)}`));
			dom.append(hint, dom.$('span')).textContent = localize('cleanSlate.browser.pinsHint', 'Pin your favorite pages here');
		}
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
		for (const id of this.models.keys()) { this.closeTab(id); }
		this.root?.remove();
		this.sidebar?.remove();
		super.dispose();
	}
}
