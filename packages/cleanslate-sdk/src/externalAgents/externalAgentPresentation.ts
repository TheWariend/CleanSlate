/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ICleanSlatePersistedThreadMessage } from '../protocol/cleanSlateAI.js';

interface DisplayBlock { id: string; type: string; content?: string; externalTool?: boolean }
interface DisplayPayload { timeline: DisplayBlock[]; transcriptStatus?: string; planning_question?: unknown; to_do?: unknown[]; code_snippet?: string }

function displayPayload(message: ICleanSlatePersistedThreadMessage): DisplayPayload | undefined {
	if (!message.renderPayload) { return undefined; }
	try {
		const value = JSON.parse(message.renderPayload) as DisplayPayload;
		if (Array.isArray(value?.timeline) && value.timeline.every(block => block && typeof block.id === 'string' && typeof block.type === 'string')) { return value; }
	} catch { /* Keep malformed history as its original message. */ }
	return undefined;
}

/** Imported agents store one protocol item per row. Present one assistant turn
 * across those rows without changing the history used for agent handoffs. Also
 * works on imports saved before this projection existed. */
export function coalesceExternalAgentTranscript(history: readonly ICleanSlatePersistedThreadMessage[]): ICleanSlatePersistedThreadMessage[] {
	const transcript: ICleanSlatePersistedThreadMessage[] = [];
	let segment: { message: ICleanSlatePersistedThreadMessage; payload?: DisplayPayload; index: number }[] = [];
	const flush = () => {
		if (segment.length > 1 && segment.some(item => item.payload?.timeline.some(block => block.externalTool))) {
			const timeline = segment.flatMap(({ message, payload, index }) => payload?.timeline ?? (message.content.trim()
				? [{ id: `external-text-${index}`, type: 'assistant_text', content: message.content }] : []));
			const content = timeline.filter(block => block.type === 'assistant_text').map(block => block.content ?? '').join('\n\n');
			transcript.push({
				...segment[0].message, content,
				renderPayload: JSON.stringify({ response: content, timeline, transcriptStatus: segment.some(item => item.payload?.transcriptStatus === 'interrupted') ? 'interrupted' : 'completed' })
			});
		} else { transcript.push(...segment.map(item => item.message)); }
		segment = [];
	};
	for (const [index, message] of history.entries()) {
		if (message.role === 'user' && !message.images?.length && message.content.includes('<external_codex_apps_open_page>') && !externalAgentDisplayText(message.content).trim()) { continue; }
		const payload = displayPayload(message);
		const eligible = (message.role === 'assistant' || message.role === 'cleanSlate')
			&& !message.isInternalState && !message.images?.length && !message.id?.startsWith('hosted-')
			&& !/^Conversation handed off to /.test(message.content)
			&& (!message.renderPayload || !!payload && payload.timeline.length > 0 && !payload.planning_question
				&& !payload.to_do?.length && !payload.code_snippet && !payload.timeline.some(block => block.type === 'turn'));
		if (eligible) { segment.push({ message, payload, index }); }
		else { flush(); transcript.push(message); }
	}
	flush();
	return transcript;
}

/** Codex desktop navigation markers have no UI action in ACP. Hide them only
 * in prose; code examples and the original provider transcript stay intact. */
export function externalAgentDisplayText(text: string, isStreaming = false): string {
	if (!text.includes(isStreaming ? '<external_' : '<external_codex_apps_')) { return text; }
	const opening = '<external_codex_apps_open_page>';
	const closing = '</external_codex_apps_open_page>';
	let fence: string | undefined;
	let inMarker = false;
	const visible: string[] = [];
	const lines = text.split(/(?<=\n)/);
	for (const [index, line] of lines.entries()) {
		const delimiter = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
		if (!inMarker && delimiter) {
			if (!fence) { fence = delimiter; }
			else if (delimiter[0] === fence[0] && delimiter.length >= fence.length && /^\s*$/.test(line.slice(line.indexOf(delimiter) + delimiter.length))) { fence = undefined; }
			visible.push(line);
			continue;
		}
		if (!inMarker && (fence || /^(?: {4}|\t)/.test(line))) { visible.push(line); continue; }
		if (inMarker || line.trimStart().startsWith(opening)) {
			const end = line.indexOf(closing);
			inMarker = end < 0;
			if (end >= 0) { visible.push(line.slice(end + closing.length)); }
			continue;
		}
		const partial = line.trim();
		if (isStreaming && index === lines.length - 1 && partial.startsWith('<external_') && opening.startsWith(partial)) { continue; }
		visible.push(line);
	}
	return visible.join('');
}
