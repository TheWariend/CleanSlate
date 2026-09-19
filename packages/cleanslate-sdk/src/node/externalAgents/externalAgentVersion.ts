/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createRequire } from 'node:module';

const packageMetadata = createRequire(import.meta.url)('../../../package.json') as { version?: unknown };
if (typeof packageMetadata.version !== 'string' || !packageMetadata.version.trim()) {
	throw new Error('The installed CleanSlate SDK package has no version.');
}

export const CLEANSLATE_SDK_VERSION = packageMetadata.version;
