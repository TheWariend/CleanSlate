/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	ICleanSlateBackgroundCommandOptions,
	ICleanSlateBackgroundCommandResult,
	ICleanSlateCommandExecutionOptions,
	ICleanSlateCommandExecutionResult,
	ICleanSlateCommandOutputEvent,
	ICleanSlateStopBackgroundCommandResult
} from '../../common/core/cleanSlateAI.js';

export type CleanSlateCliAgentRequest =
	| { id: number; type: 'execute'; options: ICleanSlateCommandExecutionOptions }
	| { id: number; type: 'startBackground'; options: ICleanSlateBackgroundCommandOptions }
	| { id: number; type: 'stopBackground'; processId: string }
	| { id: number; type: 'getBackground'; processId: string }
	| { id: number; type: 'listBackground' }
	| { id: number; type: 'cancel'; targetId: number }
	| { id: number; type: 'shutdown' };

export type CleanSlateCliAgentResponse =
	| { id: number; type: 'event'; event: ICleanSlateCommandOutputEvent }
	| { id: number; type: 'executeResult'; result: ICleanSlateCommandExecutionResult }
	| { id: number; type: 'backgroundResult'; result: ICleanSlateBackgroundCommandResult }
	| { id: number; type: 'stopResult'; result: ICleanSlateStopBackgroundCommandResult }
	| { id: number; type: 'backgroundList'; result: ICleanSlateBackgroundCommandResult[] }
	| { id: number; type: 'cancelled' }
	| { id: number; type: 'shutdownAck' }
	| { id: number; type: 'error'; error: string };
