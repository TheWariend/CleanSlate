/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { CleanSlateAgentExecutionSupport } from '../agent/cleanSlateAgentExecutionSupport.js';
import { CleanSlateAgentParsingSupport } from '../agent/cleanSlateAgentParsing.js';
import { CleanSlateAgentSession } from '../agent/cleanSlateAgentSession.js';
import { CleanSlateStreamPart } from '../agent/cleanSlateAgentTypes.js';
import { CleanSlateExecutionBudget } from '../agent/cleanSlateExecutionBudget.js';
import { AgentPhase, parseSlashCommand } from '../agent/cleanSlatePrompts.js';
import { CleanSlateQueryRunner } from '../agent/cleanSlateQueryRunner.js';
import { Event } from '../core/event.js';
import {
	AIProvider,
	ICleanSlateConfiguration,
	ICleanSlateConfigurationService,
	ICleanSlateAgentRuntimeSnapshot,
	ICleanSlateLogger,
	ICleanSlateManagedAccount,
	ICleanSlateManagedEntitlements,
	ICleanSlatePendingAgentInteraction,
	IChatMessagePart
} from '../protocol/cleanSlateAI.js';
import { CleanSlateService } from '../protocol/cleanSlateService.js';
import { CleanSlateTaskSessionService, ICleanSlateTaskSessionSnapshot } from '../services/cleanSlateTaskSessionService.js';
import { ICleanSlateThreadMessage } from '../services/cleanSlateThreadService.js';
import { CleanSlateTaskKind, CleanSlateWorkspaceShape } from '../services/cleanSlateTaskState.js';
import { CleanSlateThreadService } from '../services/cleanSlateThreadService.js';
import { ALL_TOOLS } from '../tools/registry.js';
import { CleanSlateHeadlessRuntime } from './cleanSlateHeadlessRunner.js';
import { NodeCleanSlateMainService } from './cleanSlateNodeMainService.js';

export interface ICleanSlateNodeAgentRuntimeOptions {
	rootPath: string;
	configuration: ICleanSlateConfiguration;
	approveCommand?: (request: { command: string; cwd?: string; reason?: string }) => Promise<boolean>;
	onProgress?: (event: { type: string; [key: string]: any }) => void;
	onManagedTokenRefresh?: (token: string) => void | Promise<void>;
	fetcher?: typeof fetch;
	logger?: Partial<ICleanSlateLogger>;
	sessionId?: string;
	/** Deterministic host context such as project instructions and @mentioned files. */
	additionalContext?: string | ((task: string) => string | Promise<string>);
	/** Host-owned permission policy evaluated before every native tool. */
	approveTool?: (request: { toolName: string; category?: string; input: unknown }) => boolean | Promise<boolean>;
	/** Multimodal parts explicitly attached by the host for a user turn. */
	resolveAttachments?: (task: string) => IChatMessagePart[] | Promise<IChatMessagePart[]>;
}

export interface ICleanSlateNodeAgentSessionSnapshot {
	version: 1;
	sessionId: string;
	agent?: ICleanSlateAgentRuntimeSnapshot;
	task?: ICleanSlateTaskSessionSnapshot;
	threadHistory: ICleanSlateThreadMessage[];
}

class NodeConfigurationService implements ICleanSlateConfigurationService {
	declare readonly _serviceBrand: undefined;
	readonly onDidChangeConfiguration = Event.None;
	private managedAccount: ICleanSlateManagedAccount | undefined;

	constructor(
		private configuration: ICleanSlateConfiguration,
		private readonly mainService: NodeCleanSlateMainService,
		private readonly onManagedTokenRefresh?: (token: string) => void | Promise<void>,
		private readonly fetcher: typeof fetch = fetch
	) { }

	getConfiguration(): ICleanSlateConfiguration {
		return this.configuration;
	}
	getResolvedConfiguration(): Promise<ICleanSlateConfiguration> {
		return Promise.resolve(this.configuration);
	}
	updateConfiguration(config: Partial<ICleanSlateConfiguration>): Promise<void> {
		this.configuration = { ...this.configuration, ...config };
		return Promise.resolve();
	}
	async refreshManagedToken(rejectedToken?: string): Promise<string> {
		const current = this.configuration.providers?.cleanslate?.apiKey;
		if (!current) {
			throw new Error('Sign in to CleanSlate again.');
		}
		if (rejectedToken && current !== rejectedToken) {
			return current;
		}
		const runtimeConfig = await this.mainService.getRuntimeConfig();
		const response = await this.fetcher(`${runtimeConfig.apiBaseUrl}/auth/refresh`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${current}`, Accept: 'application/json' }
		});
		const body = await this.readJson(response);
		if (response.status === 401) {
			throw new Error('Your CleanSlate session expired. Run cleanslate --setup to sign in again.');
		}
		if (!response.ok || typeof body?.token !== 'string' || !body.token) {
			throw new Error(body?.message || `Unable to refresh the CleanSlate session (${response.status}).`);
		}
		const token = body.token;
		this.configuration = {
			...this.configuration,
			providers: {
				...this.configuration.providers,
				cleanslate: { ...this.configuration.providers?.cleanslate, apiKey: token }
			}
		};
		await this.onManagedTokenRefresh?.(token);
		return token;
	}
	async getManagedEntitlements(): Promise<ICleanSlateManagedEntitlements> {
		let token = this.configuration.providers?.cleanslate?.apiKey;
		if (!token) {
			throw new Error('Sign in to CleanSlate to view your managed models.');
		}
		const runtimeConfig = await this.mainService.getRuntimeConfig();
		const request = () => this.fetcher(`${runtimeConfig.managedAIBaseUrl}/entitlements`, {
			headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
		});
		let response = await request();
		if (response.status === 401) {
			token = await this.refreshManagedToken(token);
			response = await request();
		}
		const body = await this.readJson(response);
		if (!response.ok || !body?.data) {
			throw new Error(body?.message || `Unable to load CleanSlate entitlements (${response.status}).`);
		}
		const entitlements = body.data as ICleanSlateManagedEntitlements;
		if (entitlements.account) {
			this.managedAccount = {
				email: entitlements.account.email,
				name: entitlements.account.name,
				profileImageUrl: entitlements.account.avatar_url
			};
		}
		return entitlements;
	}
	getManagedAccount(): ICleanSlateManagedAccount | undefined {
		return this.managedAccount;
	}

	private async readJson(response: Response): Promise<any> {
		try {
			return await response.json();
		} catch {
			return {};
		}
	}
}

function createLogger(overrides: Partial<ICleanSlateLogger> = {}): ICleanSlateLogger {
	const noop = () => undefined;
	return {
		_serviceBrand: undefined,
		info: overrides.info ?? noop,
		warn: overrides.warn ?? noop,
		error: overrides.error ?? noop,
		debug: overrides.debug ?? noop,
		trace: overrides.trace ?? noop
	};
}

/**
 * Wires CleanSlate's existing execution loop to the Node host and all 59 tools.
 */
export class CleanSlateNodeAgentRuntime {
	private readonly rootPath: string;
	private readonly mainService: NodeCleanSlateMainService;
	private readonly configService: NodeConfigurationService;
	private readonly headlessRuntime: CleanSlateHeadlessRuntime;
	private readonly queryRunner: CleanSlateQueryRunner;
	private readonly cleanSlateService: CleanSlateService;
	private readonly agentSession = new CleanSlateAgentSession();
	private readonly threadService = new CleanSlateThreadService();
	private readonly taskSessionService = new CleanSlateTaskSessionService();
	private readonly sessionId: string;
	private readonly contextService = {
		_serviceBrand: undefined,
		getContext: async () => ({ activeFile: undefined, openFiles: [] })
	};

	constructor(private readonly options: ICleanSlateNodeAgentRuntimeOptions) {
		this.rootPath = path.resolve(options.rootPath);
		this.sessionId = options.sessionId?.trim() || `cli-${process.pid}-${Date.now()}`;
		this.mainService = new NodeCleanSlateMainService(this.rootPath);
		this.configService = new NodeConfigurationService(options.configuration, this.mainService, options.onManagedTokenRefresh, options.fetcher);
		const cleanSlateService = new CleanSlateService(this.configService, this.mainService, createLogger(options.logger));
		this.cleanSlateService = cleanSlateService;
		this.headlessRuntime = new CleanSlateHeadlessRuntime({
			rootPath: this.rootPath,
			configuration: options.configuration,
			tools: ALL_TOOLS,
			cleanSlateService,
			contextService: this.contextService,
			approveCommand: options.approveCommand,
			approveTool: options.approveTool,
			onProgress: options.onProgress
		});
		const toolContext = this.headlessRuntime.getToolContext();
		toolContext.cleanSlateMainService = this.mainService;
		toolContext.contextService = this.contextService;
		const parsingSupport = new CleanSlateAgentParsingSupport(this.configService);
		const executionSupport = new CleanSlateAgentExecutionSupport(
			toolContext.workspaceContextService,
			toolContext.markerService,
			this.contextService
		);
		this.queryRunner = new CleanSlateQueryRunner({
			cleanSlateService,
			cleanSlateContextService: this.contextService,
			parsingSupport,
			executionSupport,
			toolContext,
			recentFocusLines: toolContext.recentFocusLines,
			referenceBuffer: new Map(),
			getTools: () => this.headlessRuntime.getTools(),
			getSessionId: () => this.sessionId,
			getToolCategory: toolName => this.headlessRuntime.getToolCategory(toolName),
			buildPromptContext: async () => this.buildPromptContext(),
			buildPromptContextForMode: async () => this.buildPromptContext(),
			checkCrossFileReferences: async () => [],
			executeTool: (toolName, input, toolCallId, signal) => this.headlessRuntime.executeTool(toolName, input, toolCallId, signal),
			onQuestionPaused: (toolCall, result) => this.agentSession.pauseForQuestion(toolCall, result),
			getToolDescriptions: () => this.getToolDescriptions()
		});
	}

	async *run(task: string, signal?: AbortSignal): AsyncIterable<CleanSlateStreamPart> {
		yield* this.runInPhase(task, AgentPhase.EXECUTION, signal);
	}

	async *plan(task: string, signal?: AbortSignal): AsyncIterable<CleanSlateStreamPart> {
		yield* this.runInPhase(task, AgentPhase.PLANNING, signal);
	}

	private async *runInPhase(task: string, phase: AgentPhase, signal?: AbortSignal): AsyncIterable<CleanSlateStreamPart> {
		const objective = task.trim();
		if (!objective) {
			throw new Error('Task must not be empty.');
		}
		const mode = phase === AgentPhase.PLANNING ? 'Planning' : 'Execution';
		const parsed = parseSlashCommand(objective, mode);
		const promptText = `[CONTEXT]\n${await this.buildPromptContext(objective)}\n\nUser Request: ${parsed.userMessage}`;
		const attachments = await this.options.resolveAttachments?.(objective) ?? [];
		const userContent = attachments.length > 0
			? [{ type: 'text' as const, text: promptText }, ...attachments]
			: promptText;
		const seedMessages = [
			{ role: 'system' as const, content: parsed.systemInstruction },
			{ role: 'user' as const, content: userContent }
		];
		const messages = this.agentSession.hasMessages()
			? this.agentSession.continueWithTurn(seedMessages, { objective, mode, phase })
			: this.agentSession.start(seedMessages, { objective, mode, phase });
		this.threadService.addMessage('user', objective);
		this.taskSessionService.startNewTask(
			CleanSlateTaskKind.MODIFY_EXISTING,
			this.workspaceIsEmpty() ? CleanSlateWorkspaceShape.EMPTY : CleanSlateWorkspaceShape.EXISTING,
			objective
		);
		this.taskSessionService.setPhase(phase);
		yield* this.runMessages(messages, objective, phase, signal);
	}

	async *resumePendingQuestion(answer: string, signal?: AbortSignal): AsyncIterable<CleanSlateStreamPart> {
		const pending = this.agentSession.resumePendingQuestion(answer);
		if (!pending) {
			throw new Error('There is no pending agent question to resume.');
		}
		const objective = pending.objective?.trim() || 'Continue the current task.';
		this.threadService.addMessage('user', answer);
		this.taskSessionService.resumeCurrentTask();
		const phase = pending.phase === AgentPhase.PLANNING ? AgentPhase.PLANNING : AgentPhase.EXECUTION;
		this.taskSessionService.setPhase(phase);
		yield* this.runMessages(this.agentSession.getMutableMessages(), objective, phase, signal);
	}

	getPendingQuestion(): ICleanSlatePendingAgentInteraction | undefined {
		return this.agentSession.getSnapshot()?.pendingInteraction;
	}

	getSessionSnapshot(): ICleanSlateNodeAgentSessionSnapshot {
		return {
			version: 1,
			sessionId: this.sessionId,
			agent: this.agentSession.getSnapshot(),
			task: this.taskSessionService.getStateSnapshot(),
			threadHistory: this.threadService.getHistory()
		};
	}

	restoreSessionSnapshot(snapshot: ICleanSlateNodeAgentSessionSnapshot | undefined): void {
		if (!snapshot || snapshot.version !== 1) {
			return;
		}
		this.agentSession.restore(snapshot.agent);
		this.taskSessionService.restoreStateSnapshot(snapshot.task);
		this.threadService.setHistory(Array.isArray(snapshot.threadHistory) ? snapshot.threadHistory : []);
	}

	clearConversation(): void {
		this.agentSession.clear();
		this.taskSessionService.reset();
		this.threadService.clearHistory();
	}

	getModels(): Promise<string[]> {
		return this.cleanSlateService.getModels();
	}

	private async *runMessages(
		messages: ReturnType<CleanSlateAgentSession['getMutableMessages']>,
		objective: string,
		phase: AgentPhase,
		signal?: AbortSignal
	): AsyncIterable<CleanSlateStreamPart> {
		const parsingSupport = new CleanSlateAgentParsingSupport(this.configService);
		const budget = new CleanSlateExecutionBudget(parsingSupport.getExecutionLoopSettings().maxTurns);
		let assistantText = '';
		for await (const part of this.queryRunner.run(
			messages,
			objective,
			phase === AgentPhase.PLANNING ? 'Planning' : 'Execution',
			await this.contextService.getContext(),
			'',
			this.threadService,
			this.taskSessionService,
			signal,
			{
				executionFlow: phase === AgentPhase.PLANNING ? 'planning' : 'normal',
				executionBudget: budget
			}
		)) {
			if (part.type === 'chat_text') {
				assistantText += part.content;
			}
			yield part;
		}
		if (assistantText.trim()) {
			this.threadService.addMessage('assistant', assistantText);
		}
	}

	getAvailableToolCount(): number {
		return this.headlessRuntime.getTools().length;
	}

	getResult() {
		return this.headlessRuntime.getResult();
	}

	dispose(): void {
		const context = this.headlessRuntime.getToolContext();
		(context.commandExecutionService as { dispose?: () => void }).dispose?.();
		void (context.browserAutomationService as { dispose?: () => Promise<void> }).dispose?.();
		void (context.mcpClientService as { dispose?: () => Promise<void> }).dispose?.();
	}

	private async buildPromptContext(task = ''): Promise<string> {
		const additional = typeof this.options.additionalContext === 'function'
			? await this.options.additionalContext(task)
			: this.options.additionalContext;
		return [
			`Workspace root: ${this.rootPath}`,
			'This is a headless Node workspace. Use the available file, search, edit, and command tools to inspect and work in this repository.',
			additional?.trim()
		].filter(Boolean).join('\n\n');
	}

	private workspaceIsEmpty(): boolean {
		try {
			return fs.readdirSync(this.rootPath).filter(name => name !== '.git').length === 0;
		} catch {
			return false;
		}
	}

	private getToolDescriptions(): string {
		return `\n\nAvailable native tools:\n${ALL_TOOLS.map(tool => {
			const schema = tool.parametersSchema ? `\n  Parameters: ${JSON.stringify(tool.parametersSchema)}` : '';
			return `- ${tool.name}: ${tool.description}${schema}`;
		}).join('\n')}\n`;
	}
}

export function createNodeProviderConfiguration(options: {
	provider: AIProvider;
	model: string;
	apiKey?: string;
	baseUrl?: string;
	reasoningLevel?: ICleanSlateConfiguration['reasoningLevel'];
	maxTurns?: number;
	bedrockRegion?: string;
	bedrockCredentialMode?: 'default' | 'profile' | 'accessKey';
	bedrockProfile?: string;
	bedrockAccessKeyId?: string;
	bedrockSecretAccessKey?: string;
	bedrockSessionToken?: string;
	azureEndpoint?: string;
	azureApiVersion?: string;
	azureDeploymentName?: string;
}): ICleanSlateConfiguration {
	const provider = options.provider;
	const common = { model: options.model, apiKey: options.apiKey, baseUrl: options.baseUrl };
	return {
		provider,
		model: options.model,
		reasoningLevel: options.reasoningLevel ?? 'low',
		planMode: false,
		maxTurns: options.maxTurns,
		providers: {
			...(provider === 'cleanslate' ? { cleanslate: common } : {}),
			...(provider === 'openai' ? { openai: common } : {}),
			...(provider === 'azureOpenAI' ? {
				azureOpenAI: {
					apiKey: options.apiKey,
					endpoint: options.azureEndpoint,
					apiVersion: options.azureApiVersion,
					deploymentName: options.azureDeploymentName ?? options.model
				}
			} : {}),
			...(provider === 'anthropic' ? { anthropic: common } : {}),
			...(provider === 'gemini' ? { gemini: { model: options.model, apiKey: options.apiKey } } : {}),
			...(provider === 'grok' ? { grok: common } : {}),
			...(provider === 'nvidia' ? { nvidia: common } : {}),
			...(provider === 'openrouter' ? { openrouter: common } : {}),
			...(provider === 'custom' ? { custom: common } : {}),
			...(provider === 'bedrock' ? {
				bedrock: {
					modelId: options.model,
					region: options.bedrockRegion,
					credentialMode: options.bedrockCredentialMode ?? 'default',
					profile: options.bedrockProfile,
					accessKeyId: options.bedrockAccessKeyId,
					secretAccessKey: options.bedrockSecretAccessKey,
					sessionToken: options.bedrockSessionToken
				}
			} : {})
		}
	};
}
