/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

interface IPathEvidenceEntry {
    lastLocatedAt?: number;
    locateVersionId?: number;
    lastReadAt?: number;
    readVersionId?: number;
    symbols: Set<string>;
}

export interface IExecutionEvidenceStatus {
    hasLocateEvidence: boolean;
    hasReadEvidence: boolean;
    isReadFresh: boolean;
    currentVersionId?: number;
    readVersionId?: number;
}



export class CleanSlateExecutionEvidenceLedger {
    private readonly pathEvidence = new Map<string, IPathEvidenceEntry>();
    private readonly scopeEvidence = new Set<string>();

    clone(): CleanSlateExecutionEvidenceLedger {
        const copy = new CleanSlateExecutionEvidenceLedger();
        for (const [pathKey, entry] of this.pathEvidence.entries()) {
            copy.pathEvidence.set(pathKey, {
                lastLocatedAt: entry.lastLocatedAt,
                locateVersionId: entry.locateVersionId,
                lastReadAt: entry.lastReadAt,
                readVersionId: entry.readVersionId,
                symbols: new Set(entry.symbols)
            });
        }
        for (const scopeKey of this.scopeEvidence.values()) {
            copy.scopeEvidence.add(scopeKey);
        }
        return copy;
    }

    recordLocatedPath(pathKey: string, locateVersionId?: number): void {
        const normalizedPathKey = this.normalizePathKey(pathKey);
        const entry = this.ensurePathEntry(normalizedPathKey);
        entry.lastLocatedAt = Date.now();
        if (typeof locateVersionId === 'number') {
            entry.locateVersionId = locateVersionId;
        }
    }

    recordLocatedScope(scopeKey: string): void {
        const normalizedScopeKey = this.normalizeScopeKey(scopeKey);
        this.scopeEvidence.add(normalizedScopeKey);
    }

    recordReadPath(pathKey: string, readVersionId?: number, symbols: string[] = []): void {
        const normalizedPathKey = this.normalizePathKey(pathKey);
        const entry = this.ensurePathEntry(normalizedPathKey);
        entry.lastReadAt = Date.now();
        if (typeof readVersionId === 'number') {
            entry.readVersionId = readVersionId;
        }
        if (typeof readVersionId === 'number') {
            entry.locateVersionId = readVersionId;
        }
        entry.lastLocatedAt = entry.lastLocatedAt ?? entry.lastReadAt;
        for (const symbol of symbols) {
            const trimmed = symbol.trim();
            if (trimmed.length > 0) {
                entry.symbols.add(trimmed);
            }
        }
    }

    invalidateReadPath(pathKey: string): void {
        const normalizedPathKey = this.normalizePathKey(pathKey);
        const existing = this.pathEvidence.get(normalizedPathKey);
        if (!existing) {
            return;
        }
        existing.lastReadAt = undefined;
        existing.readVersionId = undefined;
        existing.symbols.clear();
    }

    getStatusForPath(pathKey: string, currentVersionId?: number): IExecutionEvidenceStatus {
        const normalizedPathKey = this.normalizePathKey(pathKey);
        const entry = this.pathEvidence.get(normalizedPathKey);
        const hasExactLocate = !!entry?.lastLocatedAt;
        const hasScopeLocate = this.hasScopeLocateEvidence(normalizedPathKey);
        const hasLocateEvidence = hasExactLocate || hasScopeLocate;
        const hasReadEvidence = !!entry?.lastReadAt;
        const readVersionId = entry?.readVersionId;
        const isReadFresh = hasReadEvidence
            && (
                typeof currentVersionId !== 'number'
                || typeof readVersionId !== 'number'
                || readVersionId === currentVersionId
            );

        return {
            hasLocateEvidence,
            hasReadEvidence,
            isReadFresh,
            currentVersionId,
            readVersionId
        };
    }



    private hasScopeLocateEvidence(pathKey: string): boolean {
        const normalizedPathKey = this.normalizePathKey(pathKey);
        for (const scopeKey of this.scopeEvidence.values()) {
            if (normalizedPathKey === scopeKey || normalizedPathKey.startsWith(this.withTrailingSlash(scopeKey))) {
                return true;
            }
        }
        return false;
    }

    private ensurePathEntry(pathKey: string): IPathEvidenceEntry {
        const existing = this.pathEvidence.get(pathKey);
        if (existing) {
            return existing;
        }
        const created: IPathEvidenceEntry = { symbols: new Set<string>() };
        this.pathEvidence.set(pathKey, created);
        return created;
    }

    private normalizePathKey(pathKey: string): string {
        return pathKey.trim();
    }

    private normalizeScopeKey(scopeKey: string): string {
        const normalized = scopeKey.trim();
        if (!normalized) {
            return normalized;
        }
        if (normalized.endsWith('/')) {
            return normalized.slice(0, -1);
        }
        return normalized;
    }

    private withTrailingSlash(pathKey: string): string {
        return pathKey.endsWith('/') ? pathKey : `${pathKey}/`;
    }
}
