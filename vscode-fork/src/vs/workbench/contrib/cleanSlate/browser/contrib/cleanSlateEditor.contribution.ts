/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from '../../../../../platform/registry/common/platform.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../../browser/editor.js';
import { EditorExtensions } from '../../../../common/editor.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { CleanSlateArtifactInput } from '../artifacts/cleanSlateArtifactInput.js';
import { CleanSlateArtifactEditor } from '../artifacts/cleanSlateArtifactEditor.js';
import { CleanSlateSettingsEditor } from '../settings/cleanSlateSettingsEditor.js';
import { CleanSlateSettingsInput } from '../settings/cleanSlateSettingsInput.js';
import { CleanSlateAgentWorkspaceEditor } from '../agentManager/cleanSlateAgentWorkspaceEditor.js';
import { CleanSlateAgentWorkspaceInput } from '../agentManager/cleanSlateAgentWorkspaceInput.js';
import { localize } from '../../../../../nls.js';



// Register Artifact Editor
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
    EditorPaneDescriptor.create(
        CleanSlateArtifactEditor,
        CleanSlateArtifactEditor.ID,
        localize('cleanSlate.artifactEditor', "CleanSlate Artifact")
    ),
    [
        new SyncDescriptor(CleanSlateArtifactInput)
    ]
);

// Register Settings Editor
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
    EditorPaneDescriptor.create(
        CleanSlateSettingsEditor,
        CleanSlateSettingsEditor.ID,
        localize('cleanSlate.settingsEditor', "CleanSlate Settings")
    ),
    [
        new SyncDescriptor(CleanSlateSettingsInput)
    ]
);

// Register Agent Manager Editor
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
    EditorPaneDescriptor.create(
        CleanSlateAgentWorkspaceEditor,
        CleanSlateAgentWorkspaceEditor.ID,
        localize('cleanSlate.agentWorkspaceEditor', "CleanSlate Agent Manager")
    ),
    [
        new SyncDescriptor(CleanSlateAgentWorkspaceInput)
    ]
);
