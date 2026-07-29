/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import type {
	ICleanSlateArtifactService as ICleanSlateArtifactServiceShape,
	ICleanSlateConfigurationService as ICleanSlateConfigurationServiceShape,
	ICleanSlateContextService as ICleanSlateContextServiceShape,
	ICleanSlateEditCodeService as ICleanSlateEditCodeServiceShape,
	ICleanSlateEmbeddingService as ICleanSlateEmbeddingServiceShape,
	ICleanSlateIndexService as ICleanSlateIndexServiceShape,
	ICleanSlateLogger as ICleanSlateLoggerShape,
	ICleanSlateMainService as ICleanSlateMainServiceShape,
	ICleanSlateService as ICleanSlateServiceShape,
	ICleanSlateVectorStore as ICleanSlateVectorStoreShape,
	IMCPClientService as IMCPClientServiceShape
} from '@cleanslate/sdk/protocol/cleanSlateAI.js';

/**
 * The AI protocol, re-exported from the SDK.
 *
 * The shapes belong in `@cleanslate/sdk` because the terminal and the editor
 * both speak them. What cannot go there is the other half of each service: a
 * `createDecorator` identifier is the workbench's DI container talking, and the
 * SDK has no container. So each service is re-declared here as the interface
 * plus its decorator — the pair the rest of the workbench imports. The
 * interfaces add nothing to the SDK's; they exist so the name still resolves in
 * both the type and the value position, as it did when this file owned it.
 */

export * from '@cleanslate/sdk/protocol/cleanSlateAI.js';

export interface ICleanSlateConfigurationService extends ICleanSlateConfigurationServiceShape { }
export const ICleanSlateConfigurationService = createDecorator<ICleanSlateConfigurationService>('cleanSlateConfigurationService');

export interface ICleanSlateLogger extends ICleanSlateLoggerShape { }
export const ICleanSlateLogger = createDecorator<ICleanSlateLogger>('cleanSlateLogger');

export interface ICleanSlateService extends ICleanSlateServiceShape { }
export const ICleanSlateService = createDecorator<ICleanSlateService>('cleanSlateService');

export interface ICleanSlateEmbeddingService extends ICleanSlateEmbeddingServiceShape { }
export const ICleanSlateEmbeddingService = createDecorator<ICleanSlateEmbeddingService>('cleanSlateEmbeddingService');

export interface ICleanSlateIndexService extends ICleanSlateIndexServiceShape { }
export const ICleanSlateIndexService = createDecorator<ICleanSlateIndexService>('cleanSlateIndexService');

export interface ICleanSlateVectorStore extends ICleanSlateVectorStoreShape { }
export const ICleanSlateVectorStore = createDecorator<ICleanSlateVectorStore>('cleanSlateVectorStore');

export interface ICleanSlateContextService extends ICleanSlateContextServiceShape { }
export const ICleanSlateContextService = createDecorator<ICleanSlateContextService>('cleanSlateContextService');

export interface ICleanSlateEditCodeService extends ICleanSlateEditCodeServiceShape { }
export const ICleanSlateEditCodeService = createDecorator<ICleanSlateEditCodeService>('cleanSlateEditCodeService');

export interface IMCPClientService extends IMCPClientServiceShape { }
export const IMCPClientService = createDecorator<IMCPClientService>('mcpClientService');

export interface ICleanSlateArtifactService extends ICleanSlateArtifactServiceShape { }
export const ICleanSlateArtifactService = createDecorator<ICleanSlateArtifactService>('cleanSlateArtifactService');

export interface ICleanSlateMainService extends ICleanSlateMainServiceShape { }
export const ICleanSlateMainService = createDecorator<ICleanSlateMainService>('cleanSlateMainService');
