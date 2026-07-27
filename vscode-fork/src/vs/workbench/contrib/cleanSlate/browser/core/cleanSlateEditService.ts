/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as TreeSitter from '@vscode/tree-sitter-wasm';
import { ITextModel } from '../../../../../editor/common/model.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { CleanSlateDiffService } from './cleanSlateDiffService.js';
import { URI } from '../../../../../base/common/uri.js';
import { IMarker, IMarkerService, MarkerSeverity } from '../../../../../platform/markers/common/markers.js';
import { ITreeSitterLibraryService } from '../../../../../editor/common/services/treeSitter/treeSitterLibraryService.js';
import { CleanSlateEditMatchValidator, CleanSlateValidatedMatchStrategy } from './cleanSlateEditMatchValidator.js';

export type CleanSlateEditFailureCode =
	| 'invalid_input'
	| 'no_match'
	| 'ambiguous_match'
	| 'no_op'
	| 'file_changed'
	| 'overlapping_edits'
	| 'unsafe_large_deletion'
	| 'range_requires_original_text'
	| 'range_too_broad_for_source_code'
	| 'symbol_snippet_not_found'
	| 'structural_target_required'
	| 'structural_validation_failed'
	| 'low_confidence_match';

export type CleanSlateEditStrategy =
	| CleanSlateValidatedMatchStrategy
	| 'fuzzy_lines'
	| 'replace_range'
	| 'resynced_range'
	| 'full_file';

export type CleanSlatePreferredRecoveryMode = 'replace_symbol' | 'replace_range' | 'replace_exact';

export interface CleanSlateEditDiagnostic {
	code: CleanSlateEditFailureCode;
	message: string;
	blockIndex?: number;
	strategy?: CleanSlateEditStrategy;
	snippet?: string;
	matchCount?: number;
	confidence?: number;
	fallbackHint?: string;
	allMatches?: Array<{ lineNumber: number; endLineNumber: number; lineContent: string; confidence: number }>;
	preferredRecoveryMode?: CleanSlatePreferredRecoveryMode;
}

export interface CleanSlatePlannedEdit {
	range: Range;
	text: string;
	blockIndex: number;
	originalTextSnippet: string;
	strategy: CleanSlateEditStrategy;
	sourceMode?: CleanSlateStructuredEdit['mode'];
	confidence?: number;
	matchCount?: number;
}

export interface CleanSlateStructuredEdit {
	mode: 'replace_exact' | 'replace_range' | 'replace_symbol' | 'full_file';
	originalText?: string;
	replacementText?: string;
	symbolName?: string;
	symbolPath?: string[];
	structuralOrigin?: 'symbol' | 'tree_sitter_declaration';
	content?: string;
	contextBefore?: string;
	contextAfter?: string;
	startLine?: number;
	startColumn?: number;
	endLine?: number;
	endColumn?: number;
}

export interface CleanSlateMarkerValidationBaseline {
	signatures: Map<string, number>;
}

export interface CleanSlateMarkerValidationIssue {
	resource: string;
	severity: string;
	message: string;
	startLineNumber: number;
	startColumn: number;
	endLineNumber: number;
	endColumn: number;
	source?: string;
	code?: string;
}

export interface CleanSlateMarkerRefreshWaiter {
	wait(): Promise<void>;
	dispose(): void;
}

export interface CleanSlateMarkerValidationResult {
	ok: boolean;
	issues: CleanSlateMarkerValidationIssue[];
}

export interface CleanSlateEditPlanRequest {
	edits?: CleanSlateStructuredEdit[];
	expectedVersionId?: number;
}

export interface CleanSlateEditPlanResult {
	ok: boolean;
	inputKind: 'structured';
	summary: string;
	edits: CleanSlatePlannedEdit[];
	diagnostics: CleanSlateEditDiagnostic[];
	warnings: CleanSlateEditDiagnostic[];
}

interface MatchCandidate {
	range: Range;
	matchedText: string;
	strategy: CleanSlateEditStrategy;
	matchCount: number;
	confidence: number;
}

interface TreeSitterSyntaxErrorSummary {
	hasErrors: boolean;
	errorNodeCount: number;
	firstErrorType?: string;
	firstErrorLine?: number;
	firstErrorColumn?: number;
}

export class CleanSlateEditService {

	private static readonly MIN_CONTEXTUAL_EXACT_LINES = 5;
	private static readonly MARKER_VALIDATION_TIMEOUT_MS = 1200;

	/**
	 * Collapses typographic quotes to their ASCII equivalents so text written by
	 * a model (which emits straight quotes) can be compared against file content
	 * that may use curly ones.
	 */
	public static normalizeQuotes(str: string): string {
		return str.replace(/[‘’]/g, '\'').replace(/[“”]/g, '"');
	}

	/**
	 * Typographic quotes come in directional pairs, so a straight quote can only
	 * be restored once we know whether it opened or closed a span. Rather than
	 * inspect each character's neighbours, walk the text once per quote kind and
	 * alternate: the first occurrence opens, the next closes, and so on. An
	 * apostrophe inside a word (`don't`) is never a span boundary, so it is
	 * always the closing form and does not flip the alternation.
	 */
	private static readonly CURLY_BY_KIND = {
		'"': { open: '“', close: '”' },
		'\'': { open: '‘', close: '’' }
	} as const;

	private static restoreCurlyQuotes(text: string, kind: '"' | '\''): string {
		const { open, close } = CleanSlateEditService.CURLY_BY_KIND[kind];
		const isWordChar = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}]/u.test(char);

		let out = '';
		let expectingOpen = true;
		for (let i = 0; i < text.length; i++) {
			const char = text[i];
			if (char !== kind) {
				out += char;
				continue;
			}
			// Word-internal apostrophe: a contraction, not a quoted span.
			if (kind === '\'' && isWordChar(text[i - 1]) && isWordChar(text[i + 1])) {
				out += close;
				continue;
			}
			out += expectingOpen ? open : close;
			expectingOpen = !expectingOpen;
		}
		return out;
	}

	/**
	 * The model writes straight quotes even when the file uses typographic ones.
	 * When matching had to normalize the file text to find the target, the
	 * replacement must be converted back so the edit does not silently rewrite
	 * the file's punctuation.
	 */
	public static preserveQuoteStyle(oldString: string, actualOldString: string, newString: string): string {
		if (oldString === actualOldString) {
			return newString;
		}

		let result = newString;
		for (const kind of ['"', '\''] as const) {
			const { open, close } = CleanSlateEditService.CURLY_BY_KIND[kind];
			if (actualOldString.includes(open) || actualOldString.includes(close)) {
				result = CleanSlateEditService.restoreCurlyQuotes(result, kind);
			}
		}
		return result;
	}

	public static planEdits(model: ITextModel, request: CleanSlateEditPlanRequest): CleanSlateEditPlanResult {
		const normalizedRequest = request;
		if (normalizedRequest.expectedVersionId !== undefined && normalizedRequest.expectedVersionId !== model.getVersionId()) {
			return this.failure([
				this.createDiagnostic(
					'file_changed',
					`The file changed since the edit was prepared. Expected version ${normalizedRequest.expectedVersionId}, but the current version is ${model.getVersionId()}. Re-read the file and retry.`
				)
			]);
		}

		if (Array.isArray(normalizedRequest.edits) && normalizedRequest.edits.length > 0) {
			return this.planStructuredEdits(model, normalizedRequest.edits, typeof normalizedRequest.expectedVersionId === 'number');
		}

		return this.failure([
			this.createDiagnostic('invalid_input', 'apply_edit requires a non-empty structured "edits" array.')
		]);
	}

	public static async validatePlannedEditsAsync(
		model: ITextModel,
		plannedEdits: CleanSlatePlannedEdit[],
		treeSitterLibraryService?: ITreeSitterLibraryService
	): Promise<CleanSlateEditDiagnostic | undefined> {
		const structuralDiagnostic = this.findStructuralIntegrityDiagnostic(model, plannedEdits);
		if (structuralDiagnostic) {
			return structuralDiagnostic;
		}

		if (!treeSitterLibraryService || plannedEdits.length === 0 || !this.isCodeLikeResource(model.uri)) {
			return undefined;
		}

		const previewContent = this.computePreviewContent(model, plannedEdits);
		return this.findTreeSitterStructuralDiagnostic(model, previewContent, treeSitterLibraryService);
	}

	public static computeEdits(model: ITextModel, request: CleanSlateEditPlanRequest): { range: Range, text: string }[] {
		const plan = this.planEdits(model, request);
		if (!plan.ok) {
			throw new Error(this.formatFailure(plan));
		}
		return plan.edits.map(edit => ({ range: edit.range, text: edit.text }));
	}

	public static formatFailure(result: CleanSlateEditPlanResult): string {
		if (result.ok) {
			return result.summary;
		}

		const detail = result.diagnostics
			.map((diagnostic, index) => {
				const hintLine = diagnostic.fallbackHint ? `\n   Hint: ${diagnostic.fallbackHint}` : '';
				return `${index + 1}. [${diagnostic.code}] ${diagnostic.message}${hintLine}`;
			})
			.join('\n');

		return detail ? `${result.summary}\n${detail}` : result.summary;
	}

	public static buildRecoveryHint(diagnostic?: CleanSlateEditDiagnostic, model?: ITextModel): string {
		switch (diagnostic?.code) {
			case 'no_match': {
				const isLargeFile = model && model.getLineCount() > 1000;
				return isLargeFile
					? 'The target was not found in the current large file. Re-read the relevant current text, then retry with an exact old_string copied from that result.'
					: 'Re-read the relevant current text and retry with an exact old_string copied from that result.';
			}
			case 'ambiguous_match':
				return 'Found multiple matches for old_string. Add only enough current surrounding text to make old_string unique, or set replace_all when every occurrence should change.';
			case 'file_changed':
				return 'The file changed outside this edit operation. Re-read its current text and retry with a current old_string.';
			case 'no_op':
				return 'The requested replacement already matches the file. Skip it or verify the target.';
			case 'overlapping_edits':
				return 'Split the overlapping edits into smaller non-overlapping operations and retry.';
			case 'unsafe_large_deletion':
				return 'Use smaller targeted replacements instead of one large deletion, then retry.';
			case 'structural_validation_failed':
				return 'The edit would corrupt delimiter structure. Re-read the surrounding code and retry with a balanced replacement.';
			case 'symbol_snippet_not_found':
				return 'The legacy target was not found. Re-read the relevant current text and retry through apply_edit with an exact old_string.';
			case 'structural_target_required':
				return 'Retry through apply_edit with an exact current old_string that uniquely identifies the intended declaration.';
			case 'low_confidence_match':
				return 'The target was not safe enough to edit. Re-read the relevant current text and retry with a longer unique old_string.';
			default:
				return 'Inspect the diagnostics, re-read the file only if the current text is unknown, and retry with a precise old_string.';
		}
	}

	private static planStructuredEdits(model: ITextModel, edits: CleanSlateStructuredEdit[], hasVersionGuard: boolean): CleanSlateEditPlanResult {
		const plannedEdits: CleanSlatePlannedEdit[] = [];
		const diagnostics: CleanSlateEditDiagnostic[] = [];
		const fileContents = model.getValue();

		for (let idx = 0; idx < edits.length; idx++) {
			const edit = edits[idx];

			switch (edit.mode) {
				case 'replace_exact': {
					if (typeof edit.originalText !== 'string' || typeof edit.replacementText !== 'string') {
						diagnostics.push(this.createDiagnostic(
							'invalid_input',
							'Structured edit mode "replace_exact" requires both "originalText" and "replacementText".',
							idx,
							'exact'
						));
						continue;
					}

					const resolution = this.resolveUniqueMatch(model, fileContents, edit.originalText, idx, 'replace_exact', {
						contextBefore: edit.contextBefore,
						contextAfter: edit.contextAfter,
						allowFlexibleFallback: false,
						minimumConfidence: this.getMinimumConfidenceForExact(model, edit)
					});
					if (!resolution.ok) {
						diagnostics.push(resolution.diagnostic);
						continue;
					}

					this.logEditDecision(`replace_exact accepted via ${resolution.match.strategy}; matches=${resolution.match.matchCount}; confidence=${resolution.match.confidence.toFixed(2)}.`);
					plannedEdits.push({
						range: resolution.match.range,
						text: this.preserveQuoteStyle(edit.originalText, resolution.match.matchedText, edit.replacementText),
						blockIndex: idx,
						originalTextSnippet: this.clipSnippet(edit.originalText.trim()),
						strategy: resolution.match.strategy,
						sourceMode: 'replace_exact',
						confidence: resolution.match.confidence,
						matchCount: resolution.match.matchCount
					});
					continue;
				}

				case 'replace_range': {
					const range = this.createRangeFromStructuredEdit(model, edit, idx);
					if (!range.ok) {
						diagnostics.push(range.diagnostic);
						continue;
					}

					const replacementText = edit.replacementText ?? '';
					let plannedRange = range.range;
					let originalTextSnippet = this.clipSnippet(model.getValueInRange(plannedRange));
					let strategy: CleanSlateEditStrategy = 'replace_range';
					let confidence = this.scoreRangeConfidence(model, edit, plannedRange, hasVersionGuard);

					if (this.requiresOriginalTextForRange(model, edit, plannedRange, hasVersionGuard)) {
						diagnostics.push(this.createDiagnostic(
							'range_requires_original_text',
							'Large multi-line replace_range edits require originalText, expectedVersionId, or structuralOrigin to prevent stale-coordinate edits.',
							idx,
							'replace_range',
							this.clipSnippet(model.getValueInRange(plannedRange)),
							undefined,
							confidence,
							'fallback_orchestration: re-read the range, attach originalText, or use replace_symbol.'
						));
						this.logEditDecision('replace_range rejected: missing drift guard for large multi-line edit.');
						continue;
					}

					if (typeof edit.originalText === 'string') {
						const currentText = model.getValueInRange(plannedRange);
						if (this.normalizeLineEndings(currentText) !== this.normalizeLineEndings(edit.originalText)) {
							const resyncedMatch = this.resolveUniqueMatch(model, fileContents, edit.originalText, idx, 'replace_range', {
								contextBefore: edit.contextBefore,
								contextAfter: edit.contextAfter,
								// Tolerate whitespace/indentation/trailing-punctuation drift, the most common cause
								// of a replace_range no_match. Still uniqueness- and confidence-guarded below.
								allowFlexibleFallback: true,
								minimumConfidence: 0.78,
								preferredRange: plannedRange,
								preferredRangeToleranceLines: Math.max(6, plannedRange.endLineNumber - plannedRange.startLineNumber + 5)
							});
							if (!resyncedMatch.ok || (resyncedMatch.match.strategy !== 'exact' && resyncedMatch.match.strategy !== 'normalized_quotes' && resyncedMatch.match.strategy !== 'flexible_lines')) {
								diagnostics.push(!resyncedMatch.ok
									? {
										...resyncedMatch.diagnostic,
										message: `The provided range no longer matches the expected original text. ${resyncedMatch.diagnostic.message}`
									}
									: this.createDiagnostic(
										'file_changed',
										`The provided range no longer matches the expected original text, and the original text could not be re-synced by an exact match. Re-read the current range and retry.`,
										idx,
										'replace_range',
										this.clipSnippet(edit.originalText)
									));
								continue;
							}
							plannedRange = resyncedMatch.match.range;
							originalTextSnippet = this.clipSnippet(resyncedMatch.match.matchedText);
							strategy = 'resynced_range';
							confidence = resyncedMatch.match.confidence;
							this.logEditDecision(`replace_range resynced via ${resyncedMatch.match.strategy}; matches=${resyncedMatch.match.matchCount}; confidence=${resyncedMatch.match.confidence.toFixed(2)}.`);
						}
					}

					this.logEditDecision(`replace_range accepted; confidence=${confidence.toFixed(2)}; structuralOrigin=${edit.structuralOrigin ?? 'none'}.`);
					plannedEdits.push({
						range: plannedRange,
						text: typeof edit.originalText === 'string' ? this.preserveQuoteStyle(edit.originalText, model.getValueInRange(plannedRange), replacementText) : replacementText,
						blockIndex: idx,
						originalTextSnippet,
						strategy,
						sourceMode: 'replace_range',
						confidence,
						matchCount: 1
					});
					continue;
				}

				case 'full_file': {
					const newContent = edit.content ?? edit.replacementText;
					if (typeof newContent !== 'string') {
						diagnostics.push(this.createDiagnostic(
							'invalid_input',
							'Structured edit mode "full_file" requires "content" or "replacementText".',
							idx,
							'full_file'
						));
						continue;
					}

					const diffPlan = this.planFullFileReplacement(model, newContent, idx);
					if (!diffPlan.ok) {
						diagnostics.push(diffPlan.diagnostic);
						continue;
					}
					plannedEdits.push(...diffPlan.edits);
					this.logEditDecision(`full_file reduced to ${diffPlan.edits.length} minimal diff block(s).`);
					continue;
				}

				case 'replace_symbol': {
					// This should normally be handled by symbolEditResolver.ts,
					// but we add it here for robustness if the resolver is bypassed.
					diagnostics.push(this.createDiagnostic(
						'invalid_input',
						'Structured edit mode "replace_symbol" requires pre-resolution by a symbol provider. Re-read the symbols and retry.',
						idx,
						undefined,
						edit.symbolName
					));
					continue;
				}

				default: {
					diagnostics.push(this.createDiagnostic(
						'invalid_input',
						`Unsupported structured edit mode "${(edit as CleanSlateStructuredEdit).mode}".`,
						idx
					));
					continue;
				}
			}
		}

		return this.finalizePlan(model, plannedEdits, diagnostics);
	}

	private static finalizePlan(
		model: ITextModel,
		plannedEdits: CleanSlatePlannedEdit[],
		diagnostics: CleanSlateEditDiagnostic[]
	): CleanSlateEditPlanResult {
		const overlapDiagnostic = this.findOverlapDiagnostic(model, plannedEdits);
		if (overlapDiagnostic) {
			diagnostics.push(overlapDiagnostic);
		}

		if (diagnostics.length > 0) {
			return this.failure(diagnostics);
		}

		const finalEdits = plannedEdits.filter(edit => model.getValueInRange(edit.range) !== edit.text);
		if (finalEdits.length === 0) {
			return this.success([], 'NO_OP: The requested edits already match the file content.');
		}

		return this.success(finalEdits, `Prepared ${finalEdits.length} edit${finalEdits.length === 1 ? '' : 's'} safely.`);
	}

	private static success(
		edits: CleanSlatePlannedEdit[],
		summary: string
	): CleanSlateEditPlanResult {
		return {
			ok: true,
			inputKind: 'structured',
			summary,
			edits,
			diagnostics: [],
			warnings: []
		};
	}

	private static failure(diagnostics: CleanSlateEditDiagnostic[]): CleanSlateEditPlanResult {
		const primary = diagnostics[0];
		const summary = primary
			? `Edit planning failed with ${diagnostics.length} issue${diagnostics.length === 1 ? '' : 's'}.`
			: 'Edit planning failed.';

		return {
			ok: false,
			inputKind: 'structured',
			summary,
			edits: [],
			diagnostics,
			warnings: []
		};
	}

	private static createDiagnostic(
		code: CleanSlateEditFailureCode,
		message: string,
		blockIndex?: number,
		strategy?: CleanSlateEditStrategy,
		snippet?: string,
		matchCount?: number,
		confidence?: number,
		fallbackHint?: string,
		extra?: Partial<Pick<CleanSlateEditDiagnostic, 'allMatches' | 'preferredRecoveryMode'>>
	): CleanSlateEditDiagnostic {
		return { code, message, blockIndex, strategy, snippet, matchCount, confidence, fallbackHint, ...extra };
	}

	private static resolveUniqueMatch(
		model: ITextModel,
		fileContents: string,
		searchText: string,
		blockIndex: number,
		strategyHint: 'replace_exact' | 'replace_range',
		options: {
			contextBefore?: string;
			contextAfter?: string;
			allowFlexibleFallback?: boolean;
			minimumConfidence?: number;
			preferredRange?: Range;
			preferredRangeToleranceLines?: number;
		} = {}
	): { ok: true; match: MatchCandidate } | { ok: false; diagnostic: CleanSlateEditDiagnostic } {
		const validation = CleanSlateEditMatchValidator.validateUniqueTextMatch(
			model,
			fileContents,
			searchText,
			{
				modeLabel: strategyHint,
				contextBefore: options.contextBefore,
				contextAfter: options.contextAfter,
				allowFlexibleFallback: options.allowFlexibleFallback,
				minimumConfidence: options.minimumConfidence,
				preferredRange: options.preferredRange,
				preferredRangeToleranceLines: options.preferredRangeToleranceLines,
				logger: message => this.logEditDecision(message)
			}
		);

		if (validation.ok) {
			return {
				ok: true,
				match: validation.match
			};
		}

		const preferredRecoveryMode = this.inferPreferredRecoveryMode(model, searchText, strategyHint);
		return {
			ok: false,
			diagnostic: this.createDiagnostic(
				validation.failure.code,
				validation.failure.message,
				blockIndex,
				validation.failure.strategy,
				validation.failure.snippet,
				validation.failure.matchCount,
				validation.failure.confidence,
				this.buildFailureFallbackHint(preferredRecoveryMode),
				{
					allMatches: validation.failure.allMatches,
					preferredRecoveryMode
				}
			)
		};
	}

	private static inferPreferredRecoveryMode(
		model: ITextModel,
		searchText: string,
		strategyHint: 'replace_exact' | 'replace_range'
	): CleanSlatePreferredRecoveryMode {
		if (!this.isCodeLikeResource(model.uri)) {
			return 'replace_exact';
		}

		if (strategyHint === 'replace_range') {
			return 'replace_range';
		}

		return 'replace_exact';
	}

	private static buildFailureFallbackHint(preferredRecoveryMode: CleanSlatePreferredRecoveryMode): string {
		return 'Recovery path: use a larger current old_string that uniquely identifies the intended occurrence, or set replace_all when every occurrence should change.';
	}

	private static getMinimumConfidenceForExact(model: ITextModel, edit: CleanSlateStructuredEdit): number {
		if (!this.isCodeLikeResource(model.uri)) {
			return 0.7;
		}

		if (model.getLineCount() >= 5000) {
			return this.countNonEmptyLines(edit.originalText ?? '') >= this.MIN_CONTEXTUAL_EXACT_LINES || edit.contextBefore || edit.contextAfter
				? 0.82
				: 0.92;
		}

		return 0.72;
	}

	private static requiresOriginalTextForRange(model: ITextModel, edit: CleanSlateStructuredEdit, range: Range, hasVersionGuard: boolean): boolean {
		if (!this.isCodeLikeResource(model.uri) || model.getLineCount() < 500) {
			return false;
		}
		if (hasVersionGuard || edit.structuralOrigin || typeof edit.originalText === 'string') {
			return false;
		}
		return range.endLineNumber > range.startLineNumber;
	}

	private static scoreRangeConfidence(model: ITextModel, edit: CleanSlateStructuredEdit, range: Range, hasVersionGuard: boolean): number {
		let confidence = 0.78;
		if (hasVersionGuard) {
			confidence += 0.08;
		}
		if (edit.structuralOrigin === 'symbol') {
			confidence += 0.12;
		} else if (edit.structuralOrigin === 'tree_sitter_declaration') {
			confidence += 0.1;
		}
		if (typeof edit.originalText === 'string') {
			confidence += 0.08;
		}
		if (range.startColumn === 1 && range.endColumn === model.getLineMaxColumn(range.endLineNumber)) {
			confidence += 0.02;
		}
		return Math.max(0, Math.min(1, Number(confidence.toFixed(2))));
	}

	private static countNonEmptyLines(text: string): number {
		return text.replace(/\r\n/g, '\n')
			.split('\n')
			.filter(line => line.trim().length > 0)
			.length;
	}

	private static logEditDecision(message: string): void {
		console.info(`[CleanSlateEdit] ${message}`);
	}

	private static createRangeFromStructuredEdit(
		model: ITextModel,
		edit: CleanSlateStructuredEdit,
		blockIndex: number
	): { ok: true; range: Range } | { ok: false; diagnostic: CleanSlateEditDiagnostic } {
		const { startLine, endLine } = edit;
		if (startLine === undefined || endLine === undefined) {
			return {
				ok: false,
				diagnostic: this.createDiagnostic(
					'invalid_input',
					'Structured edit mode "replace_range" requires "startLine" and "endLine".',
					blockIndex,
					'replace_range'
				)
			};
		}

		const lineCount = model.getLineCount();
		if (startLine < 1 || endLine < startLine || endLine > lineCount) {
			return {
				ok: false,
				diagnostic: this.createDiagnostic(
					'invalid_input',
					`The requested range ${startLine}:${edit.startColumn ?? 1}-${endLine}:${edit.endColumn ?? model.getLineMaxColumn(endLine)} is outside the current file.`,
					blockIndex,
					'replace_range'
				)
			};
		}

		const startColumn = edit.startColumn ?? 1;
		const endColumn = edit.endColumn ?? model.getLineMaxColumn(endLine);
		return {
			ok: true,
			range: new Range(startLine, startColumn, endLine, endColumn)
		};
	}

	private static planFullFileReplacement(
		model: ITextModel,
		newContent: string,
		blockIndex: number
	): { ok: true; edits: CleanSlatePlannedEdit[] } | { ok: false; diagnostic: CleanSlateEditDiagnostic } {
		try {
			const changes = this.computeSmartDiff(model, newContent);
			return {
				ok: true,
				edits: changes.map(change => ({
					range: change.range,
					text: change.text,
					blockIndex,
					originalTextSnippet: '',
					strategy: 'full_file'
				}))
			};
		} catch (error: any) {
			const message = String(error);
			const code: CleanSlateEditFailureCode = message.includes('Safety Block')
				? 'unsafe_large_deletion'
				: 'invalid_input';
			return {
				ok: false,
				diagnostic: this.createDiagnostic(code, message, blockIndex, 'full_file')
			};
		}
	}

	private static findOverlapDiagnostic(model: ITextModel, plannedEdits: CleanSlatePlannedEdit[]): CleanSlateEditDiagnostic | undefined {
		const sortedEdits = [...plannedEdits].sort((a, b) => {
			const lineDelta = a.range.startLineNumber - b.range.startLineNumber;
			if (lineDelta !== 0) {
				return lineDelta;
			}
			return a.range.startColumn - b.range.startColumn;
		});

		for (let i = 0; i < sortedEdits.length - 1; i++) {
			const current = sortedEdits[i];
			const next = sortedEdits[i + 1];
			const currentEnd = model.getOffsetAt({
				lineNumber: current.range.endLineNumber,
				column: current.range.endColumn
			});
			const nextStart = model.getOffsetAt({
				lineNumber: next.range.startLineNumber,
				column: next.range.startColumn
			});

			if (nextStart <= currentEnd) {
				return this.createDiagnostic(
					'overlapping_edits',
					`Two edits target overlapping regions near line ${current.range.endLineNumber}. Split them into a single edit or use non-overlapping ranges.`,
					undefined,
					current.strategy
				);
			}
		}

		return undefined;
	}

	private static findStructuralIntegrityDiagnostic(model: ITextModel, plannedEdits: CleanSlatePlannedEdit[]): CleanSlateEditDiagnostic | undefined {
		if (!this.shouldValidateStructuralIntegrity(model, plannedEdits)) {
			return undefined;
		}

		const beforeScan = this.scanDelimiterIntegrity(model.getValue());
		if (beforeScan.ok) {
			const previewContent = this.computePreviewContent(model, plannedEdits);
			const afterScan = this.scanDelimiterIntegrity(previewContent);
			if (!afterScan.ok) {
				return this.createDiagnostic(
					'structural_validation_failed',
					`The planned edit would leave the file structurally unbalanced: ${afterScan.message}`,
					undefined,
					plannedEdits[0]?.strategy
				);
			}
		}

		return undefined;
	}

	private static async findTreeSitterStructuralDiagnostic(
		model: ITextModel,
		previewContent: string,
		treeSitterLibraryService: ITreeSitterLibraryService
	): Promise<CleanSlateEditDiagnostic | undefined> {
		if (!this.isCodeLikeResource(model.uri)) {
			return undefined;
		}

		const languageId = model.getLanguageId();
		if (!languageId) {
			return undefined;
		}

		let parser: TreeSitter.Parser | undefined;
		let beforeTree: TreeSitter.Tree | null | undefined;
		let afterTree: TreeSitter.Tree | null | undefined;

		try {
			const [ParserCtor, language] = await Promise.all([
				treeSitterLibraryService.getParserClass(),
				treeSitterLibraryService.getLanguagePromise(languageId)
			]);
			if (!language) {
				return undefined;
			}

			parser = new ParserCtor();
			parser.setLanguage(language);
			beforeTree = parser.parse(model.getValue());
			afterTree = parser.parse(previewContent);
			if (!beforeTree || !afterTree) {
				return undefined;
			}

			const beforeSummary = this.collectTreeSitterSyntaxErrorSummary(beforeTree);
			const afterSummary = this.collectTreeSitterSyntaxErrorSummary(afterTree);
			const introducedErrors = afterSummary.errorNodeCount - beforeSummary.errorNodeCount;

			if (!afterSummary.hasErrors) {
				return undefined;
			}

			if (!beforeSummary.hasErrors || introducedErrors > 0) {
				const location = afterSummary.firstErrorLine !== undefined && afterSummary.firstErrorColumn !== undefined
					? ` near ${afterSummary.firstErrorLine}:${afterSummary.firstErrorColumn}`
					: '';
				const errorType = afterSummary.firstErrorType ? ` (${afterSummary.firstErrorType})` : '';
				const issueCount = Math.max(1, introducedErrors > 0 ? introducedErrors : afterSummary.errorNodeCount);
				return this.createDiagnostic(
					'structural_validation_failed',
					`Tree-sitter preview detected ${issueCount} new syntax error node${issueCount === 1 ? '' : 's'}${location}${errorType}. Re-read the surrounding symbol and retry with a smaller, syntax-preserving edit.`
				);
			}
		} catch {
			return undefined;
		} finally {
			afterTree?.delete();
			beforeTree?.delete();
			parser?.delete();
		}

		return undefined;
	}

	private static shouldValidateStructuralIntegrity(model: ITextModel, plannedEdits: CleanSlatePlannedEdit[]): boolean {
		if (!this.isCodeLikeResource(model.uri)) {
			return false;
		}
		return plannedEdits.some(edit => {
			const originalText = model.getValueInRange(edit.range);
			return this.containsStructuralSyntax(originalText) || this.containsStructuralSyntax(edit.text);
		});
	}

	private static computePreviewContent(model: ITextModel, plannedEdits: CleanSlatePlannedEdit[]): string {
		let content = model.getValue();
		const editsByDescendingOffset = [...plannedEdits].sort((a, b) => {
			const aStart = model.getOffsetAt({ lineNumber: a.range.startLineNumber, column: a.range.startColumn });
			const bStart = model.getOffsetAt({ lineNumber: b.range.startLineNumber, column: b.range.startColumn });
			return bStart - aStart;
		});

		for (const edit of editsByDescendingOffset) {
			const startOffset = model.getOffsetAt({ lineNumber: edit.range.startLineNumber, column: edit.range.startColumn });
			const endOffset = model.getOffsetAt({ lineNumber: edit.range.endLineNumber, column: edit.range.endColumn });
			content = `${content.slice(0, startOffset)}${edit.text}${content.slice(endOffset)}`;
		}

		return content;
	}

	private static collectTreeSitterSyntaxErrorSummary(tree: TreeSitter.Tree): TreeSitterSyntaxErrorSummary {
		if (!tree.rootNode.hasError) {
			return {
				hasErrors: false,
				errorNodeCount: 0
			};
		}

		let errorNodeCount = 0;
		let firstErrorType: string | undefined;
		let firstErrorLine: number | undefined;
		let firstErrorColumn: number | undefined;
		const stack: TreeSitter.Node[] = [tree.rootNode];

		while (stack.length > 0) {
			const currentNode = stack.pop()!;
			if (currentNode.type === 'ERROR') {
				errorNodeCount++;
				if (firstErrorType === undefined) {
					firstErrorType = currentNode.type;
					firstErrorLine = currentNode.startPosition.row + 1;
					firstErrorColumn = currentNode.startPosition.column + 1;
				}
			}

			for (let childIndex = currentNode.children.length - 1; childIndex >= 0; childIndex--) {
				const childNode = currentNode.children[childIndex];
				if (childNode) {
					stack.push(childNode);
				}
			}
		}

		if (errorNodeCount === 0) {
			return {
				hasErrors: true,
				errorNodeCount: 1,
				firstErrorType: tree.rootNode.type,
				firstErrorLine: tree.rootNode.startPosition.row + 1,
				firstErrorColumn: tree.rootNode.startPosition.column + 1
			};
		}

		return {
			hasErrors: true,
			errorNodeCount,
			firstErrorType,
			firstErrorLine,
			firstErrorColumn
		};
	}

	private static scanDelimiterIntegrity(content: string): { ok: true } | { ok: false; message: string; line: number; column: number } {
		const openerByCloser = new Map<string, string>([
			[')', '('],
			[']', '['],
			['}', '{']
		]);
		const closerByOpener = new Map<string, string>([
			['(', ')'],
			['[', ']'],
			['{', '}']
		]);
		const stack: Array<{ char: string; line: number; column: number }> = [];
		let line = 1;
		let column = 1;
		let state: 'code' | 'lineComment' | 'blockComment' | 'singleQuote' | 'doubleQuote' | 'backtick' = 'code';
		let escaped = false;

		for (let i = 0; i < content.length; i++) {
			const char = content[i];
			const next = content[i + 1];

			if (state === 'lineComment') {
				if (char === '\n') {
					state = 'code';
				}
				({ line, column } = this.advanceTextPosition(char, line, column));
				continue;
			}

			if (state === 'blockComment') {
				if (char === '*' && next === '/') {
					i++;
					column += 2;
					state = 'code';
					continue;
				}
				({ line, column } = this.advanceTextPosition(char, line, column));
				continue;
			}

			if (state === 'singleQuote' || state === 'doubleQuote' || state === 'backtick') {
				const closingChar = state === 'singleQuote' ? '\'' : state === 'doubleQuote' ? '"' : '`';
				if (escaped) {
					escaped = false;
				} else if (char === '\\') {
					escaped = true;
				} else if (char === closingChar) {
					state = 'code';
				}
				({ line, column } = this.advanceTextPosition(char, line, column));
				continue;
			}

			if (char === '/' && next === '/') {
				i++;
				column += 2;
				state = 'lineComment';
				continue;
			}
			if (char === '/' && next === '*') {
				i++;
				column += 2;
				state = 'blockComment';
				continue;
			}
			if (char === '\'') {
				state = 'singleQuote';
				({ line, column } = this.advanceTextPosition(char, line, column));
				continue;
			}
			if (char === '"') {
				state = 'doubleQuote';
				({ line, column } = this.advanceTextPosition(char, line, column));
				continue;
			}
			if (char === '`') {
				state = 'backtick';
				({ line, column } = this.advanceTextPosition(char, line, column));
				continue;
			}

			if (closerByOpener.has(char)) {
				stack.push({ char, line, column });
			} else if (openerByCloser.has(char)) {
				const expectedOpener = openerByCloser.get(char);
				const actualOpener = stack.pop();
				if (!actualOpener || actualOpener.char !== expectedOpener) {
					return {
						ok: false,
						message: `unexpected "${char}" at ${line}:${column}`,
						line,
						column
					};
				}
			}

			({ line, column } = this.advanceTextPosition(char, line, column));
		}

		const unclosed = stack.pop();
		if (unclosed) {
			return {
				ok: false,
				message: `unclosed "${unclosed.char}" from ${unclosed.line}:${unclosed.column}`,
				line: unclosed.line,
				column: unclosed.column
			};
		}

		return { ok: true };
	}

	private static advanceTextPosition(char: string, line: number, column: number): { line: number; column: number } {
		if (char === '\n') {
			return { line: line + 1, column: 1 };
		}
		return { line, column: column + 1 };
	}

	private static containsStructuralSyntax(text: string): boolean {
		return /[{}()[\]]/.test(text);
	}

	private static isCodeLikeResource(uri: URI): boolean {
		const normalizedPath = uri.path.toLowerCase();
		return /\.(c|cc|cpp|cs|css|dart|go|h|hpp|java|js|jsx|kt|less|m|mm|php|rs|scss|swift|ts|tsx|vue)$/.test(normalizedPath);
	}

	public static captureMarkerValidationBaseline(markerService: IMarkerService, resource: URI): CleanSlateMarkerValidationBaseline {
		const signatures = new Map<string, number>();
		for (const marker of markerService.read({ resource, severities: MarkerSeverity.Error })) {
			const signature = this.markerValidationSignature(marker);
			signatures.set(signature, (signatures.get(signature) ?? 0) + 1);
		}
		return { signatures };
	}

	public static createMarkerRefreshWaiter(
		markerService: IMarkerService,
		resource: URI,
		timeoutMs: number = CleanSlateEditService.MARKER_VALIDATION_TIMEOUT_MS
	): CleanSlateMarkerRefreshWaiter {
		let finished = false;
		let resolveWait: () => void = () => { };
		const waitPromise = new Promise<void>(resolve => {
			resolveWait = resolve;
		});
		let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
		let disposable = markerService.onMarkerChanged(resources => {
			if (resources.some(changedResource => changedResource.toString() === resource.toString())) {
				finish();
			}
		});

		const finish = () => {
			if (finished) {
				return;
			}
			finished = true;
			if (timeoutHandle !== undefined) {
				clearTimeout(timeoutHandle);
				timeoutHandle = undefined;
			}
			disposable.dispose();
			resolveWait();
		};

		timeoutHandle = setTimeout(finish, timeoutMs);

		return {
			wait: () => waitPromise,
			dispose: finish
		};
	}

	public static async validateMarkersAfterEdit(
		markerService: IMarkerService,
		resource: URI,
		baseline: CleanSlateMarkerValidationBaseline,
		waiter?: CleanSlateMarkerRefreshWaiter
	): Promise<CleanSlateMarkerValidationResult> {
		if (waiter) {
			await waiter.wait();
			waiter.dispose();
		}

		const baselineRemaining = new Map<string, number>(baseline.signatures);
		const issues: CleanSlateMarkerValidationIssue[] = [];
		for (const marker of markerService.read({ resource, severities: MarkerSeverity.Error })) {
			const signature = this.markerValidationSignature(marker);
			const remainingCount = baselineRemaining.get(signature) ?? 0;
			if (remainingCount > 0) {
				baselineRemaining.set(signature, remainingCount - 1);
				continue;
			}
			issues.push(this.toMarkerValidationIssue(marker));
		}

		return {
			ok: issues.length === 0,
			issues
		};
	}

	public static async rollbackModelToContent(model: ITextModel, expectedContent: string): Promise<void> {
		try {
			await model.undo();
		} catch {
			// Fall back to direct restoration below.
		}

		if (model.getValue() === expectedContent) {
			return;
		}

		model.pushStackElement();
		model.pushEditOperations(null, [{ range: model.getFullModelRange(), text: expectedContent }], () => null);
		model.pushStackElement();
	}

	private static markerValidationSignature(marker: IMarker): string {
		const code = typeof marker.code === 'string' ? marker.code : marker.code?.value ?? '';
		return [
			marker.owner,
			marker.source ?? '',
			code,
			marker.severity,
			marker.message
		].join('\u241F');
	}

	private static toMarkerValidationIssue(marker: IMarker): CleanSlateMarkerValidationIssue {
		const code = typeof marker.code === 'string' ? marker.code : marker.code?.value;
		return {
			resource: marker.resource.fsPath,
			severity: MarkerSeverity.toString(marker.severity),
			message: marker.message,
			startLineNumber: marker.startLineNumber,
			startColumn: marker.startColumn,
			endLineNumber: marker.endLineNumber,
			endColumn: marker.endColumn,
			source: marker.source,
			code
		};
	}

	private static clipSnippet(value: string, maxLength: number = 120): string {
		if (value.length <= maxLength) {
			return value;
		}
		return `${value.slice(0, maxLength)}...`;
	}

	private static normalizeLineEndings(str: string): string {
		return str.replace(/\r\n/g, '\n');
	}

	private static computeSmartDiff(model: ITextModel, newContent: string): { range: Range, text: string }[] {
		const currentContent = model.getValue();
		const lineCount = model.getLineCount();

		const newLines = newContent.split('\n').length;
		const isNewContentSubstantial = newContent.length > (currentContent.length * 0.2) || newLines > 5;
		const isFileManageable = lineCount < 500;

		if (isNewContentSubstantial || isFileManageable) {
			const changes = CleanSlateDiffService.computeDiff(currentContent, newContent);

			const totalDeletedLines = changes.reduce((acc, edit) => {
				return acc + (edit.range.endLineNumber - edit.range.startLineNumber + 1);
			}, 0);

			const isDeletingMajority = totalDeletedLines > (lineCount * 0.85);
			const isShrinkingSignificantly = newContent.length < (currentContent.length * 0.2);

			if (isDeletingMajority && isShrinkingSignificantly) {
				throw new Error(`Safety Block: The proposed edit would delete ${Math.round((totalDeletedLines / lineCount) * 100)}% of the file (${totalDeletedLines}/${lineCount} lines deleted). This appears to be a truncated response.`);
			}

			return changes.map(change => ({ range: Range.lift(change.range), text: change.text ?? '' }));
		}

		throw new Error('AI returned whole-file content without a safe target. Re-read the file and retry apply_edit with an exact current old_string.');
	}
}
