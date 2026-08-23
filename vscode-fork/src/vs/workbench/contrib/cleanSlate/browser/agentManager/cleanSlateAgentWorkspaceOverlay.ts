/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { Action } from '../../../../../base/common/actions.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { hash } from '../../../../../base/common/hash.js';
import * as json from '../../../../../base/common/json.js';
import { Disposable, DisposableStore, IReference, toDisposable } from '../../../../../base/common/lifecycle.js';
import { basename, extUri, isEqualOrParent } from '../../../../../base/common/resources.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
import { localize } from '../../../../../nls.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IMarkdownRendererService } from '../../../../../platform/markdown/browser/markdownRenderer.js';
import { IMarkerService } from '../../../../../platform/markers/common/markers.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { ISecretStorageService } from '../../../../../platform/secrets/common/secrets.js';
import { DisablementReason, IUpdateService, State as UpdateState, StateType } from '../../../../../platform/update/common/update.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../../platform/workspace/common/workspace.js';
import { CodeEditorWidget } from '../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { EditorExtensionsRegistry } from '../../../../../editor/browser/editorExtensions.js';
import { ITextModelService, IResolvedTextEditorModel } from '../../../../../editor/common/services/resolverService.js';
import { registerCleanSlateEditorChatTarget } from '../editor/cleanSlateSelectionAddToChat.js';
import { IWorkspacesService, isRecentFolder, isRecentWorkspace, isStoredWorkspaceFolder, toWorkspaceFolders } from '../../../../../platform/workspaces/common/workspaces.js';

import { IWorkbenchLayoutService, Parts } from '../../../../services/layout/browser/layoutService.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { ISCMService } from '../../../scm/common/scm.js';
import { ITerminalService, type ITerminalInstance } from '../../../terminal/browser/terminal.js';
import {
	ICleanSlateArtifactService,
	ICleanSlateConfigurationService,
	ICleanSlateContextService,
	ICleanSlateEditCodeService,
	ICleanSlateIndexService,
	ICleanSlateMainService,
	ICleanSlateService,
	formatCleanSlateReasoningLevel,
	type IArtifact,
	type ICleanSlatePersistedSession,
	type ICleanSlateTransportStatus
} from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { ICleanSlateBrowserAutomationService, type CleanSlateBrowserSurface, type ICleanSlateBrowserAnnotation, type ICleanSlateBrowserState } from '../core/cleanSlateBrowserAutomationService.js';
import { ICleanSlateCommandApprovalService } from '../core/cleanSlateCommandApprovalService.js';
import { CleanSlateChatComposerProvider, type ICleanSlateEditorSelectionReference } from '../chat/providers/cleanSlateChatComposerProvider.js';
import {
	isCleanSlateSessionDeletedByGlobalCutoff,
	isCleanSlateSessionDeletedByProjectCutoff,
	loadCleanSlateDeletedBefore,
	loadCleanSlateDeletedProjectCutoffs,
	loadCleanSlateDeletedSessionIds,
	rememberCleanSlateDeletedBefore,
	rememberCleanSlateDeletedProjectCutoff,
	rememberCleanSlateDeletedSessionId
} from '../chat/providers/cleanSlateChatDeletionStore.js';
import { CleanSlateChatHistoryProvider } from '../chat/providers/cleanSlateChatHistoryProvider.js';
import { CleanSlateChatModelProvider } from '../chat/providers/cleanSlateChatModelProvider.js';
import { CleanSlateChatSessionProvider, type ICleanSlateSessionWorkspaceMetadata } from '../chat/providers/cleanSlateChatSessionProvider.js';
import { CleanSlateChatSettingsProvider } from '../chat/providers/cleanSlateChatSettingsProvider.js';
import { CleanSlateTranscriptRenderer } from '../chat/renderers/cleanSlateTranscriptRenderer.js';
import { CleanSlatePendingEditsRenderer } from '../chat/renderers/cleanSlatePendingEditsRenderer.js';
import { collectGitReviewChanges, collectSCMReviewChanges, mergeCleanSlateReviewChanges, type CleanSlateReviewDisplayScopeMode, type ICleanSlateReviewChange } from '../chat/renderers/cleanSlateReviewModel.js';
import { CleanSlateModelSelectorRenderer } from '../chat/renderers/cleanSlateModelSelectorRenderer.js';
import { CleanSlateReasoningSelectorRenderer } from '../chat/renderers/cleanSlateModeSelectorRenderer.js';
import { CleanSlateEditModeSelectorRenderer } from '../chat/renderers/cleanSlateEditModeSelectorRenderer.js';
import { normalizeChatResponse } from '../chat/runtime/cleanSlateChatResponseNormalizer.js';
import { toPersistableCleanSlateTranscriptPayload } from '../chat/runtime/cleanSlateTranscriptPersistence.js';
import { ensureCleanSlateChatStyles } from '../chat/styles/cleanSlateChatStyles.js';
import type { ChatResponse, CleanSlateUserSelectionDisplay, IResponseRenderer } from '../chat/types/cleanSlateChatTypes.js';
import { deriveCleanSlateTranscriptFromHistory, stringifyCleanSlatePlanningAnswerPayload, type ICleanSlateSessionSnapshot, type ICleanSlateTranscriptMessage } from '../chat/types/cleanSlateChatSessionTypes.js';
import { CleanSlateChatSidebarViewModel } from '../chat/viewModel/cleanSlateChatSidebarViewModel.js';
import { CleanSlateAnnotationController } from '../chat/viewModel/cleanSlateAnnotationController.js';
import { CleanSlateMessageSubmitController } from '../chat/viewModel/cleanSlateMessageSubmitController.js';
import { CleanSlatePlanApprovalController } from '../chat/viewModel/cleanSlatePlanApprovalController.js';
import { CleanSlateCommandApprovalView } from '../chat/view/sections/cleanSlateCommandApprovalView.js';
import { CleanSlateComposerView } from '../chat/view/sections/cleanSlateComposerView.js';
import { CleanSlatePendingEditsBarView } from '../chat/view/sections/cleanSlatePendingEditsBarView.js';
import { CleanSlatePlanApprovalView } from '../chat/view/sections/cleanSlatePlanApprovalView.js';
import { CleanSlatePlanningQuestionView, type ICleanSlatePlanningQuestionSubmission } from '../chat/view/sections/cleanSlatePlanningQuestionView.js';
import { CleanSlatePlanPanelView } from '../chat/view/sections/cleanSlatePlanPanelView.js';
import { CleanSlateTranscriptView } from '../chat/view/sections/cleanSlateTranscriptView.js';
import './cleanSlateAgentManagerStyles.js';
import { CleanSlateAgentManagerComposerDraftController } from './cleanSlateAgentManagerComposerDraftController.js';
import { CleanSlateAgentManagerProjectProvider } from './cleanSlateAgentManagerProjectProvider.js';
import { CleanSlateAgentManagerRightPaneView } from './cleanSlateAgentManagerRightPaneView.js';
import { CleanSlateAgentManagerSessionMapper } from './cleanSlateAgentManagerSessionMapper.js';
import { CleanSlateAgentManagerShellView } from './cleanSlateAgentManagerShellView.js';
import { CleanSlateAgentManagerSidebarView } from './cleanSlateAgentManagerSidebarView.js';
import { CleanSlateAgentManagerStartupLoadingView } from './cleanSlateAgentManagerStartupLoadingView.js';
import { CleanSlateAgentManagerWorkspacePickerView } from './cleanSlateAgentManagerWorkspacePickerView.js';
import { CleanSlateAgentManagerSessionRepository } from './cleanSlateAgentManagerSessionRepository.js';
import { CleanSlateSettingsPanel } from '../settings/cleanSlateSettingsPanel.js';
import { CLEANSLATE_AUTH_ACCOUNT_STORAGE_KEY, clearCleanSlateAuthAccount, openCleanSlateAccount, openCleanSlateProCheckout, openCleanSlateSignIn, readCleanSlateAuthAccount } from '../auth/cleanSlateAuth.contribution.js';
import type { CleanSlateAgentManagerRightTab, ICleanSlateProjectThreadGroup, ICleanSlateWorkspaceEntry } from './cleanSlateAgentManagerTypes.js';

interface ICleanSlateAgentWorkspaceMountOptions {
	readonly targetWindow?: Window;
	readonly titlebarToggleHost?: HTMLElement;
	readonly titlebarHeaderHost?: HTMLElement;
	readonly integratedTitlebar?: boolean;
	readonly onExit?: () => void;
	readonly workbenchMode?: boolean;
}

interface ICleanSlateAgentManagerRightPaneSessionState {
	readonly visible: boolean;
	readonly activeTab: CleanSlateAgentManagerRightTab | undefined;
	readonly openTabs?: readonly CleanSlateAgentManagerRightTab[];
	readonly latestBrowserState: ICleanSlateBrowserState | undefined;
	readonly artifacts: ReadonlyMap<CleanSlateAgentManagerArtifactKind, IArtifact>;
}

type CleanSlateAgentManagerArtifactKind = 'plan' | 'notes';

// One-shot marker: set when the IDE button opens a different project, consumed
// by the startup contribution so that launch lands in the editor instead of the
// Agent-Manager-by-default surface. Application scope — it must survive the
// workspace switch.
export const CLEANSLATE_AGENT_MANAGER_IDE_HANDOFF_KEY = 'cleanSlate.agentManager.ideHandoffTarget';

const CLEANSLATE_AGENT_MANAGER_NAV_WIDTH_STORAGE_KEY = 'cleanSlate.agentManager.navWidth';
const CLEANSLATE_AGENT_MANAGER_NAV_WIDTH_DEFAULT = 320;
const CLEANSLATE_AGENT_MANAGER_NAV_WIDTH_MIN = 240;
const CLEANSLATE_AGENT_MANAGER_NAV_WIDTH_MAX = 360;
const CLEANSLATE_AGENT_MANAGER_MAIN_WIDTH_MIN = 560;
const CLEANSLATE_AGENT_MANAGER_RIGHT_WIDTH_STORAGE_KEY = 'cleanSlate.agentManager.rightWidth.v2';
const CLEANSLATE_AGENT_MANAGER_RIGHT_WIDTH_DEFAULT = 440;
const CLEANSLATE_AGENT_MANAGER_RIGHT_WIDTH_MIN = 440;
const CLEANSLATE_AGENT_MANAGER_RIGHT_WIDTH_MAX = 840;

export class CleanSlateAgentWorkspaceOverlay extends Disposable implements IResponseRenderer {

	private static readonly agentManagerHiddenParts: readonly Parts[] = [
		Parts.BANNER_PART,
		Parts.ACTIVITYBAR_PART,
		Parts.SIDEBAR_PART,
		Parts.PANEL_PART,
		Parts.AUXILIARYBAR_PART,
		Parts.STATUSBAR_PART
	];

	private root: HTMLElement | undefined;
	private surfaceHost: HTMLElement | undefined;
	private savedWorkbenchVisibility: Map<Parts, boolean> | undefined;
	private readonly shellDisposables = this._register(new DisposableStore());
	private targetWindow: Window = mainWindow;
	private titlebarToggleHost: HTMLElement | undefined;
	private titlebarHeaderHost: HTMLElement | undefined;
	private integratedTitlebar = false;
	private onExit: (() => void) | undefined;
	private workbenchMode = false;
	private leftNav!: HTMLElement;
	private leftNavToggleButton: HTMLButtonElement | undefined;
	private workspaceList!: HTMLElement;
	private projectSidebarView: CleanSlateAgentManagerSidebarView | undefined;
	private searchInput!: HTMLInputElement;
	private titleElement!: HTMLElement;
	private chatSurface!: HTMLElement;
	private progressList!: HTMLElement;
	private startupLoadingOverlay: HTMLElement | undefined;
	private rightPaneToggleButton: HTMLButtonElement | undefined;
	private rightResizeHandle: HTMLElement | undefined;
	private rightPane: HTMLElement | undefined;
	private rightPaneTitle: HTMLElement | undefined;
	private rightPaneBody: HTMLElement | undefined;
	private browserPaneViewport: HTMLElement | undefined;
	private terminalPaneContainer: HTMLElement | undefined;
	private activeRightPaneTerminal: ITerminalInstance | undefined;
	private terminalPaneRenderRequest = 0;
	private readonly rightPaneTerminalsBySession = new Map<string, ITerminalInstance>();
	private readonly rightPaneTerminalPromisesBySession = new Map<string, Promise<ITerminalInstance>>();
	private readonly invalidatedRightPaneTerminalSessionKeys = new Set<string>();
	private readonly rightPaneMarkdownDisposables = this._register(new DisposableStore());
	private fileEditor: CodeEditorWidget | undefined;
	private fileModelRef: IReference<IResolvedTextEditorModel> | undefined;
	private fileEditorPlaceholder: HTMLElement | undefined;
	private fileLayoutEl: HTMLElement | undefined;
	private fileTreeEl: HTMLElement | undefined;
	private fileTreeRootsKey: string | undefined;
	private fileTreeToken = 0;
	private fileTreeWidth = 260;
	private rightPaneTabsEl: HTMLElement | undefined;
	private rightPaneOpenTabs: CleanSlateAgentManagerRightTab[] = [];
	private reviewScopeMode: CleanSlateReviewDisplayScopeMode = 'working';
	private readonly rightPaneArtifacts = new Map<CleanSlateAgentManagerArtifactKind, IArtifact>();
	private workspaceEntries: readonly ICleanSlateWorkspaceEntry[] = [];
	private selectedWorkspaceEntry: ICleanSlateWorkspaceEntry | undefined;
	private projectTreeRenderRequest = 0;
	private workspaceSelectionRequest = 0;
	private readonly sessionCache = new Map<string, ICleanSlateSessionSnapshot>();
	private readonly activeSessionByWorkspaceKey = new Map<string, string>();
	private readonly deletedSessionIds = new Set<string>();
	private readonly deletedProjectCutoffs: Map<string, number>;
	private deletedBefore = 0;
	private initialWorkspaceSessionHydrated = false;
	private suppressProjectTreeRender = false;
	private globalThreadSessionsUnavailable = false;
	private leftNavVisible = true;
	private rightPaneVisible = false;
	private rightPaneActiveTab: CleanSlateAgentManagerRightTab | undefined;
	private latestBrowserState: ICleanSlateBrowserState | undefined;
	private rightPaneStateSessionId: string | undefined;
	private readonly rightPaneStateBySession = new Map<string, ICleanSlateAgentManagerRightPaneSessionState>();
	private browserPaneActive = false;
	private browserPaneLayoutFrame: number | undefined;
	private browserPaneLayoutSettleTimeout: number | undefined;
	private ideBrowserHiddenForAgentManager = false;
	private ideBrowserAdoptionRequest = 0;
	private reviewRenderRequest = 0;
	private reviewRenderedSignature: number | undefined;
	private startupLoadingTimer: number | undefined;
	private startupLoadingVisible = false;
	private startupHydrationRequest = 0;
	private settingsOverlay: HTMLElement | undefined;
	private settingsPanelVisible = false;
	private settingsPanel: CleanSlateSettingsPanel | undefined;
	private cachedWorkspaceEntries: readonly ICleanSlateWorkspaceEntry[] | undefined;
	private cachedWorkspaceSessions: readonly ICleanSlateSessionSnapshot[] | undefined;

	private readonly historyProvider: CleanSlateChatHistoryProvider;
	private readonly sessionProvider: CleanSlateChatSessionProvider;
	private readonly composerProvider: CleanSlateChatComposerProvider;
	private readonly settingsProvider: CleanSlateChatSettingsProvider;
	private readonly modelProvider: CleanSlateChatModelProvider;
	private readonly sidebarViewModel: CleanSlateChatSidebarViewModel;
	private readonly transcriptRenderer: CleanSlateTranscriptRenderer;
	private readonly composerDraftController: CleanSlateAgentManagerComposerDraftController;
	private readonly pendingEditsRenderer: CleanSlatePendingEditsRenderer;
	private readonly modelSelectorRenderer: CleanSlateModelSelectorRenderer;
	private readonly reasoningSelectorRenderer: CleanSlateReasoningSelectorRenderer;
	private readonly editModeSelectorRenderer: CleanSlateEditModeSelectorRenderer;
	private readonly planApprovalController: CleanSlatePlanApprovalController;
	private readonly annotationController: CleanSlateAnnotationController;
	private readonly messageSubmitController: CleanSlateMessageSubmitController;
	private readonly projectProvider = new CleanSlateAgentManagerProjectProvider();
	private readonly rightPaneView: CleanSlateAgentManagerRightPaneView;
	private readonly sessionMapper = new CleanSlateAgentManagerSessionMapper();
	private readonly sessionRepository: CleanSlateAgentManagerSessionRepository;
	private readonly shellView = new CleanSlateAgentManagerShellView();
	private readonly startupLoadingView = new CleanSlateAgentManagerStartupLoadingView();
	private readonly workspacePickerView = this._register(new CleanSlateAgentManagerWorkspacePickerView());

	private transcriptView!: CleanSlateTranscriptView;
	private composerView!: CleanSlateComposerView;
	private planPanelView!: CleanSlatePlanPanelView;
	private planningQuestionView!: CleanSlatePlanningQuestionView;
	private planApprovalView!: CleanSlatePlanApprovalView;
	private commandApprovalView!: CleanSlateCommandApprovalView;
	private pendingEditsBarView!: CleanSlatePendingEditsBarView;

	constructor(
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IClipboardService private readonly clipboardService: IClipboardService,
		@ICodeEditorService private readonly codeEditorService: ICodeEditorService,
		@ICleanSlateService private readonly cleanSlateService: ICleanSlateService,
		@ICleanSlateContextService private readonly cleanSlateContextService: ICleanSlateContextService,
		@ICleanSlateEditCodeService editCodeService: ICleanSlateEditCodeService,
		@ICleanSlateConfigurationService private readonly cleanSlateConfigService: ICleanSlateConfigurationService,
		@ICleanSlateIndexService private readonly indexService: ICleanSlateIndexService,
		@ICleanSlateArtifactService private readonly artifactService: ICleanSlateArtifactService,
		@ICleanSlateBrowserAutomationService private readonly browserAutomationService: ICleanSlateBrowserAutomationService,
		@ICleanSlateMainService private readonly cleanSlateMainService: ICleanSlateMainService,
		@ICleanSlateCommandApprovalService commandApprovalService: ICleanSlateCommandApprovalService,
		@IMarkdownRendererService private readonly markdownRenderer: IMarkdownRendererService,
		@IMarkerService markerService: IMarkerService,
		@INotificationService private readonly notificationService: INotificationService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IFileService private readonly fileService: IFileService,
		@ISCMService private readonly scmService: ISCMService,
		@IStorageService private readonly storageService: IStorageService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IWorkspacesService private readonly workspacesService: IWorkspacesService,
		@ITerminalService private readonly terminalService: ITerminalService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IHostService private readonly hostService: IHostService,
		@IUpdateService private readonly updateService: IUpdateService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ITextModelService private readonly textModelService: ITextModelService,
	) {
		super();
		this.sessionRepository = new CleanSlateAgentManagerSessionRepository(cleanSlateMainService, this.sessionMapper, this.projectProvider);

		for (const sessionId of loadCleanSlateDeletedSessionIds(this.storageService)) {
			this.deletedSessionIds.add(sessionId);
		}
		this.deletedProjectCutoffs = loadCleanSlateDeletedProjectCutoffs(this.storageService);
		this.deletedBefore = loadCleanSlateDeletedBefore(this.storageService);
		this.historyProvider = new CleanSlateChatHistoryProvider(this.storageService, workspaceContextService, cleanSlateMainService);
		this.sessionProvider = new CleanSlateChatSessionProvider(
			this.instantiationService,
			this.codeEditorService,
			editCodeService,
			this.notificationService,
			this.storageService,
			this.workspaceContextService,
			this.cleanSlateContextService,
			cleanSlateMainService,
			commandApprovalService,
			session => this.historyProvider.upsertArchivedSession(session),
			'agentManager'
		);
		this._register(this.sessionProvider);
		this.composerProvider = new CleanSlateChatComposerProvider();
		this.settingsProvider = new CleanSlateChatSettingsProvider(cleanSlateConfigService);
		this.modelProvider = new CleanSlateChatModelProvider(cleanSlateService, cleanSlateConfigService, cleanSlateMainService);
		this._register(this.settingsProvider);
		this._register(this.modelProvider);
		this.sidebarViewModel = new CleanSlateChatSidebarViewModel(
			this.sessionProvider,
			this.historyProvider,
			this.composerProvider,
			this.settingsProvider,
			this.modelProvider
		);
		this.composerDraftController = new CleanSlateAgentManagerComposerDraftController(this.sidebarViewModel, () => this.composerView);
		this.transcriptRenderer = this.instantiationService.createInstance(CleanSlateTranscriptRenderer);
		// File references clicked inside the agent manager open in its own embedded
		// editor, not the IDE. (In the IDE chat view this override is unset, so those
		// clicks fall through to the normal editor.)
		this.transcriptRenderer.openFileOverride = (resource, options) => {
			this.openFileFromAgent(resource, options?.selection);
			return true;
		};
		this.rightPaneView = new CleanSlateAgentManagerRightPaneView(this.markdownRenderer, text => this.clipboardService.writeText(text));
		this.pendingEditsRenderer = new CleanSlatePendingEditsRenderer(markerService);
		this.modelSelectorRenderer = new CleanSlateModelSelectorRenderer(this.modelProvider, () => {
			this.openSettingsFromAgentManager();
		}, () => {
			void openCleanSlateProCheckout(this.openerService, this.notificationService, this.cleanSlateMainService);
		});
		this.reasoningSelectorRenderer = new CleanSlateReasoningSelectorRenderer(this.settingsProvider, this.modelProvider);
		this.editModeSelectorRenderer = new CleanSlateEditModeSelectorRenderer(this.settingsProvider);
		this.planApprovalController = new CleanSlatePlanApprovalController(this.sidebarViewModel, this.artifactService);
		this.annotationController = new CleanSlateAnnotationController(
			this.browserAutomationService,
			this.notificationService,
			() => this.composerView,
			() => this.updatePlaceholder(),
			() => this.getActiveAgentManagerBrowserSurface()
		);
		this.messageSubmitController = new CleanSlateMessageSubmitController(
			this.sidebarViewModel,
			this.browserAutomationService,
			{
				getComposerView: () => this.composerView,
				getRenderer: () => this,
				onBeforeSend: () => {
					this.planningQuestionView.clear();
					this.updateAnnotationReferences([]);
				},
				onUpdateTitle: () => this.refreshChrome(),
				onAnnotationsChanged: () => {
					this.updateAnnotationReferences(this.browserAutomationService.listCachedAnnotations(this.getActiveAgentManagerBrowserSurface()));
				},
				getImplicitSelectionReference: () => this.getCurrentEditorSelectionReference()
			},
			() => this.getActiveAgentManagerBrowserSurface()
		);

		this.transcriptRenderer.onDidUpdateToDo = _steps => {
			this.planPanelView?.clear();
			this.hideProgress();
		};

		this._register(this.sessionProvider.onDidChangeState(() => {
			this.syncRightPaneStateWithActiveSession();
			if (this.sidebarViewModel.consumeExternalActiveSessionRefresh()) {
				this.restoreCurrentSessionView();
			}
			this.syncComposerWithCurrentSession();
			this.updatePlaceholder();
			this.updateApproveButtonVisibility();
			this.updateCommandApprovalVisibility();
			this.invalidateWorkspaceDataCache();
			this.refreshChrome();
			this.updateProjectTreeActiveState();
		}));
		this._register(this.historyProvider.onDidChangeState(() => {
			this.invalidateWorkspaceDataCache();
			this.renderSessions();
		}));
		this._register(cleanSlateMainService.onDidPublishThreadSession(update => {
			this.rememberPublishedSession(update.session);
			if (update.originId !== 'agentManager:handoff' || update.makeActive !== true || !this.isVisible()) {
				return;
			}
			const snapshot = this.sessionMapper.toSessionSnapshot(update.session);
			const sessionUri = snapshot ? this.projectProvider.getSessionWorkspaceUri(snapshot) : undefined;
			if (!sessionUri) {
				return;
			}
			const target = sessionUri.path.toLowerCase().endsWith('.code-workspace')
				? { workspaceUri: sessionUri }
				: { folderUri: sessionUri };
			if (this.isOpenTargetCurrentWorkspace(target)) {
				this.closeAgentManagerSurface();
			}
		}));
		this._register(this.sessionProvider.onDidPendingEditsChange(() => this.updatePendingEdits()));
		this._register(this.scmService.onDidAddRepository(repository => {
			this._register(repository.provider.onDidChangeResources(() => this.updatePendingEdits()));
			this.updatePendingEdits();
		}));
		this._register(this.scmService.onDidRemoveRepository(() => this.updatePendingEdits()));
		for (const repository of this.scmService.repositories) {
			this._register(repository.provider.onDidChangeResources(() => this.updatePendingEdits()));
		}
		this._register(this.composerProvider.onDidChangeState(() => {
			this.renderImagePreviews();
			this.renderSelectionReferences();
			this.composerDraftController.updateContextWindowUsage();
		}));
		this._register(this.modelProvider.onDidChangeState(() => {
			this.updateModelDropdownState();
			this.updateReasoningDropdownState();
		}));
		this._register(this.settingsProvider.onDidChangeState(() => {
			this.sidebarViewModel.syncExecutionStateFromSettings();
			this.updateReasoningDropdownState();
			this.updatePlanModeState();
			this.updateEditModeState();
			this.composerDraftController.updateContextWindowUsage();
		}));
		this._register(this.browserAutomationService.onDidChangeAnnotations(event => {
			if (this.isActiveAgentManagerBrowserSurface(event.surface)) {
				this.updateAnnotationReferences(event.annotations);
			}
		}));
		this._register(this.browserAutomationService.onDidOpenBrowser(state => {
			if (this.isActiveAgentManagerBrowserSurface(state.surface)) {
				this.openBrowserInRightPane(state);
				return;
			}
			this.cacheBrowserStateForSurface(state);
		}));
		this._register(this.artifactService.onDidArtifactChange((artifact: IArtifact) => {
			if (!this.isArtifactForActiveSession(artifact)) {
				this.cacheRightPaneArtifactForSession(artifact);
				return;
			}
			if (artifact.type === 'implementation_plan') {
				this.planApprovalView?.resetDismissed();
				this.updateApproveButtonVisibility();
			}
			if (this.isPlanningPaneArtifact(artifact)) {
				this.openArtifactInRightPane(artifact);
			}
			if (artifact.id === 'task' && !this.sidebarViewModel.getState().isRestoringSession) {
				this.refreshLastAssistantMessageFromHistory();
			}
		}));
		this._register(this.indexService.onDidStatusChange(() => this.updateIndexingState()));
	}

	show(): void {
		// Agent Manager is global, but entering it from the IDE should always begin
		// in the invoking window's workspace rather than retain another window's
		// previously selected project.
		this.workspaceSelectionRequest++;
		this.selectedWorkspaceEntry = this.getCurrentWorkspaceEntry();
		this.mount(this.enterAgentManagerMode(), {
			targetWindow: mainWindow,
			workbenchMode: true,
			integratedTitlebar: true
		});
	}

	mount(parent: HTMLElement, options: ICleanSlateAgentWorkspaceMountOptions = {}): void {
		this.targetWindow = options.targetWindow ?? mainWindow;
		this.titlebarToggleHost = options.titlebarToggleHost;
		this.titlebarHeaderHost = options.titlebarHeaderHost;
		this.integratedTitlebar = options.integratedTitlebar ?? false;
		this.onExit = options.onExit;
		this.workbenchMode = options.workbenchMode ?? false;
		if (!this.root) {
			this.root = dom.append(parent, dom.$('.cleanSlate-agent-manager-surface'));
		} else if (this.root.parentElement !== parent) {
			parent.appendChild(this.root);
		}

		this.composerDraftController.persistDraft();
		this.annotationController.dispose(this.root);
		this.shellDisposables.clear();
		this.rightPaneMarkdownDisposables.clear();
		this.deactivateRightPaneTerminal();
		this.transcriptRenderer.disposeMarkdownRenders();
		this.browserPaneActive = false;
		this.hideStartupLoadingState();
		this.initialWorkspaceSessionHydrated = false;
		this.ideBrowserHiddenForAgentManager = false;
		this.settingsPanelVisible = false;
		this.settingsPanel = undefined;
		this.settingsOverlay = undefined;
		this.root.classList.remove('settings-panel-open');
		void this.browserAutomationService.setOpenBrowserVisible(false, this.getActiveAgentManagerBrowserSurface());
		dom.clearNode(this.root);
		if (this.titlebarHeaderHost) {
			dom.clearNode(this.titlebarHeaderHost);
		}
		ensureCleanSlateChatStyles(this.root);
		this.buildShell(this.root);
		// Cover the freshly rebuilt shell before it is revealed. The active session
		// can still belong to the previously viewed project until hydration finishes.
		this.showStartupLoadingState();
		this.root.classList.remove('hidden');
		this.adoptVisibleIdeBrowserForActiveSessionIfNeeded();
		void this.sidebarViewModel.whenReady().then(() => {
			this.scheduleStartupHydration();
		});
		this.scheduleStartupPaint();
	}

	layout(): void {
		this.syncTitlebarHeaderOffset();
		this.layoutRightPane();
		this.scheduleBrowserPaneLayout();
		this.layoutTerminalPane();
	}

	focus(): void {
		this.composerView?.focus();
	}

	isVisible(): boolean {
		return !!this.root;
	}

	acceptAllChanges(): void {
		this.sidebarViewModel.acceptAll();
		this.updatePendingEdits();
	}

	rejectAllChanges(): void {
		this.sidebarViewModel.rejectAll();
		this.updatePendingEdits();
	}

	hide(): void {
		this.saveRightPaneStateForActiveSession();
		this.composerDraftController.persistDraft();
		this.annotationController.dispose(this.root);
		this.shellDisposables.clear();
		this.rightPaneMarkdownDisposables.clear();
		this.transcriptRenderer.disposeMarkdownRenders();
		this.hideStartupLoadingState();
		this.startupHydrationRequest++;
		this.cancelBrowserPaneLayout();
		this.deactivateRightPaneTerminal();
		this.browserPaneActive = false;
		this.settingsPanelVisible = false;
		this.settingsPanel = undefined;
		this.settingsOverlay = undefined;
		void this.browserAutomationService.setOpenBrowserVisible(false, this.getActiveAgentManagerBrowserSurface());
		this.restoreIdeBrowserAfterAgentManagerClose();
		this.root?.remove();
		this.root = undefined;
		if (this.titlebarHeaderHost) {
			dom.clearNode(this.titlebarHeaderHost);
		}
		if (this.workbenchMode) {
			this.exitAgentManagerMode();
		}
		this.workbenchMode = false;
	}

	override dispose(): void {
		this.saveRightPaneStateForActiveSession();
		this.annotationController.dispose(this.root);
		this.shellDisposables.clear();
		this.rightPaneMarkdownDisposables.clear();
		this.transcriptRenderer.disposeMarkdownRenders();
		this.hideStartupLoadingState();
		this.startupHydrationRequest++;
		this.cancelBrowserPaneLayout();
		this.deactivateRightPaneTerminal();
		for (const terminal of this.rightPaneTerminalsBySession.values()) {
			terminal.dispose();
		}
		this.rightPaneTerminalsBySession.clear();
		this.rightPaneTerminalPromisesBySession.clear();
		this.settingsPanelVisible = false;
		this.settingsPanel = undefined;
		this.settingsOverlay = undefined;
		void this.browserAutomationService.setOpenBrowserVisible(false, this.getActiveAgentManagerBrowserSurface());
		this.restoreIdeBrowserAfterAgentManagerClose();
		this.root?.remove();
		this.root = undefined;
		if (this.titlebarHeaderHost) {
			dom.clearNode(this.titlebarHeaderHost);
		}
		if (this.workbenchMode) {
			this.exitAgentManagerMode();
		}
		this.workbenchMode = false;
		super.dispose();
	}

	private enterAgentManagerMode(): HTMLElement {
		const agentManagerHost = this.layoutService.getContainer(mainWindow);
		if (!this.savedWorkbenchVisibility) {
			this.savedWorkbenchVisibility = new Map();
			for (const part of CleanSlateAgentWorkspaceOverlay.agentManagerHiddenParts) {
				this.savedWorkbenchVisibility.set(part, this.layoutService.isVisible(part, mainWindow));
			}
		}
		for (const part of CleanSlateAgentWorkspaceOverlay.agentManagerHiddenParts) {
			this.layoutService.setPartHidden(true, part);
		}
		this.surfaceHost?.classList.remove('cleanSlate-agent-manager-host-active');
		this.surfaceHost = agentManagerHost;
		this.surfaceHost.classList.add('cleanSlate-agent-manager-host-active');
		this.layoutService.focusPart(Parts.EDITOR_PART, mainWindow);
		return agentManagerHost;
	}

	private exitAgentManagerMode(): void {
		this.surfaceHost?.classList.remove('cleanSlate-agent-manager-host-active');
		this.surfaceHost = undefined;
		const savedVisibility = this.savedWorkbenchVisibility;
		this.savedWorkbenchVisibility = undefined;
		if (savedVisibility) {
			for (const [part, visible] of savedVisibility) {
				this.layoutService.setPartHidden(!visible, part);
			}
		}
		this.layoutService.focusPart(Parts.EDITOR_PART, mainWindow);
	}

	private buildShell(root: HTMLElement): void {
		this.shellDisposables.clear();
		root.tabIndex = -1;
		root.classList.toggle('integrated-titlebar', this.integratedTitlebar);
		this.applyStoredNavWidth();
		this.leftNavVisible = true;
		const shell = this.shellView.build(root, {
			integratedTitlebar: this.integratedTitlebar,
			titlebarToggleHost: this.titlebarToggleHost,
			titlebarHeaderHost: this.titlebarHeaderHost,
			disposables: this.shellDisposables,
			isLeftNavVisible: () => this.leftNavVisible,
			onToggleLeftNav: () => this.setLeftNavVisible(!this.leftNavVisible),
			onNewChat: () => this.startNewChat(),
			onSearchInput: () => void this.renderProjectTree(),
			onOpenSettings: () => this.openSettingsFromAgentManager(),
			onSignIn: () => openCleanSlateSignIn(this.openerService, this.notificationService),
			onSignOut: () => clearCleanSlateAuthAccount(this.secretStorageService, this.storageService),
			onExitToEditor: () => void this.exitToEditor(),
			onToggleRightPane: () => this.setRightPaneVisible(!this.rightPaneVisible)
		});
		const updateAccount = () => {
			this.shellView.updateAccount(shell, readCleanSlateAuthAccount(this.storageService));
			if (this.settingsPanelVisible) {
				void this.settingsPanel?.render({ preserveScroll: true });
			}
		};
		updateAccount();
		this.shellDisposables.add(this.storageService.onDidChangeValue(StorageScope.APPLICATION, CLEANSLATE_AUTH_ACCOUNT_STORAGE_KEY, this.shellDisposables)(updateAccount));
		this.leftNav = shell.leftNav;
		this.leftNavToggleButton = shell.leftNavToggleButton;
		this.searchInput = shell.searchInput;
		this.workspaceList = shell.workspaceList;
		this.projectSidebarView = new CleanSlateAgentManagerSidebarView(this.workspaceList);
		this.titleElement = shell.titleElement;
		this.bindUpdateButton(shell.updateButton);
		this.bindUpdateMenuItem(shell.updateMenuItem, shell.updateBadge);
		this.rightPaneToggleButton = shell.rightPaneToggleButton;
		this.bindNavResize(shell.navResizeHandle);
		this.buildMain(shell.main);
		this.rightResizeHandle = shell.rightResizeHandle;
		this.bindRightPaneResize(this.rightResizeHandle);
		this.rightPane = shell.rightPane;
		this.buildRightPane(this.rightPane);
		this.startupLoadingOverlay = shell.startupLoadingOverlay;
		this.settingsOverlay = shell.settingsOverlay;
		this.applyStoredRightPaneWidth();
		this.updateLeftNavChrome();
		this.restoreRightPaneStateForActiveSession();
		this.shellDisposables.add(dom.addDisposableListener(this.targetWindow, 'resize', () => this.layout()));
	}

	private bindUpdateButton(button: HTMLButtonElement): void {
		const render = (state: UpdateState = this.updateService.state) => {
			let label: string | undefined;
			let icon = Codicon.arrowCircleUp;
			let enabled = true;

			switch (state.type) {
				case StateType.AvailableForDownload:
					label = localize('cleanSlate.agentManager.updateAvailable', 'Update available');
					break;
				case StateType.Downloading:
				case StateType.Overwriting:
					label = localize('cleanSlate.agentManager.updateDownloading', 'Downloading update');
					icon = Codicon.sync;
					enabled = false;
					break;
				case StateType.Downloaded:
					label = localize('cleanSlate.agentManager.updateInstall', 'Install update');
					break;
				case StateType.Updating:
					label = localize('cleanSlate.agentManager.updateInstalling', 'Installing update');
					icon = Codicon.sync;
					enabled = false;
					break;
				case StateType.Ready:
					label = localize('cleanSlate.agentManager.updateRestart', 'Restart to update');
					break;
			}

			button.classList.toggle('hidden', !label);
			button.disabled = !enabled;
			dom.clearNode(button);
			if (!label) {
				button.onclick = null;
				return;
			}
			const iconElement = dom.append(button, dom.$(`span${ThemeIcon.asCSSSelector(icon)}`));
			if (icon === Codicon.sync) {
				iconElement.classList.add('codicon-modifier-spin');
			}
			dom.append(button, dom.$('span')).textContent = label;
			button.title = state.type === StateType.AvailableForDownload || state.type === StateType.Downloaded || state.type === StateType.Ready
				? `${label}${state.update.productVersion ? ` ${state.update.productVersion}` : ''}`
				: label;
			button.setAttribute('aria-label', button.title);
			button.onclick = enabled ? () => void this.runUpdateAction(state) : null;
		};

		render();
		this.shellDisposables.add(this.updateService.onStateChange(render));
	}

	/**
	 * The header pill only appears once an update is actually pending, so Agent Manager
	 * had no way to *start* a check — on macOS Squirrel auto-downloads and there is no
	 * AvailableForDownload step, leaving the hourly timer or the IDE window as the only
	 * triggers. This account-menu row is that trigger, and reports progress in place.
	 */
	private bindUpdateMenuItem(item: HTMLButtonElement, badge: HTMLElement): void {
		let checkOutcome: { readonly message: string; readonly failed: boolean } | undefined;
		let outcomeTimer: number | undefined;
		let awaitingExplicitCheck = false;

		const reportOutcome = (message: string, failed: boolean) => {
			checkOutcome = { message, failed };
			if (outcomeTimer !== undefined) {
				this.targetWindow.clearTimeout(outcomeTimer);
			}
			outcomeTimer = this.targetWindow.setTimeout(() => {
				checkOutcome = undefined;
				outcomeTimer = undefined;
				render();
			}, 4000);
			render();
		};
		this.shellDisposables.add(toDisposable(() => {
			if (outcomeTimer !== undefined) {
				this.targetWindow.clearTimeout(outcomeTimer);
			}
		}));

		const render = (state: UpdateState = this.updateService.state) => {
			let label: string;
			let icon = Codicon.arrowCircleUp;
			let spinning = false;
			let enabled = true;
			let detail: string | undefined;

			switch (state.type) {
				case StateType.CheckingForUpdates:
					label = localize('cleanSlate.agentManager.updateChecking', 'Checking for updates...');
					icon = Codicon.sync;
					spinning = true;
					enabled = false;
					break;
				case StateType.AvailableForDownload:
					label = localize('cleanSlate.agentManager.updateDownload', 'Download update');
					detail = state.update.productVersion;
					break;
				case StateType.Downloading:
				case StateType.Overwriting:
					label = localize('cleanSlate.agentManager.updateDownloading', 'Downloading update');
					icon = Codicon.sync;
					spinning = true;
					enabled = false;
					break;
				case StateType.Downloaded:
					label = localize('cleanSlate.agentManager.updateInstall', 'Install update');
					detail = state.update.productVersion;
					break;
				case StateType.Updating:
					label = localize('cleanSlate.agentManager.updateInstalling', 'Installing update');
					icon = Codicon.sync;
					spinning = true;
					enabled = false;
					break;
				case StateType.Ready:
					label = localize('cleanSlate.agentManager.updateRestart', 'Restart to update');
					detail = state.update.productVersion;
					break;
				case StateType.Disabled:
					// Reads the same as Idle, and a click no-ops exactly like the workbench
					// command does in a build where the update service is switched off. Why
					// it is off stays in the tooltip rather than shouting from the row.
					label = localize('cleanSlate.agentManager.updateCheck', 'Check for updates');
					icon = Codicon.refresh;
					detail = this.describeUpdateDisablement(state.reason);
					break;
				case StateType.Uninitialized:
					label = localize('cleanSlate.agentManager.updateCheck', 'Check for updates');
					icon = Codicon.refresh;
					enabled = false;
					break;
				default:
					label = localize('cleanSlate.agentManager.updateCheck', 'Check for updates');
					icon = Codicon.refresh;
					detail = state.type === StateType.Idle ? state.error : undefined;
					break;
			}

			// The workbench announces "no updates available" with a modal dialog, which the
			// Agent Manager overlay sits on top of. Report the outcome in the row instead.
			if (checkOutcome) {
				label = checkOutcome.message;
				icon = checkOutcome.failed ? Codicon.warning : Codicon.check;
				spinning = false;
				enabled = false;
				detail = undefined;
			}

			// The dot means "there is an action waiting for you in here", so it tracks
			// actionable states only — not a check in flight, and not a download that
			// will finish on its own.
			const pending = state.type === StateType.AvailableForDownload
				|| state.type === StateType.Downloaded
				|| state.type === StateType.Ready;
			badge.classList.toggle('hidden', !pending);

			item.disabled = !enabled;
			dom.clearNode(item);
			const iconElement = dom.append(item, dom.$(`span${ThemeIcon.asCSSSelector(icon)}`));
			if (spinning) {
				iconElement.classList.add('codicon-modifier-spin');
			}
			dom.append(item, dom.$('span')).textContent = label;
			item.title = detail ? `${label} — ${detail}` : label;
			item.setAttribute('aria-label', item.title);
			item.onclick = !enabled
				? null
				: () => {
					if (state.type === StateType.Idle) {
						awaitingExplicitCheck = true;
					}
					void this.runUpdateAction(state);
				};
		};

		render();
		this.shellDisposables.add(this.updateService.onStateChange(state => {
			// Same signal the workbench uses for its dialog: an explicit check that lands
			// back on Idle found nothing. Any other landing state speaks for itself.
			if (state.type === StateType.CheckingForUpdates) {
				awaitingExplicitCheck = awaitingExplicitCheck || state.explicit;
			} else if (state.type === StateType.Idle && awaitingExplicitCheck) {
				awaitingExplicitCheck = false;
				reportOutcome(
					state.error ?? localize('cleanSlate.agentManager.updateUpToDate', 'No new updates'),
					!!state.error
				);
				return;
			} else {
				awaitingExplicitCheck = false;
			}
			render(state);
		}));
	}

	private describeUpdateDisablement(reason: DisablementReason): string {
		switch (reason) {
			case DisablementReason.NotBuilt:
				return localize('cleanSlate.agentManager.updateNotBuilt', 'Not available when running from source');
			case DisablementReason.DisabledByEnvironment:
				return localize('cleanSlate.agentManager.updateDisabledEnv', 'Disabled by the environment');
			case DisablementReason.ManuallyDisabled:
				return localize('cleanSlate.agentManager.updateDisabledSetting', 'Turned off by the update.mode setting');
			case DisablementReason.MissingConfiguration:
			case DisablementReason.InvalidConfiguration:
				return localize('cleanSlate.agentManager.updateMisconfigured', 'This build is not configured for updates');
			case DisablementReason.RunningAsAdmin:
				return localize('cleanSlate.agentManager.updateAdmin', 'Not available while running as administrator');
		}
	}

	private async runUpdateAction(state: UpdateState): Promise<void> {
		switch (state.type) {
			case StateType.Idle:
				await this.updateService.checkForUpdates(true);
				break;
			case StateType.AvailableForDownload:
				await this.updateService.downloadUpdate();
				break;
			case StateType.Downloaded:
				await this.updateService.applyUpdate();
				break;
			case StateType.Ready:
				await this.updateService.quitAndInstall();
				break;
		}
	}

	private applyStoredNavWidth(): void {
		const raw = this.storageService.get(CLEANSLATE_AGENT_MANAGER_NAV_WIDTH_STORAGE_KEY, StorageScope.PROFILE);
		const width = raw ? Number(raw) : CLEANSLATE_AGENT_MANAGER_NAV_WIDTH_DEFAULT;
		this.setNavWidth(width, false);
	}

	private setLeftNavVisible(visible: boolean): void {
		this.leftNavVisible = visible;
		this.updateLeftNavChrome();
		this.layoutRightPane();
	}

	private updateLeftNavChrome(): void {
		this.root?.classList.toggle('nav-collapsed', !this.leftNavVisible);
		this.syncTitlebarHeaderOffset();
		if (!this.leftNavToggleButton) {
			return;
		}
		this.leftNavToggleButton.classList.toggle('active', this.leftNavVisible);
		this.leftNavToggleButton.setAttribute('aria-pressed', String(this.leftNavVisible));
		this.leftNavToggleButton.title = this.leftNavVisible
			? localize('cleanSlate.agentManager.hideHistory', 'Hide history')
			: localize('cleanSlate.agentManager.showHistory', 'Show history');
		this.leftNavToggleButton.setAttribute('aria-label', this.leftNavToggleButton.title);
	}

	private setNavWidth(width: number, persist: boolean): number {
		const next = this.clampNavWidth(width);
		this.root?.style.setProperty('--cleanSlate-agent-manager-nav-width', `${next}px`);
		this.syncTitlebarHeaderOffset(next);
		if (persist) {
			this.storageService.store(CLEANSLATE_AGENT_MANAGER_NAV_WIDTH_STORAGE_KEY, String(next), StorageScope.PROFILE, StorageTarget.USER);
		}
		this.layoutRightPane();
		return next;
	}

	private syncTitlebarHeaderOffset(navWidth = CLEANSLATE_AGENT_MANAGER_NAV_WIDTH_DEFAULT): void {
		const titlebar = this.titlebarHeaderHost?.parentElement;
		if (!this.titlebarHeaderHost || !titlebar) {
			return;
		}
		let width = 0;
		if (this.leftNavVisible) {
			width = this.leftNav?.getBoundingClientRect().width ?? navWidth;
		}
		titlebar.style.setProperty('--cleanSlate-agent-manager-nav-width', `${Math.max(0, Math.round(width))}px`);
	}

	private clampNavWidth(width: number): number {
		const rootWidth = this.root?.clientWidth ?? 0;
		const maxByRoot = rootWidth > 0
			? Math.max(CLEANSLATE_AGENT_MANAGER_NAV_WIDTH_MIN, rootWidth - CLEANSLATE_AGENT_MANAGER_MAIN_WIDTH_MIN)
			: CLEANSLATE_AGENT_MANAGER_NAV_WIDTH_MAX;
		const max = Math.min(CLEANSLATE_AGENT_MANAGER_NAV_WIDTH_MAX, maxByRoot);
		return Math.max(CLEANSLATE_AGENT_MANAGER_NAV_WIDTH_MIN, Math.min(max, Math.round(width)));
	}

	private bindNavResize(handle: HTMLElement): void {
		handle.tabIndex = 0;
		handle.setAttribute('role', 'separator');
		handle.setAttribute('aria-orientation', 'vertical');
		handle.setAttribute('aria-label', localize('cleanSlate.agentManager.resizeSidebar', 'Resize sidebar'));
		handle.title = handle.getAttribute('aria-label') ?? '';
		const dragDisposables = this.shellDisposables.add(new DisposableStore());
		const stopResize = (persistWidth?: number): void => {
			dragDisposables.clear();
			this.root?.classList.remove('resizing-nav');
			if (typeof persistWidth === 'number') {
				this.setNavWidth(persistWidth, true);
			}
		};
		this.shellDisposables.add(dom.addDisposableListener(handle, 'mousedown', event => {
			const mouseEvent = event as MouseEvent;
			if (mouseEvent.button !== 0) {
				return;
			}
			mouseEvent.preventDefault();
			const root = this.root;
			if (!root) {
				return;
			}
			this.hideWorkspaceSelector();
			root.classList.add('resizing-nav');
			const rootLeft = root.getBoundingClientRect().left;
			let latestWidth = this.clampNavWidth(mouseEvent.clientX - rootLeft);
			this.setNavWidth(latestWidth, false);
			dragDisposables.clear();
			dragDisposables.add(dom.addDisposableListener(this.targetWindow, 'mousemove', moveEvent => {
				const nextMouseEvent = moveEvent as MouseEvent;
				latestWidth = this.setNavWidth(nextMouseEvent.clientX - rootLeft, false);
			}));
			dragDisposables.add(dom.addDisposableListener(this.targetWindow, 'mouseup', () => stopResize(latestWidth)));
		}));
		this.shellDisposables.add(dom.addDisposableListener(handle, 'keydown', event => {
			const keyboardEvent = event as KeyboardEvent;
			const current = this.clampNavWidth(this.leftNav?.getBoundingClientRect().width ?? CLEANSLATE_AGENT_MANAGER_NAV_WIDTH_DEFAULT);
			if (keyboardEvent.key === 'ArrowLeft') {
				keyboardEvent.preventDefault();
				this.setNavWidth(current - 16, true);
			} else if (keyboardEvent.key === 'ArrowRight') {
				keyboardEvent.preventDefault();
				this.setNavWidth(current + 16, true);
			}
		}));
	}

	private buildRightPane(parent: HTMLElement): void {
		const parts = this.rightPaneView.build(parent);
		this.rightPaneTitle = parts.title;
		this.rightPaneBody = parts.body;
		this.rightPaneTabsEl = parts.tabs;
	}

	private openRightPaneTab(tab: CleanSlateAgentManagerRightTab): void {
		if (!this.rightPaneOpenTabs.includes(tab)) {
			this.rightPaneOpenTabs = [...this.rightPaneOpenTabs, tab];
		}
	}

	private closeRightPaneTab(tab: CleanSlateAgentManagerRightTab): void {
		this.rightPaneOpenTabs = this.rightPaneOpenTabs.filter(openTab => openTab !== tab);
		if (this.rightPaneActiveTab === tab) {
			const fallback = this.rightPaneOpenTabs[this.rightPaneOpenTabs.length - 1];
			if (fallback) {
				this.selectRightPaneTab(fallback, false);
				return;
			}
			this.showRightPaneLauncher();
			return;
		}
		this.updateRightPaneChrome();
		this.saveRightPaneStateForActiveSession();
	}

	private showRightPaneLauncher(): void {
		this.rightPaneActiveTab = undefined;
		this.renderActiveRightPaneTab();
		this.updateRightPaneChrome();
		this.layoutRightPane();
		this.saveRightPaneStateForActiveSession();
	}

	private renderLauncherInRightPane(): void {
		if (!this.rightPaneBody || !this.rightPaneTitle) {
			return;
		}
		this.rightPaneMarkdownDisposables.clear();
		this.deactivateRightPaneTerminal();
		this.browserPaneActive = false;
		this.browserPaneViewport = undefined;
		void this.browserAutomationService.setOpenBrowserVisible(false, this.getActiveAgentManagerBrowserSurface());
		this.rightPaneTitle.textContent = localize('cleanSlate.agentManager.rightPaneTitle', 'Workspace');
		this.rightPaneBody.classList.remove('browser', 'terminal', 'review', 'file');
		this.rightPaneBody.classList.add('launcher');
		this.rightPaneView.renderLauncher(
			this.rightPaneBody,
			['review', 'terminal', 'browser', 'artifacts', 'file'],
			tab => this.selectRightPaneTab(tab, true)
		);
	}

	private applyStoredRightPaneWidth(): void {
		const raw = this.storageService.get(CLEANSLATE_AGENT_MANAGER_RIGHT_WIDTH_STORAGE_KEY, StorageScope.PROFILE);
		const width = raw ? Number(raw) : CLEANSLATE_AGENT_MANAGER_RIGHT_WIDTH_DEFAULT;
		this.setRightPaneWidth(width, false);
	}

	private setRightPaneWidth(width: number, persist: boolean): number {
		const next = this.clampRightPaneWidth(width);
		this.root?.style.setProperty('--cleanSlate-agent-manager-right-width', `${next}px`);
		if (persist) {
			this.storageService.store(CLEANSLATE_AGENT_MANAGER_RIGHT_WIDTH_STORAGE_KEY, String(next), StorageScope.PROFILE, StorageTarget.USER);
		}
		this.scheduleBrowserPaneLayout();
		return next;
	}

	private clampRightPaneWidth(width: number): number {
		const rootWidth = this.root?.clientWidth ?? 0;
		const navWidth = this.leftNavVisible ? (this.leftNav?.getBoundingClientRect().width ?? CLEANSLATE_AGENT_MANAGER_NAV_WIDTH_DEFAULT) : 0;
		const available = Math.max(0, rootWidth - navWidth);
		const maxByRoot = available > 0
			? Math.max(CLEANSLATE_AGENT_MANAGER_RIGHT_WIDTH_MIN, available - CLEANSLATE_AGENT_MANAGER_MAIN_WIDTH_MIN)
			: CLEANSLATE_AGENT_MANAGER_RIGHT_WIDTH_MAX;
		const max = Math.min(CLEANSLATE_AGENT_MANAGER_RIGHT_WIDTH_MAX, maxByRoot);
		return Math.max(CLEANSLATE_AGENT_MANAGER_RIGHT_WIDTH_MIN, Math.min(max, Math.round(width)));
	}

	private getCurrentRightPaneWidth(): number {
		return this.clampRightPaneWidth(this.rightPane?.getBoundingClientRect().width || CLEANSLATE_AGENT_MANAGER_RIGHT_WIDTH_DEFAULT);
	}

	private bindRightPaneResize(handle: HTMLElement): void {
		handle.tabIndex = 0;
		handle.setAttribute('role', 'separator');
		handle.setAttribute('aria-orientation', 'vertical');
		handle.setAttribute('aria-label', localize('cleanSlate.agentManager.resizeRightPane', 'Resize right pane'));
		handle.title = handle.getAttribute('aria-label') ?? '';
		const dragDisposables = this.shellDisposables.add(new DisposableStore());
		const stopResize = (persistWidth?: number): void => {
			dragDisposables.clear();
			this.root?.classList.remove('resizing-right');
			if (typeof persistWidth === 'number') {
				this.setRightPaneWidth(persistWidth, true);
			}
		};
		this.shellDisposables.add(dom.addDisposableListener(handle, 'mousedown', event => {
			const mouseEvent = event as MouseEvent;
			if (mouseEvent.button !== 0) {
				return;
			}
			mouseEvent.preventDefault();
			const root = this.root;
			if (!root) {
				return;
			}
			this.setRightPaneVisible(true);
			this.hideWorkspaceSelector();
			root.classList.add('resizing-right');
			const rootRight = root.getBoundingClientRect().right;
			let latestWidth = this.setRightPaneWidth(rootRight - mouseEvent.clientX, false);
			dragDisposables.clear();
			dragDisposables.add(dom.addDisposableListener(this.targetWindow, 'mousemove', moveEvent => {
				const nextMouseEvent = moveEvent as MouseEvent;
				latestWidth = this.setRightPaneWidth(rootRight - nextMouseEvent.clientX, false);
			}));
			dragDisposables.add(dom.addDisposableListener(this.targetWindow, 'mouseup', () => stopResize(latestWidth)));
		}));
		this.shellDisposables.add(dom.addDisposableListener(handle, 'keydown', event => {
			const keyboardEvent = event as KeyboardEvent;
			const current = this.getCurrentRightPaneWidth();
			if (keyboardEvent.key === 'ArrowLeft') {
				keyboardEvent.preventDefault();
				this.setRightPaneWidth(current + 16, true);
			} else if (keyboardEvent.key === 'ArrowRight') {
				keyboardEvent.preventDefault();
				this.setRightPaneWidth(current - 16, true);
			}
		}));
	}

	// TEMP DIAGNOSTIC (cross-workspace file leak on IDE handoff): log what is open /
	// dirty in this window right before the reload, so a repro captures whether the
	// leaked tabs arrive as dirty hot-exit backups or as clean editor-memento carryover.
	private logIdeHandoffDiagnostics(target: { readonly folderUri: URI } | { readonly workspaceUri: URI } | undefined): void {
		try {
			this.instantiationService.invokeFunction(accessor => {
				const workingCopyService = accessor.get(IWorkingCopyService);
				const editorService = accessor.get(IEditorService);
				const targetUri = target ? ('workspaceUri' in target ? target.workspaceUri : target.folderUri).toString() : '(none)';
				const currentFolders = this.workspaceContextService.getWorkspace().folders.map(f => f.uri.toString());
				const dirty = workingCopyService.dirtyWorkingCopies.map(wc => wc.resource.toString());
				const openEditors = editorService.editors.map(e => e.resource?.toString()).filter(Boolean);
				// eslint-disable-next-line no-console
				console.log('[CleanSlate][ide-handoff]', JSON.stringify({
					target: targetUri,
					currentWorkspace: currentFolders,
					dirtyWorkingCopies: dirty,
					openEditors
				}, null, 2));
			});
		} catch (error) {
			console.warn('[CleanSlate][ide-handoff] diagnostic failed', error);
		}
	}

	private async exitToEditor(): Promise<void> {
		// Capture the target before publishing the handoff. Publishing can update the
		// IDE's active chat and must not be allowed to change which project we open.
		const target = this.getActiveWorkspaceOpenTarget();
		this.logIdeHandoffDiagnostics(target);
		if (!target) {
			// "No project" is a valid selection, not a failure: the IDE button should
			// open (or reveal) an empty editor window rather than report an error.
			if (this.isActiveSelectionNoProject()) {
				await this.exitToEmptyEditor();
			} else {
				this.notificationService.error(localize('cleanSlate.agentManager.openIdeNoProject', 'Unable to open the IDE because the selected project location could not be resolved.'));
			}
			return;
		}
		await this.publishActiveSessionForIdeHandoff();
		if (this.isOpenTargetCurrentWorkspace(target)) {
			this.closeAgentManagerSurface();
			return;
		}
		// Opening a different project reloads the window, which re-runs the
		// Agent-Manager-by-default startup contribution. Leave a one-shot marker
		// so that specific launch lands in the editor instead of back here.
		await this.markIdeHandoffTarget(target);
		if (await this.openSelectedWorkspaceInIde(target)) {
			this.closeAgentManagerSurface();
		}
	}

	// The IDE button when "No project" is selected: reveal the bare editor. If the
	// current window is already empty there is nothing to reload, so just close the
	// surface; otherwise reload into an empty window and mark the handoff so that
	// launch lands in the editor instead of back in Agent Manager.
	private async exitToEmptyEditor(): Promise<void> {
		await this.publishActiveSessionForIdeHandoff();
		if (this.workspaceContextService.getWorkbenchState() === WorkbenchState.EMPTY) {
			this.closeAgentManagerSurface();
			return;
		}
		await this.markEmptyIdeHandoff();
		if (await this.openEmptyWindowInIde()) {
			this.closeAgentManagerSurface();
		}
	}

	// Whether the active Agent Manager selection is the "No project" entry. Mirrors
	// the resolution order in getActiveWorkspaceOpenTarget so the two stay in sync.
	private isActiveSelectionNoProject(): boolean {
		const snapshot = this.sidebarViewModel.getCurrentSessionSnapshot();
		const sessionEntry = this.projectProvider.getWorkspaceEntryForSession(snapshot, this.workspaceEntries);
		const entry = this.selectedWorkspaceEntry ?? sessionEntry;
		if (entry) {
			return this.projectProvider.isNoProjectEntry(entry);
		}
		// No entry and no session workspace URI means there is no project to open.
		return !this.projectProvider.getSessionWorkspaceUri(snapshot);
	}

	private async openEmptyWindowInIde(): Promise<boolean> {
		try {
			await this.hostService.openWindow({ forceReuseWindow: true });
			return true;
		} catch (error) {
			console.warn('[CleanSlate] Failed to open an empty Agent Manager window in IDE:', error);
			this.notificationService.error(localize('cleanSlate.agentManager.openIdeFailed', 'Unable to open the selected project in the IDE.'));
			return false;
		}
	}

	private async markEmptyIdeHandoff(): Promise<void> {
		this.storageService.store(
			CLEANSLATE_AGENT_MANAGER_IDE_HANDOFF_KEY,
			JSON.stringify({ empty: true, at: Date.now() }),
			StorageScope.APPLICATION,
			StorageTarget.MACHINE
		);
		// The window is about to be replaced; make sure the marker hits disk first.
		await this.storageService.flush();
	}

	private async markIdeHandoffTarget(target: { readonly folderUri: URI } | { readonly workspaceUri: URI }): Promise<void> {
		const uri = 'workspaceUri' in target ? target.workspaceUri : target.folderUri;
		this.storageService.store(
			CLEANSLATE_AGENT_MANAGER_IDE_HANDOFF_KEY,
			JSON.stringify({ uri: uri.toString(), at: Date.now() }),
			StorageScope.APPLICATION,
			StorageTarget.MACHINE
		);
		// The window is about to be replaced; make sure the marker hits disk first.
		await this.storageService.flush();
	}

	private closeAgentManagerSurface(): void {
		if (this.onExit) {
			this.onExit();
			return;
		}
		this.hide();
	}

	private async openSelectedWorkspaceInIde(target: { readonly folderUri: URI } | { readonly workspaceUri: URI }): Promise<boolean> {
		try {
			// Dirty editors are backed up by the working-copy shutdown participant
			// before the workspace is replaced, then restored when this project reopens.
			await this.hostService.openWindow([target], { forceReuseWindow: true });
			return true;
		} catch (error) {
			console.warn('[CleanSlate] Failed to open selected Agent Manager workspace in IDE:', error);
			this.notificationService.error(localize('cleanSlate.agentManager.openIdeFailed', 'Unable to open the selected project in the IDE.'));
			return false;
		}
	}

	private getActiveWorkspaceOpenTarget(): { readonly folderUri: URI } | { readonly workspaceUri: URI } | undefined {
		const snapshot = this.sidebarViewModel.getCurrentSessionSnapshot();
		const sessionEntry = this.projectProvider.getWorkspaceEntryForSession(snapshot, this.workspaceEntries);
		// The project highlighted in Agent Manager is the user's explicit choice.
		// Session metadata is only a fallback for startup/restoration races.
		const entry = this.selectedWorkspaceEntry ?? sessionEntry;
		if (entry && !this.projectProvider.isNoProjectEntry(entry)) {
			if (entry.workspaceUri) {
				return { workspaceUri: entry.workspaceUri };
			}
			if (entry.folderUri) {
				return { folderUri: entry.folderUri };
			}
		}
		const sessionUri = this.projectProvider.getSessionWorkspaceUri(snapshot);
		if (!sessionUri) {
			return undefined;
		}
		return sessionUri.path.toLowerCase().endsWith('.code-workspace')
			? { workspaceUri: sessionUri }
			: { folderUri: sessionUri };
	}

	private isOpenTargetCurrentWorkspace(target: { readonly folderUri: URI } | { readonly workspaceUri: URI }): boolean {
		const workspace = this.workspaceContextService.getWorkspace();
		if ('workspaceUri' in target) {
			return workspace.configuration?.toString() === target.workspaceUri.toString();
		}
		return workspace.folders.some(folder => folder.uri.toString() === target.folderUri.toString());
	}

	private async getActiveReviewScopeRoots(): Promise<URI[]> {
		const target = this.getActiveWorkspaceOpenTarget();
		if (!target) {
			return [];
		}
		if ('folderUri' in target) {
			return [target.folderUri];
		}
		if (this.isOpenTargetCurrentWorkspace(target)) {
			return this.workspaceContextService.getWorkspace().folders.map(folder => folder.uri);
		}
		return this.resolveWorkspaceFileRoots(target.workspaceUri);
	}

	private async resolveWorkspaceFileRoots(workspaceUri: URI): Promise<URI[]> {
		try {
			const content = (await this.fileService.readFile(workspaceUri)).value.toString();
			const parsed = json.parse(content);
			const folders = Array.isArray(parsed?.folders)
				? parsed.folders.filter(isStoredWorkspaceFolder)
				: [];
			return toWorkspaceFolders(folders, workspaceUri, extUri).map(folder => folder.uri);
		} catch (error) {
			console.warn('[CleanSlate] Failed to resolve Agent Manager review workspace roots:', error);
			return [];
		}
	}

	private openSettingsFromAgentManager(): void {
		if (this.settingsPanelVisible) {
			this.closeSettingsPanel();
		} else {
			this.showSettingsPanel();
		}
	}

	private showSettingsPanel(): void {
		if (!this.settingsOverlay || this.settingsPanelVisible) {
			return;
		}
		this.settingsPanelVisible = true;
		this.cancelBrowserPaneLayout();
		void this.browserAutomationService.setOpenBrowserVisible(false, this.getActiveAgentManagerBrowserSurface());
		this.root?.classList.add('settings-panel-open');
		dom.clearNode(this.settingsOverlay);
		this.settingsOverlay.classList.add('visible');

		const panel = this.settingsPanel = new CleanSlateSettingsPanel(this.cleanSlateConfigService, this.cleanSlateService, {
			signIn: () => openCleanSlateSignIn(this.openerService, this.notificationService, this.cleanSlateMainService),
			upgradeToPro: () => openCleanSlateProCheckout(this.openerService, this.notificationService, this.cleanSlateMainService),
			signOut: () => clearCleanSlateAuthAccount(this.secretStorageService, this.storageService),
			manageAccount: () => openCleanSlateAccount(this.openerService, this.notificationService, this.cleanSlateMainService)
		});
		panel.mount(this.settingsOverlay, {
			sidebarHeader: parent => {
				const back = dom.append(parent, dom.$('button.cleanSlate-settings-back')) as HTMLButtonElement;
				back.type = 'button';
				back.setAttribute('aria-label', localize('cleanSlate.agentManager.settingsBackToApp', 'Back to app'));
				dom.append(back, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.arrowLeft)}`));
				dom.append(back, dom.$('span')).textContent = localize('cleanSlate.agentManager.settingsBackToApp', 'Back to app');
				back.onclick = () => this.closeSettingsPanel();
			}
		});
	}

	private closeSettingsPanel(): void {
		if (!this.settingsPanelVisible) {
			return;
		}
		this.settingsPanelVisible = false;
		this.settingsPanel = undefined;
		this.root?.classList.remove('settings-panel-open');
		if (this.settingsOverlay) {
			this.settingsOverlay.classList.remove('visible');
			dom.clearNode(this.settingsOverlay);
		}
		this.layoutRightPane();
	}

	private async publishActiveSessionForIdeHandoff(): Promise<void> {
		try {
			const snapshot = this.sidebarViewModel.getCurrentSessionSnapshot();
			if (!this.sessionMapper.hasVisibleSessionContent(snapshot)) {
				await this.cleanSlateMainService.clearActiveThreadSession(this.getSnapshotWorkspaceId(snapshot));
				return;
			}
			const session = this.sessionMapper.toPersistedSession(snapshot);
			await this.cleanSlateMainService.saveActiveThreadSession(this.getSnapshotWorkspaceId(snapshot), session);
			await this.cleanSlateMainService.publishThreadSession({
				originId: 'agentManager:handoff',
				session,
				makeActive: true
			});
		} catch (error) {
			console.warn('[CleanSlate] Failed to hand off Agent Manager session to IDE chat:', error);
		}
	}

	private buildMain(parent: HTMLElement): void {
		this.chatSurface = dom.append(parent, dom.$('.cleanSlate-agent-manager-chat.cleanSlate-chat-view'));
		const transcriptHost = dom.append(this.chatSurface, dom.$('.cleanSlate-agent-manager-transcript'));
		const bottomHost = dom.append(this.chatSurface, dom.$('.cleanSlate-agent-manager-bottom'));
		this.progressList = dom.append(bottomHost, dom.$('.cleanSlate-agent-manager-progress'));

		this.transcriptView = new CleanSlateTranscriptView(
			transcriptHost,
			this.transcriptRenderer,
			question => {
				this.planningQuestionView.show(question);
				this.planApprovalView?.hide();
			}
		);

		this.pendingEditsBarView = new CleanSlatePendingEditsBarView(
			bottomHost,
			this.pendingEditsRenderer,
			() => this.sidebarViewModel.acceptAll(),
			() => this.sidebarViewModel.rejectAll()
		);
		this.planPanelView = new CleanSlatePlanPanelView(bottomHost);

		this.composerView = new CleanSlateComposerView(bottomHost, {
			workspaceName: this.getSelectedWorkspaceLabel(),
			onWorkspaceSelector: anchor => void this.showWorkspaceSelector(anchor),
			imageDropTarget: this.chatSurface,
			mountPanels: inputBox => {
				this.planningQuestionView = new CleanSlatePlanningQuestionView(
					inputBox,
					() => this.composerView?.getInputElement(),
					() => {
						this.updatePlaceholder();
						this.updateApproveButtonVisibility();
					}
				);
				this.shellDisposables.add(dom.addDisposableListener(inputBox, 'cleanslate-planning-question-submit', (event: Event) => {
					const submission = (event as CustomEvent<ICleanSlatePlanningQuestionSubmission>).detail;
					void this.messageSubmitController.send(submission.message, submission.displayText, {
						userRenderPayload: stringifyCleanSlatePlanningAnswerPayload(submission.question)
					});
				}));
				this.planApprovalView = new CleanSlatePlanApprovalView(inputBox, {
					getInputValue: () => this.composerView?.getValue() ?? '',
					focusInput: () => this.composerView?.focus(),
					onApprove: () => void this.approvePlan(),
					onRevise: direction => {
						const revisionMessage = /^revise plan\b/i.test(direction) ? direction : `revise plan: ${direction}`;
						void this.messageSubmitController.send(revisionMessage, direction);
					},
					onDidChange: () => this.updatePlaceholder()
				});
				this.commandApprovalView = new CleanSlateCommandApprovalView(inputBox, {
					focusInput: () => this.composerView?.focus(),
					onApprove: blockId => {
						this.sidebarViewModel.approveCommand(blockId);
						this.updateCommandApprovalVisibility();
					},
					onApproveForSession: blockId => {
						this.sidebarViewModel.approveCommandForSession(blockId);
						this.updateCommandApprovalVisibility();
					},
					onCancel: blockId => {
						this.sidebarViewModel.rejectCommand(blockId);
						this.updateCommandApprovalVisibility();
					},
					onDidChange: () => this.updatePlaceholder()
				});
			},
			onSubmit: () => this.handleComposerSubmit(),
			onImageAdded: imageDataUrl => this.sidebarViewModel.addPendingImage(imageDataUrl),
			onImageRemoved: index => this.sidebarViewModel.removePendingImage(index),
			onReasoningSelector: anchor => void this.reasoningSelectorRenderer.toggle(this.root ?? this.chatSurface, anchor),
			onPlanModeCommand: () => void this.sidebarViewModel.updatePlanMode(true),
			onPlanModeDisabled: () => void this.sidebarViewModel.updatePlanMode(false),
			onEditModeSelector: anchor => this.editModeSelectorRenderer.toggle(this.root ?? this.chatSurface, anchor),
			onModelSelector: anchor => void this.modelSelectorRenderer.toggle(this.root ?? this.chatSurface, anchor),
			onDeleteAnnotations: annotations => void this.annotationController.deleteVisible(annotations),
			onRemoveSelectionReference: index => this.sidebarViewModel.removePendingSelectionReference(index),
			onDidInputChange: () => this.composerDraftController.handleInputChange(),
			onKeyDown: event => {
				if (this.commandApprovalView.isVisible()) {
					return this.commandApprovalView.handleKeyDown(event);
				}
				return false;
			},
			onEscape: () => {
				if (this.planningQuestionView.isVisible()) {
					this.planningQuestionView.clear(true);
					return true;
				}
				if (this.planApprovalView.isVisible()) {
					this.planApprovalView.dismiss(true);
					return true;
				}
				if (this.commandApprovalView.isVisible()) {
					this.commandApprovalView.cancel();
					return true;
				}
				return false;
			}
		});

		this.bindBottomHeight(bottomHost);
		this.updateModelDropdownState();
		this.updateReasoningDropdownState();
		this.updatePlanModeState();
		this.updateEditModeState();
		this.composerDraftController.updateContextWindowUsage();
		this.updateApproveButtonVisibility();
		this.updateCommandApprovalVisibility();
		this.updateAnnotationReferences(this.browserAutomationService.listCachedAnnotations(this.getActiveAgentManagerBrowserSurface()));
		this.updateIndexingState();
	}

	private setRightPaneVisible(visible: boolean): void {
		// A fresh pane opens on the launcher unless the session already has an
		// active surface to return to.
		if (visible && !this.rightPaneVisible && this.rightPaneActiveTab && !this.rightPaneOpenTabs.includes(this.rightPaneActiveTab)) {
			this.openRightPaneTab(this.rightPaneActiveTab);
		}

		this.rightPaneVisible = visible;
		if (!visible) {
			this.browserPaneActive = false;
			this.cancelBrowserPaneLayout();
			this.deactivateRightPaneTerminal();
			void this.browserAutomationService.setOpenBrowserVisible(false, this.getActiveAgentManagerBrowserSurface());
		} else {
			this.renderActiveRightPaneTab();
		}
		this.updateRightPaneChrome();
		this.layoutRightPane();
		this.saveRightPaneStateForActiveSession();
	}

	private syncRightPaneStateWithActiveSession(): void {
		const activeSessionId = this.sidebarViewModel.getActiveSessionId();
		if (this.rightPaneStateSessionId === activeSessionId) {
			return;
		}
		const previousSessionId = this.rightPaneStateSessionId;
		this.saveRightPaneStateForSession(previousSessionId);
		void this.browserAutomationService.setOpenBrowserVisible(false, this.getAgentManagerBrowserSurfaceForSession(previousSessionId));
		this.restoreRightPaneStateForSession(activeSessionId);
		this.adoptVisibleIdeBrowserForActiveSessionIfNeeded();
	}

	private getActiveAgentManagerBrowserSurface(): CleanSlateBrowserSurface {
		return this.getAgentManagerBrowserSurfaceForSession(this.sidebarViewModel.getActiveSessionId());
	}

	private getAgentManagerBrowserSurfaceForSession(sessionId: string | undefined): CleanSlateBrowserSurface {
		return sessionId ? `agentManager:${sessionId}` : 'agentManager';
	}

	private isActiveAgentManagerBrowserSurface(surface: CleanSlateBrowserSurface): boolean {
		return surface === this.getActiveAgentManagerBrowserSurface();
	}

	private getSessionIdForAgentManagerBrowserSurface(surface: CleanSlateBrowserSurface): string | undefined {
		return surface.startsWith('agentManager:') ? surface.slice('agentManager:'.length) : undefined;
	}

	private cacheBrowserStateForSurface(state: ICleanSlateBrowserState): void {
		const sessionId = this.getSessionIdForAgentManagerBrowserSurface(state.surface);
		if (!sessionId) {
			return;
		}
		const current = this.rightPaneStateBySession.get(sessionId);
		const openTabs = current?.openTabs?.includes('browser')
			? current.openTabs
			: [...(current?.openTabs ?? []), 'browser' as const];
		this.rightPaneStateBySession.set(sessionId, {
			visible: current?.visible ?? true,
			activeTab: current?.activeTab ?? 'browser',
			openTabs,
			latestBrowserState: state,
			artifacts: new Map(current?.artifacts)
		});
	}

	private saveRightPaneStateForActiveSession(): void {
		this.saveRightPaneStateForSession(this.rightPaneStateSessionId ?? this.sidebarViewModel.getActiveSessionId());
	}

	private saveRightPaneStateForSession(sessionId: string | undefined): void {
		if (!sessionId) {
			return;
		}
		this.rightPaneStateBySession.set(sessionId, {
			visible: this.rightPaneVisible,
			activeTab: this.rightPaneActiveTab,
			openTabs: [...this.rightPaneOpenTabs],
			latestBrowserState: this.latestBrowserState,
			artifacts: new Map(this.rightPaneArtifacts)
		});
	}

	private restoreRightPaneStateForActiveSession(): void {
		this.restoreRightPaneStateForSession(this.sidebarViewModel.getActiveSessionId());
	}

	private restoreRightPaneStateForSession(sessionId: string | undefined): void {
		this.rightPaneStateSessionId = sessionId;
		const state = sessionId ? this.rightPaneStateBySession.get(sessionId) : undefined;
		this.rightPaneVisible = state?.visible ?? false;
		this.rightPaneActiveTab = state?.activeTab ?? (this.rightPaneVisible ? 'review' : undefined);
		this.rightPaneOpenTabs = state?.openTabs
			? [...state.openTabs]
			: (this.rightPaneActiveTab ? [this.rightPaneActiveTab] : []);
		if (this.rightPaneActiveTab && !this.rightPaneOpenTabs.includes(this.rightPaneActiveTab)) {
			this.rightPaneOpenTabs = [...this.rightPaneOpenTabs, this.rightPaneActiveTab];
		}
		this.latestBrowserState = state?.latestBrowserState;
		this.rightPaneArtifacts.clear();
		if (state) {
			for (const [tab, artifact] of state.artifacts) {
				if (this.isArtifactForActiveSession(artifact)) {
					this.rightPaneArtifacts.set(tab, artifact);
				}
			}
		}

		if (!this.root || !this.rightPaneBody) {
			return;
		}

		if (!this.rightPaneVisible) {
			this.deactivateRightPaneTerminal();
			this.browserPaneActive = false;
			this.cancelBrowserPaneLayout();
			void this.browserAutomationService.setOpenBrowserVisible(false, this.getAgentManagerBrowserSurfaceForSession(sessionId));
		} else {
			this.renderActiveRightPaneTab();
		}
		this.updateRightPaneChrome();
		this.layoutRightPane();
		this.restoreBrowserPaneForSession(sessionId);
	}

	private restoreBrowserPaneForSession(sessionId: string | undefined): void {
		const state = this.latestBrowserState;
		if (!sessionId || !this.rightPaneVisible || this.rightPaneActiveTab !== 'browser' || !state?.url) {
			return;
		}
		void this.browserAutomationService.openInAgentManager(state.url, this.getAgentManagerBrowserSurfaceForSession(sessionId)).then(nextState => {
			if (this.rightPaneStateSessionId === sessionId && this.rightPaneActiveTab === 'browser') {
				this.openBrowserInRightPane(nextState);
			}
		}).catch(error => this.handleBrowserPaneActionError('restore browser', error));
	}

	private adoptVisibleIdeBrowserForActiveSessionIfNeeded(): void {
		const sessionId = this.sidebarViewModel.getActiveSessionId();
		if (!sessionId || this.rightPaneStateBySession.has(sessionId)) {
			return;
		}
		if (this.rightPaneVisible && this.rightPaneActiveTab === 'browser' && this.latestBrowserState?.url) {
			return;
		}

		const request = ++this.ideBrowserAdoptionRequest;
		void this.browserAutomationService.revealOpenBrowser('ide').then(async state => {
			if (request !== this.ideBrowserAdoptionRequest
				|| !state?.url
				|| !state.visible
				|| !this.root
				|| this.root.classList.contains('hidden')
				|| this.sidebarViewModel.getActiveSessionId() !== sessionId
				|| this.rightPaneStateBySession.has(sessionId)
				|| this.ideBrowserHiddenForAgentManager
			) {
				return;
			}

			await this.browserAutomationService.setOpenBrowserVisible(false, 'ide');
			if (request !== this.ideBrowserAdoptionRequest
				|| !this.root
				|| this.root.classList.contains('hidden')
				|| this.sidebarViewModel.getActiveSessionId() !== sessionId
			) {
				void this.browserAutomationService.setOpenBrowserVisible(true, 'ide')
					.catch(error => console.warn('[CleanSlateAgentWorkspaceOverlay] Failed to restore IDE browser visibility:', error));
				return;
			}

			const nextState = await this.browserAutomationService.openInAgentManager(state.url, this.getAgentManagerBrowserSurfaceForSession(sessionId));
			if (request !== this.ideBrowserAdoptionRequest || this.sidebarViewModel.getActiveSessionId() !== sessionId) {
				void this.browserAutomationService.setOpenBrowserVisible(true, 'ide')
					.catch(error => console.warn('[CleanSlateAgentWorkspaceOverlay] Failed to restore IDE browser visibility:', error));
				return;
			}

			this.ideBrowserHiddenForAgentManager = true;
			this.openBrowserInRightPane(nextState);
		}).catch(error => this.handleBrowserPaneActionError('adopt IDE browser', error));
	}

	private restoreIdeBrowserAfterAgentManagerClose(): void {
		this.ideBrowserAdoptionRequest++;
		if (!this.ideBrowserHiddenForAgentManager) {
			return;
		}
		this.ideBrowserHiddenForAgentManager = false;
		if (this.root && !this.root.classList.contains('hidden')) {
			return;
		}
		void this.browserAutomationService.setOpenBrowserVisible(true, 'ide')
			.catch(error => console.warn('[CleanSlateAgentWorkspaceOverlay] Failed to restore IDE browser visibility:', error));
	}

	private updateRightPaneChrome(): void {
		this.root?.classList.toggle('right-pane-visible', this.rightPaneVisible);
		this.rightPane?.classList.toggle('visible', this.rightPaneVisible);
		this.rightPane?.classList.toggle('launcher', this.rightPaneActiveTab === undefined);
		this.rightResizeHandle?.classList.toggle('visible', this.rightPaneVisible);
		if (this.rightPaneTabsEl) {
			this.rightPaneView.renderTabStrip(this.rightPaneTabsEl, this.rightPaneOpenTabs, this.rightPaneActiveTab, {
				onSelect: tab => this.selectRightPaneTab(tab, true),
				onCloseTab: tab => this.closeRightPaneTab(tab),
				onAdd: () => this.showRightPaneLauncher()
			});
		}
		if (!this.rightPaneToggleButton) {
			return;
		}
		this.rightPaneToggleButton.classList.toggle('active', this.rightPaneVisible);
		this.rightPaneToggleButton.setAttribute('aria-pressed', String(this.rightPaneVisible));
	}

	private layoutRightPane(): void {
		if (!this.root) {
			return;
		}
		this.setRightPaneWidth(this.getCurrentRightPaneWidth(), false);
		this.scheduleBrowserPaneLayout();
		this.layoutTerminalPane();
	}

	private scheduleBrowserPaneLayout(): void {
		if (this.settingsPanelVisible || !this.browserPaneActive || !this.rightPaneVisible || !this.rightPaneBody || !this.root || this.root.classList.contains('hidden')) {
			return;
		}
		if (typeof this.browserPaneLayoutFrame === 'number') {
			this.targetWindow.cancelAnimationFrame(this.browserPaneLayoutFrame);
		}
		this.browserPaneLayoutFrame = this.targetWindow.requestAnimationFrame(() => {
			this.browserPaneLayoutFrame = undefined;
			this.layoutBrowserPane();
			this.targetWindow.requestAnimationFrame(() => this.layoutBrowserPane());
		});
		this.scheduleBrowserPaneSettledLayout();
	}

	private scheduleBrowserPaneSettledLayout(): void {
		if (typeof this.browserPaneLayoutSettleTimeout === 'number') {
			this.targetWindow.clearTimeout(this.browserPaneLayoutSettleTimeout);
		}
		this.browserPaneLayoutSettleTimeout = this.targetWindow.setTimeout(() => {
			this.browserPaneLayoutSettleTimeout = undefined;
			this.layoutBrowserPane(false);
		}, 240);
	}

	private cancelBrowserPaneLayout(): void {
		if (typeof this.browserPaneLayoutFrame === 'number') {
			this.targetWindow.cancelAnimationFrame(this.browserPaneLayoutFrame);
			this.browserPaneLayoutFrame = undefined;
		}
		if (typeof this.browserPaneLayoutSettleTimeout === 'number') {
			this.targetWindow.clearTimeout(this.browserPaneLayoutSettleTimeout);
			this.browserPaneLayoutSettleTimeout = undefined;
		}
	}

	private layoutBrowserPane(retryOnInvalid = true): void {
		if (this.settingsPanelVisible || !this.browserPaneActive || !this.rightPaneVisible || !this.rightPaneBody || !this.root) {
			return;
		}
		const rect = (this.browserPaneViewport ?? this.rightPaneBody).getBoundingClientRect();
		const paneRect = this.rightPaneBody.getBoundingClientRect();
		const rootRect = this.root.getBoundingClientRect();
		const clippedLeft = Math.max(rect.left, paneRect.left, rootRect.left);
		const clippedTop = Math.max(rect.top, paneRect.top, rootRect.top);
		const clippedRight = Math.min(rect.right, paneRect.right, rootRect.right);
		const clippedBottom = Math.min(rect.bottom, paneRect.bottom, rootRect.bottom);
		const width = clippedRight - clippedLeft;
		const height = clippedBottom - clippedTop;
		const isPaneStillEntering = rect.left > rootRect.right - 240 || width < Math.min(240, rect.width * 0.5);
		if (rect.width <= 0 || rect.height <= 0 || width <= 0 || height <= 0 || isPaneStillEntering) {
			void this.browserAutomationService.setOpenBrowserVisible(false, this.getActiveAgentManagerBrowserSurface());
			if (retryOnInvalid) {
				this.scheduleBrowserPaneSettledLayout();
			}
			return;
		}
		void this.browserAutomationService.layoutOpenBrowser({
			x: clippedLeft,
			y: clippedTop,
			width,
			height
		}, this.getActiveAgentManagerBrowserSurface()).then(() => {
			// The screen may have switched while the asynchronous native layout
			// request was in flight. Settings owns the full Agent Manager surface,
			// so a late right-pane composition must not cross that route boundary.
			if (this.settingsPanelVisible) {
				return this.browserAutomationService.setOpenBrowserVisible(false, this.getActiveAgentManagerBrowserSurface());
			}
			return undefined;
		});
	}

	private openBrowserInRightPane(state: ICleanSlateBrowserState): void {
		if (!this.isActiveAgentManagerBrowserSurface(state.surface)) {
			return;
		}
		if (!this.root || this.root.classList.contains('hidden') || !this.rightPaneBody) {
			return;
		}
		this.latestBrowserState = state;
		this.selectRightPaneTab('browser', true);
		this.saveRightPaneStateForActiveSession();
	}

	private isPlanningPaneArtifact(artifact: IArtifact): boolean {
		return artifact.type === 'implementation_plan' || artifact.type === 'analysis' || artifact.type === 'walkthrough';
	}

	private openArtifactInRightPane(artifact: IArtifact): void {
		if (!this.root || this.root.classList.contains('hidden') || !this.rightPaneBody) {
			return;
		}
		const tab = this.getRightPaneTabForArtifact(artifact);
		this.rightPaneArtifacts.set(tab, artifact);
		this.selectRightPaneTab('artifacts', true);
		this.saveRightPaneStateForActiveSession();
	}

	private cacheRightPaneArtifactForSession(artifact: IArtifact): void {
		if (!this.isPlanningPaneArtifact(artifact)) {
			return;
		}
		const sessionId = this.getArtifactSessionId(artifact);
		if (!sessionId) {
			return;
		}
		const tab = this.getRightPaneTabForArtifact(artifact);
		const current = this.rightPaneStateBySession.get(sessionId);
		const artifacts = new Map(current?.artifacts);
		artifacts.set(tab, artifact);
		this.rightPaneStateBySession.set(sessionId, {
			visible: true,
			activeTab: 'artifacts',
			latestBrowserState: current?.latestBrowserState,
			artifacts
		});
	}

	private selectRightPaneTab(tab: CleanSlateAgentManagerRightTab, reveal: boolean): void {
		this.rightPaneActiveTab = tab;
		this.openRightPaneTab(tab);
		if (reveal) {
			this.rightPaneVisible = true;
		}
		this.renderActiveRightPaneTab();
		this.updateRightPaneChrome();
		this.layoutRightPane();
		this.saveRightPaneStateForActiveSession();
	}

	private renderFileInRightPane(): void {
		if (!this.rightPaneBody || !this.rightPaneTitle) {
			return;
		}
		this.rightPaneTitle.textContent = localize('cleanSlate.agentManager.fileTitle', 'Files');
		this.rightPaneBody.classList.remove('browser', 'terminal', 'review', 'launcher');
		this.rightPaneBody.classList.add('file');

		// If the file view is already mounted, keep it. Rebuilding would dispose the
		// editor and drop the open file — which happens on incidental re-renders such
		// as dragging the outer right-pane boundary. The tree still re-resolves its
		// roots, so switching to a session in another project reloads the listing.
		if (this.fileEditor && this.fileLayoutEl && this.rightPaneBody.contains(this.fileLayoutEl)) {
			void this.refreshFileTreeRoots();
			return;
		}

		this.rightPaneMarkdownDisposables.clear();
		this.deactivateRightPaneTerminal();
		this.browserPaneActive = false;
		this.browserPaneViewport = undefined;
		void this.browserAutomationService.setOpenBrowserVisible(false, this.getActiveAgentManagerBrowserSurface());
		dom.clearNode(this.rightPaneBody);

		const layout = dom.append(this.rightPaneBody, dom.$('.cleanSlate-agent-manager-file'));
		this.fileLayoutEl = layout;
		const editorHost = dom.append(layout, dom.$('.cleanSlate-agent-manager-file-editor'));
		const resizer = dom.append(layout, dom.$('.cleanSlate-agent-manager-file-resizer'));
		resizer.setAttribute('role', 'separator');
		resizer.setAttribute('aria-orientation', 'vertical');
		resizer.title = localize('cleanSlate.agentManager.fileResize', 'Resize file tree');
		const tree = dom.append(layout, dom.$('.cleanSlate-agent-manager-file-tree'));
		this.fileTreeEl = tree;
		this.fileTreeRootsKey = undefined;
		tree.style.flexBasis = `${this.fileTreeWidth}px`;

		this.rightPaneMarkdownDisposables.add(dom.addDisposableListener(resizer, 'mousedown', event => {
			const mouseEvent = event as MouseEvent;
			if (mouseEvent.button !== 0) {
				return;
			}
			mouseEvent.preventDefault();
			const layoutRect = layout.getBoundingClientRect();
			resizer.classList.add('resizing');
			const dragDisposables = new DisposableStore();
			const applyWidth = (clientX: number) => {
				const width = Math.min(Math.max(layoutRect.right - clientX, 160), Math.max(220, layoutRect.width - 260));
				this.fileTreeWidth = Math.round(width);
				tree.style.flexBasis = `${this.fileTreeWidth}px`;
			};
			dragDisposables.add(dom.addDisposableListener(this.targetWindow, 'mousemove', moveEvent => applyWidth((moveEvent as MouseEvent).clientX)));
			dragDisposables.add(dom.addDisposableListener(this.targetWindow, 'mouseup', () => {
				resizer.classList.remove('resizing');
				dragDisposables.dispose();
			}));
		}));

		const editor = this.instantiationService.createInstance(
			CodeEditorWidget,
			editorHost,
			{
				automaticLayout: true,
				readOnly: false,
				scrollBeyondLastLine: false,
				minimap: { enabled: false },
				overviewRulerLanes: 0,
				lineNumbersMinChars: 3,
				padding: { top: 10, bottom: 10 }
			},
			{ contributions: EditorExtensionsRegistry.getEditorContributions() }
		);
		this.fileEditor = editor;
		this.rightPaneMarkdownDisposables.add(toDisposable(() => {
			this.fileModelRef?.dispose();
			this.fileModelRef = undefined;
			editor.dispose();
			if (this.fileEditor === editor) {
				this.fileEditor = undefined;
			}
			this.fileLayoutEl = undefined;
			this.fileTreeEl = undefined;
			this.fileTreeRootsKey = undefined;
			this.fileEditorPlaceholder = undefined;
		}));
		// "Add to Chat" inside this embedded editor targets the agent manager
		// composer, not the IDE chat view.
		this.rightPaneMarkdownDisposables.add(registerCleanSlateEditorChatTarget(editor, reference => {
			this.sidebarViewModel.addPendingSelectionReference(reference);
			this.renderSelectionReferences();
		}));

		const placeholder = dom.append(editorHost, dom.$('.cleanSlate-agent-manager-file-placeholder'));
		placeholder.textContent = localize('cleanSlate.agentManager.filePlaceholder', 'Select a file to view.');
		this.fileEditorPlaceholder = placeholder;

		void this.refreshFileTreeRoots();
	}

	/**
	 * The tree lists the project the inspected session belongs to, not whatever
	 * folder the host IDE window happens to have open.
	 */
	private async refreshFileTreeRoots(): Promise<void> {
		const token = ++this.fileTreeToken;
		const roots = await this.getActiveReviewScopeRoots();
		const tree = this.fileTreeEl;
		if (token !== this.fileTreeToken || this.rightPaneActiveTab !== 'file' || !tree || !tree.isConnected) {
			return;
		}
		const rootsKey = roots.map(root => root.toString()).join('\n');
		if (this.fileTreeRootsKey === rootsKey) {
			return;
		}
		const hadRoots = this.fileTreeRootsKey !== undefined;
		this.fileTreeRootsKey = rootsKey;
		dom.clearNode(tree);
		if (hadRoots) {
			// The previously opened file belongs to the project we just navigated away from.
			this.clearEmbeddedFile();
		}
		if (!roots.length) {
			dom.append(tree, dom.$('.cleanSlate-agent-manager-file-empty')).textContent = localize('cleanSlate.agentManager.fileNoWorkspace', 'No folder is open.');
			return;
		}
		for (const root of roots) {
			void this.renderFileTreeChildren(tree, root, 0, token);
		}
	}

	private clearEmbeddedFile(): void {
		this.fileModelRef?.dispose();
		this.fileModelRef = undefined;
		this.fileEditor?.setModel(null);
		this.fileEditorPlaceholder?.classList.remove('hidden');
	}

	private openFileFromAgent(resource: URI, selection?: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }): void {
		if (!this.rightPaneVisible) {
			this.setRightPaneVisible(true);
		}
		if (this.rightPaneActiveTab !== 'file') {
			this.selectRightPaneTab('file', true);
		}
		void this.openFileInEmbeddedEditor(resource, selection);
	}

	private async openFileInEmbeddedEditor(uri: URI, selection?: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }): Promise<void> {
		const editor = this.fileEditor;
		if (!editor) {
			return;
		}
		let ref: IReference<IResolvedTextEditorModel>;
		try {
			ref = await this.textModelService.createModelReference(uri);
		} catch {
			return;
		}
		if (this.rightPaneActiveTab !== 'file' || this.fileEditor !== editor) {
			ref.dispose();
			return;
		}
		this.fileModelRef?.dispose();
		this.fileModelRef = ref;
		this.fileEditorPlaceholder?.classList.add('hidden');
		editor.setModel(ref.object.textEditorModel);
		if (selection) {
			editor.setSelection(selection);
			editor.revealRangeInCenter(selection);
		}
		editor.focus();
	}

	private async renderFileTreeChildren(parent: HTMLElement, dir: URI, depth: number, token: number): Promise<void> {
		let children;
		try {
			const stat = await this.fileService.resolve(dir);
			children = stat.children ?? [];
		} catch {
			return;
		}
		if (token !== this.fileTreeToken || this.rightPaneActiveTab !== 'file' || !parent.isConnected) {
			return;
		}
		const sorted = [...children].sort((a, b) =>
			a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : (a.isDirectory ? -1 : 1));
		for (const child of sorted) {
			const row = dom.append(parent, dom.$('button.cleanSlate-agent-manager-file-row')) as HTMLButtonElement;
			row.type = 'button';
			row.style.paddingLeft = `${8 + depth * 14}px`;
			const iconEl = dom.append(row, dom.$(`span.cleanSlate-agent-manager-file-icon${ThemeIcon.asCSSSelector(child.isDirectory ? Codicon.chevronRight : Codicon.file)}`));
			dom.append(row, dom.$('span.cleanSlate-agent-manager-file-name')).textContent = child.name;
			if (child.isDirectory) {
				let childrenHost: HTMLElement | undefined;
				row.onclick = async () => {
					if (childrenHost) {
						childrenHost.remove();
						childrenHost = undefined;
						iconEl.classList.remove('expanded');
						return;
					}
					iconEl.classList.add('expanded');
					childrenHost = dom.$('.cleanSlate-agent-manager-file-children');
					row.after(childrenHost);
					await this.renderFileTreeChildren(childrenHost, child.resource, depth + 1, token);
				};
			} else {
				row.onclick = () => {
					for (const active of parent.ownerDocument.querySelectorAll('.cleanSlate-agent-manager-file-row.active')) {
						active.classList.remove('active');
					}
					row.classList.add('active');
					void this.openFileInEmbeddedEditor(child.resource);
				};
			}
		}
	}

	private renderActiveRightPaneTab(): void {
		this.rightPaneBody?.classList.remove('launcher', 'file');
		switch (this.rightPaneActiveTab) {
			case 'review':
				this.renderReviewInRightPane();
				return;
			case 'browser':
				this.renderBrowserInRightPane();
				return;
			case 'terminal':
				this.renderTerminalInRightPane();
				return;
			case 'file':
				this.renderFileInRightPane();
				return;
			case 'artifacts':
				this.renderArtifactInRightPane(this.getLatestRightPaneArtifact());
				return;
			default:
				this.renderLauncherInRightPane();
				return;
		}
	}

	private renderReviewInRightPane(): void {
		if (!this.rightPaneBody || !this.rightPaneTitle) {
			return;
		}
		const request = ++this.reviewRenderRequest;
		this.rightPaneMarkdownDisposables.clear();
		this.deactivateRightPaneTerminal();
		this.browserPaneActive = false;
		this.browserPaneViewport = undefined;
		void this.browserAutomationService.setOpenBrowserVisible(false, this.getActiveAgentManagerBrowserSurface());
		this.rightPaneTitle.textContent = localize('cleanSlate.agentManager.review', 'Review');
		this.rightPaneBody.classList.remove('browser', 'terminal');
		this.rightPaneBody.classList.add('review');
		// Refresh in the background when Review is already populated. Clearing the
		// pane here made every duplicate pending-edit/SCM notification flash a
		// loading state and discard the user's filter/expanded rows even when the
		// working-tree diff had not changed.
		if (!this.hasRenderedReview()) {
			dom.clearNode(this.rightPaneBody);
			this.renderReviewLoadingState(this.rightPaneBody);
		}
		void Promise.all([this.collectReviewChanges(), this.getActiveReviewScopeRoots()]).then(([changes, rootUris]) => {
			if (request !== this.reviewRenderRequest || this.rightPaneActiveTab !== 'review' || !this.rightPaneBody || !this.rightPaneTitle) {
				return;
			}
			const signature = this.getReviewRenderSignature(changes, rootUris);
			if (this.hasRenderedReview() && signature === this.reviewRenderedSignature) {
				return;
			}
			this.rightPaneView.renderReview(this.rightPaneBody, this.rightPaneTitle, {
				pendingEdits: changes,
				scopeMode: this.reviewScopeMode,
				onScopeModeChange: mode => this.setReviewScopeMode(mode),
				rootUris,
				onAcceptAll: () => {
					this.sidebarViewModel.acceptAll();
					this.updatePendingEdits();
				},
				onRejectAll: () => {
					this.sidebarViewModel.rejectAll();
					this.updatePendingEdits();
				}
			});
			this.reviewRenderedSignature = signature;
		}).catch(error => {
			console.warn('[CleanSlateAgentWorkspaceOverlay] Failed to collect review changes:', error);
			if (request !== this.reviewRenderRequest || this.rightPaneActiveTab !== 'review' || !this.rightPaneBody || !this.rightPaneTitle) {
				return;
			}
			// A transient Git/SCM read failure is not a workspace change. Preserve a
			// previously rendered review rather than replacing it with partial data.
			if (this.hasRenderedReview()) {
				return;
			}
			const fallbackChanges = this.sidebarViewModel.getPendingEditsDiffs();
			const signature = this.getReviewRenderSignature(fallbackChanges, []);
			this.rightPaneView.renderReview(this.rightPaneBody, this.rightPaneTitle, {
				pendingEdits: fallbackChanges,
				scopeMode: this.reviewScopeMode,
				onScopeModeChange: mode => this.setReviewScopeMode(mode),
				onAcceptAll: () => this.sidebarViewModel.acceptAll(),
				onRejectAll: () => this.sidebarViewModel.rejectAll()
			});
			this.reviewRenderedSignature = signature;
		});
	}

	private hasRenderedReview(): boolean {
		return !!this.rightPaneBody?.querySelector('.cleanSlate-review');
	}

	private getReviewRenderSignature(changes: readonly ICleanSlateReviewChange[], rootUris: readonly URI[]): number {
		const roots = rootUris.map(uri => uri.toString()).sort();
		const changeEntries = changes.map(change => [
			change.uri.toString(),
			change.added,
			change.deleted,
			change.diff,
			change.beforeContent,
			change.afterContent
		]).sort((left, right) => String(left[0]).localeCompare(String(right[0])));
		return hash([
			this.reviewScopeMode,
			roots,
			changeEntries
		]);
	}

	private setReviewScopeMode(mode: CleanSlateReviewDisplayScopeMode): void {
		if (this.reviewScopeMode === mode) {
			return;
		}
		this.reviewScopeMode = mode;
		if (this.rightPaneActiveTab === 'review') {
			this.renderReviewInRightPane();
		}
	}

	private renderReviewLoadingState(container: HTMLElement): void {
		const loading = dom.append(container, dom.$('.cleanSlate-review-empty.cleanSlate-agent-manager-review-loading'));
		const loadingContainer = dom.append(loading, dom.$('.cleanSlate-agent-manager-loading-container'));
		const dotsContainer = dom.append(loadingContainer, dom.$('.cleanSlate-agent-manager-loading-dots'));
		dom.append(dotsContainer, dom.$('.cleanSlate-agent-manager-loading-dot'));
		dom.append(dotsContainer, dom.$('.cleanSlate-agent-manager-loading-dot'));
		dom.append(dotsContainer, dom.$('.cleanSlate-agent-manager-loading-dot'));
		dom.append(loadingContainer, dom.$('.cleanSlate-agent-manager-loading-text')).textContent = localize('cleanSlate.agentManager.reviewLoading', 'Loading changes');
	}

	private async collectReviewChanges(): Promise<ICleanSlateReviewChange[]> {
		const mode = this.reviewScopeMode;
		const cleanSlateChanges = this.sidebarViewModel.getPendingEditsDiffs();
		// 'Last Turn' shows only the agent session's own edits.
		if (mode === 'turn') {
			return cleanSlateChanges;
		}
		const reviewScopeRoots = await this.getActiveReviewScopeRoots();
		const gitChanges = reviewScopeRoots.length > 0
			? await collectGitReviewChanges(this.cleanSlateMainService, this.fileService, { roots: reviewScopeRoots, mode })
			: [];
		// The staged/unstaged/branch scopes are precise git comparisons — mixing
		// in SCM-provider or session edits would break their meaning.
		if (mode !== 'working') {
			return gitChanges;
		}
		const scmChanges = reviewScopeRoots.length > 0
			? await collectSCMReviewChanges(this.scmService, this.fileService, { roots: reviewScopeRoots })
			: [];
		// Prefer the direct Git diff so an active SCM provider cannot report different
		// line counts from the background-project review path for the same working tree.
		return mergeCleanSlateReviewChanges(cleanSlateChanges, mergeCleanSlateReviewChanges(gitChanges, scmChanges));
	}

	private renderBrowserInRightPane(): void {
		if (!this.rightPaneBody || !this.rightPaneTitle) {
			return;
		}
		this.rightPaneMarkdownDisposables.clear();
		this.deactivateRightPaneTerminal();
		const state = this.latestBrowserState;
		this.browserPaneViewport = undefined;
		if (!state) {
			void this.browserAutomationService.setOpenBrowserVisible(false, this.getActiveAgentManagerBrowserSurface());
		}
		const result = this.rightPaneView.renderBrowser(this.rightPaneBody, this.rightPaneTitle, {
			state,
			rightPaneVisible: this.rightPaneVisible,
			onBack: () => this.runBrowserPaneAction('back', () => this.browserAutomationService.navigateBack(this.getActiveAgentManagerBrowserSurface())),
			onForward: () => this.runBrowserPaneAction('forward', () => this.browserAutomationService.navigateForward(this.getActiveAgentManagerBrowserSurface())),
			onReload: () => this.runBrowserPaneAction('reload', () => this.browserAutomationService.reload(this.getActiveAgentManagerBrowserSurface())),
			onOpenAddress: url => this.runBrowserPaneAction('open address', () => this.browserAutomationService.openInAgentManager(url, this.getActiveAgentManagerBrowserSurface())),
			onToggleAnnotation: () => this.toggleBrowserAnnotation(),
			onShowActions: anchor => this.showBrowserActions(anchor),
			onViewport: viewport => this.observeBrowserPaneViewport(viewport)
		});
		this.browserPaneActive = result.browserActive;
		this.browserPaneViewport = result.viewport;
		if (this.browserPaneViewport && this.rightPaneVisible) {
			this.scheduleBrowserPaneLayout();
		}
	}

	private renderTerminalInRightPane(): void {
		if (!this.rightPaneBody || !this.rightPaneTitle) {
			return;
		}
		this.rightPaneMarkdownDisposables.clear();
		this.deactivateRightPaneTerminal();
		this.browserPaneActive = false;
		this.browserPaneViewport = undefined;
		void this.browserAutomationService.setOpenBrowserVisible(false, this.getActiveAgentManagerBrowserSurface());
		this.rightPaneTitle.textContent = localize('cleanSlate.agentManager.terminal', 'Terminal');
		this.rightPaneBody.classList.remove('browser', 'review');
		this.rightPaneBody.classList.add('terminal');
		dom.clearNode(this.rightPaneBody);

		const container = dom.append(this.rightPaneBody, dom.$('.cleanSlate-agent-manager-terminal-container.terminal-editor'));
		this.terminalPaneContainer = container;
		const sessionKey = this.getRightPaneTerminalSessionKey();
		const request = ++this.terminalPaneRenderRequest;
		void this.getOrCreateRightPaneTerminal(sessionKey).then(terminal => {
			if (terminal.isDisposed
				|| request !== this.terminalPaneRenderRequest
				|| this.rightPaneActiveTab !== 'terminal'
				|| !this.rightPaneVisible
				|| this.terminalPaneContainer !== container
				|| !container.isConnected) {
				return;
			}
			this.activeRightPaneTerminal = terminal;
			terminal.attachToElement(container);
			terminal.setVisible(true);
			this.layoutTerminalPane();
			this.targetWindow.requestAnimationFrame(() => this.layoutTerminalPane());
			const ResizeObserverCtor = (this.targetWindow as Window & {
				ResizeObserver?: new (callback: () => void) => { observe(target: Element): void; disconnect(): void };
			}).ResizeObserver;
			if (typeof ResizeObserverCtor === 'function') {
				const resizeObserver = new ResizeObserverCtor(() => this.layoutTerminalPane());
				resizeObserver.observe(container);
				this.rightPaneMarkdownDisposables.add(toDisposable(() => resizeObserver.disconnect()));
			}
		}).catch(error => {
			if (this._store.isDisposed || request !== this.terminalPaneRenderRequest) {
				return;
			}
			console.warn('[CleanSlateAgentWorkspaceOverlay] Failed to create Agent Manager terminal:', error);
			if (request === this.terminalPaneRenderRequest && this.terminalPaneContainer === container) {
				dom.clearNode(container);
				this.rightPaneView.renderEmptyState(
					container,
					Codicon.terminal,
					localize('cleanSlate.agentManager.terminalUnavailable', 'Terminal unavailable'),
					localize('cleanSlate.agentManager.terminalUnavailableDescription', 'The terminal could not be started for this project.')
				);
			}
		});
	}

	private getRightPaneTerminalSessionKey(): string {
		return this.sidebarViewModel.getActiveSessionId()
			?? this.projectProvider.getWorkspaceEntryKey(this.selectedWorkspaceEntry ?? this.getCurrentWorkspaceEntry());
	}

	private getOrCreateRightPaneTerminal(sessionKey: string): Promise<ITerminalInstance> {
		const existing = this.rightPaneTerminalsBySession.get(sessionKey);
		if (existing && !existing.isDisposed) {
			return Promise.resolve(existing);
		}
		const pending = this.rightPaneTerminalPromisesBySession.get(sessionKey);
		if (pending) {
			return pending;
		}
		const creation = this.getActiveReviewScopeRoots().then(roots => this.terminalService.createTerminal({
			cwd: roots[0],
			config: {
				name: localize('cleanSlate.agentManager.terminalName', 'Agent Manager'),
				hideFromUser: true,
				isFeatureTerminal: true,
				useShellEnvironment: true
			}
		})).then(terminal => {
			if (this.rightPaneTerminalPromisesBySession.get(sessionKey) === creation) {
				this.rightPaneTerminalPromisesBySession.delete(sessionKey);
			}
			if (this._store.isDisposed || this.invalidatedRightPaneTerminalSessionKeys.has(sessionKey)) {
				terminal.dispose();
				return terminal;
			}
			this.rightPaneTerminalsBySession.set(sessionKey, terminal);
			this._register(terminal.onDisposed(() => {
				if (this.rightPaneTerminalsBySession.get(sessionKey) === terminal) {
					this.rightPaneTerminalsBySession.delete(sessionKey);
				}
				if (this.activeRightPaneTerminal === terminal) {
					this.activeRightPaneTerminal = undefined;
				}
			}));
			return terminal;
		}, error => {
			if (this.rightPaneTerminalPromisesBySession.get(sessionKey) === creation) {
				this.rightPaneTerminalPromisesBySession.delete(sessionKey);
			}
			throw error;
		});
		this.rightPaneTerminalPromisesBySession.set(sessionKey, creation);
		return creation;
	}

	private deactivateRightPaneTerminal(): void {
		this.terminalPaneRenderRequest++;
		this.terminalPaneContainer = undefined;
		if (!this.activeRightPaneTerminal) {
			return;
		}
		this.activeRightPaneTerminal.setVisible(false);
		this.activeRightPaneTerminal.detachFromElement();
		this.activeRightPaneTerminal = undefined;
	}

	private layoutTerminalPane(): void {
		if (!this.rightPaneVisible || this.rightPaneActiveTab !== 'terminal' || !this.activeRightPaneTerminal || !this.terminalPaneContainer?.isConnected) {
			return;
		}
		const rect = this.terminalPaneContainer.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) {
			return;
		}
		this.activeRightPaneTerminal.layout({ width: rect.width, height: rect.height });
	}

	private observeBrowserPaneViewport(viewport: HTMLElement): void {
		const ResizeObserverCtor = (this.targetWindow as Window & {
			ResizeObserver?: new (callback: () => void) => { observe(target: Element): void; disconnect(): void };
		}).ResizeObserver;
		if (typeof ResizeObserverCtor === 'function') {
			const resizeObserver = new ResizeObserverCtor(() => this.scheduleBrowserPaneLayout());
			resizeObserver.observe(viewport);
			this.rightPaneMarkdownDisposables.add(toDisposable(() => resizeObserver.disconnect()));
		}
		if (this.root) {
			this.rightPaneMarkdownDisposables.add(dom.addDisposableListener(this.root, 'transitionend', event => {
				const propertyName = (event as TransitionEvent).propertyName;
				if (propertyName === 'grid-template-columns' || propertyName === 'transform' || propertyName === 'opacity') {
					this.scheduleBrowserPaneLayout();
				}
			}));
		}
	}

	private toggleBrowserAnnotation(): void {
		const annotationActive = this.latestBrowserState?.annotationActive ?? false;
		this.runBrowserPaneAction(
			annotationActive ? 'stop annotation' : 'start annotation',
			async () => {
				const surface = this.getActiveAgentManagerBrowserSurface();
				if (annotationActive) {
					const nextState = await this.browserAutomationService.stopAnnotation(surface);
					this.updateAnnotationReferences(nextState.annotations);
					return nextState;
				}
				return this.browserAutomationService.startAnnotation(surface);
			}
		);
	}

	private showBrowserActions(anchor: HTMLElement): void {
		if (!this.latestBrowserState) {
			return;
		}
		const surface = this.getActiveAgentManagerBrowserSurface();
		const annotationActive = this.latestBrowserState.annotationActive;
		const hasAnnotations = this.browserAutomationService.listCachedAnnotations(surface).length > 0;
		this.contextMenuService.showContextMenu({
			getAnchor: () => anchor,
			getActions: () => [
				new Action(
					'cleanSlate.agentManager.browser.toggleAnnotation',
					annotationActive
						? localize('cleanSlate.agentManager.browserStopAnnotating', 'Stop Annotating')
						: localize('cleanSlate.agentManager.browserAnnotatePage', 'Annotate Page'),
					ThemeIcon.asClassName(Codicon.add),
					true,
					() => this.toggleBrowserAnnotation()
				),
				new Action(
					'cleanSlate.agentManager.browser.reload',
					localize('cleanSlate.agentManager.browserReload', 'Reload'),
					ThemeIcon.asClassName(Codicon.refresh),
					true,
					() => this.runBrowserPaneAction('reload', () => this.browserAutomationService.reload(surface))
				),
				new Action(
					'cleanSlate.agentManager.browser.clearAnnotations',
					localize('cleanSlate.agentManager.browserClearAnnotations', 'Clear Annotations'),
					ThemeIcon.asClassName(Codicon.clearAll),
					hasAnnotations,
					() => this.runBrowserPaneAction('clear annotations', () => this.browserAutomationService.clearAnnotations(surface))
				)
			]
		});
	}

	private runBrowserPaneAction(source: string, action: () => Promise<ICleanSlateBrowserState | undefined>): void {
		void action()
			.then(state => {
				if (state) {
					this.openBrowserInRightPane(state);
				}
			})
			.catch(error => this.handleBrowserPaneActionError(source, error));
	}

	private handleBrowserPaneActionError(source: string, error: unknown): void {
		const message = error instanceof Error && error.message ? error.message : String(error);
		console.warn(`[CleanSlateAgentWorkspaceOverlay] Browser ${source} failed:`, error);
		this.notificationService.warn(localize('cleanSlate.agentManager.browserActionFailed', 'Browser action failed: {0}', message));
	}

	private renderArtifactInRightPane(artifact: IArtifact | undefined): void {
		if (!this.rightPaneBody || !this.rightPaneTitle) {
			return;
		}
		this.rightPaneMarkdownDisposables.clear();
		this.deactivateRightPaneTerminal();
		this.browserPaneActive = false;
		this.browserPaneViewport = undefined;
		void this.browserAutomationService.setOpenBrowserVisible(false, this.getActiveAgentManagerBrowserSurface());
		this.rightPaneView.renderArtifact(
			this.rightPaneBody,
			this.rightPaneTitle,
			artifact,
			value => this.getArtifactKindLabel(value),
			value => this.getArtifactFilename(value),
			this.rightPaneMarkdownDisposables
		);
	}

	private getRightPaneTabForArtifact(artifact: IArtifact): CleanSlateAgentManagerArtifactKind {
		return artifact.type === 'implementation_plan' ? 'plan' : 'notes';
	}

	private getLatestRightPaneArtifact(): IArtifact | undefined {
		const artifacts = [
			this.getCachedRightPaneArtifact('plan') ?? this.getLatestArtifactByTypeForActiveSession('implementation_plan'),
			this.getCachedRightPaneArtifact('notes') ?? this.getLatestNotesArtifact()
		].filter((artifact): artifact is IArtifact => !!artifact);
		return artifacts.sort((a, b) => b.timestamp - a.timestamp)[0];
	}

	private getLatestNotesArtifact(): IArtifact | undefined {
		const artifacts = [
			this.getLatestArtifactByTypeForActiveSession('analysis'),
			this.getLatestArtifactByTypeForActiveSession('walkthrough')
		].filter((artifact): artifact is IArtifact => !!artifact);
		return artifacts.sort((a, b) => b.timestamp - a.timestamp)[0];
	}

	private getLatestArtifactByTypeForActiveSession(type: string): IArtifact | undefined {
		const activeSessionId = this.sidebarViewModel.getActiveSessionId();
		if (!activeSessionId) {
			return undefined;
		}
		return this.artifactService
			.getArtifactsByType(type, { sessionId: activeSessionId })
			.sort((a, b) => b.timestamp - a.timestamp)[0];
	}

	private getCachedRightPaneArtifact(tab: CleanSlateAgentManagerArtifactKind): IArtifact | undefined {
		const artifact = this.rightPaneArtifacts.get(tab);
		return artifact && this.isArtifactForActiveSession(artifact) ? artifact : undefined;
	}

	private isArtifactForActiveSession(artifact: IArtifact): boolean {
		const activeSessionId = this.sidebarViewModel.getActiveSessionId();
		const artifactSessionId = this.getArtifactSessionId(artifact);
		return !!activeSessionId && artifactSessionId === activeSessionId;
	}

	private getArtifactSessionId(artifact: IArtifact): string | undefined {
		const value = artifact.metadata && typeof artifact.metadata === 'object' ? artifact.metadata.sessionId : undefined;
		return typeof value === 'string' && value.length > 0 ? value : undefined;
	}

	private getArtifactKindLabel(artifact: IArtifact): string {
		if (artifact.type === 'implementation_plan') {
			return localize('cleanSlate.agentManager.implementationPlan', 'Implementation Plan');
		}
		if (artifact.type === 'walkthrough') {
			return localize('cleanSlate.agentManager.walkthrough', 'Walkthrough');
		}
		return localize('cleanSlate.agentManager.analysis', 'Analysis');
	}

	private getArtifactFilename(artifact: IArtifact): string {
		const filename = typeof artifact.metadata?.filename === 'string'
			? artifact.metadata.filename.trim().replace(/^\/+/, '')
			: '';
		if (filename) {
			return filename;
		}
		if (artifact.type === 'analysis') {
			return 'analysis.md';
		}
		if (artifact.type === 'walkthrough') {
			return 'walkthrough.md';
		}
		return 'implementation_plan.md';
	}

	private bindBottomHeight(bottomHost: HTMLElement): void {
		const update = () => {
			const height = Math.max(96, Math.ceil(bottomHost.getBoundingClientRect().height));
			this.chatSurface.style.setProperty('--cleanSlate-agent-manager-bottom-height', `${height}px`);
		};
		const win = dom.getWindow(bottomHost);
		const ResizeObserverCtor = win.ResizeObserver;
		if (typeof ResizeObserverCtor === 'function') {
			const resizeObserver = new ResizeObserverCtor(update);
			resizeObserver.observe(bottomHost);
			this.shellDisposables.add({ dispose: () => resizeObserver.disconnect() });
		} else {
			this.shellDisposables.add(dom.addDisposableListener(win, 'resize', update));
		}
		win.requestAnimationFrame(update);
	}

	private startNewChat(entry: ICleanSlateWorkspaceEntry | undefined = this.selectedWorkspaceEntry ?? this.getCurrentWorkspaceEntry()): void {
		this.workspaceSelectionRequest++;
		this.invalidateWorkspaceDataCache();
		this.saveRightPaneStateForActiveSession();
		this.composerDraftController.persistDraft();
		this.selectedWorkspaceEntry = entry;
		this.sidebarViewModel.startNewChat(this.toSessionWorkspaceMetadata(entry));
		this.restoreRightPaneStateForActiveSession();
		this.rememberActiveSessionForWorkspace(entry, this.sidebarViewModel.getActiveSessionId());
		this.composerDraftController.switchToActiveSession(true);
		this.sidebarViewModel.clearPendingImages();
		this.sidebarViewModel.clearPendingSelectionReferences();
		this.renderImagePreviews();
		this.renderSelectionReferences();
		this.transcriptView.clear(true);
		this.planPanelView.clear();
		this.planApprovalView.resetDismissed();
		this.planningQuestionView.clear();
		this.planApprovalView.hide();
		this.commandApprovalView.hide();
		this.composerView.setGenerating(false);
		this.updateComposerWorkspaceLabel();
		this.syncComposerWithCurrentSession();
		this.refreshChrome();
		this.renderSessions();
		this.composerView.focus();
	}

	private async restoreSession(session: ICleanSlateSessionSnapshot, entry?: ICleanSlateWorkspaceEntry): Promise<void> {
		try {
			const persisted = await this.cleanSlateMainService.loadThreadSession(session.id);
			const hydrated = this.sessionMapper.toSessionSnapshot(persisted);
			if (hydrated) {
				session = this.projectProvider.preservePersistedWorkspaceIdentity(session, hydrated);
			}
		} catch (error) {
			if (!this.isMissingMainChannelCall(error, 'loadThreadSession')) {
				console.warn('[CleanSlate] Failed to hydrate Agent Manager session before restore:', error);
			}
		}
		if (this.deletedSessionIds.has(session.id)) {
			return;
		}
		this.workspaceSelectionRequest++;
		this.invalidateWorkspaceDataCache();
		this.saveRightPaneStateForActiveSession();
		this.composerDraftController.persistDraft();
		this.suppressProjectTreeRender = true;
		this.projectTreeRenderRequest++;
		try {
			this.rememberSessions([session]);
			this.selectedWorkspaceEntry = this.projectProvider.getWorkspaceEntryForSession(session, this.workspaceEntries, entry);
			this.rememberActiveSessionForWorkspace(this.selectedWorkspaceEntry, session.id);
			this.sidebarViewModel.archiveCurrentSession();
			this.sidebarViewModel.runWithRestoringSession(() => {
				this.sidebarViewModel.restoreSession(session);
				this.composerDraftController.switchToActiveSession();
				const restoredHistory = this.sidebarViewModel.getTranscriptHistory();
				const fallbackAssistantTurn = session.taskState?.lastAssistantTurn ?? session.threadState?.lastAssistantTurn;
				this.restoreCurrentSessionView(
					restoredHistory.length > 0 ? restoredHistory : (session.transcript?.length ? session.transcript : deriveCleanSlateTranscriptFromHistory(session.history)),
					fallbackAssistantTurn
				);
			});
		} finally {
			this.suppressProjectTreeRender = false;
		}
		this.restoreRightPaneStateForActiveSession();
		this.adoptVisibleIdeBrowserForActiveSessionIfNeeded();
		this.updateComposerWorkspaceLabel();
		this.refreshChrome();
		this.updateProjectTreeActiveState();
		this.composerView.focus();
	}

	private restoreCurrentSessionView(historyOverride?: readonly ICleanSlateTranscriptMessage[], fallbackAssistantContent?: string): void {
		if (!this.transcriptView) {
			return;
		}
		this.planningQuestionView?.clear();
		this.updateReasoningDropdownState();
		this.updatePlanModeState();
		const history = historyOverride ?? this.sidebarViewModel.getTranscriptHistory();
		const assistantFallback = fallbackAssistantContent?.trim() ? fallbackAssistantContent : this.sidebarViewModel.getLastAssistantTurn();
		this.transcriptView.restore(history, assistantFallback);
		this.restorePlanPanelFromHistory(history.length > 0 ? history : this.sidebarViewModel.getRawHistoryReference());
		this.planApprovalView?.resetDismissed();
		this.syncComposerWithCurrentSession();
		this.syncLiveThinkingIndicator();
		this.selectedWorkspaceEntry ??= this.projectProvider.getWorkspaceEntryForSession(this.sidebarViewModel.getCurrentSessionSnapshot(), this.workspaceEntries);
		this.updateComposerWorkspaceLabel();
		this.updateApproveButtonVisibility();
		this.updateCommandApprovalVisibility();
	}

	private syncLiveThinkingIndicator(): void {
		this.transcriptView?.setLiveThinkingIndicator(this.sidebarViewModel.getIsGenerating());
	}

	private restorePlanPanelFromHistory(_history: readonly { role: string; content: string; isInternalState?: boolean; renderPayload?: string }[]): void {
		this.planPanelView?.clear();
		this.hideProgress();
	}

	private handleComposerSubmit(): void {
		if (this.planningQuestionView.isVisible()) {
			const submission = this.planningQuestionView.consumeSubmission();
			if (submission) {
				void this.messageSubmitController.send(submission.message, submission.displayText);
			}
			return;
		}
		if (this.planApprovalView.isVisible()) {
			this.planApprovalView.submit();
			return;
		}
		if (this.commandApprovalView.isVisible()) {
			this.commandApprovalView.submit();
			return;
		}
		void this.messageSubmitController.send();
	}

	private async approvePlan(): Promise<void> {
		if (!this.planApprovalController.canApprove()) {
			return;
		}
		this.planApprovalView.resetDismissed();
		this.planApprovalView.hide();
		this.updatePlaceholder();
		await this.planApprovalController.approve(this, isGenerating => {
			this.composerView?.setGenerating(isGenerating);
			this.updateApproveButtonVisibility();
			this.refreshChrome();
			this.composerDraftController.updateContextWindowUsage();
		});
	}

	private refreshChrome(): void {
		if (!this.root) {
			return;
		}
		const state = this.sidebarViewModel.getState();
		this.titleElement.textContent = this.sidebarViewModel.buildHistoryOverlayData().sessions
			.find(session => session.id === state.runSummary.runId || session.id === this.sidebarViewModel.getActiveSessionId())?.title
			|| state.runSummary.objective
			|| localize('cleanSlate.agentManager.defaultTitle', 'Agent workspace');
		this.hideProgress();
		this.updatePendingEdits();
		this.updateComposerWorkspaceSelectorState();
	}

	private refreshLastAssistantMessageFromHistory(): void {
		const history = this.sidebarViewModel.getHistory();
		if (!this.transcriptView || history.length === 0) {
			return;
		}
		const messages = this.transcriptView.element.querySelectorAll('.cleanSlate-chat-message.cleanSlate');
		const lastMessage = messages[messages.length - 1] as HTMLElement | undefined;
		const lastAssistantMsg = history.filter(message => message.role === 'assistant').at(-1);
		if (!lastMessage || !lastAssistantMsg) {
			return;
		}
		try {
			const lastResponse = normalizeChatResponse(JSON.parse(lastAssistantMsg.content) as ChatResponse);
			this.renderJSONResponse(lastResponse, false, lastMessage);
		} catch {
			// Plain text turns do not carry refreshable task state.
		}
	}

	private hideProgress(): void {
		if (!this.progressList) {
			return;
		}
		dom.clearNode(this.progressList);
		this.progressList.classList.remove('visible');
	}

	private invalidateWorkspaceDataCache(): void {
		this.cachedWorkspaceEntries = undefined;
		this.cachedWorkspaceSessions = undefined;
	}

	private scheduleStartupPaint(): void {
		this.targetWindow.requestAnimationFrame(() => {
			if (!this.root) {
				return;
			}
			this.refreshChrome();
			this.annotationController.start(this.root);
			this.composerView.focus();
		});
	}

	private scheduleStartupHydration(): void {
		const request = ++this.startupHydrationRequest;
		this.targetWindow.requestAnimationFrame(() => {
			void this.runStartupHydration(request);
		});
	}

	private async runStartupHydration(request: number): Promise<void> {
		try {
			await this.renderProjectTree();
			if (request !== this.startupHydrationRequest) {
				return;
			}
			await this.hydrateInitialWorkspaceSession();
			if (request !== this.startupHydrationRequest) {
				return;
			}
			// Hydration can change the active project/session. Wait for the sidebar to
			// render that final state before removing the full-surface loading cover.
			await this.renderProjectTree();
			if (request !== this.startupHydrationRequest) {
				return;
			}
			// Render only after the invoking workspace's session is selected. Restoring
			// before hydration briefly exposed the previous project's transcript.
			this.restoreCurrentSessionView();
			this.adoptVisibleIdeBrowserForActiveSessionIfNeeded();
		} finally {
			if (request === this.startupHydrationRequest) {
				this.hideStartupLoadingState();
			}
		}
	}

	private showStartupLoadingState(): void {
		if (this.startupLoadingVisible || !this.root || !this.startupLoadingOverlay) {
			return;
		}
		this.startupLoadingVisible = true;
		this.startupLoadingView.show(this.root, this.startupLoadingOverlay);
	}

	private hideStartupLoadingState(): void {
		if (this.startupLoadingTimer !== undefined) {
			this.targetWindow.clearTimeout(this.startupLoadingTimer);
			this.startupLoadingTimer = undefined;
		}
		if (!this.startupLoadingVisible && !this.root) {
			return;
		}
		this.startupLoadingVisible = false;
		this.startupLoadingView.hide(this.root, this.startupLoadingOverlay);
	}

	private renderSessions(): void {
		if (this.suppressProjectTreeRender) {
			return;
		}
		void this.renderProjectTree();
	}

	private async renderProjectTree(): Promise<void> {
		if (!this.projectSidebarView) {
			return;
		}
		const request = ++this.projectTreeRenderRequest;
		const baseEntries = this.withSelectedWorkspaceEntry(await this.getWorkspaceEntries());
		const sessions = await this.getWorkspaceSessions(baseEntries);
		if (request !== this.projectTreeRenderRequest) {
			return;
		}
		const entries = this.projectProvider.getWorkspaceEntriesForSessions(baseEntries, sessions);
		this.workspaceEntries = entries;
		// "No project" is always offered as a default destination in the project list,
		// even when a real project is selected and there are no unscoped sessions.
		// It dedupes by the 'no-project' key, and any unscoped sessions attach to it.
		const entriesForGroups = this.projectProvider.mergeWorkspaceEntries([
			...entries,
			this.projectProvider.createNoProjectWorkspaceEntry()
		]);
		const filter = this.searchInput?.value.trim().toLowerCase() ?? '';
		const groups = this.projectProvider.filterProjectThreadGroups(this.projectProvider.buildProjectThreadGroups(entriesForGroups, sessions), filter);
		const activeSessionId = this.sidebarViewModel.getActiveSessionId();
		const activeSessionRunning = this.isRunningSession(this.sidebarViewModel.getCurrentSessionSnapshot());
		const selectedWorkspaceKey = this.projectProvider.getWorkspaceEntryKey(this.selectedWorkspaceEntry ?? this.getCurrentWorkspaceEntry());
		this.projectSidebarView.render({
			groups,
			filter,
			activeSessionId,
			selectedWorkspaceKey,
			getGroupEntry: group => group.entry ?? this.projectProvider.createWorkspaceEntryFromSession(group.sessions[0]),
			getWorkspaceEntryKey: entry => this.projectProvider.getWorkspaceEntryKey(entry),
			isRunningSession: session => session.id === activeSessionId ? activeSessionRunning : this.isRunningSession(session),
			onSelectWorkspace: entry => void this.selectWorkspace(entry),
			onNewChatForWorkspace: entry => this.startNewChat(entry),
			onRestoreSession: (session, entry) => void this.restoreSession(session, entry),
			onDeleteSession: session => this.deleteSession(session),
			onShowProjectActions: (group, anchor) => this.showProjectActions(group, anchor)
		});
	}

	private isRunningSession(session: ICleanSlateSessionSnapshot): boolean {
		return this.sidebarViewModel.isSessionRunning(session.id)
			|| session.isGenerating === true
			|| session.status === 'running';
	}

	private updateProjectTreeActiveState(): void {
		if (!this.projectSidebarView) {
			return;
		}
		const activeSessionId = this.sidebarViewModel.getActiveSessionId();
		const activeSessionRunning = this.isRunningSession(this.sidebarViewModel.getCurrentSessionSnapshot());
		const selectedWorkspaceKey = this.projectProvider.getWorkspaceEntryKey(this.selectedWorkspaceEntry ?? this.getCurrentWorkspaceEntry());
		this.projectSidebarView.updateActiveState(activeSessionId, selectedWorkspaceKey, activeSessionRunning);
	}

	private async getWorkspaceEntries(): Promise<ICleanSlateWorkspaceEntry[]> {
		if (this.cachedWorkspaceEntries) {
			return [...this.cachedWorkspaceEntries];
		}
		const entries: ICleanSlateWorkspaceEntry[] = [];
		const workspace = this.workspaceContextService.getWorkspace();
		for (const folder of workspace.folders) {
			entries.push({
				id: folder.uri.toString(),
				label: folder.name,
				description: folder.uri.fsPath,
				current: true,
				folderUri: folder.uri,
				workspaceId: workspace.id
			});
		}
		try {
			const recentlyOpened = await this.workspacesService.getRecentlyOpened();
			for (const recent of recentlyOpened.workspaces) {
				const folderUri = isRecentFolder(recent) ? recent.folderUri : undefined;
				const workspaceUri = isRecentWorkspace(recent) ? recent.workspace.configPath : undefined;
				const uri = folderUri ?? workspaceUri;
				if (!uri || entries.some(entry => entry.id === uri.toString() || isEqualOrParent(uri, URI.parse(entry.id)))) {
					continue;
				}
				entries.push({
					id: uri.toString(),
					label: recent.label ?? basename(uri),
					description: uri.fsPath || uri.toString(),
					folderUri,
					workspaceUri,
					workspaceId: isRecentWorkspace(recent) ? recent.workspace.id : undefined
				});
			}
		} catch {
			// Recently opened workspaces are non-critical shell context.
		}
		this.cachedWorkspaceEntries = entries;
		return [...entries];
	}

	private async getWorkspaceSessions(entries: readonly ICleanSlateWorkspaceEntry[] = []): Promise<ICleanSlateSessionSnapshot[]> {
		if (this.cachedWorkspaceSessions) {
			return [...this.cachedWorkspaceSessions];
		}
		const result = await this.sessionRepository.load(
			this.withKnownWorkspaceEntries(entries),
			this.sessionCache.values(),
			this.sidebarViewModel.buildHistoryOverlayData().sessions,
			session => this.isDeletedSession(session),
			this.globalThreadSessionsUnavailable
		);
		this.globalThreadSessionsUnavailable = result.globalListingUnavailable;
		this.rememberSessions(result.sessions);
		this.cachedWorkspaceSessions = result.sessions;
		return [...result.sessions];
	}

	private rememberPublishedSession(session: ICleanSlatePersistedSession): void {
		this.invalidateWorkspaceDataCache();
		const snapshot = this.sessionMapper.toSessionSnapshot(session);
		if (!snapshot || this.isDeletedSession(snapshot)) {
			return;
		}
		this.rememberSessions([snapshot]);
		const workspaceEntry = snapshot.id === this.sidebarViewModel.getActiveSessionId()
			? this.projectProvider.getWorkspaceEntryForSession(snapshot, this.workspaceEntries)
			: undefined;
		if (workspaceEntry) {
			this.rememberActiveSessionForWorkspace(workspaceEntry, snapshot.id);
		}
		this.renderSessions();
	}

	private async hydrateInitialWorkspaceSession(): Promise<void> {
		if (this.initialWorkspaceSessionHydrated) {
			return;
		}
		this.initialWorkspaceSessionHydrated = true;

		const request = this.workspaceSelectionRequest;
		const currentSession = this.sidebarViewModel.getCurrentSessionSnapshot();
		const currentEntry = this.selectedWorkspaceEntry ?? this.getCurrentWorkspaceEntry();
		if (this.sessionMapper.hasVisibleSessionContent(currentSession) && this.projectProvider.isSessionInWorkspaceEntry(currentSession, currentEntry)) {
			this.rememberActiveSessionForWorkspace(currentEntry, currentSession.id);
			return;
		}

		const knownEntries = this.workspaceEntries.length ? this.workspaceEntries : await this.getWorkspaceEntries();
		if (request !== this.workspaceSelectionRequest) {
			return;
		}
		const entries = this.projectProvider.containsWorkspaceEntry(knownEntries, currentEntry)
			? knownEntries
			: [...knownEntries, currentEntry];
		const sessions = await this.getWorkspaceSessions(entries);
		if (request !== this.workspaceSelectionRequest) {
			return;
		}

		const activeSession = await this.loadActiveSessionForWorkspaceEntry(currentEntry);
		if (request !== this.workspaceSelectionRequest) {
			return;
		}

		const session = this.projectProvider.getRememberedSessionForWorkspace(sessions, currentEntry, this.activeSessionByWorkspaceKey)
			?? activeSession
			?? this.projectProvider.getMostRecentSessionForWorkspace(sessions, currentEntry);
		if (session) {
			await this.restoreSession(session, currentEntry);
		}
	}

	private rememberSessions(sessions: readonly ICleanSlateSessionSnapshot[]): void {
		for (const session of sessions) {
			if (this.isDeletedSession(session)) {
				continue;
			}
			const existing = this.sessionCache.get(session.id);
			if (!existing || (session.updatedAt ?? session.savedAt ?? 0) >= (existing.updatedAt ?? existing.savedAt ?? 0)) {
				this.sessionCache.set(session.id, session);
			}
		}
	}

	private withSelectedWorkspaceEntry(entries: readonly ICleanSlateWorkspaceEntry[]): ICleanSlateWorkspaceEntry[] {
		return this.projectProvider.mergeWorkspaceEntries([
			...entries,
			...(this.selectedWorkspaceEntry ? [this.selectedWorkspaceEntry] : [])
		]);
	}

	private withKnownWorkspaceEntries(entries: readonly ICleanSlateWorkspaceEntry[]): ICleanSlateWorkspaceEntry[] {
		return this.projectProvider.mergeWorkspaceEntries([
			...entries,
			...this.workspaceEntries,
			...(this.selectedWorkspaceEntry ? [this.selectedWorkspaceEntry] : [])
		]);
	}

	private isMissingMainChannelCall(error: unknown, command: string): boolean {
		const message = error instanceof Error ? error.message : String(error);
		return message.includes(`Call not found: ${command}`);
	}

	private async loadActiveSessionForWorkspaceEntry(entry: ICleanSlateWorkspaceEntry): Promise<ICleanSlateSessionSnapshot | undefined> {
		const active = await this.sessionRepository.loadActive(entry, session => this.isDeletedSession(session));
		if (active) {
			this.rememberSessions([active]);
		}
		return active;
	}

	private getWorkspaceEntryLookupKeys(entry: ICleanSlateWorkspaceEntry): string[] {
		return this.sessionRepository.getWorkspaceEntryLookupKeys(entry);
	}

	private getProjectGroupEntry(group: ICleanSlateProjectThreadGroup): ICleanSlateWorkspaceEntry | undefined {
		return group.entry ?? (group.sessions[0] ? this.projectProvider.createWorkspaceEntryFromSession(group.sessions[0]) : undefined);
	}

	private rememberDeletedProject(entry: ICleanSlateWorkspaceEntry, sessions: readonly ICleanSlateSessionSnapshot[], deletedAt: number): void {
		rememberCleanSlateDeletedProjectCutoff(this.storageService, this.deletedProjectCutoffs, [
			...this.getWorkspaceEntryLookupKeys(entry),
			...sessions.flatMap(session => this.getSessionProjectValues(session))
		], deletedAt);
	}

	private async rememberGlobalClearIfNoKnownSessionsRemain(deletedAt: number): Promise<void> {
		try {
			for (const persisted of await this.cleanSlateMainService.listThreadSessions()) {
				const session = this.sessionMapper.toSessionSnapshot(persisted);
				if (session && !this.isDeletedSession(session)) {
					return;
				}
			}
		} catch {
			return;
		}
		this.deletedBefore = rememberCleanSlateDeletedBefore(this.storageService, deletedAt);
		this.cachedWorkspaceSessions = undefined;
	}

	private isDeletedSession(session: ICleanSlateSessionSnapshot): boolean {
		const sessionTime = session.updatedAt ?? session.savedAt ?? session.createdAt;
		return this.deletedSessionIds.has(session.id)
			|| isCleanSlateSessionDeletedByGlobalCutoff(this.deletedBefore, sessionTime)
			|| isCleanSlateSessionDeletedByProjectCutoff(this.deletedProjectCutoffs, this.getSessionProjectValues(session), sessionTime);
	}

	private getSessionProjectValues(session: ICleanSlateSessionSnapshot): string[] {
		return [
			session.projectRoot,
			session.workDir,
			session.workspaceId,
			session.workspaceName
		].filter((value): value is string => !!value?.trim());
	}

	private async showWorkspaceSelector(anchor: HTMLElement): Promise<void> {
		const root = this.root;
		if (!root || !this.isNewChatActive()) {
			return;
		}
		const entries = await this.getSelectableWorkspaceEntries();
		this.workspacePickerView.show({
			targetWindow: this.targetWindow,
			root,
			anchor,
			entries,
			selectedEntry: this.selectedWorkspaceEntry ?? this.getCurrentWorkspaceEntry(),
			projectProvider: this.projectProvider,
			onSelectWorkspace: entry => this.startNewChat(entry),
			onAddProject: () => void this.addNewProject()
		});
	}

	private hideWorkspaceSelector(): void {
		this.workspacePickerView.hide();
	}

	private async getSelectableWorkspaceEntries(): Promise<ICleanSlateWorkspaceEntry[]> {
		const entries = [...(this.workspaceEntries.length ? this.workspaceEntries : await this.getWorkspaceEntries())];
		const sessions = await this.getWorkspaceSessions(entries);
		for (const session of sessions) {
			const entry = this.projectProvider.createWorkspaceEntryFromSession(session);
			if (entry) {
				entries.push(entry);
			}
		}
		return this.projectProvider.mergeWorkspaceEntries(entries).filter(entry => !this.projectProvider.isNoProjectEntry(entry)).sort((a, b) => {
			if (!!a.current !== !!b.current) {
				return a.current ? -1 : 1;
			}
			return a.label.localeCompare(b.label);
		});
	}

	private async addNewProject(): Promise<void> {
		this.hideWorkspaceSelector();
		const selected = await this.fileDialogService.showOpenDialog({
			title: localize('cleanSlate.agentManager.selectProjectFolder', 'Select project folder'),
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			openLabel: localize('cleanSlate.agentManager.addProject', 'Add Project')
		});
		const folderUri = selected?.[0];
		if (!folderUri) {
			return;
		}

		const entry: ICleanSlateWorkspaceEntry = {
			id: folderUri.toString(),
			label: basename(folderUri),
			description: folderUri.fsPath || folderUri.toString(),
			folderUri
		};
		this.workspaceEntries = this.projectProvider.mergeWorkspaceEntries([...this.workspaceEntries, entry]);
		this.cachedWorkspaceEntries = [...this.workspaceEntries];
		this.startNewChat(entry);
	}

	private async selectWorkspace(entry: ICleanSlateWorkspaceEntry): Promise<void> {
		const request = ++this.workspaceSelectionRequest;
		this.hideWorkspaceSelector();
		this.composerDraftController.persistDraft();
		this.selectedWorkspaceEntry = entry;
		this.updateComposerWorkspaceLabel();
		this.renderSessions();
		this.updateProjectTreeActiveState();

		const knownEntries = this.workspaceEntries.length ? this.workspaceEntries : await this.getWorkspaceEntries();
		if (request !== this.workspaceSelectionRequest) {
			return;
		}
		const entries = this.projectProvider.containsWorkspaceEntry(knownEntries, entry)
			? knownEntries
			: [...knownEntries, entry];
		const sessions = await this.getWorkspaceSessions(entries);
		if (request !== this.workspaceSelectionRequest) {
			return;
		}
		const rememberedSession = this.projectProvider.getRememberedSessionForWorkspace(sessions, entry, this.activeSessionByWorkspaceKey);
		if (rememberedSession) {
			await this.restoreSession(rememberedSession, entry);
			return;
		}

		const activeWorkspaceSession = await this.loadActiveSessionForWorkspaceEntry(entry);
		if (request !== this.workspaceSelectionRequest) {
			return;
		}
		if (activeWorkspaceSession) {
			await this.restoreSession(activeWorkspaceSession, entry);
			return;
		}

		const mostRecentSession = this.projectProvider.getMostRecentSessionForWorkspace(sessions, entry);
		if (mostRecentSession) {
			await this.restoreSession(mostRecentSession, entry);
			return;
		}

		const activeSession = this.sidebarViewModel.getCurrentSessionSnapshot();
		if (!this.projectProvider.isSessionInWorkspaceEntry(activeSession, entry)) {
			this.startNewChat(entry);
			return;
		}

		this.updateProjectTreeActiveState();
		this.updateComposerWorkspaceLabel();
	}

	private rememberActiveSessionForWorkspace(entry: ICleanSlateWorkspaceEntry | undefined, sessionId: string | undefined): void {
		if (!entry || !sessionId) {
			return;
		}
		this.activeSessionByWorkspaceKey.set(this.projectProvider.getWorkspaceEntryKey(entry), sessionId);
	}

	private getSelectedWorkspaceLabel(): string | undefined {
		return this.projectProvider.getWorkspaceEntryLabel(this.selectedWorkspaceEntry ?? this.getCurrentWorkspaceEntry());
	}

	private updateComposerWorkspaceLabel(): void {
		this.composerView?.updateWorkspaceLabel(this.getSelectedWorkspaceLabel());
		this.updateComposerWorkspaceSelectorState();
	}

	private updateComposerWorkspaceSelectorState(): void {
		this.composerView?.setWorkspaceSelectorEnabled(this.isNewChatActive());
	}

	private isNewChatActive(): boolean {
		return !this.sidebarViewModel.getIsGenerating()
			&& !this.sessionMapper.hasVisibleSessionContent(this.sidebarViewModel.getCurrentSessionSnapshot());
	}

	private getCurrentWorkspaceEntry(): ICleanSlateWorkspaceEntry {
		const workspace = this.workspaceContextService.getWorkspace();
		const folder = workspace.folders[0];
		if (folder) {
			return {
				id: folder.uri.toString(),
				label: folder.name,
				description: folder.uri.fsPath,
				current: true,
				folderUri: folder.uri,
				workspaceId: workspace.id
			};
		}
		return {
			...this.projectProvider.createNoProjectWorkspaceEntry(),
			current: true
		};
	}

	private toSessionWorkspaceMetadata(entry: ICleanSlateWorkspaceEntry | undefined): ICleanSlateSessionWorkspaceMetadata {
		const workspaceEntry = entry ?? this.getCurrentWorkspaceEntry();
		const uri = workspaceEntry.folderUri ?? workspaceEntry.workspaceUri;
		const workspaceKey = this.projectProvider.isNoProjectEntry(workspaceEntry)
			? 'no-project'
			: uri?.toString() ?? workspaceEntry.workspaceId ?? workspaceEntry.id;
		const workspaceName = this.projectProvider.getWorkspaceEntryLabel(workspaceEntry);
		if (!uri) {
			return {
				workspaceId: workspaceKey,
				workspaceName
			};
		}
		return {
			workspaceId: workspaceKey,
			projectRoot: uri.toString(),
			workDir: uri.fsPath || workspaceEntry.description,
			workspaceName
		};
	}

	private getSnapshotWorkspaceId(snapshot: ICleanSlateSessionSnapshot): string {
		return snapshot.projectRoot?.trim()
			|| snapshot.workDir?.trim()
			|| snapshot.workspaceId?.trim()
			|| this.projectProvider.getWorkspaceEntryKey(this.selectedWorkspaceEntry ?? this.getCurrentWorkspaceEntry());
	}

	private deleteSession(session: ICleanSlateSessionSnapshot): void {
		void this.deleteSessions([session]);
	}

	private async deleteSessions(sessions: readonly ICleanSlateSessionSnapshot[], projectEntry?: ICleanSlateWorkspaceEntry): Promise<void> {
		if (!sessions.length) {
			if (projectEntry) {
				this.rememberDeletedProject(projectEntry, [], Date.now());
			}
			return;
		}
		this.invalidateWorkspaceDataCache();
		const deletedAt = Date.now();
		if (projectEntry) {
			this.rememberDeletedProject(projectEntry, sessions, deletedAt);
		}
		const activeSessionId = this.sidebarViewModel.getActiveSessionId();
		let deletedActiveSession = false;
		for (const session of sessions) {
			rememberCleanSlateDeletedSessionId(this.storageService, this.deletedSessionIds, session.id);
			this.sessionProvider.markSessionDeleted(session.id);
			if (session.id === activeSessionId) {
				deletedActiveSession = true;
			}
			this.sidebarViewModel.removeArchivedSession(session.id);
			await this.cleanSlateMainService.removeThreadSession(session.id);
			this.composerDraftController.clearDraft(session.id);
			this.rightPaneStateBySession.delete(session.id);
			this.invalidatedRightPaneTerminalSessionKeys.add(session.id);
			this.rightPaneTerminalPromisesBySession.delete(session.id);
			this.rightPaneTerminalsBySession.get(session.id)?.dispose();
			this.rightPaneTerminalsBySession.delete(session.id);
			this.sessionCache.delete(session.id);
			for (const [workspaceKey, activeSessionId] of this.activeSessionByWorkspaceKey) {
				if (activeSessionId === session.id) {
					this.activeSessionByWorkspaceKey.delete(workspaceKey);
				}
			}
		}
		await this.rememberGlobalClearIfNoKnownSessionsRemain(deletedAt);
		if (!deletedActiveSession) {
			this.renderSessions();
			return;
		}
		const reasoningLevel = this.sidebarViewModel.getState().reasoningLevel;
		this.sessionProvider.startNewChat(false, reasoningLevel, this.toSessionWorkspaceMetadata(this.selectedWorkspaceEntry ?? this.getCurrentWorkspaceEntry()));
		this.composerProvider.setActiveSession(this.sessionProvider.getActiveSessionId(), true);
		this.restoreRightPaneStateForActiveSession();
		void this.settingsProvider.updatePlanMode(false);
		this.sidebarViewModel.clearPendingImages();
		this.sidebarViewModel.clearPendingSelectionReferences();
		this.composerDraftController.resetActiveSession();
		this.transcriptView.clear(true);
		this.planPanelView.clear();
		this.planningQuestionView.clear();
		this.planApprovalView.hide();
		this.commandApprovalView.hide();
		this.composerView.setValue('');
		this.composerView.setGenerating(false);
		this.updateComposerWorkspaceLabel();
		this.renderImagePreviews();
		this.renderSelectionReferences();
		this.refreshChrome();
		this.composerView.focus();
	}

	private showProjectActions(group: ICleanSlateProjectThreadGroup, anchor: HTMLElement): void {
		const actions: Action[] = [];
		if (group.sessions.length > 0) {
			actions.push(new Action(
				'cleanSlate.agentManager.deleteProjectChats',
				localize('cleanSlate.agentManager.deleteProjectChats', 'Delete chats'),
				ThemeIcon.asClassName(Codicon.trash),
				true,
				() => this.deleteProjectSessions(group)
			));
		}
		if (group.entry && !group.current && !this.projectProvider.isNoProjectEntry(group.entry)) {
			actions.push(new Action(
				'cleanSlate.agentManager.removeProject',
				localize('cleanSlate.agentManager.removeProject', 'Remove project'),
				ThemeIcon.asClassName(Codicon.close),
				true,
				() => this.removeProject(group)
			));
		}
		if (!actions.length) {
			return;
		}
		this.contextMenuService.showContextMenu({ getAnchor: () => anchor, getActions: () => actions });
	}

	private async deleteProjectSessions(group: ICleanSlateProjectThreadGroup): Promise<void> {
		await this.deleteSessions(group.sessions, this.getProjectGroupEntry(group));
	}

	private async removeProject(group: ICleanSlateProjectThreadGroup): Promise<void> {
		if (!group.entry || this.projectProvider.isNoProjectEntry(group.entry)) {
			return;
		}
		// "Remove project" fully removes the project: delete its chats from storage AND drop it
		// from the recent list. Deleting only the recent entry left the sessions behind, so the
		// project (and its chats) re-derived from the surviving sessions and reappeared.
		await this.deleteSessions(group.sessions, group.entry);
		await this.removeWorkspaceEntry(group.entry);
	}

	private async removeWorkspaceEntry(entry: ICleanSlateWorkspaceEntry | undefined): Promise<void> {
		const uri = entry?.folderUri ?? entry?.workspaceUri;
		if (!uri) {
			return;
		}
		await this.workspacesService.removeRecentlyOpened([uri]);
		// Drop the cached recently-opened entries so the tree re-reads the updated list; otherwise
		// renderProjectTree renders the stale cache and the removed project lingers until the next
		// project switch refreshes it.
		this.invalidateWorkspaceDataCache();
		await this.renderProjectTree();
	}

	private updatePlaceholder(): void {
		const hasAnnotations = this.browserAutomationService.listCachedAnnotations(this.getActiveAgentManagerBrowserSurface()).length > 0;
		const hasSelectionReferences = this.sidebarViewModel.getPendingSelectionReferences().length > 0;
		const placeholder = this.planningQuestionView?.isVisible()
			? this.planningQuestionView.getPlaceholder()
			: this.commandApprovalView?.isVisible()
			? 'Use the command prompt above'
			: this.planApprovalView?.isVisible() && this.planApprovalView.getChoice() === 'revise'
			? 'What should change?'
			: hasSelectionReferences
			? 'Ask about the selected code'
			: hasAnnotations
			? 'Ask for follow-up changes'
			: 'Ask anything';
		this.composerView?.setPlaceholder(placeholder);
	}

	private updateModelDropdownState(): void {
		const state = this.sidebarViewModel.getState().model;
		this.composerView?.updateModel(state.label, state.warning, state.provider, state.model);
	}

	private updateReasoningDropdownState(): void {
		const state = this.sidebarViewModel.getState().settings;
		const reasoningState = this.modelProvider.getReasoningSelectorState();
		const activeOption = reasoningState.options.find(option => option.level === state.reasoningLevel);
		const effectiveLevel = activeOption?.enabled ? state.reasoningLevel : reasoningState.options.find(option => option.enabled)?.level ?? 'none';
		if (effectiveLevel !== state.reasoningLevel) {
			void this.sidebarViewModel.updateReasoningLevel(effectiveLevel);
		}
		this.composerView?.updateReasoning(formatCleanSlateReasoningLevel(effectiveLevel));
	}

	private updatePlanModeState(): void {
		this.composerView?.updatePlanMode(this.sidebarViewModel.getState().settings.planMode);
	}

	private updateEditModeState(): void {
		this.composerView?.updateEditMode(this.sidebarViewModel.getState().settings.editMode);
	}

	private syncComposerWithCurrentSession(): void {
		this.composerDraftController.switchToActiveSession();
		this.composerView?.setGenerating(this.sidebarViewModel.getIsGenerating());
		this.updateReasoningDropdownState();
		this.updatePlanModeState();
		this.updateEditModeState();
		this.updateModelDropdownState();
		this.composerDraftController.updateContextWindowUsage();
	}

	private updateApproveButtonVisibility(): void {
		if (!this.planApprovalView) {
			return;
		}
		const shouldShow = this.planApprovalController.shouldShow(this.planApprovalView.isDismissed(), this.planningQuestionView.isVisible()) && !this.sidebarViewModel.hasPendingCommandApproval();
		const becameVisible = this.planApprovalView.updateVisibility(shouldShow);
		if (becameVisible) {
			this.scrollToBottom();
		}
	}

	private updateCommandApprovalVisibility(): void {
		if (!this.commandApprovalView) {
			return;
		}
		const pendingApproval = this.sidebarViewModel.getPendingCommandApproval();
		const becameVisible = this.commandApprovalView.update(pendingApproval);
		this.composerView?.setCommandApprovalPending(!!pendingApproval);
		this.updatePlaceholder();
		if (becameVisible) {
			this.scrollToBottom();
		}
	}

	private renderImagePreviews(): void {
		this.composerView?.renderImagePreviews([...this.sidebarViewModel.getPendingImages()]);
	}

	private renderSelectionReferences(): void {
		this.composerView?.updateSelectionReferences([...this.sidebarViewModel.getPendingSelectionReferences()]);
		this.updatePlaceholder();
	}

	private updateAnnotationReferences(annotations: readonly ICleanSlateBrowserAnnotation[]): void {
		this.annotationController.update(annotations);
	}

	private updatePendingEdits(): void {
		this.pendingEditsBarView?.render(this.sidebarViewModel.getPendingEditsInfo());
		if (this.rightPaneVisible && this.rightPaneActiveTab === 'review') {
			this.renderReviewInRightPane();
		}
	}

	private updateIndexingState(): void {
		this.root?.classList.toggle('is-indexing', this.indexService.isIndexing);
	}

	private getCurrentEditorSelectionReference(): ICleanSlateEditorSelectionReference | undefined {
		const candidates = [this.codeEditorService.getFocusedCodeEditor(), this.codeEditorService.getActiveCodeEditor(), ...this.codeEditorService.listCodeEditors()];
		const seen = new Set<string>();
		for (const editor of candidates) {
			if (!editor || seen.has(editor.getId()) || !editor.hasModel()) {
				continue;
			}
			seen.add(editor.getId());
			const reference = this.createSelectionReference(editor);
			if (reference) {
				return reference;
			}
		}
		return undefined;
	}

	private createSelectionReference(editor: ICodeEditor): ICleanSlateEditorSelectionReference | undefined {
		const model = editor.getModel();
		const selection = editor.getSelection();
		if (!model || !this.isResourceInActiveThreadWorkspace(model.uri) || !selection || selection.isEmpty()) {
			return undefined;
		}
		const selectedText = model.getValueInRange(selection);
		if (selectedText.trim().length === 0) {
			return undefined;
		}
		return {
			uri: model.uri,
			languageId: model.getLanguageId(),
			selectedText,
			modelVersionId: model.getVersionId(),
			range: {
				startLineNumber: selection.startLineNumber,
				startColumn: selection.startColumn,
				endLineNumber: selection.endLineNumber,
				endColumn: selection.endColumn
			}
		};
	}

	private isResourceInActiveThreadWorkspace(resource: URI): boolean {
		const target = this.getActiveWorkspaceOpenTarget();
		if (!target) {
			return false;
		}
		if ('folderUri' in target) {
			return isEqualOrParent(resource, target.folderUri);
		}
		if (!this.isOpenTargetCurrentWorkspace(target)) {
			// Resolving a different .code-workspace file is asynchronous. Implicit
			// editor context must fail closed rather than attach the current IDE file.
			return false;
		}
		return this.workspaceContextService.getWorkspace().folders.some(folder => isEqualOrParent(resource, folder.uri));
	}

	addMessage(text: string, role: 'user' | 'cleanSlate', images?: string[]): HTMLElement {
		return this.transcriptView.addMessage(text, role, images);
	}

	addUserSelectionMessage(display: CleanSlateUserSelectionDisplay, images?: string[]): HTMLElement {
		return this.transcriptView.addUserSelectionMessage(display, images);
	}

	addSystemConfirmation(title: string, message: string, icon: string = 'check'): HTMLElement {
		return this.transcriptView.addSystemConfirmation(title, message, icon);
	}

	showTransportRetry(status: ICleanSlateTransportStatus): void {
		this.transcriptView.showTransportRetry(status);
	}

	clearTransportRetry(): void {
		this.transcriptView.clearTransportRetry();
	}

	addModelTerminated(message: string, onContinue: () => void): HTMLElement {
		return this.transcriptView.addModelTerminated(message, onContinue);
	}

	removeStreamingPlaceholders(): void {
		this.transcriptView.removeStreamingPlaceholders();
	}

	scrollToBottom(): void {
		this.transcriptView.scrollToBottom();
	}

	renderJSONResponse(data: ChatResponse, isStreaming: boolean, targetMessage?: HTMLElement): void {
		const renderData = isStreaming ? data : toPersistableCleanSlateTranscriptPayload(normalizeChatResponse(data), false);
		this.transcriptView.renderJSONResponse(renderData, isStreaming, targetMessage);
		this.refreshChrome();
	}

	findTranscriptMessageElement(transcriptId: string): HTMLElement | undefined {
		return this.transcriptView.element.querySelector<HTMLElement>(`[data-clean-slate-transcript-id="${transcriptId}"]`) ?? undefined;
	}
}
