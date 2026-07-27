/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICleanSlateEditCodeService } from './cleanSlateAI.js';
import { URI } from '../../../../../base/common/uri.js';
import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
import { InlineCleanSlateController } from '../../../../../editor/browser/cleanSlate/core/inlineCleanSlateController.js';
import { Event } from '../../../../../base/common/event.js';
import { ITextFileService } from '../../../textfile/common/textfiles.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';

export class CleanSlateEditCodeService implements ICleanSlateEditCodeService {
    declare readonly _serviceBrand: undefined;

    readonly onDidPendingEditsChange: Event<void> = InlineCleanSlateController.onDidChangeGlobalState;

    constructor(
        @ICodeEditorService private readonly codeEditorService: ICodeEditorService,
        @ITextFileService private readonly textFileService: ITextFileService,
        @ICommandService private readonly commandService: ICommandService
    ) { }

    public undoLastAIEdit(uri: URI): void {
        InlineCleanSlateController.undoLastTrackedEdit(this.codeEditorService, uri);
    }

    public acceptAll(): void {
        InlineCleanSlateController.acceptAllGlobal(this.codeEditorService, this.textFileService, this.commandService);
    }

    public rejectAll(): void {
        InlineCleanSlateController.rejectAllGlobal(this.codeEditorService, this.textFileService, this.commandService);
    }

    public hasPendingEdits(): boolean {
        return InlineCleanSlateController.hasAnyPendingEdits();
    }

    public getPendingEditsCount(): number {
        return InlineCleanSlateController.getPendingEditsCount();
    }

    public getPendingEditsInfo(): { uri: URI; added: number; deleted: number }[] {
        return InlineCleanSlateController.getPendingEditsInfo();
    }

    public getPendingEditsDiffs(): { uri: URI; added: number; deleted: number; diff: string; beforeContent: string; afterContent: string }[] {
        return InlineCleanSlateController.getPendingEditsDiffs(this.codeEditorService);
    }
}
