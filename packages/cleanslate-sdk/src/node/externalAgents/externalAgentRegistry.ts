/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { createRequire } from 'module';
import { randomUUID } from 'crypto';
import { IExternalAgentDescriptor } from '../../externalAgents/externalAgentTypes.js';

export interface IExternalAgentLaunchConfiguration {
	readonly id: string;
	readonly name: string;
	readonly command: string;
	readonly nativeCommand?: string;
	readonly args: readonly string[];
	readonly env?: Readonly<NodeJS.ProcessEnv>;
	readonly iconPath?: string;
	readonly monochromeIcon?: boolean;
	readonly bundledModule?: string;
	readonly usageBundledModule?: string;
	readonly runAsNode?: boolean;
	/** How this adapter uses ACP agent_thought_chunk notifications. */
	readonly thoughtPresentation?: import('../../externalAgents/externalAgentTypes.js').ExternalAgentThoughtPresentation;
}

const agents: readonly IExternalAgentLaunchConfiguration[] = [
	{ id: 'opencode', name: 'OpenCode', command: 'opencode', args: ['acp'], iconPath: 'agent-opencode.svg' },
	{ id: 'grok', name: 'Grok', command: 'grok', args: ['--permission-mode', 'default', 'agent', '--no-leader', 'stdio'], iconPath: 'provider-xai.svg', monochromeIcon: true },
	{ id: 'claude', name: 'Claude', nativeCommand: 'claude', command: 'claude-agent-acp', args: [], bundledModule: '@agentclientprotocol/claude-agent-acp/dist/index.js', iconPath: 'provider-claude.svg', monochromeIcon: true },
	{
		id: 'codex', name: 'Codex', command: 'codex-acp', args: [], bundledModule: '@agentclientprotocol/codex-acp/dist/index.js', usageBundledModule: '@openai/codex/bin/codex.js', iconPath: 'provider-openai.svg', monochromeIcon: true, thoughtPresentation: 'summary'
	}
];

const moduleRequire = createRequire(import.meta.url);

export class ExternalAgentRegistry {
	constructor(private readonly configurationFile = path.join(homedir(), '.cleanslate', 'acp-agents.json'), private readonly moduleResolver: (id: string) => string = id => moduleRequire.resolve(id)) { }

	register(value: import('../../externalAgents/externalAgentTypes.js').IExternalAgentRegistration): void {
		if (!value || typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(value.id)
			|| typeof value.name !== 'string' || !value.name.trim() || typeof value.command !== 'string' || !value.command.trim()
			|| value.command.includes('\0') || !Array.isArray(value.args) || !value.args.every(arg => typeof arg === 'string' && !arg.includes('\0'))) {
			throw new Error('Enter an agent id, name, executable, and a valid argument list.');
		}
		if (this.entries().some(entry => entry.id === value.id)) { throw new Error('An agent with this id already exists.'); }
		let saved: unknown[] = [];
		try { saved = JSON.parse(fs.readFileSync(this.configurationFile, 'utf8')); }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; } }
		saved.push({ id: value.id, name: value.name.trim(), command: value.command.trim(), args: [...value.args] });
		fs.mkdirSync(path.dirname(this.configurationFile), { recursive: true, mode: 0o700 });
		const temporary = `${this.configurationFile}.${randomUUID()}.tmp`;
		try {
			fs.writeFileSync(temporary, `${JSON.stringify(saved, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
			fs.renameSync(temporary, this.configurationFile);
		} finally { if (fs.existsSync(temporary)) { fs.unlinkSync(temporary); } }
	}

	private entries(): readonly IExternalAgentLaunchConfiguration[] {
		let content: string;
		try { content = fs.readFileSync(this.configurationFile, 'utf8'); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return agents; }
			throw new Error('Unable to read the user ACP agent configuration.');
		}
		let values: unknown;
		try { values = JSON.parse(content); } catch { throw new Error('ACP agent configuration must contain valid JSON.'); }
		if (!Array.isArray(values)) { throw new Error('ACP agent configuration must be an array.'); }
		const entries = new Map(agents.map(agent => [agent.id, agent]));
		const seen = new Set<string>();
		for (const value of values) {
			if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(value.id)
				|| seen.has(value.id) || typeof value.name !== 'string' || !value.name.trim()
				|| typeof value.command !== 'string' || !value.command.trim() || value.command.includes('\0')
				|| !Array.isArray(value.args) || !value.args.every((arg: unknown) => typeof arg === 'string' && !arg.includes('\0'))) {
				throw new Error('Each ACP agent needs a unique id, name, command, and string argument array.');
			}
			seen.add(value.id);
			// Only this explicit user-level file can register commands; never read workspace launch configuration.
			entries.set(value.id, { id: value.id, name: value.name, command: value.command, args: [...value.args] });
		}
		return [...entries.values()];
	}

	get(agentId: string): IExternalAgentLaunchConfiguration {
		const entry = this.entries().find(candidate => candidate.id === agentId);
		if (!entry) {
			throw new Error(`Unknown external agent: ${agentId}`);
		}
		return entry;
	}

	list(env: NodeJS.ProcessEnv = process.env): IExternalAgentDescriptor[] {
		return this.entries().map(agent => {
			const nativeExecutable = agent.nativeCommand ? this.findExecutable(agent.nativeCommand, env.PATH) : undefined;
			const adapter = this.findExecutable(agent.command, env.PATH) ?? (agent.bundledModule ? this.resolveModule(agent.bundledModule) : undefined);
			const available = !!adapter && (!agent.nativeCommand || !!nativeExecutable);
			return {
				id: agent.id,
				name: agent.name,
				transport: 'acp',
				iconPath: agent.iconPath,
				monochromeIcon: agent.monochromeIcon,
				available,
				installed: available,
				unavailableReason: available ? undefined : agent.nativeCommand && !nativeExecutable
					? `${agent.nativeCommand} is not installed or is not available on PATH.`
					: `${agent.command} is not available on PATH.`
			};
		});
	}

	resolve(agentId: string, env: NodeJS.ProcessEnv = process.env): IExternalAgentLaunchConfiguration & { executable: string } {
		const entry = this.get(agentId);
		const nativeExecutable = entry.nativeCommand ? this.findExecutable(entry.nativeCommand, env.PATH) : undefined;
		if (entry.nativeCommand && !nativeExecutable) {
			throw new Error(`${entry.name} is not installed or is not available on PATH.`);
		}
		const executable = this.findExecutable(entry.command, env.PATH);
		if (!executable && entry.bundledModule) {
			const modulePath = this.resolveModule(entry.bundledModule);
			if (modulePath) {
				return {
					...entry,
					executable: process.execPath,
					args: [modulePath, ...entry.args],
					runAsNode: true,
					env: { ...entry.env, ...(env.PATH ? { PATH: env.PATH } : {}), ...(nativeExecutable ? { CLAUDE_CODE_EXECUTABLE: nativeExecutable } : {}) }
				};
			}
		}
		if (!executable) {
			throw new Error(`${entry.name} is not installed or is not available on PATH.`);
		}
		return { ...entry, executable, env: { ...entry.env, ...(env.PATH ? { PATH: env.PATH } : {}) } };
	}

	resolveUsage(agentId: string): { executable: string; args: readonly string[]; runAsNode: boolean } | undefined {
		const entry = this.get(agentId);
		if (!entry.usageBundledModule) { return undefined; }
		let modulePath = this.resolveModule(entry.usageBundledModule);
		if (!modulePath && entry.bundledModule) {
			const adapterPath = this.resolveModule(entry.bundledModule);
			if (adapterPath) {
				try { modulePath = createRequire(adapterPath).resolve(entry.usageBundledModule); } catch { }
			}
		}
		return modulePath ? { executable: process.execPath, args: [modulePath, 'app-server'], runAsNode: true } : undefined;
	}

	private resolveModule(moduleId: string): string | undefined {
		try { return this.moduleResolver(moduleId); } catch { return undefined; }
	}

	private findExecutable(command: string, pathValue: string | undefined): string | undefined {
		const candidates = path.isAbsolute(command) ? [command] : (pathValue ?? '').split(path.delimiter).filter(directory => path.isAbsolute(directory)).map(directory => path.join(directory, command));
		for (const candidate of candidates) {
			try {
				if (!fs.statSync(candidate).isFile()) { continue; }
				fs.accessSync(candidate, fs.constants.X_OK);
				return candidate;
			} catch { }
		}
		return undefined;
	}
}
