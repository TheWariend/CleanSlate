/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Readable, Writable } from 'stream';
import {
	client,
	ClientConnection,
	ClientContext,
	methods,
	ndJsonStream,
	PROTOCOL_VERSION,
	type RequestPermissionRequest,
	type RequestPermissionResponse,
	type SessionNotification,
	type ContentBlock
} from '@agentclientprotocol/sdk';
import { AcpProcess } from './acpProcess.js';
import { readApprovalPresentation } from './acpModePresentation.js';
import { CLEANSLATE_SDK_VERSION } from '../../externalAgentVersion.js';

export interface IAcpConnectionHandlers {
	readonly onSessionUpdate: (notification: SessionNotification) => void;
	readonly requestPermission: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>;
	readonly onError: (error: Error) => void;
}

export function createAcpPromptContent(prompt: string, images?: readonly string[]): ContentBlock[] {
	const content: ContentBlock[] = prompt ? [{ type: 'text', text: prompt }] : [];
	for (const image of images ?? []) {
		const match = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\s]+)$/);
		if (!match) {
			throw new Error('The attached image could not be read.');
		}
		content.push({ type: 'image', mimeType: match[1], data: match[2].replace(/\s/g, '') });
	}
	return content;
}

export class AcpConnection {
	controls: NonNullable<import('../../../../externalAgents/externalAgentTypes.js').IExternalAgentSessionInfo['controls']> = [];
	modelOptions: import('../../../../externalAgents/externalAgentTypes.js').IExternalAgentSessionInfo['models'];
	private supportsImages = false;

	private readModels(options: readonly import('@agentclientprotocol/sdk').SessionConfigOption[] | null | undefined): void {
		if (!options) { return; }
		const legacyMode = this.controls.find(control => control.configId === '$acp.session.mode');
		this.controls = options.filter(option => option.type === 'select').map(option => ({
			configId: option.id, name: option.name, category: option.category ?? undefined, current: option.currentValue,
			options: option.options.flatMap(entry => 'options' in entry ? entry.options : [entry]).map(entry => ({ value: entry.value, name: entry.name, description: entry.description ?? undefined, kind: option.category === 'mode' ? readApprovalPresentation(entry._meta) : undefined }))
		}));
		if (legacyMode && !this.controls.some(control => control.category === 'mode')) { this.controls = [...this.controls, legacyMode]; }
		const model = options?.find(option => option.category === 'model' && option.type === 'select');
		if (!model || model.type !== 'select') { this.modelOptions = undefined; return; }
		const entries = model.options.flatMap(option => 'options' in option ? option.options : [option]);
		this.modelOptions = { configId: model.id, current: model.currentValue, options: entries.map(option => ({ value: option.value, name: option.name })) };
	}

	async selectModel(sessionId: string, configId: string, value: string): Promise<void> {
		if (!this.controls.some(control => control.configId === configId && control.options.some(option => option.value === value))) { throw new Error('This setting is not available for this agent.'); }
		if (configId === '$acp.session.mode') {
			await this.context.request(methods.agent.session.setMode, { sessionId, modeId: value });
			this.controls = this.controls.map(control => control.configId === configId ? { ...control, current: value } : control);
			return;
		}
		const response = await this.context.request(methods.agent.session.setConfigOption, { sessionId, configId, value });
		this.readModels(response.configOptions);
	}
	private readonly connection: ClientConnection;
	private readonly context: ClientContext;

	private constructor(private readonly process: AcpProcess, connection: ClientConnection) {
		this.connection = connection;
		this.context = connection.agent;
	}

	static async create(process: AcpProcess, handlers: IAcpConnectionHandlers): Promise<AcpConnection> {
		let result: AcpConnection | undefined;
		const app = client({ name: 'CleanSlate' })
			.onNotification(methods.client.session.update, ({ params }) => {
				if (params.update.sessionUpdate === 'config_option_update') { result?.readModels(params.update.configOptions); }
				if (params.update.sessionUpdate === 'current_mode_update' && result) { result.controls = result.controls.map(control => control.category === 'mode' ? { ...control, current: params.update.sessionUpdate === 'current_mode_update' ? params.update.currentModeId : control.current } : control); }
				handlers.onSessionUpdate(params);
			})
			.onRequest(methods.client.session.requestPermission, ({ params }) => handlers.requestPermission(params));
		const stream = ndJsonStream(
			Writable.toWeb(process.child.stdin) as WritableStream<Uint8Array>,
			Readable.toWeb(process.child.stdout) as ReadableStream<Uint8Array>
		);
		const connection = app.connect(stream);
		process.child.once('error', error => handlers.onError(error));
		process.child.once('exit', (code, signal) => {
			if (!process.isStopping) {
				const reason = process.errorDetail ?? (signal ? `Agent process stopped with ${signal}.` : `Agent process exited with code ${code ?? 'unknown'}.`);
				handlers.onError(new Error(reason));
			}
		});
		result = new AcpConnection(process, connection);
		const initialization = await result.context.request(methods.agent.initialize, {
			protocolVersion: PROTOCOL_VERSION,
			clientCapabilities: {},
			clientInfo: { name: 'CleanSlate', version: CLEANSLATE_SDK_VERSION }
		});
		result.supportsImages = initialization.agentCapabilities?.promptCapabilities?.image === true;
		return result;
	}

	async newSession(cwd: string, mcpServers: import('@agentclientprotocol/sdk').McpServer[] = []): Promise<{ sessionId: string }> {
		const response = await this.context.request(methods.agent.session.new, { cwd, mcpServers });
		this.readModels(response.configOptions);
		this.readModes(response.modes);
		return response;
	}

	async loadSession(sessionId: string, cwd: string, mcpServers: import('@agentclientprotocol/sdk').McpServer[] = []): Promise<void> {
		const response = await this.context.request(methods.agent.session.load, { sessionId, cwd, mcpServers });
		this.readModels(response.configOptions);
		this.readModes(response.modes);
	}

	private readModes(modes: import('@agentclientprotocol/sdk').SessionModeState | null | undefined): void {
		if (!modes || this.controls.some(control => control.category === 'mode')) { return; }
		this.controls = [...this.controls, { configId: '$acp.session.mode', name: 'Mode', category: 'mode', current: modes.currentModeId, options: modes.availableModes.map(mode => ({ value: mode.id, name: mode.name, description: mode.description ?? undefined, kind: readApprovalPresentation(mode._meta) })) }];
	}

	prompt(sessionId: string, prompt: string, images?: readonly string[]): Promise<{ stopReason: string }> {
		if (images?.length && !this.supportsImages) {
			throw new Error('This agent does not support image attachments.');
		}
		return this.context.request(methods.agent.session.prompt, {
			sessionId,
			prompt: createAcpPromptContent(prompt, images)
		});
	}

	async cancel(sessionId: string): Promise<void> {
		await this.context.notify(methods.agent.session.cancel, { sessionId });
	}

	async dispose(): Promise<void> {
		this.connection.close();
		await this.process.stop();
	}
}
