/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import {
	IBrowserViewBounds,
	IBrowserViewDiagnostics,
	IBrowserViewNavigationEvent,
	IBrowserViewLoadingEvent,
	IBrowserViewLoadError,
	IBrowserViewFocusEvent,
	IBrowserViewKeyDownEvent,
	IBrowserViewTitleChangeEvent,
	IBrowserViewFaviconChangeEvent,
	IBrowserViewNewPageRequest,
	IBrowserViewDevToolsStateEvent,
	IBrowserViewService,
	BrowserViewStorageScope,
	IBrowserViewCaptureScreenshotOptions,
	IBrowserViewFindInPageOptions,
	IBrowserViewFindInPageResult,
	IBrowserViewVisibilityEvent,
	IBrowserViewMouseEvent
} from '../../../../platform/browserView/common/browserView.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { isLocalhostAuthority } from '../../../../platform/url/common/trustedDomains.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { browserAnnotationScript, IBrowserViewAnnotation } from './cleanSlateBrowserAnnotation.js';

type IntegratedBrowserNavigationEvent = {
	navigationType: 'urlInput' | 'goBack' | 'goForward' | 'reload';
	isLocalhost: boolean;
};

type IntegratedBrowserNavigationClassification = {
	navigationType: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'How the navigation was triggered' };
	isLocalhost: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Whether the URL is a localhost address' };
	owner: 'kycutler';
	comment: 'Tracks navigation patterns in integrated browser';
};

export const IBrowserViewWorkbenchService = createDecorator<IBrowserViewWorkbenchService>('browserViewWorkbenchService');

/**
 * Workbench-level service for browser views that provides model-based access to browser views.
 * This service manages browser view models that proxy to the main process browser view service.
 */
export interface IBrowserViewWorkbenchService {
	readonly _serviceBrand: undefined;

	/**
	 * Get or create a browser view model for the given ID
	 * @param id The browser view identifier
	 * @returns A browser view model that proxies to the main process
	 */
	getOrCreateBrowserViewModel(id: string, sessionGroupId?: string): Promise<IBrowserViewModel>;

	/**
	 * Clear all storage data for the global browser session
	 */
	clearGlobalStorage(): Promise<void>;

	/**
	 * Clear all storage data for the current workspace browser session
	 */
	clearWorkspaceStorage(): Promise<void>;
}


/**
 * A browser view model that represents a single browser view instance in the workbench.
 * This model proxies calls to the main process browser view service using its unique ID.
 */
export interface IBrowserViewModel extends IDisposable {
	readonly id: string;
	readonly url: string;
	readonly title: string;
	readonly favicon: string | undefined;
	readonly screenshot: VSBuffer | undefined;
	readonly loading: boolean;
	readonly focused: boolean;
	readonly visible: boolean;
	readonly canGoBack: boolean;
	readonly isDevToolsOpen: boolean;
	readonly canGoForward: boolean;
	readonly annotationActive: boolean;
	readonly error: IBrowserViewLoadError | undefined;

	readonly storageScope: BrowserViewStorageScope;

	readonly onDidNavigate: Event<IBrowserViewNavigationEvent>;
	readonly onDidChangeNavigationState: Event<IBrowserViewNavigationEvent>;
	readonly onDidChangeLoadingState: Event<IBrowserViewLoadingEvent>;
	readonly onDidChangeFocus: Event<IBrowserViewFocusEvent>;
	readonly onDidChangeDevToolsState: Event<IBrowserViewDevToolsStateEvent>;
	readonly onDidKeyCommand: Event<IBrowserViewKeyDownEvent>;
	readonly onDidChangeTitle: Event<IBrowserViewTitleChangeEvent>;
	readonly onDidChangeFavicon: Event<IBrowserViewFaviconChangeEvent>;
	readonly onDidRequestNewPage: Event<IBrowserViewNewPageRequest>;
	readonly onDidFindInPage: Event<IBrowserViewFindInPageResult>;
	readonly onDidChangeVisibility: Event<IBrowserViewVisibilityEvent>;
	readonly onDidChangeAnnotationState: Event<{ active: boolean }>;
	readonly onDidClose: Event<void>;
	readonly onWillDispose: Event<void>;

	initialize(): Promise<void>;

	layout(bounds: IBrowserViewBounds): Promise<void>;
	setVisible(visible: boolean): Promise<void>;
	bringToFront(): Promise<void>;
	loadURL(url: string): Promise<void>;
	goBack(): Promise<void>;
	goForward(): Promise<void>;
	reload(): Promise<void>;
	toggleDevTools(): Promise<void>;
	captureScreenshot(options?: IBrowserViewCaptureScreenshotOptions): Promise<VSBuffer>;
	dispatchKeyEvent(keyEvent: IBrowserViewKeyDownEvent): Promise<void>;
	dispatchMouseEvent(mouseEvent: IBrowserViewMouseEvent): Promise<void>;
	moveMouse(x: number, y: number): Promise<void>;
	typeText(text: string): Promise<void>;
	executeJavaScript(code: string): Promise<unknown>;
	getDiagnostics(clear?: boolean): Promise<IBrowserViewDiagnostics>;
	setFileInputFiles(selector: string, files: string[]): Promise<void>;
	handleJavaScriptDialog(accept: boolean, promptText?: string): Promise<void>;
	startAnnotationMode(): Promise<IBrowserViewAnnotation[]>;
	stopAnnotationMode(): Promise<IBrowserViewAnnotation[]>;
	listAnnotations(): Promise<IBrowserViewAnnotation[]>;
	deleteAnnotation(annotationId: string): Promise<IBrowserViewAnnotation[]>;
	clearAnnotations(): Promise<IBrowserViewAnnotation[]>;
	focus(): Promise<void>;
	findInPage(text: string, options?: IBrowserViewFindInPageOptions): Promise<void>;
	stopFindInPage(keepSelection?: boolean): Promise<void>;
	getSelectedText(): Promise<string>;
	clearStorage(): Promise<void>;
}

export class BrowserViewModel extends Disposable implements IBrowserViewModel {
	private _url: string = '';
	private _title: string = '';
	private _favicon: string | undefined = undefined;
	private _screenshot: VSBuffer | undefined = undefined;
	private _loading: boolean = false;
	private _focused: boolean = false;
	private _visible: boolean = false;
	private _isDevToolsOpen: boolean = false;
	private _canGoBack: boolean = false;
	private _canGoForward: boolean = false;
	private _annotationActive: boolean = false;
	private _error: IBrowserViewLoadError | undefined = undefined;
	private _storageScope: BrowserViewStorageScope = BrowserViewStorageScope.Ephemeral;

	private readonly _onWillDispose = this._register(new Emitter<void>());
	readonly onWillDispose: Event<void> = this._onWillDispose.event;
	private readonly _onDidChangeAnnotationState = this._register(new Emitter<{ active: boolean }>());
	readonly onDidChangeAnnotationState: Event<{ active: boolean }> = this._onDidChangeAnnotationState.event;
	private readonly _onDidChangeNavigationState = this._register(new Emitter<IBrowserViewNavigationEvent>());
	readonly onDidChangeNavigationState: Event<IBrowserViewNavigationEvent> = this._onDidChangeNavigationState.event;

	constructor(
		readonly id: string,
		private readonly browserViewService: IBrowserViewService,
		private readonly sessionGroupId: string | undefined,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IWorkspaceTrustManagementService private readonly workspaceTrustManagementService: IWorkspaceTrustManagementService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();
	}

	get url(): string { return this._url; }
	get title(): string { return this._title; }
	get favicon(): string | undefined { return this._favicon; }
	get loading(): boolean { return this._loading; }
	get focused(): boolean { return this._focused; }
	get visible(): boolean { return this._visible; }
	get isDevToolsOpen(): boolean { return this._isDevToolsOpen; }
	get canGoBack(): boolean { return this._canGoBack; }
	get canGoForward(): boolean { return this._canGoForward; }
	get annotationActive(): boolean { return this._annotationActive; }
	get screenshot(): VSBuffer | undefined { return this._screenshot; }
	get error(): IBrowserViewLoadError | undefined { return this._error; }
	get storageScope(): BrowserViewStorageScope { return this._storageScope; }

	get onDidNavigate(): Event<IBrowserViewNavigationEvent> {
		return this.browserViewService.onDynamicDidNavigate(this.id);
	}

	get onDidChangeLoadingState(): Event<IBrowserViewLoadingEvent> {
		return this.browserViewService.onDynamicDidChangeLoadingState(this.id);
	}

	get onDidChangeFocus(): Event<IBrowserViewFocusEvent> {
		return this.browserViewService.onDynamicDidChangeFocus(this.id);
	}

	get onDidChangeDevToolsState(): Event<IBrowserViewDevToolsStateEvent> {
		return this.browserViewService.onDynamicDidChangeDevToolsState(this.id);
	}

	get onDidKeyCommand(): Event<IBrowserViewKeyDownEvent> {
		return this.browserViewService.onDynamicDidKeyCommand(this.id);
	}

	get onDidChangeTitle(): Event<IBrowserViewTitleChangeEvent> {
		return this.browserViewService.onDynamicDidChangeTitle(this.id);
	}

	get onDidChangeFavicon(): Event<IBrowserViewFaviconChangeEvent> {
		return this.browserViewService.onDynamicDidChangeFavicon(this.id);
	}

	get onDidRequestNewPage(): Event<IBrowserViewNewPageRequest> {
		return this.browserViewService.onDynamicDidRequestNewPage(this.id);
	}

	get onDidFindInPage(): Event<IBrowserViewFindInPageResult> {
		return this.browserViewService.onDynamicDidFindInPage(this.id);
	}

	get onDidChangeVisibility(): Event<IBrowserViewVisibilityEvent> {
		return this.browserViewService.onDynamicDidChangeVisibility(this.id);
	}

	get onDidClose(): Event<void> {
		return this.browserViewService.onDynamicDidClose(this.id);
	}

	/**
	 * Initialize the model with the current state from the main process
	 */
	async initialize(): Promise<void> {
		const dataStorageSetting = this.configurationService.getValue<BrowserViewStorageScope>(
			'workbench.browser.dataStorage'
		) ?? BrowserViewStorageScope.Global;

		// Wait for trust initialization before determining storage scope
		await this.workspaceTrustManagementService.workspaceTrustInitialized;
		const isWorkspaceUntrusted =
			this.workspaceContextService.getWorkbenchState() !== WorkbenchState.EMPTY &&
			!this.workspaceTrustManagementService.isWorkspaceTrusted();

		// Always use ephemeral sessions for untrusted workspaces
		const dataStorage = isWorkspaceUntrusted ? BrowserViewStorageScope.Ephemeral : dataStorageSetting;

		const workspaceId = this.workspaceContextService.getWorkspace().id;
		const state = await this.browserViewService.getOrCreateBrowserView(this.id, dataStorage, workspaceId, this.sessionGroupId);

		this._url = state.url;
		this._title = state.title;
		this._loading = state.loading;
		this._focused = state.focused;
		this._visible = state.visible;
		this._isDevToolsOpen = state.isDevToolsOpen;
		this._canGoBack = state.canGoBack;
		this._canGoForward = state.canGoForward;
		this._screenshot = state.lastScreenshot;
		this._favicon = state.lastFavicon;
		this._error = state.lastError;
		this._storageScope = state.storageScope;

		// Set up state synchronization

		this._register(this.onDidNavigate(e => {
			// Clear favicon on navigation to a different host
			if (URL.parse(e.url)?.host !== URL.parse(this._url)?.host) {
				this._favicon = undefined;
			}

			this._url = e.url;
			this._canGoBack = e.canGoBack;
			this._canGoForward = e.canGoForward;
			this._onDidChangeNavigationState.fire(e);
		}));

		this._register(this.onDidChangeLoadingState(e => {
			this._loading = e.loading;
			this._error = e.error;
			if (!e.loading && !e.error && this._annotationActive) {
				void this.executeJavaScript(browserAnnotationScript('start')).catch(() => this.setAnnotationActive(false));
			}
		}));

		this._register(this.onDidChangeDevToolsState(e => {
			this._isDevToolsOpen = e.isDevToolsOpen;
		}));

		this._register(this.onDidChangeTitle(e => {
			this._title = e.title;
		}));

		this._register(this.onDidChangeFavicon(e => {
			this._favicon = e.favicon;
		}));

		this._register(this.onDidChangeFocus(({ focused }) => {
			this._focused = focused;
		}));

		this._register(this.onDidChangeVisibility(({ visible }) => {
			this._visible = visible;
		}));
	}

	async layout(bounds: IBrowserViewBounds): Promise<void> {
		return this.browserViewService.layout(this.id, bounds);
	}

	async setVisible(visible: boolean): Promise<void> {
		const previousVisible = this._visible;
		this._visible = visible; // Set optimistically so model is in sync immediately
		try {
			await this.browserViewService.setVisible(this.id, visible);
		} catch (error) {
			this._visible = previousVisible;
			throw error;
		}
	}

	async bringToFront(): Promise<void> {
		return this.browserViewService.bringToFront(this.id);
	}

	async loadURL(url: string): Promise<void> {
		this.logNavigationTelemetry('urlInput', url);
		this._url = url;
		this._error = undefined;
		this._onDidChangeNavigationState.fire({
			url,
			canGoBack: this._canGoBack,
			canGoForward: this._canGoForward
		});
		return this.browserViewService.loadURL(this.id, url);
	}

	async goBack(): Promise<void> {
		this.logNavigationTelemetry('goBack', this._url);
		return this.browserViewService.goBack(this.id);
	}

	async goForward(): Promise<void> {
		this.logNavigationTelemetry('goForward', this._url);
		return this.browserViewService.goForward(this.id);
	}

	async reload(): Promise<void> {
		this.logNavigationTelemetry('reload', this._url);
		return this.browserViewService.reload(this.id);
	}

	async toggleDevTools(): Promise<void> {
		return this.browserViewService.toggleDevTools(this.id);
	}

	async captureScreenshot(options?: IBrowserViewCaptureScreenshotOptions): Promise<VSBuffer> {
		const result = await this.browserViewService.captureScreenshot(this.id, options);
		// Store full-page screenshots for display in UI as placeholders
		if (!options?.rect) {
			this._screenshot = result;
		}
		return result;
	}

	async dispatchKeyEvent(keyEvent: IBrowserViewKeyDownEvent): Promise<void> {
		return this.browserViewService.dispatchKeyEvent(this.id, keyEvent);
	}

	async dispatchMouseEvent(mouseEvent: IBrowserViewMouseEvent): Promise<void> {
		return this.browserViewService.dispatchMouseEvent(this.id, mouseEvent);
	}

	async moveMouse(x: number, y: number): Promise<void> {
		return this.browserViewService.moveMouse(this.id, x, y);
	}

	async typeText(text: string): Promise<void> {
		return this.browserViewService.typeText(this.id, text);
	}

	async executeJavaScript(code: string): Promise<unknown> {
		return this.browserViewService.executeJavaScript(this.id, code);
	}

	async getDiagnostics(clear?: boolean): Promise<IBrowserViewDiagnostics> {
		return this.browserViewService.getDiagnostics(this.id, clear);
	}

	async setFileInputFiles(selector: string, files: string[]): Promise<void> {
		return this.browserViewService.setFileInputFiles(this.id, selector, files);
	}

	async handleJavaScriptDialog(accept: boolean, promptText?: string): Promise<void> {
		return this.browserViewService.handleJavaScriptDialog(this.id, accept, promptText);
	}

	async startAnnotationMode(): Promise<IBrowserViewAnnotation[]> {
		try {
			const annotations = this.coerceAnnotations(await this.executeJavaScript(browserAnnotationScript('start')));
			this.setAnnotationActive(true);
			return annotations;
		} catch (error) {
			this.setAnnotationActive(false);
			throw error;
		}
	}

	async stopAnnotationMode(): Promise<IBrowserViewAnnotation[]> {
		try {
			return this.coerceAnnotations(await this.executeJavaScript(browserAnnotationScript('stop')));
		} finally {
			this.setAnnotationActive(false);
		}
	}

	async listAnnotations(): Promise<IBrowserViewAnnotation[]> {
		return this.coerceAnnotations(await this.executeJavaScript(browserAnnotationScript('list')));
	}

	async deleteAnnotation(annotationId: string): Promise<IBrowserViewAnnotation[]> {
		return this.coerceAnnotations(await this.executeJavaScript(browserAnnotationScript('delete', annotationId)));
	}

	async clearAnnotations(): Promise<IBrowserViewAnnotation[]> {
		return this.coerceAnnotations(await this.executeJavaScript(browserAnnotationScript('clear')));
	}

	async focus(): Promise<void> {
		return this.browserViewService.focus(this.id);
	}

	async findInPage(text: string, options?: IBrowserViewFindInPageOptions): Promise<void> {
		return this.browserViewService.findInPage(this.id, text, options);
	}

	async stopFindInPage(keepSelection?: boolean): Promise<void> {
		return this.browserViewService.stopFindInPage(this.id, keepSelection);
	}

	async getSelectedText(): Promise<string> {
		return this.browserViewService.getSelectedText(this.id);
	}

	async clearStorage(): Promise<void> {
		return this.browserViewService.clearStorage(this.id);
	}

	private setAnnotationActive(active: boolean): void {
		if (this._annotationActive === active) {
			return;
		}
		this._annotationActive = active;
		this._onDidChangeAnnotationState.fire({ active });
	}

	private coerceAnnotations(raw: unknown): IBrowserViewAnnotation[] {
		return Array.isArray(raw)
			? raw.filter((annotation): annotation is IBrowserViewAnnotation => !!annotation && typeof annotation === 'object' && typeof (annotation as IBrowserViewAnnotation).id === 'string')
			: [];
	}

	/**
	 * Log navigation telemetry event
	 */
	private logNavigationTelemetry(navigationType: IntegratedBrowserNavigationEvent['navigationType'], url: string): void {
		let localhost: boolean;
		try {
			localhost = isLocalhostAuthority(new URL(url).host);
		} catch {
			localhost = false;
		}

		this.telemetryService.publicLog2<IntegratedBrowserNavigationEvent, IntegratedBrowserNavigationClassification>(
			'integratedBrowser.navigation',
			{
				navigationType,
				isLocalhost: localhost
			}
		);
	}

	override dispose(): void {
		this._onWillDispose.fire();

		// Clean up the browser view when the model is disposed
		void this.browserViewService.destroyBrowserView(this.id);

		super.dispose();
	}
}
