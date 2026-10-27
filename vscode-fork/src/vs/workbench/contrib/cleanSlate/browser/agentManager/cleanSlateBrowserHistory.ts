/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IBrowserHistoryEntry } from '../../../../../platform/native/common/browserIntegration.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { cleanSlateBrowserHistoryKey, readCleanSlateBrowserHistory } from './cleanSlateBrowserData.js';

/** Keep visits cheap even when the profile contains a large imported history. */
export class CleanSlateBrowserHistory extends Disposable {

	private pages: IBrowserHistoryEntry[];
	private index: Map<string, IBrowserHistoryEntry>;
	private readonly pending = new Map<string, IBrowserHistoryEntry | null>();
	private readonly serialized = new WeakMap<IBrowserHistoryEntry, string>();
	private writing = false;
	private generation = 0;
	private saving = false;
	private disposed = false;
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChange = this.changed.event;
	private readonly save = this._register(new RunOnceScheduler(() => { void this.persist(); }, 750));

	constructor(private readonly storage: IStorageService, private readonly serialize?: (base: string, changes: [string, IBrowserHistoryEntry | null][]) => Promise<string>) {
		super();
		this.pages = readCleanSlateBrowserHistory(storage);
		this.index = new Map(this.pages.map(page => [page.url, page]));
		this._register(storage.onDidChangeValue(StorageScope.PROFILE, cleanSlateBrowserHistoryKey, this._store)(() => {
			if (this.writing) { return; }
			this.generation++;
			this.pages = readCleanSlateBrowserHistory(storage);
			this.index = new Map(this.pages.map(page => [page.url, page]));
			for (const [url, page] of this.pending) {
				if (page) { this.index.set(url, page); }
				else { this.index.delete(url); }
			}
			this.changed.fire();
		}));
		this._register(storage.onWillSaveState(() => this.flush()));
	}

	get size(): number { return Math.min(this.index.size, 50_000); }

	*entries(): IterableIterator<IBrowserHistoryEntry> {
		let count = 0;
		for (const page of Array.from(this.pending.values()).reverse()) {
			if (page) {
				if (count++ === 50_000) { return; }
				yield page;
			}
		}
		for (const page of this.pages) {
			if (!this.pending.has(page.url)) {
				if (count++ === 50_000) { return; }
				yield page;
			}
		}
	}

	record(url: string, title: string, now = Date.now()): void {
		if (!/^https?:\/\//i.test(url)) { return; }
		const existing = this.index.get(url);
		if (existing && existing.title === (title || existing.title) && now - existing.lastVisit < 60_000) { return; }
		const page = { url, title: title || existing?.title || url, lastVisit: now, visits: existing ? existing.visits + (now - existing.lastVisit >= 60_000 ? 1 : 0) : 1 };
		this.index.set(url, page);
		this.pending.delete(url);
		this.pending.set(url, page);
		this.scheduleSave();
	}

	remove(url: string): void {
		if (!this.index.delete(url)) { return; }
		this.pending.set(url, null);
		this.scheduleSave();
	}

	private scheduleSave(): void {
		this.generation++;
		// Do not keep pushing the deadline out on pages with a constantly changing title.
		if (!this.save.isScheduled()) { this.save.schedule(); }
		this.changed.fire();
	}

	private async persist(): Promise<void> {
		if (!this.pending.size || this.saving || this.disposed) { return; }
		if (!this.serialize) { this.flush(); return; }
		this.saving = true;
		const generation = this.generation;
		const base = this.storage.get(cleanSlateBrowserHistoryKey, StorageScope.PROFILE, '[]');
		try {
			// Only the small set of edits crosses to the worker, along with the stored string.
			const json = await this.serialize(base, Array.from(this.pending));
			if (generation === this.generation && !this.disposed && base === this.storage.get(cleanSlateBrowserHistoryKey, StorageScope.PROFILE, '[]')) {
				this.commit(json, Array.from(this.entries()));
			}
		} catch {
			// Preserve history if worker startup fails; shutdown uses the same synchronous fallback.
			if (!this.disposed) { this.flush(); }
		} finally {
			this.saving = false;
			if (this.pending.size && !this.disposed && !this.save.isScheduled()) { this.save.schedule(); }
		}
	}

	flush(): void {
		this.generation++;
		this.save.cancel();
		if (!this.pending.size) { return; }
		const pages = Array.from(this.entries());
		// Serialize each immutable entry once. A title update must not stringify 50,000 objects.
		const json = `[${pages.map(page => {
			let value = this.serialized.get(page);
			if (value === undefined) { value = JSON.stringify(page); this.serialized.set(page, value); }
			return value;
		}).join(',')}]`;
		this.commit(json, pages);
	}

	private commit(json: string, pages: IBrowserHistoryEntry[]): void {
		this.writing = true;
		try {
			this.storage.store(cleanSlateBrowserHistoryKey, json, StorageScope.PROFILE, StorageTarget.MACHINE);
			this.pages = pages;
			this.index = new Map(pages.map(page => [page.url, page]));
			this.pending.clear();
		} finally { this.writing = false; }
	}

	override dispose(): void {
		this.disposed = true;
		this.flush();
		super.dispose();
	}
}
