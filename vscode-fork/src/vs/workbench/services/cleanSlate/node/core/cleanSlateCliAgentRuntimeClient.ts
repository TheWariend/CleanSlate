/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { fileURLToPath } from 'url';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import type {
	ICleanSlateBackgroundCommandOptions,
	ICleanSlateBackgroundCommandResult,
	ICleanSlateCommandExecutionOptions,
	ICleanSlateCommandExecutionResult,
	ICleanSlateCommandOutputEvent,
	ICleanSlateStopBackgroundCommandResult
} from '../../common/core/cleanSlateAI.js';
import { CleanSlateCliAgentRequest, CleanSlateCliAgentResponse } from './cleanSlateCliAgentProtocol.js';

interface IPendingCliAgentRequest<T> {
	resolve: (value: T) => void;
	reject: (error: Error) => void;
	onEvent?: (event: ICleanSlateCommandOutputEvent) => void;
}

export class CleanSlateCliAgentRuntimeClient {
	private process: cp.ChildProcessWithoutNullStreams | undefined;
	private nextRequestId = 1;
	private readonly pending = new Map<number, IPendingCliAgentRequest<any>>();
	private stderr = '';

	async executeCommand(
		options: ICleanSlateCommandExecutionOptions,
		onEvent?: (event: ICleanSlateCommandOutputEvent) => void,
		token: CancellationToken = CancellationToken.None
	): Promise<ICleanSlateCommandExecutionResult> {
		const requestId = this.nextRequestId++;
		const promise = this.send<ICleanSlateCommandExecutionResult>({
			id: requestId,
			type: 'execute',
			options
		}, onEvent);

		const cancellation = token !== CancellationToken.None
			? token.onCancellationRequested(() => {
				this.cancel(requestId);
			})
			: undefined;

		try {
			return await promise;
		} finally {
			cancellation?.dispose();
		}
	}

	startBackgroundCommand(options: ICleanSlateBackgroundCommandOptions): Promise<ICleanSlateBackgroundCommandResult> {
		return this.send<ICleanSlateBackgroundCommandResult>({
			id: this.nextRequestId++,
			type: 'startBackground',
			options
		});
	}

	stopBackgroundCommand(processId: string): Promise<ICleanSlateStopBackgroundCommandResult> {
		return this.send<ICleanSlateStopBackgroundCommandResult>({
			id: this.nextRequestId++,
			type: 'stopBackground',
			processId
		});
	}

	getBackgroundCommand(processId: string): Promise<ICleanSlateBackgroundCommandResult> {
		return this.send<ICleanSlateBackgroundCommandResult>({
			id: this.nextRequestId++,
			type: 'getBackground',
			processId
		});
	}

	listBackgroundCommands(): Promise<ICleanSlateBackgroundCommandResult[]> {
		return this.send<ICleanSlateBackgroundCommandResult[]>({
			id: this.nextRequestId++,
			type: 'listBackground'
		});
	}

	dispose(): void {
		const process = this.process;
		this.process = undefined;
		if (process && !process.killed) {
			try {
				this.write({
					id: this.nextRequestId++,
					type: 'shutdown'
				}, process);
			} catch {
				// The process may already be gone.
			}
			setTimeout(() => {
				if (!process.killed && process.exitCode === null) {
					process.kill('SIGTERM');
				}
			}, 250);
		}
		this.rejectAllPending(new Error('CleanSlate CLI agent runtime was disposed.'));
	}

	private cancel(targetId: number): void {
		const process = this.process;
		if (!process || process.killed || process.exitCode !== null) {
			return;
		}
		this.write({
			id: this.nextRequestId++,
			type: 'cancel',
			targetId
		}, process);
	}

	private send<T>(request: CleanSlateCliAgentRequest, onEvent?: (event: ICleanSlateCommandOutputEvent) => void): Promise<T> {
		const process = this.ensureProcess();
		return new Promise<T>((resolve, reject) => {
			this.pending.set(request.id, { resolve, reject, onEvent });
			try {
				this.write(request, process);
			} catch (error) {
				this.pending.delete(request.id);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	private ensureProcess(): cp.ChildProcessWithoutNullStreams {
		if (this.process && this.process.exitCode === null && !this.process.killed) {
			return this.process;
		}

		const modulePath = this.resolveRuntimeProcessModulePath();
		const child = cp.spawn(process.execPath, [modulePath], {
			stdio: ['pipe', 'pipe', 'pipe'],
			env: {
				...process.env,
				ELECTRON_RUN_AS_NODE: '1'
			}
		});

		this.process = child;
		this.stderr = '';
		const reader = readline.createInterface({
			input: child.stdout,
			crlfDelay: Infinity
		});
		reader.on('line', line => this.handleLine(line));
		child.stderr.on('data', chunk => {
			const text = String(chunk).trimEnd();
			if (text) {
				this.stderr = `${this.stderr}${this.stderr ? '\n' : ''}${text}`.slice(-8_000);
				console.warn(`[CleanSlateCliAgentRuntime] ${text}`);
			}
		});
		child.on('error', error => {
			this.process = undefined;
			this.rejectAllPending(error);
		});
		child.on('exit', (code, signal) => {
			this.process = undefined;
			reader.close();
			if (this.pending.size > 0) {
				const detail = this.stderr ? `\n${this.stderr}` : '';
				this.rejectAllPending(new Error(`CleanSlate CLI agent runtime exited (${signal ?? code ?? 'unknown'}).${detail}`));
			}
		});
		return child;
	}

	private resolveRuntimeProcessModulePath(): string {
		const moduleName = 'cleanSlateCliAgentRuntimeProcess.js';
		const moduleDir = path.dirname(fileURLToPath(import.meta.url));
		const directModulePath = path.join(moduleDir, moduleName);

		if (fs.existsSync(directModulePath)) {
			return directModulePath;
		}

		let current = moduleDir;
		while (true) {
			const bundledModulePath = path.join(current, 'vs/workbench/services/cleanSlate/node/core', moduleName);
			if (fs.existsSync(bundledModulePath)) {
				return bundledModulePath;
			}

			const parent = path.dirname(current);
			if (parent === current) {
				return directModulePath;
			}
			current = parent;
		}
	}

	private write(request: CleanSlateCliAgentRequest, child: cp.ChildProcessWithoutNullStreams): void {
		child.stdin.write(`${JSON.stringify(request)}\n`);
	}

	private handleLine(line: string): void {
		const trimmed = line.trim();
		if (!trimmed) {
			return;
		}
		let message: CleanSlateCliAgentResponse;
		try {
			message = JSON.parse(trimmed);
		} catch (error) {
			console.warn(`[CleanSlateCliAgentRuntime] Invalid response JSON: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}

		const pending = this.pending.get(message.id);
		if (!pending) {
			return;
		}

		if (message.type === 'event') {
			pending.onEvent?.(message.event);
			return;
		}
		if (message.type === 'error') {
			this.pending.delete(message.id);
			pending.reject(new Error(message.error));
			return;
		}
		if (message.type === 'cancelled' || message.type === 'shutdownAck') {
			this.pending.delete(message.id);
			pending.resolve(undefined);
			return;
		}

		this.pending.delete(message.id);
		pending.resolve(message.result);
	}

	private rejectAllPending(error: Error): void {
		for (const [, pending] of this.pending) {
			pending.reject(error);
		}
		this.pending.clear();
	}
}
