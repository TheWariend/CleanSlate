/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CancellationToken } from '../core/cancellation.js';
import { Emitter, Event } from '../core/event.js';
import {
	ICleanSlateBackgroundCommandOptions,
	ICleanSlateBackgroundCommandResult,
	ICleanSlateCommandExecutionOptions,
	ICleanSlateCommandExecutionResult,
	ICleanSlateCommandOutputEvent,
	ICleanSlateStopBackgroundCommandResult
} from '../protocol/cleanSlateAI.js';

interface IRunningCliCommand {
	id: string;
	command: string;
	cwd?: string;
	sessionId?: string;
	workspaceId?: string;
	child: cp.ChildProcessWithoutNullStreams;
	startedAt: number;
	stdout: string;
	stderr: string;
	output: string;
	status: ICleanSlateBackgroundCommandResult['status'];
	exitCode?: number;
	signal?: string;
	url?: string;
}

/**
 * The CLI command runtime, moved out of the Electron process boundary.
 *
 * Approval remains the host's responsibility: tools call
 * `requestCommandApproval` before reaching this service.
 */
export class CleanSlateNodeCommandService {
	private static readonly DEFAULT_EXEC_TIMEOUT_MS = 120_000;
	private static readonly DEFAULT_BACKGROUND_STARTUP_TIMEOUT_MS = 12_000;
	private static readonly MAX_CAPTURE_CHARS = 80_000;
	private static readonly FORCE_KILL_GRACE_MS = 3_000;
	private static readonly RUNNING_STATUS_INTERVAL_MS = 10_000;
	private static readonly STREAM_CLOSE_GRACE_MS = 250;

	private readonly backgroundCommands = new Map<string, IRunningCliCommand>();
	private nextBackgroundId = 1;

	constructor(private readonly defaultCwd: string) { }

	executeCommand(options: ICleanSlateCommandExecutionOptions): Promise<ICleanSlateCommandExecutionResult> {
		return this.executeCommandInternal(options);
	}

	executeCommandStream(options: ICleanSlateCommandExecutionOptions, token: CancellationToken = CancellationToken.None): Event<ICleanSlateCommandOutputEvent | null> {
		const emitter = new Emitter<ICleanSlateCommandOutputEvent | null>();
		const controller = new AbortController();
		const cancellation = token.onCancellationRequested(() => controller.abort());
		queueMicrotask(async () => {
			try {
				const result = await this.executeCommandInternal(options, event => emitter.fire(event), controller.signal);
				emitter.fire({ type: 'result', result });
			} catch (error) {
				emitter.fire({
					type: 'error',
					command: options.command,
					cwd: options.cwd,
					error: error instanceof Error ? error.message : String(error)
				});
			} finally {
				cancellation.dispose();
				emitter.fire(null);
				emitter.dispose();
			}
		});
		return emitter.event;
	}

	private async executeCommandInternal(
		options: ICleanSlateCommandExecutionOptions,
		emit?: (event: ICleanSlateCommandOutputEvent) => void,
		signal?: AbortSignal
	): Promise<ICleanSlateCommandExecutionResult> {
		const command = this.normalizeCommand(options.command);
		const cwd = await this.resolveCwd(options.cwd);
		const startedAt = Date.now();
		const timeoutMs = this.normalizeTimeout(options.timeoutMs, CleanSlateNodeCommandService.DEFAULT_EXEC_TIMEOUT_MS);

		let stdout = '';
		let stderr = '';
		let output = '';
		let timedOut = false;
		let hardTimeout: ReturnType<typeof setTimeout> | undefined;
		let runningStatusTimer: ReturnType<typeof setInterval> | undefined;

		return new Promise<ICleanSlateCommandExecutionResult>(resolve => {
			const child = this.spawnShell(command, cwd);
			const pid = child.pid;
			let resolved = false;
			let lastOutputAt = Date.now();

			emit?.({ type: 'started', command, cwd, pid, startedAt });

			const finish = (result: Omit<ICleanSlateCommandExecutionResult, 'command' | 'cwd' | 'stdout' | 'stderr' | 'output' | 'durationMs' | 'timedOut'>) => {
				if (resolved) {
					return;
				}
				resolved = true;
				clearTimeout(timeout);
				if (hardTimeout) {
					clearTimeout(hardTimeout);
				}
				if (runningStatusTimer) {
					clearInterval(runningStatusTimer);
				}
				resolve({
					success: result.success,
					command,
					cwd,
					sessionId: options.sessionId,
					workspaceId: options.workspaceId,
					processId: result.processId,
					pid: result.pid,
					status: result.status,
					exitCode: result.exitCode,
					signal: result.signal,
					stdout,
					stderr,
					output,
					durationMs: Date.now() - startedAt,
					timedOut,
					promotedToBackground: result.promotedToBackground,
					url: result.url,
					error: result.error
				});
			};

			const timeout = setTimeout(() => {
				timedOut = true;
				emit?.({
					type: 'status',
					command,
					cwd,
					pid,
					status: 'timeout',
					message: `Command timed out after ${timeoutMs}ms.`,
					durationMs: Date.now() - startedAt
				});
				this.terminateProcess(child);
				hardTimeout = setTimeout(() => finish({
					success: false,
					status: 'timeout',
					error: `Command timed out after ${timeoutMs}ms.`
				}), CleanSlateNodeCommandService.FORCE_KILL_GRACE_MS);
			}, timeoutMs);

			runningStatusTimer = setInterval(() => {
				if (resolved) {
					return;
				}
				const idleMs = Date.now() - lastOutputAt;
				emit?.({
					type: 'status',
					command,
					cwd,
					pid,
					status: 'running',
					message: idleMs >= CleanSlateNodeCommandService.RUNNING_STATUS_INTERVAL_MS
						? `Command is still running; no output for ${Math.floor(idleMs / 1000)}s.`
						: 'Command is still running.',
					durationMs: Date.now() - startedAt
				});
			}, CleanSlateNodeCommandService.RUNNING_STATUS_INTERVAL_MS);

			const observeOutput = (chunk: unknown, stream: 'stdout' | 'stderr') => {
				const text = String(chunk);
				lastOutputAt = Date.now();
				if (stream === 'stdout') {
					stdout = this.appendBounded(stdout, text);
				} else {
					stderr = this.appendBounded(stderr, text);
				}
				output = this.appendBounded(output, text);
				emit?.({ type: stream, command, cwd, pid, chunk: text, stdout, stderr, output, durationMs: Date.now() - startedAt });
			};

			child.stdout.on('data', chunk => observeOutput(chunk, 'stdout'));
			child.stderr.on('data', chunk => observeOutput(chunk, 'stderr'));
			child.on('error', error => {
				emit?.({ type: 'error', command, cwd, error: error.message });
				finish({ success: false, status: 'failed', error: error.message });
			});

			let exitedResult: Omit<ICleanSlateCommandExecutionResult, 'command' | 'cwd' | 'stdout' | 'stderr' | 'output' | 'durationMs' | 'timedOut'> | undefined;
			let closeReceived = false;
			let closeGraceTimer: ReturnType<typeof setTimeout> | undefined;
			const finishExitedCommand = () => {
				if (!exitedResult) {
					return;
				}
				if (closeReceived) {
					finish(exitedResult);
				} else if (!closeGraceTimer) {
					closeGraceTimer = setTimeout(() => finish(exitedResult!), CleanSlateNodeCommandService.STREAM_CLOSE_GRACE_MS);
				}
			};

			child.on('exit', (exitCode, closeSignal) => {
				exitedResult = {
					success: !timedOut && exitCode === 0,
					status: timedOut ? 'timeout' : exitCode === 0 ? 'completed' : 'failed',
					exitCode: typeof exitCode === 'number' ? exitCode : undefined,
					signal: closeSignal ?? undefined,
					error: timedOut ? `Command timed out after ${timeoutMs}ms.` : exitCode === 0 ? undefined : `Command exited with code ${exitCode ?? 'unknown'}.`
				};
				finishExitedCommand();
			});
			child.on('close', () => {
				closeReceived = true;
				if (closeGraceTimer) {
					clearTimeout(closeGraceTimer);
					closeGraceTimer = undefined;
				}
				finishExitedCommand();
			});

			if (signal) {
				const abort = () => {
					if (resolved) {
						return;
					}
					this.terminateProcess(child);
					finish({ success: false, status: 'failed', error: 'Command was cancelled.' });
				};
				if (signal.aborted) {
					abort();
				} else {
					signal.addEventListener('abort', abort, { once: true });
				}
			}
		});
	}

	async startBackgroundCommand(options: ICleanSlateBackgroundCommandOptions): Promise<ICleanSlateBackgroundCommandResult> {
		const command = this.normalizeCommand(options.command);
		const cwd = await this.resolveCwd(options.cwd);
		const startupTimeoutMs = this.normalizeTimeout(options.startupTimeoutMs ?? options.timeoutMs, CleanSlateNodeCommandService.DEFAULT_BACKGROUND_STARTUP_TIMEOUT_MS);
		const id = `cmd-${Date.now()}-${this.nextBackgroundId++}`;
		const startedAt = Date.now();
		const child = this.spawnShell(command, cwd);
		const session: IRunningCliCommand = {
			id,
			command,
			cwd,
			sessionId: options.sessionId,
			workspaceId: options.workspaceId,
			child,
			startedAt,
			stdout: '',
			stderr: '',
			output: '',
			status: 'running'
		};
		this.backgroundCommands.set(id, session);

		return new Promise<ICleanSlateBackgroundCommandResult>(resolve => {
			let resolved = false;
			const finishStartup = (status: ICleanSlateBackgroundCommandResult['status'], error?: string) => {
				if (resolved) {
					return;
				}
				resolved = true;
				clearTimeout(startupTimeout);
				session.status = status;
				resolve(this.toBackgroundResult(session, error));
			};
			const observeOutput = (chunk: unknown, stream: 'stdout' | 'stderr') => {
				const text = String(chunk);
				session[stream] = this.appendBounded(session[stream], text);
				session.output = this.appendBounded(session.output, text);
				session.url = this.extractUrl(session.output) ?? session.url;
				if (this.isReady(session.output, options.readyPattern)) {
					finishStartup('ready');
				}
			};
			const startupTimeout = setTimeout(() => finishStartup('running'), startupTimeoutMs);
			child.stdout.on('data', chunk => observeOutput(chunk, 'stdout'));
			child.stderr.on('data', chunk => observeOutput(chunk, 'stderr'));
			child.on('error', error => {
				session.status = 'failed';
				finishStartup('failed', error.message);
			});
			child.on('close', (exitCode, closeSignal) => {
				session.exitCode = typeof exitCode === 'number' ? exitCode : undefined;
				session.signal = closeSignal ?? undefined;
				session.status = exitCode === 0 ? 'exited' : 'failed';
				finishStartup(session.status, exitCode === 0 ? undefined : `Command exited with code ${exitCode ?? 'unknown'}.`);
				const retentionTimer = setTimeout(() => this.backgroundCommands.delete(id), 5 * 60_000);
				retentionTimer.unref();
			});
		});
	}

	async stopBackgroundCommand(processId: string): Promise<ICleanSlateStopBackgroundCommandResult> {
		const id = processId.trim();
		const session = this.backgroundCommands.get(id);
		if (!session) {
			return { success: false, processId: id, stopped: false, error: `Background command "${id}" was not found.` };
		}
		this.terminateProcess(session.child);
		this.backgroundCommands.delete(id);
		return { success: true, processId: id, stopped: true, message: `Stopped background command ${id}.` };
	}

	async getBackgroundCommand(processId: string): Promise<ICleanSlateBackgroundCommandResult> {
		const id = processId.trim();
		const session = this.backgroundCommands.get(id);
		if (!session) {
			return {
				success: false,
				processId: id,
				command: '',
				status: 'failed',
				stdout: '',
				stderr: '',
				output: '',
				durationMs: 0,
				error: `Background command "${id}" was not found.`
			};
		}
		return this.toBackgroundResult(session);
	}

	async listBackgroundCommands(): Promise<ICleanSlateBackgroundCommandResult[]> {
		return Array.from(this.backgroundCommands.values()).map(session => this.toBackgroundResult(session));
	}

	dispose(): void {
		for (const session of this.backgroundCommands.values()) {
			this.terminateProcess(session.child);
		}
		this.backgroundCommands.clear();
	}

	private normalizeCommand(command: string | undefined): string {
		const trimmed = (command || '').trim();
		if (!trimmed) {
			throw new Error('No command provided.');
		}
		return trimmed;
	}

	private normalizeTimeout(timeoutMs: number | undefined, fallback: number): number {
		if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
			return fallback;
		}
		return Math.max(1_000, Math.min(Math.floor(timeoutMs), 30 * 60_000));
	}

	private async resolveCwd(cwd: string | undefined): Promise<string> {
		const resolved = path.resolve(cwd?.trim() || this.defaultCwd);
		const stat = await fs.promises.stat(resolved);
		if (!stat.isDirectory()) {
			throw new Error(`Command cwd is not a directory: ${resolved}`);
		}
		return resolved;
	}

	private spawnShell(command: string, cwd: string): cp.ChildProcessWithoutNullStreams {
		if (os.platform() === 'win32') {
			return cp.spawn(process.env['ComSpec'] || 'cmd.exe', ['/d', '/s', '/c', command], {
				cwd,
				env: this.buildEnvironment(),
				windowsHide: true
			});
		}
		return cp.spawn(process.env['SHELL'] || '/bin/zsh', ['-lc', command], {
			cwd,
			env: this.buildEnvironment(),
			detached: true
		});
	}

	private buildEnvironment(): NodeJS.ProcessEnv {
		return {
			...process.env,
			CI: process.env['CI'] || '1',
			PAGER: 'cat',
			GIT_TERMINAL_PROMPT: process.env['GIT_TERMINAL_PROMPT'] || '0',
			TERM: process.env['TERM'] || 'xterm-256color'
		};
	}

	private appendBounded(existing: string, next: string): string {
		const combined = existing + next;
		return combined.length <= CleanSlateNodeCommandService.MAX_CAPTURE_CHARS
			? combined
			: combined.slice(combined.length - CleanSlateNodeCommandService.MAX_CAPTURE_CHARS);
	}

	private terminateProcess(child: cp.ChildProcessWithoutNullStreams): void {
		if (child.killed) {
			return;
		}
		const kill = (signal: NodeJS.Signals) => {
			if (os.platform() !== 'win32' && typeof child.pid === 'number') {
				try {
					process.kill(-child.pid, signal);
					return;
				} catch {
					// Fall back to killing the shell process directly.
				}
			}
			child.kill(signal);
		};
		try {
			kill('SIGTERM');
			const forceKillTimer = setTimeout(() => {
				if (!child.killed && child.exitCode === null) {
					try {
						kill('SIGKILL');
					} catch {
						// The process may have exited between checks.
					}
				}
			}, CleanSlateNodeCommandService.FORCE_KILL_GRACE_MS);
			forceKillTimer.unref();
		} catch {
			// Nothing useful to do if the OS rejects the signal.
		}
	}

	private isReady(output: string, readyPattern: string | undefined): boolean {
		if (readyPattern?.trim()) {
			try {
				return new RegExp(readyPattern, 'i').test(output);
			} catch {
				return output.toLowerCase().includes(readyPattern.toLowerCase());
			}
		}
		const lower = output.toLowerCase();
		return !!this.extractUrl(output)
			|| lower.includes('ready in ')
			|| lower.includes('compiled successfully')
			|| lower.includes('server running')
			|| lower.includes('listening on ');
	}

	private extractUrl(output: string): string | undefined {
		const matches = Array.from(output.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[[^\]]+\]|[^\s"'<>]+)(?::\d+)?(?:\/[^\s"'<>]*)?/gi));
		for (let index = matches.length - 1; index >= 0; index--) {
			const candidate = matches[index][0];
			if (/^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::|\/|$)/i.test(candidate)) {
				return candidate;
			}
		}
		return matches.at(-1)?.[0];
	}

	private toBackgroundResult(session: IRunningCliCommand, error?: string): ICleanSlateBackgroundCommandResult {
		return {
			success: session.status === 'ready' || session.status === 'running' || session.exitCode === 0,
			processId: session.id,
			pid: session.child.pid,
			command: session.command,
			cwd: session.cwd,
			sessionId: session.sessionId,
			workspaceId: session.workspaceId,
			status: session.status,
			exitCode: session.exitCode,
			signal: session.signal,
			stdout: session.stdout,
			stderr: session.stderr,
			output: session.output,
			durationMs: Date.now() - session.startedAt,
			url: session.url,
			error
		};
	}
}
