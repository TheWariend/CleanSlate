/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CleanSlateStreamPart } from './cleanSlateAgentTypes.js';

/** The first stable CleanSlate agent extension contract. */
export const CLEANSLATE_AGENT_EXTENSION_API_VERSION = 1 as const;

export type CleanSlateAgentExtensionPermission = 'context:read' | 'stream:read';
export type CleanSlateAgentRunEntryPoint = 'run' | 'plan' | 'approvePlan' | 'resumePendingQuestion';

export interface ICleanSlateAgentExtensionRun {
	readonly sessionId: string;
	readonly runId: string;
	readonly entryPoint: CleanSlateAgentRunEntryPoint;
	readonly task: string;
	readonly startedAt: number;
}

export interface ICleanSlateAgentExtensionV1 {
	readonly apiVersion: 1;
	readonly id: string;
	readonly permissions: readonly CleanSlateAgentExtensionPermission[];
	provideContext?(run: Readonly<ICleanSlateAgentExtensionRun>): string | undefined | Promise<string | undefined>;
	onRunStart?(run: Readonly<ICleanSlateAgentExtensionRun>): void | Promise<void>;
	onStreamPart?(run: Readonly<ICleanSlateAgentExtensionRun>, part: Readonly<CleanSlateStreamPart>): void | Promise<void>;
	onRunEnd?(run: Readonly<ICleanSlateAgentExtensionRun>, outcome: Readonly<ICleanSlateAgentExtensionRunOutcome>): void | Promise<void>;
}

export interface ICleanSlateAgentExtensionRunOutcome {
	readonly status: 'completed' | 'cancelled' | 'failed';
	readonly endedAt: number;
	readonly error?: string;
}

export interface ICleanSlateAgentExtensionHostOptions {
	/** Grants are host-owned and should come from explicit user/admin consent. */
	readonly grantedPermissions: Readonly<Record<string, readonly CleanSlateAgentExtensionPermission[]>>;
	/** Extension failures are isolated from the agent and reported here. */
	readonly onError?: (error: Readonly<{ extensionId: string; hook: string; error: unknown }>) => void;
}

/**
 * Runs trusted, in-process extensions behind an explicit capability grant.
 * Stream hooks are awaited in order, begin before the first part, and always end once.
 */
export class CleanSlateAgentExtensionHost {
	private readonly extensions: readonly ICleanSlateAgentExtensionV1[];
	private readonly grants: Readonly<Record<string, readonly CleanSlateAgentExtensionPermission[]>>;

	constructor(extensions: readonly ICleanSlateAgentExtensionV1[], private readonly options: ICleanSlateAgentExtensionHostOptions) {
		const ids = new Set<string>();
		for (const extension of extensions) {
			if (extension.apiVersion !== CLEANSLATE_AGENT_EXTENSION_API_VERSION) {
				throw new Error(`Unsupported CleanSlate agent extension API version: ${String(extension.apiVersion)}`);
			}
			if (!extension.id.trim() || ids.has(extension.id)) {
				throw new Error(`Agent extension IDs must be non-empty and unique: ${extension.id}`);
			}
			ids.add(extension.id);
		}
		this.extensions = [...extensions];
		this.grants = options.grantedPermissions;
	}

	async provideContext(run: Readonly<ICleanSlateAgentExtensionRun>): Promise<string> {
		const context: string[] = [];
		for (const extension of this.extensions) {
			if (!this.allowed(extension, 'context:read') || !extension.provideContext) {
				continue;
			}
			const value = await this.invoke(extension, 'provideContext', () => extension.provideContext!(run));
			if (typeof value === 'string' && value.trim()) {
				context.push(value.trim());
			}
		}
		return context.join('\n\n');
	}

	async start(run: Readonly<ICleanSlateAgentExtensionRun>): Promise<void> {
		for (const extension of this.extensions) {
			if (this.allowed(extension, 'stream:read') && extension.onRunStart) {
				await this.invoke(extension, 'onRunStart', () => extension.onRunStart!(run));
			}
		}
	}

	async stream(run: Readonly<ICleanSlateAgentExtensionRun>, part: Readonly<CleanSlateStreamPart>): Promise<void> {
		for (const extension of this.extensions) {
			if (this.allowed(extension, 'stream:read') && extension.onStreamPart) {
				await this.invoke(extension, 'onStreamPart', () => extension.onStreamPart!(run, part));
			}
		}
	}

	async end(run: Readonly<ICleanSlateAgentExtensionRun>, outcome: Readonly<ICleanSlateAgentExtensionRunOutcome>): Promise<void> {
		for (const extension of this.extensions) {
			if (this.allowed(extension, 'stream:read') && extension.onRunEnd) {
				await this.invoke(extension, 'onRunEnd', () => extension.onRunEnd!(run, outcome));
			}
		}
	}

	private allowed(extension: ICleanSlateAgentExtensionV1, permission: CleanSlateAgentExtensionPermission): boolean {
		return extension.permissions.includes(permission) && (this.grants[extension.id] ?? []).includes(permission);
	}

	private async invoke<T>(extension: ICleanSlateAgentExtensionV1, hook: string, callback: () => T | Promise<T>): Promise<T | undefined> {
		try {
			return await callback();
		} catch (error) {
			this.options.onError?.({ extensionId: extension.id, hook, error });
			return undefined;
		}
	}
}
