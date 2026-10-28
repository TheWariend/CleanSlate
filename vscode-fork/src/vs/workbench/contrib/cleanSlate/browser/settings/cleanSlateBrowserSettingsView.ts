/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Disposable, MutableDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { IBrowserImportSource, IDefaultBrowserState, IBrowserIntegrationHost } from '../../../../../platform/native/common/browserIntegration.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { localize } from '../../../../../nls.js';
import { CLEANSLATE_ACTION_BUTTON_STYLES, createCleanSlateActionButton } from '../cleanSlateActionButton.js';
import { CleanSlateBrowserImportDialog } from './cleanSlateBrowserImportDialog.js';

export interface ICleanSlateBrowserSettingsServices {
	readonly nativeHost: IBrowserIntegrationHost;
	readonly storage: IStorageService;
	readonly startBrowsing?: () => void;
}

export class CleanSlateBrowserSettingsView extends Disposable {
	private readonly importer = this._register(new MutableDisposable<CleanSlateBrowserImportDialog>());

	constructor(parent: HTMLElement, private readonly services: ICleanSlateBrowserSettingsServices, openImport = false) {
		super();
		let disposed = false;
		this._register(toDisposable(() => { disposed = true; }));
		const root = dom.append(parent, dom.$('.cleanSlate-browser-settings'));
		const style = dom.append(root, dom.$('style'));
		style.textContent = `
			${CLEANSLATE_ACTION_BUTTON_STYLES}
			.cleanSlate-browser-settings { width:100%; max-width:720px; box-sizing:border-box; color:var(--vscode-foreground); }
			.cleanSlate-browser-settings h3 { margin:0 0 8px; font-weight:600; font-size:20px; letter-spacing:-.3px; }
			.cleanSlate-browser-settings p { margin:0; color:var(--vscode-descriptionForeground); font-size:13px; line-height:1.6; }
			.cleanSlate-browser-settings button:not(.cleanSlate-action-button) { font:inherit; cursor:pointer; color:inherit; border:1px solid color-mix(in srgb,var(--vscode-foreground) 12%,transparent); border-radius:4px; padding:6px 12px; background:transparent; }
			.cleanSlate-browser-settings button:not(.cleanSlate-action-button):hover:enabled { background:color-mix(in srgb,var(--vscode-foreground) 6%,transparent); }
			.cleanSlate-browser-settings button:focus-visible { outline:2px solid var(--vscode-focusBorder); outline-offset:2px; }
			.cleanSlate-browser-settings button[hidden] { display:none; }
			.cleanSlate-browser-settings button:disabled { opacity:.5; cursor:default; }
			.cleanSlate-browser-settings .cs-browser-import-head { display:flex; align-items:flex-start; gap:20px; justify-content:space-between; }
			.cleanSlate-browser-settings .cs-browser-refresh { border:0; color:var(--vscode-descriptionForeground); font-size:12px; flex:0 0 auto; }
			.cleanSlate-browser-settings .cs-browser-source-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,270px),1fr)); gap:16px; margin:12px 0 24px; min-height:200px; align-content:start; }
			.cleanSlate-browser-settings .cs-browser-source { display:flex; align-items:center; text-align:left; gap:16px; padding:18px; min-height:94px; border-radius:6px; background:color-mix(in srgb,var(--vscode-foreground) 3%,transparent); }
			.cleanSlate-browser-settings .cs-browser-source img { width:56px; height:56px; object-fit:contain; }
			.cleanSlate-browser-settings .cs-browser-source > .codicon { width:56px; font-size:42px; color:var(--vscode-descriptionForeground); }
			.cleanSlate-browser-settings .cs-browser-source-copy { display:grid; gap:8px; flex:1; min-width:0; }
			.cleanSlate-browser-settings .cs-browser-source-copy strong { font-size:14px; font-weight:500; overflow-wrap:anywhere; }
			.cleanSlate-browser-settings small { color:var(--vscode-descriptionForeground); font-size:12px; }
			.cleanSlate-browser-settings .cs-browser-source > .cs-browser-source-chevron { width:auto; font-size:16px; }
			.cleanSlate-browser-settings .cs-browser-alternatives { display:flex; align-items:center; flex-wrap:wrap; gap:12px; padding:4px 0 22px; }
			.cleanSlate-browser-settings .cs-browser-alternatives button:not(.cleanSlate-action-button) { padding:6px 10px; min-height:32px; font-size:12px; color:var(--vscode-descriptionForeground); }
			.cleanSlate-browser-settings .cs-browser-alternatives button:not(.cleanSlate-action-button):hover { background:color-mix(in srgb,var(--vscode-foreground) 6%,transparent); color:var(--vscode-foreground); }
			.cleanSlate-browser-settings .cs-browser-default { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; padding:16px; margin:0 0 32px; border-radius:12px; background:color-mix(in srgb,var(--vscode-foreground) 5%,transparent); }
			.cleanSlate-browser-settings .cs-browser-default-copy { min-width:0; display:grid; gap:5px; }
			.cleanSlate-browser-settings .cs-browser-default-copy h3 { font-size:14px; letter-spacing:0; margin:0; font-weight:500; }
			.cleanSlate-browser-settings .cs-browser-default-copy p { font-size:12px; }
			.cleanSlate-browser-settings .cs-browser-default-actions { display:flex; flex-wrap:wrap; gap:8px; align-items:center; font-size:12px; }
			.cleanSlate-browser-settings .cs-browser-default-actions button:not(.cleanSlate-action-button) { display:inline-flex; align-items:center; justify-content:center; gap:6px; box-sizing:border-box; min-height:32px; padding:6px 12px; font-size:12px; line-height:18px; }
			.cleanSlate-browser-settings .cs-browser-default-actions button:not(.cleanSlate-action-button):first-child { background:color-mix(in srgb,var(--vscode-foreground) 8%,transparent); font-weight:500; }
			.cleanSlate-browser-settings .cs-browser-default-actions button:not(.cleanSlate-action-button):first-child:hover:enabled { background:color-mix(in srgb,var(--vscode-foreground) 13%,transparent); }
			.cleanSlate-browser-settings .cs-browser-default-actions .cs-browser-refresh { font-size:12px; padding:6px 10px; }
			.cleanSlate-browser-settings .cs-browser-local-note { font-size:11px; }
			.cleanSlate-browser-settings .cs-browser-scan-status { display:flex; align-items:center; gap:8px; min-height:18px; margin-top:16px; font-size:12px; color:var(--vscode-descriptionForeground); }
			.cleanSlate-browser-settings .cs-browser-source-skeleton { min-height:94px; display:flex; align-items:center; gap:16px; padding:18px; border:1px solid color-mix(in srgb,var(--vscode-foreground) 9%,transparent); border-radius:6px; }
			.cleanSlate-browser-settings .cs-browser-skeleton-icon { width:56px; height:56px; flex:0 0 auto; border-radius:6px; background:color-mix(in srgb,var(--vscode-foreground) 7%,transparent); }
			.cleanSlate-browser-settings .cs-browser-skeleton-copy { display:grid; gap:10px; flex:1; }
			.cleanSlate-browser-settings .cs-browser-skeleton-copy span { height:10px; width:65%; border-radius:3px; background:color-mix(in srgb,var(--vscode-foreground) 7%,transparent); }
			.cleanSlate-browser-settings .cs-browser-skeleton-copy span + span { width:40%; }
			@media (prefers-reduced-motion:reduce) { .cleanSlate-browser-settings .cs-browser-scan-status .codicon { animation:none!important; } }
		`;
		const button = (parent: HTMLElement, title: string, action: () => void | Promise<void>, className = '') => {
			if (className !== 'cs-browser-source') {
				const element = createCleanSlateActionButton(parent, { label: title, action, variant: parent.classList.contains('cs-browser-default-actions') ? 'primary' : 'secondary' });
				if (className) { element.classList.add(className); }
				return element;
			}
			const element = dom.append(parent, dom.$(`button${className ? '.' + className : ''}`)) as HTMLButtonElement;
			element.type = 'button'; element.textContent = title; element.onclick = action; return element;
		};
		const head = dom.append(root, dom.$('.cs-browser-import-head'));
		const intro = dom.append(head, dom.$('div'));
		dom.append(intro, dom.$('h3')).textContent = localize('browser.importPageTitle', 'Import from another browser');
		dom.append(intro, dom.$('p')).textContent = localize('browser.importPageDetail', 'Bring the tabs and pages you already use into CleanSlate.');
		const refresh = button(head, localize('browser.retryScan', 'Retry'), () => scan(), 'cs-browser-refresh');
		refresh.hidden = true;
		const scanStatus = dom.append(root, dom.$('.cs-browser-scan-status'));
		scanStatus.setAttribute('role', 'status');
		const grid = dom.append(root, dom.$('.cs-browser-source-grid'));
		let sources: readonly IBrowserImportSource[] = [];
		let scanning = false;
		const scan = async () => {
			if (scanning || disposed) { return; }
			scanning = true;
			refresh.hidden = true; refresh.disabled = true; grid.setAttribute('aria-busy', 'true');
			scanStatus.style.visibility = 'visible';
			dom.clearNode(scanStatus);
			dom.append(scanStatus, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.loading)}.codicon-modifier-spin`)).setAttribute('aria-hidden', 'true');
			dom.append(scanStatus, dom.$('span')).textContent = localize('browser.scanning', 'Looking for browser profiles…');
			if (!grid.childElementCount) {
				for (let index = 0; index < 4; index++) {
					const card = dom.append(grid, dom.$('.cs-browser-source-skeleton'));
					card.setAttribute('aria-hidden', 'true');
					dom.append(card, dom.$('.cs-browser-skeleton-icon'));
					const copy = dom.append(card, dom.$('.cs-browser-skeleton-copy'));
					dom.append(copy, dom.$('span')); dom.append(copy, dom.$('span'));
				}
			}
			try {
				sources = await services.nativeHost.getBrowserImportSources();
				if (disposed) { return; }
				dom.clearNode(grid);
				const groups = new Map<string, IBrowserImportSource[]>();
				for (const source of sources) { const group = groups.get(source.browserId) ?? []; group.push(source); groups.set(source.browserId, group); }
				for (const [browserId, profiles] of groups) {
					const row = button(grid, '', () => this.openImport(root, { sources, browserId }), 'cs-browser-source');
					if (profiles[0].icon?.startsWith('data:image/')) { const image = dom.append(row, dom.$('img')) as HTMLImageElement; image.src = profiles[0].icon; image.alt = ''; }
					else { dom.append(row, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.globe)}`)); }
					const copy = dom.append(row, dom.$('.cs-browser-source-copy')); dom.append(copy, dom.$('strong')).textContent = profiles[0].browser;
					dom.append(copy, dom.$('small')).textContent = profiles.length === 1 ? profiles[0].profile : localize('browser.profileCount', '{0} profiles', profiles.length);
					dom.append(row, dom.$(`span.cs-browser-source-chevron${ThemeIcon.asCSSSelector(Codicon.chevronRight)}`));
				}
				if (!groups.size) { dom.append(grid, dom.$('p')).textContent = localize('browser.noProfiles', 'No supported profiles found in the usual locations. Choose a profile folder to look elsewhere.'); }
				scanStatus.textContent = ''; scanStatus.style.visibility = 'hidden';
			} catch { if (!disposed) { grid.querySelectorAll('.cs-browser-source-skeleton').forEach(card => card.remove()); dom.clearNode(scanStatus); scanStatus.textContent = localize('browser.discoveryFailed', 'Couldn’t find your browsers. Try again or choose an import option below.'); refresh.hidden = false; } }
			finally { scanning = false; refresh.disabled = false; grid.removeAttribute('aria-busy'); }
		};
		const alternatives = dom.append(root, dom.$('.cs-browser-alternatives'));
		button(alternatives, localize('browser.chooseFolder', 'Choose a profile folder…'), () => this.openImport(root, { action: 'folder' }));
		button(alternatives, localize('browser.fromHTML', 'From a bookmarks HTML file…'), () => this.openImport(root, { action: 'file' }));
		dom.append(root, dom.$('p.cs-browser-local-note')).textContent = localize('browser.localImport', 'Imported data stays on this computer. Your source browser is unchanged.');
		const defaults = dom.append(root, dom.$('section.cs-browser-default'));
		const copy = dom.append(defaults, dom.$('.cs-browser-default-copy'));

		const status = dom.append(copy, dom.$('p')); status.setAttribute('role', 'status');
		status.textContent = localize('browser.checkingDefault', 'Checking default browser…');
		const actions = dom.append(defaults, dom.$('.cs-browser-default-actions'));
		let busy = false;
		const display = (state: IDefaultBrowserState) => {
			status.textContent = state.isDefault ? localize('browser.isDefault', 'CleanSlate is your default browser.') : !state.canSetDefault && state.message ? state.message : localize('browser.notDefault', 'CleanSlate works best as your default browser.');
			makeDefault.hidden = state.isDefault || !state.canSetDefault;
			makeDefault.disabled = false;
		};
		const updateDefault = async (change = false) => {
			if (busy || disposed) { return; }
			busy = true; makeDefault.disabled = true;
			defaults.setAttribute('aria-busy', 'true');
			try { const state = await (change ? services.nativeHost.setAsDefaultBrowser() : services.nativeHost.getDefaultBrowserState()); if (!disposed) { display(state); } }
			catch { if (!disposed) { status.textContent = localize('browser.defaultFailed', 'Could not check your default browser. Try again.'); makeDefault.disabled = false; } }
			finally { busy = false; defaults.removeAttribute('aria-busy'); }
		};
		const makeDefault = button(actions, localize('browser.makeDefault', 'Set as Default'), () => updateDefault(true));
		makeDefault.disabled = true;
		root.insertBefore(defaults, head);
		this._register(dom.addDisposableListener(dom.getWindow(root), 'focus', () => void updateDefault()));
		void updateDefault(); void scan();
		if (openImport) { this.openImport(root); }
	}

	private openImport(parent: HTMLElement, initial?: { sources?: readonly IBrowserImportSource[]; browserId?: string; action?: 'file' | 'folder' }): void {
		if (!this.importer.value) { this.importer.value = new CleanSlateBrowserImportDialog(parent, this.services, () => this.importer.clear(), initial); }
	}
}
