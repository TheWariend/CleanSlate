/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../../base/common/uri.js';
import type { ICleanSlateFileChange } from '@cleanslate/sdk/agent/cleanSlateFilesModifiedService.js';

export interface ICleanSlateLedgerRecord extends ICleanSlateFileChange {
	uri: URI;
	toolName: string;
	turnId?: string;
	updatedAt: number;
}

export class CleanSlateFileChangeLedger {
	private readonly records = new Map<string, ICleanSlateLedgerRecord>();

	clear(): void {
		this.records.clear();
	}

	recordMutationResult(toolName: string, result: any, canonicalizePath: (path: string | undefined) => string, turnId?: string): void {
		for (const entry of this.extractMutationEntries(toolName, result)) {
			this.recordEntry(toolName, entry, canonicalizePath, turnId);
		}
	}

	getChanges(): ICleanSlateFileChange[] {
		return Array.from(this.records.values()).map(record => ({
			path: record.path,
			diff: record.diff,
			beforeContent: record.beforeContent,
			afterContent: record.afterContent
		}));
	}

	private recordEntry(toolName: string, entry: any, canonicalizePath: (path: string | undefined) => string, turnId?: string): void {
		const canonicalPath = canonicalizePath(typeof entry?.path === 'string' ? entry.path : undefined);
		if (!canonicalPath || typeof entry?.beforeContent !== 'string' || typeof entry?.afterContent !== 'string') {
			return;
		}

		const uri = URI.file(canonicalPath);
		const key = uri.toString().toLowerCase();
		const previous = this.records.get(key);
		this.records.set(key, {
			uri,
			path: canonicalPath,
			toolName,
			turnId,
			updatedAt: Date.now(),
			diff: typeof entry.diff === 'string' ? entry.diff : previous?.diff,
			beforeContent: previous?.beforeContent ?? entry.beforeContent,
			afterContent: entry.afterContent
		});
	}

	private extractMutationEntries(toolName: string, result: any): any[] {
		if (!result || result.success === false) {
			return [];
		}

		if (Array.isArray(result.fileChanges)) {
			return result.fileChanges;
		}

		if ((toolName === 'multi_file_replace' || toolName === 'create_multiple_files') && Array.isArray(result.results)) {
			return result.results;
		}

		if (typeof result.path === 'string') {
			return [result];
		}

		return [];
	}
}
