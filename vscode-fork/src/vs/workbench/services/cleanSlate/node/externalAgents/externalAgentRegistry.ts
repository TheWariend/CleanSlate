/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createRequire } from 'node:module';
import { ExternalAgentRegistry as SdkRegistry } from '@cleanslate/sdk/node/externalAgents/externalAgentRegistry.js';
export type { IExternalAgentLaunchConfiguration } from '@cleanslate/sdk/node/externalAgents/externalAgentRegistry.js';

const require = createRequire(import.meta.url);
export class ExternalAgentRegistry extends SdkRegistry {
	constructor(configurationFile?: string) { super(configurationFile, id => require.resolve(id)); }
	override list(env?: NodeJS.ProcessEnv) {
		return super.list(env).map(agent => ({ ...agent, iconPath: agent.iconPath ? `vs/workbench/contrib/cleanSlate/browser/media/${agent.iconPath}` : undefined }));
	}
}
