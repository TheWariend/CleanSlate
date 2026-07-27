/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import {
	ICleanSlateBackgroundCommandOptions,
	ICleanSlateBackgroundCommandResult,
	ICleanSlateCommandExecutionOptions,
	ICleanSlateCommandExecutionResult,
	ICleanSlateCommandOutputEvent,
	ICleanSlateStopBackgroundCommandResult
} from '../../common/core/cleanSlateAI.js';
import { CleanSlateCliAgentRuntimeClient } from './cleanSlateCliAgentRuntimeClient.js';

/**
 * Thin app-side adapter. The real shell ownership lives in the CleanSlate CLI
 * agent runtime process so command execution is independent of chat rendering.
 */
export class CleanSlateCommandExecutionService extends Disposable {
	constructor(
		private readonly cliAgentRuntime = new CleanSlateCliAgentRuntimeClient()
	) {
		super();
	}

	async executeCommand(options: ICleanSlateCommandExecutionOptions): Promise<ICleanSlateCommandExecutionResult> {
		return this.cliAgentRuntime.executeCommand(options);
	}

	executeCommandStream(options: ICleanSlateCommandExecutionOptions, token: CancellationToken): Event<ICleanSlateCommandOutputEvent | null> {
		let emitter: Emitter<ICleanSlateCommandOutputEvent | null>;
		let hasListener = false;
		const bufferedEvents: (ICleanSlateCommandOutputEvent | null)[] = [];
		const fire = (event: ICleanSlateCommandOutputEvent | null) => {
			if (hasListener) {
				emitter.fire(event);
				return;
			}

			bufferedEvents.push(event);
		};

		const flushBufferedEvents = () => {
			for (const event of bufferedEvents.splice(0)) {
				emitter.fire(event);
			}
		};

		emitter = new Emitter<ICleanSlateCommandOutputEvent | null>({
			onDidAddFirstListener: () => {
				hasListener = true;
				flushBufferedEvents();
			},
			onDidRemoveLastListener: () => {
				hasListener = false;
			}
		});

		Promise.resolve().then(() => {
			this.cliAgentRuntime.executeCommand(options, event => fire(event), token)
				.then(result => {
					fire({ type: 'result', result });
					fire(null);
				})
				.catch(error => {
					fire({
						type: 'error',
						command: options.command,
						cwd: options.cwd,
						error: error instanceof Error ? error.message : String(error)
					});
					fire(null);
				});
		});

		return emitter.event;
	}

	startBackgroundCommand(options: ICleanSlateBackgroundCommandOptions): Promise<ICleanSlateBackgroundCommandResult> {
		return this.cliAgentRuntime.startBackgroundCommand(options);
	}

	stopBackgroundCommand(processId: string): Promise<ICleanSlateStopBackgroundCommandResult> {
		return this.cliAgentRuntime.stopBackgroundCommand(processId);
	}

	getBackgroundCommand(processId: string): Promise<ICleanSlateBackgroundCommandResult> {
		return this.cliAgentRuntime.getBackgroundCommand(processId);
	}

	listBackgroundCommands(): Promise<ICleanSlateBackgroundCommandResult[]> {
		return this.cliAgentRuntime.listBackgroundCommands();
	}

	override dispose(): void {
		this.cliAgentRuntime.dispose();
		super.dispose();
	}
}
