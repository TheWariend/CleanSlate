/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { CleanSlateAgentWorkspaceInput } from './cleanSlateAgentWorkspaceInput.js';
import { CleanSlateAgentWorkspaceOverlay } from './cleanSlateAgentWorkspaceOverlay.js';

const CLEANSLATE_AGENT_WORKSPACE_WINDOW_BAR_HEIGHT = 52;

export class CleanSlateAgentWorkspaceEditor extends EditorPane {

	static readonly ID = 'workbench.editors.cleanSlateAgentWorkspaceEditor';

	private container!: HTMLElement;
	private overlay: CleanSlateAgentWorkspaceOverlay | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super(CleanSlateAgentWorkspaceEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.container = dom.append(parent, dom.$('.cleanSlate-agent-workspace-editor'));
		this.injectStyles();
	}

	override async setInput(input: CleanSlateAgentWorkspaceInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this.overlay ??= this.instantiationService.createInstance(CleanSlateAgentWorkspaceOverlay);
		this.overlay.mount(this.container, {
			targetWindow: this.window,
			integratedTitlebar: true,
			onExit: () => void this.closeCurrentEditor()
		});
		this.overlay.layout();
	}

	override clearInput(): void {
		this.overlay?.hide();
		super.clearInput();
	}

	override layout(dimension: dom.Dimension): void {
		this.container.style.width = `${dimension.width}px`;
		this.container.style.height = `${dimension.height}px`;
		this.overlay?.layout();
	}

	override dispose(): void {
		this.overlay?.dispose();
		this.overlay = undefined;
		super.dispose();
	}

	private async closeCurrentEditor(): Promise<void> {
		const input = this.input;
		if (input) {
			await this.group.closeEditor(input);
		}
	}

	private injectStyles(): void {
		const style = dom.$('style');
		style.textContent = `
			.cleanSlate-agent-workspace-editor {
				--cleanSlate-agent-workspace-titlebar-height: ${CLEANSLATE_AGENT_WORKSPACE_WINDOW_BAR_HEIGHT}px;
				width: 100%;
				height: 100%;
				min-width: 0;
				min-height: 0;
				position: relative;
				overflow: hidden;
				background: var(--vscode-editor-background);
				color: var(--vscode-foreground);
				font-family: var(--vscode-font-family);
			}
		`;
		this.container.appendChild(style);
	}
}
