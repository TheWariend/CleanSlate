/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CleanSlateVerificationTargetStatus, ICleanSlateEvidenceLedgerEntry, ICleanSlateVerificationTarget } from './cleanSlateTaskSessionService.js';

export interface ICleanSlateVerificationTargetUpdate {
	targets: ICleanSlateVerificationTarget[];
	changed: boolean;
}

/** Derives and refreshes browser verification obligations from changed UI paths and evidence. */
export class CleanSlateVerificationTargetTracker {
	public register(existingTargets: ICleanSlateVerificationTarget[], paths: string[] | undefined, objective?: string): ICleanSlateVerificationTargetUpdate {
		const derivedTargets = this.derive(paths, objective);
		if (derivedTargets.length === 0) {
			return { targets: existingTargets, changed: false };
		}
		const targets = [...existingTargets];
		let changed = false;
		for (const target of derivedTargets) {
			const existingIndex = targets.findIndex(existing => existing.id === target.id);
			if (existingIndex === -1) {
				targets.push(target);
				changed = true;
				continue;
			}
			const existing = targets[existingIndex];
			const nextTarget: ICleanSlateVerificationTarget = {
				...existing,
				description: target.description,
				sourcePaths: this.mergeUniqueStrings(existing.sourcePaths, target.sourcePaths),
				routeHints: this.mergeUniqueStrings(existing.routeHints, target.routeHints),
				requiresRootTraversal: existing.requiresRootTraversal || target.requiresRootTraversal,
				status: existing.status === 'verified' ? 'stale' : 'pending',
				updatedAt: Date.now()
			};
			if (!this.areEqual(existing, nextTarget)) {
				targets[existingIndex] = nextTarget;
				changed = true;
			}
		}
		return { targets, changed };
	}

	public recordBrowserEvidence(existingTargets: ICleanSlateVerificationTarget[], entry: ICleanSlateEvidenceLedgerEntry): ICleanSlateVerificationTargetUpdate {
		if (existingTargets.length === 0 || !['browser_snapshot', 'browser_screenshot'].includes(entry.toolName ?? '')) {
			return { targets: existingTargets, changed: false };
		}
		const observedUrls = this.collectObservedBrowserUrls(entry);
		if (observedUrls.length === 0) {
			return { targets: existingTargets, changed: false };
		}
		const observedRoutePaths = new Set(observedUrls.map(url => this.normalizeUrlPath(url)).filter((path): path is string => !!path));
		const visitedRoot = observedRoutePaths.has('/');
		const multiPageSweep = (entry.browserPageCount ?? 0) > 1 && observedRoutePaths.size > 1;
		let changed = false;
		const targets = existingTargets.map(target => {
			if (target.status === 'verified') {
				return target;
			}
			const matched = target.requiresRootTraversal
				? visitedRoot && multiPageSweep
				: target.routeHints.some(route => observedRoutePaths.has(this.normalizeRouteHint(route) || route));
			if (!matched) {
				return target;
			}
			changed = true;
			return { ...target, status: 'verified' as const, lastVerifiedAt: Date.now(), lastVerifiedUrl: observedUrls[0] };
		});
		return { targets, changed };
	}

	public normalize(value: unknown): ICleanSlateVerificationTarget[] {
		if (!Array.isArray(value)) {
			return [];
		}
		return value.flatMap(target => {
			if (!target || typeof target !== 'object') {
				return [];
			}
			const candidate = target as Partial<ICleanSlateVerificationTarget>;
			const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
			const description = typeof candidate.description === 'string' ? candidate.description.trim() : '';
			const scope = candidate.scope === 'shared-ui' || candidate.scope === 'route' ? candidate.scope : undefined;
			if (!id || !description || candidate.kind !== 'browser' || !scope) {
				return [];
			}
			const status: CleanSlateVerificationTargetStatus = candidate.status === 'verified' ? 'verified' : candidate.status === 'stale' ? 'stale' : 'pending';
			return [{
				id,
				kind: 'browser' as const,
				scope,
				description,
				sourcePaths: this.normalizePaths(candidate.sourcePaths),
				routeHints: Array.isArray(candidate.routeHints) ? candidate.routeHints.map(route => this.normalizeRouteHint(typeof route === 'string' ? route : '')).filter((route): route is string => !!route) : [],
				requiresRootTraversal: candidate.requiresRootTraversal !== false,
				status,
				updatedAt: typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt) ? candidate.updatedAt : Date.now(),
				lastVerifiedAt: typeof candidate.lastVerifiedAt === 'number' && Number.isFinite(candidate.lastVerifiedAt) ? candidate.lastVerifiedAt : undefined,
				lastVerifiedUrl: typeof candidate.lastVerifiedUrl === 'string' && candidate.lastVerifiedUrl.trim() ? candidate.lastVerifiedUrl.trim() : undefined
			}];
		});
	}

	private derive(paths: string[] | undefined, objective?: string): ICleanSlateVerificationTarget[] {
		const uiPaths = this.normalizePaths(paths).filter(path => this.isLikelyUiPath(path));
		if (uiPaths.length === 0) {
			return [];
		}
		const sharedPaths: string[] = [];
		const routeTargets = new Map<string, string[]>();
		for (const path of uiPaths) {
			const routeHint = !this.isSharedUiPath(path) ? this.deriveRouteHintForPath(path) : undefined;
			if (!routeHint) {
				sharedPaths.push(path);
				continue;
			}
			routeTargets.set(routeHint, [...(routeTargets.get(routeHint) ?? []), path]);
		}
		const objectiveText = typeof objective === 'string' && objective.trim() ? objective.trim() : 'the current UI change';
		const targets: ICleanSlateVerificationTarget[] = [];
		if (sharedPaths.length > 0) {
			targets.push({ id: 'browser:shared-ui', kind: 'browser', scope: 'shared-ui', description: `Re-open the app entrypoint and verify all affected shared surfaces for ${objectiveText}.`, sourcePaths: this.mergeUniqueStrings([], sharedPaths), routeHints: ['/'], requiresRootTraversal: true, status: 'pending', updatedAt: Date.now() });
		}
		for (const [routeHint, sourcePaths] of routeTargets) {
			targets.push({ id: `browser:route:${routeHint}`, kind: 'browser', scope: 'route', description: `Verify the route ${routeHint} after the latest UI edits.`, sourcePaths: this.mergeUniqueStrings([], sourcePaths), routeHints: [routeHint], requiresRootTraversal: false, status: 'pending', updatedAt: Date.now() });
		}
		return targets;
	}

	private collectObservedBrowserUrls(entry: ICleanSlateEvidenceLedgerEntry): string[] {
		const urls: string[] = [];
		const add = (value: unknown) => { if (typeof value === 'string' && value.trim() && !urls.includes(value.trim())) { urls.push(value.trim()); } };
		add(entry.url);
		if (entry.result && typeof entry.result === 'object') {
			const record = entry.result as Record<string, unknown>;
			add(record.url);
			if (Array.isArray(record.pages)) {
				for (const page of record.pages) { if (page && typeof page === 'object') { add((page as Record<string, unknown>).url); } }
			}
		}
		return urls;
	}

	private normalizePaths(paths: unknown): string[] {
		if (!Array.isArray(paths)) { return []; }
		return this.mergeUniqueStrings([], paths.flatMap(path => typeof path === 'string' && path.trim() ? [path.trim().replace(/\\/g, '/')] : []));
	}

	private isLikelyUiPath(path: string): boolean {
		const normalized = path.toLowerCase();
		return ['.css', '.scss', '.sass', '.less', '.styl', '.pcss', '.html', '.tsx', '.jsx', '.vue', '.svelte'].some(extension => normalized.endsWith(extension))
			|| ['/components/', '/app/', '/pages/', '/ui/'].some(segment => normalized.includes(segment));
	}

	private isSharedUiPath(path: string): boolean {
		const normalized = path.toLowerCase();
		const basename = normalized.split('/').pop() || normalized;
		return ['globals.css', 'global.css', 'layout.tsx', 'layout.jsx', 'layout.ts', 'layout.js'].includes(basename)
			|| ['header.', 'footer.', 'nav.', 'navbar.', 'menu.', 'theme.'].some(prefix => basename.startsWith(prefix))
			|| ['/components/header.', '/components/footer.', '/components/nav', '/components/menu.'].some(segment => normalized.includes(segment));
	}

	private deriveRouteHintForPath(path: string): string | undefined {
		const lower = path.toLowerCase();
		const appIndex = lower.indexOf('/app/');
		if (appIndex !== -1) {
			const parts = path.slice(appIndex + 5).split('/').filter(Boolean);
			const pageIndex = parts.findIndex(part => /^page\.(tsx|jsx|ts|js|mdx)$/i.test(part));
			if (pageIndex !== -1) { return this.normalizeRouteHint(`/${parts.slice(0, pageIndex).filter(segment => !segment.startsWith('(') && !segment.startsWith('@')).join('/')}`); }
		}
		const pagesIndex = lower.indexOf('/pages/');
		if (pagesIndex === -1) { return undefined; }
		const parts = path.slice(pagesIndex + 7).split('/').filter(Boolean);
		if (parts.length === 0) { return undefined; }
		const stem = parts.pop()!.split('.')[0];
		if (stem.toLowerCase() !== 'index') { parts.push(stem); }
		return this.normalizeRouteHint(`/${parts.join('/')}`);
	}

	private normalizeRouteHint(route: string): string | undefined {
		const normalized = route.trim().replace(/\\/g, '/');
		if (!normalized) { return undefined; }
		if (normalized === '/') { return '/'; }
		const trimmed = normalized.replace(/\/+/g, '/').replace(/\/$/, '');
		return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
	}

	private normalizeUrlPath(url: string): string | undefined {
		try { return this.normalizeRouteHint(new URL(url).pathname || '/'); } catch { return this.normalizeRouteHint(url); }
	}

	private mergeUniqueStrings(existing: string[], incoming: string[]): string[] {
		const seen = new Set<string>();
		return [...existing, ...incoming].filter(value => { const key = value.trim().toLowerCase(); if (!key || seen.has(key)) { return false; } seen.add(key); return true; }).map(value => value.trim());
	}

	private areEqual(left: ICleanSlateVerificationTarget, right: ICleanSlateVerificationTarget): boolean {
		return left.id === right.id && left.kind === right.kind && left.scope === right.scope && left.description === right.description
			&& left.requiresRootTraversal === right.requiresRootTraversal && left.status === right.status && left.lastVerifiedAt === right.lastVerifiedAt
			&& left.lastVerifiedUrl === right.lastVerifiedUrl && this.arraysEqual(left.sourcePaths, right.sourcePaths) && this.arraysEqual(left.routeHints, right.routeHints);
	}

	private arraysEqual(left: string[], right: string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
}
