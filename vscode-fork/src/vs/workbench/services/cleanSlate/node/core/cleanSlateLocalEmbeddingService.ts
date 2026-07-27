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
import { INativeEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { ICleanSlateLocalEmbeddingOptions, ICleanSlateLocalEmbeddingResponse } from '../../common/core/cleanSlateAI.js';
import type { CleanSlateLocalEmbeddingRequest, CleanSlateLocalEmbeddingResponseMessage } from './cleanSlateLocalEmbeddingProtocol.js';

interface IPendingEmbeddingRequest {
	resolve: (value: ICleanSlateLocalEmbeddingResponse | undefined) => void;
	reject: (error: Error) => void;
	timer: any;
}

export class CleanSlateLocalEmbeddingService {

	static readonly DEFAULT_MODEL = 'Xenova/bge-small-en-v1.5';
	private static readonly REQUEST_TIMEOUT_MS = 60_000;
	private static readonly MAX_BATCH_SIZE = 4;
	private static readonly MAX_WORKER_RECOVERY_ATTEMPTS = 2;

	private process: cp.ChildProcessWithoutNullStreams | undefined;
	private nextRequestId = 1;
	private readonly pending = new Map<number, IPendingEmbeddingRequest>();
	private stderr = '';
	private healthCheck: Promise<void> | undefined;

	constructor(
		private readonly environmentService: INativeEnvironmentService,
		private readonly logService: ILogService
	) { }

	async embed(options: ICleanSlateLocalEmbeddingOptions, token: CancellationToken): Promise<ICleanSlateLocalEmbeddingResponse> {
		const model = this.normalizeModelName(options.model);
		const texts = options.texts.filter(text => typeof text === 'string');
		if (texts.length !== options.texts.length) {
			throw new Error('Local embeddings require every input to be text.');
		}
		if (texts.length === 0) {
			return { model, dimensions: 0, embeddings: [] };
		}

		const embeddings: number[][] = [];
		let dimensions = 0;
		for (let index = 0; index < texts.length; index += CleanSlateLocalEmbeddingService.MAX_BATCH_SIZE) {
			this.throwIfCancelled(token);
			const batch = texts.slice(index, index + CleanSlateLocalEmbeddingService.MAX_BATCH_SIZE);
			const response = await this.sendBatchWithRecovery(model, options, batch, token);
			if (!response) {
				throw new Error('Local embedding worker returned no response.');
			}
			dimensions = response.dimensions;
			embeddings.push(...response.embeddings);
		}

		return { model, dimensions, embeddings };
	}

	private async sendBatchWithRecovery(
		model: string,
		options: ICleanSlateLocalEmbeddingOptions,
		texts: string[],
		token: CancellationToken
	): Promise<ICleanSlateLocalEmbeddingResponse | undefined> {
		let lastError: unknown;
		for (let attempt = 0; attempt <= CleanSlateLocalEmbeddingService.MAX_WORKER_RECOVERY_ATTEMPTS; attempt++) {
			this.throwIfCancelled(token);
			try {
				await this.ensureHealthy(model, token);
				this.throwIfCancelled(token);
				return await this.send({
					id: this.nextRequestId++,
					type: 'embed',
					appRoot: this.environmentService.appRoot,
					options: {
						...options,
						model,
						texts
					}
				}, token);
			} catch (error) {
				lastError = error;
				if (!this.isRecoverableWorkerError(error) || attempt >= CleanSlateLocalEmbeddingService.MAX_WORKER_RECOVERY_ATTEMPTS) {
					throw error;
				}
				this.logService.warn(`[CleanSlateLocalEmbeddingWorker] Recovering after worker failure; restarting local embedding worker (attempt ${attempt + 1}/${CleanSlateLocalEmbeddingService.MAX_WORKER_RECOVERY_ATTEMPTS}). ${error instanceof Error ? error.message : String(error)}`);
				this.restartWorkerAfterFailure();
				await this.delay(250 * (attempt + 1));
			}
		}
		throw lastError instanceof Error ? lastError : new Error(String(lastError));
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
				// The worker may already be gone.
			}
			setTimeout(() => {
				if (!process.killed && process.exitCode === null) {
					process.kill('SIGTERM');
				}
			}, 250);
		}
		this.rejectAllPending(new Error('CleanSlate local embedding worker was disposed.'));
	}

	private async ensureHealthy(model: string, token: CancellationToken): Promise<void> {
		if (!this.healthCheck) {
			this.healthCheck = this.send({
				id: this.nextRequestId++,
				type: 'embed',
				appRoot: this.environmentService.appRoot,
				options: {
					model,
					texts: ['CleanSlate local embedding health check'],
					maxTokens: 32
				}
			}, token).then(response => {
				if (!response || response.dimensions !== 384 || response.embeddings.length !== 1) {
					throw new Error(`Local embedding health check returned invalid dimensions: ${response?.dimensions ?? 'none'}.`);
				}
			}).catch(error => {
				this.healthCheck = undefined;
				this.disposeWorkerAfterFailure();
				throw error;
			});
		}
		await this.healthCheck;
	}

	private normalizeModelName(model: string | undefined): string {
		const normalized = (model || CleanSlateLocalEmbeddingService.DEFAULT_MODEL).trim();
		if (normalized !== CleanSlateLocalEmbeddingService.DEFAULT_MODEL) {
			throw new Error(`Unsupported local embedding model "${normalized}". Bundled default is ${CleanSlateLocalEmbeddingService.DEFAULT_MODEL}.`);
		}
		return normalized;
	}

	private send(request: CleanSlateLocalEmbeddingRequest, token: CancellationToken): Promise<ICleanSlateLocalEmbeddingResponse | undefined> {
		this.throwIfCancelled(token);
		const process = this.ensureProcess();

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(request.id);
				reject(new Error(`CleanSlate local embedding worker timed out after ${CleanSlateLocalEmbeddingService.REQUEST_TIMEOUT_MS}ms.`));
			}, CleanSlateLocalEmbeddingService.REQUEST_TIMEOUT_MS);

			this.pending.set(request.id, { resolve, reject, timer });
			const cancellation = token.onCancellationRequested(() => {
				clearTimeout(timer);
				this.pending.delete(request.id);
				cancellation.dispose();
				reject(new Error('Local embedding request cancelled.'));
			});

			try {
				this.write(request, process);
			} catch (error) {
				clearTimeout(timer);
				cancellation.dispose();
				this.pending.delete(request.id);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	private ensureProcess(): cp.ChildProcessWithoutNullStreams {
		if (this.process && this.process.exitCode === null && !this.process.killed) {
			return this.process;
		}

		const modulePath = this.resolveWorkerProcessModulePath();
		const child = cp.spawn(process.execPath, [modulePath], {
			stdio: ['pipe', 'pipe', 'pipe'],
			env: {
				...process.env,
				ELECTRON_RUN_AS_NODE: '1',
				ORT_LOG_SEVERITY_LEVEL: '3'
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
				this.logService.info(`[CleanSlateLocalEmbeddingWorker] ${text}`);
			}
		});
		child.on('error', error => {
			this.process = undefined;
			this.healthCheck = undefined;
			this.rejectAllPending(error);
		});
		child.on('exit', (code, signal) => {
			this.process = undefined;
			this.healthCheck = undefined;
			reader.close();
			if (this.pending.size > 0) {
				const detail = this.stderr ? `\n${this.stderr}` : '';
				this.rejectAllPending(new Error(`CleanSlate local embedding worker exited (${signal ?? code ?? 'unknown'}).${detail}`));
			}
		});
		return child;
	}

	private resolveWorkerProcessModulePath(): string {
		const moduleName = 'cleanSlateLocalEmbeddingWorkerProcess.js';
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

	private write(request: CleanSlateLocalEmbeddingRequest, child: cp.ChildProcessWithoutNullStreams): void {
		child.stdin.write(`${JSON.stringify(request)}\n`);
	}

	private handleLine(line: string): void {
		const trimmed = line.trim();
		if (!trimmed) {
			return;
		}
		let message: CleanSlateLocalEmbeddingResponseMessage;
		try {
			message = JSON.parse(trimmed);
		} catch (error) {
			this.logService.warn(`[CleanSlateLocalEmbeddingWorker] Invalid response JSON: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}

		const pending = this.pending.get(message.id);
		if (!pending) {
			return;
		}

		clearTimeout(pending.timer);
		this.pending.delete(message.id);

		if (message.type === 'error') {
			pending.reject(new Error(message.error));
			return;
		}
		if (message.type === 'shutdownAck') {
			pending.resolve(undefined);
			return;
		}
		pending.resolve(message.result);
	}

	private disposeWorkerAfterFailure(): void {
		const process = this.process;
		this.process = undefined;
		if (process && !process.killed && process.exitCode === null) {
			process.kill('SIGTERM');
		}
	}

	private restartWorkerAfterFailure(): void {
		this.healthCheck = undefined;
		this.disposeWorkerAfterFailure();
	}

	private isRecoverableWorkerError(error: unknown): boolean {
		const message = error instanceof Error ? error.message : String(error);
		return message.includes('CleanSlate local embedding worker exited')
			|| message.includes('CleanSlate local embedding worker timed out')
			|| message.includes('Local embedding worker returned no response')
			|| message.includes('write EPIPE')
			|| message.includes('EPIPE')
			|| message.includes('ECONNRESET');
	}

	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	private rejectAllPending(error: Error): void {
		for (const [, pending] of this.pending) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
	}

	private throwIfCancelled(token: CancellationToken): void {
		if (token.isCancellationRequested) {
			throw new Error('Local embedding request cancelled.');
		}
	}
}
