/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from '../../../../../base/common/uuid.js';
import { browserBookmark, IBrowserHistoryEntry, IBrowserProfileImport } from '../../../../../platform/native/common/browserIntegration.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { importCleanSlateBrowserBookmarks } from './cleanSlateBrowserBookmarks.js';

export const cleanSlateBrowserHistoryKey = 'cleanSlate.browser.history';
export const cleanSlateBrowserImportedTabsKey = 'cleanSlate.browser.importedTabs';
export interface ICleanSlateImportedTab { readonly id: string; readonly url: string; readonly title: string; readonly source: string; readonly pinned: boolean }
export interface ICleanSlateImportSummary { tabs: number; bookmarks: number; history: number; duplicates: number; skipped: number; issues: string[] }

function readArray(storage: IStorageService, key: string): unknown[] {
	try { const parsed: unknown = JSON.parse(storage.get(key, StorageScope.PROFILE, '[]')); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

export function readCleanSlateBrowserHistory(storage: IStorageService): IBrowserHistoryEntry[] {
	return parseCleanSlateBrowserHistory(storage.get(cleanSlateBrowserHistoryKey, StorageScope.PROFILE, '[]'));
}

export function parseCleanSlateBrowserHistory(json: string): IBrowserHistoryEntry[] {
	let values: unknown;
	try { values = JSON.parse(json); } catch { return []; }
	if (!Array.isArray(values)) { return []; }
	return values.slice(0, 50_000).flatMap((value: unknown) => {
		const item = value as Partial<IBrowserHistoryEntry> | null;
		const page = browserBookmark(item?.url, item?.title);
		return page && typeof item?.lastVisit === 'number' && Number.isFinite(item.lastVisit) && item.lastVisit > 0
			? [{ url: page.url, title: page.title, lastVisit: item.lastVisit, visits: typeof item.visits === 'number' ? item.visits : 1 }] : [];
	});
}

export function readCleanSlateImportedTabs(storage: IStorageService): ICleanSlateImportedTab[] {
	return readArray(storage, cleanSlateBrowserImportedTabsKey).slice(0, 10_000).flatMap((value: unknown) => {
		const item = value as Partial<ICleanSlateImportedTab> | null; const page = browserBookmark(item?.url, item?.title);
		return page && typeof item?.id === 'string' && item.id.startsWith('cleanslate.workspace.browser.') ? [{ id: item.id, url: page.url, title: page.title, source: typeof item.source === 'string' ? item.source : '', pinned: !!item.pinned }] : [];
	});
}

export function mergeCleanSlateBrowserData(storage: IStorageService, results: readonly IBrowserProfileImport[]): ICleanSlateImportSummary {
	const summary: ICleanSlateImportSummary = { tabs: 0, bookmarks: 0, history: 0, duplicates: 0, skipped: 0, issues: [] };
	const tabs = readCleanSlateImportedTabs(storage); const tabURLs = new Set(tabs.map(tab => `${tab.source}\n${tab.url}`));
	const history = new Map(readCleanSlateBrowserHistory(storage).map(page => [page.url, page]));
	for (const result of results) {
		const source = `${result.source.browser} — ${result.source.profile}`;
		summary.issues.push(...result.issues.map(issue => `${source}: ${issue.kind} — ${issue.message}`));
		if (result.bookmarks) {
			try { const merged = importCleanSlateBrowserBookmarks(storage, result.bookmarks, source); summary.bookmarks += merged.added; summary.duplicates += merged.duplicates; summary.skipped += merged.skipped; }
			catch { summary.issues.push(`${source}: The bookmark library is full. Remove bookmarks and try again.`); }
		}
		for (const item of result.tabs ?? []) {
			if (tabURLs.has(`${source}\n${item.url}`)) { summary.duplicates++; continue; }
			if (tabs.length >= 10_000) { summary.issues.push(`${source}: The 10,000 tab limit was reached.`); break; }
			tabURLs.add(`${source}\n${item.url}`); tabs.push({ ...item, id: `cleanslate.workspace.browser.${generateUuid()}`, source }); summary.tabs++;
		}
		for (const page of result.history ?? []) {
			const previous = history.get(page.url);
			if (previous) { summary.duplicates++; }
			else { summary.history++; }
			if (!previous || page.lastVisit > previous.lastVisit) { history.set(page.url, page); }
		}
	}
	if (summary.tabs) { storage.store(cleanSlateBrowserImportedTabsKey, JSON.stringify(tabs), StorageScope.PROFILE, StorageTarget.MACHINE); }
	if (results.some(result => result.history)) {
		const pages = Array.from(history.values()).sort((a, b) => b.lastVisit - a.lastVisit);
		if (pages.length > 50_000) { summary.issues.push('History keeps the 50,000 most recently visited pages.'); }
		storage.store(cleanSlateBrowserHistoryKey, JSON.stringify(pages.slice(0, 50_000)), StorageScope.PROFILE, StorageTarget.MACHINE);
	}
	return summary;
}
