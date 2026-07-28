/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { URI } from '../core/uri.js';
import { CleanSlateNodeTextModel } from './cleanSlateNodeTextModel.js';

/** A directory entry, shaped as the tools read it back. */
export interface ICleanSlateNodeStat {
	resource: URI;
	name: string;
	isDirectory: boolean;
	isFile: boolean;
	size: number;
	mtime: number;
	children?: ICleanSlateNodeStat[];
}

function languageIdFor(filePath: string): string {
	const byExtension: Record<string, string> = {
		'.ts': 'typescript', '.tsx': 'typescriptreact',
		'.js': 'javascript', '.jsx': 'javascriptreact',
		'.json': 'json', '.md': 'markdown', '.css': 'css', '.html': 'html',
		'.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java',
		'.dart': 'dart', '.rb': 'ruby', '.sh': 'shellscript', '.yml': 'yaml', '.yaml': 'yaml'
	};
	return byExtension[path.extname(filePath).toLowerCase()] ?? 'plaintext';
}

/**
 * The editor's file service over `fs`. Only the members the agent tools call
 * are implemented; the rest of the editor's interface is irrelevant headlessly.
 */
export class CleanSlateNodeFileService {

	async exists(resource: URI): Promise<boolean> {
		try {
			await fs.promises.access(resource.fsPath);
			return true;
		} catch {
			return false;
		}
	}

	async stat(resource: URI): Promise<ICleanSlateNodeStat> {
		return this.toStat(resource, false);
	}

	/** Directory contents come back one level deep, which is all `list_dir` reads. */
	async resolve(resource: URI): Promise<ICleanSlateNodeStat> {
		return this.toStat(resource, true);
	}

	async readFile(resource: URI): Promise<{ value: { toString(): string } }> {
		const buffer = await fs.promises.readFile(resource.fsPath);
		return { value: { toString: () => buffer.toString('utf8') } };
	}

	async writeFile(resource: URI, content: { toString(): string } | string): Promise<void> {
		await fs.promises.mkdir(path.dirname(resource.fsPath), { recursive: true });
		await fs.promises.writeFile(resource.fsPath, content.toString(), 'utf8');
	}

	async createFolder(resource: URI): Promise<void> {
		await fs.promises.mkdir(resource.fsPath, { recursive: true });
	}

	async del(resource: URI, options?: { recursive?: boolean }): Promise<void> {
		await fs.promises.rm(resource.fsPath, { recursive: options?.recursive ?? false, force: true });
	}

	private async toStat(resource: URI, withChildren: boolean): Promise<ICleanSlateNodeStat> {
		const stat = await fs.promises.stat(resource.fsPath);
		const entry: ICleanSlateNodeStat = {
			resource,
			name: path.basename(resource.fsPath),
			isDirectory: stat.isDirectory(),
			isFile: stat.isFile(),
			size: stat.size,
			mtime: stat.mtimeMs
		};
		if (withChildren && entry.isDirectory) {
			const names = await fs.promises.readdir(resource.fsPath);
			entry.children = await Promise.all(names.map(async name => {
				const child = URI.file(path.join(resource.fsPath, name));
				try {
					return await this.toStat(child, false);
				} catch {
					// A broken symlink or a file removed mid-listing should not
					// fail the whole directory read.
					return { resource: child, name, isDirectory: false, isFile: false, size: 0, mtime: 0 };
				}
			}));
		}
		return entry;
	}
}

/**
 * Text-file access plus the model cache behind `modelService.getModel`. Models
 * are kept so an edit and the read that follows it see the same buffer and
 * version, which is what the edit engine's version guard checks.
 */
export class CleanSlateNodeTextFileService {

	private readonly models = new Map<string, CleanSlateNodeTextModel>();

	constructor(private readonly fileService: CleanSlateNodeFileService) { }

	/** Mirrors `textFileService.files`, whose only used member is `resolve`. */
	public readonly files = {
		resolve: async (resource: URI): Promise<CleanSlateNodeTextModel> => this.resolveModel(resource)
	};

	async read(resource: URI): Promise<{ value: string; encoding: string }> {
		const model = await this.resolveModel(resource);
		return { value: model.getValue(), encoding: 'utf8' };
	}

	async create(operations: readonly { resource: URI; value?: string }[]): Promise<void> {
		for (const operation of operations) {
			await this.fileService.writeFile(operation.resource, operation.value ?? '');
			this.models.delete(operation.resource.toString());
		}
	}

	/** Flushes the in-memory model to disk. */
	async save(resource: URI): Promise<URI | undefined> {
		const model = this.models.get(resource.toString());
		if (!model) {
			return undefined;
		}
		await this.fileService.writeFile(resource, model.getValue());
		return resource;
	}

	getModel(resource: URI): CleanSlateNodeTextModel | undefined {
		return this.models.get(resource.toString());
	}

	private async resolveModel(resource: URI): Promise<CleanSlateNodeTextModel> {
		const key = resource.toString();
		const existing = this.models.get(key);
		if (existing) {
			return existing;
		}
		const contents = await this.fileService.readFile(resource);
		const model = new CleanSlateNodeTextModel(resource, contents.value.toString(), languageIdFor(resource.fsPath));
		this.models.set(key, model);
		return model;
	}
}

/** `modelService`, whose only used member is `getModel`. */
export class CleanSlateNodeModelService {
	constructor(private readonly textFileService: CleanSlateNodeTextFileService) { }

	getModel(resource: URI): CleanSlateNodeTextModel | undefined {
		return this.textFileService.getModel(resource);
	}
}
