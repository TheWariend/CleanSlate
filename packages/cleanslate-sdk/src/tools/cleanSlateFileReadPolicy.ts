/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Tool-output ceiling so one read cannot dominate every later turn. */
export const CLEANSLATE_MAX_FULL_FILE_READ_BYTES = 50 * 1024;
/** 50 KiB at the conservative three-bytes-per-token source estimate. */
export const CLEANSLATE_ABSOLUTE_MAX_FILE_READ_TOKENS = Math.ceil(CLEANSLATE_MAX_FULL_FILE_READ_BYTES / 3);
/**
 * Reads never starve below this even when the prompt-size estimate says the
 * context window is exhausted. The estimate is deliberately conservative
 * (UTF-8 bytes / 3 overstates real tokenizers), so a hard zero here produced
 * useless single-digit-byte budgets that stalled agent runs; if the window is
 * truly full the provider rejects the request and compaction handles it.
 */
export const CLEANSLATE_MIN_FILE_READ_TOKENS = 2_000;
export const CLEANSLATE_MAX_FILE_READ_LINES = 1_000;
export const CLEANSLATE_FILE_READ_CONTEXT_FRACTION = 0.15;
export const CLEANSLATE_FILE_READ_AVAILABLE_FRACTION = 0.5;
/** Conservative provider-independent fallback for source text. */
export const CLEANSLATE_FILE_READ_BYTES_PER_TOKEN = 3;

export interface ICleanSlateFileReadBudget {
	maxBytes: number;
	maxTokens: number;
	contextWindowTokens: number;
	availableInputTokens: number;
}

export function estimateCleanSlateUtf8Bytes(value: string): number {
	let bytes = 0;
	for (let index = 0; index < value.length; index++) {
		const codeUnit = value.charCodeAt(index);
		if (codeUnit < 0x80) {
			bytes += 1;
		} else if (codeUnit < 0x800) {
			bytes += 2;
		} else if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF && index + 1 < value.length) {
			const next = value.charCodeAt(index + 1);
			if (next >= 0xDC00 && next <= 0xDFFF) {
				bytes += 4;
				index++;
			} else {
				bytes += 3;
			}
		} else {
			bytes += 3;
		}
	}
	return bytes;
}

export function estimateCleanSlateFileReadTokens(value: string): number {
	return Math.ceil(estimateCleanSlateUtf8Bytes(value) / CLEANSLATE_FILE_READ_BYTES_PER_TOKEN);
}

export function resolveCleanSlateFileReadBudget(
	contextWindowTokens: number,
	availableInputTokens: number
): ICleanSlateFileReadBudget {
	const safeContextWindow = Math.max(1, Math.floor(contextWindowTokens));
	const safeAvailableInput = Math.max(1, Math.min(safeContextWindow, Math.floor(availableInputTokens)));
	const maxTokens = Math.max(CLEANSLATE_MIN_FILE_READ_TOKENS, Math.floor(Math.min(
		CLEANSLATE_ABSOLUTE_MAX_FILE_READ_TOKENS,
		safeContextWindow * CLEANSLATE_FILE_READ_CONTEXT_FRACTION,
		safeAvailableInput * CLEANSLATE_FILE_READ_AVAILABLE_FRACTION
	)));
	return {
		maxBytes: Math.min(CLEANSLATE_MAX_FULL_FILE_READ_BYTES, maxTokens * CLEANSLATE_FILE_READ_BYTES_PER_TOKEN),
		maxTokens,
		contextWindowTokens: safeContextWindow,
		availableInputTokens: safeAvailableInput
	};
}

export interface ICleanSlateBoundedLineSlice {
	content: string;
	endExclusive: number;
	oversizedFirstLine: boolean;
}

export function takeCleanSlateBoundedLineSlice(
	lines: readonly string[],
	startIndex: number,
	endExclusive: number,
	maxBytes: number
): ICleanSlateBoundedLineSlice {
	const selected: string[] = [];
	let byteCount = 0;

	for (let index = startIndex; index < endExclusive; index++) {
		const line = lines[index] ?? '';
		const additionalBytes = estimateCleanSlateUtf8Bytes(line) + (selected.length > 0 ? 1 : 0);
		if (byteCount + additionalBytes > maxBytes) {
			return {
				content: selected.join('\n'),
				endExclusive: index,
				oversizedFirstLine: selected.length === 0
			};
		}
		selected.push(line);
		byteCount += additionalBytes;
	}

	return {
		content: selected.join('\n'),
		endExclusive,
		oversizedFirstLine: false
	};
}
