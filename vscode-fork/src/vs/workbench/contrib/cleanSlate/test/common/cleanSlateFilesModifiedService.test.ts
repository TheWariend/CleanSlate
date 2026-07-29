/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CleanSlateFilesModifiedService } from '@cleanslate/sdk/agent/cleanSlateFilesModifiedService.js';

suite('CleanSlateFilesModifiedService', () => {
	test('uses ledger snapshots before timeline and pending diff fallbacks', () => {
		const service = new CleanSlateFilesModifiedService();
		const changes = service.buildFinishFileChanges(
			[{ path: '/workspace/src/Hero.module.css', added: 99, deleted: 99 }],
			[{
				type: 'file',
				path: '/workspace/src/Hero.module.css',
				status: 'Edited',
				added: 3,
				deleted: 3,
				beforeContent: 'timeline before',
				afterContent: 'timeline after'
			}],
			[{
				uri: { fsPath: '/workspace/src/Hero.module.css' },
				added: 2,
				deleted: 2,
				diff: 'pending diff',
				beforeContent: 'pending before',
				afterContent: 'pending after'
			}],
			true,
			[{
				path: '/workspace/src/Hero.module.css',
				beforeContent: '.hero {\n  font-family: serif;\n}\n',
				afterContent: '.hero {\n  font-family: sans-serif;\n}\n'
			}]
		);

		assert.strictEqual(changes.length, 1);
		assert.strictEqual(changes[0].beforeContent, '.hero {\n  font-family: serif;\n}\n');
		assert.strictEqual(changes[0].afterContent, '.hero {\n  font-family: sans-serif;\n}\n');
		assert.strictEqual(changes[0].added, 1);
		assert.strictEqual(changes[0].deleted, 1);
	});

	test('includes ledger-only files in finish changes', () => {
		const service = new CleanSlateFilesModifiedService();
		const changes = service.buildFinishFileChanges(
			[],
			[],
			[],
			false,
			[{
				path: '/workspace/src/new-file.ts',
				beforeContent: '',
				afterContent: 'export const value = 1;\n'
			}]
		);

		assert.strictEqual(changes.length, 1);
		assert.strictEqual(changes[0].path, '/workspace/src/new-file.ts');
		assert.strictEqual(changes[0].added, 1);
		assert.strictEqual(changes[0].deleted, 0);
	});

	test('tracks successful mutations for extensionless files', () => {
		const service = new CleanSlateFilesModifiedService();
		const changes = service.buildMutationFileChanges(
			'write_file',
			{ file_path: '/workspace/Dockerfile' },
			{
				success: true,
				persisted: true,
				path: '/workspace/Dockerfile',
				beforeContent: '',
				afterContent: 'FROM node:22\n'
			}
		);

		assert.strictEqual(changes.length, 1);
		assert.strictEqual(changes[0].path, '/workspace/Dockerfile');
		assert.strictEqual(changes[0].added, 1);
		assert.strictEqual(changes[0].deleted, 0);
	});

	test('uses pending diff fallback for dynamic extensionless file names', () => {
		const service = new CleanSlateFilesModifiedService();
		const changes = service.buildFinishFileChanges(
			[],
			[],
			[{
				uri: { fsPath: '/workspace/config' },
				beforeContent: 'old=true\n',
				afterContent: 'old=false\n'
			}],
			true
		);

		assert.strictEqual(changes.length, 1);
		assert.strictEqual(changes[0].path, '/workspace/config');
		assert.strictEqual(changes[0].added, 1);
		assert.strictEqual(changes[0].deleted, 1);
	});

	test('accepts structured fileChanges evidence from mutation tools', () => {
		const service = new CleanSlateFilesModifiedService();
		const changes = service.buildMutationFileChanges(
			'apply_edit',
			{},
			{
				success: true,
				fileChanges: [{
					path: '/workspace/routes',
					beforeContent: 'export const mode = "old";\n',
					afterContent: 'export const mode = "new";\n'
				}]
			}
		);

		assert.strictEqual(changes.length, 1);
		assert.strictEqual(changes[0].path, '/workspace/routes');
		assert.strictEqual(changes[0].added, 1);
		assert.strictEqual(changes[0].deleted, 1);
	});
});
