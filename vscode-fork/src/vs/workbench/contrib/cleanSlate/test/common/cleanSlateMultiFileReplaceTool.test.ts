/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { multiFileReplaceTool } from '@cleanslate/sdk/tools/MultiFileReplaceTool.js';

/**
 * These cover the seam that used to be a silent-failure hazard.
 *
 * `multi_file_replace` used to construct the editor's `ResourceTextEdit`
 * itself. The bulk-edit service groups edits by `instanceof ResourceTextEdit`,
 * so once the tool moved outside the editor package that check would start
 * failing: the batch would be dropped, `isApplied` would still be true, and the
 * tool would report SUCCESS over a file that never changed. The tool now emits
 * plain descriptors and the host builds the real edit — so what is asserted
 * here is not "the call happened" but "the content actually changed".
 */
suite('CleanSlate multi_file_replace', () => {

	test('applies edits to every targeted file through the bulk-edit host', async () => {
		const workspace = new TestWorkspace({
			'/workspace/src/a.ts': 'export const a = 1;\n',
			'/workspace/src/b.ts': 'export const b = 2;\n'
		});

		const result = await multiFileReplaceTool.run({
			edits: [
				{ file_path: '/workspace/src/a.ts', old_string: 'const a = 1', new_string: 'const a = 111' },
				{ file_path: '/workspace/src/b.ts', old_string: 'const b = 2', new_string: 'const b = 222' }
			]
		}, workspace.context);

		assert.strictEqual(result.success, true, `expected success, got: ${JSON.stringify(result)}`);
		assert.strictEqual(result.totalFiles, 2);

		// The point of the test: the bytes moved.
		assert.strictEqual(workspace.contentOf('/workspace/src/a.ts'), 'export const a = 111;\n');
		assert.strictEqual(workspace.contentOf('/workspace/src/b.ts'), 'export const b = 222;\n');
	});

	test('hands the host plain descriptors rather than constructed editor objects', async () => {
		const workspace = new TestWorkspace({
			'/workspace/src/a.ts': 'export const a = 1;\n'
		});

		await multiFileReplaceTool.run({
			edits: [{ file_path: '/workspace/src/a.ts', old_string: 'const a = 1', new_string: 'const a = 9' }]
		}, workspace.context);

		assert.strictEqual(workspace.received.length, 1);
		const descriptor = workspace.received[0];

		// A plain object carrying resource/range/text — nothing the SDK would
		// need an editor class to build.
		assert.strictEqual(Object.getPrototypeOf(descriptor), Object.prototype);
		assert.ok(URI.isUri(descriptor.resource), 'descriptor.resource should be a URI');
		assert.strictEqual(descriptor.resource.fsPath, '/workspace/src/a.ts');
		assert.strictEqual(typeof descriptor.text, 'string');
		assert.strictEqual(typeof descriptor.range.startLineNumber, 'number');
		assert.strictEqual(typeof descriptor.range.startColumn, 'number');
		assert.strictEqual(typeof descriptor.range.endLineNumber, 'number');
		assert.strictEqual(typeof descriptor.range.endColumn, 'number');
	});

	test('reports failure when the host declines to apply the batch', async () => {
		const workspace = new TestWorkspace({
			'/workspace/src/a.ts': 'export const a = 1;\n'
		}, { applies: false });

		const result = await multiFileReplaceTool.run({
			edits: [{ file_path: '/workspace/src/a.ts', old_string: 'const a = 1', new_string: 'const a = 9' }]
		}, workspace.context);

		assert.strictEqual(result.success, false);
		assert.strictEqual(workspace.contentOf('/workspace/src/a.ts'), 'export const a = 1;\n');
	});

	test('applies nothing when any one file fails to plan', async () => {
		const workspace = new TestWorkspace({
			'/workspace/src/a.ts': 'export const a = 1;\n',
			'/workspace/src/b.ts': 'export const b = 2;\n'
		});

		const result = await multiFileReplaceTool.run({
			edits: [
				{ file_path: '/workspace/src/a.ts', old_string: 'const a = 1', new_string: 'const a = 111' },
				{ file_path: '/workspace/src/b.ts', old_string: 'nowhere in this file', new_string: 'x' }
			]
		}, workspace.context);

		assert.strictEqual(result.success, false);
		assert.strictEqual(workspace.received.length, 0, 'nothing should reach the host');
		assert.strictEqual(workspace.contentOf('/workspace/src/a.ts'), 'export const a = 1;\n');
		assert.strictEqual(workspace.contentOf('/workspace/src/b.ts'), 'export const b = 2;\n');
	});
});

/**
 * A workspace of in-memory text models, plus a bulk-edit host that applies
 * descriptors to them the way the editor's service would. Content is compared
 * before and after, so a dropped batch shows up as a failed assertion rather
 * than a passing no-op.
 */
class TestWorkspace {

	readonly context: any;
	readonly received: any[] = [];
	private readonly models = new Map<string, TestTextModel>();

	constructor(files: Record<string, string>, options: { applies?: boolean } = {}) {
		const applies = options.applies !== false;
		for (const [path, content] of Object.entries(files)) {
			this.models.set(URI.file(path).toString(), new TestTextModel(URI.file(path), content));
		}

		const models = this.models;
		const received = this.received;
		const workspaceRoot = URI.file('/workspace');

		this.context = {
			surface: 'test',
			modelService: {
				getModel: (uri: URI) => models.get(uri.toString()) ?? null
			},
			// Backed by a plain map so the edit-history bookkeeping (backups and
			// its manifest) runs for real rather than being stubbed away.
			fileService: (() => {
				const disk = new Map<string, string>();
				return {
					async exists(uri: URI) { return disk.has(uri.toString()) || models.has(uri.toString()); },
					async stat() { return { mtime: 1 }; },
					async createFolder() { /* flat map, nothing to create */ },
					async readFile(uri: URI) {
						const value = disk.get(uri.toString()) ?? models.get(uri.toString())?.getValue() ?? '';
						return { value: { toString: () => value } };
					},
					async writeFile(uri: URI, buffer: any) { disk.set(uri.toString(), buffer.toString()); },
					async del(uri: URI) { disk.delete(uri.toString()); }
				};
			})(),
			textFileService: {
				async save() { /* models are the source of truth here */ }
			},
			markerService: {
				read: () => [],
				onMarkerChanged: () => ({ dispose() { } })
			},
			workspaceContextService: {
				getWorkspaceFolder: () => ({ uri: workspaceRoot }),
				getWorkspace: () => ({
					id: 'multi-file-replace-test',
					folders: [{ uri: workspaceRoot, toResource: (p: string) => URI.joinPath(workspaceRoot, p) }]
				})
			},
			ideWorkspaceContextService: {
				getWorkspaceFolder: () => undefined
			},
			codeEditorService: {
				getActiveCodeEditor: () => null
			},
			readFileState: new Map<string, any>(),
			bulkEditService: {
				async applyTextEdits(edits: readonly any[]) {
					received.push(...edits);
					if (!applies) {
						return { isApplied: false };
					}
					for (const edit of edits) {
						const model = models.get(edit.resource.toString());
						if (!model) {
							throw new Error(`host received an edit for an unknown model: ${edit.resource.toString()}`);
						}
						model.applyEdit(edit.range, edit.text);
					}
					return { isApplied: true };
				}
			}
		};

		// The tool gates on having read a file first; seed that state.
		for (const model of this.models.values()) {
			this.context.readFileState.set(model.uri.toString(), {
				path: model.uri.fsPath,
				uri: model.uri.toString(),
				content: model.getValue(),
				currentVersionId: model.getVersionId(),
				mtime: 1,
				totalLines: model.getValue().split('\n').length,
				isPartialView: false,
				readAt: Date.now()
			});
		}
	}

	contentOf(path: string): string {
		const model = this.models.get(URI.file(path).toString());
		assert.ok(model, `no model for ${path}`);
		return model!.getValue();
	}
}

/** Just enough ITextModel for the edit engine's planning and application. */
class TestTextModel {

	private versionId = 1;

	constructor(readonly uri: URI, private content: string) { }

	getValue(): string { return this.content; }
	getVersionId(): number { return this.versionId; }
	getLineCount(): number { return this.content.split('\n').length; }
	getLineContent(lineNumber: number): string { return this.content.split('\n')[lineNumber - 1] ?? ''; }
	getLineMaxColumn(lineNumber: number): number { return this.getLineContent(lineNumber).length + 1; }
	getLanguageId(): string { return 'typescript'; }
	pushStackElement(): void { }

	getValueInRange(range: any): string {
		const [start, end] = this.offsetsFor(range);
		return this.content.slice(start, end);
	}

	getPositionAt(offset: number): { lineNumber: number; column: number } {
		const clamped = Math.max(0, Math.min(offset, this.content.length));
		const before = this.content.slice(0, clamped).split('\n');
		return { lineNumber: before.length, column: before[before.length - 1].length + 1 };
	}

	getOffsetAt(position: { lineNumber: number; column: number }): number {
		return this.offsetAt(position.lineNumber, position.column);
	}

	getFullModelRange(): { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } {
		const lineCount = this.getLineCount();
		return {
			startLineNumber: 1,
			startColumn: 1,
			endLineNumber: lineCount,
			endColumn: this.getLineMaxColumn(lineCount)
		};
	}

	getLinesContent(): string[] { return this.content.split('\n'); }
	getEOL(): string { return '\n'; }
	getLineFirstNonWhitespaceColumn(lineNumber: number): number {
		const line = this.getLineContent(lineNumber);
		const index = line.search(/\S/);
		return index < 0 ? 0 : index + 1;
	}
	getLineLength(lineNumber: number): number { return this.getLineContent(lineNumber).length; }
	isDisposed(): boolean { return false; }

	pushEditOperations(_selections: any, operations: readonly any[], _cursor: any): null {
		// Apply back-to-front so earlier offsets stay valid.
		const sorted = [...operations].sort((a, b) => this.offsetsFor(b.range)[0] - this.offsetsFor(a.range)[0]);
		for (const op of sorted) {
			this.applyEdit(op.range, op.text);
		}
		return null;
	}

	applyEdit(range: any, text: string): void {
		const [start, end] = this.offsetsFor(range);
		this.content = this.content.slice(0, start) + text + this.content.slice(end);
		this.versionId++;
	}

	private offsetsFor(range: any): [number, number] {
		return [
			this.offsetAt(range.startLineNumber, range.startColumn),
			this.offsetAt(range.endLineNumber, range.endColumn)
		];
	}

	private offsetAt(lineNumber: number, column: number): number {
		const lines = this.content.split('\n');
		let offset = 0;
		for (let i = 0; i < lineNumber - 1 && i < lines.length; i++) {
			offset += lines[i].length + 1;
		}
		return offset + (column - 1);
	}
}
