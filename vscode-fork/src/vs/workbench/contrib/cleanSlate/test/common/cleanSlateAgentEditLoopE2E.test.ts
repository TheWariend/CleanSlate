/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CleanSlateAgentParsingSupport } from '@cleanslate/sdk/agent/cleanSlateAgentParsing.js';
import { CleanSlateExecutionQueryEngine } from '@cleanslate/sdk/agent/cleanSlateExecutionQuery.js';
import { AgentPhase } from '@cleanslate/sdk/agent/cleanSlatePrompts.js';
import { CleanSlateThreadService } from '@cleanslate/sdk/services/cleanSlateThreadService.js';
import { CleanSlateTaskSessionService } from '@cleanslate/sdk/services/cleanSlateTaskSessionService.js';
import { normalizeApplyEditRequest } from '@cleanslate/sdk/tools/ApplyEditTool.js';

/**
 * End-to-end coverage for the chat -> execution pipeline that the unit suite did
 * not previously exercise: a scripted provider drives the REAL `runner.run()`
 * loop through a read -> apply_edit -> stop sequence against a stateful in-memory
 * workspace, and the edit is resolved through the REAL production string-match
 * engine (`normalizeApplyEditRequest`) rather than a hand-rolled replacement.
 *
 * This closes the "no full-loop e2e that simulates real user prompts through the
 * chat-to-execution pipeline" gap while staying inside the `test/common`
 * scoped-mocha harness (the real `apply_edit` tool is bound to VS Code editor DI
 * and cannot be stood up here, but its match/normalize core is pure and is the
 * part that actually decides whether a prompt mutates a file).
 */
suite('CleanSlateAgent edit-loop e2e', () => {

	interface ScriptedTurn {
		toolCall?: { toolName: string; input: any };
		text?: string;
	}

	/**
	 * A minimal but faithful workspace + tool executor: `read_file` records that
	 * the file was read, and `apply_edit` runs the real normalizer and mutates the
	 * in-memory content exactly as the production tool would compute it.
	 */
	function createWorkspaceExecutor(files: Map<string, string>) {
		const reads = new Set<string>();
		const executeTool = async function* (toolName: string, input: any) {
			const path: string | undefined = input?.file_path ?? input?.path;
			if (toolName === 'read_file') {
				if (path) {
					reads.add(path);
				}
				yield {
					type: 'tool_result',
					toolName,
					result: { success: true, path, content: path ? files.get(path) ?? '' : '' }
				};
				return;
			}
			if (toolName === 'apply_edit') {
				if (!path || !files.has(path)) {
					yield { type: 'tool_result', toolName, result: { success: false, code: 'file_not_found', path } };
					return;
				}
				// Mirror the tool's read-before-edit gate so recovery paths are exercised.
				if (!reads.has(path)) {
					yield { type: 'tool_result', toolName, result: { success: false, code: 'file_not_read', path } };
					return;
				}
				const current = files.get(path)!;
				const normalized = normalizeApplyEditRequest(input, current);
				if (!normalized.ok) {
					yield { type: 'tool_result', toolName, result: { success: false, path, ...normalized.result } };
					return;
				}
				const edit = normalized.edits[0];
				let next: string;
				if (edit.mode === 'full_file') {
					next = edit.content ?? current;
				} else {
					// replace_exact: apply the single resolved occurrence.
					next = current.replace(edit.originalText!, edit.replacementText!);
				}
				files.set(path, next);
				yield { type: 'tool_result', toolName, result: { success: true, path, afterContent: next } };
				return;
			}
			yield { type: 'tool_result', toolName, result: { success: true } };
		};
		return { executeTool, reads };
	}

	function buildEngine(script: ScriptedTurn[], files: Map<string, string>) {
		const parsingSupport = new CleanSlateAgentParsingSupport({
			getConfiguration: () => ({ planMode: false, reasoningLevel: 'low' })
		} as any);
		const { executeTool } = createWorkspaceExecutor(files);
		let turn = 0;
		const engine = new CleanSlateExecutionQueryEngine({
			cleanSlateService: {
				chat: async () => (async function* () {
					const current = script[turn++];
					if (!current) {
						yield { type: 'text', content: 'Done.' };
						return;
					}
					if (current.toolCall) {
						yield { type: 'tool_call', call: current.toolCall };
						return;
					}
					yield { type: 'text', content: current.text ?? 'Done.' };
				})()
			},
			cleanSlateContextService: {
				getContext: async () => ({ activeFile: { languageId: 'typescript' }, openFiles: [] })
			},
			buildPromptContext: async () => 'Prompt Context',
			getCurrentAgentDefinition: () => undefined,
			parsingSupport,
			executionSupport: {
				createMarkerBaseline: () => new Map(),
				collectNewMarkerIssues: async () => [],
				trackTouchedPaths: () => { },
				didToolSucceed: (result: any) => result?.success !== false,
				isConfirmedMutationResult: (toolName: string, _input: any, result: any) =>
					toolName === 'apply_edit' && result?.success === true
			},
			executeTool,
			toolContext: {
				configService: { getConfiguration: () => ({ contextWindow: 200_000, maxInputTokens: 200_000 }) },
				workspaceContextService: {
					getWorkspaceFolder: () => undefined,
					getWorkspace: () => ({ folders: [] })
				}
			} as any,
			recentFocusLines: new Map(),
			referenceBuffer: new Map(),
			checkCrossFileReferences: async () => [],
			getToolCategory: (toolName: string) => toolName === 'read_file' ? 'discovery' : undefined
		} as any);
		return engine;
	}

	async function drive(engine: CleanSlateExecutionQueryEngine): Promise<any[]> {
		const threadService = new CleanSlateThreadService();
		const taskSessionService = new CleanSlateTaskSessionService();
		taskSessionService.setPhase(AgentPhase.EXECUTION);
		const parts: any[] = [];
		for await (const part of engine.run(
			[
				{ role: 'system', content: 'placeholder' },
				{ role: 'user', content: '[CONTEXT]\nplaceholder' }
			] as any,
			'Rename the greeting value',
			'Execution',
			{ activeFile: { languageId: 'typescript' } },
			'',
			threadService,
			taskSessionService
		)) {
			parts.push(part);
		}
		return parts;
	}

	test('happy path: a prompt drives read -> apply_edit -> stop and mutates the file on disk', async () => {
		const files = new Map<string, string>([
			['/workspace/app.ts', 'export const greeting = "hello";\n']
		]);
		const engine = buildEngine([
			{ toolCall: { toolName: 'read_file', input: { file_path: '/workspace/app.ts' } } },
			{ toolCall: { toolName: 'apply_edit', input: { file_path: '/workspace/app.ts', old_string: '"hello"', new_string: '"world"' } } },
			{ text: 'Renamed the greeting.' }
		], files);

		const parts = await drive(engine);

		// The real edit engine resolved the match and the workspace content changed.
		assert.strictEqual(files.get('/workspace/app.ts'), 'export const greeting = "world";\n');

		const editResult = parts.find(part => part.type === 'tool_result' && part.toolName === 'apply_edit');
		assert.ok(editResult, 'apply_edit tool_result should be surfaced to the loop');
		assert.strictEqual(editResult.result.success, true);

		// A non-tool prose turn is the natural stop; the host finalizes the task.
		assert.strictEqual(parts.some(part => part.type === 'task_complete'), true);
	});

	test('sad path: a non-matching old_string returns no_match and the loop recovers to a real edit', async () => {
		const files = new Map<string, string>([
			['/workspace/app.ts', 'export const greeting = "hello";\n']
		]);
		const engine = buildEngine([
			{ toolCall: { toolName: 'read_file', input: { file_path: '/workspace/app.ts' } } },
			// Wrong anchor: not present in the file -> real engine reports no_match.
			{ toolCall: { toolName: 'apply_edit', input: { file_path: '/workspace/app.ts', old_string: '"goodbye"', new_string: '"world"' } } },
			// Corrected anchor -> succeeds.
			{ toolCall: { toolName: 'apply_edit', input: { file_path: '/workspace/app.ts', old_string: '"hello"', new_string: '"world"' } } },
			{ text: 'Fixed after the first attempt missed.' }
		], files);

		const parts = await drive(engine);

		const editResults = parts.filter(part => part.type === 'tool_result' && part.toolName === 'apply_edit');
		assert.strictEqual(editResults.length, 2, 'both the failed and the corrected edit should reach the loop');

		const failure = editResults[0].result;
		assert.strictEqual(failure.success, false);
		assert.strictEqual(failure.code, 'no_match');

		const recovered = editResults[1].result;
		assert.strictEqual(recovered.success, true);

		// The file only changed once the corrected edit landed.
		assert.strictEqual(files.get('/workspace/app.ts'), 'export const greeting = "world";\n');
		assert.strictEqual(parts.some(part => part.type === 'task_complete'), true);
	});

	test('read-before-edit gate: editing an unread file is rejected by the same policy the tool enforces', async () => {
		const files = new Map<string, string>([
			['/workspace/app.ts', 'export const greeting = "hello";\n']
		]);
		// No read turn first: the edit must be gated.
		const engine = buildEngine([
			{ toolCall: { toolName: 'apply_edit', input: { file_path: '/workspace/app.ts', old_string: '"hello"', new_string: '"world"' } } },
			{ toolCall: { toolName: 'read_file', input: { file_path: '/workspace/app.ts' } } },
			{ toolCall: { toolName: 'apply_edit', input: { file_path: '/workspace/app.ts', old_string: '"hello"', new_string: '"world"' } } },
			{ text: 'Read first, then edited.' }
		], files);

		const parts = await drive(engine);

		const editResults = parts.filter(part => part.type === 'tool_result' && part.toolName === 'apply_edit');
		assert.strictEqual(editResults[0].result.success, false);
		assert.strictEqual(editResults[0].result.code, 'file_not_read');
		assert.strictEqual(editResults[1].result.success, true);
		assert.strictEqual(files.get('/workspace/app.ts'), 'export const greeting = "world";\n');
	});
});
