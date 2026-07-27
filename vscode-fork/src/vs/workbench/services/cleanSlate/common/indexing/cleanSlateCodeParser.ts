/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ICodeChunk {
    type: 'function' | 'class' | 'method' | 'block';
    name: string;
    content: string;
    startLine: number;
    endLine: number;
}

export class CleanSlateCodeParser {

    /**
     * Parse code into meaningful semantic chunks.
     * This avoids breaking functions or classes across vector chunks.
     */
    public static parse(text: string, languageId: string): ICodeChunk[] {
        const chunks: ICodeChunk[] = [];
        const lines = text.split('\n');

        // Basic Regex-based symbol extraction (Production fallback when full AST is too heavy)
        // Supported handles: TS/JS, Python, Dart
        const patterns = {
            class: /class\s+([a-zA-Z0-9_]+)/g,
            function: /(?:function\s+)?([a-zA-Z0-9_]+)\s*\([^)]*\)\s*\{|def\s+([a-zA-Z0-9_]+)\s*\(/g,
        };

        let currentClass: string | null = null;
        let blockStart = 0;
        let braceCount = 0;
        let inBlock = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Detect Class
            const classMatch = patterns.class.exec(line);
            if (classMatch) {
                if (inBlock) {
                    this.pushChunk(chunks, lines, blockStart, i - 1, 'block', currentClass || 'root');
                }
                currentClass = classMatch[1];
                blockStart = i;
                inBlock = true;
                braceCount = 0;
            }

            // Detect Function/Method
            const funcMatch = patterns.function.exec(line);
            if (funcMatch && !inBlock) {
                blockStart = i;
                inBlock = true;
                braceCount = 0;
            }

            // Tracking braces for closure
            const openBraces = (line.match(/\{/g) || []).length;
            const closeBraces = (line.match(/\}/g) || []).length;
            braceCount += (openBraces - closeBraces);

            if (inBlock && braceCount <= 0 && line.includes('}')) {
                const name = currentClass || 'anonymous';
                this.pushChunk(chunks, lines, blockStart, i, currentClass ? 'class' : 'function', name);
                inBlock = false;
                blockStart = i + 1;
            }
        }

        // Final lingering block
        if (blockStart < lines.length) {
            this.pushChunk(chunks, lines, blockStart, lines.length - 1, 'block', 'lingering');
        }

        return chunks;
    }

    private static pushChunk(chunks: ICodeChunk[], lines: string[], start: number, end: number, type: ICodeChunk['type'], name: string) {
        if (start > end) return;
        const content = lines.slice(start, end + 1).join('\n').trim();
        if (content.length < 20) return; // Skip trivial chunks

        // Threshold for recursive splitting (approx 4000 chars to fit in most context windows)
        const MAX_CHUNK_SIZE = 4000;
        const OVERLAP_CHARS = 200;

        if (content.length > MAX_CHUNK_SIZE) {
            // CHECK FOR LONG LINES: If we have very few lines but huge content, it's likely minified
            const lineCount = end - start + 1;
            const avgLineLength = content.length / lineCount;

            if (avgLineLength > 500 || content.length > MAX_CHUNK_SIZE * 2) {
                // CHARACTER-BASED SPLITTING (for minified files or large arrays/JSON)
                for (let i = 0; i < content.length; i += MAX_CHUNK_SIZE - OVERLAP_CHARS) {
                    const subContent = content.substring(i, i + MAX_CHUNK_SIZE);
                    if (subContent.length < 20) continue;

                    chunks.push({
                        type,
                        name: `${name} (frag ${Math.floor(i / (MAX_CHUNK_SIZE - OVERLAP_CHARS)) + 1})`,
                        content: subContent,
                        startLine: start + Math.floor(i / avgLineLength) + 1,
                        endLine: start + Math.floor((i + subContent.length) / avgLineLength) + 1
                    });

                    if (i + subContent.length >= content.length) break;
                }
            } else {
                // LINE-BASED SPLITTING (Already implemented robustly)
                const OVERLAP_LINES = 5;
                const totalChunks = Math.ceil(content.length / MAX_CHUNK_SIZE);
                const chunkSize = Math.ceil(lineCount / totalChunks);

                for (let i = start; i <= end; i += chunkSize - OVERLAP_LINES) {
                    const subEnd = Math.min(i + chunkSize - 1, end);
                    const subLines = lines.slice(i, subEnd + 1);
                    const subContent = subLines.join('\n').trim();
                    if (subContent.length < 20) continue;

                    chunks.push({
                        type,
                        name: `${name} (part ${Math.floor((i - start) / (chunkSize - OVERLAP_LINES)) + 1})`,
                        content: subContent,
                        startLine: i + 1,
                        endLine: subEnd + 1
                    });

                    if (subEnd === end) break;
                    if (i + chunkSize > end) break;
                }
            }
        } else {
            chunks.push({
                type,
                name,
                content,
                startLine: start + 1,
                endLine: end + 1
            });
        }
    }
}
