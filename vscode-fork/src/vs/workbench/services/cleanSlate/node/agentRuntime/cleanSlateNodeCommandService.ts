/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import {
	ICleanSlateCommandExecutionOptions,
	ICleanSlateCommandExecutionResult
} from '../../common/core/cleanSlateAI.js';

const DEFAULT_TIMEOUT_MS = 120_000;
/** Enough for the model to read an error without the transcript exploding. */
const MAX_CAPTURED_CHARS = 100_000;

function clamp(text: string): string {
	if (text.length <= MAX_CAPTURED_CHARS) {
		return text;
	}
	const half = Math.floor(MAX_CAPTURED_CHARS / 2);
	// Both ends matter: the command echo at the start, the failure at the end.
	return `${text.slice(0, half)}\n… ${text.length - MAX_CAPTURED_CHARS} characters trimmed …\n${text.slice(-half)}`;
}

/**
 * Runs commands through a shell, headlessly.
 *
 * There is no approval prompt here — the caller decides. In the editor a human
 * confirms each command; anywhere else the host must impose its own policy
 * before calling this, because nothing below will stop a destructive command.
 */
export class CleanSlateNodeCommandService {

	constructor(private readonly defaultCwd: string) { }

	async executeCommand(options: ICleanSlateCommandExecutionOptions): Promise<ICleanSlateCommandExecutionResult> {
		const started = Date.now();
		const cwd = options.cwd ?? this.defaultCwd;
		const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

		return new Promise<ICleanSlateCommandExecutionResult>(resolve => {
			const child = spawn(options.command, {
				cwd,
				shell: true,
				env: process.env
			});

			let stdout = '';
			let stderr = '';
			let timedOut = false;

			const timer = setTimeout(() => {
				timedOut = true;
				child.kill('SIGKILL');
			}, timeoutMs);

			child.stdout?.on('data', (chunk: Buffer | string) => { stdout += chunk.toString(); });
			child.stderr?.on('data', (chunk: Buffer | string) => { stderr += chunk.toString(); });

			const finish = (exitCode: number | undefined, signal: string | undefined, error?: string) => {
				clearTimeout(timer);
				const outText = clamp(stdout);
				const errText = clamp(stderr);
				resolve({
					success: !timedOut && exitCode === 0 && !error,
					command: options.command,
					cwd,
					sessionId: options.sessionId,
					workspaceId: options.workspaceId,
					pid: child.pid,
					status: timedOut ? 'timeout' : (error ? 'failed' : 'completed'),
					exitCode,
					signal,
					stdout: outText,
					stderr: errText,
					// `output` is what the model reads, so interleave both streams.
					output: clamp([stdout, stderr].filter(Boolean).join('\n')),
					durationMs: Date.now() - started,
					timedOut,
					error
				});
			};

			child.on('error', (err: Error) => finish(undefined, undefined, err.message));
			child.on('close', (code: number | null, signal: string | null) => finish(code ?? undefined, signal ?? undefined));
		});
	}
}
