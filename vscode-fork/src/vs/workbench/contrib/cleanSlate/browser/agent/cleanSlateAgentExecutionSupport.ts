/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { IMarkerService, IMarker, MarkerSeverity } from '../../../../../platform/markers/common/markers.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { ICleanSlateContextService } from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';

export class CleanSlateAgentExecutionSupport {
    constructor(
        private readonly workspaceContextService: IWorkspaceContextService,
        private readonly markerService: IMarkerService,
        private readonly cleanSlateContextService: ICleanSlateContextService
    ) { }

    public didToolSucceed(toolResult: any): boolean {
        if (toolResult?.success === false) {
            return false;
        }
        if (typeof toolResult?.exitCode === 'number') {
            return toolResult.exitCode === 0;
        }
        return true;
    }

    public createMarkerBaseline(failOnWarnings: boolean): Map<string, number> {
        const severities = failOnWarnings ? (MarkerSeverity.Error | MarkerSeverity.Warning) : MarkerSeverity.Error;
        const baseline = new Map<string, number>();

        for (const marker of this.markerService.read({ severities })) {
            const signature = this.markerSignature(marker);
            baseline.set(signature, (baseline.get(signature) || 0) + 1);
        }

        return baseline;
    }

    public isArtifactWritePath(pathCandidate: unknown): boolean {
        if (typeof pathCandidate !== 'string') {
            return false;
        }
        const normalized = pathCandidate.replace(/\\/g, '/').toLowerCase();
        const basename = normalized.split('/').pop() || normalized;
        return basename === 'implementation_plan.md'
            || basename === 'walkthrough.md'
            || basename === 'analysis.md';
    }

    public isConfirmedMutationResult(toolName: string, toolInput: any, toolResult: any): boolean {
        if (!this.didToolSucceed(toolResult)) {
            return false;
        }

        switch (toolName) {
            case 'apply_edit':
                return typeof toolResult?.appliedBlocks === 'number' && toolResult.appliedBlocks > 0;
            case 'multi_file_replace':
                return Array.isArray(toolResult?.results) && toolResult.results.length > 0;
            case 'create_multiple_files':
                return Array.isArray(toolResult?.created) && toolResult.created.length > 0;
            case 'write_file':
            case 'create_and_write_file':
                if (this.isArtifactWritePath(toolInput?.file_path ?? toolInput?.path)) {
                    return true;
                }
                return toolResult?.persisted === true || toolResult?.created === true;
            default:
                return false;
        }
    }

    public trackTouchedPaths(toolName: string, toolInput: any, toolResult: any, touchedPaths: Set<string>): void {
        const collected: string[] = [];
        const collectPath = (candidate: unknown) => {
            if (typeof candidate !== 'string') {
                return;
            }
            const absolute = this.coercePathToAbsolute(candidate);
            if (absolute) {
                collected.push(absolute);
            }
        };

        collectPath(toolInput?.file_path ?? toolInput?.path);
        collectPath(toolResult?.path);

        if (Array.isArray(toolResult?.created)) {
            for (const path of toolResult.created) {
                collectPath(path);
            }
        }

        if (Array.isArray(toolResult?.affectedFiles)) {
            for (const path of toolResult.affectedFiles) {
                collectPath(path);
            }
        }

        if (Array.isArray(toolInput?.files)) {
            for (const file of toolInput.files) {
                collectPath(file?.path);
            }
        }

        const isArtifactOnlyWrite = (toolName === 'write_file' || toolName === 'create_and_write_file')
            && this.isArtifactWritePath(toolInput?.file_path ?? toolInput?.path);
        if (isArtifactOnlyWrite) {
            return;
        }

        for (const path of collected) {
            touchedPaths.add(path);
        }
    }

    public async collectNewMarkerIssues(
        baseline: Map<string, number>,
        touchedPaths: Set<string>,
        failOnWarnings: boolean,
        limit: number = 40
    ): Promise<string[]> {
        const severities = failOnWarnings ? (MarkerSeverity.Error | MarkerSeverity.Warning) : MarkerSeverity.Error;
        const scopePaths = await this.collectScopePaths(touchedPaths);
        const baselineRemaining = new Map<string, number>(baseline);
        const markers = this.markerService
            .read({ severities })
            .filter(marker => this.markerBelongsToScope(marker, scopePaths))
            .sort((a, b) => b.severity - a.severity);

        const newIssues: string[] = [];

        for (const marker of markers) {
            const signature = this.markerSignature(marker);
            const remaining = baselineRemaining.get(signature) || 0;
            if (remaining > 0) {
                baselineRemaining.set(signature, remaining - 1);
                continue;
            }

            newIssues.push(this.formatMarkerIssue(marker));
            if (newIssues.length >= limit) {
                break;
            }
        }

        return newIssues;
    }

    private normalizePath(path: string): string {
        return path.replace(/\\/g, '/').toLowerCase();
    }

    private coercePathToAbsolute(pathCandidate: string): string | undefined {
        const raw = pathCandidate.trim();
        if (!raw) {
            return undefined;
        }

        try {
            if (raw.includes('://')) {
                const parsed = URI.parse(raw);
                if (parsed.scheme === 'file' && parsed.fsPath) {
                    return parsed.fsPath;
                }
            }
        } catch {
            // Fall through to regular path resolution.
        }

        if (raw.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(raw)) {
            return raw;
        }

        const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
        if (workspaceFolders.length > 0) {
            return workspaceFolders[0].toResource(raw).fsPath;
        }

        return raw;
    }

    private markerSignature(marker: IMarker): string {
        const resource = marker.resource?.fsPath || marker.resource?.toString() || 'unknown';
        return `${resource}:${marker.startLineNumber}:${marker.startColumn}:${marker.severity}:${marker.message}`;
    }

    private async collectScopePaths(touchedPaths: Set<string>): Promise<Set<string>> {
        const scopePaths = new Set<string>();
        const addPath = (pathCandidate: string | undefined) => {
            if (!pathCandidate) {
                return;
            }
            scopePaths.add(this.normalizePath(pathCandidate));
        };

        if (touchedPaths.size > 0) {
            for (const path of touchedPaths) {
                addPath(path);
            }
            return scopePaths;
        }

        try {
            const context = await this.cleanSlateContextService.getContext();
            addPath(context.activeFile?.uri?.fsPath);
            for (const file of context.openFiles) {
                addPath(file.uri.fsPath);
            }
        } catch {
            // If context lookup fails, return empty scope.
        }

        return scopePaths;
    }

    private markerBelongsToScope(marker: IMarker, scopePaths: Set<string>): boolean {
        if (scopePaths.size === 0) {
            return true;
        }

        const markerPath = marker.resource?.fsPath || marker.resource?.toString();
        if (!markerPath) {
            return false;
        }

        const normalized = this.normalizePath(markerPath);
        if (scopePaths.has(normalized)) {
            return true;
        }

        for (const scopedPath of scopePaths) {
            if (normalized.endsWith(scopedPath) || scopedPath.endsWith(normalized)) {
                return true;
            }
        }

        return false;
    }

    private formatMarkerIssue(marker: IMarker): string {
        const resource = marker.resource?.fsPath || marker.resource?.toString() || 'unknown';
        const severity = marker.severity === MarkerSeverity.Error ? 'Error' : 'Warning';
        return `${resource}:${marker.startLineNumber}:${marker.startColumn} [${severity}] ${marker.message}`;
    }
}
