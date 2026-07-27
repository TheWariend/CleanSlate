/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChatResponse, InteractionBlock } from '../types/cleanSlateChatTypes.js';

export interface ICleanSlateAgentDisplayPolicyOptions {
	readonly isStreaming: boolean;
	readonly preserveTimeline?: boolean;
}

export function applyCleanSlateAgentDisplayPolicy(
	response: ChatResponse,
	options: ICleanSlateAgentDisplayPolicyOptions
): ChatResponse {
	if (!Array.isArray(response.timeline) || response.timeline.length === 0) {
		return response;
	}

	const visibleTimeline = filterTimeline(response.timeline, {
		...options,
		suppressSummaryBlocks: hasAssistantTextBlock(response.timeline)
	});
	const hasVisibleOutcome = visibleTimeline.some(block => isOutcomeBlock(block));

	if (!options.isStreaming && !hasVisibleOutcome && visibleTimeline.length === 0) {
		const fallbackActivity = response.timeline.find(block => isExplorationBlock(block));
		if (fallbackActivity) {
			return {
				...response,
				timeline: [fallbackActivity]
			};
		}
	}

	return {
		...response,
		timeline: visibleTimeline
	};
}

interface ICleanSlateResolvedDisplayPolicyOptions extends ICleanSlateAgentDisplayPolicyOptions {
	readonly suppressSummaryBlocks: boolean;
}

function filterTimeline(blocks: readonly InteractionBlock[], options: ICleanSlateResolvedDisplayPolicyOptions): InteractionBlock[] {
	return blocks
		.map(block => filterBlock(block, options))
		.filter((block): block is InteractionBlock => !!block);
}

function filterBlock(block: InteractionBlock, options: ICleanSlateResolvedDisplayPolicyOptions): InteractionBlock | undefined {
	if (block.type === 'turn') {
		const childBlocks = filterTimeline(block.blocks || [], options);
		if (childBlocks.length > 0) {
			return {
				...block,
				blocks: childBlocks
			};
		}

		return block.isStreaming || options.isStreaming ? { ...block, blocks: [] } : undefined;
	}

	if (block.type === 'file' && isExplorationBlock(block)) {
		return shouldShowExplorationBlock(block, options) ? block : undefined;
	}

	return shouldShowBlock(block, options) ? block : undefined;
}

function shouldShowBlock(block: InteractionBlock, options: ICleanSlateResolvedDisplayPolicyOptions): boolean {
	switch (block.type) {
		case 'summary':
			return !options.suppressSummaryBlocks
				&& typeof block.content === 'string'
				&& block.content.trim().length > 0;
		case 'assistant_text':
			return typeof block.content === 'string' && block.content.trim().length > 0;
		case 'reasoning':
			return typeof block.content === 'string' && block.content.trim().length > 0;
		case 'finish':
			return typeof block.content === 'string' && block.content.trim().length > 0
				|| (Array.isArray(block.fileChanges) && block.fileChanges.length > 0);
		case 'terminal':
			return isImportantTerminalBlock(block, options);
		case 'file':
			return isInterruptedBlock(block)
				|| isMutationFileBlock(block)
				|| block.isStreaming === true
				|| options.preserveTimeline === true && hasFileActivity(block)
				|| isFailedBlock(block);
		case 'browser':
			return isImportantBrowserBlock(block, options);
		case 'web':
			return isImportantWebBlock(block, options);
		case 'tool':
			return false;
		default:
			return false;
	}
}

function shouldShowExplorationBlock(block: InteractionBlock, options: ICleanSlateAgentDisplayPolicyOptions): boolean {
	if (block.id.startsWith('context-usage-')) {
		return false;
	}
	// These are explicit context lifecycle diagnostics, not ordinary discovery
	// activity. Keep them in the transcript after a turn completes so the user
	// can audit why compaction did (or did not) happen.
	if (block.id.startsWith('context-compaction-')) {
		return true;
	}
	return options.isStreaming
		|| options.preserveTimeline === true && hasFileActivity(block)
		|| block.isStreaming === true
		|| isFailedBlock(block);
}

function isOutcomeBlock(block: InteractionBlock): boolean {
	if (block.type === 'turn') {
		return (block.blocks || []).some(child => isOutcomeBlock(child));
	}

	return block.type === 'summary'
		|| block.type === 'assistant_text'
		|| block.type === 'reasoning'
		|| block.type === 'finish'
		|| isMutationFileBlock(block)
		|| isInterruptedBlock(block)
		|| isFailedBlock(block)
		|| block.awaitingApproval === true
		|| block.type === 'terminal'
		|| (block.type === 'browser' && hasBrowserEvidence(block))
		|| (block.type === 'web' && hasWebEvidence(block));
}

function isExplorationBlock(block: InteractionBlock): boolean {
	if (block.type !== 'file') {
		return false;
	}

	const status = (block.status || '').toLowerCase();
	const hasDetails = Array.isArray(block.details) && block.details.length > 0;
	const hasSearches = typeof block.searchCount === 'number' && block.searchCount > 0;
	const hasReads = typeof block.fileCount === 'number' && block.fileCount > 0;

	return block.id.startsWith('group-activity-block')
		|| block.id.startsWith('context-compaction-')
		|| block.id.startsWith('context-usage-')
		|| status === 'read'
		|| status === 'analyzed'
		|| status === 'analyzing...'
		|| status === 'explored'
		|| status === 'exploring...'
		|| (hasDetails && (hasSearches || hasReads));
}

function isMutationFileBlock(block: InteractionBlock): boolean {
	if (block.type !== 'file') {
		return false;
	}

	const status = (block.status || '').toLowerCase();
	return status === 'creating...'
		|| status === 'editing...'
		|| status === 'created'
		|| status === 'edited'
		|| status === 'modified'
		|| typeof block.added === 'number' && block.added > 0
		|| typeof block.deleted === 'number' && block.deleted > 0
		|| Array.isArray(block.fileChanges) && block.fileChanges.length > 0;
}

function isImportantTerminalBlock(block: InteractionBlock, options: ICleanSlateAgentDisplayPolicyOptions): boolean {
	if (block.type !== 'terminal') {
		return false;
	}

	const command = typeof block.command === 'string' ? block.command.trim() : '';
	const output = typeof block.output === 'string' ? block.output.trim() : '';
	const exitCode = typeof block.exitCode === 'number' ? block.exitCode : undefined;
	const status = (block.status || '').toLowerCase();

	return block.awaitingApproval === true
		|| block.interactiveRisk === true
		|| isInterruptedBlock(block)
		|| block.isStreaming === true
		|| options.preserveTimeline === true && command.length > 0
		|| options.isStreaming && command.length > 0
		|| status === 'waiting_input'
		|| status === 'likely_waiting'
		|| exitCode !== undefined && exitCode !== 0
		|| output.length > 0 && command.length > 0;
}

function isImportantBrowserBlock(block: InteractionBlock, options: ICleanSlateAgentDisplayPolicyOptions): boolean {
	if (block.type !== 'browser') {
		return false;
	}

	if (block.browserToolName === 'browser_get_url' || block.browserToolName === 'browser_wait') {
		return false;
	}

	return block.browserStatus === 'failed'
		|| isInterruptedBlock(block)
		|| block.browserStatus === 'running'
		|| block.isStreaming === true
		|| options.preserveTimeline === true && hasBrowserActivity(block)
		|| options.isStreaming && typeof block.browserAction === 'string' && block.browserAction.trim().length > 0
		|| hasBrowserEvidence(block);
}

function hasBrowserActivity(block: InteractionBlock): boolean {
	return block.type === 'browser'
		&& (typeof block.browserAction === 'string' && block.browserAction.trim().length > 0
			|| typeof block.browserToolName === 'string' && block.browserToolName.trim().length > 0
			|| hasBrowserEvidence(block));
}

function hasFileActivity(block: InteractionBlock): boolean {
	return block.type === 'file'
		&& (typeof block.path === 'string' && block.path.trim().length > 0
			|| typeof block.status === 'string' && block.status.trim().length > 0
			|| typeof block.content === 'string' && block.content.trim().length > 0
			|| Array.isArray(block.details) && block.details.length > 0
			|| Array.isArray(block.fileChanges) && block.fileChanges.length > 0);
}

function hasBrowserEvidence(block: InteractionBlock): boolean {
	return typeof block.browserUrl === 'string' && block.browserUrl.trim().length > 0
		|| typeof block.browserTitle === 'string' && block.browserTitle.trim().length > 0
		|| Array.isArray(block.details) && block.details.length > 0
		|| Array.isArray(block.browserScreenshots) && block.browserScreenshots.length > 0;
}

function isImportantWebBlock(block: InteractionBlock, options: ICleanSlateAgentDisplayPolicyOptions): boolean {
	if (block.type !== 'web') {
		return false;
	}

	return block.webStatus === 'failed'
		|| isInterruptedBlock(block)
		|| block.webStatus === 'running'
		|| block.isStreaming === true
		|| options.preserveTimeline === true && hasWebActivity(block)
		|| options.isStreaming && typeof block.webAction === 'string' && block.webAction.trim().length > 0
		|| hasWebEvidence(block);
}

function hasWebActivity(block: InteractionBlock): boolean {
	return block.type === 'web'
		&& (typeof block.webAction === 'string' && block.webAction.trim().length > 0
			|| typeof block.webToolName === 'string' && block.webToolName.trim().length > 0
			|| hasWebEvidence(block));
}

function hasWebEvidence(block: InteractionBlock): boolean {
	return typeof block.webQuery === 'string' && block.webQuery.trim().length > 0
		|| typeof block.webUrl === 'string' && block.webUrl.trim().length > 0
		|| typeof block.webFinalUrl === 'string' && block.webFinalUrl.trim().length > 0
		|| typeof block.webTitle === 'string' && block.webTitle.trim().length > 0
		|| typeof block.webContentPreview === 'string' && block.webContentPreview.trim().length > 0
		|| Array.isArray(block.webResults) && block.webResults.length > 0
		|| Array.isArray(block.details) && block.details.length > 0;
}

function isFailedBlock(block: InteractionBlock): boolean {
	const status = (block.status || '').toLowerCase();
	return status === 'failed'
		|| block.exitCode !== undefined && block.exitCode !== 0
		|| block.browserStatus === 'failed'
		|| block.webStatus === 'failed';
}

function isInterruptedBlock(block: InteractionBlock): boolean {
	return (block.status || '').toLowerCase() === 'interrupted';
}

function hasAssistantTextBlock(blocks: readonly InteractionBlock[]): boolean {
	for (const block of blocks) {
		if (block.type === 'assistant_text' && typeof block.content === 'string' && block.content.trim().length > 0) {
			return true;
		}
		if (block.type === 'turn' && Array.isArray(block.blocks) && hasAssistantTextBlock(block.blocks)) {
			return true;
		}
	}

	return false;
}
