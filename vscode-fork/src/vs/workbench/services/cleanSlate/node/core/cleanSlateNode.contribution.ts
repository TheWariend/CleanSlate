/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { IMCPClientService, ICleanSlateVectorStore, ICleanSlateMainService, ICleanSlateIndexService } from '../../common/core/cleanSlateAI.js';
import { CleanSlateMCPClientService } from '../mcp/cleanSlateMCPClient.js';
import { NodeCleanSlateVectorStore } from '../indexing/cleanSlateVectorStore.js';
import { NodeCleanSlateIndexService } from '../indexing/cleanSlateNodeIndexService.js';
import { NodeCleanSlateMainService } from './cleanSlateMainService.js';

// Register Node-only CleanSlate services
registerSingleton(IMCPClientService, CleanSlateMCPClientService, InstantiationType.Delayed);
registerSingleton(ICleanSlateVectorStore, NodeCleanSlateVectorStore, InstantiationType.Delayed);
registerSingleton(ICleanSlateIndexService, NodeCleanSlateIndexService, InstantiationType.Delayed);
registerSingleton(ICleanSlateMainService, NodeCleanSlateMainService, InstantiationType.Delayed);
