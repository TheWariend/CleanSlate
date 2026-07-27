/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CleanSlateTool, CleanSlateToolContext } from './types.js';
import { resolveCommandCwd } from './utils.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';

export const executeCommandTool: CleanSlateTool = {
	name: 'execute_command',
	description: "Executes a finite shell command and returns stdout, stderr, exit code, and duration in one result. This is the primary path for official non-interactive project generators in empty workspaces, plus necessary installs, codegen, explicit tests/builds, and other one-shot commands. Prefer read_lints for routine code diagnostics. Always declare intent and whether the command writes to the workspace so phase runners can enforce boundaries without parsing command text.",
	category: 'execution',
	parametersSchema: {
		type: 'object',
		properties: {
			command: {
				type: 'string',
				description: 'The shell command to execute.'
			},
			cwd: {
				type: 'string',
				description: 'The working directory for the command. Defaults to the workspace root.'
			},
			reason: {
				type: 'string',
				description: 'Brief explanation of why this command is being run for user approval.'
			},
			intent: {
				type: 'string',
				enum: ['implementation', 'diagnostic', 'verification', 'user_requested'],
				description: "Why this command is being run. Use 'implementation' for installs/scaffolds/codegen/required implementation commands, 'diagnostic' for local inspection that informs the edit, 'verification' for final proof after edits, and 'user_requested' only when the user explicitly asked for CLI output."
			},
			writesToWorkspace: {
				type: 'boolean',
				description: 'Whether this command can create, delete, rewrite, install, format, or otherwise modify workspace files. Read-only verification commands must set this to false.'
			},
			timeoutMs: {
				type: 'number',
				description: 'Optional command timeout in milliseconds.'
			}
		},
		required: ['command', 'reason', 'intent', 'writesToWorkspace']
	},
	async run(input: { command?: string; cwd?: string; reason?: string; intent?: string; writesToWorkspace?: boolean; timeoutMs?: number }, context: CleanSlateToolContext): Promise<any> {
		const command = input.command?.trim();
		if (!command) {
			return { success: false, error: 'No command provided.' };
		}

		// Shell must never be an edit-tool fallback. When an apply_edit
		// preflight fails, models under pressure try to rewrite source files
		// with python heredocs / sed -i / redirection — bypassing edit safety,
		// review, and diffs entirely (and usually mangling the file: an
		// observed 1100-line Dart class embedded in a python triple-quoted
		// string died on a SyntaxError). Reject with the corrective path.
		const sourceEditAttempt = detectShellSourceEditAttempt(command);
		if (sourceEditAttempt && input.intent !== 'user_requested') {
			return {
				success: false,
				code: 'shell_source_edit_blocked',
				command,
				error: `Shell-based source editing is not allowed (${sourceEditAttempt}).`,
				message: 'Workspace source files must be edited with apply_edit, multi_file_replace, or write_file — never via shell scripts, heredocs, sed -i, or output redirection.',
				recoveryHint: 'Use apply_edit for a localized change. For a new file or intentional whole-file replacement, read the existing file in full when applicable and use write_file.'
			};
		}

		const resolvedCwd = await resolveCommandCwd(input.cwd, context);
		const approved = await context.requestCommandApproval({
			command,
			cwd: resolvedCwd,
			reason: input.reason,
			toolName: 'execute_command'
		});

		if (!approved) {
			return {
				success: false,
				code: 'user_cancelled',
				status: 'cancelled',
				userCancelled: true,
				command,
				cwd: resolvedCwd,
				error: 'Command execution was cancelled by the user.',
				message: 'The user cancelled this command. Do not retry it unless the user explicitly asks to run it again.'
			};
		}

		const cancellation = new CancellationTokenSource();
		const abort = () => cancellation.cancel();
		if (context.signal?.aborted) {
			abort();
		} else {
			context.signal?.addEventListener('abort', abort, { once: true });
		}
		const disposeCancellation = () => {
			context.signal?.removeEventListener('abort', abort);
			cancellation.dispose();
		};

		try {
			const streamCommand = context.commandExecutionService.executeCommandStream;
			const result = typeof streamCommand === 'function' ? await new Promise<any>((resolve) => {
				let finalResult: any | undefined;
				let disposable: { dispose(): void } | undefined;
				const commandEvents = streamCommand.call(context.commandExecutionService, {
					command,
					cwd: resolvedCwd,
					timeoutMs: input.timeoutMs,
					sessionId: context.sessionId,
					workspaceId: commandWorkspaceId(context)
				}, cancellation.token);
				disposable = commandEvents(event => {
					if (event === null) {
						disposable?.dispose();
						resolve(finalResult ?? {
							success: false,
							command,
							cwd: resolvedCwd,
							stdout: '',
							stderr: '',
							output: '',
							durationMs: 0,
							timedOut: false,
							status: 'failed',
							error: 'Command stream ended without a result.'
						});
						return;
					}

					if (event.type === 'started') {
						context.onProgress?.({
							type: 'command_status',
							command,
							cwd: resolvedCwd,
							status: 'running',
							data: '',
							message: typeof event.pid === 'number' ? `Started process ${event.pid}.` : 'Command started.',
							pid: event.pid,
							elapsedMs: 0
						});
					} else if (event.type === 'stdout' || event.type === 'stderr') {
						context.onProgress?.({
							type: 'command_output',
							command,
							cwd: resolvedCwd,
							stream: event.type,
							chunk: event.chunk,
							data: event.output,
							stdout: event.stdout,
							stderr: event.stderr,
							elapsedMs: event.durationMs,
							status: 'running'
						});
					} else if (event.type === 'status') {
						context.onProgress?.({
							type: 'command_status',
							command,
							cwd: resolvedCwd,
							status: event.status,
							data: '',
							message: event.message,
							elapsedMs: event.durationMs
						});
					} else if (event.type === 'result') {
						finalResult = event.result;
					} else if (event.type === 'error') {
						finalResult = {
							success: false,
							command,
							cwd: resolvedCwd,
							stdout: '',
							stderr: '',
							output: '',
							durationMs: 0,
							timedOut: false,
							status: 'failed',
							error: event.error
						};
					}
				});
			}) : await context.commandExecutionService.executeCommand({
				command,
				cwd: resolvedCwd,
				timeoutMs: input.timeoutMs,
				sessionId: context.sessionId,
				workspaceId: commandWorkspaceId(context)
			});

			disposeCancellation();
			return {
				...result,
				status: result.status ?? (result.success ? 'completed' : 'failed')
			};
		} catch (error) {
			disposeCancellation();
			return {
				success: false,
				command,
				cwd: resolvedCwd,
				stdout: '',
				stderr: '',
				output: '',
				durationMs: 0,
				timedOut: false,
				status: 'failed',
				error: String(error)
			};
		}
	}
};

export const startBackgroundCommandTool: CleanSlateTool = {
	name: 'start_background_command',
	description: 'Starts a long-running shell command such as a dev server or watcher and returns after readiness, exit, or startup timeout. Do not use this for finite commands.',
	category: 'execution',
	parametersSchema: {
		type: 'object',
		properties: {
			command: {
				type: 'string',
				description: 'The shell command to start.'
			},
			cwd: {
				type: 'string',
				description: 'The working directory for the command. Defaults to the workspace root.'
			},
			reason: {
				type: 'string',
				description: 'Brief explanation of why this background command is being started for user approval.'
			},
			readyPattern: {
				type: 'string',
				description: 'Optional readiness pattern to detect in stdout/stderr.'
			},
			startupTimeoutMs: {
				type: 'number',
				description: 'How long to wait for readiness before returning the initial running state.'
			}
		},
		required: ['command', 'reason']
	},
	async run(input: { command?: string; cwd?: string; reason?: string; readyPattern?: string; startupTimeoutMs?: number }, context: CleanSlateToolContext): Promise<any> {
		const command = input.command?.trim();
		if (!command) {
			return { success: false, error: 'No command provided.' };
		}

		const resolvedCwd = await resolveCommandCwd(input.cwd, context);
		const approved = await context.requestCommandApproval({
			command,
			cwd: resolvedCwd,
			reason: input.reason,
			toolName: 'start_background_command'
		});

		if (!approved) {
			return {
				success: false,
				code: 'user_cancelled',
				status: 'cancelled',
				userCancelled: true,
				command,
				cwd: resolvedCwd,
				error: 'Background command was cancelled by the user.',
				message: 'The user cancelled this background command. Do not retry it unless the user explicitly asks to run it again.'
			};
		}

		try {
			return await context.commandExecutionService.startBackgroundCommand({
				command,
				cwd: resolvedCwd,
				readyPattern: input.readyPattern,
				startupTimeoutMs: input.startupTimeoutMs,
				sessionId: context.sessionId,
				workspaceId: commandWorkspaceId(context)
			});
		} catch (error) {
			return {
				success: false,
				command,
				cwd: resolvedCwd,
				status: 'failed',
				stdout: '',
				stderr: '',
				output: '',
				durationMs: 0,
				error: String(error)
			};
		}
	}
};

export const stopBackgroundCommandTool: CleanSlateTool = {
	name: 'stop_background_command',
	description: 'Stops a background command previously started by start_background_command.',
	category: 'execution',
	parametersSchema: {
		type: 'object',
		properties: {
			processId: {
				type: 'string',
				description: 'The processId returned by start_background_command.'
			}
		},
		required: ['processId']
	},
	async run(input: { processId?: string }, context: CleanSlateToolContext): Promise<any> {
		const processId = input.processId?.trim();
		if (!processId) {
			return { success: false, error: 'No processId provided.' };
		}

		return await context.commandExecutionService.stopBackgroundCommand(processId);
	}
};

export const readBackgroundCommandTool: CleanSlateTool = {
	name: 'read_background_command',
	description: 'Reads the latest pid, status, URL, stdout, stderr, and captured logs for managed background commands. Pass processId for one command, or omit it to list retained background commands.',
	category: 'execution',
	parametersSchema: {
		type: 'object',
		properties: {
			processId: {
				type: 'string',
				description: 'Optional processId returned by start_background_command or an auto-promoted execute_command.'
			}
		}
	},
	async run(input: { processId?: string }, context: CleanSlateToolContext): Promise<any> {
		const processId = input.processId?.trim();
		if (processId) {
			return await context.commandExecutionService.getBackgroundCommand(processId);
		}

		const commands = filterBackgroundCommandsForContext(await context.commandExecutionService.listBackgroundCommands(), context);
		return {
			success: true,
			commands,
			count: commands.length
		};
	}
};

function commandWorkspaceId(context: CleanSlateToolContext): string | undefined {
	return context.workspaceContextService.getWorkspace().id;
}

function filterBackgroundCommandsForContext<T extends { sessionId?: string; workspaceId?: string; cwd?: string }>(commands: T[], context: CleanSlateToolContext): T[] {
	const sessionId = context.sessionId;
	const workspaceId = commandWorkspaceId(context);
	const workspaceFolders = context.workspaceContextService.getWorkspace().folders.map(folder => normalizeFsPathForComparison(folder.uri.fsPath));
	return commands.filter(command => {
		if (sessionId && command.sessionId) {
			return command.sessionId === sessionId;
		}
		if (workspaceId && command.workspaceId) {
			return command.workspaceId === workspaceId;
		}
		const cwd = command.cwd ? normalizeFsPathForComparison(command.cwd) : undefined;
		return !cwd || workspaceFolders.some(folder => cwd === folder || cwd.startsWith(`${folder}/`));
	});
}

function normalizeFsPathForComparison(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+$/g, '');
}

const SOURCE_FILE_EXTENSIONS = 'dart|ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|kts|swift|c|h|cpp|hpp|cs|rb|php|vue|svelte|css|scss|less|html';

/**
 * Detects commands that try to rewrite workspace source files through the
 * shell instead of the edit tools. Returns a short human-readable label of
 * the matched pattern, or undefined when the command looks safe.
 */
export function detectShellSourceEditAttempt(command: string): string | undefined {
	if (/\bwrite_text\s*\(|\bopen\s*\([^)]*['"](?:w|a)\b/.test(command)) {
		return 'python file-write call';
	}
	if (/\bsed\s+(-[a-zA-Z]*\s+)*-i\b/.test(command)) {
		return 'sed -i in-place edit';
	}
	if (new RegExp(`(?:^|[^<>])>{1,2}\\s*\\S+\\.(?:${SOURCE_FILE_EXTENSIONS})\\b`).test(command)) {
		return 'shell redirection into a source file';
	}
	if (new RegExp(`\\b(?:tee|dd)\\b[^|;&]*\\S+\\.(?:${SOURCE_FILE_EXTENSIONS})\\b`).test(command)) {
		return 'tee/dd write into a source file';
	}
	return undefined;
}
