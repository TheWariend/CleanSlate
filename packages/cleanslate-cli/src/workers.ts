/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ICleanSlateChildAgentEvent, ICleanSlateChildAgentSnapshot } from '@cleanslate/sdk/node';
import { transcriptEntry, type ICliTranscriptEntry } from './sessions.js';
import { sanitizeToolResultForRenderer } from '@cleanslate/sdk/agent/cleanSlateToolResultPromptSerializer.js';

export interface CliWorker {
	agent: ICleanSlateChildAgentSnapshot;
	transcript: ICliTranscriptEntry[];
}

export function updateWorkers(workers: readonly CliWorker[], event: ICleanSlateChildAgentEvent): CliWorker[] {
	const previous = workers.find(worker => worker.agent.id === event.agent.id);
	let transcript = previous?.transcript.slice() ?? [transcriptEntry('user', event.agent.prompt)];
	const part = event.streamPart;
	if (part?.type === 'chat_text' || part?.type === 'text') {
		const last = transcript.at(-1);
		if (last?.kind === 'assistant') {
			transcript[transcript.length - 1] = { ...last, content: last.content + part.content };
		} else {
			transcript.push(transcriptEntry('assistant', part.content));
		}
	} else if (part?.type === 'tool_start') {
		transcript.push(transcriptEntry('tool', '', { id: part.toolCallId, toolName: part.toolName, status: 'running', detail: { input: part.input } }));
	} else if (part?.type === 'tool_result') {
		const index = transcript.findIndex(entry => entry.kind === 'tool' && entry.id === part.toolCallId);
		const started = index >= 0 ? transcript[index] : undefined;
		const finished = transcriptEntry('tool', '', {
			id: part.toolCallId,
			toolName: part.toolName,
			status: part.result?.success === false ? 'failed' : 'completed',
			durationMs: started ? Date.now() - started.timestamp : undefined,
			detail: { input: (started?.detail as { input?: unknown } | undefined)?.input, result: sanitizeToolResultForRenderer(part.toolName, part.result) }
		});
		if (index >= 0) { transcript[index] = finished; } else { transcript.push(finished); }
	} else if (!part && event.delta) {
		transcript.push(transcriptEntry('assistant', event.delta));
	}
	if (event.type === 'failed' && event.agent.error) {
		transcript.push(transcriptEntry('error', event.agent.error));
	}
	if (event.type === 'completed' && event.agent.output && !transcript.some(entry => entry.kind === 'assistant')) {
		transcript.push(transcriptEntry('assistant', event.agent.output));
	}
	const updated = { agent: event.agent, transcript };
	return previous ? workers.map(worker => worker.agent.id === event.agent.id ? updated : worker) : [...workers, updated];
}
