/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CleanSlateDiffService } from '@cleanslate/sdk';
import { ICliDiffFile, parseCliDiffFile } from './workspaceReview.js';

export interface ICliEditPreview {
	files: ICliDiffFile[];
	additions: number;
	deletions: number;
}

interface IReplacement {
	file_path?: string;
	path?: string;
	old_string?: string;
	new_string?: string;
	replace_all?: boolean;
}

function resolveWorkspacePath(root: string, requestedPath: string): string | undefined {
	const workspace = path.resolve(root);
	const target = path.isAbsolute(requestedPath)
		? path.resolve(requestedPath)
		: path.resolve(workspace, requestedPath);
	const relative = path.relative(workspace, target);
	return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)) ? target : undefined;
}

function replaceExact(before: string, replacement: IReplacement): string | undefined {
	if (typeof replacement.old_string !== 'string' || typeof replacement.new_string !== 'string') {
		return undefined;
	}
	const matches = before.split(replacement.old_string).length - 1;
	if (matches === 0 || (!replacement.replace_all && matches !== 1)) {
		return undefined;
	}
	return replacement.replace_all
		? before.split(replacement.old_string).join(replacement.new_string)
		: before.replace(replacement.old_string, replacement.new_string);
}

function previewFile(root: string, requestedPath: string, after: string): ICliDiffFile | undefined {
	const target = resolveWorkspacePath(root, requestedPath);
	if (!target) {
		return undefined;
	}
	const before = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
	const relative = path.relative(path.resolve(root), target).replace(/\\/g, '/');
	const diff = CleanSlateDiffService.computeUnifiedDiffFromContents(relative, before, after);
	return diff ? parseCliDiffFile(relative, 'turn', diff) : undefined;
}

export function createEditPreview(root: string, request: { toolName: string; input: unknown }): ICliEditPreview | undefined {
	const input = request.input as any;
	const files: ICliDiffFile[] = [];
	if (request.toolName === 'apply_edit') {
		const requestedPath = input?.file_path ?? input?.path;
		const target = requestedPath && resolveWorkspacePath(root, requestedPath);
		if (target && fs.existsSync(target)) {
			const before = fs.readFileSync(target, 'utf8');
			const after = replaceExact(before, input);
			if (after !== undefined) {
				const preview = previewFile(root, requestedPath, after);
				if (preview) files.push(preview);
			}
		}
	} else if (request.toolName === 'write_file' || request.toolName === 'create_and_write_file') {
		const requestedPath = input?.file_path ?? input?.path;
		if (requestedPath && typeof input?.content === 'string') {
			const preview = previewFile(root, requestedPath, input.content);
			if (preview) files.push(preview);
		}
	} else if (request.toolName === 'multi_file_replace' && Array.isArray(input?.edits)) {
		for (const replacement of input.edits as IReplacement[]) {
			const requestedPath = replacement.file_path ?? replacement.path;
			const target = requestedPath && resolveWorkspacePath(root, requestedPath);
			if (!target || !fs.existsSync(target)) continue;
			const before = fs.readFileSync(target, 'utf8');
			const after = replaceExact(before, replacement);
			if (after === undefined) continue;
			const preview = previewFile(root, requestedPath!, after);
			if (preview) files.push(preview);
		}
	} else if (request.toolName === 'create_multiple_files' && Array.isArray(input?.files)) {
		for (const file of input.files) {
			if (!file?.path || typeof file.content !== 'string') continue;
			const preview = previewFile(root, file.path, file.content);
			if (preview) files.push(preview);
		}
	}
	if (files.length === 0) {
		return undefined;
	}
	return {
		files,
		additions: files.reduce((total, file) => total + file.additions, 0),
		deletions: files.reduce((total, file) => total + file.deletions, 0)
	};
}
