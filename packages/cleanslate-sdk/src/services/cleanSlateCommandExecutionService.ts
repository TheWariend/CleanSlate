/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../core/lifecycle.js';
import { CancellationToken } from '../core/cancellation.js';
import { Subscribable } from '../host/events.js';
import {
	ICleanSlateBackgroundCommandOptions,
	ICleanSlateBackgroundCommandResult,
	ICleanSlateCommandExecutionOptions,
	ICleanSlateCommandExecutionResult,
	ICleanSlateCommandOutputEvent,
	ICleanSlateMainService,
	ICleanSlateStopBackgroundCommandResult
} from '../protocol/cleanSlateAI.js';


export interface ICleanSlateCommandExecutionService {
	_serviceBrand: undefined;
	executeCommand(options: ICleanSlateCommandExecutionOptions): Promise<ICleanSlateCommandExecutionResult>;
	executeCommandStream(options: ICleanSlateCommandExecutionOptions, token?: CancellationToken): Subscribable<ICleanSlateCommandOutputEvent | null>;
	startBackgroundCommand(options: ICleanSlateBackgroundCommandOptions): Promise<ICleanSlateBackgroundCommandResult>;
	stopBackgroundCommand(processId: string): Promise<ICleanSlateStopBackgroundCommandResult>;
	getBackgroundCommand(processId: string): Promise<ICleanSlateBackgroundCommandResult>;
	listBackgroundCommands(): Promise<ICleanSlateBackgroundCommandResult[]>;
}

export class CleanSlateCommandExecutionService extends Disposable implements ICleanSlateCommandExecutionService {
	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly mainService: ICleanSlateMainService
	) {
		super();
	}

	executeCommand(options: ICleanSlateCommandExecutionOptions): Promise<ICleanSlateCommandExecutionResult> {
		return this.mainService.executeCommand(options);
	}

	executeCommandStream(options: ICleanSlateCommandExecutionOptions, token: CancellationToken = CancellationToken.None): Subscribable<ICleanSlateCommandOutputEvent | null> {
		return this.mainService.executeCommandStream(options, token);
	}

	startBackgroundCommand(options: ICleanSlateBackgroundCommandOptions): Promise<ICleanSlateBackgroundCommandResult> {
		return this.mainService.startBackgroundCommand(options);
	}

	stopBackgroundCommand(processId: string): Promise<ICleanSlateStopBackgroundCommandResult> {
		return this.mainService.stopBackgroundCommand(processId);
	}

	getBackgroundCommand(processId: string): Promise<ICleanSlateBackgroundCommandResult> {
		return this.mainService.getBackgroundCommand(processId);
	}

	listBackgroundCommands(): Promise<ICleanSlateBackgroundCommandResult[]> {
		return this.mainService.listBackgroundCommands();
	}
}
