/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { isMacintosh } from '../../../../../base/common/platform.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { localize } from '../../../../../nls.js';

export interface ICleanSlateBrowserShortcut {
	readonly id?: string;
	readonly url: string;
	readonly title: string;
	readonly favicon?: string;
	readonly kind?: 'bookmark' | 'history';
}

// Keep embedded icons small enough to store with bookmarks, including larger SVGs and ICOs.
export function cleanSlateStoredFavicon(favicon: string | undefined): string | undefined {
	return favicon?.startsWith('data:image/') && favicon.length <= 256_000 ? favicon : undefined;
}

export function renderCleanSlateSiteIcon(element: HTMLElement, site: ICleanSlateBrowserShortcut): void {
	element.classList.remove('empty', 'codicon', 'codicon-globe');
	let host = '';
	const sources: string[] = [];
	const saved = cleanSlateStoredFavicon(site.favicon);
	if (saved) { sources.push(saved); }
	try {
		const url = new URL(site.url);
		host = url.hostname.replace(/^www\./, '');
		// Recover older bookmarks directly from the site, without a third-party icon service.
		if (url.protocol === 'https:' && !url.username && !url.password) { sources.push(new URL('/favicon.ico', url.origin).href); }
	} catch { /* Blank pages have no hostname. */ }
	const fallback = () => {
		element.textContent = host ? host[0].toUpperCase() : '';
		if (!host) { element.classList.add(...ThemeIcon.asClassNameArray(Codicon.globe)); }
	};
	if (sources.length) {
		const image = element.querySelector('img') ?? dom.$('img');
		image.alt = '';
		image.referrerPolicy = 'no-referrer';
		let index = 0;
		image.onerror = () => {
			if (image.parentElement !== element) { return; }
			if (++index < sources.length) { image.src = sources[index]; }
			else { image.onerror = null; fallback(); }
		};
		if (image.parentElement !== element) { dom.clearNode(element); element.appendChild(image); }
		if (image.getAttribute('src') !== sources[0]) { image.src = sources[0]; }
	} else {
		fallback();
	}
	element.setAttribute('aria-hidden', 'true');
}

export class CleanSlateBrowserStartView {
	readonly element: HTMLElement;
	readonly input: HTMLInputElement;
	private readonly results: HTMLElement;
	private readonly submit: HTMLButtonElement;
	private sites: () => Iterable<ICleanSlateBrowserShortcut> = () => [];
	private matches: readonly ICleanSlateBrowserShortcut[] = [];
	private selected = -1;
	private dismissed = false;

	constructor(parent: HTMLElement, private readonly actions: {
		readonly navigate: (value: string) => void;
		readonly selectTab: (id: string) => void;
	}) {
		const root = this.element = dom.append(parent, dom.$('.cleanSlate-browser-start'));
		root.setAttribute('role', 'region');
		root.setAttribute('aria-label', localize('cleanSlate.browser.newTabPage', 'New tab'));
		const form = dom.append(root, dom.$('form.cleanSlate-browser-start-search')) as HTMLFormElement;
		const row = dom.append(form, dom.$('.cleanSlate-browser-start-search-row'));
		dom.append(row, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.search)}`));
		this.input = dom.append(row, dom.$('input')) as HTMLInputElement;
		this.input.spellcheck = false;
		this.input.autocomplete = 'off';
		this.input.placeholder = localize('cleanSlate.browser.startPlaceholder', 'Search the web or enter a URL');
		this.input.setAttribute('aria-label', this.input.placeholder);
		this.input.title = localize('cleanSlate.browser.focusSearchTitle', 'Focus search ({0})', isMacintosh ? '⌘L' : 'Ctrl+L');
		this.input.setAttribute('role', 'combobox');
		this.input.setAttribute('aria-autocomplete', 'list');
		this.input.setAttribute('aria-expanded', 'false');
		this.results = dom.append(form, dom.$('.cleanSlate-browser-start-results'));
		this.results.id = `cleanSlate-browser-suggestions-${generateUuid()}`;
		this.results.setAttribute('role', 'listbox');
		this.results.setAttribute('aria-label', localize('cleanSlate.browser.suggestions', 'Open tabs and pinned pages'));
		this.input.setAttribute('aria-controls', this.results.id);
		const submit = this.submit = dom.append(row, dom.$('button.cleanSlate-browser-start-submit')) as HTMLButtonElement;
		submit.type = 'submit';
		submit.setAttribute('aria-label', localize('cleanSlate.browser.searchGo', 'Search or go'));
		dom.append(submit, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.arrowUp)}`));
		form.onsubmit = event => {
			event.preventDefault();
			const value = this.input.value.trim();
			if (!value && this.selected < 0) { this.input.focus(); return; }
			if (this.selected >= 0 && this.matches[this.selected]) { this.choose(this.matches[this.selected]); }
			else { this.actions.navigate(value); }
		};
		this.input.oninput = () => { this.selected = -1; this.dismissed = false; this.renderSuggestions(); };
		this.input.onkeydown = event => {
			if (event.key === 'Escape') { this.dismissed = true; this.selected = -1; this.renderSuggestions(); }
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				if (!this.matches.length) { return; }
				event.preventDefault();
				this.selected = this.selected < 0 ? event.key === 'ArrowDown' ? 0 : this.matches.length - 1
					: (this.selected + (event.key === 'ArrowDown' ? 1 : this.matches.length - 1)) % this.matches.length;
				this.renderSelection();
			}
		};
		this.renderSuggestions();
	}

	focus(): void { this.input.focus(); this.input.select(); }
	reset(): void { this.input.value = ''; this.selected = -1; this.dismissed = false; this.renderSuggestions(); }

	setSites(sites: () => Iterable<ICleanSlateBrowserShortcut>): void {
		this.sites = sites;
		if (!this.element.hidden) { this.renderSuggestions(); }
	}

	refresh(): void { this.renderSuggestions(); }

	private renderSuggestions(): void {
		const query = this.input.value.trim().toLowerCase();
		const matches: ICleanSlateBrowserShortcut[] = [];
		const urls = new Set<string>();
		if (!this.dismissed) {
			for (const site of this.sites()) {
				if (urls.has(site.url)) { continue; }
				urls.add(site.url);
				if (query && !`${site.title} ${site.url}`.toLowerCase().includes(query)) { continue; }
				matches.push(site);
				if (matches.length === (query ? 4 : 3)) { break; }
			}
		}
		this.matches = matches;
		if (this.selected >= this.matches.length) { this.selected = -1; }
		this.results.hidden = !this.matches.length;
		this.input.setAttribute('aria-expanded', String(!!this.matches.length));
		const oldButtons = new Map(Array.from(this.results.querySelectorAll<HTMLButtonElement>('button')).map(button => [button.dataset.site, button]));
		let next = this.results.firstElementChild;
		this.matches.forEach((site, index) => {
			const key = site.id ?? site.url;
			const button = oldButtons.get(key) ?? dom.$('button.cleanSlate-browser-suggestion') as HTMLButtonElement;
			oldButtons.delete(key);
			button.dataset.site = key;
			if (button !== next) { this.results.insertBefore(button, next); }
			next = button.nextElementSibling;
			button.type = 'button';
			button.tabIndex = -1;
			button.id = `${this.results.id}-${index}`;
			button.setAttribute('role', 'option');
			const icon = button.querySelector<HTMLElement>('.cleanSlate-browser-site-icon') ?? dom.append(button, dom.$('.cleanSlate-browser-site-icon'));
			renderCleanSlateSiteIcon(icon, site);
			const copy = button.querySelector<HTMLElement>('.cleanSlate-browser-suggestion-copy') ?? dom.append(button, dom.$('.cleanSlate-browser-suggestion-copy'));
			const title = copy.querySelector('span') ?? dom.append(copy, dom.$('span'));
			if (title.textContent !== site.title) { title.textContent = site.title; }
			let host = site.url;
			try { host = new URL(site.url).hostname; } catch { /* Keep the original address. */ }
			const detail = copy.querySelector('small') ?? dom.append(copy, dom.$('small'));
			if (detail.textContent !== host) { detail.textContent = host; }
			const action = button.querySelector<HTMLElement>('.cleanSlate-browser-suggestion-action') ?? dom.append(button, dom.$('.cleanSlate-browser-suggestion-action'));
			action.textContent = site.id
				? localize('cleanSlate.browser.switchTab', 'Switch to tab') : site.kind === 'bookmark'
					? localize('cleanSlate.browser.bookmark', 'Bookmark') : site.kind === 'history' ? localize('cleanSlate.browser.history', 'History') : localize('cleanSlate.browser.pinnedPage', 'Pinned page');
			button.onmousedown = event => event.preventDefault();
			button.onclick = () => this.choose(site);
		});
		for (const button of oldButtons.values()) { button.remove(); }
		this.renderSelection();
	}

	private renderSelection(): void {
		this.submit.disabled = !this.input.value.trim() && this.selected < 0;
		Array.from(this.results.children).forEach((child, index) => child.setAttribute('aria-selected', String(index === this.selected)));
		if (this.selected >= 0) { this.input.setAttribute('aria-activedescendant', `${this.results.id}-${this.selected}`); }
		else { this.input.removeAttribute('aria-activedescendant'); }
	}

	private choose(site: ICleanSlateBrowserShortcut): void {
		if (site.id) { this.actions.selectTab(site.id); }
		else { this.actions.navigate(site.url); }
	}
}
