/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { IStorageService, StorageScope } from '../../../../../platform/storage/common/storage.js';
import { ISecretStorageService } from '../../../../../platform/secrets/common/secrets.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { ICleanSlateConfigurationService, ICleanSlateMainService, ICleanSlateService } from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { CLEANSLATE_AUTH_ACCOUNT_STORAGE_KEY, clearCleanSlateAuthAccount, openCleanSlateAccount, openCleanSlateProCheckout, openCleanSlateSignIn } from '../auth/cleanSlateAuth.contribution.js';
import { CleanSlateSettingsInput } from './cleanSlateSettingsInput.js';
import { CleanSlateSettingsPanel } from './cleanSlateSettingsPanel.js';

const CLEANSLATE_SETTINGS_CANVAS_WIDTH = 1180;
const CLEANSLATE_SETTINGS_MAX_SCALE = 1;
const CLEANSLATE_SETTINGS_WINDOW_BAR_HEIGHT = 38;

export class CleanSlateSettingsEditor extends EditorPane {

	static readonly ID = 'workbench.editors.cleanSlateSettingsEditor';

	private container!: HTMLElement;
	private body!: HTMLElement;
	private panel!: CleanSlateSettingsPanel;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService private readonly storageService: IStorageService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@ICleanSlateConfigurationService private readonly configService: ICleanSlateConfigurationService,
		@ICleanSlateService private readonly cleanSlateService: ICleanSlateService,
		@ICleanSlateMainService private readonly cleanSlateMainService: ICleanSlateMainService,
		@IOpenerService private readonly openerService: IOpenerService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super(CleanSlateSettingsEditor.ID, group, telemetryService, themeService, storageService);
		this._register(storageService.onDidChangeValue(StorageScope.APPLICATION, CLEANSLATE_AUTH_ACCOUNT_STORAGE_KEY, this._store)(() => {
			if (this.panel) {
				void this.panel.render({ preserveScroll: true });
			}
		}));
	}

	protected createEditor(parent: HTMLElement): void {
		this.container = dom.append(parent, dom.$('.cleanSlate-settings-editor'));
		dom.append(this.container, dom.$('.cleanSlate-settings-window-bar'));
		this.body = dom.append(this.container, dom.$('.cleanSlate-settings-shell'));

		this.panel = new CleanSlateSettingsPanel(this.configService, this.cleanSlateService, {
			signIn: () => openCleanSlateSignIn(this.openerService, this.notificationService, this.cleanSlateMainService),
			upgradeToPro: () => openCleanSlateProCheckout(this.openerService, this.notificationService, this.cleanSlateMainService),
			signOut: () => clearCleanSlateAuthAccount(this.secretStorageService, this.storageService),
			manageAccount: () => openCleanSlateAccount(this.openerService, this.notificationService, this.cleanSlateMainService)
		});
		this.panel.mount(this.body);

		this.injectStyles();
	}

	override async setInput(input: CleanSlateSettingsInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		await this.panel.render();
	}

	override layout(dimension: dom.Dimension): void {
		this.container.style.width = `${dimension.width}px`;
		this.container.style.height = `${dimension.height}px`;
		const widthScale = dimension.width > 0 ? dimension.width / CLEANSLATE_SETTINGS_CANVAS_WIDTH : 1;
		const scale = Math.min(CLEANSLATE_SETTINGS_MAX_SCALE, widthScale);
		const contentHeight = Math.max(1, dimension.height - CLEANSLATE_SETTINGS_WINDOW_BAR_HEIGHT);
		this.body.style.width = `${CLEANSLATE_SETTINGS_CANVAS_WIDTH}px`;
		this.body.style.height = `${Math.max(1, contentHeight / scale)}px`;
		this.body.style.transform = `scale(${scale})`;
	}

	private injectStyles(): void {
		const style = dom.$('style');
		style.textContent = `
			.cleanSlate-settings-editor {
				width: 100%;
				height: 100%;
				overflow: hidden;
				background: var(--vscode-editor-background);
				color: var(--vscode-editor-foreground);
				font-family: var(--vscode-font-family);
				display: flex;
				flex-direction: column;
			}

			.cleanSlate-settings-window-bar {
				box-sizing: border-box;
				height: ${CLEANSLATE_SETTINGS_WINDOW_BAR_HEIGHT}px;
				flex: 0 0 ${CLEANSLATE_SETTINGS_WINDOW_BAR_HEIGHT}px;
				display: flex;
				align-items: center;
				justify-content: flex-end;
				padding: 0 22px;
				border-bottom: 1px solid var(--vscode-editorGroup-border, var(--vscode-sideBar-border));
				background: var(--vscode-editor-background);
			}

			.cleanSlate-settings-shell {
				width: ${CLEANSLATE_SETTINGS_CANVAS_WIDTH}px;
				height: calc(100% - ${CLEANSLATE_SETTINGS_WINDOW_BAR_HEIGHT}px);
				flex: 1 1 auto;
				display: grid;
				grid-template-columns: 220px 960px;
				overflow: visible;
				transform-origin: 0 0;
				will-change: transform;
			}

			.cleanSlate-settings-shell > .cleanSlate-settings-panel-shell {
				grid-column: 1 / -1;
				width: 100%;
				height: 100%;
				min-width: 0;
				min-height: 0;
				display: grid;
				grid-template-columns: 220px 960px;
				overflow: hidden;
			}

			.cleanSlate-settings-sidebar {
				box-sizing: border-box;
				padding: 18px 18px 24px;
				background: var(--vscode-editor-background);
				border-right: 1px solid var(--vscode-editorGroup-border, var(--vscode-sideBar-border));
				overflow-y: auto;
				scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
				scrollbar-width: thin;
			}

			.cleanSlate-settings-nav {
				display: flex;
				flex-direction: column;
				gap: 4px;
			}

			.cleanSlate-settings-nav-item {
				width: 100%;
				height: 34px;
				display: flex;
				align-items: center;
				gap: 10px;
				padding: 0 10px;
				border: 0;
				border-radius: 5px;
				background: transparent;
				color: var(--vscode-descriptionForeground);
				text-align: left;
				font: inherit;
				cursor: pointer;
			}

			.cleanSlate-settings-nav-item:hover {
				background: var(--vscode-list-hoverBackground, color-mix(in srgb, var(--vscode-editor-foreground) 8%, transparent));
				color: var(--vscode-foreground);
			}

			.cleanSlate-settings-nav-item.active {
				background: var(--vscode-list-activeSelectionBackground, color-mix(in srgb, var(--vscode-focusBorder) 18%, transparent));
				color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
				box-shadow: inset 2px 0 0 var(--vscode-focusBorder);
			}

			.cleanSlate-settings-content {
				box-sizing: border-box;
				width: 960px;
				min-width: 0;
				min-height: 0;
				overflow-y: auto;
				overflow-x: hidden;
				padding: 34px 44px 360px;
				scroll-behavior: smooth;
				scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
				scrollbar-width: thin;
			}

			.cleanSlate-settings-sidebar::-webkit-scrollbar,
			.cleanSlate-settings-content::-webkit-scrollbar {
				width: 10px;
			}

			.cleanSlate-settings-sidebar::-webkit-scrollbar-track,
			.cleanSlate-settings-content::-webkit-scrollbar-track {
				background: transparent;
			}

			.cleanSlate-settings-sidebar::-webkit-scrollbar-thumb,
			.cleanSlate-settings-content::-webkit-scrollbar-thumb {
				background: var(--vscode-scrollbarSlider-background, rgba(121, 121, 121, 0.4));
				border: 3px solid transparent;
				border-radius: 999px;
				background-clip: content-box;
			}

			.cleanSlate-settings-sidebar::-webkit-scrollbar-thumb:hover,
			.cleanSlate-settings-content::-webkit-scrollbar-thumb:hover {
				background: var(--vscode-scrollbarSlider-hoverBackground, rgba(100, 100, 100, 0.55));
				background-clip: content-box;
			}

			.cleanSlate-settings-save-status {
				font-size: 12px;
				color: var(--vscode-descriptionForeground);
				white-space: nowrap;
				-webkit-app-region: no-drag;
			}

			.cleanSlate-settings-save-status.saved {
				color: var(--vscode-testing-iconPassed, #35a56a);
			}

			.cleanSlate-settings-page-section {
				width: 820px;
				margin: 0 auto 36px;
				scroll-margin-top: 24px;
			}

			.cleanSlate-settings-page-section-title {
				margin: 0 0 14px;
				font-size: 17px;
				line-height: 21px;
				font-weight: 500;
				color: var(--vscode-foreground);
			}

			.cleanSlate-settings-section {
				margin: 0 0 22px;
			}

			.cleanSlate-settings-section-header {
				display: flex;
				align-items: flex-start;
				margin: 0 0 9px;
				color: var(--vscode-descriptionForeground);
			}

			.cleanSlate-settings-section-header h2 {
				margin: 0;
				font-size: 12px;
				line-height: 16px;
				font-weight: 400;
				color: var(--vscode-descriptionForeground);
			}

			.cleanSlate-settings-section-header p {
				margin: 3px 0 0;
				font-size: 13px;
				line-height: 1.45;
				color: var(--vscode-descriptionForeground);
			}

			.cleanSlate-settings-group {
				background: color-mix(in srgb, var(--vscode-editor-foreground) 4.5%, transparent);
				border-radius: 12px;
				overflow: visible;
			}

			.cleanSlate-settings-row {
				position: relative;
				display: grid;
				grid-template-columns: 388px 320px;
				align-items: center;
				gap: 20px;
				box-sizing: border-box;
				padding: 12px 14px;
			}

			.cleanSlate-settings-row + .cleanSlate-settings-row::before {
				content: "";
				position: absolute;
				top: 0;
				left: 12px;
				right: 12px;
				height: 1px;
				background: color-mix(in srgb, var(--vscode-editor-foreground) 8%, transparent);
			}

			.cleanSlate-settings-label {
				font-size: 13px;
				line-height: 18px;
				font-weight: 400;
				color: var(--vscode-foreground);
			}

			.cleanSlate-settings-description {
				margin-top: 1px;
				font-size: 13px;
				line-height: 18px;
				font-weight: 400;
				color: var(--vscode-descriptionForeground);
			}

			.cleanSlate-settings-value {
				width: 360px;
				display: flex;
				justify-content: flex-end;
			}

			.cleanSlate-settings-value.stack {
				flex-direction: column;
				align-items: stretch;
				gap: 6px;
			}

			.cleanSlate-settings-control {
				box-sizing: border-box;
				width: 100%;
				min-width: 0;
				height: 28px;
				padding: 4px 9px;
				background: var(--vscode-input-background);
				color: var(--vscode-input-foreground);
				border: 1px solid var(--vscode-input-border, transparent);
				border-radius: 5px;
				font-size: 13px;
				font-family: var(--vscode-font-family);
				outline: none;
			}

			.cleanSlate-settings-control:focus {
				border-color: var(--vscode-focusBorder);
			}

			.cleanSlate-settings-control:disabled {
				opacity: 0.68;
				cursor: default;
			}

			.cleanSlate-settings-toggle {
				width: 40px;
				height: 22px;
				border: 1px solid color-mix(in srgb, var(--vscode-editor-foreground) 12%, transparent);
				border-radius: 999px;
				background: color-mix(in srgb, var(--vscode-editor-foreground) 16%, transparent);
				cursor: pointer;
				padding: 2px;
			}

			.cleanSlate-settings-toggle:disabled {
				opacity: 0.75;
				cursor: default;
			}

			.cleanSlate-settings-toggle[aria-checked="true"] {
				background: var(--vscode-testing-iconPassed, #35a56a);
			}

			.cleanSlate-settings-toggle-knob {
				display: block;
				width: 16px;
				height: 16px;
				border-radius: 50%;
				background: var(--vscode-editor-foreground);
				transform: translateX(0);
				transition: transform 0.12s ease;
			}

			.cleanSlate-settings-toggle[aria-checked="true"] .cleanSlate-settings-toggle-knob {
				transform: translateX(18px);
			}
		`;
		this.container.appendChild(style);
	}
}
