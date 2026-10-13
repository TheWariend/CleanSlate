/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { pathToFileURL } from 'url';
import type { HostedAgentRuntime } from '@cleanslate/sdk/node/cleanSlateHostedAgentRuntime.js';
import type { CleanSlateStreamPart } from '@cleanslate/sdk/agent/cleanSlateAgentTypes.js';

interface HostObserver {
    context(task?: string): Promise<string>;
    attach<T extends object>(runtime: T): T;
}

/** Opt-in, trusted host environment only. No credentials enter model configuration. */
export class CleanSlateProceduralMemory {
    private observer: HostObserver | undefined;
    private loading: Promise<void> | undefined;
    private readonly configFile = process.env.CLEANSLATE_MUSCLEMEMORY_CONFIG;

    /** `workspaceRoot` lets MuscleMemory see code changed from the terminal (via git status). */
    constructor(private readonly stateRoot: string, private readonly report: () => void, private readonly workspaceRoot?: string) { }

    context(task: string): Promise<string> {
        return this.observer?.context(task) ?? Promise.resolve('');
    }

    private load(): Promise<void> {
        return this.loading ??= (async () => {
            if (!this.configFile) { return; }
            const moduleName = process.env.CLEANSLATE_MUSCLEMEMORY_NODE_MODULE ?? 'musclememory/node';
            const sdk = await import(path.isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName) as {
                CleanSlateHostMemory: new (config: string, state: string, report: () => void, workspaceRoot?: string) => HostObserver;
            };
            this.observer = new sdk.CleanSlateHostMemory(this.configFile, this.stateRoot, this.report, this.workspaceRoot);
        })().catch(() => { this.report(); });
    }

    attach(runtime: HostedAgentRuntime): HostedAgentRuntime {
        if (!this.configFile) { return runtime; }
        const memory = this;
        const entries = new Set(['run', 'plan', 'approvePlan', 'resumePendingQuestion']);
        return new Proxy(runtime, { get(target, property) {
            const value = Reflect.get(target, property, target);
            if (typeof value !== 'function') { return value; }
            if (!entries.has(String(property))) { return value.bind(target); }
            return async function* (...args: unknown[]): AsyncIterable<CleanSlateStreamPart> {
                await memory.load();
                const observed = memory.observer?.attach(runtime) ?? runtime;
                yield* Reflect.apply(Reflect.get(observed, property), observed, args) as AsyncIterable<CleanSlateStreamPart>;
            };
        } });
    }
}
