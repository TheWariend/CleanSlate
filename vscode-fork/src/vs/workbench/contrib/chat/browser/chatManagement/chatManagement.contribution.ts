/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { IEditorPaneRegistry, EditorPaneDescriptor } from '../../../../browser/editor.js';
import { EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { ChatManagementEditor, ModelsManagementEditor } from './chatManagementEditor.js';
import { ChatManagementEditorInput, ModelsManagementEditorInput } from './chatManagementEditorInput.js';

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		ChatManagementEditor,
		ChatManagementEditor.ID,
		localize('chatManagementEditor', "Chat Management Editor")
	),
	[
		new SyncDescriptor(ChatManagementEditorInput)
	]
);

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		ModelsManagementEditor,
		ModelsManagementEditor.ID,
		localize('modelsManagementEditor', "Models Management Editor")
	),
	[
		new SyncDescriptor(ModelsManagementEditorInput)
	]
);

class ChatManagementEditorInputSerializer implements IEditorSerializer {

	canSerialize(editorInput: EditorInput): boolean {
		return true;
	}

	serialize(input: ChatManagementEditorInput): string {
		return '';
	}

	deserialize(instantiationService: IInstantiationService): ChatManagementEditorInput {
		return instantiationService.createInstance(ChatManagementEditorInput);
	}
}

class ModelsManagementEditorInputSerializer implements IEditorSerializer {

	canSerialize(editorInput: EditorInput): boolean {
		return true;
	}

	serialize(input: ModelsManagementEditorInput): string {
		return '';
	}

	deserialize(instantiationService: IInstantiationService): ModelsManagementEditorInput {
		return instantiationService.createInstance(ModelsManagementEditorInput);
	}
}

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(ChatManagementEditorInput.ID, ChatManagementEditorInputSerializer);
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(ModelsManagementEditorInput.ID, ModelsManagementEditorInputSerializer);
