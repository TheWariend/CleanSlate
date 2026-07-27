/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Event } from '../../../../../base/common/event.js';
import {
	ICleanSlateBackgroundCommandOptions,
	ICleanSlateBackgroundCommandResult,
	ICleanSlateCommandExecutionOptions,
	ICleanSlateCommandExecutionResult,
	ICleanSlateCommandOutputEvent,
	ICleanSlateMainService,
	ICleanSlateStopBackgroundCommandResult
} from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';

export const ICleanSlateCommandExecutionService = createDecorator<ICleanSlateCommandExecutionService>('cleanSlateCommandExecutionService');

export interface ICleanSlateCommandExecutionService {
	_serviceBrand: undefined;
	executeCommand(options: ICleanSlateCommandExecutionOptions): Promise<ICleanSlateCommandExecutionResult>;
	executeCommandStream(options: ICleanSlateCommandExecutionOptions, token?: CancellationToken): Event<ICleanSlateCommandOutputEvent | null>;
	startBackgroundCommand(options: ICleanSlateBackgroundCommandOptions): Promise<ICleanSlateBackgroundCommandResult>;
	stopBackgroundCommand(processId: string): Promise<ICleanSlateStopBackgroundCommandResult>;
	getBackgroundCommand(processId: string): Promise<ICleanSlateBackgroundCommandResult>;
	listBackgroundCommands(): Promise<ICleanSlateBackgroundCommandResult[]>;
}

export class CleanSlateCommandExecutionService extends Disposable implements ICleanSlateCommandExecutionService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@ICleanSlateMainService private readonly mainService: ICleanSlateMainService
	) {
		super();
	}

	executeCommand(options: ICleanSlateCommandExecutionOptions): Promise<ICleanSlateCommandExecutionResult> {
		return this.mainService.executeCommand(options);
	}

	executeCommandStream(options: ICleanSlateCommandExecutionOptions, token: CancellationToken = CancellationToken.None): Event<ICleanSlateCommandOutputEvent | null> {
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
