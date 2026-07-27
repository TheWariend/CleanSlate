/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IMCPClientService, MCPTool } from '../../common/core/cleanSlateAI.js';
import { ICleanSlateChannelService } from '../../common/core/cleanSlateChannelService.js';
import { IMcpService, IMcpServer, IMcpTool, McpToolVisibility } from '../../../../contrib/mcp/common/mcpTypes.js';
import { startServerAndWaitForLiveTools } from '../../../../contrib/mcp/common/mcpTypesUtils.js';
import { IChannel } from '../../../../../base/parts/ipc/common/ipc.js';

interface NativeMcpToolBinding {
    server: IMcpServer;
    tool: IMcpTool;
}

export class CleanSlateMCPClientProxy extends Disposable implements IMCPClientService {

    readonly _serviceBrand: undefined;
    private readonly channel: IChannel;
    private readonly nativeTools = new Map<string, NativeMcpToolBinding>();

    constructor(
        @ICleanSlateChannelService channelService: ICleanSlateChannelService,
        @IMcpService private readonly nativeMcpService: IMcpService,
        @ILogService private readonly logService: ILogService
    ) {
        super();
        this.channel = channelService.getChannel('cleanSlateMCP');
    }

    async getTools(token: CancellationToken = CancellationToken.None): Promise<MCPTool[]> {
        const toolsByName = new Map<string, MCPTool>();
        for (const tool of await this.getNativeTools(token)) {
            toolsByName.set(tool.name, tool);
        }
        for (const tool of await this.getCleanSlateNodeTools(token)) {
            if (!toolsByName.has(tool.name)) {
                toolsByName.set(tool.name, tool);
            }
        }
        return Array.from(toolsByName.values());
    }

    async executeTool(toolName: string, input: any, token: CancellationToken = CancellationToken.None): Promise<any> {
        const canonicalToolName = this.canonicalizeMcpToolName(toolName);
        let nativeTool = this.nativeTools.get(toolName) ?? this.nativeTools.get(canonicalToolName);
        if (!nativeTool) {
            await this.getTools(token);
            nativeTool = this.nativeTools.get(toolName) ?? this.nativeTools.get(canonicalToolName);
        }
        if (nativeTool) {
            return nativeTool.tool.call(input ?? {}, undefined, token);
        }
        return this.channel.call('executeTool', { toolName: canonicalToolName, input }, token);
    }

    async refreshServers(token: CancellationToken = CancellationToken.None): Promise<void> {
        this.nativeTools.clear();
        this.nativeMcpService.resetCaches();
        await Promise.all([
            this.channel.call('refreshServers', undefined, token),
            this.nativeMcpService.activateCollections().then(() => undefined)
        ]);
    }

    private async getNativeTools(token: CancellationToken): Promise<MCPTool[]> {
        this.nativeTools.clear();
        await this.nativeMcpService.activateCollections();

        const tools: MCPTool[] = [];
        for (const server of this.nativeMcpService.servers.get()) {
            try {
                await startServerAndWaitForLiveTools(server, { promptType: 'only-new' }, token);
            } catch (error) {
				if (token.isCancellationRequested) {
					throw error;
				}
                this.logService.warn(`CleanSlate MCP native server start failed for ${server.definition.label}: ${String(error)}`);
            }

            for (const tool of server.tools.get()) {
                if (!(tool.visibility & McpToolVisibility.Model)) {
                    continue;
                }

                const name = this.buildMcpToolName(server.definition.label, tool.definition.name);
                this.nativeTools.set(name, { server, tool });
                tools.push({
                    name,
                    originalName: tool.definition.name,
                    description: tool.definition.description || '',
                    inputSchema: tool.definition.inputSchema || { type: 'object', properties: {} },
                    serverName: server.definition.label,
					readOnlyHint: tool.definition.annotations?.readOnlyHint,
					openWorldHint: tool.definition.annotations?.openWorldHint
                });
            }
        }
        return tools;
    }

    private async getCleanSlateNodeTools(token: CancellationToken): Promise<MCPTool[]> {
        try {
            return await this.channel.call('getTools', undefined, token);
        } catch (error) {
			if (token.isCancellationRequested) {
				throw error;
			}
            this.logService.warn(`CleanSlate node MCP tools unavailable: ${String(error)}`);
            return [];
        }
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
}
