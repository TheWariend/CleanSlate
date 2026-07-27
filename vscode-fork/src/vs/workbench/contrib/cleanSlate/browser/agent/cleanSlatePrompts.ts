/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChatMessagePart } from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { composePrompt } from '../composer/promptComposer.js';
import { AgentDefinition } from '../composer/registry/agentSchema.js'; // NEW
import { SLASH_COMMANDS as COMMAND_REGISTRY } from '../composer/commands/slashCommands.js';
import { PLANNING_MODE_INSTRUCTION } from '../composer/modes/planning.mode.js';
import { EXECUTION_MODE_INSTRUCTION } from '../composer/modes/execution.mode.js';

export { PLANNING_MODE_INSTRUCTION, EXECUTION_MODE_INSTRUCTION };

export enum AgentPhase {
  PLANNING = 'PLANNING',
  EXECUTION = 'EXECUTION',
  VERIFICATION = 'VERIFICATION'
}

/**
 * Slash command definitions (Re-exported for backward compatibility)
 */
export const SLASH_COMMANDS = COMMAND_REGISTRY;

/**
 * Build system prompt with optional command-specific instruction and mode
 */
export function buildSystemPrompt(userMessage?: string, mode: string = 'Plan', agentDef?: AgentDefinition, languageId?: string, command?: string, discoveredContext?: any): IChatMessagePart[] {
  // Map old mode strings to composer valid modes if necessary
  const composerMode = (mode === 'Plan' || mode === 'Planning' || mode === 'Execution' || mode === 'Verification')
    ? mode as any
    : 'Plan';

  return composePrompt({
    command,
    mode: composerMode,
    agentDefinition: agentDef, // Pass persona to composer
    languageId,
    userMessage,
    discoveredContext
  });
}

/**
 * Parse user message for slash commands
 */
export function parseSlashCommand(text: string, mode: string = 'Plan', agentDef?: AgentDefinition, languageId?: string, discoveredContext?: any): { command: string | null; systemInstruction: IChatMessagePart[]; userMessage: string } {
  if (!text.startsWith('/')) {
    return {
      command: null,
      systemInstruction: buildSystemPrompt(text, mode, agentDef, languageId, undefined, discoveredContext),
      userMessage: text
    };
  }

  const commandText = text.split(' ')[0];
  const rest = text.substring(commandText.length).trim();

  if (SLASH_COMMANDS[commandText]) {
    const defaultUserMessage = SLASH_COMMANDS[commandText].defaultMessage;
    const finalUserMessage = rest || defaultUserMessage;
    return {
      command: commandText,
      systemInstruction: buildSystemPrompt(finalUserMessage, mode, agentDef, languageId, commandText, discoveredContext),
      userMessage: finalUserMessage
    };
  }

  return {
    command: null,
    systemInstruction: buildSystemPrompt(text, mode, agentDef, languageId, undefined, discoveredContext),
    userMessage: text
  };
}
