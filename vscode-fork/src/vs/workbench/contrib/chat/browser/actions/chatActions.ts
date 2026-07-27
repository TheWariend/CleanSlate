/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { IRange } from '../../../../../editor/common/core/range.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize, localize2 } from '../../../../../nls.js';
import { Action2, ICommandPaletteOptions, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ChatContextKeys } from '../../common/actions/chatContextKeys.js';
import { ChatConfiguration, ChatModeKind } from '../../common/constants.js';
import { IChatModel } from '../../common/model/chatModel.js';
import { ChatMode, IChatMode } from '../../common/chatModes.js';
import { ILanguageModelChatSelector } from '../../common/languageModels.js';
import { IChatAgentResult } from '../../common/participants/chatAgents.js';
import { IChatRequestViewModel, IChatResponseViewModel, isRequestVM } from '../../common/model/chatViewModel.js';
import { IToolData, IToolSet, isToolSet } from '../../common/tools/languageModelToolsService.js';
import { showClearEditingSessionConfirmation } from '../widgetHosts/editor/chatEditorInput.js';
import { ModifiedFileEntryState } from '../../common/editing/chatEditingService.js';

export const CHAT_CATEGORY = localize2('chat.category', 'Chat');

export const ACTION_ID_NEW_CHAT = `workbench.action.chat.newChat`;
export const ACTION_ID_NEW_EDIT_SESSION = `workbench.action.chat.newEditSession`;
export const ACTION_ID_OPEN_CHAT = 'workbench.action.openChat';
export const CHAT_OPEN_ACTION_ID = 'workbench.action.chat.open';
export const CHAT_SETUP_ACTION_ID = 'workbench.action.chat.triggerSetup';
export const CHAT_SETUP_SUPPORT_ANONYMOUS_ACTION_ID = 'workbench.action.chat.triggerSetupSupportAnonymousAction';
const TOGGLE_CHAT_ACTION_ID = 'workbench.action.chat.toggle';


export interface IChatViewOpenOptions {
	/**
	 * The query for chat.
	 */
	query: string;
	/**
	 * Whether the query is partial and will await more input from the user.
	 */
	isPartialQuery?: boolean;
	/**
	 * A list of tools IDs with `canBeReferencedInPrompt` that will be resolved and attached if they exist.
	 */
	toolIds?: string[];
	/**
	 * Any previous chat requests and responses that should be shown in the chat view.
	 */
	previousRequests?: IChatViewOpenRequestEntry[];
	/**
	 * Whether a screenshot of the focused window should be taken and attached
	 */
	attachScreenshot?: boolean;
	/**
	 * A list of file URIs to attach to the chat as context.
	 */
	attachFiles?: (URI | { uri: URI; range: IRange })[];
	/**
	 * A list of source control history item changes to attach to the chat as context.
	 */
	attachHistoryItemChanges?: { uri: URI; historyItemId: string }[];
	/**
	 * A list of source control history item change ranges to attach to the chat as context.
	 */
	attachHistoryItemChangeRanges?: {
		start: { uri: URI; historyItemId: string };
		end: { uri: URI; historyItemId: string };
	}[];
	/**
	 * The mode ID or name to open the chat in.
	 */
	mode?: ChatModeKind | string;

	/**
	 * The language model selector to use for the chat.
	 * An Error will be thrown if there's no match. If there are multiple
	 * matches, the first match will be used.
	 *
	 * Examples:
	 *
	 * ```
	 * {
	 *   id: 'gpt-4o',
	 *   vendor: 'openai'
	 * }
	 * ```
	 *
	 * Use `claude-sonnet-4` from any vendor:
	 *
	 * ```
	 * {
	 *   id: 'claude-sonnet-4',
	 * }
	 * ```
	 */
	modelSelector?: ILanguageModelChatSelector;

	/**
	 * Wait to resolve the command until the chat response reaches a terminal state (complete, error, or pending user confirmation, etc.).
	 */
	blockOnResponse?: boolean;

	/**
	 * A list of tool identifiers to include. When specified alone, only these tools will be enabled.
	 * Identifiers can be tool IDs, tool reference names (`toolReferenceName`),
	 * toolset IDs, or toolset reference names (`referenceName`).
	 * When a toolset identifier matches, all tools in that toolset are included.
	 * Can be combined with `toolsExclude` for fine-grained control.
	 */
	toolsInclude?: string[];

	/**
	 * A list of tool identifiers to exclude. When specified alone, all tools except these will be enabled.
	 * Identifiers can be tool IDs, tool reference names (`toolReferenceName`),
	 * toolset IDs, or toolset reference names (`referenceName`).
	 * When a toolset identifier matches, all tools in that toolset are excluded.
	 * Can be combined with `toolsInclude` - exclusions are applied after inclusions.
	 * Explicit tool references in `toolsInclude` override toolset exclusions,
	 * but explicit tool exclusions always win.
	 */
	toolsExclude?: string[];
}

export interface IChatViewOpenRequestEntry {
	request: string;
	response: string;
}

export const CHAT_CONFIG_MENU_ID = new MenuId('workbench.chat.menu.config');


abstract class OpenChatGlobalAction extends Action2 {
	constructor(overrides: Pick<ICommandPaletteOptions, 'keybinding' | 'title' | 'id' | 'menu'>) {
		super({
			...overrides,
			icon: Codicon.chatSparkle,
			f1: true,
			category: CHAT_CATEGORY,
			precondition: ContextKeyExpr.and(
				ChatContextKeys.Setup.hidden.negate(),
				ChatContextKeys.Setup.disabled.negate()
			)
		});
	}

	override async run(accessor: ServicesAccessor, opts?: string | IChatViewOpenOptions): Promise<IChatAgentResult & { type?: 'confirmation' } | undefined> {
		const commandService = accessor.get(ICommandService);

		// Redirect to CleanSlate openChat command
		await commandService.executeCommand('cleanSlate.openChat');
		return;
	}
}

class PrimaryOpenChatGlobalAction extends OpenChatGlobalAction {
	constructor() {
		super({
			id: CHAT_OPEN_ACTION_ID,
			title: localize2('openChat', "Open Chat"),
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyI,
				mac: {
					primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.KeyI
				}
			},
			menu: [{
				id: MenuId.ChatTitleBarMenu,
				group: 'a_open',
				order: 1
			}]
		});
	}
}

export function getOpenChatActionIdForMode(mode: IChatMode): string {
	return `workbench.action.chat.open${mode.name.get()}`;
}

export abstract class ModeOpenChatGlobalAction extends OpenChatGlobalAction {
	constructor(mode: IChatMode, keybinding?: ICommandPaletteOptions['keybinding']) {
		super({
			id: getOpenChatActionIdForMode(mode),
			title: localize2('openChatMode', "Open Chat ({0})", mode.label.get()),
			keybinding
		});
	}
}

export function registerChatActions() {
	registerAction2(PrimaryOpenChatGlobalAction);
	registerAction2(class extends ModeOpenChatGlobalAction {
		constructor() { super(ChatMode.Ask); }
	});
	registerAction2(class extends ModeOpenChatGlobalAction {
		constructor() {
			super(ChatMode.Agent, {
				when: ContextKeyExpr.has(`config.${ChatConfiguration.AgentEnabled}`),
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyI,
				linux: {
					primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyMod.Shift | KeyCode.KeyI
				}
			},);
		}
	});
	registerAction2(class extends ModeOpenChatGlobalAction {
		constructor() { super(ChatMode.Edit); }
	});

	registerAction2(class ToggleChatAction extends Action2 {
		constructor() {
			super({
				id: TOGGLE_CHAT_ACTION_ID,
				title: localize2('toggleChat', "Toggle Chat"),
				category: CHAT_CATEGORY
			});
		}

		async run(accessor: ServicesAccessor) {
			const commandService = accessor.get(ICommandService);
			return commandService.executeCommand('cleanSlate.openChat');
		}
	});
}

export function stringifyItem(item: IChatRequestViewModel | IChatResponseViewModel, includeName = true): string {
	if (isRequestVM(item)) {
		return (includeName ? `${item.username}: ` : '') + item.messageText;
	} else {
		return (includeName ? `${item.username}: ` : '') + item.response.toString();
	}
}

export interface IToolFilteringOptions {
	allTools: IToolData[];
	allToolSets: IToolSet[];
	toolsInclude?: string[];
	toolsExclude?: string[];
}

export interface IToolFilteringResult {
	enablementMap: Map<IToolData | IToolSet, boolean>;
	unknownIdentifiers: string[];
}

/**
 * Computes the tool enablement map based on include/exclude filters.
 *
 * Resolution algorithm:
 * 1. If `toolsInclude` is specified, start with only those tools/toolsets enabled
 * 2. If `toolsExclude` is specified, remove those tools/toolsets
 * 3. Explicit tool references in `toolsInclude` override toolset exclusions
 * 4. Explicit tool exclusions always win
 * 5. Toolset enablement is calculated based on whether all member tools are enabled
 *
 * @throws Error if filtering results in zero enabled tools
 */
export function computeToolEnablementMap(options: IToolFilteringOptions): IToolFilteringResult {
	const { allTools, allToolSets, toolsInclude, toolsExclude } = options;

	const enablementMap = new Map<IToolData | IToolSet, boolean>();
	const matchedIdentifiers = new Set<string>();

	// Helper to check if a tool matches any identifier (by id or toolReferenceName)
	const toolMatches = (tool: IToolData, identifiers: Set<string>): boolean => {
		if (identifiers.has(tool.id)) {
			matchedIdentifiers.add(tool.id);
			return true;
		}
		if (tool.toolReferenceName && identifiers.has(tool.toolReferenceName)) {
			matchedIdentifiers.add(tool.toolReferenceName);
			return true;
		}
		return false;
	};

	// Helper to check if a toolset matches any identifier (by id or referenceName)
	const toolSetMatches = (toolSet: IToolSet, identifiers: Set<string>): boolean => {
		if (identifiers.has(toolSet.id)) {
			matchedIdentifiers.add(toolSet.id);
			return true;
		}
		if (identifiers.has(toolSet.referenceName)) {
			matchedIdentifiers.add(toolSet.referenceName);
			return true;
		}
		return false;
	};

	// Track which tools are explicitly referenced in toolsInclude
	const explicitlyIncludedTools = new Set<IToolData>();

	// Step 1: Build initial set based on toolsInclude
	if (toolsInclude) {
		const includeSet = new Set(toolsInclude);

		// First, process toolsets - if a toolset matches, enable all its tools
		for (const toolSet of allToolSets) {
			if (toolSetMatches(toolSet, includeSet)) {
				for (const tool of toolSet.getTools()) {
					enablementMap.set(tool, true);
				}
			}
		}

		// Then process individual tools
		for (const tool of allTools) {
			if (toolMatches(tool, includeSet)) {
				enablementMap.set(tool, true);
				explicitlyIncludedTools.add(tool);
			} else if (!enablementMap.has(tool)) {
				enablementMap.set(tool, false);
			}
		}
		// Also process tools from toolsets that may not be in allTools
		for (const toolSet of allToolSets) {
			for (const tool of toolSet.getTools()) {
				if (toolMatches(tool, includeSet)) {
					enablementMap.set(tool, true);
					explicitlyIncludedTools.add(tool);
				} else if (!enablementMap.has(tool)) {
					enablementMap.set(tool, false);
				}
			}
		}
	} else {
		// No toolsInclude specified - start with all tools enabled
		for (const tool of allTools) {
			enablementMap.set(tool, true);
		}
		for (const toolSet of allToolSets) {
			for (const tool of toolSet.getTools()) {
				enablementMap.set(tool, true);
			}
		}
	}

	// Step 2: Remove tools matching toolsExclude
	if (toolsExclude) {
		const excludeSet = new Set(toolsExclude);

		// First, process toolsets - if a toolset matches, disable all its tools
		// (unless explicitly included as individual tools)
		for (const toolSet of allToolSets) {
			if (toolSetMatches(toolSet, excludeSet)) {
				for (const tool of toolSet.getTools()) {
					// Explicit tool reference overrides toolset exclusion
					if (!explicitlyIncludedTools.has(tool)) {
						enablementMap.set(tool, false);
					}
				}
			}
		}

		// Then process individual tools - explicit exclusion always wins
		for (const tool of allTools) {
			if (toolMatches(tool, excludeSet)) {
				enablementMap.set(tool, false);
			}
		}
		for (const toolSet of allToolSets) {
			for (const tool of toolSet.getTools()) {
				if (toolMatches(tool, excludeSet)) {
					enablementMap.set(tool, false);
				}
			}
		}
	}

	// Collect unknown identifiers
	const allIdentifiers = new Set([...(toolsInclude ?? []), ...(toolsExclude ?? [])]);
	const unknownIdentifiers: string[] = [];
	for (const identifier of allIdentifiers) {
		if (!matchedIdentifiers.has(identifier)) {
			unknownIdentifiers.push(identifier);
		}
	}

	// Validate at least one tool is enabled
	const enabledToolCount = Array.from(enablementMap.entries()).filter(([item, enabled]) => enabled && !isToolSet(item)).length;
	if (enabledToolCount === 0) {
		throw new Error('Tool filtering resulted in zero enabled tools. At least one tool must be enabled.');
	}

	// Calculate toolset enablement based on whether all member tools are enabled
	for (const toolSet of allToolSets) {
		const toolSetTools = Array.from(toolSet.getTools());
		const allToolsEnabled = toolSetTools.length > 0 && toolSetTools.every(t => enablementMap.get(t) === true);
		enablementMap.set(toolSet, allToolsEnabled);
	}

	return { enablementMap, unknownIdentifiers };
}


/**
 * Returns whether we can continue clearing/switching chat sessions, false to cancel.
 */
export async function handleCurrentEditingSession(model: IChatModel, phrase: string | undefined, dialogService: IDialogService): Promise<boolean> {
	return showClearEditingSessionConfirmation(model, dialogService, { messageOverride: phrase });
}

/**
 * Returns whether we can switch the agent, based on whether the user had to agree to clear the session, false to cancel.
 */
export async function handleModeSwitch(
	accessor: ServicesAccessor,
	fromMode: ChatModeKind,
	toMode: ChatModeKind,
	requestCount: number,
	model: IChatModel | undefined,
): Promise<false | { needToClearSession: boolean }> {
	if (!model?.editingSession || fromMode === toMode) {
		return { needToClearSession: false };
	}

	const configurationService = accessor.get(IConfigurationService);
	const dialogService = accessor.get(IDialogService);
	const needToClearEdits = (!configurationService.getValue(ChatConfiguration.Edits2Enabled) && (fromMode === ChatModeKind.Edit || toMode === ChatModeKind.Edit)) && requestCount > 0;
	if (needToClearEdits) {
		// If not using edits2 and switching into or out of edit mode, ask to discard the session
		const phrase = localize('switchMode.confirmPhrase', "Switching agents will end your current edit session.");

		const currentEdits = model.editingSession.entries.get();
		const undecidedEdits = currentEdits.filter((edit) => edit.state.get() === ModifiedFileEntryState.Modified);
		if (undecidedEdits.length > 0) {
			if (!await handleCurrentEditingSession(model, phrase, dialogService)) {
				return false;
			}

			return { needToClearSession: true };
		} else {
			const confirmation = await dialogService.confirm({
				title: localize('agent.newSession', "Start new session?"),
				message: localize('agent.newSessionMessage', "Changing the agent will end your current edit session. Would you like to change the agent?"),
				primaryButton: localize('agent.newSession.confirm', "Yes"),
				type: 'info'
			});
			if (!confirmation.confirmed) {
				return false;
			}

			return { needToClearSession: true };
		}
	}

	return { needToClearSession: false };
}

export interface IClearEditingSessionConfirmationOptions {
	titleOverride?: string;
	messageOverride?: string;
	isArchiveAction?: boolean;
}


// --- Chat Submenus in various Components




