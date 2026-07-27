/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ICleanSlateLocalEmbeddingOptions, ICleanSlateLocalEmbeddingResponse } from '../../common/core/cleanSlateAI.js';

export type CleanSlateLocalEmbeddingRequest =
	| { id: number; type: 'embed'; options: ICleanSlateLocalEmbeddingOptions; appRoot: string }
	| { id: number; type: 'shutdown' };

export type CleanSlateLocalEmbeddingResponseMessage =
	| { id: number; type: 'embedResult'; result: ICleanSlateLocalEmbeddingResponse }
	| { id: number; type: 'shutdownAck' }
	| { id: number; type: 'error'; error: string };

