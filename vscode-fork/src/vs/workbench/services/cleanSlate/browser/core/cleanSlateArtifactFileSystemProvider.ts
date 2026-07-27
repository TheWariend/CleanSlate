/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { IDisposable, Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileSystemProvider, FileSystemProviderCapabilities, IFileChange, IWatchOptions, IStat, FileType, IFileDeleteOptions, IFileOverwriteOptions, IFileWriteOptions } from '../../../../../platform/files/common/files.js';
import { ICleanSlateArtifactService } from '../../common/core/cleanSlateAI.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';

export class CleanSlateArtifactFileSystemProvider extends Disposable implements IFileSystemProvider {

    readonly capabilities: FileSystemProviderCapabilities = FileSystemProviderCapabilities.FileReadWrite | FileSystemProviderCapabilities.PathCaseSensitive;
    readonly onDidChangeCapabilities: Event<void> = Event.None;

    private readonly _onDidChangeFile = this._register(new Emitter<readonly IFileChange[]>());
    readonly onDidChangeFile: Event<readonly IFileChange[]> = this._onDidChangeFile.event;

    constructor(
        @ICleanSlateArtifactService private readonly artifactService: ICleanSlateArtifactService
    ) {
        super();
    }

    watch(resource: URI, opts: IWatchOptions): IDisposable {
        return Disposable.None;
    }

    async stat(resource: URI): Promise<IStat> {
        const artifact = this.getArtifactFromUri(resource);
        if (!artifact) {
            throw new Error('File not found');
        }

        return {
            type: FileType.File,
            ctime: artifact.timestamp ?? Date.now(),
            mtime: artifact.timestamp ?? Date.now(),
            size: VSBuffer.fromString(artifact.content).byteLength
        };
    }

    async mkdir(resource: URI): Promise<void> {
        throw new Error('Method not supported');
    }

    async readdir(resource: URI): Promise<[string, FileType][]> {
        return [];
    }

    async delete(resource: URI, opts: IFileDeleteOptions): Promise<void> {
        const artifactId = this.getArtifactIdFromUri(resource);
        this.artifactService.deleteArtifact(artifactId);
    }

    async rename(from: URI, to: URI, opts: IFileOverwriteOptions): Promise<void> {
        throw new Error('Method not supported');
    }

    async readFile(resource: URI): Promise<Uint8Array> {
        const artifact = this.getArtifactFromUri(resource);
        if (!artifact) {
            throw new Error('File not found');
        }

        return VSBuffer.fromString(artifact.content).buffer;
    }

    async writeFile(resource: URI, content: Uint8Array, opts: IFileWriteOptions): Promise<void> {
        void opts;

        // We could support writing back to artifacts if needed
        const text = VSBuffer.wrap(content).toString();
        const existingArtifact = this.artifactService.getArtifact(this.getArtifactIdFromUri(resource));
        if (existingArtifact) {
            this.artifactService.saveArtifact(existingArtifact.type, text, { ...existingArtifact.metadata, filename: existingArtifact.metadata?.filename ?? resource.path });
            return;
        }

        const artifactType = this.getArtifactTypeFromUri(resource);
        if (artifactType) {
            this.artifactService.saveArtifact(artifactType, text, { filename: resource.path });
        }
    }

    private getArtifactTypeFromUri(resource: URI): string | undefined {
        const basename = resource.path.split('/').pop()?.toLowerCase();
        if (basename === 'implementation_plan.md') {
            return 'implementation_plan';
        }
        if (basename === 'walkthrough.md') {
            return 'walkthrough';
        }
        if (basename === 'analysis.md') {
            return 'analysis';
        }
        return undefined;
    }

    private getArtifactFromUri(resource: URI) {
        const artifactId = this.getArtifactIdFromUri(resource);
        const artifact = this.artifactService.getArtifact(artifactId);
        if (artifact) {
            return artifact;
        }

        const artifactType = this.getArtifactTypeFromUri(resource);
        if (!artifactType) {
            return undefined;
        }

        return this.artifactService.getLatestArtifactByType(artifactType);
    }

    private getArtifactIdFromUri(resource: URI): string {
        // URI format: cleanslate-artifact:/plans/artifact-id/filename.md
        const parts = resource.path.split('/');
        if (parts.length >= 3 && parts[1] === 'plans') {
            return parts[2];
        }
        return resource.path.split('/').pop() || '';
    }
}
