/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { applyEditTool } from '../../browser/tools/ApplyEditTool.js';
import { writeFileTool } from '../../browser/tools/WriteFileTool.js';

suite('CleanSlate write file tool', () => {
	test('delegates an existing file to the guarded full-file edit engine', async () => {
		const originalRun = applyEditTool.run;
		let delegatedInput: any;
		applyEditTool.run = async input => {
			delegatedInput = input;
			return {
				success: true,
				path: '/workspace/src/app.ts',
				added: 1,
				deleted: 1,
				beforeContent: 'before\n',
				afterContent: 'after\n'
			};
		};

		try {
			const result = await writeFileTool.run({
				file_path: '/workspace/src/app.ts',
				content: 'after\n'
			}, createContext({ exists: true }));

			assert.deepStrictEqual(delegatedInput, {
				path: '/workspace/src/app.ts',
				edits: [{ mode: 'full_file', content: 'after\n' }],
				historyOperation: 'write_file',
				historyToolName: 'write_file'
			});
			assert.strictEqual(result.success, true);
			assert.strictEqual(result.created, false);
			assert.strictEqual(result.updated, true);
			assert.strictEqual(result.operation, 'updated');
			assert.strictEqual(result.beforeContent, 'before\n');
			assert.strictEqual(result.afterContent, 'after\n');
		} finally {
			applyEditTool.run = originalRun;
		}
	});

	test('creates a missing file without enabling overwrite', async () => {
		let createRequest: any;
		const context = createContext({
			exists: false,
			onCreate: request => {
				createRequest = request;
			}
		});
		const result = await writeFileTool.run({
			file_path: '/workspace/src/new.ts',
			content: 'export const value = 1;\n',
			open: false
		}, context);

		assert.strictEqual(result.success, true);
		assert.strictEqual(result.created, true);
		assert.strictEqual(result.updated, false);
		assert.strictEqual(result.operation, 'created');
		assert.strictEqual(createRequest[0].resource.fsPath, '/workspace/src/new.ts');
		assert.strictEqual(createRequest[0].value, 'export const value = 1;\n');
		assert.deepStrictEqual(createRequest[0].options, { overwrite: false });
	});
});

function createContext(options: { exists: boolean; onCreate?: (request: any) => void }): any {
	const workspaceRoot = URI.file('/workspace');
	const models = options.exists ? new Map<string, any>([
		[URI.file('/workspace/src/app.ts').toString(), {}]
	]) : new Map<string, any>();

	return {
		modelService: {
			getModel(uri: URI) {
				return models.get(uri.toString()) ?? null;
			}
		},
		fileService: {
			async exists() {
				return options.exists;
			},
			async stat() {
				return { mtime: 10 };
			}
		},
		textFileService: {
			async create(request: any) {
				options.onCreate?.(request);
			}
		},
		workspaceContextService: {
			getWorkspaceFolder() {
				return { uri: undefined };
			},
			getWorkspace() {
				return {
					id: 'write-file-test',
					folders: [{
						uri: workspaceRoot,
						toResource(path: string) {
							return URI.joinPath(workspaceRoot, path);
						}
					}]
				};
			}
		},
		ideWorkspaceContextService: {
			getWorkspaceFolder() {
				return undefined;
			}
		},
		readFileState: new Map(),
		codeEditorService: {
			getActiveCodeEditor() {
				return null;
			}
		}
	};
}
