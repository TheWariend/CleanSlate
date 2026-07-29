/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type CleanSlateExecutionBudgetStopReason = 'turn_limit';

export interface ICleanSlateExecutionBudgetDecision {
	readonly allowed: boolean;
	readonly reason?: CleanSlateExecutionBudgetStopReason;
	readonly message?: string;
}

export interface ICleanSlateExecutionBudget {
	configure(configuredMaxTurns?: number): void;
	consumeModelTurn(phase: string): ICleanSlateExecutionBudgetDecision;
}

/** An optional user-configured turn budget shared by every phase in one agent run. */
export class CleanSlateExecutionBudget implements ICleanSlateExecutionBudget {
	private maxModelTurns: number | undefined;
	private modelTurns = 0;

	constructor(configuredMaxTurns?: number) {
		this.configure(configuredMaxTurns);
	}

	configure(configuredMaxTurns?: number): void {
		this.maxModelTurns = Number.isFinite(configuredMaxTurns) && configuredMaxTurns! > 0
			? Math.floor(configuredMaxTurns!)
			: undefined;
	}

	consumeModelTurn(phase: string): ICleanSlateExecutionBudgetDecision {
		if (this.maxModelTurns !== undefined && this.modelTurns >= this.maxModelTurns) {
			return {
				allowed: false,
				reason: 'turn_limit',
				message: `Paused ${phase} after reaching the ${this.maxModelTurns}-turn agent safety limit. The task was not marked complete.`
			};
		}

		this.modelTurns++;
		return { allowed: true };
	}
}
