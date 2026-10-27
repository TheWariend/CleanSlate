/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as zlib from 'node:zlib';
import { discoverExternalAgentHistory, readExternalAgentHistory } from '../node/externalAgents/externalAgentHistory.js';
import { ExternalAgentRegistry, ExternalAgentService } from '../node/externalAgents/index.js';
import { createExternalAgentHandoffPrompt } from '../externalAgents/handoff.js';

const jsonl = (values: unknown[]) => values.map(value => JSON.stringify(value)).join('\n') + '\n';
async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), 'cleanslate-history-'));
	const claude = join(directory, 'claude');
	const codex = join(directory, 'codex');
	await mkdir(join(claude, 'projects', 'project'), { recursive: true });
	await mkdir(join(codex, 'sessions', '2026'), { recursive: true });
	await mkdir(join(codex, 'archived_sessions'), { recursive: true });
	return { directory, claude, codex, env: { CLAUDE_CONFIG_DIR: claude, CODEX_HOME: codex } };
}

test('discovers both accounts, archives and titles, excludes subagents, and does not modify source history', async () => {
	const f = await fixture();
	try {
		const claudeFile = join(f.claude, 'projects', 'project', 'claude-one.jsonl');
		const original = jsonl([
			{ type: 'user', uuid: 'u', parentUuid: null, cwd: f.directory, timestamp: '2026-10-01T00:00:00Z', message: { role: 'user', content: 'Fix the login' } },
			{ type: 'assistant', uuid: 'a', parentUuid: 'u', message: { role: 'assistant', content: [{ type: 'text', text: 'Fixed it' }] } },
			{ type: 'custom-title', customTitle: 'Login repair' }
		]);
		await writeFile(claudeFile, original);
		await writeFile(join(f.claude, 'projects', 'project', 'agent-worker.jsonl'), original);
		const codex = (id: string, source: unknown = 'cli') => jsonl([
			{ type: 'session_meta', payload: { id, cwd: f.directory, source, timestamp: '2026-10-01T00:00:00Z' } },
			{ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Build a site' }] } }
		]);
		await writeFile(join(f.codex, 'sessions', '2026', 'rollout-main.jsonl'), codex('codex-one'));
		await writeFile(join(f.codex, 'archived_sessions', 'rollout-archived.jsonl'), codex('codex-old'));
		await writeFile(join(f.codex, 'sessions', '2026', 'rollout-worker.jsonl'), codex('worker', { subagent: { thread_spawn: {} } }));
		await writeFile(join(f.codex, 'session_index.jsonl'), jsonl([{ id: 'codex-one', thread_name: 'Old title' }, { id: 'codex-one', thread_name: 'Website' }]));
		const found = await discoverExternalAgentHistory({}, f.env);
		assert.equal(found.sessions.length, 3);
		assert.deepEqual(found.warnings, []);
		assert.equal(found.sessions.find(session => session.sessionId === 'codex-one')?.title, 'Website');
		const entry = found.sessions.find(session => session.source === 'claude')!;
		const { session } = await readExternalAgentHistory(entry);
		assert.equal(session.title, 'Login repair');
		assert.deepEqual(session.history.map(message => message.content), ['Fix the login', 'Fixed it']);
		assert.equal(session.externalAgentSessionId, 'claude-one');
		assert.deepEqual(session.externalAgent, { transport: 'acp', agentId: 'claude', dataHome: await realpath(f.claude) });
		assert.equal(session.projectRoot, f.directory);
		assert.equal(await readFile(claudeFile, 'utf8'), original);
		const again = await discoverExternalAgentHistory({}, f.env);
		assert.deepEqual(again.sessions.map(session => session.id).sort(), found.sessions.map(session => session.id).sort());
	} finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('Claude imports the latest branch, pairs tools with results and retains images for handoff', async () => {
	const f = await fixture();
	try {
		await writeFile(join(f.claude, 'projects', 'project', 'branch.jsonl'), jsonl([
			{ type: 'user', uuid: 'u', parentUuid: null, message: { role: 'user', content: [{ type: 'text', text: 'Inspect this' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } }] } },
			{ type: 'assistant', uuid: 'discarded', parentUuid: 'u', message: { role: 'assistant', content: 'Discarded branch' } },
			{ type: 'attachment', uuid: 'attachment', parentUuid: 'u' },
			{ type: 'assistant', uuid: 'a', parentUuid: 'attachment', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Checking files' }, { type: 'tool_use', id: 't', name: 'Read', input: { file_path: 'index.ts' } }] } },
			{ type: 'user', uuid: 'r', parentUuid: 'a', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'file contents' }] } },
			{ type: 'system', subtype: 'compact_boundary', uuid: 'compact', parentUuid: null, logicalParentUuid: 'r' },
			{ type: 'assistant', uuid: 'final', parentUuid: 'compact', message: { role: 'assistant', content: 'Done' } }
		]) + '{unfinished');
		const found = await discoverExternalAgentHistory({ source: 'claude', dataHome: f.claude });
		const { session, warnings } = await readExternalAgentHistory(found.sessions[0]);
		assert.equal(session.history.length, 3);
		assert.ok(!JSON.stringify(session.history).includes('Discarded branch'));
		assert.deepEqual(session.history[0].images, ['data:image/png;base64,aGVsbG8=']);
		assert.ok(session.history[1].content.includes('file contents'));
		assert.ok(session.history[1].renderPayload?.includes('Checking files'));
		assert.equal(warnings.length, 1);
		const prompt = createExternalAgentHandoffPrompt('continue', session.history);
		assert.ok(prompt.includes('Inspect this') && prompt.includes('file contents') && prompt.includes('Done'));
	} finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('Codex canonical messages avoid event duplicates and preserve tool context', async () => {
	const f = await fixture();
	try {
		await writeFile(join(f.codex, 'sessions', '2026', 'rollout-tools.jsonl'), jsonl([
			{ type: 'session_meta', payload: { id: 'tools', source: 'cli', cwd: f.directory } },
			{ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>injected</environment_context>' }] } },
			{ type: 'event_msg', payload: { type: 'user_message', message: 'Fix it' } },
			{ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix it' }] } },
			{ type: 'response_item', payload: { type: 'function_call', call_id: 'call', name: 'exec_command', arguments: '{"cmd":"pwd"}' } },
			{ type: 'response_item', payload: { type: 'function_call_output', call_id: 'call', output: 'workspace' } },
			{ type: 'event_msg', payload: { type: 'agent_message', message: 'All done' } },
			{ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'All done' }] } }
		]));
		const found = await discoverExternalAgentHistory({ source: 'codex', dataHome: f.codex });
		const { session } = await readExternalAgentHistory(found.sessions[0]);
		assert.equal(session.externalAgentSessionId, 'tools');
		assert.deepEqual(session.history.map(message => message.role), ['user', 'assistant', 'assistant']);
		assert.equal(session.history[0].content, 'Fix it');
		assert.ok(session.history[1].content.includes('workspace'));
		assert.equal(session.history[2].content, 'All done');
		assert.equal(session.transcript?.length, 2);
		const display = JSON.parse(session.transcript![1].renderPayload!);
		assert.deepEqual(display.timeline.map((block: { type: string }) => block.type), ['tool', 'assistant_text']);
		assert.equal(display.timeline[0].output, 'workspace');
		const otherHome = join(f.directory, 'other-codex');
		await mkdir(join(otherHome, 'sessions'), { recursive: true });
		await writeFile(join(otherHome, 'sessions', 'rollout-tools.jsonl'), await readFile(found.sessions[0].path));
		const other = await discoverExternalAgentHistory({ source: 'codex', dataHome: otherHome });
		assert.notEqual(found.sessions[0].id, other.sessions[0].id);
	} finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('Codex navigation metadata does not become a chat title or a visible user prompt', async () => {
	const f = await fixture();
	try {
		const marker = '<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>';
		const file = join(f.codex, 'sessions', '2026', 'rollout-navigation.jsonl');
		const original = jsonl([
			{ type: 'session_meta', payload: { id: 'navigation', source: 'cli' } },
			{ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: marker }] } },
			{ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix Store' }] } },
			{ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Fixed Store' }] } }
		]);
		await writeFile(file, original);
		await writeFile(join(f.codex, 'session_index.jsonl'), jsonl([{ id: 'navigation', thread_name: marker }]));
		const { sessions: [entry] } = await discoverExternalAgentHistory({ source: 'codex', dataHome: f.codex });
		assert.equal(entry.title, 'Fix Store');
		const { session } = await readExternalAgentHistory({ ...entry, title: marker });
		assert.equal(session.title, 'Fix Store');
		assert.deepEqual(session.history.map(message => message.content), ['Fix Store', 'Fixed Store']);
		assert.equal(await readFile(file, 'utf8'), original);
	} finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('missing folders are empty; tampered identities and files outside the root cannot be imported', async () => {
	const f = await fixture();
	try {
		assert.deepEqual(await discoverExternalAgentHistory({ source: 'codex', dataHome: join(f.directory, 'missing') }), { sessions: [], warnings: [] });
		await assert.rejects(discoverExternalAgentHistory({ dataHome: f.codex }), /Choose an agent/);
		const file = join(f.codex, 'sessions', '2026', 'rollout-one.jsonl');
		await writeFile(file, jsonl([{ type: 'session_meta', payload: { id: 'one', source: 'cli' } }, { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hi' }] } }]));
		const { sessions: [entry] } = await discoverExternalAgentHistory({ source: 'codex', dataHome: f.codex });
		await assert.rejects(readExternalAgentHistory({ ...entry, sessionId: 'changed' }), /identity changed/);
		await writeFile(join(f.directory, 'outside.jsonl'), await readFile(file));
		await assert.rejects(readExternalAgentHistory({ ...entry, path: join(f.directory, 'outside.jsonl') }), /outside/);
		const linked = join(f.codex, 'sessions', 'rollout-link.jsonl');
		await symlink(join(f.directory, 'outside.jsonl'), linked);
		await assert.rejects(readExternalAgentHistory({ ...entry, path: linked }), /outside/);
	} finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('compressed Codex rollouts are readable when the host supports zstd', async t => {
	const compress = (zlib as unknown as { zstdCompressSync?: (input: Buffer) => Buffer }).zstdCompressSync;
	if (!compress) { t.skip('Node has no zstd support'); return; }
	const f = await fixture();
	try {
		await writeFile(join(f.codex, 'sessions', '2026', 'rollout-compressed.jsonl.zst'), compress(Buffer.from(jsonl([
			{ type: 'session_meta', payload: { id: 'compressed', source: 'cli' } },
			{ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Compressed chat' }] } }
		]))));
		const { sessions: [entry] } = await discoverExternalAgentHistory({ source: 'codex', dataHome: f.codex });
		assert.equal((await readExternalAgentHistory(entry)).session.history[0].content, 'Compressed chat');
	} finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('imported accounts reach ACP and a failed resume does not silently create a fresh session', { timeout: 15000 }, async () => {
	const f = await fixture();
	const adapter = join(f.directory, 'adapter.cjs');
	await writeFile(adapter, `
const readline = require('node:readline');
readline.createInterface({input:process.stdin}).on('line', line => {
 const request=JSON.parse(line); let result={};
 if(request.method==='initialize') result={protocolVersion:1,agentCapabilities:{loadSession:true},authMethods:[]};
 if(request.method==='session/load') {
  if(request.params.sessionId==='missing') { process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32603,message:'not found'}})+'\\n');return; }
  result={};
 }
 if(request.method==='session/new') result={sessionId:'unexpected-new'};
 if(request.method==='session/prompt') {
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'original',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:process.env.CODEX_HOME}}}})+'\\n');
  result={stopReason:'end_turn'};
 }
 if(request.id!==undefined) process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\\n');
});`);
	const registry = new ExternalAgentRegistry(join(f.directory, 'agents.json'));
	await writeFile(join(f.directory, 'agents.json'), JSON.stringify([{ id: 'codex', name: 'Codex fixture', command: process.execPath, args: [adapter] }]));
	const service = new ExternalAgentService(registry);
	try {
		const request = { cleanSlateSessionId: 'chat', cwd: f.directory, config: { transport: 'acp' as const, agentId: 'codex', dataHome: f.codex }, externalSessionId: 'original' };
		assert.equal((await service.startSession(request)).externalSessionId, 'original');
		const messages: string[] = [];
		service.onDidEmitEvent(event => { if (event.type === 'message') { messages.push(event.text); } });
		await service.prompt({ cleanSlateSessionId: 'chat', prompt: 'continue' });
		assert.deepEqual(messages, [f.codex]);
		await service.closeSession('chat');
		await assert.rejects(service.startSession({ ...request, externalSessionId: 'missing' }), /could not resume/);
	} finally { service.dispose(); await rm(f.directory, { recursive: true, force: true }); }
});
