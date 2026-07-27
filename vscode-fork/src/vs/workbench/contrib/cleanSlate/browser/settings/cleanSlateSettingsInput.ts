/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IUntypedEditorInput } from '../../../../common/editor.js';

export const CLEANSLATE_SETTINGS_SCHEME = 'cleanslate-settings';

export class CleanSlateSettingsInput extends EditorInput {

	static readonly ID = 'workbench.editors.cleanSlateSettingsInput';

	constructor(private readonly _resource: URI) {
		super();
	}

	override get typeId(): string {
		return CleanSlateSettingsInput.ID;
	}

	override get resource(): URI {
		return this._resource;
	}

	override getName(): string {
		return 'CleanSlate Settings';
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(other)) {
			return true;
		}

		if (other instanceof CleanSlateSettingsInput) {
			return other.resource.toString() === this.resource.toString();
		}

		return false;
	}
}
