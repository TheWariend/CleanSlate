/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AsyncQueue, CleanSlateStreamPart, ParsedToolCall } from './cleanSlateAgentTypes.js';

export interface ICleanSlateStreamingToolExecution {
	toolCall: ParsedToolCall;
	index: number;
	parts: CleanSlateStreamPart[];
	result: any;
}

export interface ICleanSlateStreamingToolPartBatch {
	toolCall: ParsedToolCall;
	index: number;
	parts: CleanSlateStreamPart[];
}

export type CleanSlateStreamingToolEvent =
	| { type: 'parts'; batch: ICleanSlateStreamingToolPartBatch }
	| { type: 'execution'; execution: ICleanSlateStreamingToolExecution };

type StreamingToolStatus = 'queued' | 'executing' | 'completed' | 'yielded';

interface ITrackedStreamingTool {
	toolCall: ParsedToolCall;
	index: number;
	status: StreamingToolStatus;
	isConcurrencySafe: boolean;
	parts: CleanSlateStreamPart[];
	yieldedPartCount: number;
	result: any;
}

export interface ICleanSlateStreamingToolExecutorOptions {
	isConcurrencySafe: (toolCall: ParsedToolCall) => boolean;
	executeTool: (toolCall: ParsedToolCall, signal?: AbortSignal) => AsyncIterable<CleanSlateStreamPart>;
	signal?: AbortSignal;
	emitAbortedResults?: boolean;
}

/**
 * Orders streamed tool parts while allowing explicitly safe tools to execute in parallel.
 * Phase policy and tool validation remain the caller's responsibility.
 */
export class CleanSlateStreamingToolExecutor {
	private readonly tools: ITrackedStreamingTool[] = [];
	private readonly wakeQueue = new AsyncQueue<void>();

	constructor(private readonly options: ICleanSlateStreamingToolExecutorOptions) { }

	public addTool(toolCall: ParsedToolCall, index: number): void {
		this.tools.push({
			toolCall,
			index,
			status: 'queued',
			isConcurrencySafe: this.options.isConcurrencySafe(toolCall),
			parts: [],
			yieldedPartCount: 0,
			result: undefined
		});
		void this.processQueue();
	}

	public * getReadyPartBatches(): Iterable<ICleanSlateStreamingToolPartBatch> {
		for (const tool of this.tools) {
			if (tool.status === 'yielded' || tool.yieldedPartCount >= tool.parts.length) {
				continue;
			}

			const parts = tool.parts.slice(tool.yieldedPartCount);
			tool.yieldedPartCount = tool.parts.length;
			yield { toolCall: tool.toolCall, index: tool.index, parts };

			if (tool.status === 'executing' && !tool.isConcurrencySafe) {
				break;
			}
		}
	}

	public * getCompletedResults(): Iterable<ICleanSlateStreamingToolExecution> {
		for (const tool of this.tools) {
			if (tool.status === 'yielded') {
				continue;
			}
			if (tool.status === 'completed') {
				tool.status = 'yielded';
				yield this.toExecution(tool);
				continue;
			}
			if (tool.status === 'executing' && !tool.isConcurrencySafe) {
				break;
			}
		}
	}

	public hasUnfinishedWork(): boolean {
		return this.hasUnfinishedTools();
	}

	public async nextEvent(): Promise<CleanSlateStreamingToolEvent | undefined> {
		while (this.hasUnfinishedTools() && !this.options.signal?.aborted) {
			await this.processQueue();
			for (const batch of this.getReadyPartBatches()) {
				return { type: 'parts', batch };
			}
			for (const execution of this.getCompletedResults()) {
				return { type: 'execution', execution };
			}
			if (this.hasExecutingTools()) {
				await this.wakeQueue.next();
			} else {
				break;
			}
		}

		for (const batch of this.getReadyPartBatches()) {
			return { type: 'parts', batch };
		}
		for (const execution of this.getCompletedResults()) {
			return { type: 'execution', execution };
		}
		return undefined;
	}

	public async * getRemainingEvents(): AsyncIterable<CleanSlateStreamingToolEvent> {
		while (this.hasUnfinishedTools() && !this.options.signal?.aborted) {
			await this.processQueue();
			let yielded = false;
			for (const batch of this.getReadyPartBatches()) {
				yielded = true;
				yield { type: 'parts', batch };
			}
			for (const execution of this.getCompletedResults()) {
				yielded = true;
				yield { type: 'execution', execution };
			}
			if (!yielded && this.hasExecutingTools()) {
				await this.wakeQueue.next();
			} else if (!yielded) {
				break;
			}
		}

		for (const batch of this.getReadyPartBatches()) {
			yield { type: 'parts', batch };
		}
		for (const execution of this.getCompletedResults()) {
			yield { type: 'execution', execution };
		}
	}

	public async * getRemainingResults(): AsyncIterable<ICleanSlateStreamingToolExecution> {
		while (this.hasUnfinishedTools() && !this.options.signal?.aborted) {
			await this.processQueue();
			let yielded = false;
			for (const execution of this.getCompletedResults()) {
				yielded = true;
				yield execution;
			}
			if (!yielded && this.hasExecutingTools()) {
				await this.wakeQueue.next();
			} else if (!yielded) {
				break;
			}
		}

		if (this.options.signal?.aborted && this.options.emitAbortedResults) {
			for (const tool of this.tools) {
				if (tool.status === 'yielded') {
					continue;
				}
				if (!tool.result) {
					tool.result = {
						success: false,
						code: 'tool_execution_aborted',
						message: 'Tool execution was aborted before a result was produced.'
					};
					tool.parts.push({ type: 'tool_result', toolName: tool.toolCall.toolName, result: tool.result });
				}
				tool.status = 'yielded';
				yield this.toExecution(tool);
			}
			return;
		}

		for (const execution of this.getCompletedResults()) {
			yield execution;
		}
	}

	private async processQueue(): Promise<void> {
		for (const tool of this.tools) {
			if (this.options.signal?.aborted) {
				return;
			}
			if (tool.status !== 'queued') {
				continue;
			}
			if (!this.canExecuteTool(tool.isConcurrencySafe)) {
				if (!tool.isConcurrencySafe) {
					break;
				}
				continue;
			}
			this.startTool(tool);
		}
	}

	private startTool(tool: ITrackedStreamingTool): void {
		tool.status = 'executing';
		this.collectToolParts(tool)
			.catch(error => {
				const result = { success: false, error: error instanceof Error ? error.message : String(error) };
				tool.parts.push({ type: 'tool_result', toolName: tool.toolCall.toolName, result });
				tool.result = result;
			})
			.finally(() => {
				if (tool.status !== 'yielded') {
					tool.status = 'completed';
				}
				this.wakeQueue.push(undefined);
				void this.processQueue();
			});
	}

	private async collectToolParts(tool: ITrackedStreamingTool): Promise<void> {
		for await (const part of this.options.executeTool(tool.toolCall, this.options.signal)) {
			if (this.options.signal?.aborted) {
				break;
			}
			tool.parts.push(part);
			if (part.type === 'tool_result') {
				tool.result = part.result;
			}
			this.wakeQueue.push(undefined);
		}
	}

	/**
	 * A tool may start when nothing is in flight, or when it and everything
	 * already running are all safe to overlap. One unsafe tool anywhere in the
	 * set serializes the whole queue.
	 */
	private canExecuteTool(isConcurrencySafe: boolean): boolean {
		if (!isConcurrencySafe) {
			return !this.hasExecutingTools();
		}
		return this.tools.every(tool => tool.status !== 'executing' || tool.isConcurrencySafe);
	}

	private hasExecutingTools(): boolean {
		return this.tools.some(tool => tool.status === 'executing');
	}

	private hasUnfinishedTools(): boolean {
		return this.tools.some(tool => tool.status !== 'yielded');
	}

	private toExecution(tool: ITrackedStreamingTool): ICleanSlateStreamingToolExecution {
		const parts = tool.parts.slice(tool.yieldedPartCount);
		tool.yieldedPartCount = tool.parts.length;
		return { toolCall: tool.toolCall, index: tool.index, parts, result: tool.result };
	}
}
