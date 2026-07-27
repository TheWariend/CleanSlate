/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../../base/common/event.js';
import { URI } from '../../../../../../base/common/uri.js';

export interface ICleanSlateEditorSelectionReference {
    readonly uri: URI;
    readonly languageId: string;
    readonly selectedText: string;
    readonly modelVersionId: number;
    readonly range: {
        readonly startLineNumber: number;
        readonly startColumn: number;
        readonly endLineNumber: number;
        readonly endColumn: number;
    };
}

export class CleanSlateChatComposerProvider {
    private activeSessionId = 'default';
    private readonly pendingImagesBySession = new Map<string, string[]>();
    private readonly pendingSelectionsBySession = new Map<string, ICleanSlateEditorSelectionReference[]>();
    private readonly _onDidChangeState = new Emitter<void>();
    readonly onDidChangeState: Event<void> = this._onDidChangeState.event;

    setActiveSession(sessionId: string, fireChange = true): void {
        const nextSessionId = sessionId || 'default';
        if (this.activeSessionId === nextSessionId) {
            return;
        }
        this.activeSessionId = nextSessionId;
        if (fireChange) {
            this._onDidChangeState.fire();
        }
    }

    getPendingImages(): readonly string[] {
        return this.getImagesForActiveSession();
    }

    addPendingImage(imageDataUrl: string): void {
        this.setImagesForActiveSession([...this.getImagesForActiveSession(), imageDataUrl]);
        this._onDidChangeState.fire();
    }

    removePendingImage(index: number): void {
        const pendingImages = this.getImagesForActiveSession();
        if (index < 0 || index >= pendingImages.length) {
            return;
        }
        this.setImagesForActiveSession(pendingImages.filter((_, i) => i !== index));
        this._onDidChangeState.fire();
    }

    clearPendingImages(): void {
        if (this.getImagesForActiveSession().length === 0) {
            return;
        }
        this.setImagesForActiveSession([]);
        this._onDidChangeState.fire();
    }

    getPendingSelectionReferences(): readonly ICleanSlateEditorSelectionReference[] {
        return this.getSelectionsForActiveSession();
    }

    addPendingSelectionReference(reference: ICleanSlateEditorSelectionReference): void {
        const existing = this.getSelectionsForActiveSession();
        const sameSelection = (candidate: ICleanSlateEditorSelectionReference) =>
            candidate.uri.toString() === reference.uri.toString()
            && candidate.range.startLineNumber === reference.range.startLineNumber
            && candidate.range.startColumn === reference.range.startColumn
            && candidate.range.endLineNumber === reference.range.endLineNumber
            && candidate.range.endColumn === reference.range.endColumn;
        this.setSelectionsForActiveSession([
            ...existing.filter(candidate => !sameSelection(candidate)),
            reference
        ]);
        this._onDidChangeState.fire();
    }

    removePendingSelectionReference(index: number): void {
        const pendingSelections = this.getSelectionsForActiveSession();
        if (index < 0 || index >= pendingSelections.length) {
            return;
        }
        this.setSelectionsForActiveSession(pendingSelections.filter((_, i) => i !== index));
        this._onDidChangeState.fire();
    }

    clearPendingSelectionReferences(): void {
        if (this.getSelectionsForActiveSession().length === 0) {
            return;
        }
        this.setSelectionsForActiveSession([]);
        this._onDidChangeState.fire();
    }

    private getImagesForActiveSession(): string[] {
        return this.pendingImagesBySession.get(this.activeSessionId) ?? [];
    }

    private setImagesForActiveSession(images: string[]): void {
        if (images.length === 0) {
            this.pendingImagesBySession.delete(this.activeSessionId);
            return;
        }
        this.pendingImagesBySession.set(this.activeSessionId, images);
    }

    private getSelectionsForActiveSession(): ICleanSlateEditorSelectionReference[] {
        return this.pendingSelectionsBySession.get(this.activeSessionId) ?? [];
    }

    private setSelectionsForActiveSession(selections: ICleanSlateEditorSelectionReference[]): void {
        if (selections.length === 0) {
            this.pendingSelectionsBySession.delete(this.activeSessionId);
            return;
        }
        this.pendingSelectionsBySession.set(this.activeSessionId, selections);
    }
}
