/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as path from 'path';
import { chromium, type Browser, type Frame, type Locator, type Page } from 'playwright-core';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { ICleanSlatePlaywrightBrowserRequest } from '../../common/core/cleanSlateAI.js';

interface ILocatorInput {
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
	x?: number;
	y?: number;
}

/**
 * Playwright transport for CleanSlate's integrated BrowserViews.
 *
 * Chromium owns the visible WebContentsView. Playwright connects to that same
 * Chromium instance over its loopback CDP endpoint and selects the page stamped
 * with the requested BrowserView id. It never launches another browser.
 */
export class CleanSlatePlaywrightBrowserService extends Disposable {
	private browser: Browser | undefined;
	private connectPromise: Promise<Browser> | undefined;
	private readonly selectors = new Map<string, Map<string, string>>();

	constructor(
		private readonly userDataPath: string,
		private readonly logService: ILogService
	) {
		super();
	}

	async run(request: ICleanSlatePlaywrightBrowserRequest): Promise<unknown> {
		const page = await this.pageForView(request.viewId);
		const input = (request.input ?? {}) as ILocatorInput & Record<string, unknown>;

		switch (request.action) {
			case 'evaluate':
				return this.evaluate(request.viewId, page, input);
			case 'resolvePoint':
				return this.resolvePoint(request.viewId, page, input);
			case 'click':
				return this.click(request.viewId, page, input);
			case 'hover':
				return this.hover(request.viewId, page, input);
			case 'fill':
				return this.fill(request.viewId, page, input);
			case 'check':
				return this.check(request.viewId, page, input);
			case 'select':
				return this.select(request.viewId, page, input);
			case 'upload':
				return this.upload(request.viewId, page, input);
			case 'type':
				await page.keyboard.insertText(this.string(input.text));
				return { action: 'type_text' };
			case 'press':
				return this.press(request.viewId, page, input);
			case 'scroll':
				return this.scroll(request.viewId, page, input);
			case 'wait':
				return this.wait(request.viewId, page, input);
			case 'screenshot':
				return this.screenshot(page, input);
			default:
				throw new Error(`Unsupported CleanSlate Playwright action: ${String(request.action)}`);
		}
	}

	private async evaluate(viewId: string, page: Page, input: Record<string, unknown>): Promise<unknown> {
		const expression = this.string(input.expression);
		if (!expression) {
			throw new Error('Playwright evaluate requires an expression.');
		}
		const result = await page.evaluate(expression);
		this.rememberSnapshotSelectors(viewId, result);
		return result;
	}

	private async resolvePoint(viewId: string, page: Page, input: ILocatorInput): Promise<{ point: { x: number; y: number } }> {
		if (typeof input.x === 'number' && typeof input.y === 'number' && !this.hasLocator(input)) {
			return { point: { x: input.x, y: input.y } };
		}
		if (!this.hasLocator(input)) {
			const viewport = await page.evaluate('({ width: window.innerWidth, height: window.innerHeight })') as { width: number; height: number };
			return { point: { x: viewport.width / 2, y: viewport.height / 2 } };
		}
		const locator = await this.locator(viewId, page, input);
		await locator.scrollIntoViewIfNeeded();
		return { point: await this.center(locator) };
	}

	private async click(viewId: string, page: Page, input: ILocatorInput & Record<string, unknown>): Promise<unknown> {
		const button = input.button === 'middle' || input.button === 'right' ? input.button : 'left';
		const clickCount = Math.max(1, Math.min(Math.round(this.number(input.clickCount, 1)), 3));
		if (typeof input.x === 'number' && typeof input.y === 'number' && !this.hasLocator(input)) {
			await page.mouse.click(input.x, input.y, { button, clickCount });
			await this.settle(page);
			return { action: 'click', point: { x: input.x, y: input.y } };
		}
		const locator = await this.locator(viewId, page, input);
		const point = await this.center(locator);
		await locator.click({ button, clickCount });
		await this.settle(page);
		return { action: 'click', point };
	}

	private async hover(viewId: string, page: Page, input: ILocatorInput): Promise<unknown> {
		const locator = await this.locator(viewId, page, input);
		const point = await this.center(locator);
		await locator.hover();
		return { action: 'hover', point };
	}

	private async fill(viewId: string, page: Page, input: ILocatorInput & Record<string, unknown>): Promise<unknown> {
		const locator = await this.locator(viewId, page, input);
		await locator.fill(this.string(input.value));
		await this.settle(page, 500);
		return { action: 'fill' };
	}

	private async check(viewId: string, page: Page, input: ILocatorInput & Record<string, unknown>): Promise<unknown> {
		const checked = input.checked !== false;
		const locator = await this.locator(viewId, page, input);
		await locator.setChecked(checked);
		await this.settle(page, 500);
		return { action: checked ? 'check' : 'uncheck' };
	}

	private async select(viewId: string, page: Page, input: ILocatorInput & Record<string, unknown>): Promise<unknown> {
		const requested = Array.isArray(input.values) ? input.values.map(value => String(value)) : [];
		const locator = await this.locator(viewId, page, input);
		const values = await locator.selectOption(requested);
		await this.settle(page, 500);
		return { action: 'select', values };
	}

	private async upload(viewId: string, page: Page, input: ILocatorInput & Record<string, unknown>): Promise<unknown> {
		const files = Array.isArray(input.files) ? input.files.map(value => String(value)) : [];
		if (!files.length) {
			throw new Error('browser_upload requires at least one file path.');
		}
		await (await this.locator(viewId, page, input)).setInputFiles(files);
		await this.settle(page, 1000);
		return { action: 'upload', files };
	}

	private async press(viewId: string, page: Page, input: ILocatorInput & Record<string, unknown>): Promise<unknown> {
		const key = this.string(input.key).trim();
		if (!key) {
			throw new Error('browser_key requires a non-empty key.');
		}
		if (this.hasLocator(input)) {
			await (await this.locator(viewId, page, input)).focus();
		}
		const chord = [
			input.ctrlKey ? 'Control' : '',
			input.shiftKey ? 'Shift' : '',
			input.altKey ? 'Alt' : '',
			input.metaKey ? 'Meta' : '',
			key
		].filter(Boolean).join('+');
		await page.keyboard.press(chord);
		await this.settle(page, 800);
		return { action: 'key' };
	}

	private async scroll(viewId: string, page: Page, input: ILocatorInput & Record<string, unknown>): Promise<unknown> {
		let point: { x: number; y: number };
		if (this.hasLocator(input)) {
			const locator = await this.locator(viewId, page, input);
			point = await this.center(locator);
		} else if (typeof input.x === 'number' && typeof input.y === 'number') {
			point = { x: input.x, y: input.y };
		} else {
			const viewport = await page.evaluate('({ width: window.innerWidth, height: window.innerHeight })') as { width: number; height: number };
			point = { x: viewport.width / 2, y: viewport.height / 2 };
		}
		await page.mouse.move(point.x, point.y);
		await page.mouse.wheel(this.number(input.deltaX, 0), this.number(input.deltaY, 520));
		await this.settle(page, 500);
		return { action: 'scroll', point };
	}

	private async wait(viewId: string, page: Page, input: ILocatorInput & Record<string, unknown>): Promise<unknown> {
		const delay = Math.max(0, Math.min(this.number(input.ms, 0), 30_000));
		const timeout = Math.max(100, Math.min(this.number(input.timeoutMs, 5_000), 30_000));
		if (delay) {
			await page.waitForTimeout(delay);
		}
		if (typeof input.url === 'string' && input.url) {
			const expected = input.url;
			const exact = input.exact === true;
			await page.waitForURL(url => exact ? url.href === expected : url.href.includes(expected), { timeout });
		}
		if (this.hasLocator(input)) {
			await (await this.locator(viewId, page, input, false)).waitFor({
				state: input.hidden ? 'hidden' : 'visible',
				timeout
			});
		}
		await this.settle(page);
		return { action: 'wait' };
	}

	private async screenshot(page: Page, input: Record<string, unknown>): Promise<unknown> {
		const quality = Math.max(1, Math.min(this.number(input.quality, 85), 100));
		await page.evaluate('document.getElementById("__cleanslate_browser_mouse")?.remove()').catch(() => undefined);
		const buffer = await page.screenshot({
			type: 'jpeg',
			quality,
			fullPage: input.fullPage === true
		});
		return { mimeType: 'image/jpeg', base64: buffer.toString('base64') };
	}

	private async locator(viewId: string, page: Page, raw: ILocatorInput, strict = true): Promise<Locator> {
		const input = this.normalizeLocator(viewId, raw);
		const matches: Array<{ locator: Locator; count: number }> = [];
		for (const frame of page.frames()) {
			const candidate = this.locatorInFrame(frame, input);
			if (!candidate) {
				continue;
			}
			const count = await candidate.count().catch(() => 0);
			if (count) {
				matches.push({ locator: candidate, count });
			}
		}
		const total = matches.reduce((sum, match) => sum + match.count, 0);
		if (!total) {
			if (!strict) {
				return this.locatorInFrame(page.mainFrame(), input) ?? page.locator(':not(*)');
			}
			throw new Error(`No browser element matched ${this.describeLocator(input)}.`);
		}
		const requestedIndex = Number.isInteger(input.nth) ? input.nth! : undefined;
		if (requestedIndex === undefined && total !== 1 && strict) {
			throw new Error(`Browser locator matched ${total} elements. Add a more specific locator or nth.`);
		}
		let remaining = requestedIndex ?? 0;
		if (remaining < 0 || remaining >= total) {
			throw new Error(`Browser locator nth=${remaining} is outside ${total} matches.`);
		}
		for (const match of matches) {
			if (remaining < match.count) {
				return match.locator.nth(remaining);
			}
			remaining -= match.count;
		}
		throw new Error('Unable to resolve browser locator.');
	}

	private locatorInFrame(frame: Frame, input: ILocatorInput): Locator | undefined {
		const exact = input.exact === true;
		if (input.selector) {
			return frame.locator(input.selector);
		}
		if (input.testId) {
			return frame.getByTestId(input.testId);
		}
		if (input.role) {
			return frame.getByRole(input.role as Parameters<Frame['getByRole']>[0], {
				...(input.name ? { name: input.name } : {}),
				exact
			});
		}
		if (input.label) {
			return frame.getByLabel(input.label, { exact });
		}
		if (input.placeholder) {
			return frame.getByPlaceholder(input.placeholder, { exact });
		}
		if (input.text) {
			return frame.getByText(input.text, { exact });
		}
		if (input.name) {
			return frame.getByText(input.name, { exact });
		}
		return undefined;
	}

	private normalizeLocator(viewId: string, input: ILocatorInput): ILocatorInput {
		if (!input.elementId || input.selector) {
			return input;
		}
		const selector = this.selectors.get(viewId)?.get(input.elementId);
		if (!selector) {
			throw new Error(`Browser element "${input.elementId}" is stale or unknown. Take a new browser_snapshot and retry.`);
		}
		return { ...input, selector };
	}

	private rememberSnapshotSelectors(viewId: string, result: unknown): void {
		if (!result || typeof result !== 'object' || !Array.isArray((result as { elements?: unknown }).elements)) {
			return;
		}
		const selectors = new Map<string, string>();
		for (const element of (result as { elements: Array<Record<string, unknown>> }).elements) {
			if (typeof element.id === 'string' && typeof element.selector === 'string') {
				selectors.set(element.id, element.selector);
			}
		}
		this.selectors.set(viewId, selectors);
	}

	private async center(locator: Locator): Promise<{ x: number; y: number }> {
		const box = await locator.boundingBox();
		if (!box) {
			throw new Error('Matched browser element is not visible.');
		}
		return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	}

	private async pageForView(viewId: string): Promise<Page> {
		const deadline = Date.now() + 8_000;
		let lastPageUrls: string[] = [];
		while (Date.now() < deadline) {
			const browser = await this.connectedBrowser();
			const pages = browser.contexts().flatMap(context => context.pages()).filter(page => !page.isClosed());
			lastPageUrls = pages.map(page => page.url());
			for (const page of pages) {
				const marker = await page.evaluate('globalThis.__cleanSlateBrowserViewId').catch(() => undefined);
				if (marker === viewId) {
					page.setDefaultTimeout(10_000);
					page.setDefaultNavigationTimeout(30_000);
					return page;
				}
			}
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		throw new Error(`Playwright could not find the live CleanSlate BrowserView "${viewId}". Open the browser surface and retry. Visible CDP pages: ${lastPageUrls.join(', ') || 'none'}`);
	}

	private async connectedBrowser(): Promise<Browser> {
		if (this.browser?.isConnected()) {
			return this.browser;
		}
		if (!this.connectPromise) {
			this.connectPromise = this.connect().finally(() => {
				this.connectPromise = undefined;
			});
		}
		return this.connectPromise;
	}

	private async connect(): Promise<Browser> {
		const endpoint = await this.resolveCdpEndpoint();
		await this.closeBlockingDevToolsTargets(endpoint);
		this.logService.info(`[CleanSlate Playwright] Attaching to integrated Chromium at ${endpoint}`);
		const browser = await chromium.connectOverCDP(endpoint, { timeout: 10_000 });
		browser.on('disconnected', () => {
			if (this.browser === browser) {
				this.browser = undefined;
			}
		});
		this.browser = browser;
		return browser;
	}

	private async closeBlockingDevToolsTargets(endpoint: string): Promise<void> {
		try {
			const response = await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(2_000) });
			if (!response.ok) {
				return;
			}
			const targets = await response.json() as Array<{ id?: unknown; type?: unknown; title?: unknown; url?: unknown }>;
			for (const target of targets) {
				if (target.type !== 'page' || target.url !== '' || target.title !== '' || typeof target.id !== 'string') {
					continue;
				}
				this.logService.info(`[CleanSlate Playwright] Closing uninitializable empty DevTools target ${target.id}`);
				await fetch(`${endpoint}/json/close/${encodeURIComponent(target.id)}`, { signal: AbortSignal.timeout(2_000) }).catch(() => undefined);
			}
		} catch (error) {
			this.logService.warn(`[CleanSlate Playwright] Could not inspect CDP targets before attach: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async resolveCdpEndpoint(): Promise<string> {
		const activePortPath = path.join(this.userDataPath, 'DevToolsActivePort');
		const deadline = Date.now() + 8_000;
		while (Date.now() < deadline) {
			try {
				const [port] = (await fs.readFile(activePortPath, 'utf8')).trim().split(/\r?\n/);
				if (/^\d+$/.test(port)) {
					return `http://127.0.0.1:${port}`;
				}
			} catch {
				// Chromium writes this file shortly after startup.
			}
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		throw new Error('CleanSlate Chromium automation endpoint is unavailable. Restart CleanSlate once so Playwright can attach to the integrated browser.');
	}

	private async settle(page: Page, timeout = 1_500): Promise<void> {
		await page.waitForLoadState('domcontentloaded', { timeout }).catch(() => undefined);
		await page.waitForLoadState('networkidle', { timeout: Math.min(timeout, 1_500) }).catch(() => undefined);
	}

	private hasLocator(input: ILocatorInput): boolean {
		return !!(input.elementId || input.selector || input.testId || input.role || input.name || input.label || input.placeholder || input.text);
	}

	private describeLocator(input: ILocatorInput): string {
		return JSON.stringify(input.elementId ?? input.selector ?? input.testId ?? input.name ?? input.label ?? input.placeholder ?? input.text ?? input.role ?? 'the locator');
	}

	private string(value: unknown): string {
		return typeof value === 'string' ? value : value == null ? '' : String(value);
	}

	private number(value: unknown, fallback: number): number {
		return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
	}

	override dispose(): void {
		void this.browser?.close().catch(() => undefined);
		this.browser = undefined;
		super.dispose();
	}
}
