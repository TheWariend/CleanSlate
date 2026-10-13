/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getCleanSlateHome } from './config.js';

interface HostObserver {
	context(task?: string): Promise<string>;
	attach<T extends object>(runtime: T): T;
}

type HostMemoryModule = {
	CleanSlateHostMemory: new (config: string, state: string, report: () => void, workspaceRoot?: string) => HostObserver;
};

const ENTRY_POINTS = new Set(['run', 'plan', 'approvePlan', 'resumePendingQuestion']);

/**
 * Optional MuscleMemory procedural memory for the CLI. Off unless
 * CLEANSLATE_MUSCLEMEMORY_CONFIG names a private host config (from
 * `musclememory connect cleanslate`). No credentials enter the model's context, and
 * memory failures never stop the agent.
 */
export class CliProceduralMemory {
	private observer: HostObserver | undefined;
	private loading: Promise<void> | undefined;
	private readonly configFile = process.env.CLEANSLATE_MUSCLEMEMORY_CONFIG;

	constructor(private readonly workspaceRoot: string, private readonly report: () => void = () => { }) { }

	get enabled(): boolean {
		return Boolean(this.configFile);
	}

	/** The short note MuscleMemory hands over for this task, or ''. */
	context(task: string): Promise<string> {
		return this.observer?.context(task).catch(() => '') ?? Promise.resolve('');
	}

	private load(): Promise<void> {
		return this.loading ??= (async () => {
			if (!this.configFile) {
				return;
			}
			const moduleName = process.env.CLEANSLATE_MUSCLEMEMORY_NODE_MODULE ?? '@thewariend/musclememory/node';
			const sdk = await import(path.isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName) as HostMemoryModule;
			const state = process.env.CLEANSLATE_MUSCLEMEMORY_STATE ?? path.join(getCleanSlateHome(), 'musclememory-private');
			this.observer = new sdk.CleanSlateHostMemory(this.configFile, state, this.report, this.workspaceRoot);
		})().catch(() => { this.report(); });
	}

	/** Observe each run; every other runtime method is passed through unchanged. */
	attach<T extends object>(runtime: T): T {
		if (!this.configFile) {
			return runtime;
		}
		const memory = this;
		return new Proxy(runtime, {
			get(target, property) {
				const value = Reflect.get(target, property, target);
				if (typeof value !== 'function') {
					return value;
				}
				if (!ENTRY_POINTS.has(String(property))) {
					return value.bind(target);
				}
				return async function* (...args: unknown[]): AsyncGenerator<unknown> {
					await memory.load();
					const observed = memory.observer?.attach(target) ?? target;
					const method = Reflect.get(observed, property) as (...input: unknown[]) => AsyncIterable<unknown>;
					yield* Reflect.apply(method, observed, args);
				};
			}
		});
	}
}

/** Project context and MuscleMemory's note, together. */
export async function withMemory(projectContext: string, memory: CliProceduralMemory, task: string): Promise<string> {
	const note = await memory.context(task);
	return [projectContext, note].filter(Boolean).join('\n\n');
}
