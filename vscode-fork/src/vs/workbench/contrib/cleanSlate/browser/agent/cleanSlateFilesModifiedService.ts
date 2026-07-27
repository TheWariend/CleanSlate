/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CleanSlateDiffService } from '../core/cleanSlateDiffService.js';

export interface ICleanSlateFileChange {
    path: string;
    added?: number;
    deleted?: number;
    diff?: string;
    beforeContent?: string;
    afterContent?: string;
}

export interface ICleanSlateMutationFileEvidence {
    toolName?: string;
    paths: string[];
    fileChanges?: ICleanSlateFileChange[];
    appliedBlocks?: number;
    added?: number;
    deleted?: number;
    totalLinesChanged?: number;
    diagnosticsCount?: number;
    strategies?: string[];
    message?: string;
}

export interface ICleanSlateFilesModifiedPayload {
    status: 'completed';
    filesChanged: ICleanSlateFileChange[];
    added: number;
    deleted: number;
}

export interface ICleanSlateTimelineFileBlock {
    type?: string;
    path?: string;
    status?: string;
    added?: number;
    deleted?: number;
    diff?: string;
    beforeContent?: string;
    afterContent?: string;
    blocks?: ICleanSlateTimelineFileBlock[];
}

export interface ICleanSlatePendingDiffEntry {
    uri?: { fsPath?: string; path?: string };
    added?: number;
    deleted?: number;
    diff?: string;
    beforeContent?: string;
    afterContent?: string;
}

interface ICleanSlatePendingDiff {
    added: number;
    deleted: number;
    diff: string;
    beforeContent: string;
    afterContent: string;
}

export class CleanSlateFilesModifiedService {
    isMutationToolResult(toolName: string, toolInput: any, toolResult: any): boolean {
        if (toolResult?.success === false) {
            return false;
        }

        switch (toolName) {
            case 'apply_edit':
                return (typeof toolResult?.appliedBlocks === 'number' && toolResult.appliedBlocks > 0)
                    || this.hasStructuredFileChanges(toolResult);
            case 'multi_file_replace':
                return (Array.isArray(toolResult?.results) && toolResult.results.length > 0)
                    || this.hasStructuredFileChanges(toolResult);
            case 'create_multiple_files':
                return (Array.isArray(toolResult?.created) && toolResult.created.length > 0)
                    || this.hasStructuredFileChanges(toolResult);
            case 'write_file':
            case 'create_and_write_file':
                return toolResult?.persisted === true || toolResult?.created === true || this.hasStructuredFileChanges(toolResult);
            default:
                return false;
        }
    }

    buildMutationFileChanges(toolName: string, toolInput: any, toolResult: any): ICleanSlateFileChange[] {
        if (!this.isMutationToolResult(toolName, toolInput, toolResult)) {
            return [];
        }
        const mutation = this.buildMutationFileEvidence(toolName, toolInput, toolResult);
        return this.buildFileChanges(mutation.paths, [mutation]);
    }

    buildFileChanges(paths: Iterable<string>, mutations: Iterable<ICleanSlateMutationFileEvidence> = []): ICleanSlateFileChange[] {
        const changes = new Map<string, ICleanSlateFileChange>();
        for (const path of paths) {
            this.upsertPath(changes, path);
        }

        for (const mutation of mutations) {
            const mutationFileChanges = this.normalizeMutationFileChanges(mutation.fileChanges);
            if (mutationFileChanges.length > 0) {
                for (const path of mutation.paths) {
                    this.upsertPath(changes, path);
                }
                for (const change of mutationFileChanges) {
                    this.upsertFileChange(changes, change);
                }
                continue;
            }

            if (!this.hasConcreteMutationStats(mutation)) {
                continue;
            }

            for (const path of mutation.paths) {
                const change = this.upsertPath(changes, path);
                if (change && mutation.paths.length <= 1) {
                    change.added = (change.added || 0) + (mutation.added || 0);
                    change.deleted = (change.deleted || 0) + (mutation.deleted || 0);
                }
            }
        }

        return Array.from(changes.values()).map(change => this.normalizeFileChangeStats(change));
    }

    mergeFileChanges(existingChanges: Iterable<ICleanSlateFileChange>, nextChanges: Iterable<ICleanSlateFileChange>): ICleanSlateFileChange[] {
        const merged = new Map<string, ICleanSlateFileChange>();
        for (const change of existingChanges) {
            this.upsertFileChange(merged, change);
        }
        for (const change of nextChanges) {
            this.upsertFileChange(merged, change);
        }
        return Array.from(merged.values()).map(change => this.normalizeFileChangeStats(change));
    }

    buildFilesModifiedPayload(filesChanged: ICleanSlateFileChange[]): ICleanSlateFilesModifiedPayload {
        const normalizedFilesChanged = filesChanged
            .filter(change => this.isRenderableFilePath(change.path))
            .map(change => this.normalizeFileChangeStats(change));
        return {
            status: 'completed',
            filesChanged: normalizedFilesChanged,
            added: normalizedFilesChanged.reduce((total, change) => total + (change.added || 0), 0),
            deleted: normalizedFilesChanged.reduce((total, change) => total + (change.deleted || 0), 0)
        };
    }

    buildOptionalFilesModifiedPayload(filesChanged: ICleanSlateFileChange[]): ICleanSlateFilesModifiedPayload | undefined {
        const payload = this.buildFilesModifiedPayload(filesChanged);
        return payload.filesChanged.length > 0 ? payload : undefined;
    }

    buildFinishFileChanges(
        rawChanges: any[],
        timeline: ICleanSlateTimelineFileBlock[],
        pendingDiffEntries: Iterable<ICleanSlatePendingDiffEntry>,
        allowTimelineFallback: boolean,
        ledgerChanges: Iterable<ICleanSlateFileChange> = []
    ): ICleanSlateFileChange[] {
        const ledgerFileChanges = this.mergeFileChanges([], ledgerChanges);
        const pendingEntries = Array.from(pendingDiffEntries);
        const pendingDiffs = this.getPendingDiffsByPath(pendingEntries);
        const timelineChanges = new Map(
            this.collectChangedFilesFromTimeline(timeline).map(change => [this.normalizePath(change.path), change])
        );
        const fileChanges = rawChanges
            .map((change: any): ICleanSlateFileChange | undefined => {
                const path = typeof change?.path === 'string' ? change.path : '';
                if (!this.isRenderableFilePath(path)) {
                    return undefined;
                }
                const ledgerChange = this.findFileChangeForPath(ledgerFileChanges, path);
                const timelineChange = timelineChanges.get(this.normalizePath(path));
                const pendingDiff = this.findPendingDiffForPath(pendingDiffs, path);
                return {
                    path,
                    added: typeof change?.added === 'number' ? change.added : (typeof ledgerChange?.added === 'number' ? ledgerChange.added : (typeof timelineChange?.added === 'number' ? timelineChange.added : pendingDiff?.added)),
                    deleted: typeof change?.deleted === 'number' ? change.deleted : (typeof ledgerChange?.deleted === 'number' ? ledgerChange.deleted : (typeof timelineChange?.deleted === 'number' ? timelineChange.deleted : pendingDiff?.deleted)),
                    diff: this.firstUsableDiff(ledgerChange?.diff, pendingDiff?.diff, timelineChange?.diff),
                    beforeContent: this.firstUsableSnapshot(ledgerChange?.beforeContent, pendingDiff?.beforeContent, timelineChange?.beforeContent),
                    afterContent: this.firstUsableSnapshot(ledgerChange?.afterContent, pendingDiff?.afterContent, timelineChange?.afterContent)
                };
            })
            .filter((change: ICleanSlateFileChange | undefined): change is ICleanSlateFileChange => !!change);

        for (const change of ledgerFileChanges) {
            const normalizedPath = this.normalizePath(change.path);
            if (fileChanges.some(existing => this.normalizePath(existing.path) === normalizedPath)) {
                continue;
            }
            fileChanges.push(change);
        }

        if (allowTimelineFallback) {
            for (const change of timelineChanges.values()) {
                const normalizedPath = this.normalizePath(change.path);
                if (fileChanges.some(existing => this.normalizePath(existing.path) === normalizedPath)) {
                    continue;
                }
                const pendingDiff = this.findPendingDiffForPath(pendingDiffs, change.path);
                fileChanges.push({
                    path: change.path,
                    added: typeof change.added === 'number' ? change.added : pendingDiff?.added,
                    deleted: typeof change.deleted === 'number' ? change.deleted : pendingDiff?.deleted,
                    diff: this.firstUsableDiff(pendingDiff?.diff, change.diff),
                    beforeContent: this.firstUsableSnapshot(pendingDiff?.beforeContent, change.beforeContent),
                    afterContent: this.firstUsableSnapshot(pendingDiff?.afterContent, change.afterContent)
                });
            }

            for (const change of this.collectPendingDiffFileChanges(pendingEntries)) {
                const normalizedPath = this.normalizePath(change.path);
                if (fileChanges.some(existing => this.normalizePath(existing.path) === normalizedPath)) {
                    continue;
                }
                fileChanges.push(change);
            }
        }

        return this.mergeFileChanges([], fileChanges).map(change => this.normalizeFileChangeStats(change));
    }

    private upsertPath(changes: Map<string, ICleanSlateFileChange>, rawPath: string): ICleanSlateFileChange | undefined {
        const path = rawPath.trim();
        if (!this.isRenderableFilePath(path)) {
            return undefined;
        }
        const key = this.normalizePath(path);
        const existing = changes.get(key);
        if (existing) {
            return existing;
        }
        const change = { path };
        changes.set(key, change);
        return change;
    }

    private upsertFileChange(changes: Map<string, ICleanSlateFileChange>, change: ICleanSlateFileChange): void {
        if (!change || typeof change.path !== 'string' || !this.isRenderableFilePath(change.path)) {
            return;
        }
        const path = change.path.trim();
        const key = this.normalizePath(path);
        const previous = changes.get(key);
        changes.set(key, {
            path: previous?.path ?? path,
            added: this.mergeNumericStat(previous?.added, change.added),
            deleted: this.mergeNumericStat(previous?.deleted, change.deleted),
            diff: this.firstUsableDiff(change.diff, previous?.diff),
            beforeContent: this.firstUsableSnapshot(previous?.beforeContent, change.beforeContent),
            afterContent: this.firstUsableSnapshot(change.afterContent, previous?.afterContent)
        });
    }

    private buildMutationFileEvidence(toolName: string, toolInput: any, toolResult: any): ICleanSlateMutationFileEvidence {
        return {
            toolName,
            paths: this.collectMutationPaths(toolInput, toolResult),
            fileChanges: this.collectMutationFileChanges(toolInput, toolResult),
            appliedBlocks: this.firstNumericValue(toolResult?.appliedBlocks, toolResult?.totalAppliedBlocks, this.sumResultField(toolResult, 'appliedBlocks')),
            added: this.firstNumericValue(toolResult?.added, this.sumResultField(toolResult, 'added')),
            deleted: this.firstNumericValue(toolResult?.deleted, this.sumResultField(toolResult, 'deleted')),
            totalLinesChanged: this.firstNumericValue(toolResult?.totalLinesChanged, this.sumResultField(toolResult, 'totalLinesChanged')),
            diagnosticsCount: this.countEditDiagnostics(toolResult),
            strategies: this.collectStrategies(toolResult),
            message: typeof toolResult?.message === 'string' ? toolResult.message : undefined
        };
    }

    private collectMutationPaths(toolInput: any, toolResult: any): string[] {
        const paths: string[] = [];
        const addPath = (candidate: unknown) => {
            if (typeof candidate !== 'string') {
                return;
            }
            const path = candidate.trim();
            if (path.length === 0 || paths.includes(path)) {
                return;
            }
            paths.push(path);
        };

        addPath(toolResult?.path);
        addPath(toolInput?.file_path ?? toolInput?.path);

        for (const path of Array.isArray(toolResult?.affectedFiles) ? toolResult.affectedFiles : []) {
            addPath(path);
        }
        for (const path of Array.isArray(toolResult?.created) ? toolResult.created : []) {
            addPath(path);
        }
        for (const file of Array.isArray(toolResult?.fileChanges) ? toolResult.fileChanges : []) {
            addPath(file?.path);
        }
        for (const file of Array.isArray(toolResult?.results) ? toolResult.results : []) {
            addPath(file?.path);
        }
        for (const file of Array.isArray(toolInput?.files) ? toolInput.files : []) {
            addPath(file?.path);
        }
        for (const editGroup of Array.isArray(toolInput?.edits) ? toolInput.edits : []) {
            addPath(editGroup?.path);
        }

        return paths;
    }

    private collectMutationFileChanges(toolInput: any, toolResult: any): ICleanSlateFileChange[] {
        const changes: ICleanSlateFileChange[] = [];
        const addChange = (candidate: any, fallbackPath?: unknown): void => {
            if (candidate?.success === false) {
                return;
            }
            const path = typeof candidate?.path === 'string'
                ? candidate.path
                : typeof fallbackPath === 'string'
                    ? fallbackPath
                    : '';
            if (!this.isRenderableFilePath(path)) {
                return;
            }
            changes.push(this.normalizeFileChangeStats({
                path: path.trim(),
                added: typeof candidate?.added === 'number' ? candidate.added : undefined,
                deleted: typeof candidate?.deleted === 'number' ? candidate.deleted : undefined,
                diff: this.cleanDiffText(candidate?.diff),
                beforeContent: this.cleanSnapshotText(candidate?.beforeContent),
                afterContent: this.cleanSnapshotText(candidate?.afterContent)
            }));
        };

        let addedResultEntry = false;
        if (Array.isArray(toolResult?.fileChanges)) {
            for (const entry of toolResult.fileChanges) {
                addChange(entry);
                addedResultEntry = true;
            }
        }

        if (Array.isArray(toolResult?.results)) {
            for (const entry of toolResult.results) {
                addChange(entry);
                addedResultEntry = true;
            }
        }

        if (!addedResultEntry) {
            addChange(toolResult, toolResult?.path ?? toolInput?.file_path ?? toolInput?.path);
        }
        return this.mergeFileChanges([], changes);
    }

    private firstNumericValue(...values: Array<number | undefined>): number | undefined {
        return values.find((value): value is number => typeof value === 'number' && Number.isFinite(value));
    }

    private sumResultField(result: any, field: string): number | undefined {
        if (!Array.isArray(result?.results)) {
            return undefined;
        }
        let sum = 0;
        let found = false;
        for (const entry of result.results) {
            const value = entry?.[field];
            if (typeof value === 'number' && Number.isFinite(value)) {
                sum += value;
                found = true;
            }
        }
        return found ? sum : undefined;
    }

    private countEditDiagnostics(result: any): number {
        const ownDiagnostics = Array.isArray(result?.diagnostics) ? result.diagnostics.length : 0;
        const resultDiagnostics = Array.isArray(result?.results)
            ? result.results.reduce((sum: number, entry: any) => sum + (Array.isArray(entry?.diagnostics) ? entry.diagnostics.length : 0), 0)
            : 0;
        return ownDiagnostics + resultDiagnostics;
    }

    private collectStrategies(result: any): string[] {
        const strategies = new Set<string>();
        const addStrategy = (candidate: unknown) => {
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
                strategies.add(candidate.trim());
            }
        };
        addStrategy(result?.strategy);
        addStrategy(result?.editStrategy);
        for (const entry of Array.isArray(result?.results) ? result.results : []) {
            addStrategy(entry?.strategy);
            addStrategy(entry?.editStrategy);
        }
        return Array.from(strategies);
    }

    private mergeNumericStat(previous: number | undefined, next: number | undefined): number | undefined {
        if (typeof previous !== 'number') {
            return next;
        }
        if (typeof next !== 'number') {
            return previous;
        }
        return previous + next;
    }

    private normalizeMutationFileChanges(fileChanges: ICleanSlateFileChange[] | undefined): ICleanSlateFileChange[] {
        if (!Array.isArray(fileChanges)) {
            return [];
        }
        return fileChanges
            .filter((change): change is ICleanSlateFileChange => !!change && typeof change.path === 'string' && this.isRenderableFilePath(change.path))
            .map(change => this.normalizeFileChangeStats({
                ...change,
                beforeContent: this.cleanSnapshotText(change.beforeContent),
                afterContent: this.cleanSnapshotText(change.afterContent)
            }));
    }

    private hasConcreteMutationStats(mutation: ICleanSlateMutationFileEvidence): boolean {
        return (typeof mutation.added === 'number' && mutation.added > 0)
            || (typeof mutation.deleted === 'number' && mutation.deleted > 0)
            || (typeof mutation.appliedBlocks === 'number' && mutation.appliedBlocks > 0)
            || (typeof mutation.totalLinesChanged === 'number' && mutation.totalLinesChanged > 0);
    }

    private normalizeFileChangeStats(change: ICleanSlateFileChange): ICleanSlateFileChange {
        const withDiff = this.ensureUnifiedDiff(change);
        const netStats = this.computeNetLineStats(withDiff.beforeContent, withDiff.afterContent);
        if (netStats) {
            return {
                ...withDiff,
                added: netStats.added,
                deleted: netStats.deleted
            };
        }
        return withDiff;
    }

    /**
     * Guarantee a compact unified diff on the change while the full before/after
     * snapshots are still in hand. This is what the transcript renders from once
     * oversized snapshots are dropped downstream, so a file change never loses
     * its diff to persistence or size limits.
     */
    private ensureUnifiedDiff(change: ICleanSlateFileChange): ICleanSlateFileChange {
        if (typeof change.diff === 'string' && change.diff.trim().length > 0) {
            return change;
        }
        if (typeof change.beforeContent !== 'string' || typeof change.afterContent !== 'string') {
            return change;
        }
        const diff = CleanSlateDiffService.computeUnifiedDiffFromContents(change.path || 'change', change.beforeContent, change.afterContent);
        return diff ? { ...change, diff } : change;
    }

    private computeNetLineStats(beforeContent: string | undefined, afterContent: string | undefined): { added: number; deleted: number } | undefined {
        if (typeof beforeContent !== 'string' || typeof afterContent !== 'string') {
            return undefined;
        }

        const beforeLines = this.splitComparableLines(beforeContent);
        const afterLines = this.splitComparableLines(afterContent);
        const cellCount = beforeLines.length * afterLines.length;
        if (cellCount > 1_500_000) {
            return undefined;
        }

        const lcsLength = this.computeLcsLength(beforeLines, afterLines);
        return {
            added: Math.max(0, afterLines.length - lcsLength),
            deleted: Math.max(0, beforeLines.length - lcsLength)
        };
    }

    private splitComparableLines(content: string): string[] {
        const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        if (normalized.length === 0) {
            return [];
        }
        return normalized.endsWith('\n')
            ? normalized.slice(0, -1).split('\n')
            : normalized.split('\n');
    }

    private computeLcsLength(beforeLines: string[], afterLines: string[]): number {
        if (beforeLines.length === 0 || afterLines.length === 0) {
            return 0;
        }

        let previous = new Array(afterLines.length + 1).fill(0);
        let current = new Array(afterLines.length + 1).fill(0);
        for (let beforeIndex = 1; beforeIndex <= beforeLines.length; beforeIndex++) {
            for (let afterIndex = 1; afterIndex <= afterLines.length; afterIndex++) {
                current[afterIndex] = beforeLines[beforeIndex - 1] === afterLines[afterIndex - 1]
                    ? previous[afterIndex - 1] + 1
                    : Math.max(previous[afterIndex], current[afterIndex - 1]);
            }
            const swap = previous;
            previous = current;
            current = swap;
            current.fill(0);
        }
        return previous[afterLines.length];
    }

    private collectChangedFilesFromTimeline(timeline: ICleanSlateTimelineFileBlock[]): ICleanSlateFileChange[] {
        const changed = new Map<string, ICleanSlateFileChange>();
        const visit = (blocks: ICleanSlateTimelineFileBlock[]): void => {
            for (const block of blocks) {
                if (Array.isArray(block.blocks)) {
                    visit(block.blocks);
                    continue;
                }

                if (block.type !== 'file' || typeof block.path !== 'string' || !this.isRenderableFilePath(block.path)) {
                    continue;
                }

                const status = typeof block.status === 'string' ? block.status : '';
                if (!/^(Created|Modified|Edited|Creating|Modifying|Editing)$/i.test(status)) {
                    continue;
                }

                const path = block.path.trim();
                const normalizedPath = this.normalizePath(path);
                const previous = changed.get(normalizedPath);
                changed.set(normalizedPath, {
                    path: previous?.path ?? path,
                    added: (typeof previous?.added === 'number' ? previous.added : 0) + (typeof block.added === 'number' ? block.added : 0),
                    deleted: (typeof previous?.deleted === 'number' ? previous.deleted : 0) + (typeof block.deleted === 'number' ? block.deleted : 0),
                    diff: this.firstUsableDiff(block.diff, previous?.diff),
                    beforeContent: this.firstUsableSnapshot(previous?.beforeContent, block.beforeContent),
                    afterContent: this.firstUsableSnapshot(block.afterContent, previous?.afterContent)
                });
            }
        };

        visit(timeline);
        return Array.from(changed.values());
    }

    private getPendingDiffsByPath(entries: Iterable<ICleanSlatePendingDiffEntry>): Map<string, ICleanSlatePendingDiff> {
        const diffsByPath = new Map<string, ICleanSlatePendingDiff>();
        for (const entry of entries) {
            const fsPath = entry.uri?.fsPath || entry.uri?.path;
            if (!fsPath || !this.isRenderableFilePath(fsPath)) {
                continue;
            }
            const value = {
                added: entry.added || 0,
                deleted: entry.deleted || 0,
                diff: this.cleanDiffText(entry.diff) || '',
                beforeContent: this.cleanSnapshotText(entry.beforeContent) || '',
                afterContent: this.cleanSnapshotText(entry.afterContent) || ''
            };
            diffsByPath.set(this.normalizePath(fsPath), value);
            if (entry.uri?.path) {
                diffsByPath.set(this.normalizePath(entry.uri.path), value);
            }
        }
        return diffsByPath;
    }

    private collectPendingDiffFileChanges(entries: ICleanSlatePendingDiffEntry[]): ICleanSlateFileChange[] {
        const changes = new Map<string, ICleanSlateFileChange>();
        for (const entry of entries) {
            const path = entry.uri?.fsPath || entry.uri?.path;
            if (!path || !this.isRenderableFilePath(path)) {
                continue;
            }
            changes.set(this.normalizePath(path), {
                path,
                added: entry.added || 0,
                deleted: entry.deleted || 0,
                diff: this.cleanDiffText(entry.diff),
                beforeContent: this.cleanSnapshotText(entry.beforeContent),
                afterContent: this.cleanSnapshotText(entry.afterContent)
            });
        }
        return Array.from(changes.values());
    }

    private findPendingDiffForPath(diffsByPath: Map<string, ICleanSlatePendingDiff>, path: string): ICleanSlatePendingDiff | undefined {
        const normalizedPath = this.normalizePath(path);
        if (!normalizedPath) {
            return undefined;
        }
        return diffsByPath.get(normalizedPath)
            ?? Array.from(diffsByPath.entries()).find(([candidate]) => candidate.endsWith(normalizedPath) || normalizedPath.endsWith(candidate))?.[1];
    }

    private findFileChangeForPath(changes: ICleanSlateFileChange[], path: string): ICleanSlateFileChange | undefined {
        const normalizedPath = this.normalizePath(path);
        if (!normalizedPath) {
            return undefined;
        }
        return changes.find(change => {
            const candidate = this.normalizePath(change.path);
            return candidate === normalizedPath || candidate.endsWith(normalizedPath) || normalizedPath.endsWith(candidate);
        });
    }

    private hasStructuredFileChanges(result: any): boolean {
        return Array.isArray(result?.fileChanges)
            && result.fileChanges.some((change: any) => typeof change?.path === 'string' && this.isRenderableFilePath(change.path));
    }

    private firstUsableSnapshot(...candidates: unknown[]): string | undefined {
        for (const candidate of candidates) {
            const snapshot = this.cleanSnapshotText(candidate);
            if (typeof snapshot === 'string') {
                return snapshot;
            }
        }
        return undefined;
    }

    private firstUsableDiff(...candidates: unknown[]): string | undefined {
        for (const candidate of candidates) {
            const diff = this.cleanDiffText(candidate);
            if (typeof diff === 'string') {
                return diff;
            }
        }
        return undefined;
    }

    private cleanDiffText(value: unknown): string | undefined {
        const diff = this.cleanSnapshotText(value);
        return typeof diff === 'string' && diff.trim().length > 0 ? diff : undefined;
    }

    private cleanSnapshotText(value: unknown): string | undefined {
        if (typeof value !== 'string') {
            return undefined;
        }
        return this.isTruncatedSnapshotText(value) ? undefined : value;
    }

    private isTruncatedSnapshotText(value: string): boolean {
        return /\n?\.{3}\[truncated \d+ chars\]\s*$/.test(value)
            || /\n?\.{3} \[truncated\]\s*$/.test(value)
            || /\n?\[truncated\]\s*$/.test(value);
    }

    private normalizePath(path: string | undefined): string {
        return (path || '').replace(/\\/g, '/').toLowerCase();
    }

    private isRenderableFilePath(path: string | undefined): boolean {
        const trimmed = (path || '').trim();
        if (!trimmed || trimmed.endsWith('/') || trimmed.endsWith('\\')) {
            return false;
        }

        const normalized = trimmed.replace(/\\/g, '/');
        if (this.hasUnsupportedUriScheme(normalized)) {
            return false;
        }
        const basename = normalized.split('/').pop() || '';
        if (!basename || basename === '.' || basename === '..') {
            return false;
        }

        return true;
    }

    private hasUnsupportedUriScheme(path: string): boolean {
        const colonIndex = path.indexOf(':');
        if (colonIndex <= 1) {
            return false;
        }

        const firstSlashIndex = path.indexOf('/');
        if (firstSlashIndex !== -1 && firstSlashIndex < colonIndex) {
            return false;
        }

        const scheme = path.slice(0, colonIndex);
        if (!this.isUriScheme(scheme)) {
            return false;
        }

        return scheme.toLowerCase() !== 'file';
    }

    private isUriScheme(value: string): boolean {
        if (!value) {
            return false;
        }

        for (let index = 0; index < value.length; index++) {
            const code = value.charCodeAt(index);
            const isLetter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
            const isDigit = code >= 48 && code <= 57;
            const isAllowedPunctuation = code === 43 || code === 45 || code === 46;
            if (index === 0 && !isLetter) {
                return false;
            }
            if (!isLetter && !isDigit && !isAllowedPunctuation) {
                return false;
            }
        }

        return true;
    }
}
