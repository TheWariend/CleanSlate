/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { session } from 'electron';
import { Disposable, DisposableMap } from '../../../base/common/lifecycle.js';
import { Event } from '../../../base/common/event.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { IBrowserViewBounds, IBrowserViewDiagnostics, IBrowserViewKeyDownEvent, IBrowserViewState, IBrowserViewService, BrowserViewStorageScope, IBrowserViewCaptureScreenshotOptions, IBrowserViewFindInPageOptions, IBrowserViewMouseEvent } from '../common/browserView.js';
import { joinPath } from '../../../base/common/resources.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { createDecorator, IInstantiationService } from '../../instantiation/common/instantiation.js';
import { BrowserView } from './browserView.js';
import { generateUuid } from '../../../base/common/uuid.js';

export const IBrowserViewMainService = createDecorator<IBrowserViewMainService>('browserViewMainService');

export interface IBrowserViewMainService extends IBrowserViewService {
	tryGetBrowserView(id: string): BrowserView | undefined;
}

// Same as webviews
const allowedPermissions = new Set([
	'pointerLock',
	'notifications',
	'clipboard-read',
	'clipboard-sanitized-write'
]);

export class BrowserViewMainService extends Disposable implements IBrowserViewMainService {
	declare readonly _serviceBrand: undefined;

	/**
	 * Check if a webContents belongs to an integrated browser view
	*/
	private static readonly knownSessions = new WeakSet<Electron.Session>();
	static isBrowserViewWebContents(contents: Electron.WebContents): boolean {
		return BrowserViewMainService.knownSessions.has(contents.session);
	}

	private readonly browserViews = this._register(new DisposableMap<string, BrowserView>());
	private readonly browserViewsByWebContentsId = new Map<number, BrowserView>();
	private readonly configuredSessions = new WeakSet<Electron.Session>();

	constructor(
		@IEnvironmentMainService private readonly environmentMainService: IEnvironmentMainService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();
	}

	/**
	 * Get the session for a browser view based on data storage setting and workspace
	 */
	private getSession(requestedScope: BrowserViewStorageScope, viewId?: string, workspaceId?: string, sessionGroupId?: string): {
		session: Electron.Session;
		resolvedScope: BrowserViewStorageScope;
	} {
		switch (requestedScope) {
			case 'global':
				return { session: session.fromPartition('persist:vscode-browser'), resolvedScope: BrowserViewStorageScope.Global };
			case 'workspace':
				if (workspaceId) {
					const storage = joinPath(this.environmentMainService.workspaceStorageHome, workspaceId, 'browserStorage');
					return { session: session.fromPath(storage.fsPath), resolvedScope: BrowserViewStorageScope.Workspace };
				}
			// fallthrough
			case 'ephemeral':
			default:
					return { session: session.fromPartition(`vscode-browser-${sessionGroupId ?? viewId ?? generateUuid()}`), resolvedScope: BrowserViewStorageScope.Ephemeral };
		}
	}

	private configureSession(viewSession: Electron.Session): void {
		if (this.configuredSessions.has(viewSession)) {
			return;
		}
		this.configuredSessions.add(viewSession);
		viewSession.setPermissionRequestHandler((_webContents, permission, callback) => {
			return callback(allowedPermissions.has(permission));
		});
		viewSession.setPermissionCheckHandler((_webContents, permission, _origin) => {
			return allowedPermissions.has(permission);
		});
		viewSession.webRequest.onBeforeRequest((details, callback) => {
			if (typeof details.webContentsId === 'number') {
				this.browserViewsByWebContentsId.get(details.webContentsId)?.recordNetworkStart(details);
			}
			callback({});
		});
		viewSession.webRequest.onCompleted(details => {
			if (typeof details.webContentsId === 'number') {
				this.browserViewsByWebContentsId.get(details.webContentsId)?.recordNetworkComplete(details);
			}
		});
		viewSession.webRequest.onErrorOccurred(details => {
			if (typeof details.webContentsId === 'number') {
				this.browserViewsByWebContentsId.get(details.webContentsId)?.recordNetworkError(details);
			}
		});
		viewSession.on('will-download', (_event, item, webContents) => {
			if (webContents) {
				this.browserViewsByWebContentsId.get(webContents.id)?.recordDownload(item);
			}
		});
	}

	/**
	 * Create a child browser view (used by window.open handler)
	 */
	private createBrowserView(id: string, session: Electron.Session, scope: BrowserViewStorageScope, options?: Electron.WebContentsViewConstructorOptions): BrowserView {
		if (this.browserViews.has(id)) {
			throw new Error(`Browser view with id ${id} already exists`);
		}

		const view = this.instantiationService.createInstance(
			BrowserView,
			id,
			session,
			scope,
			// Recursive factory for nested windows
			(options) => this.createBrowserView(generateUuid(), session, scope, options),
			options
		);
		this.browserViews.set(id, view);
		const webContentsId = view.webContents.id;
		this.browserViewsByWebContentsId.set(webContentsId, view);
		Event.once(view.onDidClose)(() => this.browserViewsByWebContentsId.delete(webContentsId));
		return view;
	}

	async getOrCreateBrowserView(id: string, scope: BrowserViewStorageScope, workspaceId?: string, sessionGroupId?: string): Promise<IBrowserViewState> {
		if (this.browserViews.has(id)) {
			// Note: scope will be ignored if the view already exists.
			// Browser views cannot be moved between sessions after creation.
			const view = this.browserViews.get(id)!;
			return view.getState();
		}

		const { session, resolvedScope } = this.getSession(scope, id, workspaceId, sessionGroupId);
		this.configureSession(session);
		BrowserViewMainService.knownSessions.add(session);

		const view = this.createBrowserView(id, session, resolvedScope);

		return view.getState();
	}

	tryGetBrowserView(id: string): BrowserView | undefined {
		return this.browserViews.get(id);
	}

	/**
	 * Get a browser view or throw if not found
	 */
	private _getBrowserView(id: string): BrowserView {
		const view = this.browserViews.get(id);
		if (!view) {
			throw new Error(`Browser view ${id} not found`);
		}
		return view;
	}

	onDynamicDidNavigate(id: string) {
		return this._getBrowserView(id).onDidNavigate;
	}

	onDynamicDidChangeLoadingState(id: string) {
		return this._getBrowserView(id).onDidChangeLoadingState;
	}

	onDynamicDidChangeFocus(id: string) {
		return this._getBrowserView(id).onDidChangeFocus;
	}

	onDynamicDidChangeVisibility(id: string) {
		return this._getBrowserView(id).onDidChangeVisibility;
	}

	onDynamicDidChangeDevToolsState(id: string) {
		return this._getBrowserView(id).onDidChangeDevToolsState;
	}

	onDynamicDidKeyCommand(id: string) {
		return this._getBrowserView(id).onDidKeyCommand;
	}

	onDynamicDidChangeTitle(id: string) {
		return this._getBrowserView(id).onDidChangeTitle;
	}

	onDynamicDidChangeFavicon(id: string) {
		return this._getBrowserView(id).onDidChangeFavicon;
	}

	onDynamicDidRequestNewPage(id: string) {
		return this._getBrowserView(id).onDidRequestNewPage;
	}

	onDynamicDidFindInPage(id: string) {
		return this._getBrowserView(id).onDidFindInPage;
	}

	onDynamicDidClose(id: string) {
		return this._getBrowserView(id).onDidClose;
	}

	async destroyBrowserView(id: string): Promise<void> {
		this.browserViews.deleteAndDispose(id);
	}

	async layout(id: string, bounds: IBrowserViewBounds): Promise<void> {
		return this._getBrowserView(id).layout(bounds);
	}

	async setVisible(id: string, visible: boolean): Promise<void> {
		return this._getBrowserView(id).setVisible(visible);
	}

	async bringToFront(id: string): Promise<void> {
		return this._getBrowserView(id).bringToFront();
	}

	async loadURL(id: string, url: string): Promise<void> {
		return this._getBrowserView(id).loadURL(url);
	}

	async getURL(id: string): Promise<string> {
		return this._getBrowserView(id).getURL();
	}

	async goBack(id: string): Promise<void> {
		return this._getBrowserView(id).goBack();
	}

	async goForward(id: string): Promise<void> {
		return this._getBrowserView(id).goForward();
	}

	async reload(id: string): Promise<void> {
		return this._getBrowserView(id).reload();
	}

	async toggleDevTools(id: string): Promise<void> {
		return this._getBrowserView(id).toggleDevTools();
	}

	async canGoBack(id: string): Promise<boolean> {
		return this._getBrowserView(id).canGoBack();
	}

	async canGoForward(id: string): Promise<boolean> {
		return this._getBrowserView(id).canGoForward();
	}

	async captureScreenshot(id: string, options?: IBrowserViewCaptureScreenshotOptions): Promise<VSBuffer> {
		return this._getBrowserView(id).captureScreenshot(options);
	}

	async dispatchKeyEvent(id: string, keyEvent: IBrowserViewKeyDownEvent): Promise<void> {
		return this._getBrowserView(id).dispatchKeyEvent(keyEvent);
	}

	async dispatchMouseEvent(id: string, mouseEvent: IBrowserViewMouseEvent): Promise<void> {
		return this._getBrowserView(id).dispatchMouseEvent(mouseEvent);
	}

	async moveMouse(id: string, x: number, y: number): Promise<void> {
		return this._getBrowserView(id).moveMouse(x, y);
	}

	async typeText(id: string, text: string): Promise<void> {
		return this._getBrowserView(id).typeText(text);
	}

	async executeJavaScript(id: string, code: string): Promise<unknown> {
		return this._getBrowserView(id).executeJavaScript(code);
	}

	async getDiagnostics(id: string, clear?: boolean): Promise<IBrowserViewDiagnostics> {
		return this._getBrowserView(id).getDiagnostics(clear);
	}

	async setFileInputFiles(id: string, selector: string, files: string[]): Promise<void> {
		return this._getBrowserView(id).setFileInputFiles(selector, files);
	}

	async handleJavaScriptDialog(id: string, accept: boolean, promptText?: string): Promise<void> {
		return this._getBrowserView(id).handleJavaScriptDialog(accept, promptText);
	}

	async setZoomFactor(id: string, zoomFactor: number): Promise<void> {
		return this._getBrowserView(id).setZoomFactor(zoomFactor);
	}

	async focus(id: string): Promise<void> {
		return this._getBrowserView(id).focus();
	}

	async findInPage(id: string, text: string, options?: IBrowserViewFindInPageOptions): Promise<void> {
		return this._getBrowserView(id).findInPage(text, options);
	}

	async stopFindInPage(id: string, keepSelection?: boolean): Promise<void> {
		return this._getBrowserView(id).stopFindInPage(keepSelection);
	}

	async getSelectedText(id: string): Promise<string> {
		return this._getBrowserView(id).getSelectedText();
	}

	async clearStorage(id: string): Promise<void> {
		return this._getBrowserView(id).clearStorage();
	}

	async clearGlobalStorage(): Promise<void> {
		const { session, resolvedScope } = this.getSession(BrowserViewStorageScope.Global);
		if (resolvedScope !== BrowserViewStorageScope.Global) {
			throw new Error('Failed to resolve global storage session');
		}
		await session.clearData();
	}

	async clearWorkspaceStorage(workspaceId: string): Promise<void> {
		const { session, resolvedScope } = this.getSession(BrowserViewStorageScope.Workspace, undefined, workspaceId);
		if (resolvedScope !== BrowserViewStorageScope.Workspace) {
			throw new Error('Failed to resolve workspace storage session');
		}
		await session.clearData();
	}
}
