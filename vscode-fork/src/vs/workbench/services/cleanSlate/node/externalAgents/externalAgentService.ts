/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExternalAgentService as SdkExternalAgentService } from '@cleanslate/sdk/node/externalAgents/externalAgentService.js';
import { ExternalAgentRegistry } from './externalAgentRegistry.js';

export class ExternalAgentService extends SdkExternalAgentService {
	constructor() { super(new ExternalAgentRegistry()); }
}
