/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { getZoomFactor } from '../../../../../base/browser/browser.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import type { IBrowserViewBounds, IBrowserViewDiagnostics } from '../../../../../platform/browserView/common/browserView.js';
import { BrowserViewUri } from '../../../../../platform/browserView/common/browserViewUri.js';
import { EditorsOrder } from '../../../../common/editor.js';
import { ACTIVE_GROUP, IEditorService } from '../../../../services/editor/common/editorService.js';
import { CleanSlatePlaywrightBrowserAction, ICleanSlateMainService } from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { IBrowserViewAnnotation } from '../../../browserView/common/cleanSlateBrowserAnnotation.js';
import { IBrowserViewModel, IBrowserViewWorkbenchService } from '../../../browserView/common/browserView.js';

export const ICleanSlateBrowserAutomationService = createDecorator<ICleanSlateBrowserAutomationService>('cleanSlateBrowserAutomationService');

export interface ICleanSlateBrowserPoint {
	x: number;
	y: number;
}

export interface ICleanSlateBrowserRect extends ICleanSlateBrowserPoint {
	width: number;
	height: number;
}

export interface ICleanSlateBrowserLayoutBounds extends ICleanSlateBrowserRect { }

export interface ICleanSlateBrowserElement {
	id: string;
	tagName: string;
	selector?: string;
	testId?: string;
	role?: string;
	name?: string;
	text?: string;
	ariaLabel?: string;
	placeholder?: string;
	href?: string;
	type?: string;
	checked?: boolean;
	disabled?: boolean;
	boundingBox: ICleanSlateBrowserRect;
	visual?: {
		color?: string;
		backgroundColor?: string;
		opacity?: number;
		contrastRatio?: number;
		lowContrast?: boolean;
	};
}

export interface ICleanSlateBrowserState {
	success: true;
	surface: CleanSlateBrowserSurface;
	viewId: string;
	url: string;
	title: string;
	visible: boolean;
	loading: boolean;
	canGoBack: boolean;
	canGoForward: boolean;
	annotationActive: boolean;
	loadError?: string;
}

export type CleanSlateBrowserSurface = 'ide' | 'agentManager' | `agentManager:${string}`;

export interface ICleanSlateBrowserSnapshot extends ICleanSlateBrowserState {
	viewport: { width: number; height: number; devicePixelRatio: number };
	bodyText: string;
	elements: ICleanSlateBrowserElement[];
	theme?: {
		prefersColorScheme?: string;
		colorScheme?: string;
		backgroundColor?: string;
		foregroundColor?: string;
	};
}

export interface ICleanSlateBrowserActionResult extends ICleanSlateBrowserState {
	action: string;
	target?: string;
	point?: ICleanSlateBrowserPoint;
}

export interface ICleanSlateBrowserLocator {
	elementId?: string;
	selector?: string;
	testId?: string;
	role?: string;
	name?: string;
	label?: string;
	placeholder?: string;
	text?: string;
	exact?: boolean;
	nth?: number;
}

export interface ICleanSlateBrowserTarget extends ICleanSlateBrowserLocator {
	x?: number;
	y?: number;
	button?: 'left' | 'middle' | 'right';
	clickCount?: number;
}

export interface ICleanSlateBrowserWaitOptions extends ICleanSlateBrowserLocator {
	ms?: number;
	timeoutMs?: number;
	hidden?: boolean;
	url?: string;
}

export interface ICleanSlateBrowserTab {
	id: string;
	url: string;
	title: string;
	active: boolean;
}

export type ICleanSlateBrowserAnnotation = IBrowserViewAnnotation;

export interface ICleanSlateBrowserAnnotationChangeEvent {
	surface: CleanSlateBrowserSurface;
	annotations: ICleanSlateBrowserAnnotation[];
}

export interface ICleanSlateBrowserAutomationService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeAnnotations: Event<ICleanSlateBrowserAnnotationChangeEvent>;
	readonly onDidOpenBrowser: Event<ICleanSlateBrowserState>;
	open(url: string): Promise<ICleanSlateBrowserState>;
	openInAgentManager(url: string, surface?: CleanSlateBrowserSurface): Promise<ICleanSlateBrowserState>;
	revealOpenBrowser(surface?: CleanSlateBrowserSurface): Promise<ICleanSlateBrowserState | undefined>;
	layoutOpenBrowser(bounds: ICleanSlateBrowserLayoutBounds, surface?: CleanSlateBrowserSurface): Promise<ICleanSlateBrowserState | undefined>;
	setOpenBrowserVisible(visible: boolean, surface?: CleanSlateBrowserSurface): Promise<ICleanSlateBrowserState | undefined>;
	navigateBack(surface: CleanSlateBrowserSurface): Promise<ICleanSlateBrowserState>;
	navigateForward(surface: CleanSlateBrowserSurface): Promise<ICleanSlateBrowserState>;
	reload(surface: CleanSlateBrowserSurface): Promise<ICleanSlateBrowserState>;
	snapshot(surface: CleanSlateBrowserSurface, options?: { limit?: number }): Promise<ICleanSlateBrowserSnapshot>;
	click(surface: CleanSlateBrowserSurface, input: ICleanSlateBrowserTarget): Promise<ICleanSlateBrowserActionResult>;
	hover(surface: CleanSlateBrowserSurface, input: ICleanSlateBrowserTarget): Promise<ICleanSlateBrowserActionResult>;
	fill(surface: CleanSlateBrowserSurface, input: ICleanSlateBrowserLocator & { value: string }): Promise<ICleanSlateBrowserActionResult>;
	check(surface: CleanSlateBrowserSurface, input: ICleanSlateBrowserLocator & { checked?: boolean }): Promise<ICleanSlateBrowserActionResult>;
	select(surface: CleanSlateBrowserSurface, input: ICleanSlateBrowserLocator & { values: string[] }): Promise<ICleanSlateBrowserActionResult & { values: string[] }>;
	uploadFiles(surface: CleanSlateBrowserSurface, input: ICleanSlateBrowserLocator & { files: string[] }): Promise<ICleanSlateBrowserActionResult & { files: string[] }>;
	handleDialog(surface: CleanSlateBrowserSurface, input: { accept: boolean; promptText?: string }): Promise<ICleanSlateBrowserActionResult>;
	clipboard(surface: CleanSlateBrowserSurface, input: { action: 'read' | 'write'; text?: string }): Promise<ICleanSlateBrowserActionResult & { text?: string }>;
	typeText(surface: CleanSlateBrowserSurface, text: string): Promise<ICleanSlateBrowserActionResult>;
	pressKey(surface: CleanSlateBrowserSurface, input: ICleanSlateBrowserLocator & { key: string; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean }): Promise<ICleanSlateBrowserActionResult>;
	scroll(surface: CleanSlateBrowserSurface, input: ICleanSlateBrowserTarget & { deltaX?: number; deltaY?: number }): Promise<ICleanSlateBrowserActionResult>;
	wait(surface: CleanSlateBrowserSurface, input?: ICleanSlateBrowserWaitOptions): Promise<ICleanSlateBrowserState>;
	getUrl(surface: CleanSlateBrowserSurface): Promise<ICleanSlateBrowserState>;
	getDiagnostics(surface: CleanSlateBrowserSurface, options?: { clear?: boolean }): Promise<ICleanSlateBrowserState & IBrowserViewDiagnostics>;
	listTabs(surface: CleanSlateBrowserSurface): Promise<{ success: true; tabs: ICleanSlateBrowserTab[] }>;
	newTab(surface: CleanSlateBrowserSurface, options?: { url?: string; background?: boolean }): Promise<ICleanSlateBrowserState & { tabId: string }>;
	selectTab(surface: CleanSlateBrowserSurface, tabId: string): Promise<ICleanSlateBrowserState & { tabId: string }>;
	closeTab(surface: CleanSlateBrowserSurface, tabId: string): Promise<{ success: true; tabs: ICleanSlateBrowserTab[] }>;
	screenshot(surface: CleanSlateBrowserSurface, options?: { quality?: number; fullPage?: boolean }): Promise<ICleanSlateBrowserState & { mimeType: 'image/jpeg'; base64: string }>;
	startAnnotation(surface: CleanSlateBrowserSurface): Promise<ICleanSlateBrowserState & { annotationMode: 'active' }>;
	stopAnnotation(surface: CleanSlateBrowserSurface): Promise<ICleanSlateBrowserState & { annotationMode: 'inactive'; annotations: ICleanSlateBrowserAnnotation[] }>;
	listAnnotations(surface: CleanSlateBrowserSurface): Promise<ICleanSlateBrowserState & { annotations: ICleanSlateBrowserAnnotation[] }>;
	listCachedAnnotations(surface: CleanSlateBrowserSurface): ICleanSlateBrowserAnnotation[];
	refreshVisibleAnnotations(surface: CleanSlateBrowserSurface): Promise<ICleanSlateBrowserAnnotation[]>;
	deleteAnnotation(surface: CleanSlateBrowserSurface, annotationId: string): Promise<ICleanSlateBrowserState & { annotations: ICleanSlateBrowserAnnotation[] }>;
	clearAnnotations(surface: CleanSlateBrowserSurface): Promise<ICleanSlateBrowserState & { annotations: ICleanSlateBrowserAnnotation[] }>;
}

export class CleanSlateBrowserAutomationService extends Disposable implements ICleanSlateBrowserAutomationService {
	declare readonly _serviceBrand: undefined;

	private static readonly ideBrowserViewId = 'cleanslate.agent.browser';
	private static readonly agentManagerBrowserViewId = 'cleanslate.agent.browser.agentManager';
	private readonly snapshotElements = new Map<CleanSlateBrowserSurface, Map<string, ICleanSlateBrowserElement>>();
	private readonly annotations = new Map<CleanSlateBrowserSurface, Map<string, ICleanSlateBrowserAnnotation>>();
	private readonly _onDidChangeAnnotations = this._register(new Emitter<ICleanSlateBrowserAnnotationChangeEvent>());
	private readonly _onDidOpenBrowser = this._register(new Emitter<ICleanSlateBrowserState>());
	readonly onDidChangeAnnotations = this._onDidChangeAnnotations.event;
	readonly onDidOpenBrowser = this._onDidOpenBrowser.event;
	private readonly browserModels = new Map<CleanSlateBrowserSurface, IBrowserViewModel>();
	private readonly browserTabs = new Map<CleanSlateBrowserSurface, Map<string, IBrowserViewModel>>();
	private readonly browserModelDisposables = new Map<string, DisposableStore>();
	private readonly browserLayouts = new Map<CleanSlateBrowserSurface, ICleanSlateBrowserLayoutBounds>();
	private nextTabId = 1;

	constructor(
		@IBrowserViewWorkbenchService private readonly browserViewWorkbenchService: IBrowserViewWorkbenchService,
		@IEditorService private readonly editorService: IEditorService,
		@ICleanSlateMainService private readonly cleanSlateMainService: ICleanSlateMainService
	) {
		super();
	}

	async open(url: string): Promise<ICleanSlateBrowserState> {
		const normalizedUrl = this.normalizeUrl(url);
		const browserState = await this.openBrowserEditor(normalizedUrl);
		this._onDidOpenBrowser.fire(browserState);
		return browserState;
	}

	async openInAgentManager(url: string, surface: CleanSlateBrowserSurface = 'agentManager'): Promise<ICleanSlateBrowserState> {
		const normalizedUrl = this.normalizeUrl(url);
		const browserState = await this.openAgentManagerBrowser(normalizedUrl, this.normalizeAgentManagerSurface(surface));
		this._onDidOpenBrowser.fire(browserState);
		return browserState;
	}

	async revealOpenBrowser(surface: CleanSlateBrowserSurface = 'ide'): Promise<ICleanSlateBrowserState | undefined> {
		const model = this.browserModels.get(surface)
			?? await this.browserViewWorkbenchService.getOrCreateBrowserViewModel(this.browserViewIdForSurface(surface));
		if (!model.url || model.url === 'about:blank') {
			return undefined;
		}
		this.trackBrowserModel(surface, model);
		const browserState = this.state(surface, model);
		this._onDidOpenBrowser.fire(browserState);
		return browserState;
	}

	async layoutOpenBrowser(bounds: ICleanSlateBrowserLayoutBounds, surface: CleanSlateBrowserSurface = 'ide'): Promise<ICleanSlateBrowserState | undefined> {
		const model = await this.getOpenCleanSlateBrowserModel(surface);
		if (!model) {
			return undefined;
		}
		this.browserLayouts.set(surface, bounds);
		await model.layout(this.toBrowserViewBounds(bounds));
		await model.setVisible(true);
		await model.bringToFront();
		return this.state(surface, model);
	}

	async setOpenBrowserVisible(visible: boolean, surface: CleanSlateBrowserSurface = 'ide'): Promise<ICleanSlateBrowserState | undefined> {
		const model = await this.getOpenCleanSlateBrowserModel(surface);
		if (!model) {
			return undefined;
		}
		await model.setVisible(visible);
		if (visible) {
			await model.bringToFront();
		}
		return this.state(surface, model);
	}

	async navigateBack(surface: CleanSlateBrowserSurface): Promise<ICleanSlateBrowserState> {
		const model = await this.getModel(surface);
		await model.goBack();
		await this.delay(100);
		await this.waitForPageSettled(model, 2000);
		const browserState = this.state(surface, model);
		this._onDidOpenBrowser.fire(browserState);
		return browserState;
	}

	async navigateForward(surface: CleanSlateBrowserSurface): Promise<ICleanSlateBrowserState> {
		const model = await this.getModel(surface);
		await model.goForward();
		await this.delay(100);
		await this.waitForPageSettled(model, 2000);
		const browserState = this.state(surface, model);
		this._onDidOpenBrowser.fire(browserState);
		return browserState;
	}

	async reload(surface: CleanSlateBrowserSurface): Promise<ICleanSlateBrowserState> {
		const model = await this.getModel(surface);
		await model.reload();
		await this.delay(100);
		await this.waitForPageSettled(model, 5000);
		const browserState = this.state(surface, model);
		this._onDidOpenBrowser.fire(browserState);
		return browserState;
	}

	async snapshot(surface: CleanSlateBrowserSurface, options?: { limit?: number }): Promise<ICleanSlateBrowserSnapshot> {
		const model = await this.getModel(surface);
		const snapshot = await this.snapshotVisible(surface, model, options);
		const snapshotElements = this.snapshotElementsFor(surface);
		snapshotElements.clear();
		for (const element of snapshot.elements) {
			snapshotElements.set(element.id, element);
		}

		return snapshot;
	}

	async click(surface: CleanSlateBrowserSurface, input: ICleanSlateBrowserTarget): Promise<ICleanSlateBrowserActionResult> {
		const model = await this.getModel(surface);
		const point = await this.resolvePointerTarget(surface, model, input);
		await this.moveBrowserMouse(model, point);
		const button = input.button ?? 'left';
		const clickCount = Math.max(1, Math.min(Math.round(input.clickCount ?? 1), 3));
		for (let count = 1; count <= clickCount; count++) {
			await model.dispatchMouseEvent({ type: 'mouseDown', ...point, button, clickCount: count });
			await model.dispatchMouseEvent({ type: 'mouseUp', ...point, button, clickCount: count });
			if (count < clickCount) {
				await this.delay(65);
			}
		}
		await this.delay(100);
		await this.waitForPageSettled(model, 2000);
		return { ...this.state(surface, model), action: 'click', target: this.describeLocator(input), point };
	}

	async hover(surface: CleanSlateBrowserSurface, input: ICleanSlateBrowserTarget): Promise<ICleanSlateBrowserActionResult> {
		const model = await this.getModel(surface);
		const point = await this.resolvePointerTarget(surface, model, input);
		await this.moveBrowserMouse(model, point);
		return { ...this.state(surface, model), action: 'hover', target: this.describeLocator(input), point };
	}

	async fill(surface: CleanSlateBrowserSurface, input: ICleanSlateBrowserLocator & { value: string }): Promise<ICleanSlateBrowserActionResult> {
		const model = await this.getModel(surface);
		await this.moveBrowserMouse(model, await this.resolvePointerTarget(surface, model, input));
		await this.playwright(model, 'fill', { ...this.normalizeLocator(surface, input), value: input.value });
		return { ...this.state(surface, model), action: 'fill', target: this.describeLocator(input) };
	}

	async check(surface: CleanSlateBrowserSurface, input: ICleanSlateBrowserLocator & { checked?: boolean }): Promise<ICleanSlateBrowserActionResult> {
		const model = await this.getModel(surface);
		const desired = input.checked ?? true;
		await this.moveBrowserMouse(model, await this.resolvePointerTarget(surface, model, input));
		await this.playwright(model, 'check', { ...this.normalizeLocator(surface, input), checked: desired });
		return { ...this.state(surface, model), action: desired ? 'check' : 'uncheck', target: this.describeLocator(input) };
	}

	async select(surface: CleanSlateBrowserSurface, input: ICleanSlateBrowserLocator & { values: string[] }): Promise<ICleanSlateBrowserActionResult & { values: string[] }> {
		const model = await this.getModel(surface);
		await this.moveBrowserMouse(model, await this.resolvePointerTarget(surface, model, input));
		const result = await this.playwright<{ values?: unknown[] }>(model, 'select', { ...this.normalizeLocator(surface, input), values: input.values });
		const values = Array.isArray(result.values) ? result.values.filter((value): value is string => typeof value === 'string') : [];
		return { ...this.state(surface, model), action: 'select', target: this.describeLocator(input), values };
	}

	async uploadFiles(surface: CleanSlateBrowserSurface, input: ICleanSlateBrowserLocator & { files: string[] }): Promise<ICleanSlateBrowserActionResult & { files: string[] }> {
		const model = await this.getModel(surface);
		if (input.files.length === 0) {
			throw new Error('browser_upload requires at least one file path.');
		}
		await this.playwright(model, 'upload', { ...this.normalizeLocator(surface, input), files: input.files });
		return { ...this.state(surface, model), action: 'upload', target: this.describeLocator(input), files: input.files };
	}

	async handleDialog(surface: CleanSlateBrowserSurface, input: { accept: boolean; promptText?: string }): Promise<ICleanSlateBrowserActionResult> {
		const model = await this.getModel(surface);
		await model.handleJavaScriptDialog(input.accept, input.promptText);
		return { ...this.state(surface, model), action: input.accept ? 'accept_dialog' : 'dismiss_dialog' };
	}

	async clipboard(surface: CleanSlateBrowserSurface, input: { action: 'read' | 'write'; text?: string }): Promise<ICleanSlateBrowserActionResult & { text?: string }> {
		const model = await this.getModel(surface);
		await model.focus();
		if (input.action === 'write') {
			await model.executeJavaScript(`navigator.clipboard.writeText(${JSON.stringify(input.text ?? '')})`);
			return { ...this.state(surface, model), action: 'write_clipboard' };
		}
		const text = await model.executeJavaScript('navigator.clipboard.readText()');
		return { ...this.state(surface, model), action: 'read_clipboard', text: typeof text === 'string' ? text : '' };
	}

	async typeText(surface: CleanSlateBrowserSurface, text: string): Promise<ICleanSlateBrowserActionResult> {
		const model = await this.getModel(surface);
		await this.playwright(model, 'type', { text });
		return { ...this.state(surface, model), action: 'type_text' };
	}

	async pressKey(surface: CleanSlateBrowserSurface, input: ICleanSlateBrowserLocator & { key: string; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean }): Promise<ICleanSlateBrowserActionResult> {
		const model = await this.getModel(surface);
		const key = input.key?.trim();
		if (!key) {
			throw new Error('browser_key requires a non-empty key.');
		}
		await this.playwright(model, 'press', { ...this.normalizeLocator(surface, input), key });
		return { ...this.state(surface, model), action: 'key', target: this.describeLocator(input) ?? key };
	}

	async scroll(surface: CleanSlateBrowserSurface, input: ICleanSlateBrowserTarget & { deltaX?: number; deltaY?: number }): Promise<ICleanSlateBrowserActionResult> {
		const model = await this.getModel(surface);
		const point = await this.resolvePointerTarget(surface, model, input);
		await this.moveBrowserMouse(model, point);
		await model.dispatchMouseEvent({
			type: 'mouseWheel',
			...point,
			deltaX: input.deltaX ?? 0,
			deltaY: input.deltaY ?? 520
		});
		await this.delay(500);
		return { ...this.state(surface, model), action: 'scroll', target: this.describeLocator(input), point };
	}

	async wait(surface: CleanSlateBrowserSurface, input?: ICleanSlateBrowserWaitOptions): Promise<ICleanSlateBrowserState> {
		const model = await this.getModel(surface);
		const request = input ?? { ms: 1000 };
		await this.playwright(model, 'wait', this.normalizeLocator(surface, request));
		return this.state(surface, model);
	}

	async getUrl(surface: CleanSlateBrowserSurface): Promise<ICleanSlateBrowserState> {
		const model = await this.getModel(surface);
		return this.state(surface, model);
	}

	async getDiagnostics(surface: CleanSlateBrowserSurface, options?: { clear?: boolean }): Promise<ICleanSlateBrowserState & IBrowserViewDiagnostics> {
		const model = await this.getModel(surface);
		const diagnostics = await model.getDiagnostics(options?.clear);
		return { ...this.state(surface, model), ...diagnostics };
	}

	async listTabs(surface: CleanSlateBrowserSurface): Promise<{ success: true; tabs: ICleanSlateBrowserTab[] }> {
		await this.getModel(surface);
		return { success: true, tabs: this.tabsFor(surface) };
	}

	async newTab(surface: CleanSlateBrowserSurface, options?: { url?: string; background?: boolean }): Promise<ICleanSlateBrowserState & { tabId: string }> {
		const tabId = `${this.browserViewIdForSurface(surface)}.tab.${this.nextTabId++}`;
		const model = await this.browserViewWorkbenchService.getOrCreateBrowserViewModel(tabId, this.browserViewIdForSurface(surface));
		this.trackBrowserModel(surface, model, !options?.background);
		if (!this.isAgentManagerSurface(surface)) {
			const resource = BrowserViewUri.forUrl(options?.url ? this.normalizeUrl(options.url) : 'about:blank', tabId);
			await this.editorService.openEditor({
				resource,
				options: {
					pinned: true,
					inactive: options?.background ?? false
				}
			}, ACTIVE_GROUP);
		}
		if (options?.url) {
			await model.loadURL(this.normalizeUrl(options.url));
			await this.waitForPageSettled(model);
		}
		if (!options?.background) {
			await this.activateBrowserTab(surface, model);
		}
		return { ...this.state(surface, model), tabId };
	}

	async selectTab(surface: CleanSlateBrowserSurface, tabId: string): Promise<ICleanSlateBrowserState & { tabId: string }> {
		const model = this.browserTabs.get(surface)?.get(tabId);
		if (!model) {
			throw new Error(`Browser tab "${tabId}" does not exist on this CleanSlate surface.`);
		}
		const editor = this.findBrowserEditorById(tabId);
		if (editor) {
			await this.editorService.openEditor(editor.editor, { pinned: true }, editor.groupId);
		}
		await this.activateBrowserTab(surface, model);
		return { ...this.state(surface, model), tabId };
	}

	async closeTab(surface: CleanSlateBrowserSurface, tabId: string): Promise<{ success: true; tabs: ICleanSlateBrowserTab[] }> {
		const tabs = this.browserTabs.get(surface);
		const model = tabs?.get(tabId);
		if (!tabs || !model) {
			throw new Error(`Browser tab "${tabId}" does not exist on this CleanSlate surface.`);
		}
		const wasActive = this.browserModels.get(surface) === model;
		tabs.delete(tabId);
		const editor = this.findBrowserEditorById(tabId);
		if (editor) {
			await this.editorService.closeEditor(editor);
		} else {
			model.dispose();
		}
		if (wasActive) {
			const remaining = Array.from(tabs.values());
			const replacement = remaining[remaining.length - 1];
			if (replacement) {
				await this.activateBrowserTab(surface, replacement);
			} else {
				this.browserModels.delete(surface);
			}
		}
		return { success: true, tabs: this.tabsFor(surface) };
	}

	async screenshot(surface: CleanSlateBrowserSurface, options?: { quality?: number; fullPage?: boolean }): Promise<ICleanSlateBrowserState & { mimeType: 'image/jpeg'; base64: string }> {
		const model = await this.getModel(surface);
		const quality = Math.max(1, Math.min(options?.quality ?? 85, 100));
		const image = await this.playwright<{ mimeType: 'image/jpeg'; base64: string }>(model, 'screenshot', { quality, fullPage: options?.fullPage ?? false });
		return { ...this.state(surface, model), ...image };
	}

	async startAnnotation(surface: CleanSlateBrowserSurface): Promise<ICleanSlateBrowserState & { annotationMode: 'active' }> {
		const model = await this.getModel(surface);
		await model.focus();
		await model.startAnnotationMode();
		await model.focus();
		return { ...this.state(surface, model), annotationMode: 'active' };
	}

	async stopAnnotation(surface: CleanSlateBrowserSurface): Promise<ICleanSlateBrowserState & { annotationMode: 'inactive'; annotations: ICleanSlateBrowserAnnotation[] }> {
		const model = await this.getModel(surface);
		const annotations = this.replaceAnnotations(surface, await model.stopAnnotationMode());
		return { ...this.state(surface, model), annotationMode: 'inactive', annotations };
	}

	async listAnnotations(surface: CleanSlateBrowserSurface): Promise<ICleanSlateBrowserState & { annotations: ICleanSlateBrowserAnnotation[] }> {
		const model = await this.getModel(surface);
		const annotations = this.replaceAnnotations(surface, await model.listAnnotations());
		return { ...this.state(surface, model), annotations };
	}

	listCachedAnnotations(surface: CleanSlateBrowserSurface): ICleanSlateBrowserAnnotation[] {
		return this.listCachedAnnotationsFor(surface);
	}

	async refreshVisibleAnnotations(surface: CleanSlateBrowserSurface): Promise<ICleanSlateBrowserAnnotation[]> {
		const model = await this.getVisibleBrowserModel(surface);
		if (!model) {
			return this.listCachedAnnotationsFor(surface);
		}
		return this.replaceAnnotations(surface, await model.listAnnotations());
	}

	async deleteAnnotation(surface: CleanSlateBrowserSurface, annotationId: string): Promise<ICleanSlateBrowserState & { annotations: ICleanSlateBrowserAnnotation[] }> {
		const model = await this.getModel(surface);
		this.annotationsFor(surface).delete(annotationId);
		const annotations = this.mergeAnnotations(surface, await model.deleteAnnotation(annotationId));
		return { ...this.state(surface, model), annotations };
	}

	async clearAnnotations(surface: CleanSlateBrowserSurface): Promise<ICleanSlateBrowserState & { annotations: ICleanSlateBrowserAnnotation[] }> {
		const model = await this.getModel(surface);
		this.annotationsFor(surface).clear();
		const annotations = await model.clearAnnotations();
		this._onDidChangeAnnotations.fire({ surface, annotations: [] });
		return { ...this.state(surface, model), annotations };
	}

	private async getModel(surface: CleanSlateBrowserSurface): Promise<IBrowserViewModel> {
		const cachedModel = this.browserModels.get(surface);
		if (cachedModel) {
			return cachedModel;
		}

		const visibleModel = await this.getVisibleBrowserModel(surface);
		if (visibleModel) {
			return this.trackBrowserModel(surface, visibleModel);
		}

		const model = await this.browserViewWorkbenchService.getOrCreateBrowserViewModel(this.browserViewIdForSurface(surface));
		return this.trackBrowserModel(surface, model);
	}

	private async getOpenCleanSlateBrowserModel(surface: CleanSlateBrowserSurface): Promise<IBrowserViewModel | undefined> {
		const model = this.browserModels.get(surface);
		if (model?.url && model.url !== 'about:blank') {
			return model;
		}
		return undefined;
	}

	private async getVisibleBrowserModel(surface: CleanSlateBrowserSurface): Promise<IBrowserViewModel | undefined> {
		if (this.isAgentManagerSurface(surface)) {
			return this.browserModels.get(surface);
		}

		const editors = [
			this.editorService.activeEditor,
			...this.editorService.visibleEditors
		];
		const expectedId = this.browserViewIdForSurface(surface);

		for (const editor of editors) {
			const resource = editor?.resource;
			if (!resource) {
				continue;
			}
			const id = BrowserViewUri.getId(resource);
			if (!id) {
				continue;
			}
			if (id === expectedId) {
				return this.browserViewWorkbenchService.getOrCreateBrowserViewModel(id);
			}
		}

		return this.browserModels.get(surface);
	}

	private browserViewIdForSurface(surface: CleanSlateBrowserSurface): string {
		return this.isAgentManagerSurface(surface)
			? this.agentManagerBrowserViewIdForSurface(surface)
			: CleanSlateBrowserAutomationService.ideBrowserViewId;
	}

	private agentManagerBrowserViewIdForSurface(surface: CleanSlateBrowserSurface): string {
		if (surface === 'agentManager') {
			return CleanSlateBrowserAutomationService.agentManagerBrowserViewId;
		}
		return `${CleanSlateBrowserAutomationService.agentManagerBrowserViewId}.${this.browserSurfaceKey(surface)}`;
	}

	private normalizeAgentManagerSurface(surface: CleanSlateBrowserSurface): CleanSlateBrowserSurface {
		return this.isAgentManagerSurface(surface) ? surface : 'agentManager';
	}

	private isAgentManagerSurface(surface: CleanSlateBrowserSurface): boolean {
		return surface === 'agentManager' || surface.startsWith('agentManager:');
	}

	private browserSurfaceKey(surface: CleanSlateBrowserSurface): string {
		return surface.replace(/^agentManager:/, '').replace(/[^a-zA-Z0-9._-]/g, '-');
	}

	private state(surface: CleanSlateBrowserSurface, model: IBrowserViewModel, loadError?: string): ICleanSlateBrowserState {
		return {
			success: true,
			surface,
			viewId: model.id,
			url: model.url,
			title: model.title,
			visible: model.visible,
			loading: model.loading,
			canGoBack: model.canGoBack,
			canGoForward: model.canGoForward,
			annotationActive: model.annotationActive,
			...(loadError ? { loadError } : {})
		};
	}

	private trackBrowserModel(surface: CleanSlateBrowserSurface, model: IBrowserViewModel, makeActive = true): IBrowserViewModel {
		const tabs = this.browserTabsFor(surface);
		tabs.set(model.id, model);
		if (makeActive) {
			this.browserModels.set(surface, model);
		}
		const disposableKey = this.browserModelDisposableKey(surface, model.id);
		if (this.browserModelDisposables.has(disposableKey)) {
			return model;
		}

		const store = new DisposableStore();
		this.browserModelDisposables.set(disposableKey, store);

		const fireState = () => this._onDidOpenBrowser.fire(this.state(surface, model));
		store.add(model.onDidChangeNavigationState(fireState));
		store.add(model.onDidChangeLoadingState(fireState));
		store.add(model.onDidChangeTitle(fireState));
		store.add(model.onDidChangeAnnotationState(fireState));
		store.add(model.onDidRequestNewPage(event => {
			const childId = BrowserViewUri.getId(event.resource);
			if (!childId) {
				return;
			}
			void this.browserViewWorkbenchService.getOrCreateBrowserViewModel(childId).then(child => {
				this.trackBrowserModel(surface, child, event.location !== 'background');
				if (event.location !== 'background') {
					return this.activateBrowserTab(surface, child);
				}
				return undefined;
			}).catch(error => console.warn('[CleanSlateBrowserAutomationService] Failed to bind popup tab:', error));
		}));
		store.add(model.onWillDispose(() => {
			if (this.browserModels.get(surface) === model) {
				this.browserModels.delete(surface);
			}
			tabs.delete(model.id);
			if (this.browserModelDisposables.get(disposableKey) === store) {
				this.browserModelDisposables.delete(disposableKey);
			}
			store.clear();
		}));

		return model;
	}

	private browserTabsFor(surface: CleanSlateBrowserSurface): Map<string, IBrowserViewModel> {
		let tabs = this.browserTabs.get(surface);
		if (!tabs) {
			tabs = new Map<string, IBrowserViewModel>();
			this.browserTabs.set(surface, tabs);
		}
		return tabs;
	}

	private browserModelDisposableKey(surface: CleanSlateBrowserSurface, modelId: string): string {
		return `${surface}\0${modelId}`;
	}

	private tabsFor(surface: CleanSlateBrowserSurface): ICleanSlateBrowserTab[] {
		const active = this.browserModels.get(surface);
		return Array.from(this.browserTabsFor(surface).values()).map(model => ({
			id: model.id,
			url: model.url,
			title: model.title,
			active: model === active
		}));
	}

	private async activateBrowserTab(surface: CleanSlateBrowserSurface, model: IBrowserViewModel): Promise<void> {
		const previous = this.browserModels.get(surface);
		if (previous && previous !== model) {
			await previous.setVisible(false);
		}
		this.trackBrowserModel(surface, model, true);
		const bounds = this.browserLayouts.get(surface);
		if (bounds) {
			await model.layout(this.toBrowserViewBounds(bounds));
		}
		await model.setVisible(true);
		await model.bringToFront();
		this._onDidOpenBrowser.fire(this.state(surface, model));
	}

	private normalizeUrl(url: string): string {
		const trimmed = url.trim();
		if (!trimmed || trimmed.toLowerCase() === 'about:blank') {
			throw new Error('A concrete URL is required to open the integrated browser.');
		}

		try {
			return new URL(trimmed).href;
		} catch {
			return new URL(`http://${trimmed}`).href;
		}
	}

	private snapshotElementsFor(surface: CleanSlateBrowserSurface): Map<string, ICleanSlateBrowserElement> {
		let elements = this.snapshotElements.get(surface);
		if (!elements) {
			elements = new Map<string, ICleanSlateBrowserElement>();
			this.snapshotElements.set(surface, elements);
		}
		return elements;
	}

	private annotationsFor(surface: CleanSlateBrowserSurface): Map<string, ICleanSlateBrowserAnnotation> {
		let annotations = this.annotations.get(surface);
		if (!annotations) {
			annotations = new Map<string, ICleanSlateBrowserAnnotation>();
			this.annotations.set(surface, annotations);
		}
		return annotations;
	}

	private listCachedAnnotationsFor(surface: CleanSlateBrowserSurface): ICleanSlateBrowserAnnotation[] {
		return Array.from(this.annotationsFor(surface).values()).sort((a, b) => a.createdAt - b.createdAt);
	}

	private mergeAnnotations(surface: CleanSlateBrowserSurface, annotations: ICleanSlateBrowserAnnotation[]): ICleanSlateBrowserAnnotation[] {
		const cachedAnnotations = this.annotationsFor(surface);
		for (const annotation of annotations) {
			cachedAnnotations.set(annotation.id, annotation);
		}
		const merged = this.listCachedAnnotationsFor(surface);
		this._onDidChangeAnnotations.fire({ surface, annotations: merged });
		return merged;
	}

	private replaceAnnotations(surface: CleanSlateBrowserSurface, annotations: ICleanSlateBrowserAnnotation[]): ICleanSlateBrowserAnnotation[] {
		const cachedAnnotations = this.annotationsFor(surface);
		cachedAnnotations.clear();
		for (const annotation of annotations) {
			cachedAnnotations.set(annotation.id, annotation);
		}
		const next = this.listCachedAnnotationsFor(surface);
		this._onDidChangeAnnotations.fire({ surface, annotations: next });
		return next;
	}

	private async openAgentManagerBrowser(normalizedUrl: string, surface: CleanSlateBrowserSurface): Promise<ICleanSlateBrowserState> {
		const model = await this.browserViewWorkbenchService.getOrCreateBrowserViewModel(this.browserViewIdForSurface(surface));
		this.trackBrowserModel(surface, model);
		const loadError = await this.loadUrlIfNeeded(model, normalizedUrl);
		await this.waitForPageSettled(model);
		return this.state(surface, model, loadError);
	}

	private async openBrowserEditor(normalizedUrl: string): Promise<ICleanSlateBrowserState> {
		const model = await this.browserViewWorkbenchService.getOrCreateBrowserViewModel(this.browserViewIdForSurface('ide'));
		this.trackBrowserModel('ide', model);
		const existingBrowserEditor = this.findOpenBrowserEditor();
		if (existingBrowserEditor) {
			await this.editorService.openEditor(existingBrowserEditor.editor, { pinned: true }, existingBrowserEditor.groupId);
		} else {
			const resource = BrowserViewUri.forUrl(normalizedUrl, this.browserViewIdForSurface('ide'));
			await this.editorService.openEditor({ resource, options: { pinned: true, revealIfOpened: true } }, ACTIVE_GROUP);
		}

		const loadError = await this.loadUrlIfNeeded(model, normalizedUrl);
		await this.waitForPageSettled(model);
		return this.state('ide', model, loadError);
	}

	private async loadUrlIfNeeded(model: IBrowserViewModel, normalizedUrl: string): Promise<string | undefined> {
		if (model.url === normalizedUrl) {
			return undefined;
		}
		try {
			await model.loadURL(normalizedUrl);
			return undefined;
		} catch (error) {
			const message = this.getErrorMessage(error);
			console.warn('[CleanSlateBrowserAutomationService] Browser navigation failed after opening the browser surface:', message);
			return message;
		}
	}

	private getErrorMessage(error: unknown): string {
		if (error instanceof Error && error.message) {
			return error.message;
		}
		return String(error);
	}

	private findOpenBrowserEditor() {
		for (const editorIdentifier of this.editorService.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE)) {
			const resource = editorIdentifier.editor.resource;
			if (resource && BrowserViewUri.getId(resource) === this.browserViewIdForSurface('ide')) {
				return editorIdentifier;
			}
		}

		return undefined;
	}

	private findBrowserEditorById(viewId: string) {
		return this.editorService.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE).find(editorIdentifier => {
			const resource = editorIdentifier.editor.resource;
			return !!resource && BrowserViewUri.getId(resource) === viewId;
		});
	}

	private toBrowserViewBounds(bounds: ICleanSlateBrowserLayoutBounds): IBrowserViewBounds {
		return {
			windowId: mainWindow.vscodeWindowId,
			x: Math.round(bounds.x),
			y: Math.round(bounds.y),
			width: Math.max(1, Math.round(bounds.width)),
			height: Math.max(1, Math.round(bounds.height)),
			zoomFactor: getZoomFactor(mainWindow)
		};
	}

	private async waitForPageSettled(model: IBrowserViewModel, timeoutMs = 5000): Promise<void> {
		if (model.loading) {
			await new Promise<void>(resolve => {
				const timeout = setTimeout(() => {
					listener.dispose();
					resolve();
				}, timeoutMs);
				const listener = model.onDidChangeLoadingState(event => {
					if (!event.loading) {
						clearTimeout(timeout);
						listener.dispose();
						resolve();
					}
				});
			});
		}
		const networkDeadline = Date.now() + Math.min(timeoutMs, 1500);
		let idleSince: number | undefined;
		while (Date.now() < networkDeadline) {
			const diagnostics = await model.getDiagnostics(false).catch(() => undefined);
			if (!diagnostics) {
				return;
			}
			const pending = diagnostics.network.some(entry => !entry.completedAt && !entry.error && entry.resourceType !== 'webSocket');
			if (!pending) {
				idleSince ??= Date.now();
				if (Date.now() - idleSince >= 250) {
					return;
				}
			} else {
				idleSince = undefined;
			}
			await this.delay(50);
		}
	}

	private async snapshotVisible(surface: CleanSlateBrowserSurface, model: IBrowserViewModel, options?: { limit?: number }): Promise<ICleanSlateBrowserSnapshot> {
		await this.waitForPageSettled(model);
		const limit = Math.max(1, Math.min(options?.limit ?? 120, 300));
		const raw = await this.playwright(model, 'evaluate', { expression: this.visibleSnapshotScript(limit) });
		const value = raw && typeof raw === 'object' ? raw as Partial<ICleanSlateBrowserSnapshot> : {};
		if (typeof (value as { error?: unknown }).error === 'string') {
			throw new Error(`Unable to inspect the live browser page: ${(value as { error: string }).error}`);
		}
		const elements = Array.isArray(value.elements)
			? value.elements.filter((element): element is ICleanSlateBrowserElement => !!element && typeof element === 'object' && typeof (element as ICleanSlateBrowserElement).id === 'string')
			: [];
		return {
			...this.state(surface, model),
			title: typeof value.title === 'string' ? value.title : model.title,
			viewport: value.viewport ?? { width: 0, height: 0, devicePixelRatio: 1 },
			bodyText: typeof value.bodyText === 'string' ? value.bodyText : '',
			elements,
			theme: value.theme
		};
	}

	private describeLocator(input: ICleanSlateBrowserLocator): string | undefined {
		return input.elementId
			?? input.selector
			?? input.testId
			?? input.name
			?? input.label
			?? input.placeholder
			?? input.text
			?? input.role;
	}

	private normalizeLocator(surface: CleanSlateBrowserSurface, input: ICleanSlateBrowserLocator): ICleanSlateBrowserLocator {
		if (!input.elementId || input.selector) {
			return input;
		}
		const element = this.snapshotElementsFor(surface).get(input.elementId);
		if (!element?.selector) {
			throw new Error(`Browser element "${input.elementId}" is stale or unknown. Take a new browser_snapshot and retry.`);
		}
		return { ...input, selector: element.selector };
	}

	private async playwright<T = unknown>(model: IBrowserViewModel, action: CleanSlatePlaywrightBrowserAction, input?: object): Promise<T> {
		return this.cleanSlateMainService.browserPlaywright({
			viewId: model.id,
			action,
			input: input as Record<string, unknown> | undefined
		}) as Promise<T>;
	}

	private async resolvePointerTarget(surface: CleanSlateBrowserSurface, model: IBrowserViewModel, input: ICleanSlateBrowserTarget): Promise<ICleanSlateBrowserPoint> {
		const result = await this.playwright<{ point: ICleanSlateBrowserPoint }>(model, 'resolvePoint', this.normalizeLocator(surface, input));
		return result.point;
	}

	private async moveBrowserMouse(model: IBrowserViewModel, point: ICleanSlateBrowserPoint): Promise<void> {
		await model.moveMouse(point.x, point.y);
		await this.delay(120);
	}

	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	private visibleSnapshotScript(limit: number): string {
		return `
			(() => {
				try {
					const limit = ${limit};
					const clean = (value, max = 180) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, max);
					const attr = (element, name) => {
						try { return element.getAttribute(name) || undefined; } catch { return undefined; }
					};
					const cssEscape = (value) => {
						if (window.CSS && typeof window.CSS.escape === 'function') {
							return window.CSS.escape(String(value));
						}
						return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
					};
						const selectorFor = (element) => {
						if (element.id) {
							return '#' + cssEscape(element.id);
						}
						const testId = attr(element, 'data-testid') || attr(element, 'data-test') || attr(element, 'data-cy');
						if (testId) {
							return element.tagName.toLowerCase() + '[data-testid="' + String(testId).replace(/"/g, '\\\\"') + '"]';
						}
						const parts = [];
						let current = element;
						while (current && current.nodeType === 1 && current !== document.documentElement && parts.length < 5) {
							let part = current.tagName.toLowerCase();
							const parent = current.parentElement;
							if (parent) {
								const siblings = Array.from(parent.children).filter(child => child.tagName === current.tagName);
								if (siblings.length > 1) {
									part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
								}
							}
							parts.unshift(part);
							current = parent;
						}
							return parts.join(' > ');
						};
						const implicitRole = (element) => {
							const explicit = attr(element, 'role');
							if (explicit) { return explicit.split(/\\s+/)[0]; }
							const tag = element.tagName.toLowerCase();
							if (tag === 'a' && element.hasAttribute('href')) { return 'link'; }
							if (tag === 'button' || tag === 'summary') { return 'button'; }
							if (tag === 'textarea') { return 'textbox'; }
							if (tag === 'select') { return element.multiple || element.size > 1 ? 'listbox' : 'combobox'; }
							if (tag === 'option') { return 'option'; }
							if (/^h[1-6]$/.test(tag)) { return 'heading'; }
							if (tag === 'img') { return 'img'; }
							if (tag === 'input') {
								const type = (attr(element, 'type') || 'text').toLowerCase();
								if (type === 'checkbox') { return 'checkbox'; }
								if (type === 'radio') { return 'radio'; }
								if (['button', 'submit', 'reset', 'image'].includes(type)) { return 'button'; }
								if (type === 'range') { return 'slider'; }
								if (type === 'number') { return 'spinbutton'; }
								if (!['hidden', 'file', 'color'].includes(type)) { return 'textbox'; }
							}
							return undefined;
						};
						const labelText = (element) => {
							const labels = element.labels ? Array.from(element.labels) : [];
							return clean(labels.map(label => label.innerText || label.textContent).join(' '));
						};
						const accessibleName = (element) => clean(
							attr(element, 'aria-label')
							|| labelText(element)
							|| attr(element, 'alt')
							|| attr(element, 'title')
							|| (element.tagName.toLowerCase() === 'input' ? element.value : '')
							|| element.innerText
							|| element.textContent
						);
					const isVisible = (element) => {
						const rect = element.getBoundingClientRect();
						const style = window.getComputedStyle(element);
						return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
					};
					const parseColor = (value) => {
						const match = String(value || '').match(/rgba?\\(([^)]+)\\)/i);
						if (!match) { return undefined; }
						const parts = match[1].split(',').map(part => Number(part.trim()));
						if (parts.length < 3 || parts.some(part => Number.isNaN(part))) { return undefined; }
						return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1 };
					};
					const resolveBackground = (element) => {
						let current = element;
						while (current && current !== document.documentElement) {
							const style = window.getComputedStyle(current);
							const color = parseColor(style.backgroundColor);
							if (color && color.a > 0) {
								return style.backgroundColor;
							}
							current = current.parentElement;
						}
						return window.getComputedStyle(document.body || document.documentElement).backgroundColor;
					};
					const luminance = (channel) => {
						const normalized = channel / 255;
						return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
					};
					const contrastRatioFor = (foreground, background) => {
						const fg = parseColor(foreground);
						const bg = parseColor(background);
						if (!fg || !bg) { return undefined; }
						const fgLum = 0.2126 * luminance(fg.r) + 0.7152 * luminance(fg.g) + 0.0722 * luminance(fg.b);
						const bgLum = 0.2126 * luminance(bg.r) + 0.7152 * luminance(bg.g) + 0.0722 * luminance(bg.b);
						const lighter = Math.max(fgLum, bgLum);
						const darker = Math.min(fgLum, bgLum);
						return Number((((lighter + 0.05) / (darker + 0.05))).toFixed(2));
					};
						const selectors = 'a,button,input,textarea,select,summary,label,[role],[tabindex],[contenteditable="true"],[onclick],h1,h2,h3,h4,h5,h6,p,li,span,small,blockquote,figcaption,dt,dd,td,th';
						const candidates = [];
						const visitedRoots = new Set();
						const visitRoot = (root, offsetX, offsetY) => {
							if (!root || visitedRoots.has(root)) { return; }
							visitedRoots.add(root);
							for (const element of Array.from(root.querySelectorAll(selectors))) {
								candidates.push({ element, offsetX, offsetY });
							}
							for (const element of Array.from(root.querySelectorAll('*'))) {
								if (element.shadowRoot) {
									visitRoot(element.shadowRoot, offsetX, offsetY);
								}
								if (element.tagName.toLowerCase() === 'iframe') {
									try {
										const frameDocument = element.contentDocument;
										if (frameDocument) {
											const frameRect = element.getBoundingClientRect();
											visitRoot(frameDocument, offsetX + frameRect.x, offsetY + frameRect.y);
										}
									} catch {
										// Cross-origin frame contents remain isolated.
									}
								}
							}
						};
						visitRoot(document, 0, 0);
						const elements = [];
						for (const candidate of candidates) {
							const element = candidate.element;
							if (elements.length >= limit || !isVisible(element)) {
							continue;
						}
						const rect = element.getBoundingClientRect();
						const anyElement = element;
						const computed = window.getComputedStyle(element);
						const text = clean(anyElement.innerText || element.textContent || anyElement.value || attr(element, 'title') || attr(element, 'alt'));
						const backgroundColor = resolveBackground(element);
						const contrastRatio = text ? contrastRatioFor(computed.color, backgroundColor) : undefined;
							elements.push({
								id: 'element-' + (elements.length + 1),
								tagName: element.tagName.toLowerCase(),
								selector: selectorFor(element),
								testId: attr(element, 'data-testid') || attr(element, 'data-test') || attr(element, 'data-cy'),
								role: implicitRole(element),
								name: accessibleName(element) || undefined,
								text: text || undefined,
							ariaLabel: clean(attr(element, 'aria-label')) || undefined,
							placeholder: clean(attr(element, 'placeholder')) || undefined,
								href: anyElement.href || undefined,
								type: attr(element, 'type'),
								checked: typeof anyElement.checked === 'boolean' ? anyElement.checked : undefined,
								disabled: typeof anyElement.disabled === 'boolean' ? anyElement.disabled : undefined,
								boundingBox: {
									x: Math.round(candidate.offsetX + rect.x),
									y: Math.round(candidate.offsetY + rect.y),
								width: Math.round(rect.width),
								height: Math.round(rect.height)
							},
							visual: {
								color: computed.color,
								backgroundColor: backgroundColor,
								opacity: Number(computed.opacity || '1'),
								contrastRatio: contrastRatio,
								lowContrast: typeof contrastRatio === 'number' ? contrastRatio < 4.5 : undefined
							}
						});
					}
					const rootStyle = window.getComputedStyle(document.documentElement);
					const bodyStyle = window.getComputedStyle(document.body || document.documentElement);
					return {
						success: true,
						viewId: 'cleanslate.visible.browser',
						backend: 'browserView',
						url: location.href,
						title: document.title,
						loading: document.readyState === 'loading',
						viewport: {
							width: window.innerWidth,
							height: window.innerHeight,
							devicePixelRatio: window.devicePixelRatio || 1
						},
						bodyText: clean((document.body && document.body.innerText) || '', 4000),
						theme: {
							prefersColorScheme: window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
							colorScheme: rootStyle.colorScheme || bodyStyle.colorScheme || undefined,
							backgroundColor: bodyStyle.backgroundColor,
							foregroundColor: bodyStyle.color
						},
						elements
					};
				} catch (error) {
					return {
						success: true,
						viewId: 'cleanslate.visible.browser',
						backend: 'browserView',
						url: location.href,
						title: document.title,
						loading: document.readyState === 'loading',
						viewport: { width: window.innerWidth || 0, height: window.innerHeight || 0, devicePixelRatio: window.devicePixelRatio || 1 },
						bodyText: '',
						elements: [],
						theme: undefined,
						error: error && error.message ? error.message : String(error)
					};
				}
			})()
		`;
	}

	override dispose(): void {
		for (const store of this.browserModelDisposables.values()) {
			store.dispose();
		}
		this.browserModelDisposables.clear();
		super.dispose();
	}

}
