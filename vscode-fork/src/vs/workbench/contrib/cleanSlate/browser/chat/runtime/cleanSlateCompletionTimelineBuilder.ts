/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { ICleanSlateEditCodeService } from '../../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { CleanSlateFilesModifiedService } from '@cleanslate/sdk/agent/cleanSlateFilesModifiedService.js';
import { InteractionBlock } from '../types/cleanSlateChatTypes.js';
import { CleanSlateFileChangeLedger } from './cleanSlateFileChangeLedger.js';

/** Builds canonical completion/file timeline state from execution evidence. */
export class CleanSlateCompletionTimelineBuilder {
    constructor(
        private readonly workspaceContextService: IWorkspaceContextService,
        private readonly editCodeService: ICleanSlateEditCodeService,
        private readonly filesModifiedService: CleanSlateFilesModifiedService,
        private readonly fileChangeLedger: CleanSlateFileChangeLedger
    ) { }

    public normalizeFileTimelinePath(path: string | undefined): string {
        return this.normalizePathSeparators(path || '').toLowerCase();
    }

    public canonicalWorkspaceFilePath(path: string | undefined): string {
        const normalized = this.normalizePathSeparators((path || '').trim());
        if (!normalized) {
            return '';
        }

        if (normalized.startsWith('/') || this.isWindowsAbsolutePath(normalized)) {
            return normalized;
        }

        const relativePath = this.stripLeadingDotSlash(normalized);
        const workspaceFolder = this.workspaceContextService.getWorkspace().folders[0];
        const workspacePath = workspaceFolder?.uri.fsPath ? this.normalizePathSeparators(workspaceFolder.uri.fsPath) : undefined;
        if (!workspacePath) {
            return relativePath;
        }

        return `${this.stripTrailingSlash(workspacePath)}/${this.stripLeadingSlash(relativePath)}`;
    }

    public normalizePathSeparators(value: string): string {
        return value.split('\\').join('/');
    }

    private isWindowsAbsolutePath(value: string): boolean {
        if (value.length < 3 || value[1] !== ':' || value[2] !== '/') {
            return false;
        }
        const code = value.charCodeAt(0);
        return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    }

    private stripLeadingDotSlash(value: string): string {
        return value.startsWith('./') ? value.slice(2) : value;
    }

    private stripLeadingSlash(value: string): string {
        let index = 0;
        while (index < value.length && value[index] === '/') {
            index++;
        }
        return value.slice(index);
    }

    private stripTrailingSlash(value: string): string {
        let end = value.length;
        while (end > 0 && value[end - 1] === '/') {
            end--;
        }
        return value.slice(0, end);
    }

    public canonicalizeFileChange(change: any): any {
        if (!change || typeof change !== 'object') {
            return change;
        }
        const canonicalPath = this.canonicalWorkspaceFilePath(change.path);
        return canonicalPath ? { ...change, path: canonicalPath } : change;
    }

    public canonicalizeTimelineFilePaths(blocks: InteractionBlock[]): InteractionBlock[] {
        return blocks.map(block => {
            const next: InteractionBlock = { ...block };
            if (typeof next.path === 'string') {
                next.path = this.canonicalWorkspaceFilePath(next.path);
            }
            if (Array.isArray(next.fileChanges)) {
                next.fileChanges = next.fileChanges.map(change => this.canonicalizeFileChange(change));
            }
            if (Array.isArray(next.blocks)) {
                next.blocks = this.canonicalizeTimelineFilePaths(next.blocks);
            }
            return next;
        });
    }

    public upsertFinishTaskSummaryBlock(timeline: InteractionBlock[], turnId: string | undefined, result: any, forceRoot = false, hideSummary = false, allowTimelineFileFallback = false): boolean {
        const finishBlock = this.buildFinishTaskBlock(timeline, result, allowTimelineFileFallback);
        if (!finishBlock) {
            return false;
        }
        const content = hideSummary ? undefined : finishBlock.content;
        const fileChanges = finishBlock.fileChanges;
        if (!content && (!fileChanges || fileChanges.length === 0)) {
            return false;
        }
        const targetTimeline = timeline;
        const id = forceRoot ? 'finish-task-summary-final' : (turnId ? `finish-task-summary-${turnId}` : 'finish-task-summary');
        let block = targetTimeline.find(entry => entry.id === id);

        if (!block) {
            block = {
                id,
                type: 'finish',
                content,
                status: finishBlock.status,
                fileChanges,
                isStreaming: false
            };
            targetTimeline.push(block);
            return true;
        }

        block.type = 'finish';
        block.summaryRole = undefined;
        block.content = content;
        block.status = finishBlock.status;
        block.fileChanges = fileChanges;
        block.isStreaming = false;
        return true;
    }

    public removeSummaryBlocksWithContent(timeline: InteractionBlock[], content: string | undefined): void {
        const normalizedContent = this.normalizeSummaryContent(content || '');
        if (!normalizedContent) {
            return;
        }

        const prune = (blocks: InteractionBlock[]): void => {
            for (let index = blocks.length - 1; index >= 0; index--) {
                const block = blocks[index];
                if (block.type === 'summary' && typeof block.content === 'string' && this.normalizeSummaryContent(block.content) === normalizedContent) {
                    blocks.splice(index, 1);
                    continue;
                }
                if (block.type === 'turn' && Array.isArray(block.blocks)) {
                    prune(block.blocks);
                }
            }
        };

        prune(timeline);
    }

    public hasSummaryBlockWithContent(timeline: InteractionBlock[], content: string): boolean {
        const normalizedContent = this.normalizeSummaryContent(content);
        if (!normalizedContent) {
            return false;
        }

        const visit = (blocks: InteractionBlock[]): boolean => {
            for (const block of blocks) {
                if (block.type === 'summary' && typeof block.content === 'string' && this.normalizeSummaryContent(block.content) === normalizedContent) {
                    return true;
                }
                if (block.type === 'turn' && Array.isArray(block.blocks) && visit(block.blocks)) {
                    return true;
                }
            }
            return false;
        };

        return visit(timeline);
    }

    public normalizeSummaryContent(value: string): string {
        let normalized = '';
        let pendingSpace = false;
        for (const char of value) {
            if (char.trim().length === 0) {
                pendingSpace = normalized.length > 0;
                continue;
            }
            if (pendingSpace) {
                normalized += ' ';
                pendingSpace = false;
            }
            normalized += char;
        }
        return normalized.trim();
    }

    public withoutFinishBlocks(blocks: InteractionBlock[]): InteractionBlock[] {
        return blocks
            .filter(block => block.type !== 'finish')
            .map(block => {
                if (block.type === 'turn' && Array.isArray(block.blocks)) {
                    return {
                        ...block,
                        blocks: this.withoutFinishBlocks(block.blocks)
                    };
                }
                return block;
            });
    }

    public hasFinishBlock(blocks: InteractionBlock[]): boolean {
        for (const block of blocks) {
            if (block.type === 'finish') {
                return true;
            }
            if (block.type === 'turn' && Array.isArray(block.blocks) && this.hasFinishBlock(block.blocks)) {
                return true;
            }
        }
        return false;
    }

    public getFinishSummaryText(result: any): string | undefined {
        const completionSummary = this.getCompletionSummary(result);
        if (completionSummary && typeof completionSummary.summary === 'string') {
            return completionSummary.summary.trim() || undefined;
        }
        return undefined;
    }

    public buildFinishTaskBlock(timeline: InteractionBlock[], result: any, allowTimelineFileFallback = false): InteractionBlock | undefined {
        const completionSummary = this.getCompletionSummary(result);
        const ledgerChanges = this.fileChangeLedger.getChanges();
        if (!completionSummary && ledgerChanges.length === 0) {
            return undefined;
        }

        const rawChanges = Array.isArray(completionSummary?.filesChanged)
            ? completionSummary.filesChanged.map((change: any) => this.canonicalizeFileChange(change))
            : [];
        const fileChanges = this.filesModifiedService.buildFinishFileChanges(
            rawChanges,
            this.canonicalizeTimelineFilePaths(timeline),
            this.editCodeService.getPendingEditsDiffs(),
            allowTimelineFileFallback,
            ledgerChanges
        );

        if (fileChanges.length === 0) {
            return undefined;
        }

        return {
            id: 'finish-task-summary',
            type: 'finish',
            status: typeof completionSummary?.status === 'string' ? completionSummary.status : 'completed',
            content: undefined,
            fileChanges,
            isStreaming: false
        };
    }

    private getCompletionSummary(result: any): any | undefined {
        if (result?.completionSummary && typeof result.completionSummary === 'object') {
            return result.completionSummary;
        }
        // Keep old persisted task transcripts renderable after the lifecycle
        // contract moved from a completion tool to a host task_complete event.
        return result?.finishSummary && typeof result.finishSummary === 'object'
            ? result.finishSummary
            : undefined;
    }

}
