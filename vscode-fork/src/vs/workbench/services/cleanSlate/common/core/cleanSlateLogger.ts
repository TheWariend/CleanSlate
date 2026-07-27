/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService, LogLevel } from '../../../../../platform/log/common/log.js';
import { IOutputService } from '../../../output/common/output.js';
import { ICleanSlateLogger } from './cleanSlateAI.js';

export class CleanSlateLogger implements ICleanSlateLogger {
    _serviceBrand: undefined;
    private static readonly OUTPUT_CHANNEL_ID = 'cleanSlate.ai';

    constructor(
        @ILogService private readonly logService: ILogService,
        @IOutputService private readonly outputService: IOutputService
    ) {
        // Ensure channel exists
        this.outputService.getChannel(CleanSlateLogger.OUTPUT_CHANNEL_ID);
    }

    private log(level: LogLevel, message: string): void {
        const timestamp = new Date().toISOString();
        const formatted = `[${timestamp}] [${LogLevel[level]}] ${message}\n`;

        // Log to VS Code internal log service
        switch (level) {
            case LogLevel.Info: this.logService.info(message); break;
            case LogLevel.Warning: this.logService.warn(message); break;
            case LogLevel.Error: this.logService.error(message); break;
            case LogLevel.Debug: this.logService.debug(message); break;
            case LogLevel.Trace: this.logService.trace(message); break;
        }

        // Also log to our dedicated Output Channel for user visibility
        const channel = this.outputService.getChannel(CleanSlateLogger.OUTPUT_CHANNEL_ID);
        if (channel) {
            channel.append(formatted);
        }
    }

    info(message: string): void { this.log(LogLevel.Info, message); }
    warn(message: string): void { this.log(LogLevel.Warning, message); }
    error(message: string | Error): void { this.log(LogLevel.Error, message instanceof Error ? message.stack || message.message : message); }
    debug(message: string): void { this.log(LogLevel.Debug, message); }
    trace(message: string): void { this.log(LogLevel.Trace, message); }
}
