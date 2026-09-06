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
    description: 'Starts an isolated child agent for a bounded technical task and returns immediately. The host presents its lifecycle in the existing Side Chat surface. If your answer depends on the result, call wait_worker yourself and synthesize it before replying; keep the returned worker ID for tool calls only and never expose it or ask the user to operate it. Input: { description: string, prompt: string, subagent_type?: "worker" | "researcher" }.',
    parametersSchema: {
        description: "string - A brief description of the worker's purpose",
        prompt: "string - The detailed technical spec/prompt for the worker",
        subagent_type: "string - The type of subagent to spawn (default: 'worker')"
    },
    category: "system",
    async run(input: { description: string; prompt: string; subagent_type?: string }, context: CleanSlateToolContext): Promise<any> {
        if (!context.agentCoordinator) {
            return {
                success: false,
                code: 'agent_coordinator_unavailable',
                error: 'This host does not provide child-agent execution.'
            };
        }
        const subscription = context.agentCoordinator.onDidChangeAgent(event => {
            context.onProgress?.({ type: 'child_agent', eventType: event.type, agent: event.agent, delta: event.delta });
        });
        try {
            const agent = await context.agentCoordinator.spawnAgent({
                description: input.description,
                prompt: input.prompt,
                kind: input.subagent_type === 'researcher' ? 'researcher' : 'worker',
                parentAgentId: context.sessionId
            }, context.signal);
			return { success: true, agentId: agent.id, status: agent.status, description: agent.description };
        } finally {
            subscription.dispose();
        }
    }
};

export const waitWorkerTool: CleanSlateTool = {
	name: 'wait_worker',
	description: 'Waits for a background child agent and returns its result to you for synthesis. Use this yourself when the current answer depends on delegated work; do not instruct the user to call it or expose the worker ID. Input: { agent_id: string, timeout_ms?: number }.',
	parametersSchema: {
		agent_id: 'string - Child agent ID returned by spawn_worker',
		timeout_ms: 'number - Optional bounded wait in milliseconds; omit to wait until completion'
	},
	category: 'system',
	async run(input: { agent_id: string; timeout_ms?: number }, context: CleanSlateToolContext): Promise<any> {
		if (!context.agentCoordinator) {
			return { success: false, code: 'agent_coordinator_unavailable', error: 'This host does not provide child-agent execution.' };
		}
		const subscription = context.agentCoordinator.onDidChangeAgent(event => {
			if (event.agent.id === input.agent_id) {
				context.onProgress?.({ type: 'child_agent', eventType: event.type, agent: event.agent, delta: event.delta });
			}
		});
		try {
			const agent = await context.agentCoordinator.waitForAgent(input.agent_id, {
				timeoutMs: input.timeout_ms,
				signal: context.signal
			});
			if (agent.status === 'completed') {
				return { success: true, agentId: agent.id, status: agent.status, result: agent.output ?? '' };
			}
			if (agent.status === 'running' || agent.status === 'queued') {
				return { success: true, agentId: agent.id, status: agent.status };
			}
			if (agent.status === 'cancelled') {
				return {
					success: false,
					code: 'user_cancelled',
					agentId: agent.id,
					status: agent.status,
					error: 'The user cancelled this worker. Do not restart or replace it unless the user explicitly requests that.'
				};
			}
			return { success: false, agentId: agent.id, status: agent.status, error: agent.error ?? 'Child agent did not complete.' };
		} catch (error) {
			return { success: false, agentId: input.agent_id, error: error instanceof Error ? error.message : String(error) };
		} finally {
			subscription.dispose();
		}
	}
};

export const listWorkersTool: CleanSlateTool = {
	name: 'list_workers',
	description: 'Lists child agents owned by the current task, including lifecycle status and completed output.',
	parametersSchema: {},
	category: 'system',
	async run(_input: unknown, context: CleanSlateToolContext): Promise<any> {
		if (!context.agentCoordinator) {
			return { success: false, code: 'agent_coordinator_unavailable', error: 'This host does not provide child-agent execution.' };
		}
		return { success: true, agents: context.agentCoordinator.listAgents(context.sessionId) };
	}
};

export const cancelWorkerTool: CleanSlateTool = {
	name: 'cancel_worker',
	description: 'Cancels a queued or running child agent. Input: { agent_id: string, reason?: string }.',
	parametersSchema: {
		agent_id: 'string - Child agent ID returned by spawn_worker',
		reason: 'string - Optional cancellation reason'
	},
	category: 'system',
	async run(input: { agent_id: string; reason?: string }, context: CleanSlateToolContext): Promise<any> {
		if (!context.agentCoordinator) {
			return { success: false, code: 'agent_coordinator_unavailable', error: 'This host does not provide child-agent execution.' };
		}
		const cancelled = context.agentCoordinator.cancelAgent(input.agent_id, input.reason);
		return cancelled
			? { success: true, agentId: input.agent_id, status: 'cancelled' }
			: { success: false, agentId: input.agent_id, error: 'Child agent is not running.' };
	}
};
