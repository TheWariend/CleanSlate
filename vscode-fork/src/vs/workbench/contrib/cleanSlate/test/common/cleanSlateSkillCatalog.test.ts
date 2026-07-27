/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	getCleanSlateMcpCapabilityCatalog,
	getCleanSlateSkillCatalog
} from '../../browser/skills/cleanSlateSkillCatalog.js';

suite('CleanSlateSkillCatalog', () => {
	test('tracks the requested eleven reference skills', () => {
		const skills = getCleanSlateSkillCatalog();

		assert.strictEqual(skills.length, 11);
		assert.deepStrictEqual(skills.map(skill => skill.referenceName), [
			'imagegen',
			'official-docs',
			'plugin-creator',
			'skill-creator',
			'skill-installer',
			'browser:browser',
			'computer-use:computer-use',
			'documents:documents',
			'pdf',
			'presentations:Presentations',
			'spreadsheets:Spreadsheets'
		]);
	});

	test('marks browser available and computer-use gated on MCP detection', () => {
		const withoutMcp = getCleanSlateSkillCatalog();
		const browser = withoutMcp.find(skill => skill.id === 'browser');
		const computerUseWithoutMcp = withoutMcp.find(skill => skill.id === 'computer-use');

		assert.strictEqual(browser?.status, 'available');
		assert.strictEqual(browser?.productionReady, true);
		assert.strictEqual(computerUseWithoutMcp?.status, 'available_when_mcp_configured');
		assert.strictEqual(computerUseWithoutMcp?.productionReady, false);

		const withMcp = getCleanSlateSkillCatalog([
			{ name: 'mcp__computer_use__get_app_state', serverName: 'computer-use' }
		]);
		const computerUseWithMcp = withMcp.find(skill => skill.id === 'computer-use');

		assert.strictEqual(computerUseWithMcp?.status, 'available');
		assert.strictEqual(computerUseWithMcp?.productionReady, true);
	});

	test('detects requested node_repl and computer-use MCP capabilities', () => {
		const capabilities = getCleanSlateMcpCapabilityCatalog([
			{ name: 'mcp__node_repl__js', serverName: 'node_repl' },
			{ name: 'mcp__computer_use__click', serverName: 'computer-use' }
		]);

		assert.strictEqual(capabilities.length, 2);
		assert.deepStrictEqual(capabilities.map(capability => capability.status), ['available', 'available']);
		assert.deepStrictEqual(capabilities.map(capability => capability.productionReady), [true, true]);
	});
});
