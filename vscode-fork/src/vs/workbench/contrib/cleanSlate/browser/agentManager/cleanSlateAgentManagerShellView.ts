/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { asCSSUrl } from '../../../../../base/browser/cssValue.js';
import * as dom from '../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import type { CleanSlateAuthAccountMetadata } from '../auth/cleanSlateAuth.contribution.js';

export interface ICleanSlateAgentManagerShellBuildOptions {
	readonly integratedTitlebar: boolean;
	readonly titlebarToggleHost?: HTMLElement;
	readonly titlebarHeaderHost?: HTMLElement;
	readonly disposables: DisposableStore;
	readonly isLeftNavVisible: () => boolean;
	readonly onToggleLeftNav: () => void;
	readonly onNewChat: () => void;
	readonly onSearchInput: () => void;
	readonly onOpenSettings: () => void;
	readonly onSignIn: () => Promise<void>;
	readonly onSignOut: () => Promise<void>;
	readonly onExitToEditor: () => void;
	readonly onToggleRightPane: () => void;
}

export interface ICleanSlateAgentManagerShellParts {
	readonly leftNav: HTMLElement;
	readonly leftNavToggleButton?: HTMLButtonElement;
	readonly searchInput: HTMLInputElement;
	readonly workspaceList: HTMLElement;
	readonly navResizeHandle: HTMLElement;
	readonly main: HTMLElement;
	readonly titleElement: HTMLElement;
	readonly updateButton: HTMLButtonElement;
	readonly rightPaneToggleButton: HTMLButtonElement;
	readonly rightResizeHandle: HTMLElement;
	readonly rightPane: HTMLElement;
	readonly startupLoadingOverlay: HTMLElement;
	readonly settingsOverlay: HTMLElement;
	readonly accountButton: HTMLButtonElement;
	readonly accountAvatar: HTMLElement;
	readonly accountName: HTMLElement;
	readonly accountPopover: HTMLElement;
	readonly accountPopoverAvatar: HTMLElement;
	readonly accountPopoverName: HTMLElement;
	readonly accountPopoverEmail: HTMLElement;
	readonly updateMenuItem: HTMLButtonElement;
	readonly updateBadge: HTMLElement;
	readonly accountSignedIn: HTMLElement;
	readonly accountSignedOut: HTMLElement;
}

export class CleanSlateAgentManagerShellView {

	build(root: HTMLElement, options: ICleanSlateAgentManagerShellBuildOptions): ICleanSlateAgentManagerShellParts {
		let leftNavToggleButton: HTMLButtonElement | undefined;
		let titleElement!: HTMLElement;
		let updateButton!: HTMLButtonElement;
		let rightPaneToggleButton!: HTMLButtonElement;

		if (options.integratedTitlebar) {
			const titlebarNav = dom.append(root, dom.$('.cleanSlate-agent-manager-integrated-titlebar-nav'));
			const titlebarMain = dom.append(root, dom.$('.cleanSlate-agent-manager-integrated-titlebar-main'));
			leftNavToggleButton = this.buildTitlebarToggle(titlebarNav, options);
			const header = this.buildHeader(titlebarMain, true, options);
			titleElement = header.titleElement;
			updateButton = header.updateButton;
			rightPaneToggleButton = header.rightPaneToggleButton;
		} else {
			leftNavToggleButton = this.buildTitlebarToggle(options.titlebarToggleHost, options);
		}

		const leftNav = dom.append(root, dom.$('aside.cleanSlate-agent-manager-nav'));
		const navParts = this.buildLeftNav(leftNav, options);
		const navResizeHandle = dom.append(root, dom.$('.cleanSlate-agent-manager-resize-handle'));
		const main = dom.append(root, dom.$('main.cleanSlate-agent-manager-main'));

		if (!options.integratedTitlebar) {
			const header = this.buildHeader(options.titlebarHeaderHost ?? main, Boolean(options.titlebarHeaderHost), options);
			titleElement = header.titleElement;
			updateButton = header.updateButton;
			rightPaneToggleButton = header.rightPaneToggleButton;
		}

		const rightResizeHandle = dom.append(root, dom.$('.cleanSlate-agent-manager-right-resize-handle'));
		const rightPane = dom.append(root, dom.$('aside.cleanSlate-agent-manager-right-pane'));
		const startupLoadingOverlay = dom.append(root, dom.$('.cleanSlate-agent-manager-startup-loading'));
		const settingsOverlay = dom.append(root, dom.$('.cleanSlate-agent-manager-settings-overlay'));

		return {
			leftNav,
			leftNavToggleButton,
			searchInput: navParts.searchInput,
			workspaceList: navParts.workspaceList,
			navResizeHandle,
			main,
			titleElement,
			updateButton,
			rightPaneToggleButton,
			rightResizeHandle,
			rightPane,
			startupLoadingOverlay,
			settingsOverlay,
			accountButton: navParts.accountButton,
			accountAvatar: navParts.accountAvatar,
			accountName: navParts.accountName,
			accountPopover: navParts.accountPopover,
			accountPopoverAvatar: navParts.accountPopoverAvatar,
			accountPopoverName: navParts.accountPopoverName,
			accountPopoverEmail: navParts.accountPopoverEmail,
			updateMenuItem: navParts.updateMenuItem,
			updateBadge: navParts.updateBadge,
			accountSignedIn: navParts.accountSignedIn,
			accountSignedOut: navParts.accountSignedOut
		};
	}

	updateAccount(parts: Pick<ICleanSlateAgentManagerShellParts, 'accountButton' | 'accountAvatar' | 'accountName' | 'accountPopover' | 'accountPopoverAvatar' | 'accountPopoverName' | 'accountPopoverEmail' | 'accountSignedIn' | 'accountSignedOut'>, account: CleanSlateAuthAccountMetadata | undefined): void {
		if (!account) {
			const signInLabel = localize('cleanSlate.agentManager.signIn', 'Sign in');
			parts.accountName.textContent = signInLabel;
			parts.accountButton.title = signInLabel;
			parts.accountButton.setAttribute('aria-label', signInLabel);
			this.updateAccountAvatar(parts.accountAvatar, undefined);
			parts.accountSignedIn.classList.add('hidden');
			parts.accountSignedOut.classList.remove('hidden');
			this.closeAccountPopover(parts);
			return;
		}

		parts.accountSignedIn.classList.remove('hidden');
		parts.accountSignedOut.classList.add('hidden');
		const accountName = account.name || account.email || localize('cleanSlate.agentManager.account', 'Account');
		parts.accountName.textContent = accountName;
		parts.accountButton.title = accountName;
		parts.accountButton.setAttribute('aria-label', accountName);
		parts.accountPopoverName.textContent = accountName;
		parts.accountPopoverEmail.textContent = account.email ?? '';
		parts.accountPopoverEmail.classList.toggle('hidden', !account.email);
		this.updateAccountAvatar(parts.accountAvatar, account.profileImageUrl);
		this.updateAccountAvatar(parts.accountPopoverAvatar, account.profileImageUrl);
	}

	private updateAccountAvatar(avatar: HTMLElement, profileImageUrl: string | undefined): void {
		avatar.className = 'cleanSlate-agent-manager-account-avatar';
		avatar.style.backgroundImage = '';
		if (profileImageUrl) {
			avatar.classList.add('has-image');
			avatar.style.backgroundImage = asCSSUrl(URI.parse(profileImageUrl));
		} else {
			avatar.classList.add(...ThemeIcon.asClassNameArray(Codicon.account));
		}
	}

	private closeAccountPopover(parts: Pick<ICleanSlateAgentManagerShellParts, 'accountButton' | 'accountPopover'>): void {
		parts.accountPopover.classList.add('hidden');
		parts.accountButton.setAttribute('aria-expanded', 'false');
		parts.accountPopover.querySelector('.cleanSlate-agent-manager-account-actions')?.classList.remove('hidden');
		parts.accountPopover.querySelector('.cleanSlate-agent-manager-account-confirm')?.classList.add('hidden');
	}

	private buildTitlebarToggle(host: HTMLElement | undefined, options: ICleanSlateAgentManagerShellBuildOptions): HTMLButtonElement | undefined {
		if (!host) {
			return undefined;
		}
		for (const child of Array.from(host.children)) {
			if (child.classList.contains('cleanSlate-agent-manager-nav-toggle-left') || child.classList.contains('cleanSlate-agent-manager-nav-toggle-inline')) {
				child.remove();
			}
		}
		const selector = options.integratedTitlebar || options.titlebarToggleHost ? 'button.cleanSlate-agent-manager-nav-toggle-inline' : 'button.cleanSlate-agent-manager-nav-toggle-left';
		const navToggle = dom.append(host, dom.$(selector)) as HTMLButtonElement;
		navToggle.type = 'button';
		dom.append(navToggle, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.layoutSidebarLeft)}`));
		navToggle.onclick = options.onToggleLeftNav;
		options.disposables.add(toDisposable(() => navToggle.remove()));
		return navToggle;
	}

	private buildLeftNav(leftNav: HTMLElement, options: ICleanSlateAgentManagerShellBuildOptions): { readonly searchInput: HTMLInputElement; readonly workspaceList: HTMLElement; readonly accountButton: HTMLButtonElement; readonly accountAvatar: HTMLElement; readonly accountName: HTMLElement; readonly accountPopover: HTMLElement; readonly accountPopoverAvatar: HTMLElement; readonly accountPopoverName: HTMLElement; readonly accountPopoverEmail: HTMLElement; readonly accountSignedIn: HTMLElement; readonly accountSignedOut: HTMLElement; readonly updateMenuItem: HTMLButtonElement; readonly updateBadge: HTMLElement } {
		const newChat = dom.append(leftNav, dom.$('button.cleanSlate-agent-manager-nav-button.cleanSlate-agent-manager-new-chat')) as HTMLButtonElement;
		newChat.type = 'button';
		dom.append(newChat, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.edit)}`));
		dom.append(newChat, dom.$('span')).textContent = localize('cleanSlate.agentManager.newChat', 'New chat');
		newChat.onclick = options.onNewChat;

		const search = dom.append(leftNav, dom.$('.cleanSlate-agent-manager-search'));
		dom.append(search, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.search)}`));
		const searchInput = dom.append(search, dom.$('input')) as HTMLInputElement;
		searchInput.type = 'search';
		searchInput.placeholder = localize('cleanSlate.agentManager.search', 'Search');
		searchInput.oninput = options.onSearchInput;

		const workspaceList = dom.append(leftNav, dom.$('.cleanSlate-agent-manager-projects'));

		const footer = dom.append(leftNav, dom.$('.cleanSlate-agent-manager-footer'));
		const accountPopover = dom.append(footer, dom.$('.cleanSlate-agent-manager-account-popover.hidden'));
		accountPopover.setAttribute('role', 'dialog');
		accountPopover.setAttribute('aria-label', localize('cleanSlate.agentManager.accountDetails', 'Account details'));
		const accountSignedIn = dom.append(accountPopover, dom.$('.cleanSlate-agent-manager-account-signed-in.hidden'));
		const accountSummary = dom.append(accountSignedIn, dom.$('.cleanSlate-agent-manager-account-summary'));
		const accountPopoverAvatar = dom.append(accountSummary, dom.$('span.cleanSlate-agent-manager-account-avatar'));
		const accountIdentity = dom.append(accountSummary, dom.$('.cleanSlate-agent-manager-account-identity'));
		const accountPopoverName = dom.append(accountIdentity, dom.$('.cleanSlate-agent-manager-account-popover-name'));
		const accountPopoverEmail = dom.append(accountIdentity, dom.$('.cleanSlate-agent-manager-account-email'));
		const accountActions = dom.append(accountSignedIn, dom.$('.cleanSlate-agent-manager-account-actions'));
		const signOut = dom.append(accountActions, dom.$('button.cleanSlate-agent-manager-account-action')) as HTMLButtonElement;
		signOut.type = 'button';
		dom.append(signOut, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.signOut)}`));
		dom.append(signOut, dom.$('span')).textContent = localize('cleanSlate.agentManager.signOut', 'Sign out');
		const signOutConfirmation = dom.append(accountSignedIn, dom.$('.cleanSlate-agent-manager-account-confirm.hidden'));
		dom.append(signOutConfirmation, dom.$('span')).textContent = localize('cleanSlate.agentManager.signOutConfirm', 'Sign out of CleanSlate?');
		const confirmActions = dom.append(signOutConfirmation, dom.$('.cleanSlate-agent-manager-account-confirm-actions'));
		const cancelSignOut = dom.append(confirmActions, dom.$('button')) as HTMLButtonElement;
		cancelSignOut.type = 'button';
		cancelSignOut.textContent = localize('cleanSlate.agentManager.cancelSignOut', 'Cancel');
		const confirmSignOut = dom.append(confirmActions, dom.$('button.primary')) as HTMLButtonElement;
		confirmSignOut.type = 'button';
		confirmSignOut.textContent = localize('cleanSlate.agentManager.confirmSignOut', 'Sign out');
		const accountSignedOut = dom.append(accountPopover, dom.$('.cleanSlate-agent-manager-account-signed-out'));
		dom.append(accountSignedOut, dom.$('.cleanSlate-agent-manager-account-signed-out-message')).textContent = localize('cleanSlate.agentManager.signedOut', 'Sign in to sync your CleanSlate account.');
		const signIn = dom.append(accountSignedOut, dom.$('button.cleanSlate-agent-manager-account-sign-in')) as HTMLButtonElement;
		signIn.type = 'button';
		signIn.textContent = localize('cleanSlate.agentManager.signIn', 'Sign in');

		// Its own section rather than part of the signed-in actions: updates are not tied
		// to an account, and this is the only place to reach a check without leaving for
		// the IDE window. Content is driven by the update state in the overlay.
		const accountUpdateActions = dom.append(accountPopover, dom.$('.cleanSlate-agent-manager-account-update-actions'));
		const updateMenuItem = dom.append(accountUpdateActions, dom.$('button.cleanSlate-agent-manager-account-action')) as HTMLButtonElement;
		updateMenuItem.type = 'button';

		const footerRow = dom.append(footer, dom.$('.cleanSlate-agent-manager-footer-row'));
		const accountButton = dom.append(footerRow, dom.$('button.cleanSlate-agent-manager-nav-button.cleanSlate-agent-manager-account')) as HTMLButtonElement;
		accountButton.type = 'button';
		accountButton.setAttribute('aria-haspopup', 'dialog');
		accountButton.setAttribute('aria-expanded', 'false');
		const accountAvatar = dom.append(accountButton, dom.$('span.cleanSlate-agent-manager-account-avatar'));
		const accountName = dom.append(accountButton, dom.$('span.cleanSlate-agent-manager-account-name'));
		// The update row lives inside the popover, which nobody opens unprompted. This
		// accent-blue install glyph is the only thing that says "there is something in here".
		const updateBadge = dom.append(accountButton, dom.$(`span.cleanSlate-agent-manager-account-update-badge.hidden${ThemeIcon.asCSSSelector(Codicon.arrowCircleDown)}`));
		updateBadge.setAttribute('aria-hidden', 'true');
		const closePopover = (restoreFocus = false) => {
			accountPopover.classList.add('hidden');
			accountButton.setAttribute('aria-expanded', 'false');
			accountActions.classList.remove('hidden');
			signOutConfirmation.classList.add('hidden');
			if (restoreFocus) {
				accountButton.focus();
			}
		};
		accountButton.onclick = event => {
			event.stopPropagation();
			const willOpen = accountPopover.classList.contains('hidden');
			closePopover();
			if (willOpen) {
				accountPopover.classList.remove('hidden');
				accountButton.setAttribute('aria-expanded', 'true');
				(accountSignedOut.classList.contains('hidden') ? signOut : signIn).focus();
			}
		};
		signIn.onclick = async () => {
			signIn.disabled = true;
			try {
				await options.onSignIn();
				closePopover(true);
			} finally {
				signIn.disabled = false;
			}
		};
		signOut.onclick = () => {
			accountActions.classList.add('hidden');
			signOutConfirmation.classList.remove('hidden');
			cancelSignOut.focus();
		};
		cancelSignOut.onclick = () => {
			signOutConfirmation.classList.add('hidden');
			accountActions.classList.remove('hidden');
			signOut.focus();
		};
		confirmSignOut.onclick = async () => {
			confirmSignOut.disabled = true;
			try {
				await options.onSignOut();
				closePopover(true);
			} finally {
				confirmSignOut.disabled = false;
			}
		};
		options.disposables.add(dom.addDisposableListener(accountButton.ownerDocument, 'pointerdown', event => {
			if (!footer.contains(event.target as Node)) {
				closePopover();
			}
		}));
		options.disposables.add(dom.addDisposableListener(accountPopover, 'keydown', event => {
			if (event.key === 'Escape') {
				event.preventDefault();
				closePopover(true);
				return;
			}
			if (event.key === 'Tab') {
				const focusable = Array.from(accountPopover.querySelectorAll<HTMLButtonElement>('button:not([disabled])'))
					.filter(element => !element.closest('.hidden'));
				if (focusable.length > 0) {
					const currentIndex = focusable.indexOf(accountButton.ownerDocument.activeElement as HTMLButtonElement);
					const nextIndex = event.shiftKey
						? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
						: (currentIndex + 1) % focusable.length;
					event.preventDefault();
					focusable[nextIndex].focus();
				}
			}
		}));

		// Icon-only, sharing the footer row with the account button (compact
		// footer instead of a second full-width row).
		const settings = dom.append(footerRow, dom.$('button.cleanSlate-agent-manager-footer-settings')) as HTMLButtonElement;
		settings.type = 'button';
		settings.title = localize('cleanSlate.agentManager.settings', 'Settings');
		settings.setAttribute('aria-label', settings.title);
		dom.append(settings, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.gear)}`));
		settings.onclick = () => {
			closePopover();
			options.onOpenSettings();
		};

		return { searchInput, workspaceList, accountButton, accountAvatar, accountName, accountPopover, accountPopoverAvatar, accountPopoverName, accountPopoverEmail, accountSignedIn, accountSignedOut, updateMenuItem, updateBadge };
	}

	private buildHeader(
		parent: HTMLElement,
		inWindowTitlebar: boolean,
		options: ICleanSlateAgentManagerShellBuildOptions
	): { readonly titleElement: HTMLElement; readonly updateButton: HTMLButtonElement; readonly rightPaneToggleButton: HTMLButtonElement } {
		const header = dom.append(parent, dom.$('.cleanSlate-agent-manager-header'));
		header.classList.toggle('in-window-titlebar', inWindowTitlebar);
		const titlebar = dom.append(header, dom.$('.cleanSlate-agent-manager-titlebar'));
		const titleElement = dom.append(titlebar, dom.$('.cleanSlate-agent-manager-title'));

		const actions = dom.append(header, dom.$('.cleanSlate-agent-manager-header-actions'));
		const updateButton = dom.append(actions, dom.$('button.cleanSlate-agent-manager-update.hidden')) as HTMLButtonElement;
		updateButton.type = 'button';
		const exit = dom.append(actions, dom.$('button.cleanSlate-agent-manager-exit')) as HTMLButtonElement;
		exit.type = 'button';
		dom.append(exit, dom.$('span')).textContent = localize('cleanSlate.agentManager.ide', 'IDE');
		// Rendered as a bare ↗ via a -45° rotation in the stylesheet (no
		// diagonal-arrow codicon exists).
		dom.append(exit, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.arrowRight)}`));
		exit.onclick = options.onExitToEditor;

		const rightPaneToggleButton = dom.append(actions, dom.$('button.cleanSlate-agent-manager-pane-toggle')) as HTMLButtonElement;
		rightPaneToggleButton.type = 'button';
		rightPaneToggleButton.title = localize('cleanSlate.agentManager.toggleWorkspacePane', 'Toggle workspace pane');
		rightPaneToggleButton.setAttribute('aria-label', rightPaneToggleButton.title);
		dom.append(rightPaneToggleButton, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.layoutSidebarRightOff)}`));
		rightPaneToggleButton.onclick = options.onToggleRightPane;

		return { titleElement, updateButton, rightPaneToggleButton };
	}
}
