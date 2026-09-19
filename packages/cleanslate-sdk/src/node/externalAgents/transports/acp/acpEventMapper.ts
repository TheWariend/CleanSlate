/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { ExternalAgentThoughtPresentation, IExternalAgentEvent } from '../../../../externalAgents/externalAgentTypes.js';

function textOf(content: { type: string; text?: string }): string | undefined {
	if (content.type === 'text') { return content.text; }
	const record = recordOf(content);
	if (content.type === 'image') {
		const mime = stringField(record, 'mimeType');
		const data = stringField(record, 'data');
		if (mime && ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime)
			&& data && data.length <= 8 * 1024 * 1024 && data.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
			return `\n\n![Agent image](data:${mime};base64,${data})\n\n`;
		}
		return '[Agent image could not be displayed: unsupported format, size, or encoding.]';
	}
	if (content.type === 'resource') {
		const resource = recordOf(record?.resource);
		return stringField(resource, 'text') ?? `Resource: ${stringField(resource, 'uri') ?? 'unavailable'}`;
	}
	if (content.type === 'resource_link') { return `Resource: ${stringField(record, 'uri') ?? 'unavailable'}`; }
	return `[Agent returned ${content.type} content; this format is not displayed in the transcript.]`;
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringField(record: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
	for (const key of keys) {
		if (typeof record?.[key] === 'string') { return record[key] as string; }
	}
	return undefined;
}

function numberField(record: Record<string, unknown> | undefined, ...keys: string[]): number | undefined {
	for (const key of keys) {
		if (typeof record?.[key] === 'number') { return record[key] as number; }
	}
	return undefined;
}

export function mapAcpEvent(cleanSlateSessionId: string, update: SessionUpdate, thoughtPresentation: ExternalAgentThoughtPresentation = 'reasoning'): IExternalAgentEvent | undefined {
	switch (update.sessionUpdate) {
		case 'agent_message_chunk':
		case 'agent_thought_chunk': {
			const text = textOf(update.content);
			if (text === undefined) { return undefined; }
			return update.sessionUpdate === 'agent_message_chunk'
				? { type: 'message', cleanSlateSessionId, text }
				: { type: 'thought', cleanSlateSessionId, text, presentation: thoughtPresentation };
		}
		case 'tool_call':
		case 'tool_call_update': {
			const input = recordOf(update.rawInput);
			const output = recordOf(update.rawOutput);
			const metadata = recordOf(output?.metadata);
			const contentOutput = update.content?.flatMap(item => item.type === 'content' ? [textOf(item.content) ?? ''] : item.type === 'terminal' ? [`Terminal: ${item.terminalId}`] : []).join('\n');
			const workerPrompt = stringField(input, 'prompt');
			const workerType = stringField(input, 'subagent_type');
			const worker = workerPrompt && workerType ? { name: stringField(input, 'description') ?? workerType, prompt: workerPrompt } : undefined;
			const fileChanges = update.content?.flatMap(item => item.type === 'diff' ? [{
				path: item.path,
				beforeContent: item.oldText ?? '',
				afterContent: item.newText,
				created: item.oldText === null || item.oldText === undefined
			}] : []) ?? [];
			// Some agents report the same before/after snapshots in structured tool
			// results rather than ACP diff content. Preserve that evidence as well.
			const structuredChanges = [
				...(Array.isArray(output?.fileChanges) ? output.fileChanges : []),
				output?.filediff, metadata?.filediff, output
			];
			for (const value of structuredChanges) {
				const change = recordOf(value);
				const path = stringField(change, 'path', 'file', 'filePath') ?? stringField(input, 'file_path', 'filePath', 'path');
				const before = stringField(change, 'beforeContent', 'before', 'oldText');
				const after = stringField(change, 'afterContent', 'after', 'newText');
				const created = change?.created === true || change?.oldText === null;
				if (path && after !== undefined && (before !== undefined || created) && !fileChanges.some(entry => entry.path === path)) {
					fileChanges.push({ path, beforeContent: before ?? '', afterContent: after, created });
				}
			}
			return {
				type: 'tool', cleanSlateSessionId, toolCallId: update.toolCallId,
				title: update.title ?? undefined, status: update.status ?? undefined, kind: update.kind ?? undefined,
				locations: update.locations?.map(location => location.path) ?? (stringField(input, 'file_path', 'filePath', 'path') ? [stringField(input, 'file_path', 'filePath', 'path')!] : undefined),
				command: stringField(input, 'command', 'cmd'),
				output: contentOutput ? (contentOutput.length <= 12 * 1024 * 1024 ? contentOutput : '[Tool content exceeds the display limit.]') : (typeof update.rawOutput === 'string' ? update.rawOutput : stringField(output, 'output', 'stdout', 'text'))?.slice(-20000),
				exitCode: numberField(output, 'exitCode', 'exit_code', 'code'),
				fileChanges: fileChanges.length ? fileChanges : undefined,
				worker
			};
		}
		case 'plan':
			return { type: 'plan', cleanSlateSessionId, entries: update.entries.map(entry => ({ content: entry.content, status: entry.status, priority: entry.priority })) };
		case 'usage_update':
			return { type: 'usage', cleanSlateSessionId, used: update.used, size: update.size };
		default:
			return undefined;
	}
}
