/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { CleanSlateSettingsInput, CLEANSLATE_SETTINGS_SCHEME } from './cleanSlateSettingsInput.js';

export async function openCleanSlateSettingsWindow(editorService: IEditorService, instantiationService: IInstantiationService): Promise<void> {
	const settingsUri = URI.from({ scheme: CLEANSLATE_SETTINGS_SCHEME, path: '/settings' });
	const input = instantiationService.createInstance(CleanSlateSettingsInput, settingsUri);
	await editorService.openEditor(input, {
		pinned: true,
		preserveFocus: false,
		revealIfOpened: true,
	});
}
