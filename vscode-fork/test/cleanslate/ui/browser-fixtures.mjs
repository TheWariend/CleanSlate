import { CLEANSLATE_CHAT_STYLES } from '/vs/workbench/contrib/cleanSlate/browser/chat/styles/cleanSlateChatStyles.js';
import { CleanSlateComposerView } from '/vs/workbench/contrib/cleanSlate/browser/chat/view/sections/cleanSlateComposerView.js';
import { CleanSlateCommandApprovalView } from '/vs/workbench/contrib/cleanSlate/browser/chat/view/sections/cleanSlateCommandApprovalView.js';
import { CleanSlatePlanApprovalView } from '/vs/workbench/contrib/cleanSlate/browser/chat/view/sections/cleanSlatePlanApprovalView.js';
import { CleanSlatePlanningQuestionView } from '/vs/workbench/contrib/cleanSlate/browser/chat/view/sections/cleanSlatePlanningQuestionView.js';
import { CleanSlatePendingEditsBarView } from '/vs/workbench/contrib/cleanSlate/browser/chat/view/sections/cleanSlatePendingEditsBarView.js';
import { CleanSlatePendingEditsRenderer } from '/vs/workbench/contrib/cleanSlate/browser/chat/renderers/cleanSlatePendingEditsRenderer.js';
import { URI } from '/vs/base/common/uri.js';
import { Registry } from '/vs/platform/registry/common/platform.js';
import { Extensions } from '/vs/platform/theme/common/themeService.js';
import { getIconsStyleSheet } from '/vs/platform/theme/browser/iconsStyleSheet.js';

const style = document.head.appendChild(document.createElement('style'));
style.textContent = CLEANSLATE_CHAT_STYLES;
const icons = getIconsStyleSheet(undefined);
style.textContent += icons.getCSS();
const registry = Registry.as(Extensions.ThemingContribution);
const start = registry.getThemingParticipants().length;
await import('/vs/workbench/contrib/cleanSlate/browser/agentManager/cleanSlateAgentManagerStyles.js');
for (const participant of registry.getThemingParticipants().slice(start)) {
	participant({ getColor: () => undefined }, { addRule: rule => { style.textContent += rule; } });
}
export const events = [];
const record = name => (...args) => events.push({ name, args: args.map(arg => arg instanceof HTMLElement ? arg.className : arg) });
export const qa = globalThis.qa = { events };

export function mountComposer(compact = false) {
	const root = document.getElementById('fixture');
	root.className = 'cleanSlate-chat-view';
	root.style.cssText = 'display:flex;flex-direction:column;justify-content:flex-end;padding:16px;';
	let composer;
	composer = new CleanSlateComposerView(root, {
		compact, workspaceName: 'QA project', onWorkspaceSelector: record('workspace'),
		mountPanels(parent) {
			qa.command = new CleanSlateCommandApprovalView(parent, {
				focusInput: () => composer?.focus(), onApprove: record('approve'), onApproveForSession: record('approveSession'), onCancel: record('cancel'), onDidChange() {},
			});
			qa.plan = new CleanSlatePlanApprovalView(parent, {
				getInputValue: () => composer?.getValue() ?? '', focusInput: () => composer?.focus(), onApprove: record('planApprove'), onRevise: record('planRevise'), onDidChange() {},
			});
			qa.question = new CleanSlatePlanningQuestionView(parent, () => composer?.getInputElement(), () => {}, record('dismissQuestion'));
		},
		onSubmit: record('submit'), onStop: record('stop'), onImageAdded: record('image'), onImageRemoved: record('removeImage'),
		onReasoningSelector: record('reasoning'), onPlanModeCommand: record('plan'), onPlanModeDisabled: record('disablePlan'),
		onModelSelector: record('model'), onAgentSelector: record('agent'), onEditModeSelector: record('editMode'),
		onDeleteAnnotations: record('deleteAnnotations'), onRemoveSelectionReference: record('removeSelection'),
		onKeyDown: event => qa.command.handleKeyDown(event) || qa.question.handleKeyDown(event),
	});
	composer.updateModel('QA Model', false, 'openai', 'qa-model');
	composer.updateReasoning('Medium');
	composer.updateContextWindowUsage({ usedTokens: 25000, maxTokens: 100000, percent: 25, isGenerating: false });
	qa.composer = composer;
	qa.edits = new CleanSlatePendingEditsBarView(root, new CleanSlatePendingEditsRenderer({ read: () => [] }), record('acceptAll'), record('rejectAll'));
	qa.uri = URI;
	return qa;
}

export async function mountSettings(state = 'signedOut') {
	const { CleanSlateSettingsPanel } = await import('/vs/workbench/contrib/cleanSlate/browser/settings/cleanSlateSettingsPanel.js');
	const root = document.getElementById('fixture');
	qa.config = { provider: state === 'signedOut' ? 'openai' : 'cleanslate', providers: { openai: { model: 'qa-model', apiKey: 'qa-only' }, cleanslate: { apiKey: state === 'signedOut' ? '' : 'qa-fake-token' } }, ragEnabled: true, failOnWarnings: true };
	const entitlements = state === 'free' ? {} : { plan: { id: 'pro' }, can_use_managed_ai: state === 'pro', models: [] };
	qa.settings = new CleanSlateSettingsPanel({
		getResolvedConfiguration: async () => qa.config,
		getManagedAccount: () => state === 'signedOut' ? undefined : { email: 'qa@example.test', name: 'QA account' },
		getManagedEntitlements: async () => { if (state === 'unavailable') throw new Error('QA service unavailable'); return entitlements; },
		updateConfiguration: async value => { qa.config = { ...qa.config, ...value, providers: { ...qa.config.providers, ...value.providers } }; events.push({ name: 'save', value }); },
	}, { getModels: async () => ['qa-model', 'qa-alternative'] }, {
		signIn: async () => record('signIn')(), upgradeToPro: async () => record('upgrade')(), signOut: async () => record('signOut')(), manageAccount: async () => record('manageAccount')(),
	}, { listExternalAgents: async () => [], getExternalAgentUsage: async () => ({}), registerExternalAgent: async () => record('registerAgent')() }, undefined, async () => record('importChats')());
	qa.settings.mount(root);
	await qa.settings.render();
	return qa;
}

export async function mountBrowserChat(integrated = false) {
	const { CleanSlateWorkspaceBrowser } = await import('/vs/workbench/contrib/cleanSlate/browser/agentManager/cleanSlateWorkspaceBrowser.js');
	const { CleanSlateBrowserAutomationService } = await import('/vs/workbench/contrib/cleanSlate/browser/core/cleanSlateBrowserAutomationService.js');
	const { Event, Emitter } = await import('/vs/base/common/event.js');
	const root = document.getElementById('fixture');
	root.className = 'cleanSlate-agent-manager-surface browser-mode';
	root.style.cssText = 'display:flex;gap:12px;padding:12px;';
	const sidebar = root.appendChild(document.createElement('div'));
	sidebar.className = 'cleanSlate-agent-manager-nav';
	sidebar.style.cssText = 'width:180px;flex-shrink:0;';
	const main = root.appendChild(document.createElement('main'));
	main.style.cssText = 'flex:1;min-width:0;display:flex;';
	const chat = root.appendChild(document.createElement('aside'));
	chat.style.cssText = 'display:none;width:340px;flex-shrink:0;';
	const storage = { get: (_key, _scope, fallback) => fallback, store() {}, flush: async () => {}, onDidChangeValue: () => Event.None, onWillSaveState: Event.None };
	const models = new Map();
	qa.browser = new CleanSlateWorkspaceBrowser({
		getOrCreateBrowserViewModel: async id => {
			if (models.has(id)) { return models.get(id); }
			const navigation = new Emitter();
			const model = {
				id, url: 'about:blank', title: 'QA page', loading: false, visible: false,
				onDidChangeNavigationState: navigation.event, onDidChangeLoadingState: Event.None, onDidChangeTitle: Event.None,
				onDidChangeFavicon: Event.None, onDidKeyCommand: Event.None, onDidRequestNewPage: Event.None,
				onDidClose: Event.None, onWillDispose: Event.None,
				loadURL: async url => { model.url = url; navigation.fire(); },
				layout: async bounds => { (qa.nativeLayouts ??= []).push({ id, ...bounds }); }, setVisible: async value => { model.visible = value; }, bringToFront: async () => {},
				getDiagnostics: async () => undefined,
				executeJavaScript: async code => { const result = qa.pageFrame.contentWindow.eval(code); return result && typeof result === 'object' && 'text' in result ? { ...result, url: model.url } : result; }, dispose() { navigation.dispose(); },
			};
			models.set(id, model);
			return model;
		}
	}, storage, { createWorkerClient: () => ({ dispose() {}, proxy: { $serialize: async value => value } }) });
	qa.browser.mount(main, sidebar);
	qa.browser.onDidOpenTab(({ id, background }) => { if (!background) { qa.browser.activate(id); } });
	await qa.browser.openTab('about:srcdoc');
	qa.browser.setVisible(true);
	const viewport = main.querySelector('.cleanSlate-workspace-browser-viewport');
	const frame = qa.pageFrame = viewport.appendChild(document.createElement('iframe'));
	frame.style.cssText = 'width:100%;height:100%;border:0;';
	frame.srcdoc = '<!doctype html><html><head><title>QA article</title></head><body><main><h1>Readable article</h1><p id="passage">A selected passage for chat.</p><p hidden>hidden secret</p><p style="display:none">display secret</p><p style="visibility:hidden">visibility secret</p><p aria-hidden="true">aria secret</p><input type="password" value="password secret"><textarea>form secret</textarea><select><option>choice secret</option></select></main></body></html>';
	await new Promise(resolve => { frame.onload = resolve; });
	qa.automation = new CleanSlateBrowserAutomationService({}, {}, {});
	const surface = 'agentManager:browser-chat';
	const host = {
		onDidChange: qa.browser.onDidChange,
		getActiveTab: () => qa.browser.getActiveBrowserModel(), getTabs: () => qa.browser.getBrowserModels(),
		openTab: (url, background) => qa.browser.openTab(url, background), selectTab: id => qa.browser.activate(id), closeTab: async id => qa.browser.closeTab(id),
	};
	if (!integrated) { qa.browser.onDidRequestChat(() => {
		chat.style.display = 'block';
		qa.browser.setChatVisible(true);
		qa.binding = qa.automation.bindWorkspaceBrowser(surface, host);
	}); }
	qa.browserParts = { root, sidebar, main, chat, storage, host };
	qa.readPage = () => qa.automation.getAttachedPageContext(surface);
	qa.disposeBrowserChat = () => { qa.binding?.dispose(); qa.automation.dispose(); qa.browser.dispose(); };
	return qa;
}

// Production panel, provider, controller, agent and query loop with a scripted
// model and native-view transport. Host IDE reads deliberately fail the test.
export async function mountIntegratedBrowserChat() {
	await mountBrowserChat(true);
	const { CleanSlateAgentWorkspaceOverlay } = await import('/vs/workbench/contrib/cleanSlate/browser/agentManager/cleanSlateAgentWorkspaceOverlay.js');
	const { CleanSlateChatSessionProvider } = await import('/vs/workbench/contrib/cleanSlate/browser/chat/providers/cleanSlateChatSessionProvider.js');
	const { CleanSlateAgent } = await import('/vs/workbench/contrib/cleanSlate/browser/agent/cleanSlateAgent.js');
	const { CleanSlateTranscriptRenderer } = await import('/vs/workbench/contrib/cleanSlate/browser/chat/renderers/cleanSlateTranscriptRenderer.js');
	const { CleanSlateAgentManagerRightPaneView } = await import('/vs/workbench/contrib/cleanSlate/browser/agentManager/cleanSlateAgentManagerRightPaneView.js');
	const { CleanSlateCommandApprovalService } = await import('/vs/workbench/contrib/cleanSlate/browser/core/cleanSlateCommandApprovalService.js');
	const { IWorkspaceContextService } = await import('/vs/platform/workspace/common/workspace.js');
	const { ICleanSlateContextService } = await import('/vs/workbench/services/cleanSlate/common/core/cleanSlateAI.js');
	const { Event, Emitter } = await import('/vs/base/common/event.js');
	const { Dialog } = await import('/vs/base/browser/ui/dialog/dialog.js');
	const { ContextView } = await import('/vs/base/browser/ui/contextview/contextview.js');
	const { CleanSlateModelSelectorRenderer } = await import('/vs/workbench/contrib/cleanSlate/browser/chat/renderers/cleanSlateModelSelectorRenderer.js');
	const { CleanSlateReasoningSelectorRenderer } = await import('/vs/workbench/contrib/cleanSlate/browser/chat/renderers/cleanSlateModeSelectorRenderer.js');
	const { CleanSlateEditModeSelectorRenderer } = await import('/vs/workbench/contrib/cleanSlate/browser/chat/renderers/cleanSlateEditModeSelectorRenderer.js');
	const { DisposableStore } = await import('/vs/base/common/lifecycle.js');
	const { root, sidebar, main, chat } = qa.browserParts;
	const disposables = new DisposableStore();
	const contextView = disposables.add(new ContextView(document.body, 2));
	const contextViewService = { showContextView: delegate => contextView.show(delegate), hideContextView: () => contextView.hide() };
	qa.requests = []; qa.published = []; qa.modelScript = [];
	qa.externalStarts = []; qa.externalPrompts = []; qa.externalHostResponses = [];
	const externalEvents = disposables.add(new Emitter());
	const forbidden = name => () => { throw new Error(`Browser chat read forbidden host context: ${name}`); };
	const editor = { getActiveCodeEditor: forbidden('active editor') };
	const context = { _serviceBrand: undefined, getContext: forbidden('IDE context') };
	const workspace = {
		getWorkspace: () => ({ id: 'private-project', folders: [{ uri: URI.file('/project-private'), name: 'Private project', index: 0 }] }),
		onDidChangeWorkbenchState: Event.None, onDidChangeWorkspaceName: Event.None,
		onWillChangeWorkspaceFolders: Event.None, onDidChangeWorkspaceFolders: Event.None,
	};
	const config = { getConfiguration: () => ({ provider: 'openai', contextWindow: 200000, planMode: false, reasoningLevel: 'low' }) };
	qa.notifications = [];
	const notifications = { error: error => { qa.notifications.push(String(error)); }, warn: record('warning'), info() {} };
	const approval = new CleanSlateCommandApprovalService();
	const settingsProvider = { getState: () => ({ reasoningLevel: 'low', editMode: 'ask' }), updateReasoningLevel: async () => {}, updateEditMode: async () => {} };
	const selectorState = { configured: true, currentModel: 'qa', models: ['qa'], canSelectModel: true, canLoadModels: true, showProviderSwitcher: false, showMissingCredentialsNotice: false };
	const modelProvider = {
		getState: () => ({ provider: 'openai', model: 'qa' }), getCachedSelectorState: () => selectorState, getSelectorState: async () => selectorState,
		formatModelLabel: () => 'QA Model', updateModel: async () => {}, getProviderOptions: () => ['openai'],
		getReasoningSelectorState: () => ({ model: 'QA Model', options: [{ level: 'none', enabled: true }, { level: 'low', enabled: true }, { level: 'high', enabled: true }] })
	};
	const edits = { onDidPendingEditsChange: Event.None, getPendingEditsInfo: () => [] };
	const marker = { read: () => [] };
	const markdown = { render: value => { const element = document.createElement('div'); element.textContent = value.value; return { element, dispose() {} }; } };
	const mainService = {
		onDidPublishThreadSession: Event.None, onDidEmitExternalAgentEvent: externalEvents.event,
		listExternalAgents: async () => [{ id: 'qa-acp', name: 'QA ACP', transport: 'acp', available: true }],
		closeExternalAgentSession: async () => {},
		cancelExternalAgentSession: async id => externalEvents.fire({ type: 'status', cleanSlateSessionId: id, status: 'cancelled' }),
		startExternalAgentSession: async request => {
			qa.externalStarts.push(request);
			return { cleanSlateSessionId: request.cleanSlateSessionId, externalSessionId: `remote-${request.cleanSlateSessionId}`, config: request.config,
				models: { configId: 'model', current: request.modelSelection?.value ?? 'qa-model', options: [{ value: 'qa-model', name: 'QA ACP Model' }] }, controls: [] };
		},
		promptExternalAgentSession: async request => {
			qa.externalPrompts.push(request);
			if (qa.acpHostTool) {
				await new Promise(resolve => {
					qa.resolveACPHostTool = resolve;
					externalEvents.fire({ type: 'host_tool', cleanSlateSessionId: request.cleanSlateSessionId, ownerId: provider.providerId, requestId: 'qa-acp-tool', name: qa.acpHostTool, input: {} });
				});
			}
			externalEvents.fire({ type: 'message', cleanSlateSessionId: request.cleanSlateSessionId, text: 'ACP browser answer.' });
			externalEvents.fire({ type: 'status', cleanSlateSessionId: request.cleanSlateSessionId, status: 'completed' });
		},
		respondToExternalAgentHostTool: async response => { qa.externalHostResponses.push(response); qa.resolveACPHostTool?.(); },
		publishThreadSession: async value => { qa.published.push(value); },
		saveActiveThreadSession: forbidden('project persistence'),
		startHostedAgentRun: forbidden('project hosted runtime'),
	};
	const modelService = { chat: async (messages, options) => {
		qa.requests.push(JSON.parse(JSON.stringify({ messages, tools: options.tools })));
		return (async function* () {
			if (qa.holdReply) { await new Promise(resolve => { qa.releaseReply = resolve; }); }
			const turn = qa.modelScript.shift();
			if (turn?.tool) { yield { type: 'tool_call', call: { toolName: turn.tool, input: turn.input ?? {} } }; }
			else { yield { type: 'text', content: turn?.text ?? 'The article describes a selected passage.' }; }
		})();
	} };
	const storage = {
		get: (key, scope, fallback) => localStorage.getItem(`${scope}:${key}`) ?? fallback,
		store: (key, value, scope) => localStorage.setItem(`${scope}:${key}`, value),
		remove: (key, scope) => localStorage.removeItem(`${scope}:${key}`),
		getBoolean: (key, scope, fallback = false) => localStorage.getItem(`${scope}:${key}`) === null ? fallback : localStorage.getItem(`${scope}:${key}`) === 'true',
		getNumber: (key, scope, fallback) => Number(localStorage.getItem(`${scope}:${key}`) ?? fallback),
		onWillSaveState: Event.None, onDidChangeValue: () => Event.None,
	};
	const instantiation = {
		createChild(services) {
			return { createInstance(_ctor, thread, task) {
				return new CleanSlateAgent(thread, task, modelService, mainService, services.get(ICleanSlateContextService),
					{}, { files: { onDidResolve: Event.None, get: forbidden('text files'), resolve: forbidden('text files') } }, editor, { search: forbidden('semantic retrieval') }, {}, services.get(IWorkspaceContextService), config,
					{ readFile: forbidden('project instructions') }, marker, { getLatestArtifactByType: forbidden('project artifacts') },
					instantiation, {}, {}, {}, {}, {}, {}, {}, qa.automation, approval, {}, {},
					{ workspaceResolved: Promise.resolve(), isWorkspaceTrusted: () => true });
			} };
		},
		createInstance(ctor) {
			if (ctor !== CleanSlateTranscriptRenderer) { throw new Error('Unexpected UI dependency'); }
			return new CleanSlateTranscriptRenderer(marker, {}, markdown, { writeText: async () => {} });
		}
	};
	const makeProvider = () => new CleanSlateChatSessionProvider(instantiation, editor, edits, notifications, storage, workspace, context, mainService, approval, undefined, 'agentManager');
	let provider = makeProvider();
	await provider.whenReady();
	// This parent history must never seed the browser conversation.
	provider.activeSession.threadService.addMessage('user', 'PARENT_TASK_SECRET');
	chat.className = 'cleanSlate-agent-manager-right-pane';
	chat.style.cssText = 'display:flex;width:var(--cleanSlate-agent-manager-right-width,340px);flex-shrink:0;';
	const view = new CleanSlateAgentManagerRightPaneView(markdown, async () => {});
	const parts = view.build(chat);
	const handle = root.appendChild(document.createElement('div'));
	handle.className = 'cleanSlate-agent-manager-right-resize-handle';
	handle.style.cssText = 'display:block;position:absolute;top:0;bottom:0;right:var(--cleanSlate-agent-manager-right-width,340px);width:8px;z-index:20;';
	const manager = Object.create(CleanSlateAgentWorkspaceOverlay.prototype);
	Object.assign(manager, {
		root, rightPaneView: view, rightPane: chat, rightPaneTitle: parts.title, rightPaneTabsEl: parts.tabs, rightPaneBody: parts.body, rightResizeHandle: handle,
		targetWindow: window, shellDisposables: disposables, rightPaneMarkdownDisposables: new DisposableStore(),
		openWorkspaceTabIds: [], workspaceSelectionRequest: 0, rightPaneOpenTabs: [], rightPaneVisible: false, rightPaneActiveTab: undefined, browserChatPaneVisible: false, rightPaneArtifacts: new Map(),
		browserChatBindings: new Map(), sideChatSessionByParent: new Map(), pendingSideChatImages: new Map(), workspaceBrowser: qa.browser,
		externalAgentDescriptors: new Map(), cleanSlateMainService: mainService,
		contextViewService, contextMenuService: { showContextMenu() {} },
		modelSelectorRenderer: new CleanSlateModelSelectorRenderer(modelProvider, () => {}),
		reasoningSelectorRenderer: new CleanSlateReasoningSelectorRenderer(settingsProvider, modelProvider),
		editModeSelectorRenderer: new CleanSlateEditModeSelectorRenderer(settingsProvider),
		dialogService: { confirm: async options => {
			const dialog = new Dialog(root, options.message, [options.primaryButton, 'Cancel'], { cancelId: 1, type: options.type, detail: options.detail,
				buttonStyles: {}, checkboxStyles: {}, inputBoxStyles: {}, dialogStyles: { dialogBackground: '#333', dialogForeground: '#fff' } });
			try { return { confirmed: (await dialog.show()).button === 0 }; } finally { dialog.dispose(); }
		} },
		browserAutomationService: qa.automation, commandApprovalService: approval, instantiationService: instantiation,
		notificationService: notifications, storageService: storage, sessionProvider: provider,
		transcriptRenderer: {}, activeWorkspaceBrowserTabId: qa.browser.getActiveBrowserModel().id,
		leftNavVisible: true, leftNav: sidebar, rightPaneStateBySession: new Map(),
		_register: value => disposables.add(value), deactivateRightPaneTerminal() {},
		hideWorkspaceSelector() {}, dismissAgentPicker() {}, composerDraftController: { persistDraft() {} },
		setLeftNavVisible(visible) { this.leftNavVisible = visible; },
		getActiveAgentManagerBrowserSurface: () => 'agentManager:project',
		getSelectedWorkspaceLabel: () => 'Private project',
		sidebarViewModel: { getActiveSessionId: () => provider.activeSession.id, getState: () => ({ model: { label: 'QA Model', provider: 'openai', model: 'qa' }, settings: { reasoningLevel: 'low', editMode: 'ask', contextWindow: 200000 } }) },
	});
	qa.manager = manager;
	manager.bindRightPaneResize(handle);
	disposables.add(qa.browser.onDidChange(() => manager.onWorkspaceBrowserChanged()));
	disposables.add(qa.browser.onDidRequestChat(() => {
		if (manager.rightPaneVisible) { manager.setRightPaneVisible(false); }
		else { manager.selectRightPaneTab('browserChat', true); }
	}));
	qa.restartBrowserProvider = () => {
		manager.rightPaneMarkdownDisposables.clear();
		for (const binding of manager.browserChatBindings.values()) { binding.dispose(); }
		manager.browserChatBindings.clear(); manager.sideChatComposerView = undefined;
		manager.pendingSideChatImages.clear(); manager.externalAgentDescriptors.clear();
		provider.dispose(); provider = makeProvider(); manager.sessionProvider = provider;
		manager.renderActiveRightPaneTab();
	};
	qa.disposeBrowserChat = () => { manager.rightPaneMarkdownDisposables.dispose(); disposables.dispose(); provider.dispose(); approval.dispose(); qa.automation.dispose(); qa.browser.dispose(); };
	return qa;
}
