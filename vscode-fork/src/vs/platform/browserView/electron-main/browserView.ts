/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebContentsView, webContents } from 'electron';
import { FileAccess } from '../../../base/common/network.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { IBrowserViewBounds, IBrowserViewConsoleEntry, IBrowserViewDevToolsStateEvent, IBrowserViewDiagnostics, IBrowserViewDownloadEntry, IBrowserViewFocusEvent, IBrowserViewKeyDownEvent, IBrowserViewState, IBrowserViewNavigationEvent, IBrowserViewLoadingEvent, IBrowserViewLoadError, IBrowserViewTitleChangeEvent, IBrowserViewFaviconChangeEvent, IBrowserViewNetworkEntry, IBrowserViewNewPageRequest, BrowserViewStorageScope, IBrowserViewCaptureScreenshotOptions, IBrowserViewFindInPageOptions, IBrowserViewFindInPageResult, IBrowserViewVisibilityEvent, BrowserNewPageLocation, browserViewIsolatedWorldId, IBrowserViewMouseEvent } from '../common/browserView.js';
import { EVENT_KEY_CODE_MAP, KeyCode, KeyMod, SCAN_CODE_STR_TO_EVENT_KEY_CODE } from '../../../base/common/keyCodes.js';
import { IWindowsMainService } from '../../windows/electron-main/windows.js';
import { IBaseWindow, ICodeWindow } from '../../window/electron-main/window.js';
import { IAuxiliaryWindowsMainService } from '../../auxiliaryWindow/electron-main/auxiliaryWindows.js';
import { IAuxiliaryWindow } from '../../auxiliaryWindow/electron-main/auxiliaryWindow.js';
import { isMacintosh } from '../../../base/common/platform.js';
import { BrowserViewUri } from '../common/browserViewUri.js';

/** Key combinations that are used in system-level shortcuts. */
const nativeShortcuts = new Set([
	KeyMod.CtrlCmd | KeyCode.KeyA,
	KeyMod.CtrlCmd | KeyCode.KeyC,
	KeyMod.CtrlCmd | KeyCode.KeyV,
	KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyV,
	KeyMod.CtrlCmd | KeyCode.KeyX,
	...(isMacintosh ? [] : [KeyMod.CtrlCmd | KeyCode.KeyY]),
	KeyMod.CtrlCmd | KeyCode.KeyZ,
	KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyZ
]);

/**
 * Painted wherever the page has not, so it shows as a seam beside the scrollbar and as
 * a flash before a page's first paint. White reads as a bright tear in the browser
 * pane, so this tracks the surrounding dark chrome instead.
 */
const VIEW_BACKGROUND_COLOR = '#1F1F1F';

/**
 * Pages that style themselves dark but never declare `color-scheme` get Chromium's
 * default light scrollbar. Default it to a neutral thumb instead. Kept in sync with the
 * copy in `preload-browserView.ts`, which applies it earlier (before first paint); this
 * is the backstop for documents where the preload injection does not stick.
 */
const DEFAULT_SCROLLBAR_CSS = ':root { scrollbar-color: rgba(135, 135, 135, 0.55) transparent; }';

/**
 * Represents a single browser view instance with its WebContentsView and all associated logic.
 * This class encapsulates all operations and events for a single browser view.
 */
export class BrowserView extends Disposable {
	private readonly _view: WebContentsView;
	private readonly _faviconRequestCache = new Map<string, Promise<string>>();

	private _lastScreenshot: VSBuffer | undefined = undefined;
	private _lastFavicon: string | undefined = undefined;
	private _lastError: IBrowserViewLoadError | undefined = undefined;
	private _lastUserGestureTimestamp: number = -Infinity;
	private _automationPointerPoint: { x: number; y: number } | undefined;
	private readonly _consoleEntries: IBrowserViewConsoleEntry[] = [];
	private readonly _networkEntries = new Map<number, IBrowserViewNetworkEntry>();
	private readonly _downloadEntries = new Map<string, IBrowserViewDownloadEntry>();

	private _window: IBaseWindow | undefined;
	private _isSendingKeyEvent = false;

	private readonly _onDidNavigate = this._register(new Emitter<IBrowserViewNavigationEvent>());
	readonly onDidNavigate: Event<IBrowserViewNavigationEvent> = this._onDidNavigate.event;

	private readonly _onDidChangeLoadingState = this._register(new Emitter<IBrowserViewLoadingEvent>());
	readonly onDidChangeLoadingState: Event<IBrowserViewLoadingEvent> = this._onDidChangeLoadingState.event;

	private readonly _onDidChangeFocus = this._register(new Emitter<IBrowserViewFocusEvent>());
	readonly onDidChangeFocus: Event<IBrowserViewFocusEvent> = this._onDidChangeFocus.event;

	private readonly _onDidChangeVisibility = this._register(new Emitter<IBrowserViewVisibilityEvent>());
	readonly onDidChangeVisibility: Event<IBrowserViewVisibilityEvent> = this._onDidChangeVisibility.event;

	private readonly _onDidChangeDevToolsState = this._register(new Emitter<IBrowserViewDevToolsStateEvent>());
	readonly onDidChangeDevToolsState: Event<IBrowserViewDevToolsStateEvent> = this._onDidChangeDevToolsState.event;

	private readonly _onDidKeyCommand = this._register(new Emitter<IBrowserViewKeyDownEvent>());
	readonly onDidKeyCommand: Event<IBrowserViewKeyDownEvent> = this._onDidKeyCommand.event;

	private readonly _onDidChangeTitle = this._register(new Emitter<IBrowserViewTitleChangeEvent>());
	readonly onDidChangeTitle: Event<IBrowserViewTitleChangeEvent> = this._onDidChangeTitle.event;

	private readonly _onDidChangeFavicon = this._register(new Emitter<IBrowserViewFaviconChangeEvent>());
	readonly onDidChangeFavicon: Event<IBrowserViewFaviconChangeEvent> = this._onDidChangeFavicon.event;

	private readonly _onDidRequestNewPage = this._register(new Emitter<IBrowserViewNewPageRequest>());
	readonly onDidRequestNewPage: Event<IBrowserViewNewPageRequest> = this._onDidRequestNewPage.event;

	private readonly _onDidFindInPage = this._register(new Emitter<IBrowserViewFindInPageResult>());
	readonly onDidFindInPage: Event<IBrowserViewFindInPageResult> = this._onDidFindInPage.event;

	private readonly _onDidClose = this._register(new Emitter<void>());
	readonly onDidClose: Event<void> = this._onDidClose.event;

	constructor(
		public readonly id: string,
		private readonly viewSession: Electron.Session,
		private readonly storageScope: BrowserViewStorageScope,
		createChildView: (options?: Electron.WebContentsViewConstructorOptions) => BrowserView,
		options: Electron.WebContentsViewConstructorOptions | undefined,
		@IWindowsMainService private readonly windowsMainService: IWindowsMainService,
		@IAuxiliaryWindowsMainService private readonly auxiliaryWindowsMainService: IAuxiliaryWindowsMainService
	) {
		super();

		const webPreferences: Electron.WebPreferences & { type: ReturnType<Electron.WebContents['getType']> } = {
			...options?.webPreferences,

			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			webviewTag: false,
			session: viewSession,
			preload: FileAccess.asFileUri('vs/platform/browserView/electron-browser/preload-browserView.js').fsPath,

			// TODO@kycutler: Remove this once https://github.com/electron/electron/issues/42578 is fixed
			type: 'browserView'
		};

		this._view = new WebContentsView({
			webPreferences,
			// Passing an `undefined` webContents triggers an error in Electron.
			...(options?.webContents ? { webContents: options.webContents } : {})
		});
		this._view.setBackgroundColor(VIEW_BACKGROUND_COLOR);
		this.installAutomationIdentity();

		this._view.webContents.setWindowOpenHandler((details) => {
			const location = (() => {
				switch (details.disposition) {
					case 'background-tab': return BrowserNewPageLocation.Background;
					case 'foreground-tab': return BrowserNewPageLocation.Foreground;
					case 'new-window': return BrowserNewPageLocation.NewWindow;
					default: return undefined;
				}
			})();

			if (!location || !this.consumePopupPermission(location)) {
				// Eventually we may want to surface this. For now, just silently block it.
				return { action: 'deny' };
			}

			return {
				action: 'allow',
				createWindow: (options) => {
					const childView = createChildView(options);
					const resource = BrowserViewUri.forUrl(details.url, childView.id);

					// Fire event for the workbench to open this view
					this._onDidRequestNewPage.fire({
						resource,
						location,
						position: { x: options.x, y: options.y, width: options.width, height: options.height }
					});

					// Return the webContents so Electron can complete the window.open() call
					return childView.webContents;
				}
			};
		});

		this._view.webContents.on('destroyed', () => {
			this._onDidClose.fire();
		});

		this.setupEventListeners();
	}

	private installAutomationIdentity(): void {
		const script = `Object.defineProperty(globalThis, '__cleanSlateBrowserViewId', {
			value: ${JSON.stringify(this.id)},
			configurable: true,
			enumerable: false
		})`;
		const applyIdentity = () => {
			void this._view.webContents.executeJavaScript(script, true).catch(() => undefined);
		};
		this._view.webContents.on('did-frame-finish-load', (_event, isMainFrame) => {
			if (isMainFrame) {
				applyIdentity();
			}
		});
		applyIdentity();
	}

	private setupEventListeners(): void {
		const webContents = this._view.webContents;

		webContents.on('console-message', details => {
			this._consoleEntries.push({
				level: details.level,
				message: details.message,
				sourceId: details.sourceId,
				lineNumber: details.lineNumber,
				timestamp: Date.now()
			});
			this.trimDiagnostics();
		});

		// DevTools state events
		webContents.on('devtools-opened', () => {
			this._onDidChangeDevToolsState.fire({ isDevToolsOpen: true });
		});

		webContents.on('devtools-closed', () => {
			this._onDidChangeDevToolsState.fire({ isDevToolsOpen: false });
		});

		// Favicon events
		webContents.on('page-favicon-updated', async (_event, favicons) => {
			if (!favicons || favicons.length === 0) {
				return;
			}

			const found = favicons.find(f => this._faviconRequestCache.get(f));
			if (found) {
				// already have a cached request for this favicon, use it
				this._lastFavicon = await this._faviconRequestCache.get(found)!;
				this._onDidChangeFavicon.fire({ favicon: this._lastFavicon });
				return;
			}

			// try each url in order until one works
			for (const url of favicons) {
				const request = (async () => {
					const response = await webContents.session.fetch(url, {
						cache: 'force-cache'
					});
					const type = await response.headers.get('content-type');
					const buffer = await response.arrayBuffer();

					return `data:${type};base64,${Buffer.from(buffer).toString('base64')}`;
				})();

				this._faviconRequestCache.set(url, request);

				try {
					this._lastFavicon = await request;
					this._onDidChangeFavicon.fire({ favicon: this._lastFavicon });
					// On success, leave the promise in the cache and stop looping
					return;
				} catch (e) {
					this._faviconRequestCache.delete(url);
					// On failure, try the next one
				}
			}
		});

		// Title events
		webContents.on('page-title-updated', (_event, title) => {
			this._onDidChangeTitle.fire({ title });
		});

		const fireNavigationEvent = () => {
			this._onDidNavigate.fire({
				url: webContents.getURL(),
				canGoBack: webContents.navigationHistory.canGoBack(),
				canGoForward: webContents.navigationHistory.canGoForward()
			});
		};

		const fireLoadingEvent = (loading: boolean) => {
			this._onDidChangeLoadingState.fire({ loading, error: this._lastError });
		};

		// Loading state events
		webContents.on('did-start-loading', () => {
			this._lastError = undefined;
			fireLoadingEvent(true);
		});
		webContents.on('did-stop-loading', () => fireLoadingEvent(false));
		webContents.on('did-fail-load', (e, errorCode, errorDescription, validatedURL, isMainFrame) => {
			if (isMainFrame) {
				// Ignore ERR_ABORTED (-3) which is the expected error when user stops a page load.
				if (errorCode === -3) {
					fireLoadingEvent(false);
					return;
				}

				this._lastError = {
					url: validatedURL,
					errorCode,
					errorDescription
				};

				fireLoadingEvent(false);
				this._onDidNavigate.fire({
					url: validatedURL,
					canGoBack: webContents.navigationHistory.canGoBack(),
					canGoForward: webContents.navigationHistory.canGoForward()
				});
			}
		});
		webContents.on('did-finish-load', () => fireLoadingEvent(false));

		// Re-applied per document: injected stylesheets do not survive a navigation.
		webContents.on('dom-ready', () => {
			webContents.insertCSS(DEFAULT_SCROLLBAR_CSS).catch(() => undefined);
		});

		webContents.on('render-process-gone', (_event, details) => {
			this._lastError = {
				url: webContents.getURL(),
				errorCode: details.exitCode,
				errorDescription: `Render process gone: ${details.reason}`
			};

			fireLoadingEvent(false);
		});

		// Navigation events (when URL actually changes)
		webContents.on('did-navigate', fireNavigationEvent);
		webContents.on('did-navigate-in-page', fireNavigationEvent);

		// Focus events
		webContents.on('focus', () => {
			this._onDidChangeFocus.fire({ focused: true });
		});

		webContents.on('blur', () => {
			this._onDidChangeFocus.fire({ focused: false });
		});

		// Key down events - listen for raw key input events
		webContents.on('before-input-event', async (event, input) => {
			if (input.type === 'keyDown' && !this._isSendingKeyEvent) {
				if (this.tryHandleCommand(input)) {
					event.preventDefault();
				}
			}
		});

		// Track user gestures for popup blocking logic.
		// Roughly based on https://html.spec.whatwg.org/multipage/interaction.html#tracking-user-activation.
		webContents.on('input-event', (_event, input) => {
			switch (input.type) {
				case 'rawKeyDown':
				case 'keyDown':
				case 'mouseDown':
				case 'pointerDown':
				case 'pointerUp':
				case 'touchEnd':
					this._lastUserGestureTimestamp = Date.now();
			}
		});

		// For now, always prevent sites from blocking unload.
		// In the future we may want to show a dialog to ask the user,
		// with heavy restrictions regarding interaction and repeated prompts.
		webContents.on('will-prevent-unload', (e) => {
			e.preventDefault();
		});

		// Find in page events
		webContents.on('found-in-page', (_event, result) => {
			this._onDidFindInPage.fire({
				activeMatchOrdinal: result.activeMatchOrdinal,
				matches: result.matches,
				selectionArea: result.selectionArea,
				finalUpdate: result.finalUpdate
			});
		});
	}

	recordNetworkStart(details: Pick<Electron.OnBeforeRequestListenerDetails, 'id' | 'url' | 'method' | 'resourceType' | 'timestamp'>): void {
		this._networkEntries.set(details.id, {
			id: details.id,
			url: details.url,
			method: details.method,
			resourceType: details.resourceType,
			startedAt: details.timestamp
		});
		this.trimDiagnostics();
	}

	recordNetworkComplete(details: Pick<Electron.OnCompletedListenerDetails, 'id' | 'url' | 'method' | 'resourceType' | 'timestamp' | 'statusCode' | 'fromCache' | 'error'>): void {
		const started = this._networkEntries.get(details.id);
		this._networkEntries.set(details.id, {
			id: details.id,
			url: details.url,
			method: details.method,
			resourceType: details.resourceType,
			startedAt: started?.startedAt ?? details.timestamp,
			completedAt: details.timestamp,
			durationMs: started ? Math.max(0, details.timestamp - started.startedAt) : undefined,
			statusCode: details.statusCode,
			fromCache: details.fromCache,
			error: details.error || undefined
		});
		this.trimDiagnostics();
	}

	recordNetworkError(details: Pick<Electron.OnErrorOccurredListenerDetails, 'id' | 'url' | 'method' | 'resourceType' | 'timestamp' | 'error'>): void {
		const started = this._networkEntries.get(details.id);
		this._networkEntries.set(details.id, {
			id: details.id,
			url: details.url,
			method: details.method,
			resourceType: details.resourceType,
			startedAt: started?.startedAt ?? details.timestamp,
			completedAt: details.timestamp,
			durationMs: started ? Math.max(0, details.timestamp - started.startedAt) : undefined,
			error: details.error
		});
		this.trimDiagnostics();
	}

	recordDownload(item: Electron.DownloadItem): void {
		const id = `${Date.now()}-${item.getFilename()}`;
		const entry: IBrowserViewDownloadEntry = {
			id,
			url: item.getURL(),
			filename: item.getFilename(),
			savePath: item.getSavePath() || undefined,
			state: 'progressing',
			receivedBytes: item.getReceivedBytes(),
			totalBytes: item.getTotalBytes(),
			startedAt: Date.now()
		};
		this._downloadEntries.set(id, entry);
		item.on('updated', (_event, state) => {
			entry.state = state === 'interrupted' ? 'interrupted' : 'progressing';
			entry.receivedBytes = item.getReceivedBytes();
			entry.totalBytes = item.getTotalBytes();
			entry.savePath = item.getSavePath() || entry.savePath;
		});
		item.once('done', (_event, state) => {
			entry.state = state;
			entry.receivedBytes = item.getReceivedBytes();
			entry.totalBytes = item.getTotalBytes();
			entry.savePath = item.getSavePath() || entry.savePath;
			entry.completedAt = Date.now();
			this.trimDiagnostics();
		});
		this.trimDiagnostics();
	}

	getDiagnostics(clear = false): IBrowserViewDiagnostics {
		const result = {
			console: [...this._consoleEntries],
			network: Array.from(this._networkEntries.values()),
			downloads: Array.from(this._downloadEntries.values())
		};
		if (clear) {
			this._consoleEntries.length = 0;
			this._networkEntries.clear();
			this._downloadEntries.clear();
		}
		return result;
	}

	async setFileInputFiles(selector: string, files: string[]): Promise<void> {
		const targetSelector = selector.trim();
		if (!targetSelector) {
			throw new Error('A file input selector is required.');
		}
		if (files.length === 0 || files.some(file => !file.trim())) {
			throw new Error('At least one concrete file path is required.');
		}
		const browserDebugger = this._view.webContents.debugger;
		const attachedHere = !browserDebugger.isAttached();
		if (attachedHere) {
			browserDebugger.attach('1.3');
		}
		try {
			await browserDebugger.sendCommand('DOM.enable');
			const documentResult = await browserDebugger.sendCommand('DOM.getDocument', { depth: 0, pierce: true }) as { root?: { nodeId?: number } };
			const rootNodeId = documentResult.root?.nodeId;
			if (typeof rootNodeId !== 'number') {
				throw new Error('Unable to resolve the live browser document.');
			}
			const queryResult = await browserDebugger.sendCommand('DOM.querySelector', { nodeId: rootNodeId, selector: targetSelector }) as { nodeId?: number };
			if (!queryResult.nodeId) {
				throw new Error(`No file input matched ${targetSelector}.`);
			}
			await browserDebugger.sendCommand('DOM.setFileInputFiles', { nodeId: queryResult.nodeId, files });
		} finally {
			if (attachedHere && browserDebugger.isAttached()) {
				browserDebugger.detach();
			}
		}
	}

	async handleJavaScriptDialog(accept: boolean, promptText?: string): Promise<void> {
		const browserDebugger = this._view.webContents.debugger;
		const attachedHere = !browserDebugger.isAttached();
		if (attachedHere) {
			browserDebugger.attach('1.3');
		}
		try {
			await browserDebugger.sendCommand('Page.handleJavaScriptDialog', {
				accept,
				...(typeof promptText === 'string' ? { promptText } : {})
			});
		} finally {
			if (attachedHere && browserDebugger.isAttached()) {
				browserDebugger.detach();
			}
		}
	}

	private trimDiagnostics(): void {
		const maximumEntries = 500;
		if (this._consoleEntries.length > maximumEntries) {
			this._consoleEntries.splice(0, this._consoleEntries.length - maximumEntries);
		}
		while (this._networkEntries.size > maximumEntries) {
			const oldest = this._networkEntries.keys().next().value;
			if (typeof oldest !== 'number') {
				break;
			}
			this._networkEntries.delete(oldest);
		}
		while (this._downloadEntries.size > maximumEntries) {
			const oldest = this._downloadEntries.keys().next().value;
			if (typeof oldest !== 'string') {
				break;
			}
			this._downloadEntries.delete(oldest);
		}
	}

	private consumePopupPermission(location: BrowserNewPageLocation): boolean {
		switch (location) {
			case BrowserNewPageLocation.Foreground:
			case BrowserNewPageLocation.Background:
				return true;
			case BrowserNewPageLocation.NewWindow:
				// Each user gesture allows one popup window within 1 second
				if (this._lastUserGestureTimestamp > Date.now() - 1000) {
					this._lastUserGestureTimestamp = -Infinity;
					return true;
				}

				return false;
		}
	}

	get webContents(): Electron.WebContents {
		return this._view.webContents;
	}

	/**
	 * Get the current state of this browser view
	 */
	getState(): IBrowserViewState {
		const webContents = this._view.webContents;
		return {
			url: webContents.getURL(),
			title: webContents.getTitle(),
			canGoBack: webContents.navigationHistory.canGoBack(),
			canGoForward: webContents.navigationHistory.canGoForward(),
			loading: webContents.isLoading(),
			focused: webContents.isFocused(),
			visible: this._view.getVisible(),
			isDevToolsOpen: webContents.isDevToolsOpened(),
			lastScreenshot: this._lastScreenshot,
			lastFavicon: this._lastFavicon,
			lastError: this._lastError,
			storageScope: this.storageScope
		};
	}

	/**
	 * Toggle developer tools for this browser view.
	 */
	toggleDevTools(): void {
		this._view.webContents.toggleDevTools();
	}

	/**
	 * Update the layout bounds of this view
	 */
	layout(bounds: IBrowserViewBounds): void {
		if (this._window?.win?.id !== bounds.windowId) {
			const newWindow = this.windowById(bounds.windowId);
			if (newWindow) {
				this._window?.win?.contentView.removeChildView(this._view);
				this._window = newWindow;
				newWindow.win?.contentView.addChildView(this._view);
			}
		}

		this._view.webContents.setZoomFactor(bounds.zoomFactor);
		this._view.setBounds({
			x: Math.round(bounds.x * bounds.zoomFactor),
			y: Math.round(bounds.y * bounds.zoomFactor),
			width: Math.round(bounds.width * bounds.zoomFactor),
			height: Math.round(bounds.height * bounds.zoomFactor)
		});
	}

	/**
	 * Set the visibility of this view
	 */
	setVisible(visible: boolean): void {
		if (this._view.getVisible() === visible) {
			return;
		}

		// If the view is focused, pass focus back to the window when hiding
		if (!visible && this._view.webContents.isFocused()) {
			this._window?.win?.webContents.focus();
		}

		this._view.setVisible(visible);
		this._onDidChangeVisibility.fire({ visible });
	}

	/**
	 * Move this view above sibling native views in the owning window.
	 */
	bringToFront(): void {
		const contentView = this._window?.win?.contentView;
		if (!contentView) {
			return;
		}
		contentView.removeChildView(this._view);
		contentView.addChildView(this._view);
	}

	/**
	 * Load a URL in this view
	 */
	async loadURL(url: string): Promise<void> {
		await this._view.webContents.loadURL(url);
	}

	/**
	 * Get the current URL
	 */
	getURL(): string {
		return this._view.webContents.getURL();
	}

	/**
	 * Navigate back in history
	 */
	goBack(): void {
		if (this._view.webContents.navigationHistory.canGoBack()) {
			this._view.webContents.navigationHistory.goBack();
		}
	}

	/**
	 * Navigate forward in history
	 */
	goForward(): void {
		if (this._view.webContents.navigationHistory.canGoForward()) {
			this._view.webContents.navigationHistory.goForward();
		}
	}

	/**
	 * Reload the current page
	 */
	reload(): void {
		this._view.webContents.reload();
	}

	/**
	 * Check if the view can navigate back
	 */
	canGoBack(): boolean {
		return this._view.webContents.navigationHistory.canGoBack();
	}

	/**
	 * Check if the view can navigate forward
	 */
	canGoForward(): boolean {
		return this._view.webContents.navigationHistory.canGoForward();
	}

	/**
	 * Capture a screenshot of this view
	 */
	async captureScreenshot(options?: IBrowserViewCaptureScreenshotOptions): Promise<VSBuffer> {
		const quality = options?.quality ?? 80;
		const image = await this._view.webContents.capturePage(options?.rect, {
			stayHidden: true,
			stayAwake: true
		});
		const buffer = image.toJPEG(quality);
		const screenshot = VSBuffer.wrap(buffer);
		// Only update _lastScreenshot if capturing the full view
		if (!options?.rect) {
			this._lastScreenshot = screenshot;
		}
		return screenshot;
	}

	/**
	 * Dispatch a keyboard event to this view
	 */
	async dispatchKeyEvent(keyEvent: IBrowserViewKeyDownEvent): Promise<void> {
		const event: Electron.KeyboardInputEvent = {
			type: 'keyDown',
			keyCode: keyEvent.key,
			modifiers: []
		};
		if (keyEvent.ctrlKey) {
			event.modifiers!.push('control');
		}
		if (keyEvent.shiftKey) {
			event.modifiers!.push('shift');
		}
		if (keyEvent.altKey) {
			event.modifiers!.push('alt');
		}
		if (keyEvent.metaKey) {
			event.modifiers!.push('meta');
		}
		this._isSendingKeyEvent = true;
		try {
			await this._view.webContents.sendInputEvent(event);
		} finally {
			this._isSendingKeyEvent = false;
		}
	}

	/**
	 * Dispatch a mouse event to this view.
	 */
	async dispatchMouseEvent(mouseEvent: IBrowserViewMouseEvent): Promise<void> {
		const x = Math.round(mouseEvent.x);
		const y = Math.round(mouseEvent.y);
		const event: Electron.MouseInputEvent | Electron.MouseWheelInputEvent = mouseEvent.type === 'mouseWheel'
			? {
				type: 'mouseWheel',
				x,
				y,
				deltaX: mouseEvent.deltaX ?? 0,
				deltaY: mouseEvent.deltaY ?? 0,
				canScroll: true
			}
			: {
				type: mouseEvent.type,
				x,
				y,
				button: mouseEvent.button ?? 'left',
				clickCount: mouseEvent.clickCount ?? 1
			};

		this._lastUserGestureTimestamp = Date.now();
		await this._view.webContents.sendInputEvent(event);
		if (mouseEvent.type === 'mouseDown' || mouseEvent.type === 'mouseUp') {
			await this.animateAutomationPointerClick(mouseEvent.type, x, y);
		}
	}

	async moveMouse(x: number, y: number): Promise<void> {
		const roundedX = Math.round(x);
		const roundedY = Math.round(y);
		const previousPoint = this._automationPointerPoint;
		this._automationPointerPoint = { x: roundedX, y: roundedY };
		await this.showAutomationPointer(roundedX, roundedY, previousPoint);
		this._lastUserGestureTimestamp = Date.now();
		await this._view.webContents.sendInputEvent({
			type: 'mouseMove',
			x: roundedX,
			y: roundedY
		});
	}

	private async showAutomationPointer(x: number, y: number, previousPoint: { x: number; y: number } | undefined): Promise<void> {
		const script = `(() => {
			const hostId = '__cleanslate_browser_mouse';
			let host = document.getElementById(hostId);
			if (!host) {
				host = document.createElement('div');
				host.id = hostId;
				host.style.cssText = 'position:fixed;left:0;top:0;width:24px;height:29px;z-index:2147483647;pointer-events:none;transform-origin:4px 4px;will-change:transform,opacity';
				const shadow = host.attachShadow({ mode: 'open' });
				shadow.innerHTML = '<style>:host{contain:strict}.cursor{width:24px;height:29px;filter:drop-shadow(0 2px 5px rgba(0,0,0,.34)) drop-shadow(0 0 5px rgba(22,135,255,.24))}.ring{position:absolute;left:-5px;top:-5px;width:18px;height:18px;border:2px solid rgba(49,147,255,.9);border-radius:50%;opacity:0;transform:scale(.35)}</style><svg class="cursor" viewBox="0 0 24 29"><path d="M3.2 2.4v20.1l5.2-4.9 3.5 8.5 4.5-1.9-3.7-8.4h7.4L3.2 2.4Z" fill="#1687ff" stroke="#f8fbff" stroke-width="2" stroke-linejoin="round"/><path d="m9.1 17.1 3.4 8.1" stroke="#0b4f9c" stroke-width=".9" opacity=".55"/></svg><span class="ring"></span>';
				document.documentElement.appendChild(host);
			}
			for (const animation of host.getAnimations()) animation.cancel();
			const suppliedStart = ${previousPoint ? JSON.stringify({ x: previousPoint.x - 3, y: previousPoint.y - 3 }) : 'undefined'};
			const start = suppliedStart || {
				x: Math.round(window.innerWidth * .58),
				y: Math.round(window.innerHeight * .62)
			};
			const end = { x: ${x - 3}, y: ${y - 3} };
			const dx = end.x - start.x;
			const dy = end.y - start.y;
			const distance = Math.hypot(dx, dy);
			const duration = Math.round(Math.max(180, Math.min(560, 170 + distance * .34)));
			const bend = Math.max(10, Math.min(42, distance * .09)) * ((start.x + start.y + end.x + end.y) % 2 ? 1 : -1);
			const length = distance || 1;
			const middle = {
				x: start.x + dx * .52 + (-dy / length) * bend,
				y: start.y + dy * .52 + (dx / length) * bend
			};
			host.style.opacity = '1';
			const animation = host.animate([
				{ transform: 'translate(' + start.x + 'px,' + start.y + 'px) scale(.94) rotate(-2deg)', opacity: .72 },
				{ transform: 'translate(' + middle.x + 'px,' + middle.y + 'px) scale(1.035) rotate(1.5deg)', opacity: 1, offset: .56 },
				{ transform: 'translate(' + end.x + 'px,' + end.y + 'px) scale(1) rotate(0deg)', opacity: 1 }
			], { duration, easing: 'cubic-bezier(.22,.78,.22,1)', fill: 'forwards' });
			clearTimeout(globalThis.__cleanSlateBrowserMouseTimer);
			globalThis.__cleanSlateBrowserMouseTimer = setTimeout(() => {
				host?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' });
			}, 1600);
			return animation.finished.catch(() => undefined);
		})()`;
		await this._view.webContents.executeJavaScript(script, true).catch(() => undefined);
	}

	private async animateAutomationPointerClick(type: 'mouseDown' | 'mouseUp', x: number, y: number): Promise<void> {
		const script = `(() => {
			const host = document.getElementById('__cleanslate_browser_mouse');
			if (!host) return;
			for (const animation of host.getAnimations()) animation.cancel();
			const base = 'translate(${x - 3}px,${y - 3}px)';
			if (${JSON.stringify(type)} === 'mouseDown') {
				return host.animate([
					{ transform: base + ' scale(1) rotate(0deg)' },
					{ transform: base + ' scale(.82) rotate(-3deg)' }
				], { duration: 74, easing: 'cubic-bezier(.3,0,.4,1)', fill: 'forwards' }).finished.catch(() => undefined);
			}
			const ring = host.shadowRoot?.querySelector('.ring');
			ring?.animate([
				{ opacity: .9, transform: 'scale(.35)' },
				{ opacity: 0, transform: 'scale(1.45)' }
			], { duration: 260, easing: 'cubic-bezier(.15,.7,.25,1)' });
			return host.animate([
				{ transform: base + ' scale(.82) rotate(-3deg)' },
				{ transform: base + ' scale(1.08) rotate(1deg)', offset: .58 },
				{ transform: base + ' scale(1) rotate(0deg)' }
			], { duration: 170, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }).finished.catch(() => undefined);
		})()`;
		await this._view.webContents.executeJavaScript(script, true).catch(() => undefined);
	}

	/**
	 * Insert text into the focused element in this view.
	 */
	async typeText(text: string): Promise<void> {
		this._lastUserGestureTimestamp = Date.now();
		await this._view.webContents.insertText(text);
	}

	/**
	 * Execute JavaScript in the isolated browser view world.
	 */
	async executeJavaScript(code: string): Promise<unknown> {
		return this._view.webContents.executeJavaScriptInIsolatedWorld(browserViewIsolatedWorldId, [{ code }]);
	}

	/**
	 * Set the zoom factor of this view
	 */
	async setZoomFactor(zoomFactor: number): Promise<void> {
		await this._view.webContents.setZoomFactor(zoomFactor);
	}

	/**
	 * Focus this view
	 */
	async focus(): Promise<void> {
		this._view.webContents.focus();
	}

	/**
	 * Find text in the page
	 */
	async findInPage(text: string, options?: IBrowserViewFindInPageOptions): Promise<void> {
		this._view.webContents.findInPage(text, {
			matchCase: options?.matchCase ?? false,
			forward: options?.forward ?? true,

			// `findNext` is not very clearly named. From Electron docs: `Whether to begin a new text finding session with this request`.
			// It needs to be set to `true` if we want a new search to be performed, such as when the text changes.
			// We name it `recompute` in our internal options to better reflect its purpose / behavior.
			findNext: options?.recompute ?? false
		});
	}

	/**
	 * Stop finding in page
	 */
	async stopFindInPage(keepSelection?: boolean): Promise<void> {
		this._view.webContents.stopFindInPage(keepSelection ? 'keepSelection' : 'clearSelection');
	}

	/**
	 * Get the currently selected text in the browser view.
	 * Returns immediately with empty string if the page is still loading.
	 */
	async getSelectedText(): Promise<string> {
		// we don't want to wait for the page to finish loading, which executeJavaScript normally does.
		if (this._view.webContents.isLoading()) {
			return '';
		}
		try {
			// Uses our preloaded contextBridge-exposed API.
			return await this._view.webContents.executeJavaScriptInIsolatedWorld(browserViewIsolatedWorldId, [{ code: 'window.browserViewAPI?.getSelectedText?.() ?? ""' }]);
		} catch {
			return '';
		}
	}

	/**
	 * Clear all storage data for this browser view's session
	 */
	async clearStorage(): Promise<void> {
		await this.viewSession.clearData();
	}

	/**
	 * Get the underlying WebContentsView
	 */
	getWebContentsView(): WebContentsView {
		return this._view;
	}

	override dispose(): void {
		// Remove from parent window
		this._window?.win?.contentView.removeChildView(this._view);

		// Clean up the view and all its event listeners
		// Note: webContents.close() automatically removes all event listeners
		this._view.webContents.close({ waitForBeforeUnload: false });

		super.dispose();
	}

	/**
	 * Potentially handle an input event as a VS Code command.
	 * Returns `true` if the event was forwarded to VS Code and should not be handled natively.
	 */
	private tryHandleCommand(input: Electron.Input): boolean {
		const eventKeyCode = SCAN_CODE_STR_TO_EVENT_KEY_CODE[input.code] || 0;
		const keyCode = EVENT_KEY_CODE_MAP[eventKeyCode] || KeyCode.Unknown;

		const isArrowKey = keyCode >= KeyCode.LeftArrow && keyCode <= KeyCode.DownArrow;
		const isNonEditingKey =
			keyCode === KeyCode.Escape ||
			keyCode >= KeyCode.F1 && keyCode <= KeyCode.F24 ||
			keyCode >= KeyCode.AudioVolumeMute;

		// Ignore most Alt-only inputs (often used for accented characters or menu accelerators)
		const isAltOnlyInput = input.alt && !input.control && !input.meta;
		if (isAltOnlyInput && !isNonEditingKey && !isArrowKey) {
			return false;
		}

		// Only reroute if there's a command modifier or it's a non-editing key
		const hasCommandModifier = input.control || input.alt || input.meta;
		if (!hasCommandModifier && !isNonEditingKey) {
			return false;
		}

		// Ignore Ctrl/Cmd + [A,C,V,X,Z] shortcuts to allow native handling (e.g. copy/paste)
		const isControlInput = isMacintosh ? input.meta : input.control;
		const modifiedKeyCode = keyCode |
			(isControlInput ? KeyMod.CtrlCmd : 0) |
			(input.shift ? KeyMod.Shift : 0) |
			(input.alt ? KeyMod.Alt : 0);
		if (nativeShortcuts.has(modifiedKeyCode)) {
			return false;
		}

		this._onDidKeyCommand.fire({
			key: input.key,
			keyCode: eventKeyCode,
			code: input.code,
			ctrlKey: input.control || false,
			shiftKey: input.shift || false,
			altKey: input.alt || false,
			metaKey: input.meta || false,
			repeat: input.isAutoRepeat || false
		});
		return true;
	}

	private windowById(windowId: number | undefined): ICodeWindow | IAuxiliaryWindow | undefined {
		return this.codeWindowById(windowId) ?? this.auxiliaryWindowById(windowId);
	}

	private codeWindowById(windowId: number | undefined): ICodeWindow | undefined {
		if (typeof windowId !== 'number') {
			return undefined;
		}

		return this.windowsMainService.getWindowById(windowId);
	}

	private auxiliaryWindowById(windowId: number | undefined): IAuxiliaryWindow | undefined {
		if (typeof windowId !== 'number') {
			return undefined;
		}

		const contents = webContents.fromId(windowId);
		if (!contents) {
			return undefined;
		}

		return this.auxiliaryWindowsMainService.getWindowByWebContents(contents);
	}
}
