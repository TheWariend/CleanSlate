#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { fileURLToPath } from 'url';
import { createElement } from 'react';
import { render } from 'ink';
import {
	CancellationTokenSource,
	CleanSlateNodeAgentRuntime,
	createNodeProviderConfiguration
} from '@slate/sdk';
import { apiKeyFromEnvironment, HELP_TEXT, ICliArguments, parseArguments } from './argv.js';
import { CliConfigStore, CliCredentialStore, ICliConfig } from './config.js';
import { authenticateCleanSlateInBrowser } from './managedAuth.js';
import { CliSessionStore, ICliSession, transcriptEntry } from './sessions.js';
import { CleanSlateSetupTui, ICliSetupResult } from './setupTui.js';
import { clearInteractiveScreen, enterInteractiveScreen } from './terminalScreen.js';
import { CleanSlateTui } from './tui.js';

const VERSION = '0.1.0';
let activeApprovalPrompt: readline.Interface | undefined;

export async function requestCommandApproval(
	request: { command: string; cwd?: string; reason?: string },
	input: NodeJS.ReadableStream = process.stdin,
	output: NodeJS.WritableStream = process.stderr
): Promise<boolean> {
	if (!(input as NodeJS.ReadStream).isTTY) {
		return false;
	}
	output.write(`\nCommand approval requested${request.reason ? `: ${request.reason}` : ''}\n`);
	output.write(`cwd: ${request.cwd ?? process.cwd()}\n`);
	output.write(`${request.command}\n`);
	const prompt = readline.createInterface({ input, output });
	activeApprovalPrompt = prompt;
	try {
		const answer = await new Promise<string>(resolve => {
			let settled = false;
			const finish = (value: string) => {
				if (!settled) {
					settled = true;
					resolve(value);
				}
			};
			prompt.once('close', () => finish(''));
			prompt.question('Run this command? [y/N] ', finish);
		});
		return /^(?:y|yes)$/i.test(answer.trim());
	} finally {
		if (activeApprovalPrompt === prompt) {
			activeApprovalPrompt = undefined;
		}
		prompt.close();
	}
}

function validateWorkspace(args: ICliArguments): void {
	const root = path.resolve(args.cwd);
	if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
		throw new Error(`Workspace root is not a directory: ${root}`);
	}
	args.cwd = root;
}

function validateProvider(args: ICliArguments): void {
	if (!args.model) {
		throw new Error('A model is required. Pass --model once; CleanSlate remembers it for future sessions.');
	}
	if (args.provider !== 'custom' && args.provider !== 'bedrock' && !args.apiKey) {
		throw new Error(`An API key is required for ${args.provider}. Pass --api-key or set the provider API-key environment variable.`);
	}
	if (args.provider === 'custom' && !args.baseUrl) {
		throw new Error('Custom provider requires --base-url or CLEANSLATE_BASE_URL.');
	}
	if (args.provider === 'bedrock' && !args.bedrockRegion) {
		throw new Error('Bedrock requires --aws-region, AWS_REGION, or AWS_DEFAULT_REGION.');
	}
	if (args.provider === 'azureOpenAI' && !args.azureEndpoint) {
		throw new Error('Azure OpenAI requires --azure-endpoint or AZURE_OPENAI_ENDPOINT.');
	}
}

export function providerSetupRequired(args: ICliArguments): boolean {
	return !args.model
		|| (args.provider !== 'custom' && args.provider !== 'bedrock' && !args.apiKey)
		|| (args.provider === 'custom' && !args.baseUrl)
		|| (args.provider === 'bedrock' && !args.bedrockRegion)
		|| (args.provider === 'azureOpenAI' && !args.azureEndpoint);
}

async function runInteractiveSetup(initialProvider: ICliArguments['provider']): Promise<ICliSetupResult | undefined> {
	let result: ICliSetupResult | undefined;
	clearInteractiveScreen();
	const app = render(createElement(CleanSlateSetupTui, {
		initialProvider,
		onComplete: value => { result = value; },
		onCancel: () => { result = undefined; }
	}), { exitOnCtrlC: false });
	await app.waitUntilExit();
	app.clear();
	clearInteractiveScreen();
	return result;
}

function applySetupResult(args: ICliArguments, setup: ICliSetupResult): void {
	args.provider = setup.provider;
	args.providerSpecified = true;
	args.model = setup.model;
	args.modelSpecified = true;
	args.apiKey = setup.apiKey;
	args.baseUrl = setup.baseUrl;
	args.bedrockRegion = setup.bedrockRegion;
	args.bedrockProfile = setup.bedrockProfile;
	args.azureEndpoint = setup.azureEndpoint;
	args.azureApiVersion = setup.azureApiVersion;
}

async function completeManagedSetup(args: ICliArguments, setup: ICliSetupResult, credentialStore: CliCredentialStore): Promise<void> {
	clearInteractiveScreen();
	const cancellation = new AbortController();
	const cancel = () => cancellation.abort();
	process.once('SIGINT', cancel);
	let signedIn;
	try {
		signedIn = await authenticateCleanSlateInBrowser({
			signal: cancellation.signal,
			onReady: url => {
				process.stderr.write('CleanSlate sign in\n\n');
				process.stderr.write('TheWariend sign-in opened in your browser.\n');
				process.stderr.write('Waiting for authentication…  ctrl-c cancel\n\n');
				process.stderr.write(`If the browser did not open, visit:\n${url}\n`);
			}
		});
	} finally {
		process.off('SIGINT', cancel);
	}
	credentialStore.set('cleanslate', signedIn.token);
	const models = (signedIn.entitlements.models ?? []).filter(model => !!model.id?.trim());
	if (models.length === 0) {
		throw new Error(signedIn.entitlements.managed_ai
			? 'Your CleanSlate account currently has no managed models available.'
			: 'Your account does not have CleanSlate managed-model access. Upgrade the account, then run cleanslate --setup again.');
	}
	const preferred = args.model && models.some(model => model.id === args.model) ? args.model : models[0]!.id;
	setup.apiKey = signedIn.token;
	setup.model = preferred;
	process.stderr.write(`Connected to CleanSlate · ${preferred}\n`);
}

function validateOneShot(args: ICliArguments): void {
	if (!args.task) {
		throw new Error('A task is required. Run cleanslate --help for usage.');
	}
}

function renderPart(part: any, state: { wroteText: boolean }): void {
	if (part?.type === 'chat_text' && typeof part.content === 'string') {
		process.stdout.write(part.content);
		state.wroteText = true;
		return;
	}
	if (part?.type === 'transport_status' && part.status?.message) {
		process.stderr.write(`\n[provider] ${part.status.message}\n`);
	}
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
	const args = parseArguments(argv);
	if (args.help) {
		process.stdout.write(`${HELP_TEXT}\n`);
		return 0;
	}
	if (args.version) {
		process.stdout.write(`${VERSION}\n`);
		return 0;
	}
	validateWorkspace(args);

	const configStore = new CliConfigStore();
	const credentialStore = new CliCredentialStore();
	const storedConfig = configStore.load();
	applyStoredConfig(args, storedConfig);
	const sessionStore = new CliSessionStore(args.cwd);
	const useTui = args.tui ?? (process.stdin.isTTY === true && process.stdout.isTTY === true);

	if (args.listSessions) {
		printSessions(sessionStore.list());
		return 0;
	}

	const leaveInteractiveScreen = useTui ? enterInteractiveScreen() : undefined;
	try {
	let initialSession = args.sessionId
		? sessionStore.load(args.sessionId)
		: args.resume ? sessionStore.latest() : undefined;
	if (args.sessionId && !initialSession) {
		throw new Error(`Session not found: ${args.sessionId}`);
	}
	if (initialSession) {
		if (!args.providerSpecified) {
			args.provider = initialSession.provider as ICliArguments['provider'];
		}
		if (!args.modelSpecified) {
			args.model = initialSession.model;
		}
	}

	if (!argv.includes('--api-key')) {
		args.apiKey = apiKeyFromEnvironment(args.provider, process.env) ?? credentialStore.get(args.provider);
	}

	if (args.setup && !useTui) {
		throw new Error('--setup requires an interactive terminal.');
	}
	if (useTui && (args.setup || providerSetupRequired(args))) {
		const setup = await runInteractiveSetup(args.provider);
		if (!setup) {
			return 130;
		}
		if (setup.provider === 'cleanslate') {
			await completeManagedSetup(args, setup, credentialStore);
		}
		applySetupResult(args, setup);
		if (setup.apiKey) {
			credentialStore.set(setup.provider, setup.apiKey);
		}
	}
	validateProvider(args);
	configStore.save(configFromArguments(args));

	initialSession ??= sessionStore.create(args.provider, args.model!, args.task);
	sessionStore.save(initialSession);

	if (useTui) {
		let pendingInitialTask = args.task;
		while (true) {
			let setupRequested = false;
			clearInteractiveScreen();
			const app = render(createElement(CleanSlateTui, {
				args,
				store: sessionStore,
				initialSession,
				initialTask: pendingInitialTask,
				onConfigurationChange: changed => configStore.save(configFromArguments(changed)),
				getCredential: provider => credentialStore.get(provider),
				onCredentialChange: (provider, credential) => credentialStore.set(provider, credential),
				onRequestSetup: () => { setupRequested = true; }
			}), { exitOnCtrlC: false });
			await app.waitUntilExit();
			app.clear();
			clearInteractiveScreen();
			pendingInitialTask = undefined;
			if (!setupRequested) {
				return 0;
			}

			const setup = await runInteractiveSetup(args.provider);
			if (setup) {
				if (setup.provider === 'cleanslate') {
					await completeManagedSetup(args, setup, credentialStore);
				}
				applySetupResult(args, setup);
				if (setup.apiKey) {
					credentialStore.set(setup.provider, setup.apiKey);
				}
				validateProvider(args);
				configStore.save(configFromArguments(args));
				initialSession = sessionStore.create(args.provider, args.model!);
				sessionStore.save(initialSession);
			}
		}
	}

	validateOneShot(args);
	return runOneShot(args, initialSession, sessionStore);
	} finally {
		leaveInteractiveScreen?.();
	}
}

function applyStoredConfig(args: ICliArguments, config: ICliConfig): void {
	if (!args.providerSpecified && config.provider) {
		args.provider = config.provider;
	}
	if (!args.modelSpecified && !args.model && config.model) {
		args.model = config.model;
	}
	if (!args.baseUrl && config.baseUrl) {
		args.baseUrl = config.baseUrl;
	}
	if (!args.reasoningSpecified && config.reasoningLevel) {
		args.reasoningLevel = config.reasoningLevel;
	}
	args.maxTurns ??= config.maxTurns;
	args.bedrockRegion ??= config.bedrockRegion;
	args.bedrockProfile ??= config.bedrockProfile;
	args.azureEndpoint ??= config.azureEndpoint;
	args.azureApiVersion ??= config.azureApiVersion;
}

function configFromArguments(args: ICliArguments): ICliConfig {
	return {
		version: 1,
		provider: args.provider,
		model: args.model,
		baseUrl: args.baseUrl,
		reasoningLevel: args.reasoningLevel,
		maxTurns: args.maxTurns,
		bedrockRegion: args.bedrockRegion,
		bedrockProfile: args.bedrockProfile,
		azureEndpoint: args.azureEndpoint,
		azureApiVersion: args.azureApiVersion
	};
}

function printSessions(sessions: ICliSession[]): void {
	if (sessions.length === 0) {
		process.stdout.write('No saved sessions for this workspace.\n');
		return;
	}
	for (const session of sessions) {
		process.stdout.write(`${session.id}\t${new Date(session.updatedAt).toISOString()}\t${session.provider}/${session.model}\t${session.title}\n`);
	}
}

async function runOneShot(
	args: ICliArguments,
	session: ICliSession,
	sessionStore: CliSessionStore
): Promise<number> {

	const cancellation = new CancellationTokenSource();
	const abort = new AbortController();
	const cancellationListener = cancellation.token.onCancellationRequested(() => abort.abort());
	let interrupted = false;
	const onSigint = () => {
		if (interrupted) {
			return;
		}
		interrupted = true;
		process.stderr.write('\nCancelling…\n');
		activeApprovalPrompt?.close();
		cancellation.cancel();
	};
	process.on('SIGINT', onSigint);

	const runtime = new CleanSlateNodeAgentRuntime({
		rootPath: path.resolve(args.cwd),
		sessionId: session.id,
		configuration: createNodeProviderConfiguration({
			provider: args.provider,
			model: args.model!,
			apiKey: args.apiKey,
			baseUrl: args.baseUrl,
			reasoningLevel: args.reasoningLevel,
			maxTurns: args.maxTurns,
			bedrockRegion: args.bedrockRegion,
			bedrockCredentialMode: args.bedrockProfile ? 'profile' : 'default',
			bedrockProfile: args.bedrockProfile,
			azureEndpoint: args.azureEndpoint,
			azureApiVersion: args.azureApiVersion,
			azureDeploymentName: args.model
		}),
		onManagedTokenRefresh: token => new CliCredentialStore().set('cleanslate', token),
		approveCommand: request => requestCommandApproval(request),
		onProgress: event => {
			if (event.type === 'command_output' && typeof event.chunk === 'string') {
				process.stderr.write(event.chunk);
			}
		}
	});
	runtime.restoreSessionSnapshot(session.runtimeSnapshot);

	const state = { wroteText: false };
	let assistantText = '';
	session.transcript.push(transcriptEntry('user', args.task!));
	try {
		for await (const part of runtime.run(args.task!, abort.signal)) {
			renderPart(part, state);
			if (part.type === 'chat_text') {
				assistantText += part.content;
			}
		}
		if (state.wroteText) {
			process.stdout.write('\n');
		}
		if (assistantText.trim()) {
			session.transcript.push(transcriptEntry('assistant', assistantText));
		}
		return interrupted ? 130 : 0;
	} finally {
		session.runtimeSnapshot = runtime.getSessionSnapshot();
		sessionStore.save(session);
		runtime.dispose();
		process.off('SIGINT', onSigint);
		cancellationListener.dispose();
		cancellation.dispose();
	}
}

function isMainModule(): boolean {
	try {
		return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
	} catch {
		return false;
	}
}

if (isMainModule()) {
	main().then(
		code => { process.exitCode = code; },
		error => {
			process.stderr.write(`cleanslate: ${error instanceof Error ? error.message : String(error)}\n`);
			process.exitCode = 1;
		}
	);
}
