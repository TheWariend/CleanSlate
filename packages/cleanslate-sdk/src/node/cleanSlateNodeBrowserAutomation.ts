/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { chromium, Browser, BrowserContext, Dialog, Locator, Page } from 'playwright';
import { Emitter } from '../core/event.js';
import {
	CleanSlateBrowserSurface,
	IBrowserViewConsoleEntry,
	IBrowserViewNetworkEntry,
	ICleanSlateBrowserActionResult,
	ICleanSlateBrowserAnnotation,
	ICleanSlateBrowserAutomationService,
	ICleanSlateBrowserLocator,
	ICleanSlateBrowserSnapshot,
	ICleanSlateBrowserState,
	ICleanSlateBrowserTab,
	ICleanSlateBrowserTarget,
	ICleanSlateBrowserWaitOptions
} from '../host/browserAutomation.js';

export interface ICleanSlateNodeBrowserAutomationOptions {
	headless?: boolean;
}

export function resolveNodeBrowserHeadless(
	configuredDefault = true,
	environment: NodeJS.ProcessEnv = process.env
): boolean {
	const environmentValue = environment['CLEANSLATE_BROWSER_HEADLESS'];
	return environmentValue === undefined ? configuredDefault : environmentValue !== 'false';
}

export class CleanSlateNodeBrowserAutomation implements ICleanSlateBrowserAutomationService {
	private browser: Browser | undefined;
	private context: BrowserContext | undefined;
	private activePage: Page | undefined;
	private nextTabId = 1;
	private readonly tabIds = new Map<Page, string>();
	private readonly consoleEntries: IBrowserViewConsoleEntry[] = [];
	private readonly networkEntries: IBrowserViewNetworkEntry[] = [];
	private readonly annotations: ICleanSlateBrowserAnnotation[] = [];
	private pendingDialog: Dialog | undefined;
	private annotationActive = false;
	private readonly annotationEmitter = new Emitter<any>();
	private readonly openEmitter = new Emitter<ICleanSlateBrowserState>();
	readonly onDidChangeAnnotations = this.annotationEmitter.event;
	readonly onDidOpenBrowser = this.openEmitter.event;

	constructor(private readonly options: ICleanSlateNodeBrowserAutomationOptions = {}) { }

	async open(url: string): Promise<ICleanSlateBrowserState> {
		const page = await this.ensurePage();
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
		const state = await this.state('ide', page);
		this.openEmitter.fire(state);
		return state;
	}

	openInAgentManager(url: string, surface: CleanSlateBrowserSurface = 'agentManager'): Promise<ICleanSlateBrowserState> {
		return this.open(url).then(state => ({ ...state, surface }));
	}

	async revealOpenBrowser(surface: CleanSlateBrowserSurface = 'ide'): Promise<ICleanSlateBrowserState | undefined> {
		return this.activePage ? this.state(surface, this.activePage) : undefined;
	}
	layoutOpenBrowser(_bounds: any, surface: CleanSlateBrowserSurface = 'ide'): Promise<ICleanSlateBrowserState | undefined> {
		return this.revealOpenBrowser(surface);
	}
	setOpenBrowserVisible(_visible: boolean, surface: CleanSlateBrowserSurface = 'ide'): Promise<ICleanSlateBrowserState | undefined> {
		return this.revealOpenBrowser(surface);
	}

	async navigateBack(surface: CleanSlateBrowserSurface): Promise<ICleanSlateBrowserState> {
		const page = await this.page();
		await page.goBack({ waitUntil: 'domcontentloaded' });
		return this.state(surface, page);
	}
	async navigateForward(surface: CleanSlateBrowserSurface): Promise<ICleanSlateBrowserState> {
		const page = await this.page();
		await page.goForward({ waitUntil: 'domcontentloaded' });
		return this.state(surface, page);
	}
	async reload(surface: CleanSlateBrowserSurface): Promise<ICleanSlateBrowserState> {
		const page = await this.page();
		await page.reload({ waitUntil: 'domcontentloaded' });
		return this.state(surface, page);
	}

	async snapshot(surface: CleanSlateBrowserSurface, options: { limit?: number } = {}): Promise<ICleanSlateBrowserSnapshot> {
		const page = await this.page();
		const limit = Math.min(500, Math.max(1, options.limit ?? 150));
		const elements = await page.locator('body *:visible').evaluateAll((nodes, max) =>
			nodes.slice(0, max as number).flatMap((node, index) => {
				const element = node as HTMLElement;
				const rect = element.getBoundingClientRect();
				if (rect.width < 1 || rect.height < 1) {
					return [];
				}
				const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300);
				const role = element.getAttribute('role') || undefined;
				const name = element.getAttribute('aria-label') || element.getAttribute('title') || undefined;
				return [{
					id: `e${index + 1}`,
					tagName: element.tagName.toLowerCase(),
					selector: thisSelector(element),
					testId: element.getAttribute('data-testid') || element.getAttribute('data-test') || element.getAttribute('data-cy') || undefined,
					role,
					name,
					text: text || undefined,
					ariaLabel: element.getAttribute('aria-label') || undefined,
					placeholder: element.getAttribute('placeholder') || undefined,
					href: (element as HTMLAnchorElement).href || undefined,
					type: element.getAttribute('type') || undefined,
					checked: 'checked' in element ? Boolean((element as HTMLInputElement).checked) : undefined,
					disabled: 'disabled' in element ? Boolean((element as HTMLInputElement).disabled) : undefined,
					boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
				}];

				function thisSelector(target: HTMLElement): string {
					if (target.id) {
						return `#${CSS.escape(target.id)}`;
					}
					const testId = target.getAttribute('data-testid') || target.getAttribute('data-test') || target.getAttribute('data-cy');
					if (testId) {
						return `[data-testid="${CSS.escape(testId)}"]`;
					}
					return target.tagName.toLowerCase();
				}
			}), limit);
		const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
		const theme = await page.evaluate(() => ({
			prefersColorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
			colorScheme: getComputedStyle(document.documentElement).colorScheme,
			backgroundColor: getComputedStyle(document.body).backgroundColor,
			foregroundColor: getComputedStyle(document.body).color
		}));
		return {
			...await this.state(surface, page),
			viewport: { ...viewport, devicePixelRatio: await page.evaluate(() => devicePixelRatio) },
			bodyText: (await page.locator('body').innerText()).slice(0, 100_000),
			elements,
			theme
		};
	}

	async click(surface: CleanSlateBrowserSurface, input: ICleanSlateBrowserTarget): Promise<ICleanSlateBrowserActionResult> {
		const page = await this.page();
		if (input.x !== undefined && input.y !== undefined) {
			await page.mouse.click(input.x, input.y, { button: input.button, clickCount: input.clickCount });
		} else {
			await (await this.locator(page, input)).click({ button: input.button, clickCount: input.clickCount });
		}
		return this.action(surface, 'click', input);
	}
	async hover(surface: CleanSlateBrowserSurface, input: ICleanSlateBrowserTarget): Promise<ICleanSlateBrowserActionResult> {
		const page = await this.page();
		if (input.x !== undefined && input.y !== undefined) {
			await page.mouse.move(input.x, input.y);
		} else {
			await (await this.locator(page, input)).hover();
		}
		return this.action(surface, 'hover', input);
	}
	async fill(surface: CleanSlateBrowserSurface, input: ICleanSlateBrowserLocator & { value: string }): Promise<ICleanSlateBrowserActionResult> {
		await (await this.locator(await this.page(), input)).fill(input.value);
		return this.action(surface, 'fill', input);
	}
	async check(surface: CleanSlateBrowserSurface, input: ICleanSlateBrowserLocator & { checked?: boolean }): Promise<ICleanSlateBrowserActionResult> {
		const locator = await this.locator(await this.page(), input);
		input.checked === false ? await locator.uncheck() : await locator.check();
		return this.action(surface, 'check', input);
	}
	async select(surface: CleanSlateBrowserSurface, input: ICleanSlateBrowserLocator & { values: string[] }) {
		const values = await (await this.locator(await this.page(), input)).selectOption(input.values);
		return { ...await this.action(surface, 'select', input), values };
	}
	async uploadFiles(surface: CleanSlateBrowserSurface, input: ICleanSlateBrowserLocator & { files: string[] }) {
		await (await this.locator(await this.page(), input)).setInputFiles(input.files);
		return { ...await this.action(surface, 'upload', input), files: input.files };
	}

	async handleDialog(surface: CleanSlateBrowserSurface, input: { accept: boolean; promptText?: string }): Promise<ICleanSlateBrowserActionResult> {
		if (!this.pendingDialog) {
			throw new Error('There is no pending browser dialog.');
		}
		const dialog = this.pendingDialog;
		this.pendingDialog = undefined;
		input.accept ? await dialog.accept(input.promptText) : await dialog.dismiss();
		return this.action(surface, 'dialog', {});
	}

	async clipboard(surface: CleanSlateBrowserSurface, input: { action: 'read' | 'write'; text?: string }) {
		const page = await this.page();
		if (input.action === 'write') {
			await page.evaluate(text => navigator.clipboard.writeText(text ?? ''), input.text);
			return { ...await this.action(surface, 'clipboard', {}), text: input.text };
		}
		const text = await page.evaluate(() => navigator.clipboard.readText());
		return { ...await this.action(surface, 'clipboard', {}), text };
	}
	async typeText(surface: CleanSlateBrowserSurface, text: string): Promise<ICleanSlateBrowserActionResult> {
		await (await this.page()).keyboard.type(text);
		return this.action(surface, 'type', {});
	}
	async pressKey(surface: CleanSlateBrowserSurface, input: ICleanSlateBrowserLocator & { key: string; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean }): Promise<ICleanSlateBrowserActionResult> {
		const page = await this.page();
		const modifiers = [
			input.ctrlKey ? 'Control' : '',
			input.shiftKey ? 'Shift' : '',
			input.altKey ? 'Alt' : '',
			input.metaKey ? 'Meta' : ''
		].filter(Boolean);
		const key = [...modifiers, input.key].join('+');
		if (this.hasLocator(input)) {
			await (await this.locator(page, input)).press(key);
		} else {
			await page.keyboard.press(key);
		}
		return this.action(surface, 'press', input);
	}
	async scroll(surface: CleanSlateBrowserSurface, input: ICleanSlateBrowserTarget & { deltaX?: number; deltaY?: number }): Promise<ICleanSlateBrowserActionResult> {
		const page = await this.page();
		if (this.hasLocator(input)) {
			await (await this.locator(page, input)).evaluate((element, value) => {
				element.scrollBy((value as any).x, (value as any).y);
			}, { x: input.deltaX ?? 0, y: input.deltaY ?? 600 });
		} else {
			await page.mouse.wheel(input.deltaX ?? 0, input.deltaY ?? 600);
		}
		return this.action(surface, 'scroll', input);
	}

	async wait(surface: CleanSlateBrowserSurface, input: ICleanSlateBrowserWaitOptions = {}): Promise<ICleanSlateBrowserState> {
		const page = await this.page();
		if (input.ms) {
			await page.waitForTimeout(input.ms);
		} else if (input.url) {
			await page.waitForURL(input.url, { timeout: input.timeoutMs });
		} else if (this.hasLocator(input)) {
			await (await this.locator(page, input)).waitFor({
				state: input.hidden ? 'hidden' : 'visible',
				timeout: input.timeoutMs
			});
		} else {
			await page.waitForLoadState('domcontentloaded', { timeout: input.timeoutMs });
		}
		return this.state(surface, page);
	}
	getUrl(surface: CleanSlateBrowserSurface): Promise<ICleanSlateBrowserState> {
		return this.page().then(page => this.state(surface, page));
	}
	async getDiagnostics(surface: CleanSlateBrowserSurface, options: { clear?: boolean } = {}) {
		const result = {
			...await this.state(surface, await this.page()),
			console: [...this.consoleEntries],
			network: [...this.networkEntries],
			downloads: []
		};
		if (options.clear) {
			this.consoleEntries.length = 0;
			this.networkEntries.length = 0;
		}
		return result;
	}

	async listTabs(_surface: CleanSlateBrowserSurface): Promise<{ success: true; tabs: ICleanSlateBrowserTab[] }> {
		await this.ensureContext();
		return { success: true, tabs: await this.tabs() };
	}
	async newTab(surface: CleanSlateBrowserSurface, options: { url?: string; background?: boolean } = {}) {
		const context = await this.ensureContext();
		const page = await context.newPage();
		this.registerPage(page);
		if (options.url) {
			await page.goto(options.url, { waitUntil: 'domcontentloaded' });
		}
		if (!options.background) {
			this.activePage = page;
		}
		return { ...await this.state(surface, page), tabId: this.idFor(page) };
	}
	async selectTab(surface: CleanSlateBrowserSurface, tabId: string) {
		const page = this.pageForId(tabId);
		this.activePage = page;
		await page.bringToFront();
		return { ...await this.state(surface, page), tabId };
	}
	async closeTab(_surface: CleanSlateBrowserSurface, tabId: string) {
		const page = this.pageForId(tabId);
		await page.close();
		this.tabIds.delete(page);
		if (this.activePage === page) {
			this.activePage = this.context?.pages().at(-1);
		}
		return { success: true as const, tabs: await this.tabs() };
	}
	async screenshot(surface: CleanSlateBrowserSurface, options: { quality?: number; fullPage?: boolean } = {}) {
		const page = await this.page();
		const buffer = await page.screenshot({
			type: 'jpeg',
			quality: Math.min(100, Math.max(1, options.quality ?? 80)),
			fullPage: options.fullPage
		});
		return { ...await this.state(surface, page), mimeType: 'image/jpeg' as const, base64: buffer.toString('base64') };
	}

	async startAnnotation(surface: CleanSlateBrowserSurface) {
		this.annotationActive = true;
		return { ...await this.state(surface, await this.page()), annotationMode: 'active' as const };
	}
	async stopAnnotation(surface: CleanSlateBrowserSurface) {
		this.annotationActive = false;
		return { ...await this.state(surface, await this.page()), annotationMode: 'inactive' as const, annotations: [...this.annotations] };
	}
	async listAnnotations(surface: CleanSlateBrowserSurface) {
		return { ...await this.state(surface, await this.page()), annotations: [...this.annotations] };
	}
	listCachedAnnotations(): ICleanSlateBrowserAnnotation[] {
		return [...this.annotations];
	}
	refreshVisibleAnnotations(): Promise<ICleanSlateBrowserAnnotation[]> {
		return Promise.resolve([...this.annotations]);
	}
	async deleteAnnotation(surface: CleanSlateBrowserSurface, annotationId: string) {
		const index = this.annotations.findIndex(annotation => annotation.id === annotationId);
		if (index >= 0) {
			this.annotations.splice(index, 1);
		}
		this.annotationEmitter.fire({ surface, annotations: [...this.annotations] });
		return this.listAnnotations(surface);
	}
	async clearAnnotations(surface: CleanSlateBrowserSurface) {
		this.annotations.length = 0;
		this.annotationEmitter.fire({ surface, annotations: [] });
		return this.listAnnotations(surface);
	}

	async dispose(): Promise<void> {
		await this.browser?.close();
		this.browser = undefined;
		this.context = undefined;
		this.activePage = undefined;
		this.annotationEmitter.dispose();
		this.openEmitter.dispose();
	}

	private async ensureContext(): Promise<BrowserContext> {
		if (!this.context) {
			const headless = resolveNodeBrowserHeadless(this.options.headless ?? true);
			const executablePath = process.env['CLEANSLATE_BROWSER_EXECUTABLE']?.trim();
			try {
				this.browser = await chromium.launch({
					headless,
					...(executablePath
						? { executablePath }
						: { channel: process.env['CLEANSLATE_BROWSER_CHANNEL'] || 'chrome' })
				});
			} catch (channelError) {
				try {
					this.browser = await chromium.launch({ headless });
				} catch {
					throw new Error(
						`CleanSlate could not launch Chrome or bundled Chromium. Install Chrome, run "npx playwright install chromium", or set CLEANSLATE_BROWSER_EXECUTABLE. ${channelError instanceof Error ? channelError.message : String(channelError)}`
					);
				}
			}
			this.context = await this.browser.newContext({
				viewport: { width: 1440, height: 900 },
				acceptDownloads: true
			});
		}
		return this.context;
	}
	private async ensurePage(): Promise<Page> {
		if (this.activePage && !this.activePage.isClosed()) {
			return this.activePage;
		}
		const context = await this.ensureContext();
		const page = context.pages()[0] ?? await context.newPage();
		this.registerPage(page);
		this.activePage = page;
		return page;
	}
	private page(): Promise<Page> {
		return this.ensurePage();
	}
	private registerPage(page: Page): void {
		if (this.tabIds.has(page)) {
			return;
		}
		this.idFor(page);
		page.on('console', message => {
			const location = message.location();
			this.consoleEntries.push({
				level: message.type() === 'warning' ? 'warning' : message.type() === 'error' ? 'error' : message.type() === 'debug' ? 'debug' : 'info',
				message: message.text(),
				sourceId: location.url,
				lineNumber: location.lineNumber ?? 0,
				timestamp: Date.now()
			});
		});
		page.on('request', request => {
			this.networkEntries.push({
				id: this.networkEntries.length + 1,
				url: request.url(),
				method: request.method(),
				resourceType: request.resourceType(),
				startedAt: Date.now()
			});
		});
		page.on('response', response => {
			const entry = [...this.networkEntries].reverse().find(candidate => candidate.url === response.url() && !candidate.completedAt);
			if (entry) {
				entry.completedAt = Date.now();
				entry.durationMs = entry.completedAt - entry.startedAt;
				entry.statusCode = response.status();
				entry.fromCache = response.fromServiceWorker();
			}
		});
		page.on('dialog', dialog => { this.pendingDialog = dialog; });
	}
	private idFor(page: Page): string {
		let id = this.tabIds.get(page);
		if (!id) {
			id = `tab-${this.nextTabId++}`;
			this.tabIds.set(page, id);
		}
		return id;
	}
	private pageForId(id: string): Page {
		for (const [page, pageId] of this.tabIds) {
			if (pageId === id && !page.isClosed()) {
				return page;
			}
		}
		throw new Error(`Browser tab not found: ${id}`);
	}
	private async tabs(): Promise<ICleanSlateBrowserTab[]> {
		return Promise.all((this.context?.pages() ?? []).map(async page => ({
			id: this.idFor(page),
			url: page.url(),
			title: await page.title(),
			active: page === this.activePage
		})));
	}
	private async state(surface: CleanSlateBrowserSurface, page: Page): Promise<ICleanSlateBrowserState> {
		return {
			success: true,
			surface,
			viewId: this.idFor(page),
			url: page.url(),
			title: await page.title(),
			visible: true,
			loading: false,
			canGoBack: true,
			canGoForward: true,
			annotationActive: this.annotationActive
		};
	}
	private async action(surface: CleanSlateBrowserSurface, action: string, target: any): Promise<ICleanSlateBrowserActionResult> {
		return {
			...await this.state(surface, await this.page()),
			action,
			target: target.selector || target.testId || target.role || target.text || target.elementId
		};
	}
	private hasLocator(input: ICleanSlateBrowserLocator): boolean {
		return Boolean(input.elementId || input.selector || input.testId || input.role || input.label || input.placeholder || input.text);
	}
	private async locator(page: Page, input: ICleanSlateBrowserLocator): Promise<Locator> {
		let locator: Locator;
		if (input.elementId?.match(/^e\d+$/)) {
			const index = Number(input.elementId.slice(1)) - 1;
			locator = page.locator('body *:visible').nth(index);
		} else if (input.selector) {
			locator = page.locator(input.selector);
		} else if (input.testId) {
			locator = page.getByTestId(input.testId);
		} else if (input.role) {
			locator = page.getByRole(input.role as any, { name: input.name, exact: input.exact });
		} else if (input.label) {
			locator = page.getByLabel(input.label, { exact: input.exact });
		} else if (input.placeholder) {
			locator = page.getByPlaceholder(input.placeholder, { exact: input.exact });
		} else if (input.text) {
			locator = page.getByText(input.text, { exact: input.exact });
		} else {
			throw new Error('A browser locator or x/y point is required.');
		}
		if (input.nth !== undefined) {
			locator = locator.nth(input.nth);
		}
		return locator;
	}
}
