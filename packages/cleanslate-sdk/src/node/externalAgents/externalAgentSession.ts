/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk';
import { IExternalAgentConfig, IExternalAgentEvent } from '../../externalAgents/externalAgentTypes.js';
import { IExternalAgentLaunchConfiguration } from './externalAgentRegistry.js';
import { AcpClient } from './transports/acp/acpClient.js';

export interface IExternalAgentSessionHandlers {
	readonly createHostTools?: () => Promise<IExternalAgentHostTools>;
	readonly onEvent: (event: IExternalAgentEvent) => void;
	readonly requestPermission: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>;
}

export interface IExternalAgentHostTools {
	readonly servers: import('@agentclientprotocol/sdk').McpServer[];
	dispose(): Promise<void>;
}

export class ExternalAgentSession {
	private constructor(
		readonly cleanSlateSessionId: string,
		readonly config: IExternalAgentConfig,
		readonly cwd: string,
		private readonly client: AcpClient,
		private readonly hostTools?: IExternalAgentHostTools
	) { }

	static async create(cleanSlateSessionId: string, config: IExternalAgentConfig, cwd: string, launch: IExternalAgentLaunchConfiguration & { executable: string }, handlers: IExternalAgentSessionHandlers, existingSessionId?: string): Promise<ExternalAgentSession> {
		const hostTools = await handlers.createHostTools?.();
		let client: AcpClient | undefined;
		try {
			client = await AcpClient.create(cleanSlateSessionId, cwd, launch, handlers);
			await client.start(cwd, existingSessionId, hostTools?.servers);
		} catch (error) {
			await client?.dispose();
			await hostTools?.dispose();
			throw error;
		}
		const session = new ExternalAgentSession(cleanSlateSessionId, config, cwd, client, hostTools);
		handlers.onEvent({ type: 'status', cleanSlateSessionId, status: 'ready' });
		return session;
	}

	get externalSessionId(): string {
		if (!this.client.externalSessionId) {
			throw new Error('External agent session has not started.');
		}
		return this.client.externalSessionId;
	}

	prompt(text: string, images?: readonly string[]): Promise<void> {
		return this.client.prompt(text, images);
	}
	get models() { return this.client.models; }
	get controls() { return this.client.controls; }
	selectModel(configId: string, value: string): Promise<void> { return this.client.selectModel(configId, value); }

	cancel(): Promise<void> {
		return this.client.cancel();
	}

	async dispose(): Promise<void> {
		try { await this.client.dispose(); }
		finally { await this.hostTools?.dispose(); }
	}
}
