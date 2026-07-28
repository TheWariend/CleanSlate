/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Slate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../core/uri.js';
import { VSBuffer } from '../core/buffer.js';

/**
 * Filesystem access, as the runtime uses it.
 *
 * `FileOperationResult` is a `const enum` upstream, so it is redeclared here as
 * a real enum for the same reason as the other converted enums — the values
 * have to exist at runtime once they cross a package boundary. The members and
 * their order match upstream, because hosts report these numerically.
 */
export enum FileOperationResult {
	FILE_IS_DIRECTORY,
	FILE_NOT_FOUND,
	FILE_NOT_MODIFIED_SINCE,
	FILE_MODIFIED_SINCE,
	FILE_MOVE_CONFLICT,
	FILE_WRITE_LOCKED,
	FILE_PERMISSION_DENIED,
	FILE_TOO_LARGE,
	FILE_INVALID_PATH,
	FILE_NOT_DIRECTORY,
	FILE_OTHER_ERROR
}

/** An error a file host raises, carrying a classified result. */
export interface IFileOperationError extends Error {
	fileOperationResult: FileOperationResult;
}

function isFileOperationError(error: unknown): error is IFileOperationError {
	return error instanceof Error && typeof (error as IFileOperationError).fileOperationResult === 'number';
}

/**
 * Classifies an error from a file host.
 *
 * Upstream this also understands the editor's provider error codes. Here it
 * reads the classified result when the host supplied one, and otherwise falls
 * back to Node's `errno` codes, which is what a filesystem-backed host raises.
 */
export function toFileOperationResult(error: unknown): FileOperationResult {
	if (isFileOperationError(error)) {
		return error.fileOperationResult;
	}
	const code = (error as NodeJS.ErrnoException | undefined)?.code;
	switch (code) {
		case 'ENOENT': return FileOperationResult.FILE_NOT_FOUND;
		case 'EISDIR': return FileOperationResult.FILE_IS_DIRECTORY;
		case 'ENOTDIR': return FileOperationResult.FILE_NOT_DIRECTORY;
		case 'EACCES':
		case 'EPERM': return FileOperationResult.FILE_PERMISSION_DENIED;
		case 'EEXIST': return FileOperationResult.FILE_MOVE_CONFLICT;
		case 'EFBIG': return FileOperationResult.FILE_TOO_LARGE;
		case 'EBUSY': return FileOperationResult.FILE_WRITE_LOCKED;
		default: return FileOperationResult.FILE_OTHER_ERROR;
	}
}

export interface IFileStat {
	mtime: number;
	size?: number;
	ctime?: number;
	etag?: string;
	isDirectory?: boolean;
	isFile?: boolean;
	children?: readonly IFileStat[];
	resource?: URI;
	name?: string;
}

export interface IFileContent {
	value: VSBuffer | { toString(): string };
}

/** The filesystem the runtime reads and writes through. */
export interface IFileHost {
	exists(resource: URI): Promise<boolean>;
	stat(resource: URI): Promise<IFileStat>;
	readFile(resource: URI): Promise<IFileContent>;
	writeFile(resource: URI, content: VSBuffer): Promise<unknown>;
	del(resource: URI, options?: { useTrash?: boolean; recursive?: boolean }): Promise<void>;
	createFolder(resource: URI): Promise<unknown>;
	resolve?(resource: URI, options?: { resolveMetadata?: boolean }): Promise<IFileStat>;
}
