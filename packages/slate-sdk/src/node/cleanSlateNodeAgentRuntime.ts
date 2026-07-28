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
	ICleanSlatePendingAgentInteraction
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
	logger?: Partial<ICleanSlateLogger>;
	sessionId?: string;
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

	constructor(private configuration: ICleanSlateConfiguration) { }

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
	refreshManagedToken(): Promise<string> {
		return Promise.reject(new Error('Managed CleanSlate authentication is not supported on the Node CLI surface.'));
	}
	getManagedEntitlements(): Promise<ICleanSlateManagedEntitlements> {
		return Promise.resolve({});
	}
	getManagedAccount(): ICleanSlateManagedAccount | undefined {
		return undefined;
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
	private readonly headlessRuntime: CleanSlateHeadlessRuntime;
	private readonly queryRunner: CleanSlateQueryRunner;
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
		const configService = new NodeConfigurationService(options.configuration);
		this.mainService = new NodeCleanSlateMainService(this.rootPath);
		const cleanSlateService = new CleanSlateService(configService, this.mainService, createLogger(options.logger));
		this.headlessRuntime = new CleanSlateHeadlessRuntime({
			rootPath: this.rootPath,
			configuration: options.configuration,
			tools: ALL_TOOLS,
			cleanSlateService,
			contextService: this.contextService,
			approveCommand: options.approveCommand,
			onProgress: options.onProgress
		});
		const toolContext = this.headlessRuntime.getToolContext();
		toolContext.cleanSlateMainService = this.mainService;
		toolContext.contextService = this.contextService;
		const parsingSupport = new CleanSlateAgentParsingSupport(configService);
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
		const objective = task.trim();
		if (!objective) {
			throw new Error('Task must not be empty.');
		}
		const parsed = parseSlashCommand(objective, 'Execution');
		const seedMessages = [
			{ role: 'system' as const, content: parsed.systemInstruction },
			{ role: 'user' as const, content: `[CONTEXT]\n${this.buildPromptContext()}\n\nUser Request: ${parsed.userMessage}` }
		];
		const messages = this.agentSession.hasMessages()
			? this.agentSession.continueWithTurn(seedMessages, { objective, mode: 'Execution', phase: AgentPhase.EXECUTION })
			: this.agentSession.start(seedMessages, { objective, mode: 'Execution', phase: AgentPhase.EXECUTION });
		this.threadService.addMessage('user', objective);
		this.taskSessionService.startNewTask(
			CleanSlateTaskKind.MODIFY_EXISTING,
			this.workspaceIsEmpty() ? CleanSlateWorkspaceShape.EMPTY : CleanSlateWorkspaceShape.EXISTING,
			objective
		);
		this.taskSessionService.setPhase(AgentPhase.EXECUTION);
		yield* this.runMessages(messages, objective, signal);
	}

	async *resumePendingQuestion(answer: string, signal?: AbortSignal): AsyncIterable<CleanSlateStreamPart> {
		const pending = this.agentSession.resumePendingQuestion(answer);
		if (!pending) {
			throw new Error('There is no pending agent question to resume.');
		}
		const objective = pending.objective?.trim() || 'Continue the current task.';
		this.threadService.addMessage('user', answer);
		this.taskSessionService.resumeCurrentTask();
		this.taskSessionService.setPhase(AgentPhase.EXECUTION);
		yield* this.runMessages(this.agentSession.getMutableMessages(), objective, signal);
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

	private async *runMessages(
		messages: ReturnType<CleanSlateAgentSession['getMutableMessages']>,
		objective: string,
		signal?: AbortSignal
	): AsyncIterable<CleanSlateStreamPart> {
		const parsingSupport = new CleanSlateAgentParsingSupport(new NodeConfigurationService(this.options.configuration));
		const budget = new CleanSlateExecutionBudget(parsingSupport.getExecutionLoopSettings().maxTurns);
		let assistantText = '';
		for await (const part of this.queryRunner.run(
			messages,
			objective,
			'Execution',
			await this.contextService.getContext(),
			'',
			this.threadService,
			this.taskSessionService,
			signal,
			{ executionFlow: 'normal', executionBudget: budget }
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
		(this.headlessRuntime.getToolContext().commandExecutionService as { dispose?: () => void }).dispose?.();
	}

	private buildPromptContext(): string {
		return [
			`Workspace root: ${this.rootPath}`,
			'This is a headless Node workspace. Use the available file, search, edit, and command tools to inspect and work in this repository.'
		].join('\n');
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
			...(provider === 'openai' ? { openai: common } : {}),
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
