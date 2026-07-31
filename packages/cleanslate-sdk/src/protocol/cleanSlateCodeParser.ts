/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ICleanSlateCodeChunk {
	type: 'function' | 'class' | 'method' | 'block';
	name: string;
	content: string;
	startLine: number;
	endLine: number;
}

/** Lightweight, host-independent source chunking used by every semantic indexer. */
export class CleanSlateCodeParser {

	static parse(text: string, _languageId: string): ICleanSlateCodeChunk[] {
		const chunks: ICleanSlateCodeChunk[] = [];
		const lines = text.split('\n');
		const classPattern = /class\s+([a-zA-Z0-9_]+)/;
		const functionPattern = /(?:function\s+)?([a-zA-Z0-9_]+)\s*\([^)]*\)\s*\{|def\s+([a-zA-Z0-9_]+)\s*\(/;
		let currentClass: string | null = null;
		let blockStart = 0;
		let braceCount = 0;
		let inBlock = false;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const classMatch = classPattern.exec(line);
			if (classMatch) {
				if (inBlock) {
					this.pushChunk(chunks, lines, blockStart, i - 1, 'block', currentClass || 'root');
				}
				currentClass = classMatch[1];
				blockStart = i;
				inBlock = true;
				braceCount = 0;
			}

			const functionMatch = functionPattern.exec(line);
			if (functionMatch && !inBlock) {
				blockStart = i;
				inBlock = true;
				braceCount = 0;
			}

			braceCount += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
			if (inBlock && braceCount <= 0 && line.includes('}')) {
				const name = currentClass || functionMatch?.[1] || functionMatch?.[2] || 'anonymous';
				this.pushChunk(chunks, lines, blockStart, i, currentClass ? 'class' : 'function', name);
				inBlock = false;
				blockStart = i + 1;
			}
		}

		if (blockStart < lines.length) {
			this.pushChunk(chunks, lines, blockStart, lines.length - 1, 'block', 'lingering');
		}
		return chunks;
	}

	private static pushChunk(
		chunks: ICleanSlateCodeChunk[],
		lines: string[],
		start: number,
		end: number,
		type: ICleanSlateCodeChunk['type'],
		name: string
	): void {
		if (start > end) {
			return;
		}
		const content = lines.slice(start, end + 1).join('\n').trim();
		if (content.length < 20) {
			return;
		}

		const maxChunkSize = 4000;
		const overlapChars = 200;
		if (content.length <= maxChunkSize) {
			chunks.push({ type, name, content, startLine: start + 1, endLine: end + 1 });
			return;
		}

		const lineCount = end - start + 1;
		const averageLineLength = content.length / lineCount;
		if (averageLineLength > 500 || content.length > maxChunkSize * 2) {
			for (let offset = 0; offset < content.length; offset += maxChunkSize - overlapChars) {
				const fragment = content.substring(offset, offset + maxChunkSize);
				if (fragment.length >= 20) {
					chunks.push({
						type,
						name: `${name} (frag ${Math.floor(offset / (maxChunkSize - overlapChars)) + 1})`,
						content: fragment,
						startLine: start + Math.floor(offset / averageLineLength) + 1,
						endLine: start + Math.floor((offset + fragment.length) / averageLineLength) + 1
					});
				}
				if (offset + fragment.length >= content.length) {
					break;
				}
			}
			return;
		}

		const overlapLines = 5;
		const totalChunks = Math.ceil(content.length / maxChunkSize);
		const chunkSize = Math.ceil(lineCount / totalChunks);
		for (let line = start; line <= end; line += chunkSize - overlapLines) {
			const subEnd = Math.min(line + chunkSize - 1, end);
			const fragment = lines.slice(line, subEnd + 1).join('\n').trim();
			if (fragment.length >= 20) {
				chunks.push({
					type,
					name: `${name} (part ${Math.floor((line - start) / (chunkSize - overlapLines)) + 1})`,
					content: fragment,
					startLine: line + 1,
					endLine: subEnd + 1
				});
			}
			if (subEnd === end || line + chunkSize > end) {
				break;
			}
		}
	}
}
