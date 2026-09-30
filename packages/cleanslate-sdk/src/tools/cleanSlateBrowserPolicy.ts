/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Browser policy is defined beside the capability and adapted by each host.
 * This keeps the built-in agent, external agents, and the advertised tool
 * catalog aligned without making any one prompt surface the source of truth.
 */
export const CLEANSLATE_BROWSER_POLICY = Object.freeze({
	activation: 'Use browser_* tools only when the current user request explicitly asks to open a browser, preview a page, inspect the DOM, capture screenshots, or perform visual/browser verification.',
	incidentalUiChanges: 'Do not open the browser, collect browser evidence, or require browser verification only because UI files changed.',
	nonBrowserVerification: 'When browser verification was not explicitly requested, rely on code inspection, diagnostics, tests, and concise completion reporting instead.',
	boundSurface: 'When browser work is requested, use the browser tools bound to the current CleanSlate chat; they operate the user\'s visible CleanSlate browser.',
	noSilentFallback: 'Do not substitute another browser, OS shell opener, or browser-automation environment unless the user explicitly requests that destination. If a required browser capability is unavailable or fails, report it instead of silently switching.'
});

export function getCleanSlateBrowserOptInLines(): readonly string[] {
	return [
		CLEANSLATE_BROWSER_POLICY.activation,
		CLEANSLATE_BROWSER_POLICY.incidentalUiChanges,
		CLEANSLATE_BROWSER_POLICY.nonBrowserVerification
	];
}

export function getCleanSlateBrowserHostPolicy(): string {
	return [
		...getCleanSlateBrowserOptInLines(),
		CLEANSLATE_BROWSER_POLICY.boundSurface,
		CLEANSLATE_BROWSER_POLICY.noSilentFallback
	].join(' ');
}

export function applyCleanSlateBrowserToolPolicy<T extends { readonly category?: string; readonly description: string }>(tool: T): T {
	if (tool.category !== 'browser') { return tool; }
	return {
		...tool,
		description: `${tool.description} Request scope: ${CLEANSLATE_BROWSER_POLICY.activation} ${CLEANSLATE_BROWSER_POLICY.incidentalUiChanges}`
	};
}
