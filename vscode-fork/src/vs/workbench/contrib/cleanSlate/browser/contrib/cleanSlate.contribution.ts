/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerThemingParticipant, IColorTheme, ICssStyleCollector, IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { localize } from '../../../../../nls.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry, ConfigurationScope } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { IViewsRegistry, Extensions as ViewExtensions, IViewContainersRegistry, Extensions as ViewContainerExtensions, ViewContainerLocation, IViewDescriptorService } from '../../../../common/views.js';
import { ViewPaneContainer } from '../../../../browser/parts/views/viewPaneContainer.js';
import { CleanSlateChatViewPane } from '../chat/view/cleanSlateChatViewPane.js';
import './cleanSlateEditor.contribution.js';
import '../auth/cleanSlateAuth.contribution.js';
import '../editor/cleanSlateSelectionAddToChat.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IWorkbenchLayoutService } from '../../../../services/layout/browser/layoutService.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../../platform/workspace/common/workspace.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { MenuId, MenuRegistry } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { FileAccess } from '../../../../../base/common/network.js';
import { openCleanSlateSettingsWindow } from '../settings/cleanSlateSettingsLauncher.js';
import { CleanSlateAgentWorkspaceOverlay, CLEANSLATE_AGENT_MANAGER_IDE_HANDOFF_KEY } from '../agentManager/cleanSlateAgentWorkspaceOverlay.js';
import { CLEANSLATE_AGENT_WORKSPACE_EXIT_COMMAND_ID, CLEANSLATE_AGENT_WORKSPACE_OPEN_COMMAND_ID } from '../agentManager/cleanSlateAgentWorkspaceCommands.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../common/contributions.js';
import { mainWindow } from '../../../../../base/browser/window.js';
// View Container ID
export const CLEANSLATE_CONTAINER_ID = 'workbench.view.cleanSlate';
export const CLEANSLATE_VIEW_ID = 'workbench.view.cleanSlateChat';
const CLEANSLATE_NEW_CHAT_COMMAND_ID = 'cleanSlate.chat.newChat';
const CLEANSLATE_HISTORY_COMMAND_ID = 'cleanSlate.chat.history';
const CLEANSLATE_APPROVE_PLAN_COMMAND_ID = 'cleanSlate.approvePlan';
const CLEANSLATE_ACCEPT_ALL_COMMAND_ID = 'cleanSlate.acceptAll';
const CLEANSLATE_REJECT_ALL_COMMAND_ID = 'cleanSlate.rejectAll';
export const CLEANSLATE_SETTINGS_COMMAND_ID = 'cleanSlate.openSettings';
const CLEANSLATE_LOGO_ICON = FileAccess.asBrowserUri('vs/workbench/contrib/cleanSlate/browser/media/logo.png');

let cleanSlateAgentWorkspaceOverlay: CleanSlateAgentWorkspaceOverlay | undefined;

function getCleanSlateAgentWorkspaceOverlay(instantiationService: IInstantiationService): CleanSlateAgentWorkspaceOverlay {
	if (!cleanSlateAgentWorkspaceOverlay) {
		cleanSlateAgentWorkspaceOverlay = instantiationService.createInstance(CleanSlateAgentWorkspaceOverlay);
	}
	return cleanSlateAgentWorkspaceOverlay;
}

// Opaque body-level layer that hides the workbench while it restores, so the
// editor never flashes before the Agent Manager surface mounts. It is created
// as early as possible (BlockStartup) — before createWorkbenchLayout() — so it
// must not touch the layout grid; a plain DOM node on document.body is safe at
// any phase. Dropped once Agent Manager has mounted (or immediately on an IDE
// handoff), with a fail-safe timeout so a bug can never leave the UI covered.
const CLEANSLATE_STARTUP_CURTAIN_ID = 'cleanSlate-startup-curtain';
let startupCurtainFailSafe: ReturnType<typeof setTimeout> | undefined;

function raiseStartupCurtain(): void {
	const doc = mainWindow.document;
	if (!doc.body || doc.getElementById(CLEANSLATE_STARTUP_CURTAIN_ID)) {
		return;
	}
	const curtain = doc.createElement('div');
	curtain.id = CLEANSLATE_STARTUP_CURTAIN_ID;
	curtain.setAttribute('aria-hidden', 'true');
	curtain.style.cssText = [
		'position:fixed', 'inset:0', 'z-index:100000',
		// Match the Agent Manager surface background (editor bg) so the handoff to
		// the overlay's own loading state is seamless; hard fallback is CleanSlate
		// Dark's editor.background for the first frames before theme vars apply.
		'background:var(--vscode-editor-background,#191919)'
	].join(';');
	doc.body.appendChild(curtain);
	startupCurtainFailSafe = setTimeout(dropStartupCurtain, 4000);
}

function dropStartupCurtain(): void {
	if (startupCurtainFailSafe !== undefined) {
		clearTimeout(startupCurtainFailSafe);
		startupCurtainFailSafe = undefined;
	}
	mainWindow.document.getElementById(CLEANSLATE_STARTUP_CURTAIN_ID)?.remove();
}

class CleanSlateStartupCurtainContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cleanSlateStartupCurtain';

	constructor() {
		raiseStartupCurtain();
	}
}

class CleanSlateAgentManagerStartupContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cleanSlateAgentManagerStartup';

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
	) {
		// The IDE button in Agent Manager reloads the window when it targets a
		// different project. That launch must land in the editor, not back in
		// the Agent-Manager-by-default surface.
		if (consumeIdeHandoffMarker(storageService, workspaceContextService)) {
			dropStartupCurtain();
			return;
		}
		try {
			getCleanSlateAgentWorkspaceOverlay(instantiationService).show();
			// Keep the curtain up until the freshly mounted surface has painted,
			// then reveal in one step so there is no visible editor frame.
			mainWindow.requestAnimationFrame(() => mainWindow.requestAnimationFrame(dropStartupCurtain));
		} catch (error) {
			// Never leave the window covered if the overlay fails to mount.
			dropStartupCurtain();
			throw error;
		}
	}
}

function consumeIdeHandoffMarker(storageService: IStorageService, workspaceContextService: IWorkspaceContextService): boolean {
	const raw = storageService.get(CLEANSLATE_AGENT_MANAGER_IDE_HANDOFF_KEY, StorageScope.APPLICATION);
	if (!raw) {
		return false;
	}

	let parsed: { uri?: unknown; at?: unknown; empty?: unknown };
	try {
		parsed = JSON.parse(raw);
	} catch {
		storageService.remove(CLEANSLATE_AGENT_MANAGER_IDE_HANDOFF_KEY, StorageScope.APPLICATION);
		return false;
	}

	const fresh = typeof parsed.at === 'number' && Date.now() - parsed.at < 30_000;
	const workspace = workspaceContextService.getWorkspace();
	// The "No project" IDE button reloads into an empty window; that launch is
	// identified by an empty workbench rather than a matching workspace URI.
	const matchesThisWindow = parsed.empty === true
		? workspaceContextService.getWorkbenchState() === WorkbenchState.EMPTY
		: typeof parsed.uri === 'string' && (
			workspace.configuration?.toString() === parsed.uri
			|| workspace.folders.some(folder => folder.uri.toString() === parsed.uri)
		);

	// Consume on match, expire when stale; a fresh marker for a different
	// workspace is left alone — it belongs to another window's launch.
	if (!fresh || matchesThisWindow) {
		storageService.remove(CLEANSLATE_AGENT_MANAGER_IDE_HANDOFF_KEY, StorageScope.APPLICATION);
	}
	return fresh && matchesThisWindow;
}

// AfterRestored is the earliest phase where the workbench layout grid exists:
// lifecycle reaches `Ready` (BlockStartup/BlockRestore) inside initServices,
// before createWorkbenchLayout() runs, so touching layout parts any earlier
// throws (undefined workbenchGrid). The editor-flash-before-Agent-Manager is
// instead hidden by CleanSlateStartupCurtainContribution below, which raises an
// opaque body-level layer early and drops it once the overlay has mounted.
// Raise the curtain as early as possible so it is up before the workbench
// paints its restored UI. This runs before createWorkbenchLayout(), so it must
// stay purely DOM-based (no layout-grid access).
registerWorkbenchContribution2(
	CleanSlateStartupCurtainContribution.ID,
	CleanSlateStartupCurtainContribution,
	WorkbenchPhase.BlockStartup
);

registerWorkbenchContribution2(
	CleanSlateAgentManagerStartupContribution.ID,
	CleanSlateAgentManagerStartupContribution,
	WorkbenchPhase.AfterRestored
);

const CLEANSLATE_DARK_THEME_ID = 'CleanSlate Dark';
const CLEANSLATE_DARK_MIGRATION_KEY = 'cleanSlate.theme.cleanSlateDarkMigration';

/**
 * One-shot migration: existing installs keep whatever theme they had stored,
 * so the new CleanSlate Dark default alone would only affect fresh installs.
 * Force everyone onto CleanSlate Dark exactly once; after that the user's
 * own theme choice is respected again.
 */
class CleanSlateThemeMigrationContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cleanSlateThemeMigration';

	constructor(
		@IStorageService storageService: IStorageService,
		@IConfigurationService configurationService: IConfigurationService,
		@ILogService logService: ILogService,
	) {
		if (storageService.getBoolean(CLEANSLATE_DARK_MIGRATION_KEY, StorageScope.APPLICATION, false)) {
			return;
		}
		storageService.store(CLEANSLATE_DARK_MIGRATION_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
		if (configurationService.getValue('workbench.colorTheme') !== CLEANSLATE_DARK_THEME_ID) {
			configurationService.updateValue('workbench.colorTheme', CLEANSLATE_DARK_THEME_ID, ConfigurationTarget.USER)
				.catch(error => logService.warn('[CleanSlate] Failed to migrate color theme to CleanSlate Dark:', error));
		}
	}
}

registerWorkbenchContribution2(
	CleanSlateThemeMigrationContribution.ID,
	CleanSlateThemeMigrationContribution,
	WorkbenchPhase.AfterRestored
);

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'cleanSlate',
	title: localize('cleanSlate.configuration.title', 'CleanSlate'),
	type: 'object',
	properties: {
		'cleanSlate.mcpServers': {
			type: ['object', 'array', 'string'],
			default: {},
			scope: ConfigurationScope.APPLICATION,
			description: localize('cleanSlate.mcpServers.description', 'Model Context Protocol servers available to CleanSlate. Supports an object with mcpServers, an array of server entries, or a command string.')
		},
		'cleanSlate.mcpPluginRoots': {
			type: 'array',
			items: { type: 'string' },
			default: [],
			scope: ConfigurationScope.APPLICATION,
			description: localize('cleanSlate.mcpPluginRoots.description', 'Folders CleanSlate scans for plugin .mcp.json files. CleanSlate also scans its user plugin folders and bundled app resource plugin folder.')
		}
	}
});

// Default to formatting only the lines an edit actually touched, not the whole file, when
// formatOnSave is on. 'modificationsIfAvailable' falls back to whole-file formatting when there's
// no source control to diff against, so this never silently stops formatting in non-git folders.
// This is a default only: it registers below user/workspace settings, so an explicit
// 'editor.formatOnSaveMode' choice in settings.json always wins.
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerDefaultConfigurations([{
	overrides: {
		'editor.formatOnSaveMode': 'modificationsIfAvailable'
	}
}]);

class CleanSlateViewPaneContainer extends ViewPaneContainer {
	constructor(
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExtensionService extensionService: IExtensionService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@ILogService logService: ILogService,
	) {
		super(CLEANSLATE_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }, instantiationService, configurationService, layoutService, contextMenuService, telemetryService, extensionService, themeService, storageService, contextService, viewDescriptorService, logService);

		// Listen for chat view title changes to update the container header/tab
		this._register(this.onDidAddViews(views => {
			for (const view of views) {
				if (view.id === CLEANSLATE_VIEW_ID) {
					const chatView = view as any;
					if (chatView.onDidChangeTitleArea) {
						this._register(chatView.onDidChangeTitleArea(() => (this as any).updateTitleArea()));
					}
					this.updateTitleArea();
				}
			}
		}));

		// Check if it's already there
		const chatView = this.getView(CLEANSLATE_VIEW_ID) as any;
		if (chatView && chatView.onDidChangeTitleArea) {
			this._register(chatView.onDidChangeTitleArea(() => (this as any).updateTitleArea()));
		}
		this.updateTitleArea();
	}

	override getTitle(): string {
		const chatView = this.getView(CLEANSLATE_VIEW_ID) as any;
		return chatView?.title || super.getTitle();
	}
}

// Register CleanSlate View Container in Auxiliary Bar (Secondary Sidebar)
const viewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: CLEANSLATE_CONTAINER_ID,
	title: { value: localize('cleanSlate', 'CleanSlate'), original: 'CleanSlate' },
	icon: CLEANSLATE_LOGO_ICON,
	order: 0,
	ctorDescriptor: new SyncDescriptor(CleanSlateViewPaneContainer),
	storageId: CLEANSLATE_CONTAINER_ID,
	hideIfEmpty: false, // Always show the container
	alwaysUseContainerInfo: false
}, ViewContainerLocation.AuxiliaryBar);

// Register CleanSlate Chat View
const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);
viewsRegistry.registerViews([{
	id: CLEANSLATE_VIEW_ID,
	name: { value: localize('cleanSlateChat', 'CleanSlate Chat'), original: 'CleanSlate Chat' },
	containerIcon: CLEANSLATE_LOGO_ICON,
	canToggleVisibility: false,
	canMoveView: false,
	ctorDescriptor: new SyncDescriptor(CleanSlateChatViewPane),
	weight: 100,
	order: 0
}], viewContainer);

// Register Command to open CleanSlate Chat
CommandsRegistry.registerCommand('cleanSlate.openChat', async (accessor: ServicesAccessor) => {
	const viewsService = accessor.get(IViewsService);
	const view = viewsService.getActiveViewWithId<CleanSlateChatViewPane>(CLEANSLATE_VIEW_ID);
	if (view) {
		view.focus();
		return;
	}
	const openedView = await viewsService.openView<CleanSlateChatViewPane>(CLEANSLATE_VIEW_ID, true);
	if (openedView) {
		openedView.focus();
	}
});

CommandsRegistry.registerCommand(CLEANSLATE_NEW_CHAT_COMMAND_ID, async (accessor: ServicesAccessor) => {
	const viewsService = accessor.get(IViewsService);
	const view = viewsService.getActiveViewWithId<CleanSlateChatViewPane>(CLEANSLATE_VIEW_ID)
		?? await viewsService.openView<CleanSlateChatViewPane>(CLEANSLATE_VIEW_ID, true);
	view?.startNewChat();
	view?.focus();
});

CommandsRegistry.registerCommand(CLEANSLATE_HISTORY_COMMAND_ID, async (accessor: ServicesAccessor) => {
	const viewsService = accessor.get(IViewsService);
	const view = viewsService.getActiveViewWithId<CleanSlateChatViewPane>(CLEANSLATE_VIEW_ID)
		?? await viewsService.openView<CleanSlateChatViewPane>(CLEANSLATE_VIEW_ID, true);
	if (!view) {
		return;
	}
	await view.openChatHistory();
	view.focus();
});

CommandsRegistry.registerCommand(CLEANSLATE_APPROVE_PLAN_COMMAND_ID, async (accessor: ServicesAccessor) => {
	const viewsService = accessor.get(IViewsService);
	const view = viewsService.getActiveViewWithId<CleanSlateChatViewPane>(CLEANSLATE_VIEW_ID)
		?? await viewsService.openView<CleanSlateChatViewPane>(CLEANSLATE_VIEW_ID, true);
	if (!view) {
		return;
	}
	await view.approvePlan();
	view.focus();
});

CommandsRegistry.registerCommand(CLEANSLATE_ACCEPT_ALL_COMMAND_ID, async (accessor: ServicesAccessor) => {
	if (cleanSlateAgentWorkspaceOverlay?.isVisible()) {
		cleanSlateAgentWorkspaceOverlay.acceptAllChanges();
		cleanSlateAgentWorkspaceOverlay.focus();
		return;
	}
	const viewsService = accessor.get(IViewsService);
	const view = viewsService.getActiveViewWithId<CleanSlateChatViewPane>(CLEANSLATE_VIEW_ID)
		?? await viewsService.openView<CleanSlateChatViewPane>(CLEANSLATE_VIEW_ID, true);
	view?.acceptAllChanges();
	view?.focus();
});

CommandsRegistry.registerCommand(CLEANSLATE_REJECT_ALL_COMMAND_ID, async (accessor: ServicesAccessor) => {
	if (cleanSlateAgentWorkspaceOverlay?.isVisible()) {
		cleanSlateAgentWorkspaceOverlay.rejectAllChanges();
		cleanSlateAgentWorkspaceOverlay.focus();
		return;
	}
	const viewsService = accessor.get(IViewsService);
	const view = viewsService.getActiveViewWithId<CleanSlateChatViewPane>(CLEANSLATE_VIEW_ID)
		?? await viewsService.openView<CleanSlateChatViewPane>(CLEANSLATE_VIEW_ID, true);
	view?.rejectAllChanges();
	view?.focus();
});

CommandsRegistry.registerCommand(CLEANSLATE_SETTINGS_COMMAND_ID, async (accessor: ServicesAccessor) => {
	const editorService = accessor.get(IEditorService);
	const instantiationService = accessor.get(IInstantiationService);
	await openCleanSlateSettingsWindow(editorService, instantiationService);
});

CommandsRegistry.registerCommand(CLEANSLATE_AGENT_WORKSPACE_OPEN_COMMAND_ID, (accessor: ServicesAccessor) => {
	getCleanSlateAgentWorkspaceOverlay(accessor.get(IInstantiationService)).show();
});

CommandsRegistry.registerCommand(CLEANSLATE_AGENT_WORKSPACE_EXIT_COMMAND_ID, () => {
	cleanSlateAgentWorkspaceOverlay?.hide();
});

MenuRegistry.appendMenuItem(MenuId.ViewTitle, {
	command: {
		id: CLEANSLATE_NEW_CHAT_COMMAND_ID,
		title: localize('cleanSlate.newChat.title', 'New Chat'),
		icon: Codicon.plus
	},
	when: ContextKeyExpr.equals('view', CLEANSLATE_VIEW_ID),
	group: 'navigation',
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.ViewTitle, {
	command: {
		id: CLEANSLATE_HISTORY_COMMAND_ID,
		title: localize('cleanSlate.history.title', 'History'),
		icon: Codicon.history
	},
	when: ContextKeyExpr.equals('view', CLEANSLATE_VIEW_ID),
	group: 'navigation',
	order: 2
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: CLEANSLATE_SETTINGS_COMMAND_ID,
		title: localize('cleanSlate.openSettings.title', 'Open CleanSlate Settings')
	}
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: CLEANSLATE_ACCEPT_ALL_COMMAND_ID,
		title: localize('cleanSlate.acceptAll.title', 'CleanSlate: Accept All Changes')
	}
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: CLEANSLATE_REJECT_ALL_COMMAND_ID,
		title: localize('cleanSlate.rejectAll.title', 'CleanSlate: Reject All Changes')
	}
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: CLEANSLATE_AGENT_WORKSPACE_OPEN_COMMAND_ID,
		title: localize('cleanSlate.openAgentManager.title', 'Open Agent Manager')
	}
});

MenuRegistry.appendMenuItem(MenuId.CommandCenter, {
	command: {
		id: CLEANSLATE_AGENT_WORKSPACE_OPEN_COMMAND_ID,
		title: localize('cleanSlate.agentManager.title', 'Agent Manager'),
		icon: { dark: CLEANSLATE_LOGO_ICON, light: CLEANSLATE_LOGO_ICON }
	},
	order: 102
});

MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
	command: {
		id: CLEANSLATE_SETTINGS_COMMAND_ID,
		title: localize('cleanSlate.globalSettings.title', 'Open CleanSlate Settings'),
		icon: Codicon.gear
	},
	group: '2_configuration',
	order: 2.1
});
registerThemingParticipant((_theme: IColorTheme, collector: ICssStyleCollector) => {
	collector.addRule(`
		.monaco-editor .cleanSlate-preview-original {
			background-color: rgba(255, 0, 0, 0.2);
			text-decoration: line-through;
			opacity: 0.6;
			border-radius: 2px;
		}

		/* New Text (Insertion) - Subtle Green background */
		.monaco-editor .cleanSlate-inline-preview {
			background-color: rgba(0, 255, 0, 0.2);
			color: var(--vscode-editor-foreground);
			border-radius: 2px;
		}

		.cleanSlate-file-analyzed {
			display: flex;
			align-items: center;
			padding: 2px 8px;
			font-size: 11px;
			opacity: 0.9;
			margin: 2px 0;
		}

		.cleanSlate-file-analyzed .analyzed-label {
			color: var(--vscode-descriptionForeground);
			margin-right: 24px;
		}

		.cleanSlate-file-analyzed .file-name {
			font-weight: 500;
			color: var(--vscode-foreground);
		}

		.cleanSlate-file-analyzed .file-range {
			color: var(--vscode-descriptionForeground);
			margin-left: 6px;
			font-family: var(--vscode-editor-font-family);
			font-size: 10px;
		}
	`);
});
