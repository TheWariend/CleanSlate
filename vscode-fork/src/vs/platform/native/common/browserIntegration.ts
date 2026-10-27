/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IBrowserBookmark {
	readonly title: string;
	readonly url: string;
	readonly folders: readonly string[];
	readonly favicon?: string;
}

export interface IBrowserBookmarkImport {
	readonly bookmarks: IBrowserBookmark[];
	readonly skipped: number;
}

export interface IBrowserImportSource {
	readonly id: string;
	readonly browserId: string;
	readonly browser: string;
	readonly profile: string;
	readonly icon?: string;
	readonly available: Readonly<Record<BrowserImportKind, boolean>>;
	readonly tabsUnavailable?: string;
}

export type BrowserImportKind = 'tabs' | 'bookmarks' | 'history';

export interface IBrowserImportedTab {
	readonly url: string;
	readonly title: string;
	readonly pinned: boolean;
}

export interface IBrowserHistoryEntry {
	readonly url: string;
	readonly title: string;
	readonly lastVisit: number;
	readonly visits: number;
}

export interface IBrowserProfileImport {
	readonly source: IBrowserImportSource;
	readonly bookmarks?: IBrowserBookmarkImport;
	readonly tabs?: readonly IBrowserImportedTab[];
	readonly history?: readonly IBrowserHistoryEntry[];
	readonly issues: readonly { readonly kind: BrowserImportKind; readonly message: string }[];
}

export interface IDefaultBrowserState {
	readonly isDefault: boolean;
	readonly canSetDefault: boolean;
	readonly message?: string;
}

export const browserBookmarkLimit = 50_000;

export function browserBookmark(value: unknown, title: unknown, folders: readonly string[] = []): IBrowserBookmark | undefined {
	if (typeof value !== 'string') { return undefined; }
	try {
		const url = new URL(value);
		if (!['https:', 'http:', 'file:'].includes(url.protocol)) { return undefined; }
		return { url: url.href, title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 4096) : url.hostname || url.href, folders: folders.map(folder => folder.slice(0, 256)).slice(0, 64) };
	} catch { return undefined; }
}

export function parseChromiumBookmarks(contents: string): IBrowserBookmarkImport {
	const data = JSON.parse(contents);
	if (!data?.roots || typeof data.roots !== 'object') { throw new Error('This file does not contain browser bookmarks.'); }
	const bookmarks: IBrowserBookmark[] = [];
	let skipped = 0;
	const visit = (node: { type?: unknown; name?: unknown; url?: unknown; children?: unknown }, folders: readonly string[]): void => {
		if (!node || folders.length > 64) { return; }
		if (node.type === 'url') {
			const bookmark = browserBookmark(node.url, node.name, folders);
			if (bookmark) { bookmarks.push(bookmark); } else { skipped++; }
			if (bookmarks.length > browserBookmarkLimit) { throw new Error('This import exceeds the 50,000 bookmark limit.'); }
		} else if (Array.isArray(node.children)) {
			const path = typeof node.name === 'string' && node.name.trim() ? [...folders, node.name.trim()] : folders;
			for (const child of node.children) { visit(child, path); }
		}
	};
	for (const root of Object.values(data.roots)) { visit(root as Parameters<typeof visit>[0], []); }
	return { bookmarks, skipped };
}

function decodeBookmarkText(value: string): string {
	const entities: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
	return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (entity, key: string) => {
		if (!key.startsWith('#')) { return entities[key.toLowerCase()] ?? entity; }
		const point = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
		return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity;
	});
}

/** Reads Netscape bookmark exports without creating a document or loading its resources. */
export function parseBrowserBookmarksHTML(contents: string): IBrowserBookmarkImport {
	if (!/<dl(?:\s|>)/i.test(contents)) { throw new Error('Choose a bookmarks HTML export from your browser.'); }
	const bookmarks: IBrowserBookmark[] = [];
	const folders: string[] = [];
	const levels: number[] = [];
	let pendingFolder: string | undefined;
	let capture: { tag: 'a' | 'h3'; title: string; url?: string } | undefined;
	let ignored: string | undefined;
	let skipped = 0;
	for (const match of contents.matchAll(/<!--[\s\S]*?-->|<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+/g)) {
		const token = match[0];
		if (token.startsWith('<!--')) { continue; }
		if (!token.startsWith('<')) { if (capture && !ignored) { capture.title += token; } continue; }
		const tag = /^<\s*(\/?)\s*([\w-]+)/.exec(token);
		if (!tag) { continue; }
		const closing = !!tag[1];
		const name = tag[2].toLowerCase();
		if (ignored) { if (closing && name === ignored) { ignored = undefined; } continue; }
		if (name === 'script' || name === 'style') { if (!closing) { ignored = name; } continue; }
		if (name === 'dl') {
			if (closing) { folders.length = levels.pop() ?? 0; }
			else {
				if (levels.length >= 64) { throw new Error('The bookmark folder structure is too deeply nested.'); }
				levels.push(folders.length);
				if (pendingFolder) { folders.push(pendingFolder); pendingFolder = undefined; }
			}
		} else if ((name === 'a' || name === 'h3') && !closing) {
			const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(token);
			capture = { tag: name, title: '', url: href ? decodeBookmarkText(href[1] ?? href[2] ?? href[3]) : undefined };
		} else if (capture && closing && name === capture.tag) {
			const title = decodeBookmarkText(capture.title).trim();
			if (name === 'h3') { pendingFolder = title; }
			else {
				const bookmark = browserBookmark(capture.url, title, folders.slice());
				if (bookmark) { bookmarks.push(bookmark); } else { skipped++; }
				if (bookmarks.length > browserBookmarkLimit) { throw new Error('This import exceeds the 50,000 bookmark limit.'); }
			}
			capture = undefined;
		}
	}
	return { bookmarks, skipped };
}
