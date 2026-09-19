/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type CleanSlateAgentRuntime = 'native' | 'external';
export type ExternalApprovalPresentation = 'approval-required' | 'automatic-review' | 'unrestricted';
export type ExternalAgentThoughtPresentation = 'reasoning' | 'summary';
export interface IExternalAgentRegistration {
	readonly id: string;
	readonly name: string;
	readonly command: string;
	readonly args: readonly string[];
}

export interface IExternalAgentUsage {
	readonly detail: string;
	readonly windows: readonly { readonly label: string; readonly usedPercent: number; readonly resetsAt?: number }[];
}

export interface IExternalAgentConfig {
	readonly transport: 'acp';
	readonly agentId: string;
}

export interface IExternalAgentDescriptor {
	readonly id: string;
	readonly name: string;
	readonly transport: 'acp';
	readonly iconPath?: string;
	readonly monochromeIcon?: boolean;
	readonly available: boolean;
	readonly installed?: boolean;
	readonly unavailableReason?: string;
}

export interface IExternalAgentStartRequest {
	readonly hostTools?: { readonly ownerId: string; readonly tools: readonly { readonly name: string; readonly description: string; readonly inputSchema: Record<string, unknown> }[] };
	readonly modelSelection?: { readonly configId: string; readonly value: string };
	readonly cleanSlateSessionId: string;
	readonly config: IExternalAgentConfig;
	readonly cwd?: string;
	readonly externalSessionId?: string;
}

export interface IExternalAgentSessionInfo {
	readonly controls?: readonly { readonly configId: string; readonly name: string; readonly category?: string; readonly current: string; readonly options: readonly { readonly value: string; readonly name: string; readonly description?: string; readonly kind?: ExternalApprovalPresentation }[] }[];
	readonly models?: { readonly configId: string; readonly current: string; readonly options: readonly { readonly value: string; readonly name: string }[] };
	readonly cleanSlateSessionId: string;
	readonly externalSessionId: string;
	readonly config: IExternalAgentConfig;
}

export interface IExternalAgentPromptRequest {
	readonly cleanSlateSessionId: string;
	readonly prompt: string;
	readonly images?: readonly string[];
}

export interface IExternalAgentPermissionOption {
	readonly id: string;
	readonly name: string;
	readonly kind: string;
}

export interface IExternalAgentFileChange {
	readonly path: string;
	readonly beforeContent: string;
	readonly afterContent: string;
	readonly created: boolean;
}

export type IExternalAgentEvent =
	| { readonly type: 'host_tool_cancel'; readonly cleanSlateSessionId: string; readonly ownerId: string; readonly requestId: string }
	| { readonly type: 'host_tool'; readonly cleanSlateSessionId: string; readonly ownerId: string; readonly requestId: string; readonly name: string; readonly input: Record<string, unknown> }
	| { readonly type: 'controls'; readonly cleanSlateSessionId: string; readonly controls: NonNullable<IExternalAgentSessionInfo['controls']>; readonly models?: IExternalAgentSessionInfo['models'] }
	| { readonly type: 'message'; readonly cleanSlateSessionId: string; readonly text: string }
	| { readonly type: 'thought'; readonly cleanSlateSessionId: string; readonly text: string; readonly presentation: ExternalAgentThoughtPresentation }
	| { readonly type: 'tool'; readonly cleanSlateSessionId: string; readonly toolCallId: string; readonly title?: string; readonly status?: string; readonly kind?: string; readonly locations?: readonly string[]; readonly command?: string; readonly output?: string; readonly exitCode?: number; readonly fileChanges?: readonly IExternalAgentFileChange[]; readonly worker?: { readonly name: string; readonly prompt: string } }
	| { readonly type: 'plan'; readonly cleanSlateSessionId: string; readonly entries: readonly { readonly content: string; readonly status: string; readonly priority: string }[] }
	| { readonly type: 'permission'; readonly cleanSlateSessionId: string; readonly requestId: string; readonly title: string; readonly options: readonly IExternalAgentPermissionOption[] }
	| { readonly type: 'usage'; readonly cleanSlateSessionId: string; readonly used?: number; readonly size?: number }
	| { readonly type: 'status'; readonly cleanSlateSessionId: string; readonly status: 'ready' | 'running' | 'completed' | 'cancelled' | 'failed'; readonly detail?: string };

export interface IExternalAgentPermissionResponse {
	readonly requestId: string;
	readonly optionId?: string;
}

export interface IExternalAgentHostToolResponse {
	readonly ownerId: string;
	readonly requestId: string;
	readonly result?: unknown;
	readonly error?: string;
}
