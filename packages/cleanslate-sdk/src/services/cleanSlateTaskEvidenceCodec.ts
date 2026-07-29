/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ICleanSlateTaskFileChange } from './cleanSlateTaskSessionService.js';

/** Bounds evidence payloads and canonicalizes paths/file-change records. */
export class CleanSlateTaskEvidenceCodec {
    private static readonly MAX_EVIDENCE_STRING_LENGTH = 1_000;
    private static readonly MAX_EVIDENCE_COLLECTION_ITEMS = 20;
    private static readonly MAX_EVIDENCE_OBJECT_KEYS = 24;

    public trimOptional(value: unknown): string | undefined {
        if (typeof value !== 'string') {
            return undefined;
        }
        const trimmed = value.trim();
        return trimmed.length > 0 ? this.truncateEvidenceString(trimmed) : undefined;
    }

    private truncateEvidenceString(value: string): string {
        if (value.length <= CleanSlateTaskEvidenceCodec.MAX_EVIDENCE_STRING_LENGTH) {
            return value;
        }
        return `${value.slice(0, CleanSlateTaskEvidenceCodec.MAX_EVIDENCE_STRING_LENGTH)}...`;
    }

    public sanitizeEvidenceValue(value: unknown, depth = 0): unknown {
        if (value === undefined || value === null) {
            return value;
        }
        if (typeof value === 'string') {
            if (value.startsWith('data:image/')) {
                return '[image-data]';
            }
            return this.truncateEvidenceString(value);
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            return value;
        }
        if (depth >= 4) {
            return Array.isArray(value) ? '[array]' : '[object]';
        }
        if (Array.isArray(value)) {
            const sanitized = value
                .slice(0, CleanSlateTaskEvidenceCodec.MAX_EVIDENCE_COLLECTION_ITEMS)
                .map(item => this.sanitizeEvidenceValue(item, depth + 1));
            if (value.length > CleanSlateTaskEvidenceCodec.MAX_EVIDENCE_COLLECTION_ITEMS) {
                sanitized.push({ truncatedItems: value.length - CleanSlateTaskEvidenceCodec.MAX_EVIDENCE_COLLECTION_ITEMS });
            }
            return sanitized;
        }
        if (typeof value === 'object') {
            const source = value as Record<string, unknown>;
            const sanitized: Record<string, unknown> = {};
            const keys = Object.keys(source);
            for (const key of keys.slice(0, CleanSlateTaskEvidenceCodec.MAX_EVIDENCE_OBJECT_KEYS)) {
                const keyLower = key.toLowerCase();
                const child = source[key];
                if (typeof child === 'string' && child.length > CleanSlateTaskEvidenceCodec.MAX_EVIDENCE_STRING_LENGTH
                    && (keyLower.includes('screenshot') || keyLower.includes('image') || keyLower.includes('base64'))) {
                    sanitized[key] = '[large-media]';
                    continue;
                }
                sanitized[key] = this.sanitizeEvidenceValue(child, depth + 1);
            }
            if (keys.length > CleanSlateTaskEvidenceCodec.MAX_EVIDENCE_OBJECT_KEYS) {
                sanitized.truncatedKeys = keys.length - CleanSlateTaskEvidenceCodec.MAX_EVIDENCE_OBJECT_KEYS;
            }
            return sanitized;
        }
        return undefined;
    }

    public normalizeEvidencePaths(paths: unknown): string[] {
        if (!Array.isArray(paths)) {
            return [];
        }

        const normalized: string[] = [];
        const seen = new Set<string>();
        for (const path of paths) {
            if (typeof path !== 'string') {
                continue;
            }
            const cleanPath = this.normalizePath(path);
            if (!cleanPath) {
                continue;
            }
            const key = cleanPath.toLowerCase();
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            normalized.push(cleanPath);
        }
        return normalized;
    }

    public normalizeFileChanges(changes: unknown): ICleanSlateTaskFileChange[] {
        if (!Array.isArray(changes)) {
            return [];
        }

        const normalized: ICleanSlateTaskFileChange[] = [];
        const seen = new Set<string>();
        for (const change of changes) {
            if (!change || typeof change !== 'object') {
                continue;
            }
            const candidate = change as Partial<ICleanSlateTaskFileChange>;
            const path = this.normalizePath(candidate.path);
            if (!path) {
                continue;
            }
            const key = path.toLowerCase();
            if (seen.has(key)) {
                const existingIndex = normalized.findIndex(item => item.path.toLowerCase() === key);
                if (existingIndex !== -1) {
                    normalized.splice(existingIndex, 1);
                }
            } else {
                seen.add(key);
            }
            normalized.push({
                path,
                added: typeof candidate.added === 'number' && Number.isFinite(candidate.added) ? candidate.added : undefined,
                deleted: typeof candidate.deleted === 'number' && Number.isFinite(candidate.deleted) ? candidate.deleted : undefined
            });
        }
        return normalized;
    }

    private normalizePath(path: unknown): string | undefined {
        if (typeof path !== 'string') {
            return undefined;
        }
        const normalized = path.trim().split('\\').join('/');
        return normalized.length > 0 ? normalized : undefined;
    }

    public mergeFileChanges(
        primary: Iterable<ICleanSlateTaskFileChange>,
        secondary: Iterable<ICleanSlateTaskFileChange>
    ): ICleanSlateTaskFileChange[] {
        const merged = new Map<string, ICleanSlateTaskFileChange>();
        for (const source of [primary, secondary]) {
            for (const change of source) {
                const path = this.normalizePath(change?.path);
                if (!path) {
                    continue;
                }
                const key = path.toLowerCase();
                merged.set(key, {
                    path,
                    added: typeof change.added === 'number' && Number.isFinite(change.added) ? change.added : undefined,
                    deleted: typeof change.deleted === 'number' && Number.isFinite(change.deleted) ? change.deleted : undefined
                });
            }
        }
        return Array.from(merged.values());
    }

}
