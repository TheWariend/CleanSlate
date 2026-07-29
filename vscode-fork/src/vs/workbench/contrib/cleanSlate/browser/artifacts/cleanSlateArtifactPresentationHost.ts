/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ACTIVE_GROUP, IEditorService } from '../../../../services/editor/common/editorService.js';
import type { IArtifactPresentationHost } from '@cleanslate/sdk';
import { CleanSlateArtifactInput } from './cleanSlateArtifactInput.js';
import { reviveHostUri } from '../host/cleanSlateHostUri.js';

/**
 * Shows a generated artifact in the workbench.
 *
 * `submit_artifact` used to build the editor input itself, which tied the tool
 * to `EditorInput` and left a terminal front-end with no way to run it. The
 * tool now just asks its host to present the artifact; this is the workbench's
 * answer, and opening a dedicated editor in the active group is the whole of
 * it.
 */
export class CleanSlateArtifactPresentationHost implements IArtifactPresentationHost {

	constructor(
		private readonly instantiationService: IInstantiationService,
		private readonly editorService: IEditorService
	) { }

	async openArtifact(resource: URI, artifactId: string, options?: { preserveFocus?: boolean }): Promise<void> {
		const input = this.instantiationService.createInstance(CleanSlateArtifactInput, reviveHostUri(resource), artifactId);
		await this.editorService.openEditor(input, { pinned: true, preserveFocus: options?.preserveFocus === true }, ACTIVE_GROUP);
	}
}
