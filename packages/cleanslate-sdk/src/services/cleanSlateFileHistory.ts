/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../core/buffer.js';
import { basename, joinPath, relativePath } from '../core/resources.js';
import { URI } from '../core/uri.js';
import { ISlateTextModel } from '../host/textModel.js';
import { IModelHost } from '../host/textModel.js';
import { FileOperationResult, IFileHost, toFileOperationResult } from '../host/files.js';
import { ITextFileHost } from '../host/textModel.js';

export interface CleanSlateFileHistoryEntry {
	id: string;
	createdAt: string;
	operation: string;
	toolName: string;
	resource: string;
	path: string;
	backupPath: string;
	existed: boolean;
	versionId?: number;
}

interface CleanSlateFileHistoryManifest {
	version: 1;
	entries: CleanSlateFileHistoryEntry[];
}

export interface CleanSlateFileHistoryTrackRequest {
	workspaceRoot: URI | undefined;
	storageRoot?: URI;
	resource: URI;
	fileService: IFileHost;
	modelService?: IModelHost;
	operation: string;
	toolName: string;
	contentOverride?: string;
	existedOverride?: boolean;
	versionId?: number;
}

export interface CleanSlateFileHistoryRewindRequest {
	workspaceRoot: URI | undefined;
	storageRoot?: URI;
	resource?: URI;
	historyEntryId?: string;
	fileService: IFileHost;
	modelService?: IModelHost;
	textFileService?: ITextFileHost;
}

export class CleanSlateFileHistory {
	private static readonly historyFolder = '.cleanslate/file-history';
	private static readonly entriesFolder = '.cleanslate/file-history/entries';
	private static readonly manifestFile = '.cleanslate/file-history/manifest.json';
	private static entryCounter = 0;

	public static async trackEdit(request: CleanSlateFileHistoryTrackRequest): Promise<CleanSlateFileHistoryEntry | undefined> {
		if (!request.workspaceRoot || request.resource.scheme !== request.workspaceRoot.scheme) {
			return undefined;
		}

		const storageBase = request.storageRoot ?? request.workspaceRoot;
		const historyRoot = joinPath(storageBase, this.historyFolder);
		const entriesRoot = joinPath(storageBase, this.entriesFolder);
		await request.fileService.createFolder(entriesRoot);

		const relativeResourcePath = relativePath(request.workspaceRoot, request.resource) ?? request.resource.fsPath;
		const model = request.modelService?.getModel(request.resource);
		const exists = request.existedOverride ?? (model ? true : await request.fileService.exists(request.resource));
		const content = request.contentOverride ?? (model
			? model.getValue()
			: exists
				? (await request.fileService.readFile(request.resource)).value.toString()
				: '');

		const entryId = this.createEntryId(request.resource);
		const backupRelativePath = `${this.entriesFolder}/${entryId}.txt`;
		const backupResource = joinPath(request.storageRoot ?? request.workspaceRoot, backupRelativePath);
		await request.fileService.writeFile(backupResource, VSBuffer.fromString(content));

		const entry: CleanSlateFileHistoryEntry = {
			id: entryId,
			createdAt: new Date().toISOString(),
			operation: request.operation,
			toolName: request.toolName,
			resource: request.resource.toString(),
			path: relativeResourcePath,
			backupPath: backupRelativePath,
			existed: exists,
			versionId: request.versionId ?? model?.getVersionId()
		};

		const manifest = await this.readManifest(request.fileService, historyRoot);
		manifest.entries.push(entry);
		await this.writeManifest(request.fileService, request.storageRoot ?? request.workspaceRoot, manifest);
		return entry;
	}

	public static async rewind(request: CleanSlateFileHistoryRewindRequest): Promise<{ success: boolean; entry?: CleanSlateFileHistoryEntry; message: string }> {
		if (!request.workspaceRoot) {
			return { success: false, message: 'No workspace root is available for CleanSlate file history.' };
		}

		const storageBase = request.storageRoot ?? request.workspaceRoot;
		const historyRoot = joinPath(storageBase, this.historyFolder);
		const manifest = await this.readManifest(request.fileService, historyRoot);
		const entry = this.findRewindEntry(manifest, request.workspaceRoot, request.resource, request.historyEntryId);
		if (!entry) {
			const target = request.historyEntryId ?? request.resource?.fsPath ?? 'requested file';
			return { success: false, message: `No CleanSlate file history entry was found for ${target}.` };
		}

		const targetResource = request.resource ?? URI.parse(entry.resource);
		if (!entry.existed) {
			if (await request.fileService.exists(targetResource)) {
				await request.fileService.del(targetResource, { useTrash: false, recursive: false });
			}
			return {
				success: true,
				entry,
				message: `Restored ${entry.path} to its pre-edit state by deleting the file created in history entry ${entry.id}.`
			};
		}

		const backupResource = joinPath(request.storageRoot ?? request.workspaceRoot, entry.backupPath);
		const backupContent = (await request.fileService.readFile(backupResource)).value.toString();
		await this.restoreContent(targetResource, backupContent, request.fileService, request.modelService, request.textFileService);
		return {
			success: true,
			entry,
			message: `Restored ${entry.path} from CleanSlate file history entry ${entry.id}.`
		};
	}

	private static async restoreContent(
		resource: URI,
		content: string,
		fileService: IFileHost,
		modelService?: IModelHost,
		textFileService?: ITextFileHost
	): Promise<void> {
		const model: ISlateTextModel | null | undefined = modelService?.getModel(resource);
		if (model) {
			model.pushStackElement();
			model.pushEditOperations(null, [{ range: model.getFullModelRange(), text: content }], () => null);
			model.pushStackElement();
			if (textFileService) {
				await textFileService.save(resource);
				return;
			}
		}

		await fileService.writeFile(resource, VSBuffer.fromString(content));
	}

	private static findRewindEntry(
		manifest: CleanSlateFileHistoryManifest,
		workspaceRoot: URI,
		resource: URI | undefined,
		historyEntryId: string | undefined
	): CleanSlateFileHistoryEntry | undefined {
		if (historyEntryId) {
			return manifest.entries.find(entry => entry.id === historyEntryId);
		}

		if (!resource) {
			return manifest.entries[manifest.entries.length - 1];
		}

		const resourceString = resource.toString();
		const resourcePath = relativePath(workspaceRoot, resource) ?? resource.fsPath;
		const normalizedPath = this.normalizePath(resourcePath);
		for (let index = manifest.entries.length - 1; index >= 0; index--) {
			const entry = manifest.entries[index];
			if (entry.resource === resourceString || this.normalizePath(entry.path) === normalizedPath) {
				return entry;
			}
		}
		return undefined;
	}

	private static async readManifest(fileService: IFileHost, historyRoot: URI): Promise<CleanSlateFileHistoryManifest> {
		const manifestResource = joinPath(historyRoot, 'manifest.json');
		if (!await fileService.exists(manifestResource)) {
			return { version: 1, entries: [] };
		}

		try {
			const raw = (await fileService.readFile(manifestResource)).value.toString();
			const parsed = JSON.parse(raw) as Partial<CleanSlateFileHistoryManifest>;
			return {
				version: 1,
				entries: Array.isArray(parsed.entries) ? parsed.entries.filter(this.isEntry) : []
			};
		} catch (error) {
			if (toFileOperationResult(error as Error) === FileOperationResult.FILE_NOT_FOUND) {
				return { version: 1, entries: [] };
			}
			throw error;
		}
	}

	private static async writeManifest(
		fileService: IFileHost,
		workspaceRoot: URI,
		manifest: CleanSlateFileHistoryManifest
	): Promise<void> {
		const manifestResource = joinPath(workspaceRoot, this.manifestFile);
		await fileService.writeFile(manifestResource, VSBuffer.fromString(JSON.stringify(manifest, null, 2)));
	}

	private static isEntry(value: unknown): value is CleanSlateFileHistoryEntry {
		const entry = value as Partial<CleanSlateFileHistoryEntry>;
		return !!entry
			&& typeof entry.id === 'string'
			&& typeof entry.createdAt === 'string'
			&& typeof entry.resource === 'string'
			&& typeof entry.path === 'string'
			&& typeof entry.backupPath === 'string'
			&& typeof entry.existed === 'boolean';
	}

	private static createEntryId(resource: URI): string {
		const counter = (this.entryCounter++).toString(36);
		const stamp = `${Date.now().toString(36)}-${counter}`;
		const safeName = basename(resource).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'file';
		return `${stamp}-${safeName}`;
	}

	private static normalizePath(path: string): string {
		return path.replace(/\\/g, '/').toLowerCase();
	}
}
