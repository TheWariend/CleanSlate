/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISequence, LcsDiff } from '../core/diff/diff.js';
import { Range } from '../core/range.js';
import { stringHash } from '../core/hash.js';

class LineSequence implements ISequence {
    constructor(private readonly _lines: string[]) { }

    getElements(): Int32Array | number[] | string[] {
        const hashes = new Int32Array(this._lines.length);
        for (let i = 0; i < this._lines.length; i++) {
            hashes[i] = stringHash(this._lines[i], 0);
        }
        return hashes;
    }
}

interface DiffSpecialCharGuard {
    mask(value: string): string;
    unmask(value: string): string;
}

/**
 * Service to help locate code blocks with fuzzy matching
 */
export class CleanSlateDiffService {

    /**
     * Computes the edits required to transform originalContent to newContent using Line-Based diffing.
     * This ensures all edits are whole-line replacements, which is better for visualization.
     */
    public static computeLineDiff(originalContent: string, newContent: string): { range: Range, text: string }[] {
        const specialCharGuard = this.createDiffSpecialCharGuard(originalContent, newContent);
        const originalLines = specialCharGuard.mask(originalContent).split(/\r\n|\r|\n/);
        const newLines = specialCharGuard.mask(newContent).split(/\r\n|\r|\n/);

        const diff = new LcsDiff(new LineSequence(originalLines), new LineSequence(newLines));
        const changes = diff.ComputeDiff(true).changes;

        const edits: { range: Range, text: string }[] = [];

        for (const change of changes) {
            // LcsDiff returns 0-based indices
            const startLine = change.originalStart + 1;
            const endLine = change.originalStart + change.originalLength;

            // Extract the new text lines
            const modifiedLinesSlice = newLines.slice(change.modifiedStart, change.modifiedStart + change.modifiedLength);
            let text = specialCharGuard.unmask(modifiedLinesSlice.join('\n'));
            
            if (change.originalLength === 0) {
                // Pure Insertion: Insert at the start of the target line
                edits.push({
                    range: new Range(startLine, 1, startLine, 1),
                    text: text + '\n'
                });
            } else if (change.modifiedLength === 0) {
                // Pure Deletion: Remove the lines entirely including their newlines
                const isLastLine = endLine >= originalLines.length;
                if (isLastLine && startLine > 1) {
                    // If deleting the last line, we need to delete the newline of the previous line instead
                    edits.push({
                        range: new Range(startLine - 1, originalLines[startLine - 2].length + 1, endLine, originalLines[endLine - 1].length + 1),
                        text: ''
                    });
                } else {
                    edits.push({
                        range: new Range(startLine, 1, endLine + 1, 1),
                        text: ''
                    });
                }
            } else {
                // Replacement: Replace the lines entirely
                const isLastLine = endLine >= originalLines.length;
                if (isLastLine) {
                    edits.push({
                        range: new Range(startLine, 1, endLine, originalLines[endLine - 1].length + 1),
                        text: text
                    });
                } else {
                    edits.push({
                        range: new Range(startLine, 1, endLine + 1, 1),
                        text: text + '\n'
                    });
                }
            }
        }

        return edits;
    }

    /**
     * Renders a unified diff string for a file and a set of edits.
     * Production Grade: Standard + / - format.
     */
    public static renderUnifiedDiff(fileName: string, originalContent: string, edits: { range: Range, text: string }[]): string {
        const lines = originalContent.split(/\r\n|\r|\n/);
        const sortedEdits = [...edits].sort((a, b) => b.range.startLineNumber - a.range.startLineNumber);
        
        let diff = `--- ${fileName} (original)\n+++ ${fileName} (updated)\n`;
        
        // Group edits into hunks (simplified for tool feedback)
        for (const edit of sortedEdits) {
            const start = edit.range.startLineNumber;
            const end = edit.range.endLineNumber;
            
            diff += `@@ -${start},${end - start + 1} +${start},${edit.text.split('\n').length} @@\n`;
            
            // Show removed lines
            for (let i = start - 1; i < end; i++) {
                if (i >= 0 && i < lines.length) {
                    diff += `-${lines[i]}\n`;
                }
            }
            
            // Show added lines
            const added = edit.text.split('\n');
            for (const line of added) {
                diff += `+${line}\n`;
            }
        }
        
        return diff;
    }

    /**
     * wrapper for compatibility
     */
    public static computeDiff(originalContent: string, newContent: string): { range: Range, text: string }[] {
        return this.computeLineDiff(originalContent, newContent);
    }

    private static readonly MAX_UNIFIED_DIFF_CELLS = 4_000_000;

    /**
     * Compute a standard, forward-ordered unified diff from full before/after
     * content. This is the single source of truth the transcript renders a file
     * change from when the raw before/after snapshots are too large to carry:
     * the diff stays proportional to what changed (not the file size), so it
     * survives persistence where the full snapshots don't.
     *
     * Unlike {@link renderUnifiedDiff} (which sorts edits descending for tool
     * feedback) this emits hunks top-to-bottom with surrounding context, so it
     * renders correctly. Returns undefined when there is no change or the inputs
     * are too large to diff safely.
     */
    public static computeUnifiedDiffFromContents(
        fileName: string,
        beforeContent: string,
        afterContent: string,
        contextLines: number = 3
    ): string | undefined {
        if (beforeContent === afterContent) {
            return undefined;
        }
        const before = this.splitDiffLines(beforeContent);
        const after = this.splitDiffLines(afterContent);
        if ((before.length + 1) * (after.length + 1) > this.MAX_UNIFIED_DIFF_CELLS) {
            return undefined;
        }

        const table = this.buildLcsTable(before, after);
        type DiffLine = { kind: 'context' | 'added' | 'deleted'; oldLine: number; newLine: number; content: string };
        const lines: DiffLine[] = [];
        let oldIndex = 0;
        let newIndex = 0;
        while (oldIndex < before.length || newIndex < after.length) {
            if (oldIndex < before.length && newIndex < after.length && before[oldIndex] === after[newIndex]) {
                lines.push({ kind: 'context', oldLine: oldIndex + 1, newLine: newIndex + 1, content: before[oldIndex] });
                oldIndex++;
                newIndex++;
            } else if (newIndex < after.length && (oldIndex === before.length || table[oldIndex][newIndex + 1] >= table[oldIndex + 1][newIndex])) {
                lines.push({ kind: 'added', oldLine: oldIndex + 1, newLine: newIndex + 1, content: after[newIndex] });
                newIndex++;
            } else {
                lines.push({ kind: 'deleted', oldLine: oldIndex + 1, newLine: newIndex + 1, content: before[oldIndex] });
                oldIndex++;
            }
        }

        // Keep only changed lines plus `contextLines` of surrounding context,
        // grouped into contiguous hunks.
        const changedIndexes = lines.map((line, index) => line.kind === 'context' ? -1 : index).filter(index => index >= 0);
        if (changedIndexes.length === 0) {
            return undefined;
        }
        const keep = new Array<boolean>(lines.length).fill(false);
        for (const index of changedIndexes) {
            for (let i = Math.max(0, index - contextLines); i <= Math.min(lines.length - 1, index + contextLines); i++) {
                keep[i] = true;
            }
        }

        const out: string[] = [`--- ${fileName}`, `+++ ${fileName}`];
        let cursor = 0;
        while (cursor < lines.length) {
            if (!keep[cursor]) {
                cursor++;
                continue;
            }
            let end = cursor;
            while (end + 1 < lines.length && keep[end + 1]) {
                end++;
            }
            const hunk = lines.slice(cursor, end + 1);
            const oldStart = hunk[0].oldLine;
            const newStart = hunk[0].newLine;
            const oldCount = hunk.filter(line => line.kind !== 'added').length;
            const newCount = hunk.filter(line => line.kind !== 'deleted').length;
            out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
            for (const line of hunk) {
                const sign = line.kind === 'added' ? '+' : line.kind === 'deleted' ? '-' : ' ';
                out.push(`${sign}${line.content}`);
            }
            cursor = end + 1;
        }
        return `${out.join('\n')}\n`;
    }

    private static splitDiffLines(content: string): string[] {
        const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        if (normalized.length === 0) {
            return [];
        }
        return normalized.endsWith('\n') ? normalized.slice(0, -1).split('\n') : normalized.split('\n');
    }

    /** LCS-length table filled bottom-up; table[i][j] = LCS(before[i:], after[j:]). */
    private static buildLcsTable(before: readonly string[], after: readonly string[]): number[][] {
        const table = Array.from({ length: before.length + 1 }, () => new Array<number>(after.length + 1).fill(0));
        for (let i = before.length - 1; i >= 0; i--) {
            for (let j = after.length - 1; j >= 0; j--) {
                table[i][j] = before[i] === after[j]
                    ? table[i + 1][j + 1] + 1
                    : Math.max(table[i + 1][j], table[i][j + 1]);
            }
        }
        return table;
    }

    private static createDiffSpecialCharGuard(...contents: string[]): DiffSpecialCharGuard {
        let suffix = 0;
        let ampersandToken = '';
        let dollarToken = '';
        do {
            ampersandToken = `<<:CLEANSLATE_AMPERSAND_TOKEN_${suffix}:>>`;
            dollarToken = `<<:CLEANSLATE_DOLLAR_TOKEN_${suffix}:>>`;
            suffix++;
        } while (contents.some(content => content.includes(ampersandToken) || content.includes(dollarToken)));

        return {
            mask(value: string): string {
                return value
                    .replaceAll('&', ampersandToken)
                    .replaceAll('$', dollarToken);
            },
            unmask(value: string): string {
                return value
                    .replaceAll(ampersandToken, '&')
                    .replaceAll(dollarToken, '$');
            }
        };
    }

    /**
     * Finds the best matching line range for the given search text within the file content.
     */
    public static findBestMatch(searchText: string, fileContent: string, threshold: number = 0.8): [number, number] | null {
        const matches = this.findAllMatches(searchText, fileContent, threshold);
        return matches.length > 0 ? matches[0] : null;
    }

    /**
     * Finds ALL matching line ranges for the given search text.
     * Uses a combination of exact matching, whitespace normalization, and anchor-based fuzzy search.
     */
    public static findAllMatches(searchText: string, fileContent: string, threshold: number = 0.8): [number, number][] {
        // Normalize line endings
        const normalizeNewlines = (s: string) => s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        const searchLines = normalizeNewlines(searchText).split('\n');
        const fileLines = normalizeNewlines(fileContent).split('\n');

        const allMatches: [number, number][] = [];
        const seenRanges = new Set<string>();

        const addMatch = (match: [number, number]) => {
            const key = `${match[0]}-${match[1]}`;
            if (!seenRanges.has(key)) {
                allMatches.push(match);
                seenRanges.add(key);
            }
        };

        // 1. Try Exact Matches
        for (const m of this.findExactMatches(searchLines, fileLines)) {
            addMatch(m);
        }

        // 2. Try Normalized Matches (ignore all whitespace)
        if (allMatches.length === 0) {
            for (const m of this.findNormalizedMatches(searchLines, fileLines)) {
                addMatch(m);
            }
        }

        // 3. Anchor-Based Fuzzy Matches
        if (allMatches.length === 0) {
            for (const m of this.findAnchorMatches(searchLines, fileLines, threshold)) {
                addMatch(m);
            }
        }

        return allMatches;
    }

    private static findExactMatches(searchLines: string[], fileLines: string[]): [number, number][] {
        const matches: [number, number][] = [];
        const firstLineIdx = searchLines.findIndex(l => l.trim().length > 0);
        if (firstLineIdx === -1) return [];

        const firstLine = searchLines[firstLineIdx];

        for (let i = 0; i < fileLines.length; i++) {
            if (fileLines[i] === firstLine) {
                let isMatch = true;
                for (let j = 0; j < firstLineIdx; j++) {
                    if (i - (firstLineIdx - j) < 0 || fileLines[i - (firstLineIdx - j)] !== searchLines[j]) {
                        isMatch = false; break;
                    }
                }
                if (isMatch) {
                    for (let j = firstLineIdx + 1; j < searchLines.length; j++) {
                        if (i + (j - firstLineIdx) >= fileLines.length || fileLines[i + (j - firstLineIdx)] !== searchLines[j]) {
                            isMatch = false; break;
                        }
                    }
                }

                if (isMatch) {
                    const startLine = (i - firstLineIdx) + 1;
                    matches.push([startLine, startLine + searchLines.length - 1]);
                }
            }
        }
        return matches;
    }

    private static findNormalizedMatches(searchLines: string[], fileLines: string[]): [number, number][] {
        const matches: [number, number][] = [];
        const normalize = (s: string) => s.replace(/\s+/g, '');
        const normSearch = searchLines.map(normalize);
        const normFile = fileLines.map(normalize);

        const significantSearch = normSearch.map((line, idx) => ({ line, idx })).filter(x => x.line.length > 0);
        if (significantSearch.length === 0) return [];

        const firstSig = significantSearch[0];

        for (let i = 0; i < normFile.length; i++) {
            if (normFile[i] === firstSig.line) {
                let isMatch = true;
                let fileCursor = i;

                for (let k = 1; k < significantSearch.length; k++) {
                    const nextSig = significantSearch[k];
                    const expectedGap = nextSig.idx - significantSearch[k - 1].idx;
                    const maxLookahead = expectedGap + 5;

                    let foundNext = false;
                    for (let delta = 1; delta <= maxLookahead; delta++) {
                        if (fileCursor + delta < normFile.length && normFile[fileCursor + delta] === nextSig.line) {
                            fileCursor += delta;
                            foundNext = true;
                            break;
                        }
                    }

                    if (!foundNext) {
                        isMatch = false;
                        break;
                    }
                }

                if (isMatch) {
                    const startOffset = firstSig.idx;
                    const startLine = Math.max(1, (i - startOffset) + 1);

                    const lastSig = significantSearch[significantSearch.length - 1];
                    const trailingLines = searchLines.length - 1 - lastSig.idx;
                    const endLine = Math.min(fileLines.length, (fileCursor + trailingLines) + 1);

                    matches.push([startLine, endLine]);
                }
            }
        }

        return matches;
    }

    private static findAnchorMatches(searchLines: string[], fileLines: string[], threshold: number): [number, number][] {
        const matches: [number, number][] = [];
        const significantLines = searchLines.filter(l => l.trim().length > 10);
        if (significantLines.length === 0) return [];

        const anchor = significantLines.reduce((a, b) => a.length > b.length ? a : b);
        const anchorSearchIdx = searchLines.indexOf(anchor);
        const candidates: number[] = [];

        for (let i = 0; i < fileLines.length; i++) {
            if (this.calculateSimilarity(anchor, fileLines[i]) > 0.85) {
                candidates.push(i);
            }
        }

        for (const fileAnchorIdx of candidates) {
            const startFileIdx = fileAnchorIdx - anchorSearchIdx;
            if (startFileIdx < 0) continue;

            let matchScore = 0;
            let matchCount = 0;

            for (let j = 0; j < searchLines.length; j++) {
                const fileIdx = startFileIdx + j;
                if (fileIdx >= fileLines.length) break;

                const score = this.calculateSimilarity(searchLines[j], fileLines[fileIdx]);
                matchScore += score;
                matchCount++;
            }

            const avgScore = matchCount > 0 ? matchScore / matchCount : 0;

            if (avgScore > threshold) {
                matches.push([startFileIdx + 1, startFileIdx + searchLines.length]);
            }
        }

        return matches.sort((a, b) => a[0] - b[0]);
    }

    private static calculateSimilarity(s1: string, s2: string): number {
        const t1 = s1.trim();
        const t2 = s2.trim();

        if (t1 === t2) return t1.length > 0 ? 1.0 : 1.0;

        const longer = t1.length > t2.length ? t1 : t2;
        const shorter = t1.length > t2.length ? t2 : t1;

        if (longer.length === 0) return 1.0;

        // Substring Check:
        // If one is a substring of the other (ignoring whitespace), and it's significant, match it.
        // This handles cases where the AI provides "Text('foo')" but the file has "child: Text('foo'),"
        if (longer.includes(shorter) && shorter.length > 5) {
            return 0.9;
        }

        const dist = this.levenshteinDistance(longer, shorter);
        return (longer.length - dist) / longer.length;
    }

    private static levenshteinDistance(s1: string, s2: string): number {
        s1 = s1.trim();
        s2 = s2.trim();
        if (s1 === s2) return 0;

        const m = s1.length;
        const n = s2.length;

        if (Math.abs(m - n) > (Math.max(m, n) * 0.7)) return Math.max(m, n);

        const dp: number[][] = [];

        for (let i = 0; i <= m; i++) dp[i] = [i];
        for (let j = 0; j <= n; j++) dp[0][j] = j;

        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,
                    dp[i][j - 1] + 1,
                    dp[i - 1][j - 1] + cost
                );
            }
        }
        return dp[m][n];
    }
}
