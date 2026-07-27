/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { URI } from '../../../../../../base/common/uri.js';
import { localize } from '../../../../../../nls.js';
import type { CleanSlateReviewDisplayScopeMode, ICleanSlateReviewChange } from './cleanSlateReviewModel.js';

export interface ICleanSlateReviewRendererOptions {
	readonly scopeMode: CleanSlateReviewDisplayScopeMode;
	readonly onScopeModeChange: (mode: CleanSlateReviewDisplayScopeMode) => void;
	/** File rows display paths relative to these roots instead of absolute. */
	readonly rootUris?: readonly URI[];
}

const REVIEW_SCOPE_ENTRIES: readonly { readonly mode: CleanSlateReviewDisplayScopeMode; readonly label: () => string }[] = [
	{ mode: 'working', label: () => localize('cleanSlate.reviewScopeWorking', 'Working Tree') },
	{ mode: 'unstaged', label: () => localize('cleanSlate.reviewScopeUnstaged', 'Unstaged') },
	{ mode: 'staged', label: () => localize('cleanSlate.reviewScopeStaged', 'Staged') },
	{ mode: 'branch', label: () => localize('cleanSlate.reviewScopeBranch', 'Branch') },
	{ mode: 'turn', label: () => localize('cleanSlate.reviewScopeTurn', 'Last Turn') }
];

type CleanSlateReviewDiffLineKind = 'context' | 'added' | 'deleted' | 'separator';

interface ICleanSlateReviewDiffLine {
	readonly kind: CleanSlateReviewDiffLineKind;
	readonly oldLineNumber?: number;
	readonly newLineNumber?: number;
	readonly content: string;
}

export class CleanSlateReviewRenderer {
	private static readonly MAX_REVIEW_DIFF_CELLS = 500_000;

	render(container: HTMLElement, rawChanges: readonly ICleanSlateReviewChange[], options?: ICleanSlateReviewRendererOptions): void {
		dom.clearNode(container);
		const changes = rawChanges.filter(change =>
			change.added > 0 || change.deleted > 0 || change.beforeContent !== change.afterContent || change.diff.length > 0
		);

		const review = dom.append(container, dom.$('.cleanSlate-review'));
		const totalAdded = changes.reduce((sum, change) => sum + Math.max(0, change.added), 0);
		const totalDeleted = changes.reduce((sum, change) => sum + Math.max(0, change.deleted), 0);

		// Toolbar renders even with no changes, so the scope can be switched
		// out of an empty scope.
		if (options) {
			this.renderToolbar(review, options, totalAdded, totalDeleted);
		}

		if (changes.length === 0) {
			this.renderEmptyBody(review);
			return;
		}

		if (!options) {
			const summary = dom.append(review, dom.$('.cleanSlate-review-summary'));
			const summaryLeft = dom.append(summary, dom.$('.cleanSlate-review-summary-left'));
			dom.append(summaryLeft, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.diffMultiple)}`));
			dom.append(summaryLeft, dom.$('span.cleanSlate-review-summary-label')).textContent = localize('cleanSlate.reviewChanges', 'Changes');
			dom.append(summaryLeft, dom.$('span.cleanSlate-review-count')).textContent = String(changes.length);
			const summaryStats = dom.append(summary, dom.$('.cleanSlate-review-summary-stats'));
			dom.append(summaryStats, dom.$('span.stat-added')).textContent = `+${totalAdded}`;
			dom.append(summaryStats, dom.$('span.stat-deleted')).textContent = `-${totalDeleted}`;
		}

		const filterInput = options ? this.renderFilter(review) : undefined;
		const list = dom.append(review, dom.$('.cleanSlate-review-files'));
		const sections: { readonly element: HTMLElement; readonly haystack: string }[] = [];
		for (const change of changes) {
			const element = this.renderFile(list, change, options?.rootUris);
			sections.push({ element, haystack: this.getDisplayPath(change.uri).toLowerCase() });
		}

		if (filterInput) {
			const noMatches = dom.append(list, dom.$('.cleanSlate-review-filter-empty'));
			noMatches.textContent = localize('cleanSlate.reviewNoFilterMatches', 'No files match');
			noMatches.hidden = true;
			filterInput.oninput = () => {
				const needle = filterInput.value.trim().toLowerCase();
				let visible = 0;
				for (const section of sections) {
					const matches = !needle || section.haystack.includes(needle);
					section.element.hidden = !matches;
					if (matches) {
						visible++;
					}
				}
				noMatches.hidden = visible > 0;
			};
		}
	}

	private renderToolbar(review: HTMLElement, options: ICleanSlateReviewRendererOptions, totalAdded: number, totalDeleted: number): void {
		const toolbar = dom.append(review, dom.$('.cleanSlate-review-toolbar'));
		const scope = dom.append(toolbar, dom.$('button.cleanSlate-review-scope')) as HTMLButtonElement;
		scope.type = 'button';
		scope.setAttribute('aria-haspopup', 'menu');
		scope.setAttribute('aria-expanded', 'false');
		const activeEntry = REVIEW_SCOPE_ENTRIES.find(entry => entry.mode === options.scopeMode) ?? REVIEW_SCOPE_ENTRIES[0];
		dom.append(scope, dom.$('span.cleanSlate-review-scope-label')).textContent = activeEntry.label();
		dom.append(scope, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.chevronDown)}.cleanSlate-review-scope-chevron`));

		const stats = dom.append(toolbar, dom.$('.cleanSlate-review-summary-stats'));
		dom.append(stats, dom.$('span.stat-added')).textContent = `+${totalAdded}`;
		dom.append(stats, dom.$('span.stat-deleted')).textContent = `-${totalDeleted}`;

		const menu = dom.append(toolbar, dom.$('.cleanSlate-review-scope-menu.hidden'));
		menu.setAttribute('role', 'menu');
		for (const entry of REVIEW_SCOPE_ENTRIES) {
			const item = dom.append(menu, dom.$('button.cleanSlate-review-scope-item')) as HTMLButtonElement;
			item.type = 'button';
			item.setAttribute('role', 'menuitemradio');
			item.setAttribute('aria-checked', String(entry.mode === options.scopeMode));
			dom.append(item, dom.$('span.cleanSlate-review-scope-item-label')).textContent = entry.label();
			if (entry.mode === options.scopeMode) {
				dom.append(item, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.check)}`));
			}
			item.onclick = () => {
				menu.classList.add('hidden');
				if (entry.mode !== options.scopeMode) {
					options.onScopeModeChange(entry.mode);
				}
			};
		}
		scope.onclick = event => {
			event.stopPropagation();
			const willOpen = menu.classList.contains('hidden');
			menu.classList.toggle('hidden', !willOpen);
			scope.setAttribute('aria-expanded', String(willOpen));
		};
		const onDocumentPointerDown = (event: PointerEvent) => {
			if (!toolbar.isConnected) {
				scope.ownerDocument.removeEventListener('pointerdown', onDocumentPointerDown);
				return;
			}
			if (!toolbar.contains(event.target as Node)) {
				menu.classList.add('hidden');
				scope.setAttribute('aria-expanded', 'false');
			}
		};
		scope.ownerDocument.addEventListener('pointerdown', onDocumentPointerDown);
	}

	private renderFilter(review: HTMLElement): HTMLInputElement {
		const filter = dom.append(review, dom.$('.cleanSlate-review-filter'));
		dom.append(filter, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.search)}`));
		const input = dom.append(filter, dom.$('input')) as HTMLInputElement;
		input.type = 'search';
		input.placeholder = localize('cleanSlate.reviewFilterFiles', 'Filter files…');
		input.spellcheck = false;
		input.setAttribute('aria-label', input.placeholder);
		return input;
	}

	private renderEmptyBody(review: HTMLElement): void {
		const empty = dom.append(review, dom.$('.cleanSlate-review-empty'));
		dom.append(empty, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.diffMultiple)}.cleanSlate-review-empty-icon`));
		dom.append(empty, dom.$('div.cleanSlate-review-empty-title')).textContent = localize('cleanSlate.reviewNoChanges', 'No Changes');
	}

	renderEmpty(container: HTMLElement): void {
		dom.clearNode(container);
		const empty = dom.append(container, dom.$('.cleanSlate-review-empty'));
		dom.append(empty, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.diffMultiple)}.cleanSlate-review-empty-icon`));
		dom.append(empty, dom.$('div.cleanSlate-review-empty-title')).textContent = localize('cleanSlate.reviewNoChanges', 'No Changes');
	}

	renderInlineDiff(container: HTMLElement, change: ICleanSlateReviewChange): void {
		dom.clearNode(container);
		const inline = dom.append(container, dom.$('.cleanSlate-review-inline'));
		const diff = dom.append(inline, dom.$('.cleanSlate-review-diff'));
		this.renderDiff(diff, change);
	}

	private renderFile(container: HTMLElement, change: ICleanSlateReviewChange, rootUris?: readonly URI[]): HTMLElement {
		const displayPath = this.getDisplayPath(change.uri);
		const relativePath = this.getRelativePath(displayPath, rootUris);
		const filename = this.getBasename(displayPath);
		const directory = relativePath.length > filename.length
			? relativePath.slice(0, relativePath.length - filename.length).replace(/\/+$/, '')
			: '';
		const section = dom.append(container, dom.$('.cleanSlate-review-file.is-collapsed'));
		const header = dom.append(section, dom.$('button.cleanSlate-review-file-header')) as HTMLButtonElement;
		header.type = 'button';
		header.title = relativePath;
		header.setAttribute('aria-expanded', 'false');
		dom.append(header, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.chevronRight)}.cleanSlate-review-file-chevron`));
		dom.append(header, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.fileCode)}.cleanSlate-review-file-icon`));
		const labels = dom.append(header, dom.$('.cleanSlate-review-file-labels'));
		dom.append(labels, dom.$('.cleanSlate-review-file-name')).textContent = filename;
		if (directory) {
			dom.append(labels, dom.$('.cleanSlate-review-file-path')).textContent = directory;
		}
		const stats = dom.append(header, dom.$('.cleanSlate-review-file-stats'));
		if (change.added > 0) {
			dom.append(stats, dom.$('span.stat-added')).textContent = `+${change.added}`;
		}
		if (change.deleted > 0) {
			dom.append(stats, dom.$('span.stat-deleted')).textContent = `-${change.deleted}`;
		}

		const diff = dom.append(section, dom.$('.cleanSlate-review-diff'));
		diff.hidden = true;

		header.onclick = () => {
			const willOpen = section.classList.contains('is-collapsed');
			section.classList.toggle('is-collapsed', !willOpen);
			section.classList.toggle('is-open', willOpen);
			header.setAttribute('aria-expanded', String(willOpen));
			diff.hidden = !willOpen;
			if (willOpen && diff.childElementCount === 0) {
				this.renderDiff(diff, change);
			}
		};
		return section;
	}

	private renderDiff(container: HTMLElement, change: ICleanSlateReviewChange): void {
		const lines = this.buildDiffLines(change);
		if (lines.length === 0) {
			dom.append(container, dom.$('.cleanSlate-review-diff-empty')).textContent = localize('cleanSlate.reviewNoTextChanges', 'No textual changes');
			return;
		}

		for (const line of lines) {
			if (line.kind === 'separator') {
				const separator = dom.append(container, dom.$('.cleanSlate-review-diff-separator'));
				dom.append(separator, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.chevronDown)}`));
				dom.append(separator, dom.$('span')).textContent = line.content;
				continue;
			}
			const row = dom.append(container, dom.$(`.cleanSlate-review-diff-line.${line.kind}`));
			dom.append(row, dom.$('span.line-number.old')).textContent = line.oldLineNumber === undefined ? '' : String(line.oldLineNumber);
			dom.append(row, dom.$('span.line-number.new')).textContent = line.newLineNumber === undefined ? '' : String(line.newLineNumber);
			dom.append(row, dom.$('span.line-sign')).textContent = line.kind === 'added' ? '+' : line.kind === 'deleted' ? '-' : ' ';
			dom.append(row, dom.$('code')).textContent = line.content || ' ';
		}
	}

	private buildDiffLines(change: ICleanSlateReviewChange): ICleanSlateReviewDiffLine[] {
		const beforeLines = this.splitLines(change.beforeContent);
		const afterLines = this.splitLines(change.afterContent);
		if (beforeLines.length === 0 && afterLines.length === 0 && change.diff.trim().length > 0) {
			return this.parseUnifiedDiff(change.diff);
		}
		const cellCount = (beforeLines.length + 1) * (afterLines.length + 1);
		if (cellCount > CleanSlateReviewRenderer.MAX_REVIEW_DIFF_CELLS) {
			return this.parseUnifiedDiff(change.diff);
		}

		const table = this.buildLineDiffTable(beforeLines, afterLines);
		const lines: ICleanSlateReviewDiffLine[] = [];
		let oldIndex = 0;
		let newIndex = 0;

		while (oldIndex < beforeLines.length || newIndex < afterLines.length) {
			if (oldIndex < beforeLines.length && newIndex < afterLines.length && beforeLines[oldIndex] === afterLines[newIndex]) {
				lines.push({
					kind: 'context',
					oldLineNumber: oldIndex + 1,
					newLineNumber: newIndex + 1,
					content: beforeLines[oldIndex]
				});
				oldIndex++;
				newIndex++;
				continue;
			}

			if (newIndex < afterLines.length && (oldIndex === beforeLines.length || table[oldIndex][newIndex + 1] >= table[oldIndex + 1][newIndex])) {
				lines.push({
					kind: 'added',
					newLineNumber: newIndex + 1,
					content: afterLines[newIndex]
				});
				newIndex++;
				continue;
			}

			if (oldIndex < beforeLines.length) {
				lines.push({
					kind: 'deleted',
					oldLineNumber: oldIndex + 1,
					content: beforeLines[oldIndex]
				});
				oldIndex++;
			}
		}

		return this.trimDiffContext(lines, 4);
	}

	private buildLineDiffTable(beforeLines: readonly string[], afterLines: readonly string[]): number[][] {
		const table = Array.from({ length: beforeLines.length + 1 }, () => new Array<number>(afterLines.length + 1).fill(0));
		for (let oldIndex = beforeLines.length - 1; oldIndex >= 0; oldIndex--) {
			for (let newIndex = afterLines.length - 1; newIndex >= 0; newIndex--) {
				table[oldIndex][newIndex] = beforeLines[oldIndex] === afterLines[newIndex]
					? table[oldIndex + 1][newIndex + 1] + 1
					: Math.max(table[oldIndex + 1][newIndex], table[oldIndex][newIndex + 1]);
			}
		}
		return table;
	}

	private trimDiffContext(lines: readonly ICleanSlateReviewDiffLine[], contextSize: number): ICleanSlateReviewDiffLine[] {
		const changedIndexes = lines
			.map((line, index) => line.kind === 'context' ? -1 : index)
			.filter(index => index >= 0);
		if (changedIndexes.length === 0) {
			return [];
		}

		const keep = new Set<number>();
		for (const index of changedIndexes) {
			const from = Math.max(0, index - contextSize);
			const to = Math.min(lines.length - 1, index + contextSize);
			for (let keepIndex = from; keepIndex <= to; keepIndex++) {
				keep.add(keepIndex);
			}
		}

		const result: ICleanSlateReviewDiffLine[] = [];
		let skipped = 0;
		lines.forEach((line, index) => {
			if (!keep.has(index)) {
				skipped++;
				return;
			}
			if (skipped > 0) {
				result.push({
					kind: 'separator',
					content: localize('cleanSlate.reviewUnchangedLines', '{0} unchanged lines', skipped)
				});
				skipped = 0;
			}
			result.push(line);
		});
		return result;
	}

	private parseUnifiedDiff(diff: string): ICleanSlateReviewDiffLine[] {
		const lines: ICleanSlateReviewDiffLine[] = [];
		let oldLineNumber = 0;
		let newLineNumber = 0;
		for (const rawLine of diff.split(/\r?\n/)) {
			if (!rawLine || rawLine.startsWith('--- ') || rawLine.startsWith('+++ ') || rawLine.startsWith('diff --git') || rawLine.startsWith('index ')) {
				continue;
			}
			const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(rawLine);
			if (hunk) {
				const nextOldLineNumber = Number(hunk[1]);
				const skipped = oldLineNumber > 0 ? Math.max(0, nextOldLineNumber - oldLineNumber) : 0;
				if (skipped > 0) {
					lines.push({
						kind: 'separator',
						content: localize('cleanSlate.reviewUnchangedLines', '{0} unchanged lines', skipped)
					});
				}
				oldLineNumber = nextOldLineNumber;
				newLineNumber = Number(hunk[2]);
				continue;
			}
			const marker = rawLine[0];
			const content = rawLine.slice(1);
			if (marker === '+') {
				lines.push({ kind: 'added', newLineNumber, content });
				newLineNumber++;
			} else if (marker === '-') {
				lines.push({ kind: 'deleted', oldLineNumber, content });
				oldLineNumber++;
			} else {
				const context = marker === ' ' ? content : rawLine;
				lines.push({ kind: 'context', oldLineNumber, newLineNumber, content: context });
				oldLineNumber++;
				newLineNumber++;
			}
		}
		return lines;
	}

	private splitLines(content: string): string[] {
		return content.length === 0 ? [] : content.split(/\r?\n/);
	}

	private getDisplayPath(uri: URI): string {
		return (uri.fsPath || uri.path || uri.toString()).replace(/\\/g, '/');
	}

	private getRelativePath(displayPath: string, rootUris: readonly URI[] | undefined): string {
		for (const root of rootUris ?? []) {
			const rootPath = (root.fsPath || root.path || '').replace(/\\/g, '/').replace(/\/+$/, '');
			if (rootPath && displayPath.toLowerCase().startsWith(`${rootPath.toLowerCase()}/`)) {
				return displayPath.slice(rootPath.length + 1);
			}
		}
		return displayPath;
	}

	private getBasename(path: string): string {
		const normalized = path.replace(/\\/g, '/');
		return normalized.split('/').pop() || normalized;
	}
}
