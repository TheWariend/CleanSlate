/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';

/**
 * Three capabilities the tools need from whatever is hosting them: apply a set
 * of edits, run a terminal, and bring a file into view.
 *
 * They are declared here, structurally, rather than imported from the editor —
 * those imports are `browser`-layer and would pin the tools to VS Code. The
 * real services satisfy these shapes as they are, so the editor host needs no
 * adapter; a headless host implements them over the filesystem and a child
 * process, and leaves the reveal a no-op.
 */

/** A text model as the tools use it: somewhere a URI points. */
export interface ICleanSlateHostTextModel {
	uri: URI;
}

/** An open editor, reduced to the one question the tools ask of it. */
export interface ICleanSlateHostCodeEditor {
	getModel(): ICleanSlateHostTextModel | null;
}

/**
 * Bringing a file into view. Purely presentational — a headless host
 * implements this as a no-op and nothing downstream changes.
 */
export interface ICleanSlateEditorRevealHost {
	getActiveCodeEditor(): ICleanSlateHostCodeEditor | null;
	openCodeEditor(
		input: { resource: URI; options?: any },
		source: ICleanSlateHostCodeEditor | null,
		sideBySide?: boolean
	): Promise<ICleanSlateHostCodeEditor | null>;
}

/** One edit as the decoration host renders it, before it was applied. */
export interface ICleanSlateOriginalEditForDisplay {
	range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
	text: string;
	originalStartLine: number;
}

/**
 * Inline accept/reject decorations over an applied edit. Entirely
 * presentational: a headless host omits it and the edit still lands, which is
 * why every member is safe to skip.
 */
export interface ICleanSlateEditorDecorationHost {
	/**
	 * Show the post-apply diff for a file that is currently on screen. Does
	 * nothing when the file is not open.
	 */
	showPostApply(
		uri: URI,
		edits: readonly any[],
		originalEdits: readonly ICleanSlateOriginalEditForDisplay[],
		beforeContent: string
	): void;

	/** Track an applied edit so it can be reviewed or undone later. */
	registerPostApplySession(
		uri: URI,
		edits: readonly any[],
		originalEdits: readonly ICleanSlateOriginalEditForDisplay[],
		beforeContent: string,
		initialInstruction?: string
	): void;

	/** Reverse the last tracked edit. Returns false when there is nothing to undo. */
	undoLastTrackedEdit(uri: URI): boolean;
}

/** Result of applying a batch of edits. */
export interface ICleanSlateBulkEditResult {
	isApplied: boolean;
}

/**
 * Applying edits across files as one unit. `edits` stays loosely typed because
 * its shape is the host's concern: workspace edits in the editor, plain writes
 * headless.
 */
export interface ICleanSlateBulkEditHost {
	// `edit` and `options` stay untyped so the editor's bulk-edit service
	// satisfies this as written: it accepts a resource-edit union and a wider
	// options bag, and narrowing either here would reject it.
	apply(edit: any, options?: any): Promise<ICleanSlateBulkEditResult>;
}
