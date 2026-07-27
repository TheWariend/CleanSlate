/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { ICleanSlateLogger, ICleanSlateService, ICleanSlateEmbeddingService, ICleanSlateVectorStore, ICleanSlateEditCodeService } from '../core/cleanSlateAI.js';
import { CleanSlateLogger } from '../core/cleanSlateLogger.js';
import { CleanSlateService } from '../core/cleanSlateService.js';
import { CleanSlateEmbeddingService } from './cleanSlateEmbeddingService.js';
import { CleanSlateVectorStore } from '../indexing/cleanSlateVectorStore.js';
import { CleanSlateEditCodeService } from '../core/cleanSlateEditCodeService.js';

// Register shared CleanSlate services used by both renderer and node contexts
registerSingleton(ICleanSlateLogger, CleanSlateLogger, InstantiationType.Delayed);
registerSingleton(ICleanSlateEmbeddingService, CleanSlateEmbeddingService, InstantiationType.Delayed);
registerSingleton(ICleanSlateVectorStore, CleanSlateVectorStore, InstantiationType.Delayed);
registerSingleton(ICleanSlateService, CleanSlateService, InstantiationType.Delayed);
registerSingleton(ICleanSlateEditCodeService, CleanSlateEditCodeService, InstantiationType.Delayed);
