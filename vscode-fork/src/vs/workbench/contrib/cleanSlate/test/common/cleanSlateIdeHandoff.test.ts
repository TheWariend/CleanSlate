/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CleanSlateChatSessionProvider } from '../../browser/chat/providers/cleanSlateChatSessionProvider.js';
import { CleanSlateChatSessionSnapshotCodec } from '../../browser/chat/providers/cleanSlateChatSessionSnapshotCodec.js';
import { CLEANSLATE_HOSTED_AGENT_OWNER, type ICleanSlateThreadSessionUpdate } from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { CleanSlateBrowserAutomationService } from '../../browser/core/cleanSlateBrowserAutomationService.js';
import { Emitter, Event } from '../../../../../base/common/event.js';

suite('CleanSlate live IDE handoff', () => {
	test('hosted worker opens the existing side surface once and forwards native progress after parent completion', () => {
		const { ide } = createPair();
		const surfaceEvents: any[] = [];
		const stream: any[] = [];
		const side = { id: 'worker-side', parentSessionId: 'chat' };
		let starts = 0;
		ide._onDidChangeChildAgent = { fire: (event: any) => surfaceEvents.push(event) };
		ide.childAgentPresentations = new Map();
		ide.createSideChatForParent = () => { ide.sideChats.set(side.id, side); return side; };
		ide.startChildAgentPresentation = (_owner: any, _side: any, agent: any) => {
			starts++;
			ide.childAgentPresentations.set(agent.id, { queue: { push: (part: any) => stream.push(part) } });
		};
		const agent = { id: 'worker', parentAgentId: 'chat', kind: 'worker', description: 'Inspect', prompt: 'Inspect', status: 'running', createdAt: 1 };
		const events = [
			{ sequence: 1, event: { type: 'created', agent } },
			{ sequence: 2, event: { type: 'progress', agent, streamPart: { type: 'reasoning', content: 'Inspecting' } } },
			{ sequence: 3, event: { type: 'completed', agent: { ...agent, status: 'completed', output: 'Done' } } }
		];
		const live = { ownerId: CLEANSLATE_HOSTED_AGENT_OWNER, isRunning: false, childAgentEvents: events };
		ide.applyHostedChildEvents(ide.activeSession, live);
		ide.applyHostedChildEvents(ide.activeSession, live);
		assert.strictEqual(starts, 1);
		assert.strictEqual(surfaceEvents[0].event.type, 'created');
		assert.strictEqual(surfaceEvents[0].sideChatSessionId, 'worker-side');
		assert.strictEqual(surfaceEvents.length, 3);
		assert.deepStrictEqual(stream, [{ type: 'reasoning', content: 'Inspecting' }, undefined]);
		assert.strictEqual(ide.hostedChildren.get('worker').output, 'Done');
	});
	test('hiding a chat browser cancels an older layout that would reveal it again', async () => {
		let finishLayout!: () => void;
		const pending = new Promise<void>(resolve => { finishLayout = resolve; });
		const visibility: boolean[] = [];
		const model = { id: 'old-chat', layout: () => pending,
			setVisible: async (visible: boolean) => { visibility.push(visible); },
			bringToFront: () => assert.fail('The previous chat must not come to the front') };
		const service = new CleanSlateBrowserAutomationService({} as any, {} as any, {} as any);
		(service as any).getOpenCleanSlateBrowserModel = async () => model;
		const layout = service.layoutOpenBrowser({ x: 0, y: 0, width: 300, height: 400 } as any, 'agentManager:old');
		await Promise.resolve();
		await service.setOpenBrowserVisible(false, 'agentManager:old');
		finishLayout();
		await layout;
		assert.deepStrictEqual(visibility, [false]);
		service.dispose();
	});
	test('moves the hosted browser between manager and IDE without reopening or duplicate surface events', async () => {
		const navigation = new Emitter<void>();
		const model = { id: 'hosted-browser', url: 'file:///game.html', title: 'Game',
			onDidChangeNavigationState: navigation.event, onDidChangeLoadingState: Event.None,
			onDidChangeTitle: Event.None, onDidChangeAnnotationState: Event.None,
			onDidRequestNewPage: Event.None, onWillDispose: Event.None,
			loadURL: () => assert.fail('Adopting a hosted page must not navigate it') };
		let editorOpens = 0;
		const service = new CleanSlateBrowserAutomationService({
			getOrCreateBrowserViewModel: async (id: string) => { assert.strictEqual(id, model.id); return model; }
		} as any, { openEditor: async () => { editorOpens++; } } as any, {} as any);
		const surfaces: string[] = [];
		const subscription = service.onDidOpenBrowser(state => surfaces.push(state.surface));
		try {
			await service.adoptHostedBrowser(model.id, 'agentManager:task');
			assert.deepStrictEqual(surfaces, ['agentManager:task']);
			assert.strictEqual(editorOpens, 0);
			await service.adoptHostedBrowser(model.id, 'ide');
			assert.strictEqual(editorOpens, 1);
			surfaces.length = 0;
			navigation.fire();
			assert.deepStrictEqual(surfaces, ['ide']);
			await service.adoptHostedBrowser(model.id, 'ide');
			assert.strictEqual(editorOpens, 1, 'Streaming checkpoints must not repeatedly open the editor');
			await service.adoptHostedBrowser(model.id, 'agentManager:task');
			surfaces.length = 0;
			navigation.fire();
			assert.deepStrictEqual(surfaces, ['agentManager:task']);
		} finally {
			subscription.dispose();
			service.dispose();
			navigation.dispose();
		}
	});

	test('a rejected submission releases provisional ownership without adding a chat message or notification', async () => {
		const { owner, settle } = createPair();
		owner.running = false;
		owner.activeSession.controller.setExternalGeneratingState(false);
		owner.activeSession.agent.getHostedConfiguration = async () => ({ provider: 'openai' });
		const notifications: string[] = [];
		owner.notificationService = { error: (message: string) => notifications.push(message) };
		const transcript = JSON.stringify(owner.activeSession.transcriptHistory);
		owner.cleanSlateMainService.startHostedAgentRun = async () => { throw new Error('Call not found: startHostedAgentRun'); };
		await assert.rejects(owner.sendMessage('Hello', {}), /Call not found/);
		await settle();
		assert.strictEqual(owner.getIsGenerating(), false);
		assert.strictEqual(owner.activeSession.liveOwnerId, undefined);
		assert.strictEqual(owner.pendingHostedSubmissions.size, 0);
		assert.strictEqual(JSON.stringify(owner.activeSession.transcriptHistory), transcript);
		assert.deepStrictEqual(notifications, []);
	});
	test('an immediate IDE click waits for host acceptance and never starts a renderer loop', async () => {
		const { owner, updates } = createPair();
		owner.running = false;
		owner.activeSession.controller.setExternalGeneratingState(false);
		let resolveConfiguration!: (value: any) => void;
		owner.activeSession.agent.getHostedConfiguration = () => new Promise(resolve => { resolveConfiguration = resolve; });
		owner.activeSession.controller.sendMessage = () => assert.fail('Execution must not start in the renderer');
		let started = 0;
		owner.cleanSlateMainService.startHostedAgentRun = async (request: any) => {
			started++;
			return { originId: CLEANSLATE_HOSTED_AGENT_OWNER, session: request.session,
				live: { ownerId: CLEANSLATE_HOSTED_AGENT_OWNER, isRunning: true, runId: 'hosted-run' } };
		};
		const run = owner.sendMessage('Keep working', {});
		let handedOff = false;
		const handoff = owner.publishActiveSessionForIdeHandoff().then(() => { handedOff = true; });
		await Promise.resolve();
		assert.strictEqual(handedOff, false);
		assert.strictEqual(updates.some(update => update.makeActive), false);
		resolveConfiguration({ provider: 'openai' });
		await Promise.all([run, handoff]);
		assert.strictEqual(started, 1);
		assert.strictEqual(handedOff, true);
		assert.strictEqual(owner.hasOwnedRunningSessions(), false);
		assert.strictEqual(owner.getIsGenerating(), true);
		assert.strictEqual(updates.find(update => update.makeActive)?.live?.ownerId, CLEANSLATE_HOSTED_AGENT_OWNER);
	});

	test('unopened chats reflect live status without hydration', () => {
		const { owner } = createPair();
		const session = { ...owner.toPersistedSession(owner.buildSessionSnapshot(owner.activeSession)), id: 'unopened' };
		let changes = 0;
		owner._onDidChangeState = { fire() { changes++; } };
		for (const isRunning of [true, false]) {
			owner.applyPublishedThreadSession({ originId: CLEANSLATE_HOSTED_AGENT_OWNER, session,
				live: { ownerId: CLEANSLATE_HOSTED_AGENT_OWNER, isRunning, runId: 'remote' } });
			assert.strictEqual(owner.isSessionRunning(session.id), isRunning);
			assert.strictEqual(owner.sessions.has(session.id), false);
		}
		assert.strictEqual(changes, 2);
	});

	test('a late acceptance reply cannot overwrite a completed host checkpoint', async () => {
		const { owner } = createPair();
		owner.running = false;
		owner.activeSession.controller.setExternalGeneratingState(false);
		owner.activeSession.agent.getHostedConfiguration = async () => ({ provider: 'openai' });
		owner.cleanSlateMainService.startHostedAgentRun = async (request: any) => {
			owner.applyPublishedThreadSession({ originId: CLEANSLATE_HOSTED_AGENT_OWNER,
				session: { ...request.session, transcript: [...request.session.transcript, { id: 'hosted-run', role: 'assistant', content: 'Done' }] },
				live: { ownerId: CLEANSLATE_HOSTED_AGENT_OWNER, isRunning: false, runId: 'hosted-run' } });
			return { originId: CLEANSLATE_HOSTED_AGENT_OWNER, session: request.session,
				live: { ownerId: CLEANSLATE_HOSTED_AGENT_OWNER, isRunning: true, runId: 'hosted-run' } };
		};
		await owner.sendMessage('Keep working', {});
		assert.strictEqual(owner.getIsGenerating(), false);
		assert.strictEqual(owner.getTranscriptHistory().at(-1)?.content, 'Done');
	});
	test('closing the task view keeps execution subscriptions alive until completion', async () => {
		const { owner, settle } = createPair();
		let disposals = 0;
		owner._store = { dispose: () => disposals++ };
		owner.dispose();
		assert.strictEqual(disposals, 0);
		owner.runState.finish = () => { owner.running = false; return {}; };
		owner.finishRun(owner.activeSession, 'run', 'completed');
		await settle();
		assert.strictEqual(disposals, 1);
	});

	test('hidden task views keep recording messages without painting detached UI', async () => {
		const { owner, settle } = createPair();
		const renderer = owner.createSessionScopedRenderer(owner.activeSession, {
			isVisible: () => false,
			addMessage: () => assert.fail('Hidden view received a paint call')
		});
		renderer.addMessage('Continued after IDE handoff', 'cleanSlate');
		await settle();
		assert.strictEqual(owner.getTranscriptHistory().at(-1)?.content, 'Continued after IDE handoff');
	});
	test('same-project handoff preserves the owner and projects live progress and completion without echoes', async () => {
		const { owner, ide, updates, settle } = createPair();
		const originalMessages = owner.activeSession.agent.messages;
		await owner.publishActiveSessionForIdeHandoff();
		await settle();
		assert.strictEqual(owner.activeSession.agent.messages, originalMessages);
		assert.strictEqual(owner.activeSession.taskSessionService.interrupted, false);
		assert.strictEqual(owner.getIsGenerating(), true);
		assert.strictEqual(ide.getIsGenerating(), true);
		assert.strictEqual(ide.activeSession.taskSessionService.interrupted, false);
		assert.strictEqual(ide.activeSession.liveOwnerId, owner.providerId);
		assert.strictEqual(updates.some(update => update.originId === ide.providerId && !update.request), false);

		owner.activeSession.transcriptHistory.push({ role: 'assistant', content: 'Still working after opening the IDE' });
		owner.notifySessionChanged(owner.activeSession);
		await settle();
		assert.strictEqual(ide.getTranscriptHistory().at(-1)?.content, 'Still working after opening the IDE');
		assert.strictEqual(ide.getIsGenerating(), true);
		// A saved/echoed copy must not overwrite the active native conversation.
		owner.applyPublishedThreadSession({ originId: 'stale-view', session: updates[0].session });
		assert.strictEqual(owner.activeSession.agent.messages, originalMessages);
		assert.strictEqual(owner.activeSession.taskSessionService.interrupted, false);

		owner.running = false;
		owner.activeSession.controller.setExternalGeneratingState(false);
		owner.notifySessionChanged(owner.activeSession);
		await settle();
		assert.strictEqual(ide.getIsGenerating(), false);
		assert.strictEqual(ide.activeSession.taskSessionService.interrupted, false);
		assert.strictEqual(updates.some(update => update.originId === ide.providerId && !update.request), false);
	});

	test('restoring a saved copy of a mirrored run keeps it generating', async () => {
		const { owner, ide, settle } = createPair();
		await owner.publishActiveSessionForIdeHandoff();
		const saved = ide.toPersistedSession(ide.buildSessionSnapshot(ide.activeSession));
		ide.restoreSession(ide.fromPersistedSession(saved));
		await settle();
		assert.strictEqual(ide.getIsGenerating(), true);
		assert.strictEqual(ide.activeSession.taskSessionService.interrupted, false);
	});

	test('a newly opened IDE requests live state even while the owner has no new output', async () => {
		const { owner, ide, settle } = createPair();
		await ide.requestLiveSessionSync();
		await settle();
		assert.strictEqual(ide.getIsGenerating(), true);
		assert.strictEqual(ide.activeSession.liveOwnerId, owner.providerId);
	});

	test('Stop in the IDE reaches the execution owner once', async () => {
		const { owner, ide, settle } = createPair();
		await owner.publishActiveSessionForIdeHandoff();
		ide.abortGeneration({});
		await settle();
		assert.strictEqual(owner.activeSession.controller.abortCount, 1);
		assert.strictEqual(ide.activeSession.controller.abortCount, 0);
		assert.strictEqual(owner.getIsGenerating(), false);
		assert.strictEqual(ide.getIsGenerating(), false);
	});

	test('saved running flags alone never revive a task', () => {
		const { ide } = createPair();
		const saved = { ...ide.buildSessionSnapshot(ide.activeSession), status: 'running', isGenerating: true };
		const restored = ide.fromPersistedSession(saved);
		assert.strictEqual(restored.isGenerating, false);
		assert.strictEqual(restored.status, 'detached');
	});

	test('reflecting the handoff to its idle owner does not turn that owner into a mirror', async () => {
		const { owner } = createPair();
		owner.running = false;
		owner.activeSession.controller.setExternalGeneratingState(false);
		await owner.publishActiveSessionForIdeHandoff();
		assert.strictEqual(owner.activeSession.liveOwnerId, undefined);
	});
});

function createPair() {
	const updates: ICleanSlateThreadSessionUpdate[] = [];
	const providers: any[] = [];
	const service = {
		saveActiveThreadSession: async () => { },
		publishThreadSession: async (update: ICleanSlateThreadSessionUpdate) => {
			updates.push(update);
			for (const provider of providers) {
				provider.applyPublishedThreadSession(update);
			}
		}
	};
	const create = (surface: string, running: boolean): any => {
		const provider = Object.create(CleanSlateChatSessionProvider.prototype);
		Object.assign(provider, {
			providerId: surface, surface, running, activeSessionId: 'chat', activeSessionRevision: 0,
			sessions: new Map(), sideChats: new Map(), sideChatRenderers: new Map(),
			hostedChildren: new Map(), hostedChildSequences: new Map(),
			deletedSessionIds: new Set(), pendingLiveSyncSessions: new Map(),
			pendingHostedSubmissions: new Map(), publishedRunningSessions: new Map(), hostedApprovals: new Map(), hostedUpdateVersions: new Map(),
			liveSyncQueue: Promise.resolve(), snapshotCodec: new CleanSlateChatSessionSnapshotCodec(),
			cleanSlateMainService: service, _onDidChangeState: { fire() { } },
			isDeletedSessionSnapshot: () => false, isSnapshotForCurrentWorkspace: () => true,
			persistSession() { }, persistAppliedPublishedSession() { },
			getWorkspaceName: () => 'workspace', getWorkspaceId: () => 'workspace',
			getProjectRoot: () => 'file:///workspace', getWorkDir: () => '/workspace', delay: async () => { },
			runState: {
				isRunning: () => provider.running,
				cancel: () => { provider.running = false; }, clear: () => { provider.running = false; }
			}
		});
		let generating = running;
		const session: any = {
			id: 'chat', title: 'Task', workspaceId: 'workspace', projectRoot: 'file:///workspace', workDir: '/workspace',
			workspaceName: 'workspace', planMode: false, reasoningLevel: 'medium', status: running ? 'running' : 'detached',
			transcriptHistory: [{ role: 'user', content: 'Work on this task' }],
			threadService: {
				history: [{ role: 'user', content: 'Work on this task' }],
				getRawHistoryReference() { return this.history; },
				setHistory(history: any) { this.history = history; provider.notifySessionChanged(session); }
			},
			taskSessionService: {
				interrupted: false,
				restoreStateSnapshot(_snapshot: any, options: any) { this.interrupted = options.markActiveTaskInterrupted; }
			},
			agent: {
				messages: [{ role: 'assistant', content: 'Native conversation in progress' }],
				restoreRuntimeSnapshot(snapshot: any) { this.messages = snapshot.messages; },
				setSessionId() { }, setAgentDefinition() { }, restoreHostedArtifacts() { }
			},
			controller: {
				abortCount: 0, getIsGenerating: () => generating,
				setExternalGeneratingState(value: boolean) { generating = value; provider.notifySessionChanged(session); },
				abortGeneration() { this.abortCount++; generating = false; return true; }
			}
		};
		provider.sessions.set('chat', session);
		provider.buildSessionSnapshot = (target: any) => ({
			id: target.id, title: target.title, savedAt: Date.now(), workspaceId: 'workspace',
			projectRoot: 'file:///workspace', workDir: '/workspace', workspaceName: 'workspace',
			history: target.threadService.history, transcript: target.transcriptHistory,
			taskState: { status: 'running' }, agentRuntimeState: { version: 1, messages: target.agent.messages },
			planMode: false, reasoningLevel: 'medium', status: target.status,
			isGenerating: provider.isLiveSessionRunning(target)
		});
		providers.push(provider);
		return provider;
	};
	const owner = create('agentManager', true);
	const ide = create('ide', false);
	return { owner, ide, updates, settle: async () => {
		await owner.liveSyncQueue;
		await ide.liveSyncQueue;
	} };
}
