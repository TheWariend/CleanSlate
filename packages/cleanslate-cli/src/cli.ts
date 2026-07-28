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
import { CliConfigStore, ICliConfig } from './config.js';
import { CliSessionStore, ICliSession, transcriptEntry } from './sessions.js';
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
	if (args.provider !== 'custom' && !args.apiKey) {
		throw new Error(`An API key is required for ${args.provider}. Pass --api-key or set the provider API-key environment variable.`);
	}
	if (args.provider === 'custom' && !args.baseUrl) {
		throw new Error('Custom provider requires --base-url or CLEANSLATE_BASE_URL.');
	}
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
	const storedConfig = configStore.load();
	applyStoredConfig(args, storedConfig);
	const sessionStore = new CliSessionStore(args.cwd);

	if (args.listSessions) {
		printSessions(sessionStore.list());
		return 0;
	}

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
		args.apiKey = apiKeyFromEnvironment(args.provider, process.env);
	}
	validateProvider(args);
	configStore.save(configFromArguments(args));

	initialSession ??= sessionStore.create(args.provider, args.model!, args.task);
	sessionStore.save(initialSession);

	const useTui = args.tui ?? (process.stdin.isTTY === true && process.stdout.isTTY === true);
	if (useTui) {
		const app = render(createElement(CleanSlateTui, {
			args,
			store: sessionStore,
			initialSession,
			initialTask: args.task
		}), { exitOnCtrlC: false });
		await app.waitUntilExit();
		return 0;
	}

	validateOneShot(args);
	return runOneShot(args, initialSession, sessionStore);
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
}

function configFromArguments(args: ICliArguments): ICliConfig {
	return {
		version: 1,
		provider: args.provider,
		model: args.model,
		baseUrl: args.baseUrl,
		reasoningLevel: args.reasoningLevel,
		maxTurns: args.maxTurns
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
			maxTurns: args.maxTurns
		}),
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
