/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * AgentDefinition schema for user-created and custom agents.
 */
export interface AgentSkill {
    readonly id: string;
    readonly name: string;
    readonly instructions: string;
}

export interface AgentDefinition {
    /** Unique identifier for the agent */
    readonly id: string;
    /** Display name of the agent */
    readonly name: string;
    /** Optional human-readable title or specialty shown after the configured name. */
    readonly title?: string;
    /** Optional specific identity and core mission (adds to CORE_IDENTITY) */
    readonly identity?: string;
    /** Optional domain-specific extensions or specialized knowledge */
    readonly extensions?: string;
    /** Optional specific constraints or behavioral rules */
    readonly constraints?: string;
    /** Optional reusable methods configured for this agent. */
    readonly skills?: readonly AgentSkill[];
}
