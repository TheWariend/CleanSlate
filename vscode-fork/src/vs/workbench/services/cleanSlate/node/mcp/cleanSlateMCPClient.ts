/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMCPClientService, MCPTool } from '../../common/core/cleanSlateAI.js';
import { CleanSlateStdioTransport, IMCPTransport } from './cleanSlateMCPTransport.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { parse as parseJson, ParseError } from '../../../../../base/common/json.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IEnvironmentService, INativeEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import type { Dirent } from 'fs';
import { readFile, readdir } from 'fs/promises';
import { dirname, join, normalize } from 'path';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../../base/common/errors.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';

interface MCPServerDefinition {
    name: string;
    command: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
    source: string;
}

interface MCPServerInstance {
    transport: IMCPTransport;
    tools: MCPTool[];
    name: string;
    definition: MCPServerDefinition;
}

interface IPendingMCPRequest {
    readonly transport: IMCPTransport;
    resolve(value: any): void;
    reject(error: any): void;
}

export class CleanSlateMCPClientService extends Disposable implements IMCPClientService {

    _serviceBrand: undefined;
    private servers: Map<string, MCPServerInstance> = new Map();
    private requestHandlers = new Map<number | string, IPendingMCPRequest>();
    private requestId: number = 0;

    constructor(
        @IConfigurationService private readonly configService: IConfigurationService,
        @IEnvironmentService private readonly environmentService: IEnvironmentService,
        @INativeEnvironmentService private readonly nativeEnvironmentService: INativeEnvironmentService,
        @ILogService private readonly logger: ILogService
    ) {
        super();
    }

    async getTools(token: CancellationToken = CancellationToken.None): Promise<MCPTool[]> {
        const mcpServers = await this.getServerDefinitions();
        const allTools: MCPTool[] = [];
        const activeKeys = new Set(mcpServers.map(server => this.getServerKey(server)));

        for (const [key, instance] of this.servers.entries()) {
            if (!activeKeys.has(key)) {
                instance.transport.stop();
                this.servers.delete(key);
            }
        }

        for (const server of mcpServers) {
            if (token.isCancellationRequested) {
                throw new CancellationError();
            }
            const key = this.getServerKey(server);
            if (!this.servers.has(key)) {
                await this.connectToServer(server, token);
            }
            const instance = this.servers.get(key);
            if (instance) {
                allTools.push(...instance.tools);
            }
        }

        return allTools;
    }

    async executeTool(toolName: string, input: any, token: CancellationToken = CancellationToken.None): Promise<any> {
        const canonicalToolName = this.canonicalizeMcpToolName(toolName);
        let match = this.findTool(toolName) ?? this.findTool(canonicalToolName);
        if (!match) {
            await this.getTools(token);
            match = this.findTool(toolName) ?? this.findTool(canonicalToolName);
        }
        if (match) {
            const { instance, tool } = match;
            this.logger.info(`Executing MCP tool: ${tool.name} on server ${instance.name}`);
            return this.callMethod(instance.transport, 'tools/call', {
                name: tool.originalName || tool.name,
                arguments: input
            }, token);
        }
        throw new Error(`MCP Tool "${toolName}" not found.`);
    }

    async refreshServers(token: CancellationToken = CancellationToken.None): Promise<void> {
        for (const instance of this.servers.values()) {
            instance.transport.stop();
        }
        this.servers.clear();
        await this.getTools(token);
    }

    private async connectToServer(definition: MCPServerDefinition, token: CancellationToken): Promise<void> {
        const key = this.getServerKey(definition);
		let transport: CleanSlateStdioTransport | undefined;
        try {
            transport = new CleanSlateStdioTransport(definition.command, definition.args, this.logger, {
                cwd: definition.cwd,
                env: definition.env
            });

            transport.onMessage = (msg) => this.handleMessage(msg);
            transport.onError = err => {
				this.logger.error(`Transport error for ${definition.name}: ${err}`);
				this.rejectRequestsForTransport(transport!, err instanceof Error ? err : new Error(String(err)));
			};
            transport.onClose = () => {
				this.servers.delete(key);
				this.rejectRequestsForTransport(transport!, new Error(`MCP server "${definition.name}" closed.`));
			};

            await transport.start();

            // 1. Handshake: initialize
            const initResult = await this.callMethod(transport, 'initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'CleanSlate', version: '1.0.0' }
            }, token);

            this.logger.info(`MCP Server ${definition.name} initialized: ${JSON.stringify(initResult.serverInfo)}`);

            // 2. Initialized notification
            await transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' });

            // 3. Discovery: list tools
            const toolsResult = await this.callMethod(transport, 'tools/list', {}, token);
            const tools = (toolsResult.tools || []).map((tool: any): MCPTool => ({
                name: this.buildMcpToolName(definition.name, tool.name),
                originalName: tool.name,
                description: typeof tool.description === 'string' ? tool.description : '',
                inputSchema: tool.inputSchema || { type: 'object', properties: {} },
                serverName: definition.name,
				readOnlyHint: typeof tool.annotations?.readOnlyHint === 'boolean' ? tool.annotations.readOnlyHint : undefined,
				openWorldHint: typeof tool.annotations?.openWorldHint === 'boolean' ? tool.annotations.openWorldHint : undefined
            }));

            this.servers.set(key, {
                transport,
                tools,
                name: definition.name,
                definition
            });

            this.logger.info(`Discovered ${tools.length} tools from ${definition.name}`);

        } catch (e) {
			transport?.stop();
			if (token.isCancellationRequested) {
				throw e;
			}
            this.logger.error(`Failed to connect to MCP server: ${definition.name}. ${e}`);
        }
    }

    private findTool(toolName: string): { instance: MCPServerInstance; tool: MCPTool } | undefined {
        const originalNameMatches: Array<{ instance: MCPServerInstance; tool: MCPTool }> = [];
        for (const instance of this.servers.values()) {
            for (const tool of instance.tools) {
                if (tool.name === toolName) {
                    return { instance, tool };
                }
                if (tool.originalName === toolName) {
                    originalNameMatches.push({ instance, tool });
                }
            }
        }
        return originalNameMatches.length === 1 ? originalNameMatches[0] : undefined;
    }

    private async getServerDefinitions(): Promise<MCPServerDefinition[]> {
        const servers = new Map<string, MCPServerDefinition>();
        const add = (definition: MCPServerDefinition) => {
            servers.set(definition.name, definition);
        };

        for (const definition of await this.readCleanSlatePluginMcpServers()) {
            add(definition);
        }
        for (const definition of this.readCleanSlateConfiguredMcpServers()) {
            add(definition);
        }

        return Array.from(servers.values());
    }

    private readCleanSlateConfiguredMcpServers(): MCPServerDefinition[] {
        const configured = this.configService.getValue<unknown>('cleanSlate.mcpServers')
            ?? this.configService.getValue<unknown>('cleanslate.mcpServers');
        return this.normalizeMcpServerConfig(configured, 'cleanSlate');
    }

    private async readCleanSlatePluginMcpServers(): Promise<MCPServerDefinition[]> {
        const files = await this.findCleanSlateMcpConfigFiles();
        const servers: MCPServerDefinition[] = [];

        for (const file of files) {
            try {
                const errors: ParseError[] = [];
                const parsed = parseJson(await readFile(file, 'utf8'), errors, { allowTrailingComma: true, allowEmptyContent: true });
                if (errors.length > 0) {
                    this.logger.warn(`Failed to parse CleanSlate MCP plugin config ${file}: ${errors.map(error => error.error).join(', ')}`);
                    continue;
                }
                servers.push(...this.normalizeMcpServerConfig(parsed, `cleanSlate-plugin:${file}`, dirname(file)));
            } catch (error) {
                this.logger.warn(`Failed to read CleanSlate MCP plugin config ${file}: ${String(error)}`);
            }
        }

        return servers;
    }

    private async findCleanSlateMcpConfigFiles(): Promise<string[]> {
        const roots = await this.getCleanSlateMcpPluginRoots();
        const files: string[] = [];

        for (const root of roots) {
            files.push(...await this.findFilesNamed(root, '.mcp.json', 6));
        }

        return Array.from(new Set(files.map(file => normalize(file)))).sort();
    }

    private async getCleanSlateMcpPluginRoots(): Promise<string[]> {
        const configuredRoots = this.configService.getValue<unknown>('cleanSlate.mcpPluginRoots')
            ?? this.configService.getValue<unknown>('cleanslate.mcpPluginRoots');
        const roots = [
            ...this.normalizePathList(configuredRoots),
            joinPath(this.environmentService.userRoamingDataHome, 'plugins').fsPath,
            joinPath(this.environmentService.userRoamingDataHome, 'plugins', 'cache').fsPath,
            join(this.nativeEnvironmentService.appRoot, 'resources', 'cleanslate', 'plugins')
        ];

        return Array.from(new Set(roots.map(root => normalize(root)))).sort();
    }

    private async findFilesNamed(root: string, fileName: string, maxDepth: number): Promise<string[]> {
        if (maxDepth < 0) {
            return [];
        }

        let entries: Dirent[];
        try {
            entries = await readdir(root, { withFileTypes: true });
        } catch {
            return [];
        }

        const files: string[] = [];
        for (const entry of entries) {
            const fullPath = join(root, entry.name);
            if (entry.isFile() && entry.name === fileName) {
                files.push(fullPath);
            } else if (entry.isDirectory()) {
                files.push(...await this.findFilesNamed(fullPath, fileName, maxDepth - 1));
            }
        }

        return files;
    }

    private normalizeMcpServerConfig(value: unknown, source: string, baseDir?: string): MCPServerDefinition[] {
        if (!value) {
            return [];
        }
        if (Array.isArray(value)) {
            return value.flatMap((entry, index) => this.normalizeMcpServerEntry(`server-${index + 1}`, entry, source, baseDir));
        }
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) {
                return [];
            }
            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                try {
                    return this.normalizeMcpServerConfig(JSON.parse(trimmed), source, baseDir);
                } catch (error) {
                    this.logger.warn(`Ignoring invalid CleanSlate MCP JSON from ${source}: ${String(error)}`);
                    return [];
                }
            }
            return this.normalizeMcpServerEntry('server-1', trimmed, source, baseDir);
        }
        if (typeof value === 'object') {
            const record = value as Record<string, unknown>;
            const serverMap = this.isObject(record.mcpServers)
                ? record.mcpServers as Record<string, unknown>
                : this.isObject(record.servers)
                    ? record.servers as Record<string, unknown>
                    : record;
            return Object.entries(serverMap).flatMap(([name, entry]) => this.normalizeMcpServerEntry(name, entry, source, baseDir));
        }
        return [];
    }

    private normalizeMcpServerEntry(name: string, entry: unknown, source: string, baseDir?: string): MCPServerDefinition[] {
        if (typeof entry === 'string') {
            const commandLine = entry.trim();
            if (!commandLine || commandLine.startsWith('{') || commandLine.startsWith('[')) {
                this.logger.warn(`Ignoring invalid CleanSlate MCP command string for ${name} from ${source}.`);
                return [];
            }
            const [command, ...args] = this.parseCommandLine(commandLine);
            if (!this.isValidCommand(command)) {
                this.logger.warn(`Ignoring invalid CleanSlate MCP command for ${name} from ${source}.`);
                return [];
            }
            return [{ name, command, args, source }];
        }
        if (!this.isObject(entry)) {
            return [];
        }

        const type = typeof entry.type === 'string' ? entry.type : 'stdio';
        if (type !== 'stdio') {
            this.logger.warn(`CleanSlate MCP currently supports stdio servers only; skipping ${name} (${type}).`);
            return [];
        }
        if (typeof entry.command !== 'string' || !this.isValidCommand(entry.command.trim())) {
            this.logger.warn(`Ignoring invalid CleanSlate MCP command for ${name} from ${source}.`);
            return [];
        }
        const serverName = typeof entry.name === 'string' && entry.name.trim().length > 0
            ? entry.name.trim()
            : name;

        return [{
            name: serverName,
            command: entry.command.trim(),
            args: Array.isArray(entry.args) ? entry.args.filter((arg): arg is string => typeof arg === 'string') : [],
            cwd: typeof entry.cwd === 'string' ? this.resolveRelative(baseDir, entry.cwd) : baseDir,
            env: this.normalizeEnv(entry.env),
            source
        }];
    }

    private parseCommandLine(commandLine: string): string[] {
        const parts: string[] = [];
        let current = '';
        let quote: '"' | '\'' | undefined;
        let escaping = false;
        for (const char of commandLine) {
            if (escaping) {
                current += char;
                escaping = false;
                continue;
            }
            if (char === '\\') {
                escaping = true;
                continue;
            }
            if (quote) {
                if (char === quote) {
                    quote = undefined;
                } else {
                    current += char;
                }
                continue;
            }
            if (char === '"' || char === '\'') {
                quote = char;
                continue;
            }
            if (/\s/.test(char)) {
                if (current) {
                    parts.push(current);
                    current = '';
                }
                continue;
            }
            current += char;
        }
        if (current) {
            parts.push(current);
        }
        return parts;
    }

    private normalizeEnv(value: unknown): Record<string, string> | undefined {
        if (!this.isObject(value)) {
            return undefined;
        }
        const env: Record<string, string> = {};
        for (const [key, envValue] of Object.entries(value)) {
            if (envValue !== undefined && envValue !== null) {
                env[key] = String(envValue);
            }
        }
        return Object.keys(env).length > 0 ? env : undefined;
    }

    private resolveRelative(baseDir: string | undefined, value: string): string {
        if (!baseDir || value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) {
            return value;
        }
        return join(baseDir, value);
    }

    private normalizePathList(value: unknown): string[] {
        if (typeof value === 'string') {
            const trimmed = value.trim();
            return trimmed ? [trimmed] : [];
        }
        if (!Array.isArray(value)) {
            return [];
        }
        return value
            .filter((entry): entry is string => typeof entry === 'string')
            .map(entry => entry.trim())
            .filter(entry => entry.length > 0);
    }

    private isObject(value: unknown): value is Record<string, any> {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    private isValidCommand(command: string | undefined): command is string {
        if (!command) {
            return false;
        }
        return !command.startsWith('{')
            && !command.startsWith('[')
            && !command.includes('\n')
            && command !== 'jsonrpc'
            && command !== 'jsonrpc:2.0'
            && command !== '"jsonrpc":'
            && command !== '"jsonrpc":"2.0"';
    }

    private getServerKey(definition: MCPServerDefinition): string {
        return `${definition.name}:${definition.command}:${JSON.stringify(definition.args)}:${definition.cwd || ''}`;
    }

    private buildMcpToolName(serverName: string, toolName: string): string {
        return `mcp__${this.normalizeMcpName(serverName)}__${this.normalizeMcpName(toolName)}`;
    }

    private canonicalizeMcpToolName(toolName: string): string {
        const parts = toolName.split('__');
        if (parts.length !== 3 || parts[0] !== 'mcp') {
            return toolName;
        }
        return this.buildMcpToolName(parts[1], parts[2]);
    }

    private normalizeMcpName(name: string): string {
        return name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 64) || 'mcp';
    }

    private handleMessage(message: any): void {
        if (message.id !== undefined) {
            const handler = this.requestHandlers.get(message.id);
            if (handler) {
                if (message.error) {
                    handler.reject(message.error);
                } else {
                    handler.resolve(message.result);
                }
                this.requestHandlers.delete(message.id);
            }
        }
        // Handle notifications (not implemented for now)
    }

    private async callMethod(transport: IMCPTransport, method: string, params: any, token: CancellationToken = CancellationToken.None): Promise<any> {
        const id = ++this.requestId;
        const request = {
            jsonrpc: '2.0',
            id,
            method,
            params
        };

        return new Promise((resolve, reject) => {
			let settled = false;
			let timeout: ReturnType<typeof setTimeout> | undefined;
			let cancellation: IDisposable | undefined;
			const cleanup = () => {
				if (timeout) {
					clearTimeout(timeout);
					timeout = undefined;
				}
				cancellation?.dispose();
				cancellation = undefined;
				this.requestHandlers.delete(id);
			};
			const handler: IPendingMCPRequest = {
				transport,
				resolve: value => {
					if (settled) { return; }
					settled = true;
					cleanup();
					resolve(value);
				},
				reject: error => {
					if (settled) { return; }
					settled = true;
					cleanup();
					reject(error);
				},
			};
			this.requestHandlers.set(id, handler);
			timeout = setTimeout(() => handler.reject(new Error(`MCP Request ${method} timed out.`)), 30000);
			const cancel = () => {
				if (settled) { return; }
				void transport.send({
					jsonrpc: '2.0',
					method: 'notifications/cancelled',
					params: { requestId: id, reason: 'CleanSlate request cancelled' }
				}).catch(() => undefined);
				handler.reject(new CancellationError());
			};
			cancellation = token.onCancellationRequested(cancel);
			if (token.isCancellationRequested) {
				cancel();
				return;
			}
			transport.send(request).catch(error => handler.reject(error));
        });
    }

	private rejectRequestsForTransport(transport: IMCPTransport, error: Error): void {
		for (const handler of [...this.requestHandlers.values()]) {
			if (handler.transport === transport) {
				handler.reject(error);
			}
		}
	}

    override dispose(): void {
        for (const instance of this.servers.values()) {
            instance.transport.stop();
        }
        this.servers.clear();
        for (const handler of [...this.requestHandlers.values()]) {
			handler.reject(new Error('CleanSlate MCP client was disposed.'));
		}
        super.dispose();
    }
}
