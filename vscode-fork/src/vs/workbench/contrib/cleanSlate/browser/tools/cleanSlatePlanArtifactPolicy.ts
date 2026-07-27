/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Structural validation for submitted implementation plans.
 *
 * Planning is the discovery phase; execution implements. A plan whose entries
 * defer discovery ("[MODIFY] screens subtree — identify the primary screens,
 * then improve") pushes research into execution, which is exactly the failure
 * the planning prompt forbids. The prompt alone proved insufficient — models
 * submit vague plans when nothing checks them — so submit_artifact enforces
 * the plan template structurally:
 *
 *  - hard failures (plan rejected, corrective message returned): no
 *    [MODIFY]/[NEW] file entries at all, entries without a concrete file link,
 *    or [MODIFY] targets that are directories or do not exist.
 *  - soft warnings (plan accepted, warnings returned for self-correction):
 *    deferred-discovery phrasing, [NEW] targets that already exist.
 */

export type CleanSlatePlanEntryKind = 'modify' | 'new';

export interface ICleanSlatePlanFileEntry {
	readonly kind: CleanSlatePlanEntryKind;
	readonly label: string;
	/** Link target as written (file:/// URI or plain path); undefined when the entry has no link. */
	readonly target: string | undefined;
	/** Body lines under the entry heading, used for phrasing checks. */
	readonly body: string;
}

export interface ICleanSlatePlanValidationIssue {
	readonly code:
	| 'plan_missing_file_entries'
	| 'plan_entry_missing_file_link'
	| 'plan_modify_target_missing'
	| 'plan_modify_target_directory'
	| 'plan_deferred_discovery'
	| 'plan_new_target_exists';
	readonly message: string;
}

export interface ICleanSlatePlanValidationResult {
	readonly errors: ICleanSlatePlanValidationIssue[];
	readonly warnings: ICleanSlatePlanValidationIssue[];
}

const PLAN_ENTRY_WITH_LINK = /\[(MODIFY|NEW)\]\s*\[([^\]]*)\]\(([^)\s]+)\)/;
const PLAN_ENTRY_ANY = /\[(MODIFY|NEW)\]/;
const PLAN_HEADING = /^#{2,6}\s/;

// Matches the observed failure mode: entry bodies that schedule discovery for
// execution instead of naming the outcome of discovery already performed.
const DEFERRED_DISCOVERY_PATTERN = /\b(?:identify|determine|locate|figure out|audit|investigate|explore)\b[^.\n]{0,60}\b(?:which|the\s+(?:relevant|primary|appropriate|right|correct)|files?|screens?|components?|modules?|targets?)\b/i;

export function extractPlanFileEntries(content: string): ICleanSlatePlanFileEntry[] {
	const lines = content.split(/\r?\n/);
	const entries: Array<{ kind: CleanSlatePlanEntryKind; label: string; target: string | undefined; bodyLines: string[] }> = [];
	let current: (typeof entries)[number] | undefined;

	for (const line of lines) {
		const anyMatch = PLAN_ENTRY_ANY.exec(line);
		if (anyMatch) {
			const linked = PLAN_ENTRY_WITH_LINK.exec(line);
			current = {
				kind: (linked?.[1] ?? anyMatch[1]).toLowerCase() === 'new' ? 'new' : 'modify',
				label: linked?.[2]?.trim() || line.replace(PLAN_ENTRY_ANY, '').trim().slice(0, 120),
				target: linked?.[3],
				bodyLines: []
			};
			entries.push(current);
			continue;
		}
		if (current) {
			if (PLAN_HEADING.test(line) && !PLAN_ENTRY_ANY.test(line)) {
				current = undefined;
				continue;
			}
			current.bodyLines.push(line);
		}
	}

	return entries.map(entry => ({
		kind: entry.kind,
		label: entry.label,
		target: entry.target,
		body: entry.bodyLines.join('\n')
	}));
}

/** Converts a plan link target to a filesystem-ish path (decodes file:/// URIs). */
export function planEntryTargetToPath(target: string): string {
	if (/^file:\/\//i.test(target)) {
		try {
			return decodeURIComponent(target.replace(/^file:\/\/(?:localhost)?/i, ''));
		} catch {
			return target.replace(/^file:\/\/(?:localhost)?/i, '');
		}
	}
	return target;
}

export interface ICleanSlatePlanTargetStat {
	readonly exists: boolean;
	readonly isDirectory: boolean;
}

/**
 * Validates plan structure. `statTarget` resolves a link target to existence
 * metadata; targets that cannot be resolved at all are treated as missing.
 */
export async function validateImplementationPlanStructure(
	content: string,
	statTarget: (path: string) => Promise<ICleanSlatePlanTargetStat | undefined>
): Promise<ICleanSlatePlanValidationResult> {
	const errors: ICleanSlatePlanValidationIssue[] = [];
	const warnings: ICleanSlatePlanValidationIssue[] = [];
	const entries = extractPlanFileEntries(content);

	if (entries.length === 0) {
		errors.push({
			code: 'plan_missing_file_entries',
			message: 'The plan names no concrete files. Every proposed change needs a "#### [MODIFY] [basename](file:///absolute/path)" or "#### [NEW] ..." entry for an exact file.'
		});
		return { errors, warnings };
	}

	const MAX_STATTED_ENTRIES = 20;
	let statted = 0;

	for (const entry of entries) {
		const entryName = entry.label || entry.target || '(unnamed entry)';

		if (!entry.target) {
			errors.push({
				code: 'plan_entry_missing_file_link',
				message: `Entry "${entryName}" has no file link. Use "[${entry.kind.toUpperCase()}] [basename](file:///absolute/path/to/file)" with the exact file discovered during planning.`
			});
			continue;
		}

		if (DEFERRED_DISCOVERY_PATTERN.test(entry.body)) {
			warnings.push({
				code: 'plan_deferred_discovery',
				message: `Entry "${entryName}" defers discovery to execution ("identify/determine/locate..."). Do that discovery now, during planning, and state the concrete outcome instead.`
			});
		}

		if (statted >= MAX_STATTED_ENTRIES) {
			continue;
		}
		statted++;

		const stat = await statTarget(planEntryTargetToPath(entry.target));
		if (entry.kind === 'modify') {
			if (!stat?.exists) {
				errors.push({
					code: 'plan_modify_target_missing',
					message: `[MODIFY] target "${entryName}" does not exist in the workspace. Verify the path with discovery tools and link the real file, or use [NEW] if it is being created.`
				});
			} else if (stat.isDirectory) {
				errors.push({
					code: 'plan_modify_target_directory',
					message: `[MODIFY] target "${entryName}" is a directory, not a file. Plans must name the exact files to change — one entry per file, discovered during planning.`
				});
			}
		} else if (stat?.exists && !stat.isDirectory) {
			warnings.push({
				code: 'plan_new_target_exists',
				message: `[NEW] target "${entryName}" already exists. Use [MODIFY] for existing files.`
			});
		}
	}

	return { errors, warnings };
}

export function formatPlanValidationRejection(result: ICleanSlatePlanValidationResult): string {
	const lines = [
		'The implementation plan is not implementation-ready:',
		...result.errors.slice(0, 6).map(issue => `- ${issue.message}`)
	];
	if (result.warnings.length > 0) {
		lines.push(...result.warnings.slice(0, 4).map(issue => `- (warning) ${issue.message}`));
	}
	lines.push('Planning is the discovery phase: name exact existing files (verified with reads/searches) and the specific change per file, then resubmit.');
	return lines.join('\n');
}
