/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { CleanSlateChatController } from '../../browser/chat/runtime/cleanSlateChatController.js';
import { InteractionBlock } from '../../browser/chat/types/cleanSlateChatTypes.js';
import { CleanSlateThreadService } from '@cleanslate/sdk/services/cleanSlateThreadService.js';
import { CleanSlateTaskSessionService } from '@cleanslate/sdk/services/cleanSlateTaskSessionService.js';
import { CleanSlateTaskKind, CleanSlateTaskLifecycleStatus, CleanSlateWorkspaceShape } from '@cleanslate/sdk/services/cleanSlateTaskState.js';
import { AgentPhase } from '@cleanslate/sdk/agent/cleanSlatePrompts.js';
import { CleanSlateCommandApprovalService } from '../../browser/core/cleanSlateCommandApprovalService.js';
import { CleanSlateToolPresentation } from '../../browser/chat/runtime/cleanSlateToolPresentation.js';

suite('CleanSlateChatController completion rendering', () => {
	test('keeps all DOM snapshot rows so the disclosure count is exact', () => {
		const presentation = new CleanSlateToolPresentation();
		const block = presentation.createBrowserTimelineBlock('browser-snapshot', 'browser_snapshot', {}, false);
		const elements = Array.from({ length: 26 }, (_, index) => ({
			id: String(index + 1),
			tagName: 'div',
			text: `Element ${index + 1}`
		}));

		presentation.updateBrowserTimelineBlock(block, 'browser_snapshot', {}, {
			success: true,
			elements
		});

		assert.strictEqual(block.details?.length, 26);
		assert.strictEqual(block.details?.[6], '7: <div> Element 7');
		assert.strictEqual(block.details?.some(detail => detail.includes('more element')), false);
	});

	test('adds an evidence-backed completion block when an accepted turn would otherwise render blank', () => {
		const taskSessionService = new CleanSlateTaskSessionService();
		taskSessionService.startNewTask(CleanSlateTaskKind.MODIFY_EXISTING, CleanSlateWorkspaceShape.EXISTING, 'blank render guard');
		taskSessionService.setPhase(AgentPhase.EXECUTION);
		taskSessionService.recordEvidence({
			kind: 'completion',
			phase: AgentPhase.EXECUTION,
			status: CleanSlateTaskLifecycleStatus.COMPLETED,
			summary: 'Verified the browser task without file edits.'
		});

		const controller = createController(taskSessionService);
		const timeline: InteractionBlock[] = [{ id: 'turn-empty', type: 'turn', blocks: [], isStreaming: false }];

		(controller as any).ensureRenderableCompletion(timeline, {}, true, false);

		assert.strictEqual(timeline.some(block => block.type === 'finish' && block.content === 'Verified the browser task without file edits.'), true);
	});

	test('adds an explicit structured render error when completion has no displayable evidence', () => {
		const taskSessionService = new CleanSlateTaskSessionService();
		taskSessionService.startNewTask(CleanSlateTaskKind.MODIFY_EXISTING, CleanSlateWorkspaceShape.EXISTING, 'missing evidence');

		const controller = createController(taskSessionService);
		const timeline: InteractionBlock[] = [{ id: 'turn-empty', type: 'turn', blocks: [], isStreaming: false }];

		(controller as any).ensureRenderableCompletion(timeline, {}, true, false);

		assert.strictEqual(timeline.some(block => block.type === 'finish' && block.status === 'render_error'), true);
	});

	test('does not treat files_created without visible content as renderable', () => {
		const taskSessionService = new CleanSlateTaskSessionService();
		const controller = createController(taskSessionService);

		assert.strictEqual((controller as any).renderPayloadCodec.hasRenderableResponsePayload({
			files_created: ['implementation_plan.md']
		}), false);
	});

	test('treats assistant text timeline blocks as renderable completion', () => {
		const taskSessionService = new CleanSlateTaskSessionService();
		const controller = createController(taskSessionService);
		const timeline: InteractionBlock[] = [
			{ id: 'answer-1', type: 'assistant_text', content: 'The selected block builds the prompt suffix.', isStreaming: false }
		];

		(controller as any).ensureRenderableCompletion(timeline, {}, true, false);

		assert.deepStrictEqual(timeline.map(block => block.id), ['answer-1']);
	});

	test('keeps host completion summary as metadata when there is no file evidence', () => {
		const taskSessionService = new CleanSlateTaskSessionService();
		const controller = createController(taskSessionService);
		const timeline: InteractionBlock[] = [];

		const didRender = (controller as any).completionTimelineBuilder.upsertFinishTaskSummaryBlock(timeline, undefined, {
			completionSummary: {
				status: 'completed',
				summary: 'Explaining CLEANSLATE_CHAT_VIEW_ID from the selected TypeScript context.'
			}
		});

		assert.strictEqual(didRender, false);
		assert.deepStrictEqual(timeline, []);
	});

	test('retains the completed-files widget after approved-plan execution', () => {
		const taskSessionService = new CleanSlateTaskSessionService();
		const controller = createController(taskSessionService);
		const timeline: InteractionBlock[] = [{
			id: 'mutation-settings',
			type: 'file',
			path: '/tmp/workspace/lib/screens/settings_screen.dart',
			status: 'Modified',
			added: 1,
			deleted: 7,
			isStreaming: false
		}];

		const didRender = (controller as any).completionTimelineBuilder.upsertFinishTaskSummaryBlock(
			timeline,
			'execution-4',
			{
				completionSummary: {
					status: 'completed',
					filesChanged: [{ path: 'lib/screens/settings_screen.dart', added: 1, deleted: 7 }]
				}
			},
			true,
			true
		);

		assert.strictEqual(didRender, true);
		const finishBlock = timeline.find(block => block.id === 'finish-task-summary-final');
		assert.strictEqual(finishBlock?.type, 'finish');
		assert.deepStrictEqual(finishBlock?.fileChanges?.map(change => ({
			path: change.path,
			added: change.added,
			deleted: change.deleted
		})), [{
			path: '/tmp/workspace/lib/screens/settings_screen.dart',
			added: 1,
			deleted: 7
		}]);
	});

	test('retains the completed-files widget after normal execution without finish summary metadata', () => {
		const taskSessionService = new CleanSlateTaskSessionService();
		const controller = createController(taskSessionService);
		const timeline: InteractionBlock[] = [];

		(controller as any).fileChangeLedger.recordMutationResult(
			'apply_edit',
			{
				success: true,
				appliedBlocks: 1,
				path: '/tmp/workspace/lib/screens/tasks_screen.dart',
				beforeContent: 'old task row\n',
				afterContent: 'new task row\n'
			},
			(path: string | undefined) => (controller as any).completionTimelineBuilder.canonicalWorkspaceFilePath(path),
			'execution-4'
		);

		const didRender = (controller as any).completionTimelineBuilder.upsertFinishTaskSummaryBlock(
			timeline,
			'execution-4',
			{ success: true },
			false,
			true
		);

		assert.strictEqual(didRender, true);
		const finishBlock = timeline.find(block => block.id === 'finish-task-summary-execution-4');
		assert.strictEqual(finishBlock?.type, 'finish');
		assert.strictEqual(finishBlock?.status, 'completed');
		assert.deepStrictEqual(finishBlock?.fileChanges?.map(change => change.path), [
			'/tmp/workspace/lib/screens/tasks_screen.dart'
		]);
	});

	test('retains request-scoped file changes when the finishing assistant turn differs from the mutation turn', () => {
		const taskSessionService = new CleanSlateTaskSessionService();
		const controller = createController(taskSessionService);
		const timeline: InteractionBlock[] = [];

		(controller as any).fileChangeLedger.recordMutationResult(
			'apply_edit',
			{
				success: true,
				appliedBlocks: 1,
				path: '/tmp/workspace/lib/screens/request_turn_one.dart',
				beforeContent: 'old request turn\n',
				afterContent: 'new request turn\n'
			},
			(path: string | undefined) => (controller as any).completionTimelineBuilder.canonicalWorkspaceFilePath(path),
			'execution-4a'
		);

		const didRender = (controller as any).completionTimelineBuilder.upsertFinishTaskSummaryBlock(
			timeline,
			'execution-4b',
			{ success: true },
			false,
			true
		);

		assert.strictEqual(didRender, true);
		const finishBlock = timeline.find(block => block.id === 'finish-task-summary-execution-4b');
		assert.strictEqual(finishBlock?.type, 'finish');
		assert.deepStrictEqual(finishBlock?.fileChanges?.map(change => change.path), [
			'/tmp/workspace/lib/screens/request_turn_one.dart'
		]);
	});

	test('reconciles the completed-files widget from host task state in normal mode', () => {
		const taskSessionService = new CleanSlateTaskSessionService();
		taskSessionService.recordExecutionFilesChanged([{
			path: 'lib/screens/home_screen.dart',
			added: 4,
			deleted: 5
		}]);
		const controller = createController(taskSessionService);
		const timeline: InteractionBlock[] = [];

		const didRender = (controller as any).reconcileCompletedFilesWidget(timeline, 'execution-5', 'normal', true);

		assert.strictEqual(didRender, true);
		const finishBlock = timeline.find(block => block.id === 'finish-task-summary-execution-5');
		assert.deepStrictEqual(finishBlock?.fileChanges?.map(change => ({
			path: change.path,
			added: change.added,
			deleted: change.deleted
		})), [{
			path: '/tmp/workspace/lib/screens/home_screen.dart',
			added: 4,
			deleted: 5
		}]);
	});

	test('reconciles the completed-files widget per turn without leaking prior turn edits', () => {
		const taskSessionService = new CleanSlateTaskSessionService();
		taskSessionService.recordExecutionFilesChanged([{
			path: 'lib/screens/previous_turn.dart',
			added: 10,
			deleted: 3
		}]);
		const controller = createController(taskSessionService);
		const timeline: InteractionBlock[] = [];
		(controller as any).fileChangeLedger.recordMutationResult(
			'apply_edit',
			{
				success: true,
				appliedBlocks: 1,
				path: '/tmp/workspace/lib/screens/current_turn.dart',
				beforeContent: 'old\n',
				afterContent: 'new\n'
			},
			(path: string | undefined) => (controller as any).completionTimelineBuilder.canonicalWorkspaceFilePath(path),
			'execution-7'
		);

		const didRender = (controller as any).reconcileCompletedFilesWidget(timeline, 'execution-7', 'normal', true);

		assert.strictEqual(didRender, true);
		const finishBlock = timeline.find(block => block.id === 'finish-task-summary-execution-7');
		assert.deepStrictEqual(finishBlock?.fileChanges?.map(change => change.path), [
			'/tmp/workspace/lib/screens/current_turn.dart'
		]);
	});

	test('reconciles only the current turn task-state delta when prior turns already changed files', () => {
		const taskSessionService = new CleanSlateTaskSessionService();
		taskSessionService.recordExecutionFilesChanged([{
			path: 'lib/screens/previous_turn.dart',
			added: 10,
			deleted: 3
		}]);
		const baselineExecutionFilesChanged = taskSessionService.getExecutionFilesChanged();
		taskSessionService.recordExecutionFilesChanged([
			...baselineExecutionFilesChanged,
			{
				path: 'lib/screens/current_turn.dart',
				added: 2,
				deleted: 1
			}
		]);
		const controller = createController(taskSessionService);
		const timeline: InteractionBlock[] = [];

		const didRender = (controller as any).reconcileCompletedFilesWidget(
			timeline,
			'execution-8',
			'normal',
			true,
			baselineExecutionFilesChanged
		);

		assert.strictEqual(didRender, true);
		const finishBlock = timeline.find(block => block.id === 'finish-task-summary-execution-8');
		assert.deepStrictEqual(finishBlock?.fileChanges?.map(change => ({
			path: change.path,
			added: change.added,
			deleted: change.deleted
		})), [{
			path: '/tmp/workspace/lib/screens/current_turn.dart',
			added: 2,
			deleted: 1
		}]);
	});

	test('reconciles the completed-files widget from host task state after approved-plan execution', () => {
		const taskSessionService = new CleanSlateTaskSessionService();
		taskSessionService.recordExecutionFilesChanged([{
			path: 'lib/screens/main_screen.dart',
			added: 6,
			deleted: 9
		}]);
		const controller = createController(taskSessionService);
		const timeline: InteractionBlock[] = [];

		const didRender = (controller as any).reconcileCompletedFilesWidget(timeline, 'execution-6', 'planning', true);

		assert.strictEqual(didRender, true);
		const finishBlock = timeline.find(block => block.id === 'finish-task-summary-final');
		assert.deepStrictEqual(finishBlock?.fileChanges?.map(change => ({
			path: change.path,
			added: change.added,
			deleted: change.deleted
		})), [{
			path: '/tmp/workspace/lib/screens/main_screen.dart',
			added: 6,
			deleted: 9
		}]);
	});

	test('routes get_open_files through discovery activity instead of generic tool rows', () => {
		const taskSessionService = new CleanSlateTaskSessionService();
		const controller = createController(taskSessionService);

		assert.strictEqual((controller as any).isDiscoveryTool('get_open_files'), true);
		assert.strictEqual((controller as any).shouldCreateGenericToolBlock('get_open_files'), false);
		assert.strictEqual((controller as any).toolPresentation.describeToolStart('get_open_files', {}), 'Reading open files');
		assert.deepStrictEqual((controller as any).getDiscoveryActivityDetail('get_open_files', {}, 'open files'), { detailText: 'Reading open files' });
	});

	test('uses a completed label after browser_open succeeds', () => {
		const controller = createController(new CleanSlateTaskSessionService());
		const block = (controller as any).toolPresentation.createBrowserTimelineBlock(
			'browser-open-1',
			'browser_open',
			{ url: 'http://localhost:3000' },
			true
		);

		(controller as any).toolPresentation.updateBrowserTimelineBlock(
			block,
			'browser_open',
			{ url: 'http://localhost:3000' },
			{ success: true, url: 'http://localhost:3000' }
		);

		assert.strictEqual(block.browserAction, 'Opened http://localhost:3000');
		assert.strictEqual(block.browserStatus, 'completed');
	});

	test('keeps reasoning from separate model turns in timeline order', () => {
		const controller = createController(new CleanSlateTaskSessionService());
		const timeline: InteractionBlock[] = [];

		(controller as any).upsertReasoningBlock(timeline, 'execution-1', 'Inspecting the task flow.', true);
		(controller as any).markReasoningBlockComplete(timeline, 'execution-1');
		(controller as any).upsertReasoningBlock(timeline, 'execution-2', 'Checking the remaining screen states.', true);
		(controller as any).markReasoningBlockComplete(timeline, 'execution-2');

		const reasoningBlocks = timeline.filter(block => block.type === 'reasoning');
		assert.strictEqual(reasoningBlocks.length, 2);
		assert.deepStrictEqual(reasoningBlocks.map(block => block.id), ['reasoning-execution-1', 'reasoning-execution-2']);
		assert.deepStrictEqual(reasoningBlocks.map(block => block.content), ['Inspecting the task flow.', 'Checking the remaining screen states.']);
		assert.deepStrictEqual(reasoningBlocks.map(block => block.reasoningSegments?.length), [1, 1]);
		assert.deepStrictEqual(reasoningBlocks.map(block => block.isStreaming), [false, false]);
	});

	test('injects a visible planning handoff summary when a plan is created', () => {
		const taskSessionService = new CleanSlateTaskSessionService();
		const controller = createController(taskSessionService);
		const timeline: InteractionBlock[] = [{ id: 'turn-empty', type: 'turn', blocks: [], isStreaming: false }];
		const summary = 'I traced the layout and header wiring and drafted the implementation plan for review.';

		const payload = (controller as any).buildPlanningArtifactHandoffPayload(summary);
		(controller as any).upsertPlanningHandoffSummaryBlock(timeline, undefined, summary);

		assert.strictEqual(payload.summary, summary);
		assert.deepStrictEqual(payload.files_created, ['implementation_plan.md']);
		assert.strictEqual(timeline.some(block =>
			block.type === 'summary'
			&& block.content === summary
			&& block.summaryRole === 'completion'
		), true);
	});

	test('canApprovePlan ignores implementation plans from older task boundaries', () => {
		const taskSessionService = new CleanSlateTaskSessionService();
		taskSessionService.startNewTask(CleanSlateTaskKind.MODIFY_EXISTING, CleanSlateWorkspaceShape.EXISTING, 'old task');
		taskSessionService.setPhase(AgentPhase.PLANNING);

		const threadService = new CleanSlateThreadService();
		threadService.addMessage('user', 'old task');
		threadService.addMessage('assistant', '# Implementation Plan\n\nOld plan');
		threadService.startNewTaskBoundary();
		threadService.addMessage('user', 'new task');

		const controller = createController(taskSessionService, threadService);

		assert.strictEqual(controller.canApprovePlan(), false);
	});

	test('treats provider inactivity timeouts as a transient model termination', () => {
		const controller = createController(new CleanSlateTaskSessionService());

		assert.strictEqual((controller as any).isTransientAgentFailure(
			new Error('CleanSlate Pro did not receive provider activity for 120 seconds. Check the endpoint, API version, deployment/model name, credentials, and network.')
		), true);
	});

	test('clears the reconnect banner immediately when generation is aborted', () => {
		const controller = createController(new CleanSlateTaskSessionService());
		const activeController = new AbortController();
		(controller as any).controllers.set((controller as any).threadService, activeController);
		(controller as any).sessionGenerating.set((controller as any).threadService, true);
		let clearedTransportRetry = 0;
		let removedStreamingPlaceholders = 0;

		const didAbort = controller.abortGeneration({
			clearTransportRetry: () => clearedTransportRetry++,
			removeStreamingPlaceholders: () => removedStreamingPlaceholders++
		} as any);

		assert.strictEqual(didAbort, true);
		assert.strictEqual(activeController.signal.aborted, true);
		assert.strictEqual(clearedTransportRetry, 1);
		assert.strictEqual(removedStreamingPlaceholders, 1);
		assert.strictEqual(controller.getIsGenerating(), false);
	});

});

function createController(
	taskSessionService: CleanSlateTaskSessionService,
	threadService: CleanSlateThreadService = new CleanSlateThreadService(),
	agent: any = {}
): CleanSlateChatController {
	const emptyEvent = () => ({ dispose() { } });
	return new CleanSlateChatController(
		{
			getActiveCodeEditor: () => undefined
		} as any,
		{
			onDidPendingEditsChange: emptyEvent,
			getPendingEditsDiffs: () => []
		} as any,
		{} as any,
		agent,
		threadService,
		taskSessionService,
		{ getWorkspace: () => ({ folders: [{ uri: URI.file('/tmp/workspace') }] }) } as any,
		'test-session',
		new CleanSlateCommandApprovalService()
	);
}
