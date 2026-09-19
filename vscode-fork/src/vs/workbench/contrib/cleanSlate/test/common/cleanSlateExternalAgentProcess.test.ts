/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ExternalAgentRegistry } from '../../../../services/cleanSlate/node/externalAgents/externalAgentRegistry.js';
import { isFullAccessMode, renderApprovalIcon } from '../../browser/chat/renderers/cleanSlateApprovalIcons.js';
import { AcpConnection, createAcpPromptContent } from '../../../../services/cleanSlate/node/externalAgents/transports/acp/acpConnection.js';
import { createAgentEnvironment } from '../../../../services/cleanSlate/node/externalAgents/transports/acp/acpProcess.js';

suite('CleanSlate external agent process', () => {
	test('preserves approval semantics in both ACP mode formats', () => {
		const subject = Object.create(AcpConnection.prototype) as { controls: { options: { kind?: string }[] }[]; readModels(options: unknown[]): void; readModes(modes: unknown): void };
		const kinds = ['standard', 'auto_review', 'full_access'];
		const presentations = ['approval-required', 'automatic-review', 'unrestricted'];
		subject.controls = [];
		subject.readModels([{ id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: 'a', options: kinds.map((kind, index) => ({ value: String(index), name: 'Localized label', _meta: { kind } })) }]);
		assert.deepStrictEqual(subject.controls[0].options.map(option => option.kind), presentations);
		subject.controls = [];
		subject.readModes({ currentModeId: '0', availableModes: kinds.map((kind, index) => ({ id: String(index), name: 'Localized label', _meta: { kind } })) });
		assert.deepStrictEqual(subject.controls[0].options.map(option => option.kind), presentations);
	});

	test('renders distinct approval icons without provider or label matching', () => {
		class Element {
			children: Element[] = [];
			attributes: Record<string, string> = {};
			classList = { remove() { } };
			ownerDocument = { createElementNS: () => new Element() };
			replaceChildren() { this.children = []; }
			setAttribute(key: string, value: string) { this.attributes[key] = value; }
			append(child: Element) { this.children.push(child); }
		}
		const host = new Element();
		const paths = ['approval-required', 'automatic-review', 'unrestricted', undefined].map(kind => {
			renderApprovalIcon(host as unknown as HTMLElement, kind);
			assert.strictEqual(host.children.length, 1);
			assert.strictEqual(host.children[0].attributes.stroke, 'currentColor');
			return host.children[0].children.map(child => child.attributes.d).join();
		});
		assert.strictEqual(new Set(paths).size, 4);
		assert.strictEqual(isFullAccessMode('unrestricted'), true);
		assert.strictEqual(isFullAccessMode(undefined), false);
	});

	test('discovers custom ACP commands and requires the native Claude CLI', () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-registry-test-'));
		try {
			const command = path.join(directory, 'claude');
			fs.writeFileSync(command, '', { mode: 0o700 });
			const config = path.join(directory, 'agents.json');
			fs.writeFileSync(config, JSON.stringify([{ id: 'custom', name: 'Custom agent', command, args: ['stdio'] }]));
			const registry = new ExternalAgentRegistry(config);
			// Simulate a distribution without bundled adapters, independent of local dependencies.
			(registry as unknown as { resolveModule(id: string): string | undefined }).resolveModule = () => undefined;
			const listed = registry.list({ PATH: directory });
			assert.strictEqual(listed.find(agent => agent.id === 'custom')?.available, true);
			assert.strictEqual(listed.find(agent => agent.id === 'claude')?.available, false);
			assert.strictEqual(registry.resolve('custom', { PATH: directory }).executable, command);
			registry.register({ id: 'another', name: 'Another', command, args: ['stdio'] });
			assert.strictEqual(new ExternalAgentRegistry(config).get('another').name, 'Another');
			assert.throws(() => registry.register({ id: 'another', name: 'Duplicate', command, args: [] }), /already exists/);
			fs.writeFileSync(config, JSON.stringify([{ id: 'bad', name: 'Bad', command, args: 'stdio' }]));
			assert.throws(() => registry.list(), /argument array/);
		} finally { fs.rmSync(directory, { recursive: true }); }
	});
	test('preserves legacy modes when configuration choices are refreshed', () => {
		const connection = Object.create(AcpConnection.prototype) as AcpConnection & { readModels(options: unknown[]): void; readModes(modes: unknown): void };
		// Exercise the transport normalizer without launching an authenticated agent.
		const subject = connection as unknown as { controls: { configId: string; current: string }[]; readModels(options: unknown[]): void; readModes(modes: unknown): void };
		subject.controls = [];
		subject.readModes({ currentModeId: 'ask', availableModes: [{ id: 'ask', name: 'Ask' }] });
		subject.readModels([{ id: 'depth', name: 'Reasoning', category: 'thought_level', type: 'select', currentValue: 'high', options: [{ value: 'high', name: 'High' }] }]);
		assert.strictEqual(subject.controls.length, 2);
		assert.strictEqual(subject.controls.find(option => option.configId === '$acp.session.mode')?.current, 'ask');
	});

	test('rejects unadvertised config values before sending an ACP request', async () => {
		const connection = Object.create(AcpConnection.prototype) as AcpConnection;
		connection.controls = [{ configId: 'depth', name: 'Reasoning', current: 'low', options: [{ value: 'low', name: 'Low' }] }];
		await assert.rejects(connection.selectModel('test', 'depth', 'invented'), /not available/);
	});
	test('runs bundled adapters without opening an application window', () => {
		const environment = createAgentEnvironment({ PATH: '/bin', ELECTRON_RUN_AS_NODE: 'unexpected' }, true);
		assert.strictEqual(environment.PATH, '/bin');
		assert.strictEqual(environment.ELECTRON_RUN_AS_NODE, '1');
	});

	test('does not alter external executable mode', () => {
		const environment = createAgentEnvironment({ PATH: '/bin', ELECTRON_RUN_AS_NODE: 'unexpected' });
		assert.strictEqual(environment.ELECTRON_RUN_AS_NODE, undefined);
	});

	test('encodes attached images as ACP prompt content', () => {
		assert.deepStrictEqual(createAcpPromptContent('Inspect this', ['data:image/png;base64,aGVsbG8=']), [
			{ type: 'text', text: 'Inspect this' },
			{ type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }
		]);
	});

	test('rejects malformed image attachments', () => {
		assert.throws(() => createAcpPromptContent('Inspect this', ['not-an-image']), /could not be read/);
	});
});
