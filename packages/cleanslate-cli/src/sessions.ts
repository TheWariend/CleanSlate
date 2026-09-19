/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { ICleanSlateNodeAgentSessionSnapshot } from '@cleanslate/sdk/node';
import { getCleanSlateHome } from './config.js';

export type CliTranscriptKind = 'user' | 'assistant' | 'reasoning' | 'tool' | 'system' | 'error';

export interface ICliTranscriptEntry {
	id: string;
	kind: CliTranscriptKind;
	content: string;
	timestamp: number;
	durationMs?: number;
	status?: 'running' | 'completed' | 'failed' | 'cancelled';
	toolName?: string;
	detail?: unknown;
}

export interface ICliSession {
	version: 1;
	id: string;
	title: string;
	workspace: string;
	createdAt: number;
	updatedAt: number;
	provider: string;
	model: string;
	transcript: ICliTranscriptEntry[];
	runtimeSnapshot?: ICleanSlateNodeAgentSessionSnapshot;
}

function sessionId(): string {
	const timestamp = Date.now().toString(36);
	return `${timestamp}-${crypto.randomBytes(5).toString('hex')}`;
}

function workspaceKey(workspace: string): string {
	return crypto.createHash('sha256').update(path.resolve(workspace)).digest('hex').slice(0, 16);
}

function safeSessionId(value: string): string {
	if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
		throw new Error(`Invalid session id: ${value}`);
	}
	return value;
}

export class CliSessionStore {
	private readonly directory: string;
	private static readonly lockRetryDelayMs = 10;
	private static readonly lockTimeoutMs = 5_000;
	private static readonly staleLockMs = 30_000;

	constructor(readonly workspace: string, homePath: string = getCleanSlateHome()) {
		this.workspace = path.resolve(workspace);
		this.directory = path.join(homePath, 'sessions', workspaceKey(this.workspace));
	}

	create(provider: string, model: string, initialTask?: string): ICliSession {
		const now = Date.now();
		return {
			version: 1,
			id: sessionId(),
			title: this.titleFromTask(initialTask),
			workspace: this.workspace,
			createdAt: now,
			updatedAt: now,
			provider,
			model,
			transcript: []
		};
	}

	save(session: ICliSession): void {
		if (path.resolve(session.workspace) !== this.workspace) {
			throw new Error('Cannot save a session for a different workspace.');
		}
		fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
		const target = this.sessionPath(session.id);
		this.withSessionLock(target, () => {
			const temporary = `${target}.${process.pid}.tmp`;
			session.updatedAt = Date.now();
			const value = { ...session, version: 1 as const };
			fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
			fs.renameSync(temporary, target);
		});
	}

	load(id: string): ICliSession | undefined {
		try {
			const value = JSON.parse(fs.readFileSync(this.sessionPath(id), 'utf8'));
			return this.isSession(value) ? value : undefined;
		} catch {
			return undefined;
		}
	}

	latest(): ICliSession | undefined {
		return this.list()[0];
	}

	list(): ICliSession[] {
		try {
			return fs.readdirSync(this.directory)
				.filter(name => name.endsWith('.json'))
				.flatMap(name => {
					try {
						const value = JSON.parse(fs.readFileSync(path.join(this.directory, name), 'utf8'));
						return this.isSession(value) ? [value] : [];
					} catch {
						return [];
					}
				})
				.sort((a, b) => b.updatedAt - a.updatedAt);
		} catch {
			return [];
		}
	}

	delete(id: string): boolean {
		try {
			fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
			const target = this.sessionPath(id);
			return this.withSessionLock(target, () => {
				try {
					fs.unlinkSync(target);
					return true;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
						return false;
					}
					throw error;
				}
			});
		} catch {
			return false;
		}
	}

	private withSessionLock<T>(target: string, operation: () => T): T {
		const lockPath = `${target}.lock`;
		const deadline = Date.now() + CliSessionStore.lockTimeoutMs;
		while (true) {
			try {
				fs.mkdirSync(lockPath, { mode: 0o700 });
				break;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
					throw error;
				}
				try {
					const age = Date.now() - fs.statSync(lockPath).mtimeMs;
					if (age > CliSessionStore.staleLockMs) {
						fs.rmdirSync(lockPath);
						continue;
					}
				} catch (lockError) {
					if ((lockError as NodeJS.ErrnoException).code === 'ENOENT') {
						continue;
					}
				}
				if (Date.now() >= deadline) {
					throw new Error(`Timed out waiting to update session ${path.basename(target, '.json')}.`);
				}
				Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, CliSessionStore.lockRetryDelayMs);
			}
		}

		try {
			return operation();
		} finally {
			try {
				fs.rmdirSync(lockPath);
			} catch {
				// A stale-lock recovery may already have removed it.
			}
		}
	}

	private sessionPath(id: string): string {
		return path.join(this.directory, `${safeSessionId(id)}.json`);
	}

	private titleFromTask(task?: string): string {
		const title = task?.trim().replace(/\s+/g, ' ');
		if (!title) {
			return 'New session';
		}
		return title.length <= 72 ? title : `${title.slice(0, 69)}…`;
	}

	private isSession(value: any): value is ICliSession {
		return value?.version === 1
			&& typeof value.id === 'string'
			&& typeof value.title === 'string'
			&& typeof value.workspace === 'string'
			&& path.resolve(value.workspace) === this.workspace
			&& typeof value.createdAt === 'number'
			&& typeof value.updatedAt === 'number'
			&& Array.isArray(value.transcript);
	}
}

export function transcriptEntry(kind: CliTranscriptKind, content: string, extra: Partial<ICliTranscriptEntry> = {}): ICliTranscriptEntry {
	const entry: ICliTranscriptEntry = {
		id: `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`,
		kind,
		content,
		timestamp: Date.now()
	};
	for (const [key, value] of Object.entries(extra)) {
		if (value !== undefined) {
			(entry as any)[key] = value;
		}
	}
	return entry;
}
