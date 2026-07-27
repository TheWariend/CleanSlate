/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { IUntypedEditorInput } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';

export const CLEANSLATE_AGENT_WORKSPACE_SCHEME = 'cleanslate-agent-manager';

export class CleanSlateAgentWorkspaceInput extends EditorInput {

	static readonly ID = 'workbench.editors.cleanSlateAgentWorkspaceInput';

	constructor(private readonly _resource: URI) {
		super();
	}

	override get typeId(): string {
		return CleanSlateAgentWorkspaceInput.ID;
	}

	override get resource(): URI {
		return this._resource;
	}

	override getName(): string {
		return 'Agent Manager';
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(other)) {
			return true;
		}

		if (other instanceof CleanSlateAgentWorkspaceInput) {
			return other.resource.toString() === this.resource.toString();
		}

		return false;
	}
}
