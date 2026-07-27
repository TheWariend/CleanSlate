/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const EXECUTE_COMMAND_INTENTS = ['implementation', 'diagnostic', 'verification', 'user_requested'] as const;

export type ExecuteCommandIntent = typeof EXECUTE_COMMAND_INTENTS[number];

export interface ICommandPolicyDecision {
	allowed: boolean;
	code?: string;
	message?: string;
	recoveryHint?: string;
	returnToExecution?: boolean;
}

export function evaluateExecutionCommandPolicy(input: any): ICommandPolicyDecision {
	const intent = getCommandIntent(input);
	if (!intent) {
		return buildMissingIntentDecision('Execution');
	}

	void intent;
	return { allowed: true };
}

export function evaluateVerificationCommandPolicy(input: any): ICommandPolicyDecision {
	void input;
	return { allowed: true };
}

function getCommandIntent(input: any): ExecuteCommandIntent | undefined {
	const intent = typeof input?.intent === 'string' ? input.intent : undefined;
	return EXECUTE_COMMAND_INTENTS.find(candidate => candidate === intent);
}

function buildMissingIntentDecision(phaseName: string): ICommandPolicyDecision {
	return {
		allowed: false,
		code: 'execute_command_intent_required',
		message: `${phaseName} requires execute_command.intent so the runner can enforce phase boundaries without parsing command text.`,
		recoveryHint: "Retry execute_command with intent set to one of: 'implementation', 'diagnostic', 'verification', or 'user_requested'."
	};
}
