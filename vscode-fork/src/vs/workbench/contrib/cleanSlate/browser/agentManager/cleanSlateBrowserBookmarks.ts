/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { browserBookmark, browserBookmarkLimit, IBrowserBookmark, IBrowserBookmarkImport } from '../../../../../platform/native/common/browserIntegration.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';

export const cleanSlateBrowserBookmarksKey = 'cleanSlate.browser.bookmarks';

export function readCleanSlateBrowserBookmarks(storage: IStorageService): IBrowserBookmark[] {
	try {
		const data: unknown = JSON.parse(storage.get(cleanSlateBrowserBookmarksKey, StorageScope.PROFILE, '[]'));
		if (!Array.isArray(data)) { return []; }
		return data.slice(0, browserBookmarkLimit).flatMap(item => {
			const bookmark = browserBookmark(item?.url, item?.title, Array.isArray(item?.folders) ? item.folders.filter((folder: unknown): folder is string => typeof folder === 'string') : []);
			const favicon = typeof item?.favicon === 'string' && item.favicon.startsWith('data:image/') && item.favicon.length <= 256_000 ? item.favicon : undefined;
			return bookmark ? [{ ...bookmark, ...(favicon ? { favicon } : {}) }] : [];
		});
	} catch { return []; }
}

export function importCleanSlateBrowserBookmarks(storage: IStorageService, imported: IBrowserBookmarkImport, folder: string): { added: number; duplicates: number; skipped: number } {
	const bookmarks = readCleanSlateBrowserBookmarks(storage);
	const urls = new Set(bookmarks.map(bookmark => bookmark.url));
	let added = 0;
	let duplicates = 0;
	for (const bookmark of imported.bookmarks) {
		if (urls.has(bookmark.url)) { duplicates++; continue; }
		if (bookmarks.length >= browserBookmarkLimit) { throw new Error('The bookmark library is full. Remove bookmarks before importing more.'); }
		urls.add(bookmark.url);
		bookmarks.push({ ...bookmark, folders: [folder, ...bookmark.folders] });
		added++;
	}
	if (added) { storage.store(cleanSlateBrowserBookmarksKey, JSON.stringify(bookmarks), StorageScope.PROFILE, StorageTarget.MACHINE); }
	return { added, duplicates, skipped: imported.skipped };
}
