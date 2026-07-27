/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { AUX_WINDOW_GROUP, IEditorService } from '../../../../services/editor/common/editorService.js';
import { CLEANSLATE_AGENT_WORKSPACE_SCHEME, CleanSlateAgentWorkspaceInput } from './cleanSlateAgentWorkspaceInput.js';

const CLEANSLATE_AGENT_WORKSPACE_WINDOW_BOUNDS = { width: 1360, height: 860 };

export async function openCleanSlateAgentManagerWindow(editorService: IEditorService, instantiationService: IInstantiationService): Promise<void> {
	const agentManagerUri = URI.from({ scheme: CLEANSLATE_AGENT_WORKSPACE_SCHEME, path: '/agent-manager' });
	const input = instantiationService.createInstance(CleanSlateAgentWorkspaceInput, agentManagerUri);
	await editorService.openEditor(input, {
		pinned: true,
		preserveFocus: false,
		revealIfOpened: true,
		auxiliary: {
			bounds: CLEANSLATE_AGENT_WORKSPACE_WINDOW_BOUNDS,
			compact: true,
			hideTitlebar: true
		}
	}, AUX_WINDOW_GROUP);
}
