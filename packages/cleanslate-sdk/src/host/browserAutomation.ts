/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Slate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Subscribable } from './events.js';

/**
 * Browser automation as a host capability.
 *
 * The interfaces below were extracted from the fork's
 * `cleanSlateBrowserAutomationService`, whose implementation needs a real
 * browser view and the DOM and therefore stays in the IDE. The tools only ever
 * spoke to this shape, so moving the declarations lets them come along while
 * the implementation stays behind.
 *
 * The browser-view types it referenced (`IBrowserViewAnnotation`,
 * `IBrowserViewDiagnostics` and the entry types beneath it) are reproduced here
 * rather than referenced, since they are plain data and the SDK cannot reach
 * the editor's platform layer. A host that has no browser simply does not
 * supply this capability, and the browser tools report it as unavailable.
 */

//#region browser-view types, from vs/platform/browserView/common/browserView

export interface IBrowserViewConsoleEntry {
	level: 'debug' | 'info' | 'warning' | 'error';
	message: string;
	sourceId: string;
	lineNumber: number;
	timestamp: number;
}

export interface IBrowserViewNetworkEntry {
	id: number;
	url: string;
	method: string;
	resourceType: string;
	startedAt: number;
	completedAt?: number;
	durationMs?: number;
	statusCode?: number;
	fromCache?: boolean;
	error?: string;
}

export interface IBrowserViewDownloadEntry {
	id: string;
	url: string;
	filename: string;
	savePath?: string;
	state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
	receivedBytes: number;
	totalBytes: number;
	startedAt: number;
	completedAt?: number;
}

export interface IBrowserViewDiagnostics {
	console: IBrowserViewConsoleEntry[];
	network: IBrowserViewNetworkEntry[];
	downloads: IBrowserViewDownloadEntry[];
}

/** From vs/workbench/contrib/browserView/common/cleanSlateBrowserAnnotation. */
export interface IBrowserViewAnnotation {
	id: string;
	url: string;
	title: string;
	text: string;
	tagName: string;
	label: string;
	selector: string;
	elementText?: string;
	ariaLabel?: string;
	href?: string;
	pageX: number;
	pageY: number;
	x: number;
	y: number;
	width: number;
	height: number;
	createdAt: number;
}

//#endregion

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

	readonly onDidChangeAnnotations: Subscribable<ICleanSlateBrowserAnnotationChangeEvent>;
	readonly onDidOpenBrowser: Subscribable<ICleanSlateBrowserState>;
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
