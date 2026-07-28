/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/*
 * Vendored from microsoft/vscode (vs/base/common/marshallingIds.ts) for @slate/sdk.
 * Changes: see packages/slate-sdk/VENDOR.md.
 */

export enum MarshalledId {
	Uri = 1,
	Regexp,
	ScmResource,
	ScmResourceGroup,
	ScmProvider,
	CommentController,
	CommentThread,
	CommentThreadInstance,
	CommentThreadReply,
	CommentNode,
	CommentThreadNode,
	TimelineActionContext,
	NotebookCellActionContext,
	NotebookActionContext,
	TerminalContext,
	TestItemContext,
	Date,
	TestMessageMenuArgs,
	ChatViewContext,
	LanguageModelToolResult,
	LanguageModelTextPart,
	LanguageModelThinkingPart,
	LanguageModelPromptTsxPart,
	LanguageModelDataPart,
	AgentSessionContext,
	ChatResponsePullRequestPart,
}
