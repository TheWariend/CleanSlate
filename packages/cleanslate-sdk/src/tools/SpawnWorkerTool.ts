/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CleanSlateTool, CleanSlateToolContext } from './types.js';

/**
 * Tool: spawn_worker
 */
export const spawnWorkerTool: CleanSlateTool = {
    name: 'spawn_worker',
    description: 'Spawns a specialized worker to execute a technical task autonomously. Input: { description: string, prompt: string, subagent_type?: "worker" | "researcher" }. Returns: { success: true, result: string }',
    parametersSchema: {
        description: "string - A brief description of the worker's purpose",
        prompt: "string - The detailed technical spec/prompt for the worker",
        subagent_type: "string - The type of subagent to spawn (default: 'worker')"
    },
    category: "system",
    async run(input: { description: string; prompt: string; subagent_type?: string }, _context: CleanSlateToolContext): Promise<any> {
        // The actual spawning logic is handled in CleanSlateAgent.executeTool by intercepting this tool result.
        return { 
            success: true, 
            isSpawnRequest: true,
            description: input.description,
            prompt: input.prompt,
            subagentType: input.subagent_type || 'worker'
        };
    }
};
