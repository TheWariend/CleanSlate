/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { CliProceduralMemory, withMemory } from '../proceduralMemory.js';

const SDK = process.env.MUSCLEMEMORY_SDK_NODE_MODULE;

function withEnvironment(values: Record<string, string | undefined>, body: () => Promise<void>): Promise<void> {
	const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined) { delete process.env[key]; } else { process.env[key] = value; }
	}
	return body().finally(() => {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) { delete process.env[key]; } else { process.env[key] = value; }
		}
	});
}

test('memory is off unless a MuscleMemory config is set', () => withEnvironment({ CLEANSLATE_MUSCLEMEMORY_CONFIG: undefined }, async () => {
	const memory = new CliProceduralMemory(process.cwd());
	const runtime = { run() { return 'native'; } };
	assert.equal(memory.enabled, false);
	assert.equal(memory.attach(runtime), runtime);
	assert.equal(await withMemory('project notes', memory, 'task'), 'project notes');
}));

test('a configured run gets the note and is recorded, with the stream unchanged', { skip: !SDK && 'set MUSCLEMEMORY_SDK_NODE_MODULE to the MuscleMemory SDK dist/node.js' }, async t => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-memory-'));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const observed: string[] = [];
	const server = http.createServer(async (request, response) => {
		let body = '';
		for await (const chunk of request) { body += chunk; }
		observed.push(request.url ?? '');
		response.setHeader('Content-Type', 'application/json');
		if (request.url === '/v1/recall') {
			response.end(JSON.stringify({ candidates: [], guidance: JSON.stringify({ notice: 'Untrusted prior result; check current files.', procedure: 'p1', version: 1 }) }));
			return;
		}
		const input = JSON.parse(body || '{}');
		response.end(JSON.stringify({ accepted_event_count: input.event_batch?.length ?? 0, duplicate_event_count: 0, rejected_event_count: 0 }));
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	t.after(() => server.close());
	const address = server.address() as { port: number };
	const config = path.join(root, 'musclememory.json');
	fs.writeFileSync(config, JSON.stringify({ url: `http://127.0.0.1:${address.port}`, api_key: 'k', namespace: 'team' }), { mode: 0o600 });
	await withEnvironment({
		CLEANSLATE_MUSCLEMEMORY_CONFIG: config,
		CLEANSLATE_MUSCLEMEMORY_NODE_MODULE: SDK,
		CLEANSLATE_MUSCLEMEMORY_STATE: path.join(root, 'state'),
	}, async () => {
		const memory = new CliProceduralMemory(root);
		let note = '';
		const parts = [
			{ type: 'tool_start', toolName: 'read_file', toolCallId: 'a', input: { path: path.join(root, 'README.md') } },
			{ type: 'tool_result', toolName: 'read_file', toolCallId: 'a', result: { content: 'readme' } },
		];
		const runtime = memory.attach({
			marker: 'native',
			async *run(task: string) {
				note = await withMemory('project notes', memory, task);
				yield* parts;
			},
		});
		assert.equal(runtime.marker, 'native');
		const seen: unknown[] = [];
		for await (const part of runtime.run('Read the readme')) { seen.push(part); }
		assert.deepEqual(seen, parts);
		assert.match(note, /^project notes\n\n\{"notice":"Untrusted/);
		assert.ok(observed.includes('/v1/observe'));
	});
});
