/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createCleanSlateNodeToolContext, ICleanSlateNodeRuntimeOptions } from './cleanSlateNodeToolContext.js';

/**
 * A tool as the runner needs it. Structural on purpose: the registry lives in
 * the workbench layer, which this file may not import, so the caller supplies
 * the tools instead.
 */
export interface ICleanSlateHeadlessTool {
	name: string;
	description: string;
	category?: string;
	parametersSchema?: Record<string, any>;
	run(input: any, context: any): Promise<any>;
}

export interface ICleanSlateHeadlessRunOptions extends ICleanSlateNodeRuntimeOptions {
	/** The tool registry, passed in by whoever owns it. */
	tools: readonly ICleanSlateHeadlessTool[];
	/** Streams model turns. Supplied by the caller so a test can script it. */
	cleanSlateService: any;
	/** Extra services the agent loop needs that the context does not carry. */
	contextService?: any;
	/** Host-owned policy gate evaluated before a native tool runs. */
	approveTool?: (request: { toolName: string; category?: string; input: unknown }) => boolean | Promise<boolean>;
}

export interface ICleanSlateHeadlessRunResult {
	toolCalls: { toolName: string; input: any; ok: boolean }[];
	filesTouched: string[];
}

/**
 * Runs tools against a headless context.
 *
 * This is the seam the CLI and any server front-end share: build a context
 * rooted at a directory, expose the registry over it, and let the loop drive.
 * The agent loop itself is constructed by the caller, because it lives in a
 * layer this file cannot reach.
 */
export class CleanSlateHeadlessRuntime {

	private readonly context: any;
	private readonly toolsByName = new Map<string, ICleanSlateHeadlessTool>();
	private readonly calls: { toolName: string; input: any; ok: boolean }[] = [];
	private readonly touched = new Set<string>();

	constructor(private readonly options: ICleanSlateHeadlessRunOptions) {
		this.context = createCleanSlateNodeToolContext(options);
		for (const tool of options.tools) {
			this.toolsByName.set(tool.name, tool);
		}
	}

	/** The assembled context, for a caller that wants to drive the loop itself. */
	getToolContext(): any {
		return this.context;
	}

	getToolCategory(toolName: string): string | undefined {
		return this.toolsByName.get(toolName)?.category;
	}

	getTools(): readonly ICleanSlateHeadlessTool[] {
		return this.options.tools;
	}

	/**
	 * Executes one tool and yields the result in the shape the loop consumes.
	 * A throwing tool becomes a failed result rather than an exception, because
	 * the loop is built to hand failures back to the model and let it retry.
	 */
	async *executeTool(toolName: string, input: any, toolCallId?: string, signal?: AbortSignal): AsyncIterable<any> {
		const tool = this.toolsByName.get(toolName);
		if (!tool) {
			this.calls.push({ toolName, input, ok: false });
			yield {
				type: 'tool_result',
				toolName,
				toolCallId,
				result: { success: false, error: `Unknown tool: ${toolName}` }
			};
			return;
		}
		if (this.options.approveTool && !await this.options.approveTool({ toolName, category: tool.category, input })) {
			this.calls.push({ toolName, input, ok: false });
			yield {
				type: 'tool_result',
				toolName,
				toolCallId,
				result: { success: false, code: 'permission_denied', error: `Permission denied for ${toolName}.` }
			};
			return;
		}

		let result: any;
		try {
			result = await tool.run(input, { ...this.context, signal });
		} catch (error) {
			result = {
				success: false,
				error: error instanceof Error ? error.message : String(error)
			};
		}

		const ok = result?.success !== false;
		this.calls.push({ toolName, input, ok });
		const touchedPath = input?.file_path ?? input?.path;
		if (ok && typeof touchedPath === 'string') {
			this.touched.add(touchedPath);
		}

		yield { type: 'tool_result', toolName, toolCallId, result };
	}

	getResult(): ICleanSlateHeadlessRunResult {
		return { toolCalls: [...this.calls], filesTouched: [...this.touched] };
	}
}
