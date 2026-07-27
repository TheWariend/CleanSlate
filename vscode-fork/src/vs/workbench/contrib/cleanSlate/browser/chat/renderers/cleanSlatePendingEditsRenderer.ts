/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../base/browser/dom.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IMarkerService, MarkerSeverity } from '../../../../../../platform/markers/common/markers.js';

export interface ICleanSlatePendingEditInfo {
    uri: URI;
    added: number;
    deleted: number;
}

export class CleanSlatePendingEditsRenderer {
    constructor(
        private readonly markerService: IMarkerService
    ) { }

    render(
        globalActionsContainer: HTMLElement,
        fileListContainer: HTMLElement,
        rawEditsInfo: readonly ICleanSlatePendingEditInfo[]
    ): void {
        const editsInfo = this.mergePendingEdits(rawEditsInfo.filter(info => info.added > 0 || info.deleted > 0));
        const count = editsInfo.length;

        if (count === 0) {
            globalActionsContainer.classList.remove('visible');
            return;
        }

        globalActionsContainer.classList.add('visible');

        const textNode = globalActionsContainer.querySelector('.global-actions-text');
        if (textNode) {
            textNode.textContent = `${count} ${count === 1 ? 'File' : 'Files'} With Changes`;
        }

        dom.clearNode(fileListContainer);
        for (const info of editsInfo) {
            const fullPath = this.getDisplayPath(info.uri);
            const basename = fullPath.split('/').pop() || fullPath;
            const markers = this.markerService.read({ resource: info.uri, severities: MarkerSeverity.Warning | MarkerSeverity.Error });
            const warningCount = markers.length;

            const row = dom.append(fileListContainer, dom.$('.cleanSlate-file-row'));
            row.title = fullPath;

            dom.append(row, dom.$('span.codicon.codicon-file.cleanSlate-file-icon'));

            const name = dom.append(row, dom.$('span.file-name'));
            name.textContent = basename;

            const stats = dom.append(row, dom.$('.file-stats'));
            if (info.added > 0) {
                dom.append(stats, dom.$('span.stat-added')).textContent = `+${info.added}`;
            }
            if (info.deleted > 0) {
                dom.append(stats, dom.$('span.stat-deleted')).textContent = `-${info.deleted}`;
            }

            if (warningCount > 0) {
                const markerBadge = dom.append(row, dom.$('.file-markers'));
                dom.append(markerBadge, dom.$('i.codicon.codicon-warning'));
                dom.append(markerBadge, dom.$('span')).textContent = String(warningCount);
            }
        }
    }

    private mergePendingEdits(rawEditsInfo: readonly ICleanSlatePendingEditInfo[]): ICleanSlatePendingEditInfo[] {
        const merged = new Map<string, ICleanSlatePendingEditInfo>();
        for (const info of rawEditsInfo) {
            const key = this.normalizeUriKey(info.uri);
            const existing = merged.get(key);
            if (existing) {
                existing.added += info.added;
                existing.deleted += info.deleted;
            } else {
                merged.set(key, { uri: info.uri, added: info.added, deleted: info.deleted });
            }
        }
        return Array.from(merged.values());
    }

    private normalizeUriKey(uri: URI): string {
        return (uri.fsPath || uri.path || uri.toString()).replace(/\\/g, '/').trim().toLowerCase();
    }

    private getDisplayPath(uri: URI): string {
        return (uri.fsPath || uri.path || uri.toString()).replace(/\\/g, '/');
    }
}
