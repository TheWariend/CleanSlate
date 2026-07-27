/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export enum CleanSlateTaskKind {
    UNKNOWN = 'UNKNOWN',
    CHAT = 'CHAT',
    MODIFY_EXISTING = 'MODIFY_EXISTING',
    BOOTSTRAP_PROJECT = 'BOOTSTRAP_PROJECT'
}

export enum CleanSlateWorkspaceShape {
    UNKNOWN = 'UNKNOWN',
    EMPTY = 'EMPTY',
    EXISTING = 'EXISTING'
}

export enum CleanSlateTaskLifecycleStatus {
    IDLE = 'IDLE',
    CHAT = 'CHAT',
    PLANNING = 'PLANNING',
    AWAITING_APPROVAL = 'AWAITING_APPROVAL',
    EXECUTING = 'EXECUTING',
    VERIFYING = 'VERIFYING',
    INTERRUPTED = 'INTERRUPTED',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
    CANCELLED = 'CANCELLED'
}

export enum CleanSlateTurnIntent {
    APPROVE_PLAN = 'APPROVE_PLAN',
    CONTINUE_CURRENT = 'CONTINUE_CURRENT',
    START_NEW_TASK = 'START_NEW_TASK',
    CANCEL_CURRENT = 'CANCEL_CURRENT',
    RERUN_LAST_TASK = 'RERUN_LAST_TASK',
    REVISE_PLAN = 'REVISE_PLAN'
}
