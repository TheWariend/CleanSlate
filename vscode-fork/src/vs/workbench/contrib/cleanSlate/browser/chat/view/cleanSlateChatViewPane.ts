/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ViewPane } from '../../../../../browser/parts/views/viewPane.js';
import { IViewletViewOptions } from '../../../../../browser/parts/views/viewsViewlet.js';
import { IKeybindingService } from '../../../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService, IContextViewService } from '../../../../../../platform/contextview/browser/contextView.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../../../common/views.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../../../platform/theme/common/themeService.js';
import { ITelemetryService } from '../../../../../../platform/telemetry/common/telemetry.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { IAccessibleViewInformationService } from '../../../../../services/accessibility/common/accessibleViewInformationService.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { ICodeEditorService } from '../../../../../../editor/browser/services/codeEditorService.js';
import type { ICodeEditor } from '../../../../../../editor/browser/editorBrowser.js';
import { CLEANSLATE_FALLBACK_CONTEXT_WINDOW_TOKENS, formatCleanSlateReasoningLevel, ICleanSlateService, ICleanSlateEditCodeService, ICleanSlateContextService, ICleanSlateConfigurationService, ICleanSlateIndexService, ICleanSlateArtifactService, ICleanSlateMainService, type IArtifact, type ICleanSlateTransportStatus } from '../../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import * as dom from '../../../../../../base/browser/dom.js';
import { IMarkerService } from '../../../../../../platform/markers/common/markers.js';
import { IStorageService } from '../../../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../../../services/editor/common/editorService.js';
import { ISCMService } from '../../../../scm/common/scm.js';
import { ICleanSlateBrowserAutomationService, type ICleanSlateBrowserAnnotation } from '../../core/cleanSlateBrowserAutomationService.js';
import { ICleanSlateCommandApprovalService } from '../../core/cleanSlateCommandApprovalService.js';

import type { ChatResponse, IResponseRenderer } from '../runtime/cleanSlateChatController.js';
import type { CleanSlateUserSelectionDisplay } from '../types/cleanSlateChatTypes.js';
import { normalizeChatResponse } from '../runtime/cleanSlateChatResponseNormalizer.js';
import { toPersistableCleanSlateTranscriptPayload } from '../runtime/cleanSlateTranscriptPersistence.js';
import { CleanSlateChatSessionProvider } from '../providers/cleanSlateChatSessionProvider.js';
import { CleanSlateChatHistoryProvider } from '../providers/cleanSlateChatHistoryProvider.js';
import { CleanSlateChatComposerProvider } from '../providers/cleanSlateChatComposerProvider.js';
import { stringifyCleanSlatePlanningAnswerPayload, type ICleanSlateTranscriptMessage } from '../types/cleanSlateChatSessionTypes.js';
import { CleanSlateTranscriptRenderer } from '../renderers/cleanSlateTranscriptRenderer.js';
import { ensureCleanSlateChatStyles } from '../styles/cleanSlateChatStyles.js';
import { CleanSlateChatSettingsProvider } from '../providers/cleanSlateChatSettingsProvider.js';
import { CleanSlateChatModelProvider } from '../providers/cleanSlateChatModelProvider.js';
import { CleanSlatePendingEditsRenderer } from '../renderers/cleanSlatePendingEditsRenderer.js';
import { CleanSlateReviewRenderer } from '../renderers/cleanSlateReviewRenderer.js';
import { collectSCMReviewChanges, mergeCleanSlateReviewChanges, type ICleanSlateReviewChange } from '../renderers/cleanSlateReviewModel.js';
import { CleanSlateModelSelectorRenderer } from '../renderers/cleanSlateModelSelectorRenderer.js';
import { CleanSlateReasoningSelectorRenderer } from '../renderers/cleanSlateModeSelectorRenderer.js';
import { CleanSlateHistoryOverlayRenderer } from '../renderers/cleanSlateHistoryOverlayRenderer.js';
import type { ICleanSlateEditorSelectionReference } from '../providers/cleanSlateChatComposerProvider.js';
import { CleanSlateChatSidebarViewModel } from '../viewModel/cleanSlateChatSidebarViewModel.js';
import { getLastToDoStepsFromHistory } from '../viewModel/cleanSlateChatViewHelpers.js';
import { CleanSlatePlanApprovalController } from '../viewModel/cleanSlatePlanApprovalController.js';
import { CleanSlateHistoryFlowController } from '../viewModel/cleanSlateHistoryFlowController.js';
import { CleanSlateAnnotationController } from '../viewModel/cleanSlateAnnotationController.js';
import { CleanSlateMessageSubmitController } from '../viewModel/cleanSlateMessageSubmitController.js';
import { CleanSlatePlanPanelView } from './sections/cleanSlatePlanPanelView.js';
import { CleanSlatePlanningQuestionView, type ICleanSlatePlanningQuestionSubmission } from './sections/cleanSlatePlanningQuestionView.js';
import { CleanSlatePlanApprovalView } from './sections/cleanSlatePlanApprovalView.js';
import { CleanSlateCommandApprovalView } from './sections/cleanSlateCommandApprovalView.js';
import { CleanSlatePendingEditsBarView } from './sections/cleanSlatePendingEditsBarView.js';
import { CleanSlateComposerView } from './sections/cleanSlateComposerView.js';
import { CleanSlateTranscriptView } from './sections/cleanSlateTranscriptView.js';
import { CleanSlateChatTitleController } from './sections/cleanSlateChatTitleController.js';
import { openCleanSlateSettingsWindow } from '../../settings/cleanSlateSettingsLauncher.js';
import { openCleanSlateProCheckout } from '../../auth/cleanSlateAuth.contribution.js';

export class CleanSlateChatViewPane extends ViewPane implements IResponseRenderer {
    static readonly ID = 'workbench.view.cleanSlateChat';

    private container!: HTMLElement;
    private loadingOverlay!: HTMLElement;
    private readonly sessionProvider: CleanSlateChatSessionProvider;
    private readonly historyProvider: CleanSlateChatHistoryProvider;
    private readonly composerProvider: CleanSlateChatComposerProvider;
    private readonly settingsProvider: CleanSlateChatSettingsProvider;
    private readonly modelProvider: CleanSlateChatModelProvider;
    private readonly sidebarViewModel: CleanSlateChatSidebarViewModel;
    private readonly transcriptRenderer: CleanSlateTranscriptRenderer;
    private readonly pendingEditsRenderer: CleanSlatePendingEditsRenderer;
    private readonly reviewRenderer = new CleanSlateReviewRenderer();
    private readonly modelSelectorRenderer: CleanSlateModelSelectorRenderer;
    private readonly reasoningSelectorRenderer: CleanSlateReasoningSelectorRenderer;
    private readonly historyOverlayRenderer: CleanSlateHistoryOverlayRenderer;
    private readonly planApprovalController: CleanSlatePlanApprovalController;
    private readonly historyFlowController: CleanSlateHistoryFlowController;
    private readonly annotationController: CleanSlateAnnotationController;
    private readonly messageSubmitController: CleanSlateMessageSubmitController;
    private planPanelView!: CleanSlatePlanPanelView;
    private planningQuestionView!: CleanSlatePlanningQuestionView;
    private planApprovalView!: CleanSlatePlanApprovalView;
    private commandApprovalView!: CleanSlateCommandApprovalView;
    private pendingEditsBarView!: CleanSlatePendingEditsBarView;
    private reviewPanel!: HTMLElement;
    private reviewVisible = false;
    private reviewRenderRequest = 0;
    private composerView!: CleanSlateComposerView;
    private transcriptView!: CleanSlateTranscriptView;
    private readonly titleController: CleanSlateChatTitleController;
    private activeComposerSessionId: string | undefined;
    private readonly composerDrafts = new Map<string, string>();

    constructor(
        options: IViewletViewOptions,
        @IKeybindingService keybindingService: IKeybindingService,
        @IContextMenuService contextMenuService: IContextMenuService,
        @IContextViewService private readonly contextViewService: IContextViewService,
        @IConfigurationService configurationService: IConfigurationService,
        @IContextKeyService contextKeyService: IContextKeyService,
        @IViewDescriptorService viewDescriptorService: IViewDescriptorService,
        @IInstantiationService protected override readonly instantiationService: IInstantiationService,
        @IOpenerService protected override readonly openerService: IOpenerService,
        @IThemeService themeService: IThemeService,
        @ITelemetryService _telemetryService: ITelemetryService,
        @IHoverService hoverService: IHoverService,
        @IAccessibleViewInformationService accessibleViewInformationService: IAccessibleViewInformationService,
        @INotificationService private readonly notificationService: INotificationService,
        @ICleanSlateService private readonly cleanSlateService: ICleanSlateService,
        @ICleanSlateContextService cleanSlateContextService: ICleanSlateContextService,
        @ICodeEditorService private readonly codeEditorService: ICodeEditorService,
        @ICleanSlateEditCodeService private readonly editCodeService: ICleanSlateEditCodeService,
        @ICleanSlateConfigurationService private readonly cleanSlateConfigService: ICleanSlateConfigurationService,
        @ICleanSlateIndexService private readonly indexService: ICleanSlateIndexService,
        @ICleanSlateArtifactService private readonly artifactService: ICleanSlateArtifactService,
        @IMarkerService private readonly markerService: IMarkerService,
        @IFileService private readonly fileService: IFileService,
        @ISCMService private readonly scmService: ISCMService,
        @IStorageService private readonly storageService: IStorageService,
        @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
        @IEditorService private readonly editorService: IEditorService,
        @ICleanSlateBrowserAutomationService private readonly browserAutomationService: ICleanSlateBrowserAutomationService,
        @ICleanSlateMainService private readonly cleanSlateMainService: ICleanSlateMainService,
        @ICleanSlateCommandApprovalService private readonly commandApprovalService: ICleanSlateCommandApprovalService
    ) {
        super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService, accessibleViewInformationService);

        this.historyProvider = new CleanSlateChatHistoryProvider(this.storageService, this.workspaceContextService, this.cleanSlateMainService);
        this.sessionProvider = new CleanSlateChatSessionProvider(
            instantiationService,
            this.codeEditorService,
            this.editCodeService,
            this.notificationService,
            this.storageService,
            this.workspaceContextService,
            cleanSlateContextService,
            this.cleanSlateMainService,
            this.commandApprovalService,
            session => this.historyProvider.upsertArchivedSession(session)
        );
        this.composerProvider = new CleanSlateChatComposerProvider();
        this.settingsProvider = new CleanSlateChatSettingsProvider(this.cleanSlateConfigService);
        this.modelProvider = new CleanSlateChatModelProvider(this.cleanSlateService, this.cleanSlateConfigService);
        this.sidebarViewModel = new CleanSlateChatSidebarViewModel(
            this.sessionProvider,
            this.historyProvider,
            this.composerProvider,
            this.settingsProvider,
            this.modelProvider
        );
        this.transcriptRenderer = instantiationService.createInstance(CleanSlateTranscriptRenderer);
        this.transcriptRenderer.onDidUpdateToDo = (steps) => {
            this.planPanelView?.update(steps);
        };
        this.pendingEditsRenderer = new CleanSlatePendingEditsRenderer(
            this.markerService
        );
        this.modelSelectorRenderer = new CleanSlateModelSelectorRenderer(this.modelProvider, () => {
            void this.openCleanSlateSettings();
        }, () => {
            void openCleanSlateProCheckout(this.openerService, this.notificationService, this.cleanSlateMainService);
        });
        this.reasoningSelectorRenderer = new CleanSlateReasoningSelectorRenderer(this.settingsProvider, this.modelProvider);
        this.historyOverlayRenderer = new CleanSlateHistoryOverlayRenderer(this.contextViewService);
        this.planApprovalController = new CleanSlatePlanApprovalController(this.sidebarViewModel, this.artifactService);
        this.annotationController = new CleanSlateAnnotationController(
            this.browserAutomationService,
            this.notificationService,
            () => this.composerView,
            () => this.updatePlaceholder(),
            'ide'
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
                onUpdateTitle: () => this.updateChatTitle(),
                onAnnotationsChanged: () => {
                    this.updateAnnotationReferences(this.browserAutomationService.listCachedAnnotations('ide'));
                },
                getImplicitSelectionReference: () => this.getCurrentEditorSelectionReference()
            },
            'ide'
        );
        this.historyFlowController = new CleanSlateHistoryFlowController(
            this.sidebarViewModel,
            this.historyOverlayRenderer,
            this.notificationService,
            {
                onBeforeSessionChange: () => this.persistComposerDraft(),
                onSessionRestored: (history, fallbackAssistantContent) => this.restoreCurrentSessionView(history, fallbackAssistantContent),
                onAfterSessionRestored: () => {
                    this.updateGlobalActionsVisibility();
                    this.updateChatTitle();
                },
                onSyntheticCommand: (text) => {
                    void this.sendSyntheticHistoryCommand(text);
                }
            }
        );
        this.titleController = new CleanSlateChatTitleController(
            this.id,
            viewDescriptorService,
            title => this.updateTitle(title)
        );

        // Reactive UI: Listen for task.md changes and update the to do list in the last message
        this._register(this.artifactService.onDidArtifactChange((e: IArtifact) => {
            if (!this.isArtifactForActiveSession(e)) {
                return;
            }
            if (e.type === 'implementation_plan') {
                this.planApprovalView?.resetDismissed();
                this.updateApproveButtonVisibility();
            }

            if (e.id === 'task') {
                // Session isolation: ignore global task.md changes while restoring an archived chat
                if (this.sidebarViewModel.getState().isRestoringSession) {
                    return;
                }
                const history = this.sidebarViewModel.getHistory();
                if (history.length === 0) {
                    return; // Ignore updates if we are in a fresh session with no messages
                }

                const messages = this.transcriptView.element.querySelectorAll('.cleanSlate-chat-message.cleanSlate');
                const lastMessage = messages[messages.length - 1] as HTMLElement;
                if (lastMessage) {
                    const lastAssistantMsg = history.filter(m => m.role === 'assistant').at(-1);
                    if (lastAssistantMsg) {
                        try {
                            const lastResponse = normalizeChatResponse(JSON.parse(lastAssistantMsg.content) as ChatResponse);
                            this.renderJSONResponse(lastResponse, false, lastMessage);
                            // Also sync the plan dropup directly from the latest to_do list
                            if (Array.isArray(lastResponse.to_do) && lastResponse.to_do.length > 0) {
                                this.planPanelView?.update(lastResponse.to_do as string[]);
                            }
                        } catch (e) {
                            // Non-JSON response, ignore
                        }
                    }
                }
            }
        }));
        this._register(this.indexService.onDidStatusChange(() => this.updateLoadingState()));
        this._register(this.sessionProvider.onDidChangeState(() => {
            if (this.sidebarViewModel.consumeExternalActiveSessionRefresh()) {
                this.restoreCurrentSessionView();
            }
            this.syncComposerWithCurrentSession();
            this.updatePlaceholder();
            this.updateChatTitle();
            this.updateApproveButtonVisibility();
            this.updateCommandApprovalVisibility();
        }));
        this._register(this.historyProvider.onDidChangeState(() => this.refreshHistoryOverlay()));
        this._register(this.sessionProvider.onDidPendingEditsChange(() => this.updateGlobalActionsVisibility()));
        this._register(this.scmService.onDidAddRepository(repository => {
            this._register(repository.provider.onDidChangeResources(() => this.updateGlobalActionsVisibility()));
            this.updateGlobalActionsVisibility();
        }));
        this._register(this.scmService.onDidRemoveRepository(() => this.updateGlobalActionsVisibility()));
        for (const repository of this.scmService.repositories) {
            this._register(repository.provider.onDidChangeResources(() => this.updateGlobalActionsVisibility()));
        }
        this._register(this.composerProvider.onDidChangeState(() => {
            this.renderImagePreviews();
            this.renderSelectionReferences();
            this.updateContextWindowUsage();
        }));
        this._register(this.modelProvider.onDidChangeState(() => {
            this.updateModelDropdownState();
            this.updateReasoningDropdownState();
        }));
        this._register(this.settingsProvider.onDidChangeState(() => {
            this.sidebarViewModel.syncExecutionStateFromSettings();
            this.updateReasoningDropdownState();
            this.updatePlanModeState();
            this.updateContextWindowUsage();
        }));
        this._register(this.browserAutomationService.onDidChangeAnnotations(event => {
            if (event.surface === 'ide') {
                this.updateAnnotationReferences(event.annotations);
            }
        }));
        this.updateChatTitle();
        this.updateReasoningDropdownState();
        this.updatePlanModeState();
    }

    override dispose(): void {
        this.annotationController.dispose(this.container);
        super.dispose();
    }

    protected override renderBody(container: HTMLElement): void {
        super.renderBody(container);

        this.container = dom.append(container, dom.$('.cleanSlate-chat-view'));
        this.container.style.height = '100%';
        this.container.style.display = 'flex';
        this.container.style.flexDirection = 'column';

	        this.transcriptView = new CleanSlateTranscriptView(
	            this.container,
	            this.transcriptRenderer,
	            (question) => {
	                this.planningQuestionView.show(question);
	                this.planApprovalView?.hide();
	            }
	        );

        // Loading Overlay (Full Panel)
        this.loadingOverlay = dom.append(this.container, dom.$('.cleanSlate-loading-overlay'));
        const loadingContent = dom.append(this.loadingOverlay, dom.$('.loading-content'));
        dom.append(loadingContent, dom.$('.loading-spinner'));
        const loadingText = dom.append(loadingContent, dom.$('.loading-text'));
        loadingText.textContent = 'Initializing CleanSlate...';
        const loadingSubtext = dom.append(loadingContent, dom.$('.loading-subtext'));
        loadingSubtext.textContent = 'Indexing your workspace for better context';

        // Initial state
        this.updateLoadingState();

        // Inject CSS styles
        ensureCleanSlateChatStyles(this.container);

        // Initial title update
        this.updateChatTitle();

        // Event delegation for interactive elements
        this._register(dom.addDisposableListener(this.transcriptView.element, 'click', (event: MouseEvent) => {
            const target = event.target as HTMLElement;

            // Collapse/expand progress
            if (target.textContent === 'Collapse all' && target.parentElement?.classList.contains('cleanSlate-progress-header')) {
                const list = target.parentElement.nextElementSibling as HTMLElement;
                if (list && list.classList.contains('cleanSlate-progress-list')) {
                    const isHidden = list.style.display === 'none';
                    list.style.display = isHidden ? 'flex' : 'none';
                    target.textContent = isHidden ? 'Collapse all' : 'Expand all';
                }
                return;
            }

            // Review Changes button
            const reviewBtn = target.closest('.cleanSlate-primary-button');
            // Review & Apply button
            if (reviewBtn && reviewBtn.classList.contains('apply-btn')) {
                this.sidebarViewModel.applyLastResponse();
                return;
            }

            // Accept All button
            const acceptBtn = target.closest('.cleanSlate-primary-button.accept-btn');
            if (acceptBtn) {
                this.sidebarViewModel.acceptAll();
                return;
            }

            // Reject All button
            const rejectBtn = target.closest('.cleanSlate-primary-button.reject-btn');
            if (rejectBtn) {
                this.sidebarViewModel.rejectAll();
                return;
            }

        }));

        this.pendingEditsBarView = new CleanSlatePendingEditsBarView(
            this.container,
            this.pendingEditsRenderer,
            () => this.sidebarViewModel.acceptAll(),
            () => this.sidebarViewModel.rejectAll()
        );
        this.reviewPanel = dom.append(this.container, dom.$('.cleanSlate-review-panel'));
        this.reviewPanel.hidden = true;

        this.updateGlobalActionsVisibility();

        // Plan dropup — sits between global actions bar and the chat input
        this.planPanelView = new CleanSlatePlanPanelView(this.container);

	        this.composerView = new CleanSlateComposerView(this.container, {
	            workspaceName: this.workspaceContextService.getWorkspace().folders[0]?.name,
	            mountPanels: (inputBox) => {
	                this.planningQuestionView = new CleanSlatePlanningQuestionView(
                    inputBox,
                    () => this.composerView?.getInputElement(),
                    () => {
                        this.updatePlaceholder();
                        this.updateApproveButtonVisibility();
                    }
                );
                this._register(dom.addDisposableListener(inputBox, 'cleanslate-planning-question-submit', (event: Event) => {
                    const submission = (event as CustomEvent<ICleanSlatePlanningQuestionSubmission>).detail;
                    void this.messageSubmitController.send(submission.message, submission.displayText, {
                        userRenderPayload: stringifyCleanSlatePlanningAnswerPayload(submission.question)
                    });
                }));

                this.planApprovalView = new CleanSlatePlanApprovalView(inputBox, {
                    getInputValue: () => this.composerView?.getValue() ?? '',
                    focusInput: () => this.composerView?.focus(),
                    onApprove: () => {
                        void this.approvePlan();
                    },
                    onRevise: (direction) => {
                        const revisionMessage = /^revise plan\b/i.test(direction)
                            ? direction
                            : `revise plan: ${direction}`;
                        void this.messageSubmitController.send(revisionMessage, direction);
                    },
                    onDidChange: () => this.updatePlaceholder()
                });

                this.commandApprovalView = new CleanSlateCommandApprovalView(inputBox, {
                    focusInput: () => this.composerView?.focus(),
                    onApprove: (blockId) => {
                        this.sidebarViewModel.approveCommand(blockId);
                        this.updateCommandApprovalVisibility();
                    },
                    onApproveForSession: (blockId) => {
                        this.sidebarViewModel.approveCommandForSession(blockId);
                        this.updateCommandApprovalVisibility();
                    },
                    onCancel: (blockId) => {
                        this.sidebarViewModel.rejectCommand(blockId);
                        this.updateCommandApprovalVisibility();
                    },
                    onDidChange: () => this.updatePlaceholder()
                });
            },
            onSubmit: () => this.handleComposerSubmit(),
            onImageAdded: (imageDataUrl) => this.sidebarViewModel.addPendingImage(imageDataUrl),
            onImageRemoved: (index) => this.sidebarViewModel.removePendingImage(index),
            onReasoningSelector: (anchor) => {
                void this.reasoningSelectorRenderer.toggle(this.container, anchor);
            },
            onPlanModeCommand: () => {
                void this.sidebarViewModel.updatePlanMode(true);
            },
            onPlanModeDisabled: () => {
                void this.sidebarViewModel.updatePlanMode(false);
            },
            onModelSelector: (anchor) => {
                void this.modelSelectorRenderer.toggle(this.container, anchor);
            },
            onDeleteAnnotations: (annotations) => {
                void this.annotationController.deleteVisible(annotations);
            },
            onRemoveSelectionReference: (index) => {
                this.sidebarViewModel.removePendingSelectionReference(index);
            },
            onDidInputChange: () => this.handleComposerInputChange(),
            onKeyDown: (event) => {
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
        this.updateModelDropdownState();
        this.updateContextWindowUsage();

        this.updateApproveButtonVisibility();
        this.updateCommandApprovalVisibility();
        this.updatePlaceholder();
        this.updateChatTitle();
        this.updateAnnotationReferences(this.browserAutomationService.listCachedAnnotations('ide'));
        this.renderSelectionReferences();
        this.annotationController.start(this.container);
        this.restoreCurrentSessionView();
        void this.sidebarViewModel.whenReady().then(() => {
            this.restoreCurrentSessionView();
            this.updateGlobalActionsVisibility();
            this.updateChatTitle();
            this.refreshHistoryOverlay();
        });
    }

    private async openCleanSlateSettings(): Promise<void> {
        await openCleanSlateSettingsWindow(this.editorService, this.instantiationService);
    }

    public startNewChat(): void {
        this.persistComposerDraft();
        this.historyFlowController.hide();
        this.sidebarViewModel.startNewChat();
        this.switchComposerDraftToActiveSession(true);
        this.composerView?.setGenerating(false);
        this.sidebarViewModel.clearPendingImages();
        this.sidebarViewModel.clearPendingSelectionReferences();
        this.renderImagePreviews();
        this.renderSelectionReferences();
        this.transcriptView?.clear(true);
        this.updateGlobalActionsVisibility();
        this.planPanelView?.clear();
        this.planApprovalView?.resetDismissed();
        this.planningQuestionView?.clear();
        this.planApprovalView?.hide();
        this.commandApprovalView?.hide();
        this.syncComposerWithCurrentSession();
        this.updatePlaceholder();
        this.updateChatTitle();
        this.updateApproveButtonVisibility();
        this.updateCommandApprovalVisibility();
        this.refreshHistoryOverlay();
        this.composerView?.focus();
    }

    public async openChatHistory(): Promise<void> {
        await this.historyFlowController.open(this.container);
    }

    private restoreCurrentSessionView(
        historyOverride?: readonly ICleanSlateTranscriptMessage[],
        fallbackAssistantContent?: string
    ): void {
        if (!this.transcriptView) {
            return;
        }

        this.planningQuestionView?.clear();

        this.updateReasoningDropdownState();
        this.updatePlanModeState();

        const history = historyOverride ?? this.sidebarViewModel.getTranscriptHistory();
        const assistantFallback = (fallbackAssistantContent && fallbackAssistantContent.trim().length > 0)
            ? fallbackAssistantContent
            : this.sidebarViewModel.getLastAssistantTurn();

        this.transcriptView.restore(history, assistantFallback);

        this.restorePlanPanelFromHistory(history.length > 0 ? history : this.sidebarViewModel.getRawHistoryReference());
        this.planApprovalView?.resetDismissed();
        this.syncComposerWithCurrentSession();
        this.syncLiveThinkingIndicator();
        this.updateApproveButtonVisibility();
        this.updateCommandApprovalVisibility();
    }

    private syncLiveThinkingIndicator(): void {
        this.transcriptView?.setLiveThinkingIndicator(this.sidebarViewModel.getIsGenerating());
    }

    private restorePlanPanelFromHistory(
        history: readonly { role: string; content: string; isInternalState?: boolean; renderPayload?: string }[]
    ): void {
        this.planPanelView?.clear();
        const steps = getLastToDoStepsFromHistory(history);
        if (steps.length > 0) {
            this.planPanelView?.update(steps);
        }
    }

    private async sendSyntheticHistoryCommand(text: string): Promise<void> {
        return this.messageSubmitController.sendSynthetic(text);
    }

    private refreshHistoryOverlay(): void {
        this.historyFlowController.refresh();
    }

    protected override calculateTitle(title: string): string {
        return title;
    }

    public override get singleViewPaneContainerTitle(): string | undefined {
        return this.title;
    }


    private updateChatTitle(): void {
        this.titleController.update(this.sidebarViewModel.getState());
    }

    private isArtifactForActiveSession(artifact: IArtifact): boolean {
        const activeSessionId = this.sidebarViewModel.getActiveSessionId();
        const artifactSessionId = this.getArtifactSessionId(artifact);
        return !artifactSessionId || !activeSessionId || artifactSessionId === activeSessionId;
    }

    private getArtifactSessionId(artifact: IArtifact): string | undefined {
        const value = artifact.metadata && typeof artifact.metadata === 'object' ? artifact.metadata.sessionId : undefined;
        return typeof value === 'string' && value.length > 0 ? value : undefined;
    }

    public async approvePlan(): Promise<void> {
        if (!this.planApprovalController.canApprove()) {
            return;
        }

        this.planApprovalView.resetDismissed();
        this.planApprovalView.hide();
        this.updatePlaceholder();

        await this.planApprovalController.approve(this, (isGenerating: boolean) => {
            this.composerView?.setGenerating(isGenerating);
            this.updateApproveButtonVisibility();
            this.updateChatTitle();
            this.updateContextWindowUsage();
        });
    }

    public acceptAllChanges(): void {
        this.sidebarViewModel.acceptAll();
        this.updateGlobalActionsVisibility();
    }

    public rejectAllChanges(): void {
        this.sidebarViewModel.rejectAll();
        this.updateGlobalActionsVisibility();
    }

    private updatePlaceholder(): void {
        const hasAnnotations = this.browserAutomationService.listCachedAnnotations('ide').length > 0;
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
            : 'Ask anything (⌘L)';
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
        const effectiveLevel = activeOption?.enabled
            ? state.reasoningLevel
            : reasoningState.options.find(option => option.enabled)?.level ?? 'none';
        if (effectiveLevel !== state.reasoningLevel) {
            void this.sidebarViewModel.updateReasoningLevel(effectiveLevel);
        }
        this.composerView?.updateReasoning(formatCleanSlateReasoningLevel(effectiveLevel));
    }

    private updatePlanModeState(): void {
        this.composerView?.updatePlanMode(this.sidebarViewModel.getState().settings.planMode);
    }

    private syncComposerWithCurrentSession(): void {
        this.switchComposerDraftToActiveSession();
        this.composerView?.setGenerating(this.sidebarViewModel.getIsGenerating());
        this.updateReasoningDropdownState();
        this.updatePlanModeState();
        this.updateModelDropdownState();
        this.updateContextWindowUsage();
    }

    private handleComposerInputChange(): void {
        const sessionId = this.activeComposerSessionId ?? this.sidebarViewModel.getActiveSessionId();
        this.activeComposerSessionId = sessionId;
        const value = this.composerView?.getValue() ?? '';
        if (value.length > 0) {
            this.composerDrafts.set(sessionId, value);
        } else {
            this.composerDrafts.delete(sessionId);
        }
        this.updateContextWindowUsage();
    }

    private persistComposerDraft(sessionId: string | undefined = this.activeComposerSessionId): void {
        if (!sessionId || !this.composerView) {
            return;
        }
        const value = this.composerView.getValue();
        if (value.length > 0) {
            this.composerDrafts.set(sessionId, value);
        } else {
            this.composerDrafts.delete(sessionId);
        }
    }

    private switchComposerDraftToActiveSession(forceEmpty = false): void {
        if (!this.composerView) {
            return;
        }

        const nextSessionId = this.sidebarViewModel.getActiveSessionId();
        const previousSessionId = this.activeComposerSessionId;
        if (previousSessionId === nextSessionId && !forceEmpty) {
            return;
        }

        if (previousSessionId && previousSessionId !== nextSessionId) {
            this.persistComposerDraft(previousSessionId);
        }

        this.activeComposerSessionId = nextSessionId;
        if (forceEmpty) {
            this.composerDrafts.delete(nextSessionId);
        }
        this.composerView.setValue(forceEmpty ? '' : this.composerDrafts.get(nextSessionId) ?? '');
    }

    private updateContextWindowUsage(): void {
        const state = this.sidebarViewModel.getState();
        const maxTokens = Math.max(1, state.settings.contextWindow || CLEANSLATE_FALLBACK_CONTEXT_WINDOW_TOKENS);
        const usedTokens = this.estimateCurrentContextTokens();
        this.composerView?.updateContextWindowUsage({
            usedTokens,
            maxTokens,
            percent: (usedTokens / maxTokens) * 100,
            isGenerating: state.isGenerating
        });
    }

    private estimateCurrentContextTokens(): number {
        const history = this.sidebarViewModel.getRawHistoryReference();
        const inputValue = this.composerView?.getValue() ?? '';
        const imageCost = this.sidebarViewModel.getPendingImages().length * 1024;
        const selectionChars = this.sidebarViewModel.getPendingSelectionReferences()
            .reduce((total, reference) => total + this.estimateContextChars(reference.selectedText) + this.estimateContextChars(reference.uri.toString()), 0);
        const charCount = history.reduce((total, message) => {
            return total
                + this.estimateContextChars(message.role)
                + this.estimateContextChars(message.content)
                + this.estimateContextChars(message.renderPayload);
        }, this.estimateContextChars(inputValue) + selectionChars);

        return Math.ceil(charCount / 4) + imageCost;
    }

    private estimateContextChars(value: unknown): number {
        if (typeof value === 'string') {
            return value.length;
        }
        if (Array.isArray(value)) {
            return value.reduce((total, item) => total + this.estimateContextChars(item), 0);
        }
        if (value && typeof value === 'object') {
            try {
                return JSON.stringify(value).length;
            } catch {
                return 0;
            }
        }
        return 0;
    }

    private updateApproveButtonVisibility(): void {
        if (!this.planApprovalView) {
            return;
        }

        const shouldShow = this.shouldShowPlanApprovalPrompt() && !this.sidebarViewModel.hasPendingCommandApproval();
        const becameVisible = this.planApprovalView.updateVisibility(shouldShow);
        if (becameVisible) {
            this.scrollToBottom();
            dom.scheduleAtNextAnimationFrame(dom.getWindow(this.transcriptView.element), () => this.scrollToBottom());
        }
    }

    private updateCommandApprovalVisibility(): void {
        if (!this.commandApprovalView) {
            return;
        }

        const pendingApproval = this.sidebarViewModel.getPendingCommandApproval();
        this.planningQuestionView?.setSuppressed(!!pendingApproval);
        const becameVisible = this.commandApprovalView.update(pendingApproval);
        this.composerView?.setCommandApprovalPending(!!pendingApproval);
        this.updatePlaceholder();
        if (becameVisible) {
            this.scrollToBottom();
            dom.scheduleAtNextAnimationFrame(dom.getWindow(this.transcriptView.element), () => this.scrollToBottom());
        }
    }

    private renderImagePreviews(): void {
        this.composerView?.renderImagePreviews([...this.sidebarViewModel.getPendingImages()]);
    }

    private renderSelectionReferences(): void {
        this.composerView?.updateSelectionReferences([...this.sidebarViewModel.getPendingSelectionReferences()]);
        this.updatePlaceholder();
    }

    public addSelectionToChat(reference: ICleanSlateEditorSelectionReference): void {
        this.sidebarViewModel.addPendingSelectionReference(reference);
        this.renderSelectionReferences();
        this.updateContextWindowUsage();
        this.composerView?.focus();
    }

    private getCurrentEditorSelectionReference(): ICleanSlateEditorSelectionReference | undefined {
        const candidates = [
            this.codeEditorService.getFocusedCodeEditor(),
            this.codeEditorService.getActiveCodeEditor(),
            ...this.codeEditorService.listCodeEditors()
        ];
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
        if (!model || !selection || selection.isEmpty()) {
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

    private updateAnnotationReferences(annotations: readonly ICleanSlateBrowserAnnotation[]): void {
        this.annotationController.update(annotations);
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

    // IResponseRenderer implementation
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
        const renderData = isStreaming
            ? data
            : toPersistableCleanSlateTranscriptPayload(normalizeChatResponse(data), false);
        this.transcriptView.renderJSONResponse(renderData, isStreaming, targetMessage);
    }

    findTranscriptMessageElement(transcriptId: string): HTMLElement | undefined {
        return this.transcriptView.element.querySelector<HTMLElement>(`[data-clean-slate-transcript-id="${transcriptId}"]`) ?? undefined;
    }

    override focus(): void {
        super.focus();
        this.composerView?.focus();
    }

    private updateLoadingState(): void {
        if (!this.loadingOverlay) return;

        if (this.indexService.isIndexing) {
            this.loadingOverlay.classList.add('visible');
        } else {
            this.loadingOverlay.classList.remove('visible');
        }
    }

    private updateGlobalActionsVisibility(): void {
        const cleanSlateEdits = this.sidebarViewModel.getPendingEditsInfo();
        const hasCleanSlateChanges = cleanSlateEdits.some(info => info.added > 0 || info.deleted > 0);
        this.pendingEditsBarView?.render(cleanSlateEdits, {
            showChangeActions: hasCleanSlateChanges
        });
        if (this.reviewVisible) {
            this.renderReviewPanel();
        }
    }

    private renderReviewPanel(changes?: readonly ICleanSlateReviewChange[]): void {
        if (!this.reviewPanel || !this.reviewVisible) {
            return;
        }
        if (changes) {
            this.reviewRenderer.render(this.reviewPanel, changes);
            return;
        }
        const request = ++this.reviewRenderRequest;
        dom.clearNode(this.reviewPanel);
        dom.append(this.reviewPanel, dom.$('.cleanSlate-review-empty')).textContent = 'Loading changes';
        void this.collectReviewChanges().then(nextChanges => {
            if (request !== this.reviewRenderRequest || !this.reviewVisible) {
                return;
            }
            this.reviewRenderer.render(this.reviewPanel, nextChanges);
        }).catch(error => {
            console.warn('[CleanSlateChatViewPane] Failed to render review panel:', error);
            if (request === this.reviewRenderRequest && this.reviewVisible) {
                this.reviewRenderer.render(this.reviewPanel, this.sidebarViewModel.getPendingEditsDiffs());
            }
        });
    }

    private async collectReviewChanges(): Promise<ICleanSlateReviewChange[]> {
        const cleanSlateChanges = this.sidebarViewModel.getPendingEditsDiffs();
        const scmChanges = await collectSCMReviewChanges(this.scmService, this.fileService);
        return mergeCleanSlateReviewChanges(cleanSlateChanges, scmChanges);
    }

    private shouldShowPlanApprovalPrompt(): boolean {
        return this.planApprovalController.shouldShow(
            this.planApprovalView.isDismissed(),
            this.planningQuestionView.isVisible()
        );
    }

}
