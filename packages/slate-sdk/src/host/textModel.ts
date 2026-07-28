/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Slate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../core/uri.js';
import { IRange } from '../core/range.js';
import { IPosition } from '../core/position.js';

/**
 * A text document, reduced to what the runtime actually asks of one.
 *
 * The editor's `ITextModel` has a very large surface — decorations, tokens,
 * language configuration, injected text. The runtime uses about fifteen
 * members, all of them about reading and replacing text. Declaring them here
 * means a headless host can back a document with a file on disk without
 * implementing an editor.
 *
 * The editor's own `ITextModel` satisfies this as written, so the IDE host
 * passes its models straight through with no adapter.
 */
export interface ISlateTextModel {
	readonly uri: URI;

	getValue(): string;
	getValueInRange(range: IRange): string;
	getVersionId(): number;

	getLineCount(): number;
	getLineContent(lineNumber: number): string;
	getLineMaxColumn(lineNumber: number): number;
	getLineLength?(lineNumber: number): number;
	getLinesContent?(): string[];
	getFullModelRange(): IRange;

	getOffsetAt(position: IPosition): number;
	getPositionAt(offset: number): IPosition;

	getLanguageId(): string;

	/** Marks an undo boundary. A host without undo may no-op. */
	pushStackElement(): void;
	pushEditOperations(
		beforeCursorState: null,
		editOperations: readonly ISlateSingleEditOperation[],
		cursorStateComputer: () => null
	): null;
	undo?(): void;
}

/** One replacement within a model. */
export interface ISlateSingleEditOperation {
	range: IRange;
	text: string | null;
	forceMoveMarkers?: boolean;
}

/** Where models are looked up. */
export interface IModelHost {
	getModel(resource: URI): ISlateTextModel | null;
}

/** Persisting a model back to wherever it came from. */
export interface ITextFileHost {
	save(resource: URI, options?: unknown): Promise<unknown>;
	create?(operations: readonly { resource: URI; value: string; options?: { overwrite?: boolean } }[]): Promise<unknown>;
}
