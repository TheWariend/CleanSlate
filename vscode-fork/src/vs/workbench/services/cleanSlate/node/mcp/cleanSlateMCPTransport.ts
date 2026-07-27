/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import { ILogService } from '../../../../../platform/log/common/log.js';

export interface IMCPTransport {
    start(): Promise<void>;
    stop(): void;
    send(message: any): Promise<void>;
    onMessage?: (message: any) => void;
    onError?: (error: any) => void;
    onClose?: () => void;
}

export class CleanSlateStdioTransport implements IMCPTransport {
    private process: cp.ChildProcess | null = null;
    private stdoutBuffer = '';
    private readonly npmConfigEnvKeys = [
        'npm_config_target',
        'npm_config_ms_build_id',
        'npm_config_runtime',
        'npm_config_build_from_source',
        'npm_config_timeout',
        'npm_config_disturl'
    ];

    constructor(
        private readonly executable: string,
        private readonly args: string[],
        private readonly logger: ILogService,
        private readonly options: { cwd?: string; env?: Record<string, string> } = {}
    ) { }

    async start(): Promise<void> {
        this.logger.info(`Starting MCP server: ${this.executable} ${this.args.join(' ')}`);

        this.process = cp.spawn(this.executable, this.args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: this.options.cwd,
            env: this.createChildEnvironment()
        });

        this.process.stdout?.on('data', (data: Buffer) => {
            this.stdoutBuffer += data.toString();
            const lines = this.stdoutBuffer.split(/\r?\n/);
            this.stdoutBuffer = lines.pop() || '';

            for (const line of lines) {
                this.handleLine(line);
            }
        });

        this.process.stderr?.on('data', (data: Buffer) => {
            this.logger.warn(`MCP Server Stderr: ${data.toString()}`);
        });

        this.process.on('error', (err: Error) => {
            if (this.onError) this.onError(err);
        });

        this.process.on('close', () => {
            if (this.stdoutBuffer.trim().length > 0) {
                this.handleLine(this.stdoutBuffer);
                this.stdoutBuffer = '';
            }
            this.logger.info(`MCP Server closed: ${this.executable}`);
            if (this.onClose) this.onClose();
        });
    }

    private handleLine(line: string): void {
        const raw = line.trim();
        if (!raw) {
            return;
        }
        try {
            const msg = JSON.parse(raw);
            if (this.onMessage) this.onMessage(msg);
        } catch (e) {
            this.logger.error(`Failed to parse MCP message: ${raw}`);
        }
    }

    stop(): void {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
    }

    async send(message: any): Promise<void> {
        if (!this.process || !this.process.stdin) {
            throw new Error('MCP Transport not started');
        }
        this.process.stdin.write(JSON.stringify(message) + '\n');
    }

    onMessage?: (message: any) => void;
    onError?: (error: any) => void;
    onClose?: () => void;

    private createChildEnvironment(): NodeJS.ProcessEnv {
        const env: NodeJS.ProcessEnv = {
            ...process.env,
            ...(this.options.env || {})
        };
        for (const key of this.npmConfigEnvKeys) {
            delete env[key];
        }
        return env;
    }
}
