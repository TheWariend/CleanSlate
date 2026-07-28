/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Range } from '../core/range.js';
import { ISlateTextModel } from '../host/textModel.js';

export type CleanSlateValidatedMatchStrategy = 'exact' | 'normalized_quotes' | 'flexible_lines';
export type CleanSlateMatchValidationFailureCode = 'invalid_input' | 'no_match' | 'ambiguous_match' | 'low_confidence_match';

export interface CleanSlateMatchCandidate {
	range: Range;
	matchedText: string;
	strategy: CleanSlateValidatedMatchStrategy;
	matchCount: number;
	confidence: number;
	contextBeforeMatched: boolean;
	contextAfterMatched: boolean;
}

export interface CleanSlateMatchValidationOptions {
	modeLabel: 'replace_exact' | 'replace_range';
	contextBefore?: string;
	contextAfter?: string;
	allowFlexibleFallback?: boolean;
	minimumConfidence?: number;
	preferredRange?: Range;
	preferredRangeToleranceLines?: number;
	logger?: (message: string) => void;
}

export interface CleanSlateMatchValidationFailure {
	code: CleanSlateMatchValidationFailureCode;
	message: string;
	strategy?: CleanSlateValidatedMatchStrategy;
	snippet?: string;
	matchCount?: number;
	confidence?: number;
	allMatches?: Array<{ lineNumber: number; endLineNumber: number; lineContent: string; confidence: number }>;
}

export type CleanSlateMatchValidationResult =
	| { ok: true; match: CleanSlateMatchCandidate }
	| { ok: false; failure: CleanSlateMatchValidationFailure };

export class CleanSlateEditMatchValidator {
	public static validateUniqueTextMatch(
		model: ISlateTextModel,
		fileContents: string,
		searchText: string,
		options: CleanSlateMatchValidationOptions
	): CleanSlateMatchValidationResult {
		const cleanSearchText = this.normalizeLineEndings(searchText);
		if (!cleanSearchText.trim()) {
			return {
				ok: false,
				failure: {
					code: 'invalid_input',
					message: 'The requested edit did not include a usable target snippet.'
				}
			};
		}

		const strategies: Array<{ strategy: CleanSlateValidatedMatchStrategy; candidates: CleanSlateMatchCandidate[] }> = [
			{
				strategy: 'exact',
				candidates: this.findExactMatches(model, fileContents, cleanSearchText, options)
			},
			{
				strategy: 'normalized_quotes',
				candidates: this.findNormalizedQuoteMatches(model, fileContents, cleanSearchText, options)
			}
		];

		if (options.allowFlexibleFallback && this.countNonEmptyLines(cleanSearchText) > 1) {
			strategies.push({
				strategy: 'flexible_lines',
				candidates: this.findFlexibleMatches(model, fileContents, cleanSearchText, options)
			});
		}

		for (const { strategy, candidates } of strategies) {
			options.logger?.(`[CleanSlateEdit] ${options.modeLabel}: ${strategy} produced ${candidates.length} match(es).`);

			if (candidates.length > 1) {
				const preferredRangeCandidate = this.chooseCandidateByPreferredRange(candidates, options);
				if (preferredRangeCandidate) {
					const match = {
						...preferredRangeCandidate,
						confidence: Math.max(preferredRangeCandidate.confidence, Math.min(1, Number((preferredRangeCandidate.confidence + 0.04).toFixed(2))))
					};
					options.logger?.(`[CleanSlateEdit] ${options.modeLabel}: ${strategy} disambiguated ${candidates.length} matches by requested range; selected line ${match.range.startLineNumber}.`);
					if (match.confidence < (options.minimumConfidence ?? 0)) {
						return {
							ok: false,
							failure: {
								code: 'low_confidence_match',
								message: `The ${options.modeLabel} target was disambiguated by requested range, but confidence ${match.confidence.toFixed(2)} is below the required threshold.`,
								strategy,
								snippet: this.clipSnippet(cleanSearchText),
								matchCount: candidates.length,
								confidence: match.confidence
							}
						};
					}
					return { ok: true, match };
				}

				const rankedCandidates = [...candidates].sort((left, right) => {
					if (right.confidence !== left.confidence) {
						return right.confidence - left.confidence;
					}
					return left.range.startLineNumber - right.range.startLineNumber;
				});
				return {
					ok: false,
					failure: {
						code: 'ambiguous_match',
						message: `The edit target matched ${candidates.length} locations via ${strategy}. Matches found at lines: ${rankedCandidates.map(candidate => candidate.range.startLineNumber).join(', ')}. Retry with more current surrounding text in old_string, or set replace_all when every occurrence should change.`,
						strategy,
						snippet: this.clipSnippet(cleanSearchText),
						matchCount: candidates.length,
						allMatches: rankedCandidates.map(candidate => ({
							lineNumber: candidate.range.startLineNumber,
							endLineNumber: candidate.range.endLineNumber,
							lineContent: this.clipSnippet(candidate.matchedText, 60),
							confidence: candidate.confidence
						}))
					}
				};
			}

			if (candidates.length === 0) {
				continue;
			}

			const candidate = candidates[0];
			if (candidate.confidence < (options.minimumConfidence ?? 0)) {
				return {
					ok: false,
					failure: {
						code: 'low_confidence_match',
						message: `The edit target matched one location via ${strategy}, but confidence ${candidate.confidence.toFixed(2)} is below the required threshold. Re-read the current text and retry with a longer exact old_string.`,
						strategy,
						snippet: this.clipSnippet(cleanSearchText),
						matchCount: 1,
						confidence: candidate.confidence
					}
				};
			}

			return { ok: true, match: candidate };
		}

		return {
			ok: false,
			failure: {
				code: 'no_match',
				message: 'The requested old_string could not be found. Re-read the relevant current text and retry with an exact old_string copied from it.',
				snippet: this.clipSnippet(cleanSearchText),
				matchCount: 0
			}
		};
	}

	private static findExactMatches(
		model: ISlateTextModel,
		content: string,
		search: string,
		options: CleanSlateMatchValidationOptions
	): CleanSlateMatchCandidate[] {
		return this.findTextMatchesByIndex(model, content, search, 'exact', options);
	}

	private static findNormalizedQuoteMatches(
		model: ISlateTextModel,
		content: string,
		search: string,
		options: CleanSlateMatchValidationOptions
	): CleanSlateMatchCandidate[] {
		const normalizedContent = this.normalizeQuotes(this.normalizeLineEndings(content));
		const normalizedSearch = this.normalizeQuotes(this.normalizeLineEndings(search));
		return this.findTextMatchesByIndex(model, normalizedContent, normalizedSearch, 'normalized_quotes', options, content);
	}

	private static findTextMatchesByIndex(
		model: ISlateTextModel,
		searchSpace: string,
		searchText: string,
		strategy: CleanSlateValidatedMatchStrategy,
		options: CleanSlateMatchValidationOptions,
		sourceContentOverride?: string
	): CleanSlateMatchCandidate[] {
		if (!searchText.length) {
			return [];
		}

		const sourceContent = sourceContentOverride ?? model.getValue();
		const rawMatches: Array<{ range: Range; matchedText: string }> = [];
		const seen = new Set<string>();

		let offset = searchSpace.indexOf(searchText);
		while (offset !== -1) {
			const key = `${offset}:${offset + searchText.length}`;
			if (!seen.has(key)) {
				const start = model.getPositionAt(offset);
				const end = model.getPositionAt(offset + searchText.length);
				const range = new Range(start.lineNumber, start.column, end.lineNumber, end.column);
				rawMatches.push({
					range,
					matchedText: sourceContent.substring(offset, offset + searchText.length)
				});
				seen.add(key);
			}
			offset = searchSpace.indexOf(searchText, offset + Math.max(searchText.length, 1));
		}

		return this.filterAndScoreCandidates(model, rawMatches, searchText, strategy, options);
	}

	private static findFlexibleMatches(
		model: ISlateTextModel,
		content: string,
		search: string,
		options: CleanSlateMatchValidationOptions
	): CleanSlateMatchCandidate[] {
		const normalizedSearch = this.normalizeFlexible(this.normalizeQuotes(search));
		if (!normalizedSearch) {
			return [];
		}

		const contentLines = content.split('\n');
		const searchLines = normalizedSearch.split('\n');
		const rawMatches: Array<{ range: Range; matchedText: string }> = [];
		const seen = new Set<string>();

		for (let lineIndex = 0; lineIndex <= contentLines.length - searchLines.length; lineIndex++) {
			let isMatch = true;
			for (let searchLineIndex = 0; searchLineIndex < searchLines.length; searchLineIndex++) {
				const normalizedContentLine = contentLines[lineIndex + searchLineIndex].trim().replace(/[,\.;]$/, '').replace(/\s+/g, ' ');
				if (normalizedContentLine !== searchLines[searchLineIndex]) {
					isMatch = false;
					break;
				}
			}

			if (!isMatch) {
				continue;
			}

			const startLine = lineIndex + 1;
			const endLine = lineIndex + searchLines.length;
			const key = `${startLine}:${endLine}`;
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);

			const range = new Range(startLine, 1, endLine, model.getLineMaxColumn(endLine));
			rawMatches.push({
				range,
				matchedText: model.getValueInRange(range)
			});
		}

		return this.filterAndScoreCandidates(model, rawMatches, search, 'flexible_lines', options);
	}

	private static filterAndScoreCandidates(
		model: ISlateTextModel,
		rawMatches: Array<{ range: Range; matchedText: string }>,
		searchText: string,
		strategy: CleanSlateValidatedMatchStrategy,
		options: CleanSlateMatchValidationOptions
	): CleanSlateMatchCandidate[] {
		const candidates: CleanSlateMatchCandidate[] = [];

		for (const rawMatch of rawMatches) {
			const contextBeforeMatched = this.contextMatches(model, rawMatch.range.startLineNumber, 'before', options.contextBefore);
			const contextAfterMatched = this.contextMatches(model, rawMatch.range.endLineNumber, 'after', options.contextAfter);
			if (options.contextBefore && !contextBeforeMatched) {
				continue;
			}
			if (options.contextAfter && !contextAfterMatched) {
				continue;
			}

			const candidate: CleanSlateMatchCandidate = {
				range: rawMatch.range,
				matchedText: rawMatch.matchedText,
				strategy,
				matchCount: rawMatches.length,
				confidence: 0,
				contextBeforeMatched,
				contextAfterMatched
			};
			candidates.push(candidate);
		}

		return candidates.map(candidate => {
			const filteredCandidate = {
				...candidate,
				matchCount: candidates.length
			};
			return {
				...filteredCandidate,
				confidence: this.scoreCandidate(model, filteredCandidate, searchText, strategy, options)
			};
		});
	}

	private static chooseCandidateByPreferredRange(
		candidates: CleanSlateMatchCandidate[],
		options: CleanSlateMatchValidationOptions
	): CleanSlateMatchCandidate | undefined {
		const preferredRange = options.preferredRange;
		if (!preferredRange) {
			return undefined;
		}

		const preferredLineSpan = Math.max(1, preferredRange.endLineNumber - preferredRange.startLineNumber + 1);
		const tolerance = options.preferredRangeToleranceLines ?? Math.max(6, preferredLineSpan + 4);
		const ranked = candidates
			.map(candidate => ({
				candidate,
				distance: this.lineDistance(candidate.range, preferredRange)
			}))
			.sort((left, right) => {
				if (left.distance !== right.distance) {
					return left.distance - right.distance;
				}
				if (right.candidate.confidence !== left.candidate.confidence) {
					return right.candidate.confidence - left.candidate.confidence;
				}
				return left.candidate.range.startLineNumber - right.candidate.range.startLineNumber;
			});

		const best = ranked[0];
		if (!best || best.distance > tolerance) {
			return undefined;
		}

		const second = ranked[1];
		if (second && second.distance === best.distance) {
			return undefined;
		}

		return best.candidate;
	}

	private static lineDistance(candidateRange: Range, preferredRange: Range): number {
		const overlaps = candidateRange.startLineNumber <= preferredRange.endLineNumber
			&& candidateRange.endLineNumber >= preferredRange.startLineNumber;
		if (overlaps) {
			return 0;
		}

		if (candidateRange.endLineNumber < preferredRange.startLineNumber) {
			return preferredRange.startLineNumber - candidateRange.endLineNumber;
		}

		return candidateRange.startLineNumber - preferredRange.endLineNumber;
	}

	private static contextMatches(model: ISlateTextModel, anchorLine: number, direction: 'before' | 'after', contextText: string | undefined): boolean {
		if (!contextText?.trim()) {
			return false;
		}

		const contextLines = this.normalizeLineEndings(contextText)
			.split('\n')
			.filter(line => line.trim().length > 0);
		if (contextLines.length === 0) {
			return false;
		}

		const startLine = direction === 'before'
			? anchorLine - contextLines.length
			: anchorLine + 1;
		const endLine = startLine + contextLines.length - 1;
		if (startLine < 1 || endLine > model.getLineCount()) {
			return false;
		}

		const actualContext = Array.from({ length: contextLines.length }, (_, index) => model.getLineContent(startLine + index).trim()).join('\n');
		const expectedContext = contextLines.map(line => line.trim()).join('\n');
		return actualContext === expectedContext;
	}

	private static scoreCandidate(
		model: ISlateTextModel,
		candidate: CleanSlateMatchCandidate,
		searchText: string,
		strategy: CleanSlateValidatedMatchStrategy,
		options: CleanSlateMatchValidationOptions
	): number {
		let score = strategy === 'exact'
			? 0.82
			: strategy === 'normalized_quotes'
				? 0.76
				: 0.72;

		if (candidate.matchCount === 1) {
			score += 0.1;
		}

		const nonEmptySearchLineCount = this.countNonEmptyLines(searchText);
		if (nonEmptySearchLineCount >= 3) {
			score += 0.05;
		} else if (nonEmptySearchLineCount >= 2) {
			score += 0.03;
		}

		if (options.contextBefore && candidate.contextBeforeMatched) {
			score += 0.05;
		}
		if (options.contextAfter && candidate.contextAfterMatched) {
			score += 0.05;
		}

		if (this.hasStructuralAlignment(model, candidate.range, searchText)) {
			score += 0.04;
		}

		if (model.getLineCount() >= 500 && nonEmptySearchLineCount < 2 && !options.contextBefore && !options.contextAfter) {
			score -= 0.12; // Reduced penalty from 0.2 to 0.12 to allow more single-line edits
		}

		return Math.max(0, Math.min(1, Number(score.toFixed(2))));
	}

	private static hasStructuralAlignment(model: ISlateTextModel, range: Range, searchText: string): boolean {
		const startsAtLineBoundary = range.startColumn === 1;
		const endsAtLineBoundary = range.endColumn === model.getLineMaxColumn(range.endLineNumber);
		const hasStructuralSyntax = /(\bclass\b|\bfunction\b|\binterface\b|\benum\b|\bstruct\b|\btrait\b|\bdef\b|[{}])/.test(searchText);
		return hasStructuralSyntax && (startsAtLineBoundary || endsAtLineBoundary);
	}

	private static countNonEmptyLines(text: string): number {
		return this.normalizeLineEndings(text)
			.split('\n')
			.filter(line => line.trim().length > 0)
			.length;
	}

	private static normalizeQuotes(str: string): string {
		return str
			.replaceAll('‘', "'")
			.replaceAll('’', "'")
			.replaceAll('“', '"')
			.replaceAll('”', '"');
	}

	private static normalizeLineEndings(str: string): string {
		return str.replace(/\r\n/g, '\n');
	}

	private static normalizeFlexible(str: string): string {
		return str.split('\n')
			.map(line => line.trim().replace(/[,\.;]$/, ''))
			.filter(line => line.length > 0)
			.map(line => line.replace(/\s+/g, ' '))
			.join('\n');
	}

	private static clipSnippet(value: string, maxLength: number = 120): string {
		if (value.length <= maxLength) {
			return value;
		}
		return `${value.slice(0, maxLength)}...`;
	}
}
