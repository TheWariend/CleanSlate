/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import type { IFileHost } from '@cleanslate/sdk';
import { reviveHostUri } from './cleanSlateHostUri.js';

/**
 * The workbench's filesystem, as the runtime sees it.
 *
 * Every member but one is a straight pass-through. The exception is `writeFile`:
 * the runtime hands over text, and the buffer is built here, with the editor's
 * own `VSBuffer`. That matters because `IFileService.writeFile` tells a buffer
 * apart from a readable with `instanceof` — a buffer built inside the SDK is a
 * different class no matter how identical its shape, so it would be taken for a
 * readable and fail on a missing `read()`. Nothing in the type system catches
 * that, which is why the conversion lives on this side of the boundary.
 */
export class CleanSlateFileHost implements IFileHost {

	constructor(private readonly fileService: IFileService) { }

	exists(resource: URI) {
		return this.fileService.exists(reviveHostUri(resource));
	}

	stat(resource: URI) {
		return this.fileService.stat(reviveHostUri(resource));
	}

	readFile(resource: URI) {
		return this.fileService.readFile(reviveHostUri(resource));
	}

	writeFile(resource: URI, content: string) {
		return this.fileService.writeFile(reviveHostUri(resource), VSBuffer.fromString(content));
	}

	del(resource: URI, options?: { useTrash?: boolean; recursive?: boolean }) {
		return this.fileService.del(reviveHostUri(resource), options);
	}

	createFolder(resource: URI) {
		return this.fileService.createFolder(reviveHostUri(resource));
	}

	resolve(resource: URI, options?: { resolveMetadata?: boolean }) {
		return options?.resolveMetadata
			? this.fileService.resolve(reviveHostUri(resource), { resolveMetadata: true })
			: this.fileService.resolve(reviveHostUri(resource));
	}
}
