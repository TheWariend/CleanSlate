/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { createInterface } from 'node:readline';
import { Transform } from 'node:stream';
import * as zlib from 'node:zlib';
import type { IExternalAgentHistoryDiscovery, IExternalAgentHistoryEntry, IExternalAgentHistoryQuery } from '../../externalAgents/externalAgentTypes.js';
import type { ICleanSlatePersistedSession, ICleanSlatePersistedThreadMessage } from '../../protocol/cleanSlateAI.js';

type RecordValue = Record<string, any>;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_HEAD_BYTES = 1024 * 1024;
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const string = (value: unknown): string => typeof value === 'string' ? value : '';
const time = (value: unknown, fallback: number): number => {
	const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
	return Number.isFinite(parsed) ? parsed : fallback;
};

/** Stable across rescans and symlink aliases; separate accounts cannot overwrite one another. */
export function externalAgentHistoryId(source: string, dataHome: string, sessionId: string): string {
	return `import-${source}-${createHash('sha256').update(`${dataHome}\0${sessionId}`).digest('hex').slice(0, 32)}`;
}

async function* jsonLines(file: string, head = false): AsyncGenerator<RecordValue> {
	const compressed = file.endsWith('.zst');
	const decompress = (zlib as unknown as { createZstdDecompress?: () => Transform }).createZstdDecompress;
	if (compressed && !decompress) { throw new Error('This Node version cannot decompress Codex history.'); }
	const input = createReadStream(file, { ...(head && !compressed ? { end: MAX_HEAD_BYTES - 1 } : {}) });
	const decoder = compressed ? decompress!() : undefined;
	let bytes = 0;
	const bounded = new Transform({ transform(chunk: Buffer, _encoding, callback) {
		bytes += chunk.length;
		callback(bytes > MAX_FILE_BYTES ? new Error('Conversation exceeds the 64 MiB import limit.') : null, chunk);
	} });
	input.on('error', error => bounded.destroy(error));
	decoder?.on('error', error => bounded.destroy(error));
	const source = decoder ? input.pipe(decoder) : input;
	source.pipe(bounded);
	const lines = createInterface({ input: bounded, crlfDelay: Infinity });
	let headBytes = 0;
	try {
		for await (const line of lines) {
			headBytes += Buffer.byteLength(line) + 1;
			if (head && headBytes > MAX_HEAD_BYTES) { break; }
			if (!line.trim()) { continue; }
			try { yield record(JSON.parse(line)); }
			catch { yield { type: '$invalid' }; }
		}
	} finally {
		lines.close();
		input.destroy();
		decoder?.destroy();
		bounded.destroy();
	}
}

async function directories(folder: string): Promise<import('node:fs').Dirent[]> {
	try { return await readdir(folder, { withFileTypes: true }); }
	catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return []; } throw error; }
}

async function* codexFiles(folder: string, depth = 0): AsyncGenerator<string> {
	if (depth > 8) { return; }
	for (const entry of await directories(folder)) {
		const file = path.join(folder, entry.name);
		if (entry.isDirectory()) { yield* codexFiles(file, depth + 1); }
		else if (entry.isFile() && /^rollout-.*\.jsonl(?:\.zst)?$/.test(entry.name)) { yield file; }
	}
}

function visibleText(content: unknown): string {
	if (typeof content === 'string') { return content; }
	if (!Array.isArray(content)) { return ''; }
	return content.flatMap(value => {
		const block = record(value);
		return ['text', 'input_text', 'output_text'].includes(block.type) ? [string(block.text)] : [];
	}).join('\n');
}

function isHarnessMessage(text: string): boolean {
	return /^(?:# AGENTS\.md instructions|AGENTS\.md instructions|<environment_context>|<permissions instructions>|<turn_aborted>|<system-reminder>|\[Request interrupted)/.test(text.trim());
}

function promptTitle(text: string): string {
	return isHarnessMessage(text) ? '' : text.trim().split('\n')[0].replace(/^#+\s*/, '').slice(0, 100);
}

async function inspectFile(source: 'claude' | 'codex', dataHome: string, file: string, titles: Map<string, string>): Promise<IExternalAgentHistoryEntry | undefined> {
	const info = await stat(file);
	let sessionId = source === 'claude' ? path.basename(file, '.jsonl') : '';
	let cwd: string | undefined;
	let title = '';
	let createdAt = info.birthtimeMs || info.mtimeMs;
	let conversation = false;
	for await (const line of jsonLines(file, true)) {
		if (source === 'codex' && line.type === 'session_meta') {
			const meta = record(line.payload);
			if (meta.thread_source === 'subagent' || record(meta.source).subagent || record(meta.source).internal) { return; }
			sessionId = string(meta.id);
			cwd = string(meta.cwd) || undefined;
			createdAt = time(meta.timestamp ?? line.timestamp, createdAt);
		}
		if (source === 'claude') {
			if (line.isSidechain) { continue; }
			cwd ??= string(line.cwd) || undefined;
			if (!conversation && (line.type === 'user' || line.type === 'assistant')) {
				createdAt = time(line.timestamp, createdAt);
				conversation = true;
			}
			if (line.type === 'custom-title' || line.type === 'ai-title') { title = string(line.customTitle ?? line.aiTitle) || title; }
			if (!title && line.type === 'user' && !line.isMeta) { title = promptTitle(visibleText(record(line.message).content)); }
		} else if (!title && line.type === 'response_item') {
			const message = record(line.payload);
			if (message.type === 'message' && message.role === 'user') { title = promptTitle(visibleText(message.content)); }
		}
	}
	if (!sessionId || source === 'claude' && !conversation) { return; }
	return {
		id: externalAgentHistoryId(source, dataHome, sessionId), source, sessionId, dataHome, path: file,
		title: titles.get(sessionId) || title || `${source === 'claude' ? 'Claude' : 'Codex'} conversation`, cwd,
		createdAt, updatedAt: info.mtimeMs
	};
}

/** Reads local history only. Credentials and source files are never changed. */
export async function discoverExternalAgentHistory(query: IExternalAgentHistoryQuery = {}, env: NodeJS.ProcessEnv = process.env): Promise<IExternalAgentHistoryDiscovery> {
	if (query.source && !['claude', 'codex'].includes(query.source)) { throw new Error('Choose Claude or Codex.'); }
	if (query.dataHome && (!query.source || !path.isAbsolute(query.dataHome))) { throw new Error('Choose an agent and an absolute data folder.'); }
	if (query.projectRoot && !path.isAbsolute(query.projectRoot)) { throw new Error('The project folder must be an absolute local path.'); }
	const projectRoot = query.projectRoot ? await realpath(query.projectRoot) : undefined;
	const cwdCache = new Map<string, string>();
	const belongsToProject = async (cwd: string | undefined): Promise<boolean> => {
		if (!projectRoot) { return true; }
		if (!cwd || !path.isAbsolute(cwd)) { return false; }
		let canonical = cwdCache.get(cwd);
		if (!canonical) {
			canonical = await realpath(cwd).catch(() => path.resolve(cwd));
			cwdCache.set(cwd, canonical);
		}
		const relative = path.relative(projectRoot, canonical);
		return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
	};
	const sessions: IExternalAgentHistoryEntry[] = [];
	const warnings: string[] = [];
	for (const source of query.source ? [query.source] : ['claude', 'codex'] as const) {
		const standardHome = path.join(homedir(), `.${source}`);
		const configuredHome = source === 'claude' ? env.CLAUDE_CONFIG_DIR : env.CODEX_HOME;
		const roots = query.dataHome ? [query.dataHome] : [...new Set([configuredHome || standardHome, ...(query.includeDefaultHomes ? [standardHome] : [])])];
		const seenRoots = new Set<string>();
		for (let root of roots) {
		try {
			root = await realpath(root);
			if (seenRoots.has(root)) { continue; }
			seenRoots.add(root);
			const titles = new Map<string, string>();
			if (source === 'codex') {
				try {
					for await (const line of jsonLines(path.join(root, 'session_index.jsonl'))) {
						if (string(line.id) && string(line.thread_name)) { titles.set(line.id, line.thread_name); }
					}
				} catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { warnings.push('Codex titles could not be read; using conversation text.'); } }
			}
			const files: string[] = [];
			if (source === 'claude') {
				for (const project of await directories(path.join(root, 'projects'))) {
					if (!project.isDirectory()) { continue; }
					for (const file of await directories(path.join(root, 'projects', project.name))) {
						if (file.isFile() && file.name.endsWith('.jsonl') && !file.name.startsWith('agent-')) { files.push(path.join(root, 'projects', project.name, file.name)); }
					}
				}
			} else {
				for (const folder of ['sessions', 'archived_sessions']) {
					for await (const file of codexFiles(path.join(root, folder))) { files.push(file); }
				}
			}
			for (const file of files) {
				try {
					const entry = await inspectFile(source, root, file, titles);
					if (entry && await belongsToProject(entry.cwd)) { sessions.push(entry); }
				} catch { warnings.push(`Could not read ${path.basename(file)}.`); }
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { warnings.push(`Could not read the ${source === 'claude' ? 'Claude' : 'Codex'} data folder.`); }
		}
		}
	}
	const unique = new Map<string, IExternalAgentHistoryEntry>();
	for (const entry of sessions) {
		if (!unique.has(entry.id) || unique.get(entry.id)!.updatedAt < entry.updatedAt) { unique.set(entry.id, entry); }
	}
	return { sessions: [...unique.values()].sort((a, b) => b.updatedAt - a.updatedAt), warnings };
}

interface ITimelineBlock { id: string; type: string; content?: string; [key: string]: unknown }

/** Convert display history while keeping the native session id for the agent's own context. */
export async function readExternalAgentHistory(entry: IExternalAgentHistoryEntry): Promise<{ session: ICleanSlatePersistedSession; warnings: string[] }> {
	if (!['claude', 'codex'].includes(entry.source) || !path.isAbsolute(entry.dataHome) || !path.isAbsolute(entry.path)) { throw new Error('Invalid conversation source.'); }
	const root = await realpath(entry.dataHome);
	const file = await realpath(entry.path);
	const relative = path.relative(root, file);
	const parts = relative.split(path.sep);
	const allowed = entry.source === 'claude'
		? parts.length === 3 && parts[0] === 'projects' && !parts[2].startsWith('agent-') && parts[2].endsWith('.jsonl')
		: ['sessions', 'archived_sessions'].includes(parts[0]) && /^rollout-.*\.jsonl(?:\.zst)?$/.test(path.basename(file));
	if (!allowed || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) { throw new Error('Conversation is outside the selected agent data folder.'); }
	if ((await stat(file)).size > MAX_FILE_BYTES) { throw new Error('Conversation exceeds the 64 MiB import limit.'); }
	const verified = await inspectFile(entry.source, root, file, new Map());
	if (!verified || verified.sessionId !== entry.sessionId || verified.id !== entry.id) { throw new Error('Conversation identity changed. Scan the folder again.'); }
	const records: RecordValue[] = [];
	const warnings: string[] = [];
	let title = entry.title;
	for await (const line of jsonLines(file)) {
		if (line.type === '$invalid') { if (!warnings.length) { warnings.push('Some incomplete or invalid history lines were skipped.'); } continue; }
		if (entry.source === 'claude' && (line.type === 'custom-title' || line.type === 'ai-title')) { title = string(line.customTitle ?? line.aiTitle) || title; }
		if (entry.source === 'claude' && !line.isSidechain) {
			if (line.type === 'user' || line.type === 'assistant') { records.push(line); }
			else if (string(line.uuid)) {
				// Attachments and system rows can connect two visible messages.
				records.push({ type: line.type, uuid: line.uuid, parentUuid: line.parentUuid, logicalParentUuid: line.logicalParentUuid });
			}
		}
		if (entry.source === 'codex' && line.type === 'response_item') { records.push(record(line.payload)); }
	}
	let selected = records;
	if (entry.source === 'claude') {
		// JSONL files can contain multiple branches. Walk the latest branch by UUID.
		const nodes = new Map(records.filter(line => string(line.uuid)).map(line => [line.uuid, line]));
		const latest = records.filter(line => line.type === 'user' || line.type === 'assistant').at(-1);
		if (latest && nodes.has(latest.uuid)) {
			const chain: RecordValue[] = [];
			const visited = new Set<string>();
			let node: RecordValue | undefined = latest;
			while (node && !visited.has(node.uuid)) {
				visited.add(node.uuid); chain.push(node);
				node = nodes.get(node.parentUuid ?? node.logicalParentUuid);
			}
			selected = chain.reverse();
		}
	}
	const history: ICleanSlatePersistedThreadMessage[] = [];
	const tools = new Map<string, { block: ITimelineBlock; message: number }>();
	const timelines = new Map<number, ITimelineBlock[]>();
	const push = (role: string, content: string, images?: string[], blocks: ITimelineBlock[] = []) => {
		if (!content.trim() && !images?.length && !blocks.length) { return; }
		history.push({ role, content, ...(images?.length ? { images } : {}) });
		if (blocks.length) { timelines.set(history.length - 1, blocks); }
	};
	const result = (id: string, output: unknown, failed = false) => {
		const tool = tools.get(id);
		if (!tool) { return; }
		const text = typeof output === 'string' ? output : JSON.stringify(output) ?? '';
		tool.block.output = text;
		tool.block.toolStatus = failed ? 'failed' : 'completed';
		const old = history[tool.message];
		history[tool.message] = { ...old, content: `${old.content}\nTool result (${id}):\n${text}` };
	};
	for (const item of selected) {
		const message = entry.source === 'claude' ? record(item.message) : item;
		if (entry.source === 'claude' && (!['user', 'assistant'].includes(item.type) || item.isMeta)) { continue; }
		if (entry.source === 'codex' && ['function_call_output', 'custom_tool_call_output'].includes(message.type)) { result(string(message.call_id), message.output); continue; }
		if (entry.source === 'codex' && ['function_call', 'custom_tool_call'].includes(message.type)) {
			const id = string(message.call_id);
			const name = string(message.name);
			const input = string(message.arguments ?? message.input);
			const block: ITimelineBlock = { id, type: 'tool', toolCallId: id, toolName: name, content: name, toolStatus: 'failed', details: [input], output: 'No tool result was recorded.', externalTool: true };
			push('assistant', `Tool: ${name}\n${input}`, undefined, [block]);
			tools.set(id, { block, message: history.length - 1 });
			continue;
		}
		if (entry.source === 'codex' && message.type === 'reasoning') {
			const summary = visibleText(message.summary?.map((part: RecordValue) => ({ type: 'text', text: part.text })));
			if (summary) { push('assistant', '', undefined, [{ id: `reasoning-${history.length}`, type: 'reasoning', content: summary }]); }
			continue;
		}
		if (entry.source === 'codex' && message.type !== 'message') { continue; }
		if (!['user', 'assistant'].includes(message.role)) { continue; }
		const content = message.content;
		let text = visibleText(content);
		const images: string[] = [];
		const blocks: ITimelineBlock[] = [];
		const newTools: { id: string; block: ITimelineBlock }[] = [];
		for (const value of Array.isArray(content) ? content : []) {
			const block = record(value);
			if (['text', 'input_text', 'output_text'].includes(block.type) && message.role === 'assistant') { blocks.push({ id: `text-${history.length}-${blocks.length}`, type: 'assistant_text', content: string(block.text) }); }
			if (block.type === 'image' && record(block.source).type === 'base64') {
				const source = record(block.source);
				if (/^image\/[\w.+-]+$/.test(string(source.media_type)) && /^[A-Za-z0-9+/=\s]+$/.test(string(source.data))) { images.push(`data:${source.media_type};base64,${source.data}`); }
			}
			if (block.type === 'input_image' && /^data:image\/[\w.+-]+;base64,/.test(string(block.image_url))) { images.push(block.image_url); }
			if (block.type === 'thinking' && string(block.thinking)) { blocks.push({ id: `thought-${history.length}-${blocks.length}`, type: 'reasoning', content: block.thinking }); }
			if (block.type === 'tool_result') { result(string(block.tool_use_id), block.content, block.is_error === true); }
			if (block.type === 'tool_use') {
				const id = string(block.id), name = string(block.name), input = JSON.stringify(block.input ?? {});
				const tool: ITimelineBlock = { id, type: 'tool', toolCallId: id, toolName: name, content: name, toolStatus: 'failed', details: [input], output: 'No tool result was recorded.', externalTool: true };
				blocks.push(tool); newTools.push({ id, block: tool });
				text += `\nTool: ${name}\n${input}`;
			}
		}
		if (message.role === 'user' && isHarnessMessage(text)) { continue; }
		const index = history.length;
		push(message.role, text, images, blocks);
		for (const tool of newTools) { tools.set(tool.id, { block: tool.block, message: index }); }
	}
	for (const [index, timeline] of timelines) {
		history[index] = { ...history[index], renderPayload: JSON.stringify({ response: history[index].content, timeline }) };
	}
	if (!history.some(message => message.role === 'user' || message.role === 'assistant')) { throw new Error('No readable conversation messages were found.'); }
	const cwd = verified.cwd;
	return {
		session: {
			id: verified.id, title, createdAt: verified.createdAt, updatedAt: verified.updatedAt, savedAt: verified.updatedAt,
			workspaceId: cwd, projectRoot: cwd, workDir: cwd,
			workspaceName: cwd ? path.basename(cwd) : undefined, status: 'detached', isGenerating: false,
			history, transcript: history, transcriptVersion: 1, runtime: 'external',
			externalAgent: { transport: 'acp', agentId: entry.source, dataHome: root }, externalAgentSessionId: verified.sessionId
		}, warnings
	};
}
