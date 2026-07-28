/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../core/uri.js';

interface IPosition {
	lineNumber: number;
	column: number;
}

interface IRange {
	startLineNumber: number;
	startColumn: number;
	endLineNumber: number;
	endColumn: number;
}

interface ISingleEditOperation {
	range: IRange;
	text: string | null;
}

/**
 * The slice of the editor's text model the agent tools actually use, backed by
 * a string instead of the editor.
 *
 * Positions follow the editor's convention throughout: lines and columns are
 * 1-based, and a column may equal the line length plus one, meaning the caret
 * sits after the final character.
 */
export class CleanSlateNodeTextModel {

	private value: string;
	private versionId: number = 1;
	/** Offset at which each line starts. Rebuilt whenever the text changes. */
	private lineStarts: number[] = [];

	constructor(
		public readonly uri: URI,
		initialValue: string,
		private readonly languageId: string = 'plaintext'
	) {
		this.value = initialValue;
		this.recomputeLineStarts();
	}

	private recomputeLineStarts(): void {
		this.lineStarts = [0];
		for (let i = 0; i < this.value.length; i++) {
			if (this.value.charCodeAt(i) === 10 /* \n */) {
				this.lineStarts.push(i + 1);
			}
		}
	}

	getValue(): string {
		return this.value;
	}

	getVersionId(): number {
		return this.versionId;
	}

	getLanguageId(): string {
		return this.languageId;
	}

	getLineCount(): number {
		return this.lineStarts.length;
	}

	getLineContent(lineNumber: number): string {
		const start = this.lineStarts[lineNumber - 1];
		if (start === undefined) {
			return '';
		}
		const nextStart = this.lineStarts[lineNumber];
		// Trim the newline that belongs to this line, and the \r of a CRLF pair.
		const end = nextStart === undefined ? this.value.length : nextStart - 1;
		const line = this.value.slice(start, end);
		return line.endsWith('\r') ? line.slice(0, -1) : line;
	}

	getLineMaxColumn(lineNumber: number): number {
		return this.getLineContent(lineNumber).length + 1;
	}

	getOffsetAt(position: IPosition): number {
		const lineStart = this.lineStarts[position.lineNumber - 1];
		if (lineStart === undefined) {
			return this.value.length;
		}
		const maxColumn = this.getLineMaxColumn(position.lineNumber);
		const column = Math.min(Math.max(position.column, 1), maxColumn);
		return lineStart + (column - 1);
	}

	getPositionAt(offset: number): IPosition {
		const clamped = Math.min(Math.max(offset, 0), this.value.length);
		// Last line whose start is at or before the offset.
		let low = 0;
		let high = this.lineStarts.length - 1;
		while (low < high) {
			const mid = Math.ceil((low + high) / 2);
			if (this.lineStarts[mid] <= clamped) {
				low = mid;
			} else {
				high = mid - 1;
			}
		}
		return { lineNumber: low + 1, column: clamped - this.lineStarts[low] + 1 };
	}

	getValueInRange(range: IRange): string {
		const start = this.getOffsetAt({ lineNumber: range.startLineNumber, column: range.startColumn });
		const end = this.getOffsetAt({ lineNumber: range.endLineNumber, column: range.endColumn });
		return this.value.slice(Math.min(start, end), Math.max(start, end));
	}

	/**
	 * No undo stack here, so this is a no-op. It exists because the tools call
	 * it around edits and the editor uses it to group them.
	 */
	pushStackElement(): void {
		// intentionally empty
	}

	/**
	 * Applies edits and bumps the version. Edits are sorted and applied from the
	 * end backwards so earlier offsets stay valid as the text shifts.
	 */
	pushEditOperations(
		_beforeCursorState: unknown,
		operations: readonly ISingleEditOperation[],
		_cursorStateComputer?: unknown
	): null {
		const resolved = operations.map(op => ({
			start: this.getOffsetAt({ lineNumber: op.range.startLineNumber, column: op.range.startColumn }),
			end: this.getOffsetAt({ lineNumber: op.range.endLineNumber, column: op.range.endColumn }),
			text: op.text ?? ''
		})).sort((a, b) => b.start - a.start);

		let next = this.value;
		for (const op of resolved) {
			const from = Math.min(op.start, op.end);
			const to = Math.max(op.start, op.end);
			next = next.slice(0, from) + op.text + next.slice(to);
		}

		if (next !== this.value) {
			this.value = next;
			this.versionId++;
			this.recomputeLineStarts();
		}
		return null;
	}

	/** Replaces the whole buffer, as a save from outside would. */
	setValue(value: string): void {
		if (value === this.value) {
			return;
		}
		this.value = value;
		this.versionId++;
		this.recomputeLineStarts();
	}
}
