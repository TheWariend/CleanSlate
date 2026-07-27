/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ICleanSlateArtifactService, IArtifact, ICleanSlateArtifactLookupOptions, CLEANSLATE_ARTIFACT_SCHEME } from '../../common/core/cleanSlateAI.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { CleanSlateArtifactFileSystemProvider } from './cleanSlateArtifactFileSystemProvider.js';

export class CleanSlateArtifactService extends Disposable implements ICleanSlateArtifactService {
    _serviceBrand: undefined;

    private readonly artifacts = new Map<string, IArtifact>();
    private readonly _onDidArtifactChange = this._register(new Emitter<IArtifact>());
    readonly onDidArtifactChange: Event<IArtifact> = this._onDidArtifactChange.event;

    constructor(
        @IFileService private readonly fileService: IFileService
    ) {
        super();
        this._register(this.fileService.registerProvider(CLEANSLATE_ARTIFACT_SCHEME, new CleanSlateArtifactFileSystemProvider(this)));
    }

    createArtifact(type: string, content: string, metadata?: any): IArtifact {
        const id = `artifact-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const artifact: IArtifact = {
            id,
            type,
            content,
            timestamp: Date.now(),
            metadata
        };
        this.artifacts.set(id, artifact);
        this.pruneSingletonArtifacts(type, id, this.getMetadataSessionId(metadata));
        this._onDidArtifactChange.fire(artifact);
        return artifact;
    }

    saveArtifact(type: string, content: string, metadata?: any): IArtifact {
        const sessionId = this.getMetadataSessionId(metadata);
        const latest = this.getLatestArtifact(type, sessionId ? { sessionId } : { legacyOnly: true });

        if (!latest) {
            return this.createArtifact(type, content, metadata);
        }

        latest.content = content;
        latest.timestamp = Date.now();
        latest.metadata = metadata;
        this.pruneSingletonArtifacts(type, latest.id, sessionId);
        this._onDidArtifactChange.fire(latest);
        return latest;
    }

    getArtifact(id: string): IArtifact | undefined {
        return this.artifacts.get(id);
    }

    getArtifactsByType(type: string, options?: ICleanSlateArtifactLookupOptions): IArtifact[] {
        return Array.from(this.artifacts.values()).filter(artifact => {
            if (artifact.type !== type) {
                return false;
            }
            return this.matchesLookupOptions(artifact, options);
        });
    }

    getLatestArtifactByType(type: string, options?: ICleanSlateArtifactLookupOptions): IArtifact | undefined {
        if (options?.sessionId) {
            return this.getLatestArtifact(type, options)
                ?? this.getLatestArtifact(type, { sessionId: undefined, legacyOnly: true });
        }
        return this.getLatestArtifact(type, options);
    }

    private getLatestArtifact(type: string, options?: ICleanSlateArtifactLookupOptions & { legacyOnly?: boolean }): IArtifact | undefined {
        let latest: IArtifact | undefined;

        for (const artifact of this.getArtifactsByType(type).filter(artifact => this.matchesLookupOptions(artifact, options))) {
            if (!latest || artifact.timestamp >= latest.timestamp) {
                latest = artifact;
            }
        }

        return latest;
    }

    private pruneSingletonArtifacts(type: string, keepId: string, sessionId: string | undefined): void {
        if (type !== 'implementation_plan' && type !== 'walkthrough') {
            return;
        }

        for (const [id, artifact] of this.artifacts) {
            if (artifact.type === type && id !== keepId && this.getArtifactSessionId(artifact) === sessionId) {
                this.artifacts.delete(id);
            }
        }
    }

    private matchesLookupOptions(artifact: IArtifact, options: (ICleanSlateArtifactLookupOptions & { legacyOnly?: boolean }) | undefined): boolean {
        if (options?.legacyOnly) {
            return !this.getArtifactSessionId(artifact);
        }
        const sessionId = options?.sessionId;
        if (!sessionId) {
            return true;
        }
        return this.getArtifactSessionId(artifact) === sessionId;
    }

    private getArtifactSessionId(artifact: IArtifact): string | undefined {
        return this.getMetadataSessionId(artifact.metadata);
    }

    private getMetadataSessionId(metadata: any): string | undefined {
        const value = metadata && typeof metadata === 'object' ? metadata.sessionId : undefined;
        return typeof value === 'string' && value.length > 0 ? value : undefined;
    }

    deleteArtifact(id: string): void {
        if (this.artifacts.delete(id)) {
            // We don't fire an event for deletion for now, but we could
        }
    }

    clear(): void {
        this.artifacts.clear();
    }
}
