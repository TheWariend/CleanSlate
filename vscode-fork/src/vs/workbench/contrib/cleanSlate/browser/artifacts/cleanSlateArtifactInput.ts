/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorInput } from '../../../../common/editor/editorInput.js';
import { URI } from '../../../../../base/common/uri.js';
import { ICleanSlateArtifactService, IArtifact } from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { IUntypedEditorInput } from '../../../../common/editor.js';

export class CleanSlateArtifactInput extends EditorInput {

    static readonly ID = 'workbench.editors.cleanSlateArtifactInput';

    constructor(
        private readonly _resource: URI,
        private readonly artifactId: string,
        @ICleanSlateArtifactService private readonly artifactService: ICleanSlateArtifactService
    ) {
        super();
    }

    override get typeId(): string {
        return CleanSlateArtifactInput.ID;
    }

    override get resource(): URI {
        return this._resource;
    }

    getArtifactId(): string {
        return this.artifactId;
    }

    getArtifact(): IArtifact | undefined {
        return this.artifactService.getArtifact(this.artifactId);
    }

    override getName(): string {
        const artifact = this.getArtifact();
        if (artifact?.type === 'implementation_plan') {
            return 'Implementation Plan';
        } else if (artifact?.type === 'walkthrough') {
            return 'Walkthrough';
        } else if (artifact?.type === 'analysis') {
            return 'Research Analysis';
        }
        return 'CleanSlate Artifact';
    }

    override matches(other: EditorInput | IUntypedEditorInput): boolean {
        if (super.matches(other)) {
            return true;
        }

        if (other instanceof CleanSlateArtifactInput) {
            return other.resource.toString() === this.resource.toString();
        }

        return false;
    }
}
