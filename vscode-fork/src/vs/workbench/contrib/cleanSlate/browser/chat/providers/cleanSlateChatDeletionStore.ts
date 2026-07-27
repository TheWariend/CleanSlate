/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';

const CLEANSLATE_DELETED_SESSION_IDS_STORAGE_KEY = 'cleanSlate.chat.deletedSessionIds';
const CLEANSLATE_DELETED_PROJECT_CUTOFFS_STORAGE_KEY = 'cleanSlate.chat.deletedProjectCutoffs';
const CLEANSLATE_DELETED_BEFORE_STORAGE_KEY = 'cleanSlate.chat.deletedBefore';
const CLEANSLATE_DELETED_SESSION_IDS_LIMIT = 1000;
const CLEANSLATE_DELETED_PROJECT_CUTOFFS_LIMIT = 500;

export function loadCleanSlateDeletedSessionIds(storageService: IStorageService): Set<string> {
	return new Set([
		...parseStringArray(storageService.get(CLEANSLATE_DELETED_SESSION_IDS_STORAGE_KEY, StorageScope.PROFILE)),
		...parseStringArray(storageService.get(CLEANSLATE_DELETED_SESSION_IDS_STORAGE_KEY, StorageScope.WORKSPACE))
	]);
}

export function rememberCleanSlateDeletedSessionId(storageService: IStorageService, deletedSessionIds: Set<string>, sessionId: string): void {
	const normalized = sessionId.trim();
	if (!normalized) {
		return;
	}
	deletedSessionIds.delete(normalized);
	deletedSessionIds.add(normalized);
	while (deletedSessionIds.size > CLEANSLATE_DELETED_SESSION_IDS_LIMIT) {
		const oldest = deletedSessionIds.values().next().value;
		if (typeof oldest !== 'string') {
			break;
		}
		deletedSessionIds.delete(oldest);
	}
	persistCleanSlateDeletedSessionIds(storageService, deletedSessionIds);
}

export function loadCleanSlateDeletedProjectCutoffs(storageService: IStorageService): Map<string, number> {
	return mergeCutoffs(
		parseCutoffMap(storageService.get(CLEANSLATE_DELETED_PROJECT_CUTOFFS_STORAGE_KEY, StorageScope.PROFILE)),
		parseCutoffMap(storageService.get(CLEANSLATE_DELETED_PROJECT_CUTOFFS_STORAGE_KEY, StorageScope.WORKSPACE))
	);
}

export function loadCleanSlateDeletedBefore(storageService: IStorageService): number {
	const profile = parseNumber(storageService.get(CLEANSLATE_DELETED_BEFORE_STORAGE_KEY, StorageScope.PROFILE));
	const workspace = parseNumber(storageService.get(CLEANSLATE_DELETED_BEFORE_STORAGE_KEY, StorageScope.WORKSPACE));
	return Math.max(profile ?? 0, workspace ?? 0);
}

export function rememberCleanSlateDeletedBefore(storageService: IStorageService, deletedAt: number = Date.now()): number {
	const next = Math.max(loadCleanSlateDeletedBefore(storageService), deletedAt);
	const value = String(next);
	storageService.store(CLEANSLATE_DELETED_BEFORE_STORAGE_KEY, value, StorageScope.PROFILE, StorageTarget.MACHINE);
	storageService.store(CLEANSLATE_DELETED_BEFORE_STORAGE_KEY, value, StorageScope.WORKSPACE, StorageTarget.MACHINE);
	return next;
}

export function rememberCleanSlateDeletedProjectCutoff(
	storageService: IStorageService,
	deletedProjectCutoffs: Map<string, number>,
	projectValues: readonly (string | undefined)[],
	deletedAt: number = Date.now()
): void {
	for (const value of normalizeProjectValues(projectValues)) {
		deletedProjectCutoffs.set(value, Math.max(deletedProjectCutoffs.get(value) ?? 0, deletedAt));
	}
	pruneOldestMapEntries(deletedProjectCutoffs, CLEANSLATE_DELETED_PROJECT_CUTOFFS_LIMIT);
	persistCleanSlateDeletedProjectCutoffs(storageService, deletedProjectCutoffs);
}

export function isCleanSlateSessionDeletedByGlobalCutoff(deletedBefore: number, sessionTime: number | undefined): boolean {
	const effectiveSessionTime = typeof sessionTime === 'number' && Number.isFinite(sessionTime) ? sessionTime : 0;
	return deletedBefore > 0 && effectiveSessionTime <= deletedBefore;
}

export function isCleanSlateSessionDeletedByProjectCutoff(
	deletedProjectCutoffs: ReadonlyMap<string, number>,
	projectValues: readonly (string | undefined)[],
	sessionTime: number | undefined
): boolean {
	const effectiveSessionTime = typeof sessionTime === 'number' && Number.isFinite(sessionTime) ? sessionTime : 0;
	return normalizeProjectValues(projectValues).some(value => {
		const cutoff = deletedProjectCutoffs.get(value);
		return typeof cutoff === 'number' && effectiveSessionTime <= cutoff;
	});
}

export function normalizeCleanSlateProjectValues(values: readonly (string | undefined)[]): string[] {
	return normalizeProjectValues(values);
}

function persistCleanSlateDeletedSessionIds(storageService: IStorageService, deletedSessionIds: ReadonlySet<string>): void {
	const value = JSON.stringify([...deletedSessionIds].slice(-CLEANSLATE_DELETED_SESSION_IDS_LIMIT));
	storageService.store(CLEANSLATE_DELETED_SESSION_IDS_STORAGE_KEY, value, StorageScope.PROFILE, StorageTarget.MACHINE);
	storageService.store(CLEANSLATE_DELETED_SESSION_IDS_STORAGE_KEY, value, StorageScope.WORKSPACE, StorageTarget.MACHINE);
}

function persistCleanSlateDeletedProjectCutoffs(storageService: IStorageService, deletedProjectCutoffs: ReadonlyMap<string, number>): void {
	const value = JSON.stringify(Object.fromEntries([...deletedProjectCutoffs].slice(-CLEANSLATE_DELETED_PROJECT_CUTOFFS_LIMIT)));
	storageService.store(CLEANSLATE_DELETED_PROJECT_CUTOFFS_STORAGE_KEY, value, StorageScope.PROFILE, StorageTarget.MACHINE);
	storageService.store(CLEANSLATE_DELETED_PROJECT_CUTOFFS_STORAGE_KEY, value, StorageScope.WORKSPACE, StorageTarget.MACHINE);
}

function parseStringArray(raw: string | undefined): string[] {
	if (!raw) {
		return [];
	}
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
	} catch {
		return [];
	}
}

function parseNumber(raw: string | undefined): number | undefined {
	if (!raw) {
		return undefined;
	}
	const value = Number(raw);
	return Number.isFinite(value) ? value : undefined;
}

function parseCutoffMap(raw: string | undefined): Map<string, number> {
	if (!raw) {
		return new Map();
	}
	try {
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return new Map();
		}
		const entries = Object.entries(parsed)
			.filter((entry): entry is [string, number] => typeof entry[0] === 'string' && Number.isFinite(entry[1]));
		return new Map(entries);
	} catch {
		return new Map();
	}
}

function mergeCutoffs(...maps: readonly ReadonlyMap<string, number>[]): Map<string, number> {
	const merged = new Map<string, number>();
	for (const map of maps) {
		for (const [key, value] of map) {
			merged.set(key, Math.max(merged.get(key) ?? 0, value));
		}
	}
	return merged;
}

function normalizeProjectValues(values: readonly (string | undefined)[]): string[] {
	const normalized: string[] = [];
	for (const value of values) {
		const trimmed = value?.trim();
		if (!trimmed) {
			continue;
		}
		normalized.push(trimmed.toLowerCase());
		try {
			const url = new URL(trimmed);
			normalized.push(url.href.toLowerCase());
			if (url.pathname) {
				normalized.push(...expandPathValue(decodeURIComponent(url.pathname)));
			}
		} catch {
			normalized.push(...expandPathValue(trimmed));
		}
	}
	return [...new Set(normalized.filter(Boolean))];
}

function expandPathValue(value: string): string[] {
	const trimmed = value.trim().replace(/[/\\]+$/, '');
	if (!trimmed) {
		return [];
	}
	const values = [trimmed.toLowerCase()];
	const name = trimmed.split(/[\\/]/).filter(Boolean).at(-1)?.trim().toLowerCase();
	if (name) {
		values.push(name);
	}
	return values;
}

function pruneOldestMapEntries(map: Map<string, number>, limit: number): void {
	while (map.size > limit) {
		const oldest = [...map.entries()].sort((a, b) => a[1] - b[1])[0]?.[0];
		if (!oldest) {
			break;
		}
		map.delete(oldest);
	}
}
