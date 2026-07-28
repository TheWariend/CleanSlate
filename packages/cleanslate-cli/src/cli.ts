#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { fileURLToPath } from 'url';
import {
	CancellationTokenSource,
	CleanSlateNodeAgentRuntime,
	createNodeProviderConfiguration
} from '@slate/sdk';
import { HELP_TEXT, ICliArguments, parseArguments } from './argv.js';

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

function validateArguments(args: ICliArguments): void {
	if (!args.task) {
		throw new Error('A task is required. Run cleanslate --help for usage.');
	}
	const root = path.resolve(args.cwd);
	if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
		throw new Error(`Workspace root is not a directory: ${root}`);
	}
	if (!args.model) {
		throw new Error('A model is required. Pass --model or set CLEANSLATE_MODEL.');
	}
	if (args.provider !== 'custom' && !args.apiKey) {
		throw new Error(`An API key is required for ${args.provider}. Pass --api-key or set the provider API-key environment variable.`);
	}
	if (args.provider === 'custom' && !args.baseUrl) {
		throw new Error('Custom provider requires --base-url or CLEANSLATE_BASE_URL.');
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
	validateArguments(args);

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

	const state = { wroteText: false };
	try {
		for await (const part of runtime.run(args.task!, abort.signal)) {
			renderPart(part, state);
		}
		if (state.wroteText) {
			process.stdout.write('\n');
		}
		return interrupted ? 130 : 0;
	} finally {
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
