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
		input: { resource: URI },
		source: ICleanSlateHostCodeEditor | null,
		sideBySide?: boolean
	): Promise<ICleanSlateHostCodeEditor | null>;
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
	apply(
		edits: readonly any[],
		options?: { label?: string; respectAutoSaveConfig?: boolean }
	): Promise<ICleanSlateBulkEditResult>;
}
