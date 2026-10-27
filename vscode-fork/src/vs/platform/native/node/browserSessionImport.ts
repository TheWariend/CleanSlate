/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { browserBookmark, IBrowserImportedTab } from '../common/browserIntegration.js';

/** Reads unencrypted SNSS session commands, restoring only page addresses and titles. */
export function parseChromiumSession(data: Buffer): IBrowserImportedTab[] {
	if (data.length < 8 || data.toString('ascii', 0, 4) !== 'SNSS') { throw new Error('Invalid browser tab session.'); }
	const version = data.readInt32LE(4);
	if (version !== 1 && version !== 3) { throw new Error('This browser tab session is encrypted or unsupported.'); }
	const tabs = new Map<number, { window?: number; index: number; selected?: number; pinned: boolean; navigations: Map<number, { url: string; title: string }> }>();
	const tab = (id: number) => {
		let value = tabs.get(id);
		if (!value) { value = { index: tabs.size, pinned: false, navigations: new Map() }; tabs.set(id, value); }
		return value;
	};
	let commands = 0;
	for (let offset = 8; offset < data.length;) {
		if (++commands > 1_000_000 || offset + 2 > data.length) { throw new Error('The tab session is incomplete or too large.'); }
		const size = data.readUInt16LE(offset); offset += 2;
		if (!size || offset + size > data.length) { throw new Error('The tab session is incomplete.'); }
		const command = data[offset]; const payload = data.subarray(offset + 1, offset + size); offset += size;
		if (command === 255 || payload.length < 4) { continue; }
		const id = payload.readInt32LE(0);
		if (command === 0 && payload.length >= 8) { tab(payload.readInt32LE(4)).window = id; }
		else if (command === 2 && payload.length >= 8) { tab(id).index = payload.readInt32LE(4); }
		else if (command === 7 && payload.length >= 8) { tab(id).selected = payload.readInt32LE(4); }
		else if (command === 12 && payload.length >= 5) { tab(id).pinned = !!payload[4]; }
		else if (command === 16) { tabs.delete(id); }
		else if (command === 17) { for (const [key, value] of tabs) { if (value.window === id) { tabs.delete(key); } } }
		else if (command === 6 && payload.length >= 16) {
			// Pickle header, tab ID, navigation index, URL, then UTF-16 title.
			let cursor = 12;
			const string = (utf16 = false) => {
				if (cursor + 4 > payload.length) { throw new Error('Invalid tab navigation.'); }
				const length = payload.readInt32LE(cursor) * (utf16 ? 2 : 1); cursor += 4;
				if (length < 0 || cursor + length > payload.length) { throw new Error('Invalid tab navigation.'); }
				const value = payload.toString(utf16 ? 'utf16le' : 'utf8', cursor, cursor + length);
				cursor += (length + 3) & ~3; return value;
			};
			const url = string(); const title = string(true);
			const page = browserBookmark(url, title);
			const value = tab(payload.readInt32LE(4)); const index = payload.readInt32LE(8);
			if (page) { value.navigations.set(index, page); } else { value.navigations.delete(index); }
		}
		else if (command === 24 && payload.length >= 12) {
			const value = tab(id); const start = payload.readInt32LE(4); const count = payload.readInt32LE(8);
			if (count > 0) { value.navigations = new Map(Array.from(value.navigations).flatMap(([index, page]) => index < start ? [[index, page] as const] : index >= start + count ? [[index - count, page] as const] : [])); }
		}
		if (tabs.size > 10_000) { throw new Error('This session exceeds the 10,000 tab limit.'); }
	}
	return Array.from(tabs.values()).filter(tab => tab.window !== undefined).sort((a, b) => a.window! - b.window! || a.index - b.index).flatMap(tab => {
		const page = tab.selected === undefined ? Array.from(tab.navigations).sort((a, b) => b[0] - a[0])[0]?.[1] : tab.navigations.get(tab.selected);
		return page ? [{ url: page.url, title: page.title, pinned: tab.pinned }] : [];
	});
}
