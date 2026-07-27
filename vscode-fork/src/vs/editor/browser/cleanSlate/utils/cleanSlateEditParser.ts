/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * VERBATIM VOID EDITOR ARCHITECTURE (Modified with Aggressive Healing)
 * Source: void-reference/common/helpers/extractCodeFromResult.ts
 */

export const ORIGINAL = `<<<<<<< ORIGINAL`;
export const DIVIDER = `=======`;
export const UPDATED = `>>>>>>> UPDATED`;

export interface ExtractedSearchReplaceBlock {
    state: 'writingOriginal' | 'writingFinal' | 'done';
    orig: string;
    final: string;
}

export class SurroundingsRemover {
    readonly originalS: string;
    i: number;
    j: number;

    constructor(s: string) {
        this.originalS = s;
        this.i = 0;
        this.j = s.length - 1;
    }

    value() {
        return this.originalS.substring(this.i, this.j + 1);
    }

    removePrefix = (prefix: string): boolean => {
        let offset = 0;
        while (this.i <= this.j && offset <= prefix.length - 1) {
            if (this.originalS.charAt(this.i) !== prefix.charAt(offset))
                break;
            offset += 1;
            this.i += 1;
        }
        return offset === prefix.length;
    };

    removeSuffix = (suffix: string): boolean => {
        const s = this.value();
        for (let len = Math.min(s.length, suffix.length); len >= 1; len -= 1) {
            if (s.endsWith(suffix.substring(0, len))) {
                this.j -= len;
                return len === suffix.length;
            }
        }
        return false;
    };

    removeFromStartUntilFullMatch = (until: string, alsoRemoveUntilStr: boolean) => {
        const index = this.originalS.indexOf(until, this.i);
        if (index === -1) return false;
        if (alsoRemoveUntilStr)
            this.i = index + until.length;
        else
            this.i = index;
        return true;
    };

    removeCodeBlock = () => {
        const pm = this;
        const foundCodeBlock = pm.removePrefix('```');
        if (!foundCodeBlock) return false;
        pm.removeFromStartUntilFullMatch('\n', true); // language
        const j = pm.j;
        let foundCodeBlockEnd = pm.removeSuffix('```');
        if (pm.j === j) foundCodeBlockEnd = pm.removeSuffix('```\n');
        if (!foundCodeBlockEnd) return false;
        pm.removeSuffix('\n');
        return true;
    };
}

const voidSubstr = (str: string, start: number, end: number) => end < start ? '' : str.substring(start, end);
const surgicalTrim = (s: string): string => {
    // Remove at most one leading and one trailing newline, but preserve all indentation.
    return s.replace(/^[\r\n]/, '').replace(/[\r\n]$/, '');
};

export const endsWithAnyPrefixOf = (str: string, anyPrefix: string) => {
    for (let i = anyPrefix.length; i >= 1; i--) {
        const prefix = anyPrefix.slice(0, i);
        if (str.endsWith(prefix)) return prefix;
    }
    return null;
};

export function extractSearchReplaceBlocks(str: string): ExtractedSearchReplaceBlock[] {
    const blocks: ExtractedSearchReplaceBlock[] = [];

    // Regex for markers: 7 or more characters (<, =, >) potentially preceded by comments
    // Using multiline flag to anchor to start/end of lines if possible
    const ORIGINAL_RE = /^[ \t]*(?:\/\/\s*)?<{7,}[ \t]*ORIGINAL[ \t]*$/gm;
    const DIVIDER_RE = /^[ \t]*(?:\/\/\s*)?={7,}[ \t]*$/gm; // AI often forgets "DIVIDER" text, just uses equals
    const UPDATED_RE = /^[ \t]*(?:\/\/\s*)?>{7,}[ \t]*UPDATED[ \t]*$/gm;

    let i = 0;
    while (true) {
        // Find next ORIGINAL marker
        ORIGINAL_RE.lastIndex = i;
        const origMatch = ORIGINAL_RE.exec(str);
        if (!origMatch) break;

        const origStart = origMatch.index + origMatch[0].length;
        i = origStart;

        // Find next DIVIDER marker
        DIVIDER_RE.lastIndex = i;
        const dividerMatch = DIVIDER_RE.exec(str);
        if (!dividerMatch) {
            // Unfinished block
            blocks.push({
                orig: voidSubstr(str, origStart, str.length).trim(),
                final: '',
                state: 'writingOriginal'
            });
            return blocks;
        }

        const origStrDone = voidSubstr(str, origStart, dividerMatch.index);
        const dividerEnd = dividerMatch.index + dividerMatch[0].length;
        i = dividerEnd;

        // Find next UPDATED marker
        UPDATED_RE.lastIndex = i;
        const updatedMatch = UPDATED_RE.exec(str);
        if (!updatedMatch) {
            // Unfinished final block
            blocks.push({
                orig: surgicalTrim(origStrDone),
                final: surgicalTrim(voidSubstr(str, dividerEnd, str.length)),
                state: 'writingFinal'
            });
            return blocks;
        }

        const finalStrDone = voidSubstr(str, dividerEnd, updatedMatch.index);
        const updatedEnd = updatedMatch.index + updatedMatch[0].length;
        i = updatedEnd;

        blocks.push({
            orig: surgicalTrim(origStrDone),
            final: surgicalTrim(finalStrDone),
            state: 'done'
        });
    }

    return blocks;
}

export class CleanSlateEditParser {
    public static parseSearchReplace(text: string): ExtractedSearchReplaceBlock[] {
        // 1. Final LF Normalization
        let normalizedText = text.replace(/\r\n/g, '\n');

        // 2. Aggressive Healing for Malformed AI Responses
        normalizedText = this.heal(normalizedText);

        return extractSearchReplaceBlocks(normalizedText);
    }

    /**
     * Aggressive healing logic to fix structural AI failures.
     */
    private static heal(text: string): string {
        let healed = text;

        // A. Remove leading comment markers added by AI (e.g. // <<<<<<< ORIGINAL)
        healed = healed.replace(/\/\/\s*<<<<<<< ORIGINAL/g, ORIGINAL);

        // A2. Strip AI filler text immediately before ORIGINAL markers, but never
        // remove structural marker lines between adjacent Search/Replace blocks.
        healed = this.stripFillerBeforeOriginal(healed);

        // A3. Normalize bare >>>>>>> markers (without UPDATED suffix) to >>>>>>> UPDATED
        // The AI frequently sends just >>>>>>> instead of >>>>>>> UPDATED
        healed = healed.replace(/\n>>>>>>>\s*$/gm, '\n>>>>>>> UPDATED');
        healed = healed.replace(/\n>>>>>>>\n/g, '\n>>>>>>> UPDATED\n');

        // B. Fix "Divider Chaos" (Chaos Type 2 - Deletion Bug)
        // AI writes: <<<<<<< ORIGINAL ... >>>>>>> UPDATED ======= ... >>>>>>> UPDATED
        // We simply remove the extra '>>>>>>> UPDATED' before the '======='
        healed = healed.replace(/\n>>>>>>> UPDATED\n=======\n/g, '\n=======\n');

        healed = healed.replace(/\/\/\s*=======/g, DIVIDER);
        healed = healed.replace(/\/\/\s*>>>>>>> UPDATED/g, UPDATED);

        // B2. Fix "Marker-as-Divider" format: 
        // <<<<<<< ORIGINAL [orig] >>>>>>> UPDATED ======= [final] =======
        // If we find ORIGINAL followed by UPDATED then =======, rearrange it.
        const pattern = /<<<<<<< ORIGINAL\n([\s\S]*?)\n>>>>>>> UPDATED\n=======\n([\s\S]*?)\n=======/g;
        healed = healed.replace(pattern, (match, orig, final) => {
            return `<<<<<<< ORIGINAL\n${orig}\n=======\n${final}\n>>>>>>> UPDATED`;
        });

        // C. Fix cases where AI just skips the DIVIDER but provides both markers
        const missingDividerPattern = /<<<<<<< ORIGINAL\n([\s\S]*?)\n>>>>>>> UPDATED\n([\s\S]*?)(=======|$)/g;
        // Only replace if it doesn't already have a divider
        healed = healed.replace(missingDividerPattern, (match, orig, final, end) => {
            if (orig.includes(DIVIDER)) return match; // Already correct
            return `<<<<<<< ORIGINAL\n${orig}\n=======\n${final}\n>>>>>>> UPDATED`;
        });

        return healed;
    }

    private static stripFillerBeforeOriginal(text: string): string {
        const originalMarkerLine = /^[ \t]*(?:\/\/\s*)?<{7,}[ \t]*ORIGINAL[ \t]*$/;
        const structuralMarkerLine = /^[ \t]*(?:\/\/\s*)?(?:<{7,}[ \t]*ORIGINAL|={7,}|>{7,}[ \t]*UPDATED)[ \t]*$/;
        const fillerCue = /\b(becomes|changes to|should be|here(?:'s| is) (?:the )?(?:fix|patch)|updated code|replace with|fixed code|new code|after)\b/i;

        const lines = text.split('\n');
        for (let i = 1; i < lines.length; i++) {
            if (!originalMarkerLine.test(lines[i])) {
                continue;
            }

            const prev = lines[i - 1];
            const trimmedPrev = prev.trim();
            if (!trimmedPrev) {
                continue;
            }
            if (structuralMarkerLine.test(prev)) {
                continue;
            }

            if (fillerCue.test(prev) || trimmedPrev.endsWith(':')) {
                lines.splice(i - 1, 1);
                i--;
            }
        }

        return lines.join('\n');
    }

    public static parseCodeBlocks(text: string): string[] {
        const blocks: string[] = [];
        const regex = /```(?:\w*)\n([\s\S]*?)\n```/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
            blocks.push(match[1].trim());
        }
        return blocks;
    }
}
