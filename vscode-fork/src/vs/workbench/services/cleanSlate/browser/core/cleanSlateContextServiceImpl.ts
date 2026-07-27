/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICleanSlateContext, ICleanSlateContextService } from '../../common/core/cleanSlateAI.js';
import { URI } from '../../../../../base/common/uri.js';
import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
import type { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { IEditorService } from '../../../editor/common/editorService.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';

export class CleanSlateContextService extends Disposable implements ICleanSlateContextService {

    _serviceBrand: undefined;

    constructor(
        @ICodeEditorService private readonly codeEditorService: ICodeEditorService,
        @IEditorService private readonly editorService: IEditorService
    ) {
        super();
    }

    async getContext(): Promise<ICleanSlateContext> {
        const activeEditor = this.getEditorForContext();
        let activeFileContext: ICleanSlateContext['activeFile'] | undefined;

        if (activeEditor && activeEditor.hasModel()) {
            const model = activeEditor.getModel();
            const selection = activeEditor.getSelection();
            const position = activeEditor.getPosition();

            activeFileContext = {
                uri: model.uri,
                // Full editor text is skeletonized on demand by the agent context helper.
                content: '',
                selection: selection ? model.getValueInRange(selection) : '',
                cursorLine: position ? position.lineNumber : 0,
                languageId: model.getLanguageId()
            };
        }

        // Get other open files
        const openFiles = this.editorService.editors
            .map(editor => {
                const resource = editor.resource;
                return resource ? { uri: resource, languageId: '' } : null;
            })
            .filter((f): f is { uri: URI; languageId: string } =>
                f !== null && (!activeFileContext || f.uri.toString() !== activeFileContext.uri.toString())
            );

        return {
            activeFile: activeFileContext,
            openFiles: openFiles
        };
    }

    private getEditorForContext(): ICodeEditor | null {
        const focusedEditor = this.codeEditorService.getFocusedCodeEditor();
        const activeEditor = this.codeEditorService.getActiveCodeEditor();
        const candidates = [
            focusedEditor,
            activeEditor,
            ...this.codeEditorService.listCodeEditors()
        ];
        let fallbackEditor: ICodeEditor | null = null;
        const seen = new Set<string>();

        for (const editor of candidates) {
            if (!editor || seen.has(editor.getId()) || !editor.hasModel()) {
                continue;
            }
            seen.add(editor.getId());
            fallbackEditor ??= editor;

            const model = editor.getModel();
            const selection = editor.getSelection();
            if (model && selection && model.getValueInRange(selection).trim().length > 0) {
                return editor;
            }
        }

        return fallbackEditor;
    }
}
