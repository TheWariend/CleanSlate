/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { ICleanSlateConfigurationService, ICleanSlateContextService, IMCPClientService, ICleanSlateArtifactService, ICleanSlateVectorStore, ICleanSlateMainService, ICleanSlateIndexService } from '../../common/core/cleanSlateAI.js';
import { CleanSlateConfigurationService } from '../core/cleanSlateConfigurationService.js';
import { CleanSlateContextService } from '../core/cleanSlateContextServiceImpl.js';
import { CleanSlateArtifactService } from '../core/cleanSlateArtifactService.js';
import { CleanSlateIndexServiceProxy } from '../indexing/cleanSlateIndexServiceProxy.js';
import { CleanSlateVectorStoreProxy } from '../indexing/cleanSlateVectorStoreProxy.js';
import { CleanSlateMCPClientProxy } from '../mcp/cleanSlateMCPClientProxy.js';
import { CleanSlateMainServiceProxy } from '../core/cleanSlateMainServiceProxy.js';
import { ICleanSlateCommandExecutionService, CleanSlateCommandExecutionService } from '../../../../contrib/cleanSlate/browser/core/cleanSlateCommandExecutionService.js';
import { CleanSlateBrowserAutomationService, ICleanSlateBrowserAutomationService } from '../../../../contrib/cleanSlate/browser/core/cleanSlateBrowserAutomationService.js';
import { CleanSlateCommandApprovalService, ICleanSlateCommandApprovalService } from '../../../../contrib/cleanSlate/browser/core/cleanSlateCommandApprovalService.js';


// Register browser-specific CleanSlate services
registerSingleton(ICleanSlateConfigurationService, CleanSlateConfigurationService, InstantiationType.Delayed);
registerSingleton(ICleanSlateContextService, CleanSlateContextService, InstantiationType.Delayed);
registerSingleton(ICleanSlateArtifactService, CleanSlateArtifactService, InstantiationType.Delayed);
registerSingleton(IMCPClientService, CleanSlateMCPClientProxy, InstantiationType.Delayed);
registerSingleton(ICleanSlateIndexService, CleanSlateIndexServiceProxy, InstantiationType.Delayed);
registerSingleton(ICleanSlateVectorStore, CleanSlateVectorStoreProxy, InstantiationType.Delayed);
registerSingleton(ICleanSlateMainService, CleanSlateMainServiceProxy, InstantiationType.Delayed);
registerSingleton(ICleanSlateCommandExecutionService, CleanSlateCommandExecutionService, InstantiationType.Delayed);
registerSingleton(ICleanSlateBrowserAutomationService, CleanSlateBrowserAutomationService, InstantiationType.Delayed);
registerSingleton(ICleanSlateCommandApprovalService, CleanSlateCommandApprovalService, InstantiationType.Delayed);
