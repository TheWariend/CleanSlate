/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IBulkEditService, ResourceTextEdit } from '../../../../../editor/browser/services/bulkEditService.js';
import { reviveHostUri } from './cleanSlateHostUri.js';
import {
	ICleanSlateBulkEditHost,
	ICleanSlateBulkEditOptions,
	ICleanSlateBulkEditResult,
	ICleanSlateResourceTextEditDescriptor
} from '@cleanslate/sdk/tools/cleanSlateHostTypes.js';

/**
 * The editor's implementation of the bulk-edit seam.
 *
 * It exists to keep `new ResourceTextEdit(...)` on this side of the boundary.
 * The bulk-edit service sorts and groups edits by `instanceof ResourceTextEdit`,
 * so the instance has to come from the editor's own class — a structurally
 * identical object, or an identical class defined in another package, is
 * skipped without an error. Building it here means the runtime never has to
 * know the editor's class exists.
 */
export class CleanSlateEditorBulkEditHost implements ICleanSlateBulkEditHost {

	constructor(private readonly bulkEditService: IBulkEditService) { }

	async applyTextEdits(
		edits: readonly ICleanSlateResourceTextEditDescriptor[],
		options?: ICleanSlateBulkEditOptions
	): Promise<ICleanSlateBulkEditResult> {
		const resourceEdits = edits.map(edit => new ResourceTextEdit(
			reviveHostUri(edit.resource),
			{ range: edit.range, text: edit.text },
			edit.versionId
		));

		const result = await this.bulkEditService.apply(resourceEdits, {
			label: options?.label,
			respectAutoSaveConfig: options?.respectAutoSaveConfig
		});

		return { isApplied: result.isApplied };
	}
}
