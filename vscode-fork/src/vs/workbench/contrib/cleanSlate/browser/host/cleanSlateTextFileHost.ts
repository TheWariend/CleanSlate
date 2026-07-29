/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import type { ITextFileHost } from '@cleanslate/sdk';
import { reviveHostUri } from './cleanSlateHostUri.js';

/**
 * The workbench's text file service, as the runtime sees it.
 *
 * Every URI is rebuilt on the way in. This service is the one that *keeps*
 * them: `files.resolve` registers a text file model under the resource it was
 * given, and when that model goes dirty `TextFileEditorTracker` hands the
 * resource back to `ITextEditorService`, which tests it with `instanceof URI`
 * and throws if it is the runtime's copy of the class. See `cleanSlateHostUri.ts`.
 */
export class CleanSlateTextFileHost implements ITextFileHost {

	readonly files: ITextFileHost['files'];

	constructor(private readonly textFileService: ITextFileService) {
		const files = this.textFileService.files;
		this.files = {
			get: (resource: URI) => files.get(reviveHostUri(resource)),
			resolve: (resource: URI, options?: unknown) => files.resolve(reviveHostUri(resource), options as any),
			onDidResolve: files.onDidResolve
		};
	}

	save(resource: URI, options?: unknown) {
		return this.textFileService.save(reviveHostUri(resource), options as any);
	}

	create(operations: readonly { resource: URI; value?: string; options?: { overwrite?: boolean } }[]) {
		return this.textFileService.create(operations.map(operation => ({
			...operation,
			resource: reviveHostUri(operation.resource)
		})));
	}

	read(resource: URI, options?: { acceptTextOnly?: boolean; encoding?: string }) {
		return this.textFileService.read(reviveHostUri(resource), options);
	}
}
