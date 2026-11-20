/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { BrowserImportKind, IBrowserImportSource } from '../../../../../platform/native/common/browserIntegration.js';
import { WillSaveStateReason } from '../../../../../platform/storage/common/storage.js';
import { localize } from '../../../../../nls.js';
import { importCleanSlateBrowserBookmarks } from '../agentManager/cleanSlateBrowserBookmarks.js';
import { ICleanSlateImportSummary, mergeCleanSlateBrowserData } from '../agentManager/cleanSlateBrowserData.js';
import { CLEANSLATE_ACTION_BUTTON_STYLES, createCleanSlateActionButton } from '../cleanSlateActionButton.js';
import type { ICleanSlateBrowserSettingsServices } from './cleanSlateBrowserSettingsView.js';

const categories: readonly { kind: BrowserImportKind; title: string; detail: string; icon: ThemeIcon }[] = [
	{ kind: 'tabs', title: localize('browser.tabs', 'Open tabs'), detail: localize('browser.tabsDetail', 'Restore your saved tabs in the sidebar.'), icon: Codicon.browser },
	{ kind: 'bookmarks', title: localize('browser.bookmarks', 'Bookmarks and folders'), detail: localize('browser.bookmarksDetail', 'Keep your saved pages and folders.'), icon: Codicon.bookmark },
	{ kind: 'history', title: localize('browser.history', 'Browsing history'), detail: localize('browser.historyDetail', 'Find pages you’ve visited, up to 50,000 per profile.'), icon: Codicon.history },
];

export class CleanSlateBrowserImportDialog extends Disposable {
	private readonly dialog: HTMLDialogElement;
	private readonly header: HTMLElement;
	private readonly content: HTMLElement;
	private readonly footer: HTMLElement;
	private readonly previousFocus: HTMLElement | null;
	private sources: readonly IBrowserImportSource[] = [];
	private selectedBrowser = '';
	private readonly selectedProfiles = new Set<string>();
	private readonly selectedKinds = new Set<BrowserImportKind>();
	private profileEditor: HTMLElement | undefined;
	private busy = false;
	private disposed = false;

	constructor(parent: HTMLElement, private readonly services: ICleanSlateBrowserSettingsServices, private readonly onClose: () => void, initial?: { sources?: readonly IBrowserImportSource[]; browserId?: string; action?: 'file' | 'folder' }) {
		super();
		this.previousFocus = parent.ownerDocument.activeElement as HTMLElement | null;
		this.dialog = dom.append(parent, dom.$('dialog.cleanSlate-browser-import-dialog')) as HTMLDialogElement;
		this.dialog.setAttribute('aria-label', localize('browser.importData', 'Import browser data'));
		const style = dom.append(this.dialog, dom.$('style'));
		style.textContent = `
			${CLEANSLATE_ACTION_BUTTON_STYLES}
			.cleanSlate-browser-import-dialog { --import-muted:var(--vscode-descriptionForeground); --import-line:var(--vscode-contrastBorder,color-mix(in srgb,var(--vscode-foreground) 12%,transparent)); --import-fill:color-mix(in srgb,var(--vscode-foreground) 4%,transparent); box-sizing:border-box; width:min(600px,calc(100vw - 32px)); height:min(580px,calc(100dvh - 48px)); max-height:calc(100dvh - 48px); overflow:hidden; padding:0; border:1px solid var(--import-line); border-radius:24px; background:var(--cleanSlate-agent-manager-panel-bg,var(--vscode-editor-background)); color:var(--vscode-foreground); box-shadow:0 30px 100px #0006; font:13px var(--vscode-font-family); }
			.cleanSlate-browser-import-dialog[open] { display:grid; grid-template-rows:auto minmax(0,1fr) auto; animation:cs-import-enter 160ms ease-out; }
			.cleanSlate-browser-import-dialog:focus { outline:none; }
			.cleanSlate-browser-import-dialog .cs-import-header { padding:32px 28px 24px; }
			.cleanSlate-browser-import-dialog .cs-import-header h2:focus { outline:none; }
			@keyframes cs-import-enter { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
			.cleanSlate-browser-import-dialog::backdrop { background:#0007; backdrop-filter:blur(8px); }
			.cleanSlate-browser-import-dialog .cs-import-content { box-sizing:border-box; padding:0 28px 24px; min-height:0; overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable; }
			.cleanSlate-browser-import-dialog h2 { margin:0 30px 12px 0; font-size:24px; line-height:1.25; letter-spacing:-.5px; font-weight:550; text-wrap:balance; }
			.cleanSlate-browser-import-dialog h3 { margin:24px 0 12px; font-size:12px; font-weight:500; color:var(--import-muted); }
			.cleanSlate-browser-import-dialog p { margin:0; color:var(--import-muted); line-height:1.6; }
			.cleanSlate-browser-import-dialog button:not(.cleanSlate-action-button) { box-sizing:border-box; font:inherit; color:inherit; cursor:pointer; border:0; background:transparent; }
			.cleanSlate-browser-import-dialog button:focus-visible, .cleanSlate-browser-import-dialog input:focus-visible, .cleanSlate-browser-import-dialog summary:focus-visible { outline:2px solid var(--vscode-focusBorder); outline-offset:3px; }
			.cleanSlate-browser-import-dialog button:disabled { cursor:default; opacity:.35; }
			.cleanSlate-browser-import-dialog .cs-import-list { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin:4px 0 6px; }
			.cleanSlate-browser-import-dialog .cs-import-source { display:flex; align-items:center; gap:14px; width:100%; min-height:88px; padding:16px; border:1px solid var(--import-line); border-radius:18px; text-align:left; transition:border-color .15s,background .15s; }
			.cleanSlate-browser-import-dialog .cs-import-source:hover { background:var(--import-fill); border-color:color-mix(in srgb,var(--vscode-foreground) 28%,transparent); }
			.cleanSlate-browser-import-dialog .cs-import-source[aria-pressed=true] { border-color:color-mix(in srgb,var(--vscode-foreground) 65%,transparent); background:var(--import-fill); }
			.cleanSlate-browser-import-dialog .cs-import-source img { width:52px; height:52px; object-fit:contain; flex-shrink:0; filter:drop-shadow(0 3px 5px #0002); }
			.cleanSlate-browser-import-dialog .cs-import-source > .codicon { font-size:42px; width:52px; flex-shrink:0; color:var(--import-muted); }
			.cleanSlate-browser-import-dialog .cs-import-copy { display:grid; gap:6px; flex:1; min-width:0; }
			.cleanSlate-browser-import-dialog .cs-import-copy strong { font-size:14px; font-weight:500; overflow-wrap:anywhere; }
			.cleanSlate-browser-import-dialog small { font-size:12px; line-height:1.5; color:var(--import-muted); }
			.cleanSlate-browser-import-dialog .cs-import-radio { box-sizing:border-box; width:20px; height:20px; border-radius:50%; border:1.5px solid color-mix(in srgb,var(--vscode-foreground) 28%,transparent); flex-shrink:0; margin-left:auto; }
			.cleanSlate-browser-import-dialog .cs-import-saved { margin-top:20px; font-size:12px; color:var(--import-muted); }
			.cleanSlate-browser-import-dialog .cs-import-saved summary { cursor:pointer; padding:5px 0; }
			.cleanSlate-browser-import-dialog .cs-import-saved-list { display:grid; gap:7px; margin-top:10px; }
			.cleanSlate-browser-import-dialog .cs-import-saved .cs-import-source { min-height:58px; padding:12px 16px; border-radius:10px; }
			.cleanSlate-browser-import-dialog .cs-import-saved .cs-import-source > .codicon { font-size:20px; width:24px; }
			.cleanSlate-browser-import-dialog .cs-import-saved .cs-import-copy { display:flex; align-items:center; gap:10px; }
			.cleanSlate-browser-import-dialog .cs-import-saved .cs-import-copy strong { font-size:12px; color:var(--vscode-foreground); }
			.cleanSlate-browser-import-dialog [aria-pressed=true] .cs-import-radio { border-color:var(--vscode-foreground); box-shadow:inset 0 0 0 3px var(--vscode-editor-background); background:var(--vscode-foreground); }
			.cleanSlate-browser-import-dialog .cs-import-tools { display:flex; flex-wrap:wrap; gap:8px; margin-top:20px; }
			.cleanSlate-browser-import-dialog .cs-import-link:not(.cleanSlate-action-button) { min-height:32px; padding:6px 10px; border:1px solid var(--import-line); border-radius:4px; color:var(--import-muted); font-size:12px; }
			.cleanSlate-browser-import-dialog .cs-import-link:not(.cleanSlate-action-button):hover { color:var(--vscode-foreground); background:var(--import-fill); }
			.cleanSlate-browser-import-dialog .cs-import-compatibility { margin-top:16px; color:var(--import-muted); font-size:11px; line-height:1.6; }
			.cleanSlate-browser-import-dialog .cs-import-compatibility summary, .cleanSlate-browser-import-dialog .cs-import-saved summary { display:flex; align-items:center; gap:8px; min-height:34px; padding:0 4px; list-style:none; border-radius:6px; cursor:pointer; }
			.cleanSlate-browser-import-dialog summary::-webkit-details-marker { display:none; }
			.cleanSlate-browser-import-dialog .cs-import-compatibility summary:hover, .cleanSlate-browser-import-dialog .cs-import-saved summary:hover { background:var(--import-fill); }
			.cleanSlate-browser-import-dialog summary > .cs-import-chevron { font-size:16px; transition:transform 180ms ease; }
			.cleanSlate-browser-import-dialog details[open] > summary > .cs-import-chevron { transform:rotate(90deg); }
			.cleanSlate-browser-import-dialog details::details-content { interpolate-size:allow-keywords; height:0; overflow:clip; transition:height 180ms ease,content-visibility 180ms; transition-behavior:allow-discrete; }
			.cleanSlate-browser-import-dialog details[open]::details-content { height:auto; }
			.cleanSlate-browser-import-dialog .cs-import-compatibility p { margin-top:8px; }
			.cleanSlate-browser-import-dialog .cs-import-footer { display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-end; gap:10px; padding:18px 28px; border-top:1px solid var(--import-line); background:var(--cleanSlate-agent-manager-panel-bg,var(--vscode-editor-background)); }
			.cleanSlate-browser-import-dialog .cs-import-footer button:not(.cleanSlate-action-button) { min-height:32px; padding:6px 14px; border:1px solid var(--import-line); border-radius:4px; font-size:12px; line-height:18px; font-weight:500; }
			.cleanSlate-browser-import-dialog .cs-import-footer .primary:not(.cleanSlate-action-button) { flex:0 0 auto; min-width:88px; min-height:32px; background:var(--vscode-foreground); color:var(--vscode-editor-background); border-color:transparent; font-weight:600; }
			.cleanSlate-browser-import-dialog .cs-import-footer .primary:not(.cleanSlate-action-button):hover:enabled { opacity:.88; }
			.cleanSlate-browser-import-dialog .cs-import-browser-card .cleanSlate-action-button.cs-import-edit-profiles { position:absolute; bottom:10px; left:64px; }
			.cleanSlate-browser-import-dialog .cleanSlate-action-button.cs-import-profile-summary { align-self:flex-start; margin-bottom:20px; }
			.cleanSlate-browser-import-dialog .cleanSlate-action-button.cs-import-close { width:24px; min-height:24px; padding:3px; position:absolute; top:16px; right:16px; z-index:1; }
			.cleanSlate-browser-import-dialog .cs-import-browser-card { position:relative; min-width:0; }
			.cleanSlate-browser-import-dialog .cs-import-browser-card .cs-import-copy strong { font-size:14px; }
			.cleanSlate-browser-import-dialog .cs-import-browser-card .cs-import-source img, .cleanSlate-browser-import-dialog .cs-import-browser-card .cs-import-source > .codicon { width:36px; height:36px; font-size:30px; }
			.cleanSlate-browser-import-dialog .cs-import-browser-card .cs-import-source { min-height:88px; padding:12px 14px 32px; border-radius:6px; }
			.cleanSlate-browser-import-dialog .cs-import-edit-profiles:not(.cleanSlate-action-button) { position:absolute; bottom:10px; left:64px; display:flex; align-items:center; gap:6px; padding:3px 0; font-size:12px; color:var(--import-muted); }
			.cleanSlate-browser-import-dialog .cs-import-edit-profiles:not(.cleanSlate-action-button):hover { color:var(--vscode-foreground); }
			.cleanSlate-browser-import-dialog .cs-import-profile-summary:not(.cleanSlate-action-button) { display:flex; align-items:center; justify-content:space-between; width:100%; min-height:32px; padding:8px 12px; margin-bottom:20px; border:1px solid var(--import-line); border-radius:4px; }
			.cleanSlate-browser-import-dialog .cs-import-profile-editor { position:absolute; inset:20px; z-index:2; display:flex; flex-direction:column; gap:16px; padding:28px; border:1px solid var(--import-line); border-radius:18px; background:var(--cleanSlate-agent-manager-panel-bg,var(--vscode-editor-background)); box-shadow:0 12px 60px #0008; }
			.cleanSlate-browser-import-dialog .cs-import-profile-editor h2 { font-size:24px; margin:0; }
			.cleanSlate-browser-import-dialog .cs-import-editor-list { flex:1; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:8px; overscroll-behavior:contain; }
			.cleanSlate-browser-import-dialog .cs-import-editor-list .cs-import-choice { padding:16px; border:1px solid var(--import-line); border-radius:12px; background:var(--import-fill); }
			.cleanSlate-browser-import-dialog .cs-import-editor-done:not(.cleanSlate-action-button) { align-self:flex-end; min-width:80px; min-height:32px; padding:6px 14px; border-radius:4px; font-size:12px; line-height:18px; background:var(--vscode-foreground); color:var(--vscode-editor-background); font-weight:600; }
			.cleanSlate-browser-import-dialog .cs-import-alternatives { display:grid; gap:10px; margin-top:20px; }
			.cleanSlate-browser-import-dialog .cs-import-alternative { display:flex; align-items:center; gap:12px; width:100%; padding:12px; border:1px solid var(--import-line); border-radius:6px; text-align:left; }
			.cleanSlate-browser-import-dialog .cs-import-alternative:hover { background:var(--import-fill); }
			.cleanSlate-browser-import-dialog .cs-import-alternative > .codicon { font-size:20px; color:var(--import-muted); }
			.cleanSlate-browser-import-dialog .cs-import-footer-note { flex:1; text-align:left; font-size:11px; }
			.cleanSlate-browser-import-dialog .cs-import-footer-summary { color:var(--import-muted); font-size:11px; }
			.cleanSlate-browser-import-dialog .cs-import-close:not(.cleanSlate-action-button) { position:absolute; top:16px; right:16px; display:grid; place-items:center; width:28px; height:28px; padding:0; border-radius:4px; color:var(--import-muted); z-index:1; }
			.cleanSlate-browser-import-dialog .cs-import-close:not(.cleanSlate-action-button):hover { color:var(--vscode-foreground); background:var(--import-fill); }
			.cleanSlate-browser-import-dialog .cs-import-brand { display:flex; align-items:center; gap:18px; margin:0; }
			.cleanSlate-browser-import-dialog .cs-import-brand img { width:64px; height:64px; object-fit:contain; filter:drop-shadow(0 4px 8px #0002); }
			.cleanSlate-browser-import-dialog .cs-import-brand > .codicon { font-size:46px; width:64px; color:var(--import-muted); }
			.cleanSlate-browser-import-dialog .cs-import-brand h2 { font-size:25px; margin:0 24px 6px 0; }
			.cleanSlate-browser-import-dialog .cs-import-brand p { font-size:12px; }
			.cleanSlate-browser-import-dialog .cs-import-profiles { border:1px solid var(--import-line); border-radius:12px; overflow:hidden; margin-bottom:22px; }
			.cleanSlate-browser-import-dialog .cs-import-profiles summary { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:13px 16px; cursor:pointer; list-style:none; font-size:12px; }
			.cleanSlate-browser-import-dialog .cs-import-profiles summary::-webkit-details-marker { display:none; }
			.cleanSlate-browser-import-dialog .cs-import-profiles summary:after { content:'+'; font-size:16px; color:var(--import-muted); }
			.cleanSlate-browser-import-dialog .cs-import-profiles[open] summary:after { content:'−'; }
			.cleanSlate-browser-import-dialog .cs-import-profile-list { padding:0 16px 8px; }
			.cleanSlate-browser-import-dialog .cs-import-choice { position:relative; display:flex; align-items:center; gap:12px; padding:14px 0; cursor:pointer; }
			.cleanSlate-browser-import-dialog .cs-import-choice input { appearance:none; box-sizing:border-box; width:18px; height:18px; margin:0; border:1px solid color-mix(in srgb,var(--vscode-foreground) 30%,transparent); border-radius:5px; flex-shrink:0; background:transparent; cursor:pointer; }
			.cleanSlate-browser-import-dialog .cs-import-choice input:checked { background:var(--vscode-foreground); border-color:var(--vscode-foreground); }
			.cleanSlate-browser-import-dialog .cs-import-choice input:checked:after { content:''; display:block; width:4px; height:8px; border:solid var(--vscode-editor-background); border-width:0 2px 2px 0; transform:translate(5px,2px) rotate(45deg); }
			.cleanSlate-browser-import-dialog .cs-import-profile-list .cs-import-choice { padding:9px 0; }
			.cleanSlate-browser-import-dialog .cs-import-profile-list strong { font-size:12px; }
			.cleanSlate-browser-import-dialog .cs-import-categories { border-top:1px solid var(--import-line); border-bottom:1px solid var(--import-line); }
			.cleanSlate-browser-import-dialog .cs-import-categories .cs-import-choice { gap:16px; padding:17px 0; }
			.cleanSlate-browser-import-dialog .cs-import-categories .cs-import-choice + .cs-import-choice { border-top:1px solid color-mix(in srgb,var(--vscode-foreground) 7%,transparent); }
			.cleanSlate-browser-import-dialog .cs-import-categories .cs-import-choice > .codicon { font-size:20px; width:24px; color:var(--import-muted); }
			.cleanSlate-browser-import-dialog .cs-import-categories input { order:3; }
			.cleanSlate-browser-import-dialog .cs-import-categories small { font-size:11px; }
			.cleanSlate-browser-import-dialog .cs-import-note { font-size:11px; margin-top:17px; line-height:1.6; }
			.cleanSlate-browser-import-dialog .cs-import-unavailable { display:grid; gap:6px; margin-top:12px; font-size:11px; }
			.cleanSlate-browser-import-dialog .cs-import-loading { display:flex; gap:12px; align-items:center; margin:32px 0; color:var(--import-muted); }
			.cleanSlate-browser-import-dialog .cs-import-result-list { display:grid; margin:24px 0; }
			.cleanSlate-browser-import-dialog .cs-import-result { display:flex; align-items:center; gap:12px; padding:14px 0; border-bottom:1px solid var(--import-line); }
			.cleanSlate-browser-import-dialog .cs-import-result > .codicon { color:var(--import-muted); }
			.cleanSlate-browser-import-dialog .cs-import-result strong { margin-left:auto; font-weight:500; }
			.cleanSlate-browser-import-dialog [role=alert] { color:var(--vscode-errorForeground); margin-top:12px; font-size:12px; }
			@media (max-width:570px) { .cleanSlate-browser-import-dialog .cs-import-content { padding:0 20px 20px; } .cleanSlate-browser-import-dialog .cs-import-footer { padding:16px 20px; } .cleanSlate-browser-import-dialog h2 { font-size:25px; } .cleanSlate-browser-import-dialog .cs-import-list { grid-template-columns:1fr; } .cleanSlate-browser-import-dialog .cs-import-source { min-height:86px; padding:14px 18px; } .cleanSlate-browser-import-dialog .cs-import-source img { width:44px;height:44px; } }
			@media (prefers-reduced-motion:reduce) { .cleanSlate-browser-import-dialog, .cleanSlate-browser-import-dialog * { transition:none!important; animation:none!important; } }
		`;

		this.header = dom.append(this.dialog, dom.$('.cs-import-header'));
		this.content = dom.append(this.dialog, dom.$('.cs-import-content'));
		this.footer = dom.append(this.dialog, dom.$('.cs-import-footer'));
		this._register(dom.addDisposableListener(this.dialog, 'cancel', event => { event.preventDefault(); if (!this.busy) { this.close(); } }));
		this._register(dom.addDisposableListener(dom.getWindow(this.dialog), 'keydown', event => {
			if ((event as KeyboardEvent).key === 'Escape' && !this.profileEditor) {
				event.preventDefault(); event.stopImmediatePropagation();
				if (!this.busy) { this.close(); }
			}
		}, true));
		const close = this.button(this.dialog, '', () => { if (!this.busy) { this.close(); } }, 'cs-import-close');
		close.setAttribute('aria-label', localize('browser.closeImport', 'Close import')); dom.append(close, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.close)}`));
		if (initial?.action === 'file') { void this.importHTML(); }
		else if (initial?.action === 'folder') { void this.scan(true); }
		else if (initial?.sources) { this.sources = initial.sources; if (initial.browserId) { this.selectBrowser(initial.browserId); this.renderData(); } else { this.renderBrowsers(); } }
		else { void this.scan(); }
		this.dialog.showModal();
		this.focusHeading();
	}

	private button(parent: HTMLElement, label: string, action: () => void | Promise<void>, className = ''): HTMLButtonElement {
		if (className !== 'cs-import-source' && className !== 'cs-import-alternative') {
			const button = createCleanSlateActionButton(parent, { label, action, variant: className === 'primary' || className === 'cs-import-editor-done' ? 'primary' : 'secondary' });
			if (className) { button.classList.add(className); }
			if (className === 'cs-import-editor-done') { button.style.alignSelf = 'flex-end'; }
			return button;
		}
		const button = dom.append(parent, dom.$(`button${className ? '.' + className : ''}`)) as HTMLButtonElement;
		button.type = 'button'; button.textContent = label; button.onclick = action; return button;
	}

	private heading(title: string, subtitle: string): void {
		dom.clearNode(this.header); dom.clearNode(this.content); dom.clearNode(this.footer);
		this.content.scrollTop = 0;
		dom.append(this.header, dom.$('h2')).textContent = title;
		dom.append(this.header, dom.$('p')).textContent = subtitle;
		this.focusHeading();
	}

	private importOption(parent: HTMLElement, icon: ThemeIcon, title: string, detail: string, action: () => void): void {
		const option = this.button(parent, '', action, 'cs-import-alternative');
		dom.append(option, dom.$(`span${ThemeIcon.asCSSSelector(icon)}`)).setAttribute('aria-hidden', 'true');
		const copy = dom.append(option, dom.$('.cs-import-copy'));
		dom.append(copy, dom.$('strong')).textContent = title;
		dom.append(copy, dom.$('small')).textContent = detail;
		dom.append(option, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.chevronRight)}`)).setAttribute('aria-hidden', 'true');
	}

	private focusHeading(): void {
		const heading = this.header.querySelector('h2');
		if (heading) { heading.tabIndex = -1; if (this.dialog.open) { heading.focus({ preventScroll: true }); } }
	}

	private disclosure(parent: HTMLElement, title: string): void {
		const summary = dom.append(parent, dom.$('summary'));
		dom.append(summary, dom.$(`span.cs-import-chevron${ThemeIcon.asCSSSelector(Codicon.chevronRight)}`)).setAttribute('aria-hidden', 'true');
		dom.append(summary, dom.$('span')).textContent = title;
	}

	private icon(parent: HTMLElement, source: IBrowserImportSource): void {
		if (source.icon?.startsWith('data:image/')) { const image = dom.append(parent, dom.$('img')) as HTMLImageElement; image.src = source.icon; image.alt = ''; }
		else { dom.append(parent, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.globe)}`)).setAttribute('aria-hidden', 'true'); }
	}

	private async scan(folder = false): Promise<void> {
		if (this.busy) { return; }
		this.busy = true;
		this.heading(localize('browser.bringTitle', 'Import browser data'), localize('browser.chooseSource', 'Choose a browser to bring your tabs, bookmarks and history into CleanSlate.'));
		const loading = dom.append(this.content, dom.$('.cs-import-loading')); loading.setAttribute('role', 'status');
		dom.append(loading, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.loading)}.codicon-modifier-spin`));
		dom.append(loading, dom.$('span')).textContent = folder ? localize('browser.waitingFolder', 'Choose your browser’s profile folder in the file picker…') : localize('browser.scanning', 'Looking for browser profiles…');
		try {
			const sources = await (folder ? this.services.nativeHost.chooseBrowserImportFolder() : this.services.nativeHost.getBrowserImportSources());
			if (sources) { this.sources = sources; }
			if (!this.disposed) { this.renderBrowsers(); }
		} catch { if (!this.disposed) { this.renderBrowsers(); this.error(localize('browser.scanFailed', 'Browser profiles could not be scanned. Try again or choose a profile folder.')); } }
		finally { this.busy = false; }
	}

	private renderBrowsers(): void {
		this.heading(localize('browser.bringTitle', 'Import browser data'), localize('browser.chooseSource', 'Choose a browser to bring your tabs, bookmarks and history into CleanSlate.'));
		const groups = new Map<string, IBrowserImportSource[]>();
		for (const source of this.sources) { const group = groups.get(source.browserId) ?? []; group.push(source); groups.set(source.browserId, group); }
		const list = dom.append(this.content, dom.$('.cs-import-list'));
		if (!groups.size) {
			list.remove();
			dom.append(this.content, dom.$('p.cs-import-note')).textContent = localize('browser.noProfiles', 'No browser profiles found. Choose how you’d like to import your data.');
			const alternatives = dom.append(this.content, dom.$('.cs-import-alternatives'));
			this.importOption(alternatives, Codicon.folder, localize('browser.chooseFolder', 'Choose a profile folder…'), localize('browser.folderDescription', 'Import tabs, bookmarks and history from a browser profile.'), () => void this.scan(true));
			this.importOption(alternatives, Codicon.bookmark, localize('browser.fromHTML', 'From a bookmarks HTML file…'), localize('browser.htmlDescription', 'Import saved pages exported from any browser.'), () => void this.importHTML());
		}
		if (groups.size && !groups.has(this.selectedBrowser)) { this.selectBrowser(groups.keys().next().value!); }
		for (const [id, profiles] of groups) {
			const card = dom.append(list, dom.$('.cs-import-browser-card'));
			const row = this.button(card, '', () => { if (this.selectedBrowser !== id) { this.selectBrowser(id); } this.updateBrowserSelection(); }, 'cs-import-source');
			row.dataset.browserId = id; row.setAttribute('aria-pressed', String(this.selectedBrowser === id));
			this.icon(row, profiles[0]);
			const copy = dom.append(row, dom.$('.cs-import-copy'));
			dom.append(copy, dom.$('strong')).textContent = profiles[0].browser;
			dom.append(row, dom.$('span.cs-import-radio')).setAttribute('aria-hidden', 'true');
			const edit = this.button(card, localize('browser.editProfileCount', '{0} profiles', profiles.length), () => {
				if (this.selectedBrowser !== id) { this.selectBrowser(id); this.updateBrowserSelection(); }
				this.editProfiles(edit);
			}, 'cs-import-edit-profiles');
			edit.setAttribute('aria-label', localize('browser.editBrowserProfiles', 'Edit {0} profiles', profiles[0].browser));
			dom.append(edit, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.edit)}`)).setAttribute('aria-hidden', 'true');
		}
		const tools = dom.append(this.content, dom.$('.cs-import-tools'));

		if (groups.size) {
			this.button(tools, localize('browser.chooseFolder', 'Choose a profile folder…'), () => void this.scan(true), 'cs-import-link');
			this.button(tools, localize('browser.fromHTML', 'From a bookmarks HTML file…'), () => void this.importHTML(), 'cs-import-link');
		} else { tools.remove(); }
		const compatibility = dom.append(this.content, dom.$('details.cs-import-compatibility'));
		this.disclosure(compatibility, localize('browser.compatibility', 'Browser compatibility'));
		dom.append(compatibility, dom.$('p')).textContent = localize('browser.supportedFormats', 'Chrome, Edge and other Chromium browsers support profile imports. For other browsers, export your bookmarks as an HTML file and import it here.');
		dom.append(this.footer, dom.$('p.cs-import-footer-note')).textContent = localize('browser.sourceUnchanged', 'Your source browser stays unchanged.');
		if (groups.size) {
			const next = this.button(this.footer, localize('browser.continue', 'Continue'), () => this.renderData(), 'primary'); next.dataset.continue = 'true'; next.disabled = !this.selectedProfiles.size;
		} else { this.button(this.footer, localize('browser.done', 'Done'), () => this.close()); }
	}

	private editProfiles(trigger: HTMLElement, onDone?: () => void): void {
		const profiles = this.profiles();
		if (!profiles.length || this.profileEditor) { return; }
		for (const child of Array.from(this.dialog.children)) { if (child instanceof HTMLElement) { child.inert = true; } }
		const editor = this.profileEditor = dom.append(this.dialog, dom.$('.cs-import-profile-editor'));
		editor.setAttribute('role', 'dialog');
		editor.setAttribute('aria-modal', 'true');
		editor.setAttribute('aria-label', localize('browser.editProfilesTitle', 'Import from {0}', profiles[0].browser));
		dom.append(editor, dom.$('h2')).textContent = localize('browser.editProfilesTitle', 'Import from {0}', profiles[0].browser);
		dom.append(editor, dom.$('p')).textContent = localize('browser.customizeProfiles', 'Choose which profiles to bring into CleanSlate.');
		const list = dom.append(editor, dom.$('.cs-import-editor-list'));
		for (const profile of profiles) {
			this.choice(list, profile.profile, '', this.selectedProfiles.has(profile.id), checked => {
				if (checked) { this.selectedProfiles.add(profile.id); } else { this.selectedProfiles.delete(profile.id); }
			});
		}
		const done = this.button(editor, localize('browser.done', 'Done'), () => finish(), 'cs-import-editor-done');
		const finish = () => {
			this.profileEditor = undefined; editor.remove();
			for (const child of Array.from(this.dialog.children)) { if (child instanceof HTMLElement) { child.inert = false; } }
			this.updateBrowserSelection();
			onDone?.();
			if (trigger.isConnected) { trigger.focus({ preventScroll: true }); }
		};
		editor.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(); } };
		done.focus({ preventScroll: true });
	}

	private profiles(): IBrowserImportSource[] { return this.sources.filter(source => source.browserId === this.selectedBrowser); }

	private selectBrowser(id: string): void {
		this.selectedBrowser = id; this.selectedProfiles.clear();
		const profiles = this.profiles(); profiles.forEach(profile => this.selectedProfiles.add(profile.id));
		this.selectedKinds.clear(); categories.forEach(({ kind }) => { if (profiles.some(profile => profile.available[kind])) { this.selectedKinds.add(kind); } });
	}

	private updateBrowserSelection(): void {
		for (const row of this.content.querySelectorAll<HTMLElement>('.cs-import-source')) { row.setAttribute('aria-pressed', String(row.dataset.browserId === this.selectedBrowser)); }
		const next = this.footer.querySelector<HTMLButtonElement>('[data-continue]'); if (next) { next.disabled = !this.selectedProfiles.size; }
	}

	private renderData(): void {
		const profiles = this.profiles();
		if (!profiles.length) { this.renderBrowsers(); return; }
		dom.clearNode(this.header); dom.clearNode(this.content); dom.clearNode(this.footer);
		const brand = dom.append(this.header, dom.$('.cs-import-brand')); this.icon(brand, profiles[0]);
		const title = dom.append(brand, dom.$('div'));
		dom.append(title, dom.$('h2')).textContent = localize('browser.importFrom', 'Import from {0}', profiles[0].browser);
		dom.append(title, dom.$('p')).textContent = localize('browser.chooseDataDetail', 'Choose what you’d like to bring with you.');
		this.focusHeading();
		const selected = profiles.filter(source => this.selectedProfiles.has(source.id));
		const edit = this.button(this.content, selected.length === 1 ? localize('browser.selectedProfileEdit', '1 profile selected') : localize('browser.selectedProfilesEdit', '{0} profiles selected', selected.length), () => this.editProfiles(edit, () => this.renderData()), 'cs-import-profile-summary');
		dom.append(edit, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.edit)}`)).setAttribute('aria-hidden', 'true');
		const choices = dom.append(this.content, dom.$('.cs-import-categories'));
		for (const category of categories) {
			const available = selected.filter(source => source.available[category.kind]);
			if (available.length) {
				const detail = available.length < selected.length ? localize('browser.availableProfileCount', '{0} Available in {1} of {2} selected profiles.', category.detail, available.length, selected.length) : category.detail;
				const label = this.choice(choices, category.title, detail, this.selectedKinds.has(category.kind), checked => {
					if (checked) { this.selectedKinds.add(category.kind); } else { this.selectedKinds.delete(category.kind); } update();
				});
				label.prepend(dom.$(`span${ThemeIcon.asCSSSelector(category.icon)}`));
			} else {
				const row = dom.append(choices, dom.$('.cs-import-result')); dom.append(row, dom.$(`span${ThemeIcon.asCSSSelector(category.icon)}`));
				const copy = dom.append(row, dom.$('.cs-import-copy')); dom.append(copy, dom.$('span')).textContent = category.title;
				dom.append(copy, dom.$('small')).textContent = localize('browser.notAvailable', 'Not available in selected profiles');
			}
		}
		const unavailable = selected.filter(source => !source.available.tabs && source.tabsUnavailable);
		if (unavailable.length) {
			const notes = dom.append(this.content, dom.$('.cs-import-unavailable'));
			for (const source of unavailable) { dom.append(notes, dom.$('p')).textContent = `${source.profile}: ${source.tabsUnavailable}`; }
		}
		dom.append(this.content, dom.$('p.cs-import-note')).textContent = localize('browser.importLimits', 'Passwords, sign-ins and extensions aren’t supported yet. Your source browser stays unchanged.');
		this.button(this.footer, localize('browser.back', 'Back'), () => this.renderBrowsers());
		const submit = this.button(this.footer, localize('browser.import', 'Import'), () => void this.importData(), 'primary');
		const update = () => { submit.disabled = !selected.length || !categories.some(category => this.selectedKinds.has(category.kind) && selected.some(source => source.available[category.kind])); };
		update();
	}

	private choice(parent: HTMLElement, title: string, detail: string, checked: boolean, onChange: (checked: boolean) => void): HTMLElement {
		const label = dom.append(parent, dom.$('label.cs-import-choice'));
		const input = dom.append(label, dom.$('input')) as HTMLInputElement; input.type = 'checkbox'; input.checked = checked; input.setAttribute('aria-label', title);
		const copy = dom.append(label, dom.$('.cs-import-copy')); dom.append(copy, dom.$('strong')).textContent = title;
		if (detail) { dom.append(copy, dom.$('small')).textContent = detail; }
		input.onchange = () => onChange(input.checked);
		return label;
	}

	private progress(pickingFile = false): void {
		this.busy = true;
		this.heading(pickingFile ? localize('browser.chooseBookmarksTitle', 'Choose your bookmarks file') : localize('browser.importingTitle', 'Bringing your data over'), pickingFile ? localize('browser.chooseBookmarksDetail', 'Select an HTML file exported from your browser.') : localize('browser.importingDetail', 'Keep this window open while the selected data is imported.'));
		const status = dom.append(this.content, dom.$('.cs-import-loading')); status.setAttribute('role', 'status');
		dom.append(status, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.loading)}.codicon-modifier-spin`));
		dom.append(status, dom.$('span')).textContent = pickingFile ? localize('browser.waitingFile', 'Waiting for a bookmarks file…') : localize('browser.readingData', 'Reading selected browser data…');
	}

	private async importData(): Promise<void> {
		if (this.busy) { return; }
		const profiles = this.profiles().filter(source => this.selectedProfiles.has(source.id));
		const kinds = categories.filter(category => this.selectedKinds.has(category.kind) && profiles.some(source => source.available[category.kind])).map(category => category.kind);
		this.progress();
		try {
			const result = await this.services.nativeHost.importBrowserData(profiles.map(source => source.id), kinds);
			if (this.disposed) { return; }
			// Preserve the display names supplied by the installed app inventory.
			const summary = mergeCleanSlateBrowserData(this.services.storage, result.map(item => ({ ...item, source: this.sources.find(source => source.id === item.source.id) ?? item.source })));
			await this.services.storage.flush(WillSaveStateReason.SHUTDOWN);
			if (!this.disposed) { this.renderResult(summary, kinds); }
		} catch { if (!this.disposed) { this.renderData(); this.error(localize('browser.importFailed', 'The import could not finish. Scan again if the profile moved, or close the source browser and retry.')); } }
		finally { this.busy = false; }
	}

	private async importHTML(): Promise<void> {
		if (this.busy) { return; }
		this.progress(true);
		try {
			const imported = await this.services.nativeHost.importBrowserBookmarksHTML();
			if (this.disposed) { return; }
			if (!imported) { this.renderBrowsers(); return; }
			const merged = importCleanSlateBrowserBookmarks(this.services.storage, imported, localize('browser.importedFolder', 'Imported bookmarks'));
			await this.services.storage.flush(WillSaveStateReason.SHUTDOWN);
			if (!this.disposed) { this.renderResult({ tabs: 0, bookmarks: merged.added, history: 0, duplicates: merged.duplicates, skipped: merged.skipped, issues: [] }, ['bookmarks']); }
		} catch { if (!this.disposed) { this.renderBrowsers(); this.error(localize('browser.fileFailed', 'This file could not be imported. Choose a bookmarks HTML export smaller than 10 MB.')); } }
		finally { this.busy = false; }
	}

	private renderResult(summary: ICleanSlateImportSummary, kinds: readonly BrowserImportKind[]): void {
		this.heading(summary.issues.length ? localize('browser.finishedIssues', 'Import finished with issues') : summary.tabs + summary.bookmarks + summary.history ? localize('browser.importComplete', 'Your data is ready') : localize('browser.noNewData', 'Everything is already here'), localize('browser.whereImported', 'Tabs are in the sidebar. Bookmarks and history are available in the browser.'));
		const list = dom.append(this.content, dom.$('.cs-import-result-list')); list.setAttribute('role', 'status');
		for (const category of categories.filter(category => kinds.includes(category.kind))) {
			const row = dom.append(list, dom.$('.cs-import-result')); dom.append(row, dom.$(`span${ThemeIcon.asCSSSelector(category.icon)}`));
			dom.append(row, dom.$('span')).textContent = category.title; dom.append(row, dom.$('strong')).textContent = localize('browser.importCount', '{0} imported', summary[category.kind]);
		}
		if (summary.duplicates || summary.skipped) { dom.append(this.content, dom.$('p.cs-import-note')).textContent = localize('browser.skippedCounts', '{0} duplicates and {1} unsupported links skipped.', summary.duplicates, summary.skipped); }
		for (const issue of summary.issues) { this.error(issue); }
		this.button(this.footer, localize('browser.importAnother', 'Import another'), () => this.renderBrowsers());
		this.button(this.footer, this.services.startBrowsing ? localize('browser.startBrowsing', 'Start browsing') : localize('browser.done', 'Done'), () => { this.close(); this.services.startBrowsing?.(); }, 'primary');
	}

	private error(message: string): void { const error = dom.append(this.content, dom.$('p')); error.setAttribute('role', 'alert'); error.textContent = message; }
	private close(): void { this.dispose(); this.onClose(); }

	override dispose(): void {
		if (this.disposed) { return; }
		this.disposed = true; this.dialog.close(); this.dialog.remove();
		if (this.previousFocus?.isConnected) { this.previousFocus.focus(); }
		super.dispose();
	}
}
