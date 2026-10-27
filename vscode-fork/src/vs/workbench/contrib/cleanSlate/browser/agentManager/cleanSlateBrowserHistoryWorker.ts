/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWebWorkerServerRequestHandler } from '../../../../../base/common/worker/webWorker.js';
import { bootstrapWebWorker } from '../../../../../base/common/worker/webWorkerBootstrap.js';
import { IBrowserHistoryEntry } from '../../../../../platform/native/common/browserIntegration.js';
import { parseCleanSlateBrowserHistory } from './cleanSlateBrowserData.js';

export interface ICleanSlateBrowserHistoryWorker {
	$serialize(base: string, changes: [string, IBrowserHistoryEntry | null][]): string;
}

class CleanSlateBrowserHistoryWorker implements ICleanSlateBrowserHistoryWorker, IWebWorkerServerRequestHandler {
	_requestHandlerBrand: void = undefined;
	private json: string | undefined;
	private pages: IBrowserHistoryEntry[] = [];

	$serialize(base: string, changes: [string, IBrowserHistoryEntry | null][]): string {
		if (base !== this.json) { this.pages = parseCleanSlateBrowserHistory(base); }
		const pending = new Map(changes);
		const pages = changes.reverse().flatMap(([, page]) => page ? [page] : []);
		for (const page of this.pages) {
			if (pages.length >= 50_000) { break; }
			if (!pending.has(page.url)) { pages.push(page); }
		}
		this.pages = pages.slice(0, 50_000);
		return this.json = JSON.stringify(this.pages);
	}
}

bootstrapWebWorker(() => new CleanSlateBrowserHistoryWorker());
