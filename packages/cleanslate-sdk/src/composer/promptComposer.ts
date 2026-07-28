/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChatMessagePart } from '../protocol/cleanSlateAI.js';
import { baseInstructions } from './instructions/baseInstructions.js';
import { CORE_IDENTITY } from './kernel/coreKernel.js';
import { TOOL_PROTOCOLS } from './kernel/toolProtocols.js';
import { CODING_STANDARDS, EXACT_EDIT_PRECISION_GUIDELINES } from './kernel/editingRules.js';
import { PLANNING_MODE_INSTRUCTION } from './modes/planning.mode.js';
import { EXECUTION_MODE_INSTRUCTION } from './modes/execution.mode.js';
import { AgentDefinition } from './registry/agentSchema.js';
import { SLASH_COMMANDS } from './commands/slashCommands.js';

export interface ComposePromptOptions {
	agentDefinition?: AgentDefinition;
	mode?: 'Planning' | 'Execution' | 'Verification' | 'Plan';
	command?: string;
	languageId?: string;
	userMessage?: string;
	discoveredContext?: {
		hasDatabase?: boolean;
		hasFrontend?: boolean;
		hasCloud?: boolean;
	};
}

/** Dynamic mode/command context appended after the stable cached prefix. */
export function composeTurnReminder(options: Pick<ComposePromptOptions, 'mode' | 'command'>): string {
	const modeInstruction = options.mode === 'Execution' || options.mode === 'Verification'
		? EXECUTION_MODE_INSTRUCTION
		: PLANNING_MODE_INSTRUCTION;
	const commandInstruction = options.command
		? SLASH_COMMANDS[options.command]?.instruction?.trim() ?? ''
		: '';

	return [
		`[MODE REMINDER]\n${modeInstruction.trim()}`,
		commandInstruction
			? `[SLASH COMMAND ${options.command}]\nIf selected text is present, treat it as the primary target.\n${commandInstruction}`
			: ''
	].filter(Boolean).join('\n\n');
}

/**
 * Builds one stable cacheable prefix and one small trailing mode reminder.
 * User/task context belongs in conversation messages, never in the prefix.
 */
export function composePrompt(options: ComposePromptOptions): IChatMessagePart[] {
	const staticParts = [
		CORE_IDENTITY,
		baseInstructions,
		TOOL_PROTOCOLS,
		CODING_STANDARDS,
		EXACT_EDIT_PRECISION_GUIDELINES
	];
	const agentDefinition = options.agentDefinition;
	if (agentDefinition?.identity) {
		staticParts.push(`Agent identity (${agentDefinition.name}):\n${agentDefinition.identity}`);
	}
	if (agentDefinition?.extensions) {
		staticParts.push(`Agent extensions:\n${agentDefinition.extensions}`);
	}
	if (agentDefinition?.constraints) {
		staticParts.push(`Agent constraints:\n${agentDefinition.constraints}`);
	}

	const trailingReminder = composeTurnReminder(options);

	return [
		{
			type: 'text',
			text: staticParts.join('\n\n'),
			cache_control: { type: 'ephemeral' }
		},
		{
			type: 'text',
			text: trailingReminder
		}
	];
}
