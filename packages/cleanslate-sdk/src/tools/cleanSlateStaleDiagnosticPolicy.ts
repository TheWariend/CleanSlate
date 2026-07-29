/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const STALE_DIAGNOSTIC_FILE_PATTERN = /(?:^|\/)ts_errors(?:_v\d+)?\.txt$/i;

export function isStaleGeneratedDiagnosticPath(pathCandidate: string | undefined): boolean {
	if (!pathCandidate) {
		return false;
	}
	return STALE_DIAGNOSTIC_FILE_PATTERN.test(pathCandidate.replace(/\\/g, '/'));
}

export const STALE_GENERATED_DIAGNOSTIC_WARNING =
	'This file looks like a stale generated compiler log, not live workspace truth. Prefer read_lints or a fresh scoped compile command before editing code to satisfy errors listed here.';
