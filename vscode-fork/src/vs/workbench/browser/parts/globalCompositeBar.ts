/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../nls.js';
import { ActionBar, ActionsOrientation } from '../../../base/browser/ui/actionbar/actionbar.js';
import { GLOBAL_ACTIVITY_ID } from '../../common/activity.js';
import { IActivityService } from '../../services/activity/common/activity.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { DisposableStore, Disposable } from '../../../base/common/lifecycle.js';
import { IColorTheme, IThemeService } from '../../../platform/theme/common/themeService.js';
import { CompositeBarActionViewItem, CompositeBarAction, IActivityHoverOptions, ICompositeBarActionViewItemOptions, ICompositeBarColors } from './compositeBarActions.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { Action, IAction } from '../../../base/common/actions.js';
import { IMenu, IMenuService, MenuId } from '../../../platform/actions/common/actions.js';
import { addDisposableListener, EventType, append, clearNode, hide, show, EventHelper, $, getWindow } from '../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../base/browser/keyboardEvent.js';
import { StandardMouseEvent } from '../../../base/browser/mouseEvent.js';
import { EventType as TouchEventType, GestureEvent } from '../../../base/browser/touch.js';
import { AnchorAlignment, AnchorAxisAlignment } from '../../../base/browser/ui/contextview/contextview.js';
import { getActionBarActions } from '../../../platform/actions/browser/menuEntryActionViewItem.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../platform/contextview/browser/contextView.js';
import { IKeybindingService } from '../../../platform/keybinding/common/keybinding.js';
import { IHoverService } from '../../../platform/hover/browser/hover.js';
import { IUserDataProfileService } from '../../services/userDataProfile/common/userDataProfile.js';
import { DEFAULT_ICON } from '../../services/userDataProfile/common/userDataProfileIcons.js';
import { isString } from '../../../base/common/types.js';
import { KeyCode } from '../../../base/common/keyCodes.js';

export class GlobalCompositeBar extends Disposable {

	readonly element: HTMLElement;
	private readonly globalActivityAction = this._register(new Action(GLOBAL_ACTIVITY_ID));
	private readonly globalActivityActionBar: ActionBar;

	constructor(
		private readonly contextMenuActionsProvider: () => IAction[],
		private readonly colors: (theme: IColorTheme) => ICompositeBarColors,
		private readonly activityHoverOptions: IActivityHoverOptions,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();

		this.element = $('div');
		const contextMenuAlignmentOptions = () => ({
			anchorAlignment: configurationService.getValue('workbench.sideBar.location') === 'left' ? AnchorAlignment.RIGHT : AnchorAlignment.LEFT,
			anchorAxisAlignment: AnchorAxisAlignment.HORIZONTAL
		});
		this.globalActivityActionBar = this._register(new ActionBar(this.element, {
			actionViewItemProvider: (action, options) => {
				if (action.id === GLOBAL_ACTIVITY_ID) {
					return this.instantiationService.createInstance(GlobalActivityActionViewItem, this.contextMenuActionsProvider, { ...options, colors: this.colors, hoverOptions: this.activityHoverOptions }, contextMenuAlignmentOptions);
				}

				throw new Error(`No view item for action '${action.id}'`);
			},
			orientation: ActionsOrientation.VERTICAL,
			ariaLabel: localize('manage', "Manage"),
			preventLoopNavigation: true
		}));

		this.globalActivityActionBar.push(this.globalActivityAction);

		this.registerListeners();
	}

	private registerListeners(): void {
	}

	create(parent: HTMLElement): void {
		parent.appendChild(this.element);
	}

	focus(): void {
		this.globalActivityActionBar.focus(true);
	}

	size(): number {
		return this.globalActivityActionBar.viewItems.length;
	}

	getContextMenuActions(): IAction[] {
		return [];
	}

}

abstract class AbstractGlobalActivityActionViewItem extends CompositeBarActionViewItem {

	constructor(
		private readonly menuId: MenuId,
		action: CompositeBarAction,
		options: ICompositeBarActionViewItemOptions,
		private readonly contextMenuActionsProvider: () => IAction[],
		private readonly contextMenuAlignmentOptions: () => Readonly<{ anchorAlignment: AnchorAlignment; anchorAxisAlignment: AnchorAxisAlignment }> | undefined,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IMenuService private readonly menuService: IMenuService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IConfigurationService configurationService: IConfigurationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IActivityService private readonly activityService: IActivityService,
	) {
		super(action, { draggable: false, icon: true, hasPopup: true, ...options }, () => true, themeService, hoverService, configurationService, keybindingService);

		this.updateItemActivity();
		this._register(this.activityService.onDidChangeActivity(viewContainerOrAction => {
			if (isString(viewContainerOrAction) && viewContainerOrAction === this.compositeBarActionItem.id) {
				this.updateItemActivity();
			}
		}));
	}

	private updateItemActivity(): void {
		(this.action as CompositeBarAction).activities = this.activityService.getActivity(this.compositeBarActionItem.id);
	}

	override render(container: HTMLElement): void {
		super.render(container);

		this._register(addDisposableListener(this.container, EventType.MOUSE_DOWN, async (e: MouseEvent) => {
			EventHelper.stop(e, true);
			const isLeftClick = e?.button !== 2;
			// Left-click run
			if (isLeftClick) {
				this.run();
			}
		}));

		// The rest of the activity bar uses context menu event for the context menu, so we match this
		this._register(addDisposableListener(this.container, EventType.CONTEXT_MENU, async (e: MouseEvent) => {
			// Let the item decide on the context menu instead of the toolbar
			e.stopPropagation();

			const disposables = new DisposableStore();
			const actions = await this.resolveContextMenuActions(disposables);

			const event = new StandardMouseEvent(getWindow(this.container), e);

			this.contextMenuService.showContextMenu({
				getAnchor: () => event,
				getActions: () => actions,
				onHide: () => disposables.dispose()
			});
		}));

		this._register(addDisposableListener(this.container, EventType.KEY_UP, (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);
			if (event.equals(KeyCode.Enter) || event.equals(KeyCode.Space)) {
				EventHelper.stop(e, true);
				this.run();
			}
		}));

		this._register(addDisposableListener(this.container, TouchEventType.Tap, (e: GestureEvent) => {
			EventHelper.stop(e, true);
			this.run();
		}));
	}

	protected async resolveContextMenuActions(disposables: DisposableStore): Promise<IAction[]> {
		return this.contextMenuActionsProvider();
	}

	private async run(): Promise<void> {
		const disposables = new DisposableStore();
		const menu = disposables.add(this.menuService.createMenu(this.menuId, this.contextKeyService));
		const actions = await this.resolveMainMenuActions(menu, disposables);
		const { anchorAlignment, anchorAxisAlignment } = this.contextMenuAlignmentOptions() ?? { anchorAlignment: undefined, anchorAxisAlignment: undefined };

		this.contextMenuService.showContextMenu({
			getAnchor: () => this.label,
			anchorAlignment,
			anchorAxisAlignment,
			getActions: () => actions,
			onHide: () => disposables.dispose(),
			menuActionOptions: { renderShortTitle: true },
		});

	}

	protected async resolveMainMenuActions(menu: IMenu, _disposable: DisposableStore): Promise<IAction[]> {
		return getActionBarActions(menu.getActions({ renderShortTitle: true })).secondary;
	}
}

export class GlobalActivityActionViewItem extends AbstractGlobalActivityActionViewItem {

	private profileBadge: HTMLElement | undefined;
	private profileBadgeContent: HTMLElement | undefined;

	constructor(
		contextMenuActionsProvider: () => IAction[],
		options: ICompositeBarActionViewItemOptions,
		contextMenuAlignmentOptions: () => Readonly<{ anchorAlignment: AnchorAlignment; anchorAxisAlignment: AnchorAxisAlignment }> | undefined,
		@IUserDataProfileService private readonly userDataProfileService: IUserDataProfileService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IMenuService menuService: IMenuService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IConfigurationService configurationService: IConfigurationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IActivityService activityService: IActivityService,
	) {
		const action = instantiationService.createInstance(CompositeBarAction, {
			id: GLOBAL_ACTIVITY_ID,
			name: localize('manage', "Manage"),
			classNames: ThemeIcon.asClassNameArray(userDataProfileService.currentProfile.icon ? ThemeIcon.fromId(userDataProfileService.currentProfile.icon) : DEFAULT_ICON)
		});
		super(MenuId.GlobalActivity, action, options, contextMenuActionsProvider, contextMenuAlignmentOptions, themeService, hoverService, menuService, contextMenuService, contextKeyService, configurationService, keybindingService, activityService);
		this._register(action);
		this._register(this.userDataProfileService.onDidChangeCurrentProfile(e => {
			action.compositeBarActionItem = {
				...action.compositeBarActionItem,
				classNames: ThemeIcon.asClassNameArray(userDataProfileService.currentProfile.icon ? ThemeIcon.fromId(userDataProfileService.currentProfile.icon) : DEFAULT_ICON)
			};
		}));
	}

	override render(container: HTMLElement): void {
		super.render(container);

		this.profileBadge = append(container, $('.profile-badge'));
		this.profileBadgeContent = append(this.profileBadge, $('.profile-badge-content'));
		this.updateProfileBadge();
	}

	private updateProfileBadge(): void {
		if (!this.profileBadge || !this.profileBadgeContent) {
			return;
		}

		clearNode(this.profileBadgeContent);
		hide(this.profileBadge);

		if (this.userDataProfileService.currentProfile.isDefault) {
			return;
		}

		if (this.userDataProfileService.currentProfile.icon && this.userDataProfileService.currentProfile.icon !== DEFAULT_ICON.id) {
			return;
		}

		if ((this.action as CompositeBarAction).activities.length > 0) {
			return;
		}

		show(this.profileBadge);
		this.profileBadgeContent.classList.add('profile-text-overlay');
		this.profileBadgeContent.textContent = this.userDataProfileService.currentProfile.name.substring(0, 2).toUpperCase();
	}

	protected override updateActivity(): void {
		super.updateActivity();
		this.updateProfileBadge();
	}

	protected override computeTitle(): string {
		return this.userDataProfileService.currentProfile.isDefault ? super.computeTitle() : localize('manage profile', "Manage {0} (Profile)", this.userDataProfileService.currentProfile.name);
	}
}
