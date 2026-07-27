/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { normalizeChatResponse } from './cleanSlateChatResponseNormalizer.js';
import type { ChatResponse, InteractionBlock } from '../types/cleanSlateChatTypes.js';

const MAX_TRANSCRIPT_RENDER_PAYLOAD_CHARS = 80_000;

export function stringifyCleanSlateTranscriptRenderPayload(data: ChatResponse, isStreaming: boolean, options: { preserveStreamingState?: boolean } = {}): string | undefined {
	const normalized = options.preserveStreamingState
		? normalizeChatResponse(data)
		: toPersistableCleanSlateTranscriptPayload(normalizeChatResponse(data), isStreaming);
	const hasSummary = Array.isArray(normalized.summary)
		? normalized.summary.some(summary => typeof summary === 'string' && summary.trim().length > 0)
		: typeof normalized.summary === 'string' && normalized.summary.trim().length > 0;
	const hasTimeline = Array.isArray(normalized.timeline) && normalized.timeline.length > 0;
	const hasToDo = Array.isArray(normalized.to_do) && normalized.to_do.length > 0;
	const hasCode = typeof normalized.code_snippet === 'string' && normalized.code_snippet.trim().length > 0;
	const hasPlanningQuestion = !!normalized.planning_question;
	const hasTerminalOutputs = !!normalized.terminal_outputs && Object.keys(normalized.terminal_outputs).length > 0;
	if (!hasSummary && !hasTimeline && !hasToDo && !hasCode && !hasPlanningQuestion && !hasTerminalOutputs) {
		return undefined;
	}

	try {
		const serialized = JSON.stringify(normalized);
		if (serialized.length <= MAX_TRANSCRIPT_RENDER_PAYLOAD_CHARS) {
			return serialized;
		}

		const reduced: ChatResponse = {
			...normalized,
			terminal_outputs: undefined,
			timeline: Array.isArray(normalized.timeline)
				? normalized.timeline.slice(-50).map(block => ({
					...block,
					output: typeof block.output === 'string' ? block.output.slice(0, 4_000) : block.output,
					details: Array.isArray(block.details) ? block.details.slice(0, 16) : block.details,
					browserScreenshots: undefined,
					isStreaming: false
				}))
				: undefined
		};
		return JSON.stringify(reduced);
	} catch {
		return undefined;
	}
}

export function toPersistableCleanSlateTranscriptPayload(data: ChatResponse, isStreaming: boolean): ChatResponse {
	const hasTimeline = Array.isArray(data.timeline) && data.timeline.length > 0;
	return {
		...data,
		transcriptStatus: hasTimeline
			? isStreaming ? 'interrupted' : data.transcriptStatus ?? 'completed'
			: data.transcriptStatus,
		timeline: Array.isArray(data.timeline)
			? data.timeline.map(block => toPersistableCleanSlateTranscriptBlock(block, isStreaming))
			: data.timeline
	};
}

function toPersistableCleanSlateTranscriptBlock(block: InteractionBlock, isStreamingSnapshot: boolean): InteractionBlock {
	const shouldMarkInterrupted = isStreamingSnapshot && isActiveStreamingBlock(block);
	const children = Array.isArray(block.blocks)
		? block.blocks.map(child => toPersistableCleanSlateTranscriptBlock(child, isStreamingSnapshot))
		: undefined;
	return {
		...block,
		isStreaming: false,
		status: shouldMarkInterrupted ? 'Interrupted' : block.status,
		toolStatus: shouldMarkInterrupted && block.toolStatus === 'running' ? 'completed' : block.toolStatus,
		browserStatus: shouldMarkInterrupted && block.browserStatus === 'running' ? 'completed' : block.browserStatus,
		webStatus: shouldMarkInterrupted && block.webStatus === 'running' ? 'completed' : block.webStatus,
		blocks: children ?? block.blocks
	};
}

function isActiveStreamingBlock(block: InteractionBlock): boolean {
	const status = (block.status || '').toLowerCase();
	return block.isStreaming === true
		|| block.toolStatus === 'running'
		|| block.browserStatus === 'running'
		|| block.webStatus === 'running'
		|| status.endsWith('...')
		|| status === 'running'
		|| status === 'executing'
		|| status === 'starting';
}
