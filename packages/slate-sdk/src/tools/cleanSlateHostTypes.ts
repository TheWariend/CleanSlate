/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../core/uri.js';

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

/** A range as the edit descriptors carry it. */
export interface ICleanSlateEditRange {
	startLineNumber: number;
	startColumn: number;
	endLineNumber: number;
	endColumn: number;
}

/**
 * One text replacement, described rather than constructed.
 *
 * This is deliberately plain data. The editor's bulk-edit service dispatches on
 * `instanceof ResourceTextEdit` (see `editor/browser/services/bulkEditService`
 * and `contrib/bulkEdit/browser/bulkEditService`), so a copy of that class
 * built outside the editor would be a *different* class: every `instanceof`
 * would return false and the edits would be dropped with no error and no failed
 * result. Constructing it is therefore the host's job, not the tool's.
 */
export interface ICleanSlateResourceTextEditDescriptor {
	resource: URI;
	range: ICleanSlateEditRange;
	text: string;
	/** Guards against applying to a model that moved on. */
	versionId?: number;
}

/** Options a caller may pass alongside a batch. */
export interface ICleanSlateBulkEditOptions {
	label?: string;
	respectAutoSaveConfig?: boolean;
}

/**
 * Applying edits across files as one unit.
 *
 * Takes descriptors, not editor objects: the editor host turns them into real
 * `ResourceTextEdit`s, and a headless host writes them straight to the models.
 */
export interface ICleanSlateBulkEditHost {
	applyTextEdits(
		edits: readonly ICleanSlateResourceTextEditDescriptor[],
		options?: ICleanSlateBulkEditOptions
	): Promise<ICleanSlateBulkEditResult>;
}
