/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const CLEANSLATE_SELECTION_CONTEXT_HEADERS = new Set([
	'[ATTACHED EDITOR SELECTIONS]',
	'[ATTACHED BROWSER ANNOTATIONS]'
]);

const CLEANSLATE_SLASH_COMMAND_TITLES = new Map<string, string>([
	['/fix', 'Fix selected code'],
	['/explain', 'Explain selected code'],
	['/test', 'Test selected code'],
	['/rewrite', 'Rewrite selected code'],
	['/doc', 'Document selected code'],
	['/review', 'Review selected code'],
	['/optimize', 'Optimize selected code'],
	['/scaffold', 'Scaffold implementation'],
	['/migrate', 'Migrate selected code']
]);

export function getCleanSlateVisibleUserRequestText(value: string): string {
	const normalized = normalizeCleanSlateLineEndings(value).trim();
	if (!normalized) {
		return '';
	}

	const withoutAttachedContext = getTextBeforeAttachedContext(normalized);
	const visible = withoutAttachedContext || getFirstCleanSlateLine(normalized);
	const slashCommand = getKnownCleanSlateSlashCommand(visible);
	if (slashCommand && visible.trim().toLowerCase() === slashCommand) {
		return CLEANSLATE_SLASH_COMMAND_TITLES.get(slashCommand) || visible;
	}

	return visible;
}

export function normalizeCleanSlateVisibleWhitespace(value: string): string {
	let result = '';
	let pendingSpace = false;

	for (const char of value) {
		if (isCleanSlateWhitespace(char)) {
			pendingSpace = result.length > 0;
			continue;
		}

		if (pendingSpace) {
			result += ' ';
			pendingSpace = false;
		}
		result += char;
	}

	return result.trim();
}

function normalizeCleanSlateLineEndings(value: string): string {
	return value.split('\r\n').join('\n').split('\r').join('\n');
}

function getTextBeforeAttachedContext(value: string): string {
	const keptLines: string[] = [];
	for (const line of value.split('\n')) {
		if (CLEANSLATE_SELECTION_CONTEXT_HEADERS.has(line.trim().toUpperCase())) {
			break;
		}
		keptLines.push(line);
	}
	return keptLines.join('\n').trim();
}

function getFirstCleanSlateLine(value: string): string {
	for (const line of value.split('\n')) {
		const trimmed = line.trim();
		if (trimmed) {
			return trimmed;
		}
	}
	return '';
}

function getKnownCleanSlateSlashCommand(value: string): string | undefined {
	const trimmed = value.trimStart();
	if (!trimmed.startsWith('/')) {
		return undefined;
	}

	let endIndex = 1;
	while (endIndex < trimmed.length && !isCleanSlateWhitespace(trimmed[endIndex])) {
		endIndex++;
	}

	const command = trimmed.slice(0, endIndex).toLowerCase();
	return CLEANSLATE_SLASH_COMMAND_TITLES.has(command) ? command : undefined;
}

function isCleanSlateWhitespace(char: string): boolean {
	return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}
