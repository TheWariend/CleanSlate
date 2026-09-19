/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExternalAgentRegistry, ExternalAgentService } from '../node/externalAgents/index.js';
import { createExternalAgentHandoffPrompt, type IExternalAgentEvent } from '../externalAgents/index.js';
import { mapAcpEvent } from '../node/externalAgents/transports/acp/acpEventMapper.js';
import { createHostToolsBridge } from '../node/externalAgents/hostToolsBridge.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CLEANSLATE_SDK_VERSION } from '../node/externalAgents/externalAgentVersion.js';
import { formatCodexRateLimits } from '../node/externalAgents/externalAgentUsage.js';

test('ACP handshake version follows the installed SDK package', async () => {
	const packageMetadata = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
	assert.equal(CLEANSLATE_SDK_VERSION, packageMetadata.version);
});

test('Codex app-server rate limits map to account usage without provider credentials', () => {
	assert.deepEqual(formatCodexRateLimits({ rateLimitsByLimitId: { codex: {
		limitId: 'codex', primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1730947200 },
		secondary: { usedPercent: 42, windowDurationMins: 10080, resetsAt: 1730950800 }
	} } }), { detail: 'Account usage', windows: [
		{ label: '5 hours', usedPercent: 25, resetsAt: 1730947200 },
		{ label: 'Weekly', usedPercent: 42, resetsAt: 1730950800 }
	] });
	assert.deepEqual(formatCodexRateLimits({ rateLimits: { limitId: 'codex', primary: { usedPercent: 140, windowDurationMins: 60 } } }), {
		detail: 'Account usage', windows: [{ label: '1 hour', usedPercent: 100, resetsAt: undefined }]
	});
});

test('Claude ACP launches the user-installed Claude executable', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'cleanslate-sdk-claude-'));
	const claude = join(directory, 'claude');
	try {
		await writeFile(claude, '', { mode: 0o700 });
		const registry = new ExternalAgentRegistry(join(directory, 'agents.json'), id => id.includes('claude-agent-acp') ? '/adapter/index.js' : (() => { throw new Error('missing'); })());
		assert.equal(registry.list({ PATH: directory }).find(agent => agent.id === 'claude')?.available, true);
		const launch = registry.resolve('claude', { PATH: directory });
		assert.equal(launch.executable, process.execPath);
		assert.equal(launch.env?.CLAUDE_CODE_EXECUTABLE, claude);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('bundled Codex usage runs Electron as Node instead of opening another app window', () => {
	const registry = new ExternalAgentRegistry('/nonexistent/cleanslate-agent-registry-test.json', id => {
		if (id.includes('codex-acp')) { return '/adapter/index.js'; }
		if (id.includes('@openai/codex')) { return '/codex/bin/codex.js'; }
		throw new Error('missing');
	});
	assert.deepEqual(registry.resolveUsage('codex'), {
		executable: process.execPath,
		args: ['/codex/bin/codex.js', 'app-server'],
		runAsNode: true
	});
});

test('standalone SDK runs an ACP process, changes its model, streams events and closes', { timeout: 15000 }, async () => {
	const directory = await mkdtemp(join(tmpdir(), 'cleanslate-sdk-acp-'));
	const registry = new ExternalAgentRegistry(join(directory, 'agents.json'));
	const fixture = join(directory, 'agent.cjs');
	await writeFile(fixture, `
const readline = require('node:readline');
let current = 'one';
let heldPrompt;
let permissionPrompt;
const options = () => [{ id:'model', name:'Model', category:'model', type:'select', currentValue:current, options:[{value:'one',name:'One'},{value:'two',name:'Two'}] }];
const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
readline.createInterface({input:process.stdin}).on('line', line => {
 const request = JSON.parse(line);
 if (request.id === 'permission-diff' && !request.method) {
  send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'fixture-session',update:{sessionUpdate:'tool_call_update',toolCallId:'write-with-approval',status:'completed'}}});
  send({jsonrpc:'2.0',id:permissionPrompt,result:{stopReason:'end_turn'}});
  return;
 }
 let result = {};
 switch(request.method) {
  case 'initialize': result = {protocolVersion:1,agentCapabilities:{},authMethods:[]}; break;
  case 'session/new': result = {sessionId:'fixture-session',configOptions:options()}; break;
  case 'session/load':
   send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'fixture-session',update:{sessionUpdate:'usage_update',used:1234,size:10000}}});
   result={configOptions:options()};break;
  case 'session/set_config_option': current=request.params.value; result={configOptions:options()}; break;
  case 'session/prompt':
   if(request.params.prompt[0]?.text === 'write-without-diff') {
    const file=require('node:path').join(process.cwd(),'fresh.html');
    send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'fixture-session',update:{sessionUpdate:'tool_call',toolCallId:'fresh-write',title:'Write file',kind:'edit',status:'in_progress',locations:[{path:file}]}}});
    require('node:fs').writeFileSync(file,'<h1>Fresh file</h1>');
    send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'fixture-session',update:{sessionUpdate:'tool_call_update',toolCallId:'fresh-write',status:'completed',content:[{type:'content',content:{type:'text',text:'Wrote file successfully.'}}]}}});
    send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'fixture-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'File completed; continuing work.'}}}});
    result={stopReason:'end_turn'};break;
   }
   if(request.params.prompt[0]?.text === 'approval-diff') {
    permissionPrompt=request.id;
    send({jsonrpc:'2.0',id:'permission-diff',method:'session/request_permission',params:{sessionId:'fixture-session',toolCall:{toolCallId:'write-with-approval',title:'Create file',kind:'edit',status:'pending',content:[{type:'diff',path:'/workspace/new.ts',oldText:null,newText:'hello'}]},options:[{optionId:'allow',name:'Allow',kind:'allow_once'}]}});
    return;
   }
   if(request.params.prompt[0]?.text === 'hold') { heldPrompt=request.id; return; }
   send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'fixture-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'SDK response'}}}});
   result={stopReason:'end_turn'};break;
  case 'session/cancel':
   if(heldPrompt !== undefined) { send({jsonrpc:'2.0',id:heldPrompt,result:{stopReason:'cancelled'}}); heldPrompt=undefined; }
   break;
 }
 if(request.id !== undefined) send({jsonrpc:'2.0',id:request.id,result});
});`);
	registry.register({ id: 'fixture', name: 'Fixture', command: process.execPath, args: [fixture] });
	const service = new ExternalAgentService(registry);
	const events: IExternalAgentEvent[] = [];
	const subscription = service.onDidEmitEvent(event => {
		events.push(event);
		if (event.type === 'permission') {
			assert.ok(!events.some(item => item.type === 'tool' && item.toolCallId === 'write-with-approval'), 'Proposed diff emitted as an applied edit');
			service.respondToPermission({ requestId: event.requestId, optionId: 'allow' });
		}
	});
	try {
		assert.equal(service.listAgents().find(agent => agent.id === 'fixture')?.available, true);
		const request = { cleanSlateSessionId: 'test-session', cwd: directory, config: { agentId: 'fixture', transport: 'acp' as const } };
		const [first, concurrent] = await Promise.all([service.startSession(request), service.startSession(request)]);
		assert.equal(first.externalSessionId, concurrent.externalSessionId);
		assert.equal(first.models?.current, 'one');
		await assert.rejects(service.startSession({ ...request, modelSelection: { configId: 'model', value: 'unknown' } }));
		const changed = await service.startSession({ ...request, modelSelection: { configId: 'model', value: 'two' } });
		assert.equal(changed.models?.current, 'two');
		await service.prompt({ cleanSlateSessionId: request.cleanSlateSessionId, prompt: 'hello' });
		assert.ok(events.some(event => event.type === 'status' && event.status === 'completed'));
		assert.ok(JSON.stringify(events).includes('SDK response'));
		await service.prompt({ cleanSlateSessionId: request.cleanSlateSessionId, prompt: 'write-without-diff' });
		const captured = events.findLast(event => event.type === 'tool' && event.toolCallId === 'fresh-write');
		assert.ok(captured?.type === 'tool');
		assert.equal(captured.fileChanges?.[0].created, true);
		assert.equal(captured.fileChanges?.[0].beforeContent, '');
		assert.equal(captured.fileChanges?.[0].afterContent, '<h1>Fresh file</h1>');
		assert.ok(events.indexOf(captured) < events.findIndex(event => event.type === 'message' && event.text === 'File completed; continuing work.'), 'File widget data must precede the next assistant message');
		await service.prompt({ cleanSlateSessionId: request.cleanSlateSessionId, prompt: 'approval-diff' });
		const applied = events.find(event => event.type === 'tool' && event.toolCallId === 'write-with-approval');
		assert.ok(applied?.type === 'tool');
		assert.equal(applied.status, 'completed');
		assert.deepEqual(applied.fileChanges, [{ path: '/workspace/new.ts', beforeContent: '', afterContent: 'hello', created: true }]);
		const running = service.prompt({ cleanSlateSessionId: request.cleanSlateSessionId, prompt: 'hold' });
		await assert.rejects(service.prompt({ cleanSlateSessionId: request.cleanSlateSessionId, prompt: 'duplicate' }), /already has a running response/);
		await service.cancel(request.cleanSlateSessionId);
		await running;
		await service.prompt({ cleanSlateSessionId: request.cleanSlateSessionId, prompt: 'after cancellation' });
		assert.ok(events.at(-1)?.type === 'status' && (events.at(-1) as { status: string }).status === 'completed');
		await service.closeSession(request.cleanSlateSessionId);
		await assert.rejects(service.prompt({ cleanSlateSessionId: request.cleanSlateSessionId, prompt: 'closed' }), /not active/);
		await service.startSession({ ...request, externalSessionId: first.externalSessionId });
		assert.ok(events.some(event => event.type === 'usage' && event.used === 1234 && event.size === 10000), 'usage replay during session load must reach the client');
		await service.closeSession(request.cleanSlateSessionId);
		const starting = service.startSession(request);
		await service.cancel(request.cleanSlateSessionId);
		await starting;
		const messageCount = events.filter(event => event.type === 'message').length;
		await service.prompt({ cleanSlateSessionId: request.cleanSlateSessionId, prompt: 'must not run' });
		assert.equal(events.filter(event => event.type === 'message').length, messageCount);
		assert.ok(events.some(event => event.type === 'status' && event.status === 'cancelled'));
		await service.closeSession(request.cleanSlateSessionId);
		const interruptedStartup = service.startSession(request);
		service.dispose();
		await assert.rejects(interruptedStartup, /disposed/);
		await assert.rejects(service.startSession(request), /disposed/);
		await assert.rejects(service.prompt({ cleanSlateSessionId: request.cleanSlateSessionId, prompt: 'disposed' }), /not active/);
	} finally { subscription.dispose(); await service.closeSession('test-session'); service.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test('ACP tool content retains text, resources, worker metadata and partial updates', () => {
	const event = mapAcpEvent('session', { sessionUpdate: 'tool_call', toolCallId: 'worker', title: 'Delegate', kind: 'other', status: 'in_progress', rawInput: { subagent_type: 'explore', description: 'Inspect tests', prompt: 'Find coverage gaps' }, content: [{ type: 'content', content: { type: 'text', text: 'Result from content' } }] });
	assert.ok(event?.type === 'tool');
	assert.equal(event.output, 'Result from content');
	assert.deepEqual(event.worker, { name: 'Inspect tests', prompt: 'Find coverage gaps' });
	const partial = mapAcpEvent('session', { sessionUpdate: 'tool_call_update', toolCallId: 'worker', status: 'completed' });
	assert.ok(partial?.type === 'tool');
	assert.equal(partial.title, undefined);
	assert.equal(partial.kind, undefined);
	const resource = mapAcpEvent('session', { sessionUpdate: 'agent_message_chunk', content: { type: 'resource', resource: { uri: 'file:///project/result.txt', text: 'Resource body' } } });
	assert.ok(resource?.type === 'message');
	assert.equal(resource.text, 'Resource body');
});

test('ACP thought semantics come from adapter capability metadata', () => {
	const thought = { sessionUpdate: 'agent_thought_chunk' as const, content: { type: 'text' as const, text: 'Inspecting the repository' } };
	const defaultEvent = mapAcpEvent('session', thought);
	assert.ok(defaultEvent?.type === 'thought');
	assert.equal(defaultEvent.presentation, 'reasoning');
	const summaryEvent = mapAcpEvent('session', thought, 'summary');
	assert.ok(summaryEvent?.type === 'thought');
	assert.equal(summaryEvent.presentation, 'summary');
	assert.equal(new ExternalAgentRegistry('/nonexistent/cleanslate-agent-registry-test.json').get('codex').thoughtPresentation, 'summary');
});

test('ACP preserves structured file snapshots without inferring creation from empty contents', () => {
	const event = mapAcpEvent('session', { sessionUpdate: 'tool_call_update', toolCallId: 'edit', status: 'completed', rawOutput: { metadata: { filediff: { file: '/workspace/file.ts', before: '', after: 'hello' } } } });
	assert.ok(event?.type === 'tool');
	assert.deepEqual(event.fileChanges, [{ path: '/workspace/file.ts', beforeContent: '', afterContent: 'hello', created: false }]);
	const created = mapAcpEvent('session', { sessionUpdate: 'tool_call_update', toolCallId: 'write', status: 'completed', rawInput: { file_path: '/workspace/new.ts' }, rawOutput: { created: true, afterContent: 'new file' } });
	assert.ok(created?.type === 'tool');
	assert.equal(created.fileChanges?.[0].created, true);
	assert.equal(created.fileChanges?.[0].beforeContent, '');
	const unknown = mapAcpEvent('session', { sessionUpdate: 'tool_call_update', toolCallId: 'write', status: 'completed', rawInput: { file_path: '/workspace/new.ts', content: 'new file' }, rawOutput: 'Wrote file successfully.' });
	assert.ok(unknown?.type === 'tool');
	assert.equal(unknown.fileChanges, undefined);
});

test('handoff preserves visible history and leaves fresh prompts unchanged', () => {
	assert.equal(createExternalAgentHandoffPrompt('hello', []), 'hello');
	const history = [{ role: 'user', content: 'previous task' }, { role: 'assistant', content: 'progress' }];
	const prompt = createExternalAgentHandoffPrompt('continue', history);
	assert.ok(prompt.includes(JSON.stringify(history)));
	assert.ok(prompt.endsWith('Current user message:\ncontinue'));
});

test('ACP raster output uses safe Markdown and rejects active or malformed image formats', () => {
	const image = mapAcpEvent('session', { sessionUpdate: 'agent_message_chunk', content: { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' } });
	assert.ok(image?.type === 'message');
	assert.ok(image.text.includes('![Agent image](data:image/png;base64,aGVsbG8=)'));
	for (const [mimeType, data] of [['image/svg+xml', 'aGVsbG8='], ['image/png', '<script>']]) {
		const invalid = mapAcpEvent('session', { sessionUpdate: 'agent_message_chunk', content: { type: 'image', mimeType, data } });
		assert.ok(invalid?.type === 'message');
		assert.ok(!invalid.text.includes('data:'));
	}
});

test('failed session creation disposes the initialized subprocess', { timeout: 10000 }, async () => {
	const directory = await mkdtemp(join(tmpdir(), 'cleanslate-acp-failure-'));
	const fixture = join(directory, 'failure.cjs');
	const pidFile = join(directory, 'pid');
	await writeFile(fixture, `
require('node:fs').writeFileSync(process.argv[2], String(process.pid));
const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
 const request=JSON.parse(line);
 if(request.id === undefined) return;
 if(request.method === 'initialize') send({jsonrpc:'2.0',id:request.id,result:{protocolVersion:1,agentCapabilities:{},authMethods:[]}});
 else send({jsonrpc:'2.0',id:request.id,error:{code:-32603,message:'Fixture startup failure'}});
});
setInterval(() => {},1000);
`);
	const registry = new ExternalAgentRegistry(join(directory, 'agents.json'));
	registry.register({ id: 'failure', name: 'Failure', command: process.execPath, args: [fixture, pidFile] });
	const service = new ExternalAgentService(registry);
	let pid: number | undefined;
	try {
		await assert.rejects(service.startSession({ cleanSlateSessionId: 'failure', cwd: directory, config: { transport: 'acp', agentId: 'failure' } }));
		pid = Number(await readFile(pidFile, 'utf8'));
		assert.throws(() => process.kill(pid!, 0), { code: 'ESRCH' });
	} finally {
		if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* The process was already disposed. */ } }
		service.dispose();
		await rm(directory, { recursive: true, force: true });
	}
});

test('host tools cross the stdio bridge, reject unauthenticated access and close with their session', { timeout: 15000 }, async () => {
	let calls = 0;
	let released = false;
	const bridge = await createHostToolsBridge([{
		definition: { name: 'test_context', description: 'Fixture context', inputSchema: { type: 'object' } },
		async call() { calls++; return { content: [{ type: 'text', text: 'session-specific context' }] }; }
	}], async () => { released = true; });
	const descriptor = bridge.servers[0];
	assert.ok('command' in descriptor);
	const env = Object.fromEntries(descriptor.env.map(entry => [entry.name, entry.value]));
	const client = new Client({ name: 'fixture', version: '1.0.0' });
	try {
		const forbidden = await fetch(env['CLEANSLATE_HOST_TOOL_URL'], { method: 'POST', body: '{}' });
		assert.equal(forbidden.status, 403);
		await client.connect(new StdioClientTransport({ command: descriptor.command, args: descriptor.args, env }));
		assert.equal((await client.listTools()).tools[0].name, 'test_context');
		assert.ok(JSON.stringify(await client.callTool({ name: 'test_context' })).includes('session-specific context'));
		assert.equal(calls, 1);
		await bridge.dispose();
		assert.equal(released, true);
		await assert.rejects(client.callTool({ name: 'test_context' }));
	} finally { await client.close(); await bridge.dispose(); }
});

test('session host calls reach only their owner and stop rejects pending calls', { timeout: 15000 }, async () => {
	const directory = await mkdtemp(join(tmpdir(), 'cleanslate-host-routing-'));
	const fixture = join(directory, 'agent.cjs');
	const connectionFile = join(directory, 'connection.json');
	await writeFile(fixture, `
const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
let pending;
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
 const request=JSON.parse(line);
 if(request.method === 'session/cancel') { if(pending) send({jsonrpc:'2.0',id:pending,result:{stopReason:'cancelled'}}); pending=undefined; return; }
 if(request.method === 'session/prompt') { pending=request.id; return; }
 if(request.method === 'session/new') require('node:fs').writeFileSync(process.argv[2],JSON.stringify(request.params.mcpServers[0]));
 if(request.id !== undefined) send({jsonrpc:'2.0',id:request.id,result:request.method === 'initialize' ? {protocolVersion:1,agentCapabilities:{},authMethods:[]} : {sessionId:'remote'}});
});`);
	const registry = new ExternalAgentRegistry(join(directory, 'agents.json'));
	registry.register({ id: 'fixture', name: 'Fixture', command: process.execPath, args: [fixture, connectionFile] });
	const service = new ExternalAgentService(registry);
	const client = new Client({ name: 'fixture', version: '1.0.0' });
	let pendingEvent: Extract<IExternalAgentEvent, { type: 'host_tool' }> | undefined;
	let received!: () => void;
	let observed = new Promise<void>(resolve => { received = resolve; });
	const subscription = service.onDidEmitEvent(event => {
		if (event.type === 'host_tool') { pendingEvent = event; received(); }
	});
	try {
		await service.startSession({ cleanSlateSessionId: 'chat', cwd: directory, config: { agentId: 'fixture', transport: 'acp' }, hostTools: {
			ownerId: 'owner', tools: [{ name: 'context', description: 'Context', inputSchema: { type: 'object' } }]
		} });
		const descriptor = JSON.parse(await readFile(connectionFile, 'utf8'));
		await client.connect(new StdioClientTransport({ command: descriptor.command, args: descriptor.args, env: Object.fromEntries(descriptor.env.map((entry: { name: string; value: string }) => [entry.name, entry.value])) }));
		const run = service.prompt({ cleanSlateSessionId: 'chat', prompt: 'hold' });
		const call = client.callTool({ name: 'context' });
		await observed;
		assert.equal(pendingEvent?.ownerId, 'owner');
		assert.equal(pendingEvent?.cleanSlateSessionId, 'chat');
		service.respondToHostTool({ ownerId: 'wrong-owner', requestId: pendingEvent!.requestId, result: 'wrong' });
		service.respondToHostTool({ ownerId: 'owner', requestId: pendingEvent!.requestId, result: 'correct' });
		assert.ok(JSON.stringify(await call).includes('correct'));
		observed = new Promise<void>(resolve => { received = resolve; });
		const stoppedCall = client.callTool({ name: 'context' });
		const rejected = assert.rejects(stoppedCall);
		await observed;
		await service.cancel('chat');
		await rejected;
		await run;
	} finally {
		subscription.dispose(); await client.close(); await service.closeSession('chat'); service.dispose();
		await rm(directory, { recursive: true, force: true });
	}
});
