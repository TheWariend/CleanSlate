/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ContentWidgetPositionPreference, ICodeEditor, IContentWidget, IContentWidgetPosition } from '../../../../../editor/browser/editorBrowser.js';
import { EditorContributionInstantiation, registerEditorContribution } from '../../../../../editor/browser/editorExtensions.js';
import { IEditorContribution } from '../../../../../editor/common/editorCommon.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import type { ICleanSlateEditorSelectionReference } from '../chat/providers/cleanSlateChatComposerProvider.js';

const CLEANSLATE_CHAT_VIEW_ID = 'workbench.view.cleanSlateChat';

/**
 * Editors registered here (e.g. the agent manager's embedded file editor) route
 * "Add to Chat" to their own composer instead of the IDE chat view.
 */
const cleanSlateEditorChatTargets = new WeakMap<ICodeEditor, (reference: ICleanSlateEditorSelectionReference) => void>();

export function registerCleanSlateEditorChatTarget(editor: ICodeEditor, handler: (reference: ICleanSlateEditorSelectionReference) => void): IDisposable {
	cleanSlateEditorChatTargets.set(editor, handler);
	return toDisposable(() => {
		if (cleanSlateEditorChatTargets.get(editor) === handler) {
			cleanSlateEditorChatTargets.delete(editor);
		}
	});
}

class CleanSlateSelectionAddToChatController extends Disposable implements IEditorContribution {
	static readonly ID = 'editor.contrib.cleanSlateSelectionAddToChat';

	private readonly node: HTMLElement;
	private readonly button: HTMLButtonElement;
	private isVisible = false;

	constructor(
		private readonly editor: ICodeEditor,
		@IViewsService private readonly viewsService: IViewsService
	) {
		super();

		this.node = document.createElement('div');
		this.node.className = 'cleanSlate-add-to-chat-widget';
		this.applyWidgetStyles(this.node);

		this.button = document.createElement('button');
		this.button.type = 'button';
		this.button.textContent = 'Add to Chat ⌘L';
		this.button.title = 'Add selected code to CleanSlate chat';
		this.applyButtonStyles(this.button);
		this.node.appendChild(this.button);

		this._register(this.editor.onDidChangeCursorSelection(() => this.update()));
		this._register(this.editor.onDidChangeModel(() => this.update()));
		this._register(this.editor.onDidDispose(() => this.dispose()));
		this._register({
			dispose: () => {
				if (this.isVisible) {
					this.editor.removeContentWidget(this.widget);
				}
			}
		});

		this.button.onclick = (event) => {
			event.preventDefault();
			event.stopPropagation();
			void this.addCurrentSelectionToChat();
		};

		this.update();
	}

	private readonly widget: IContentWidget = {
		getId: () => 'cleanSlate.addSelectionToChat',
		getDomNode: () => this.node,
		getPosition: (): IContentWidgetPosition | null => {
			const selection = this.editor.getSelection();
			if (!selection || selection.isEmpty()) {
				return null;
			}
			return {
				position: selection.getStartPosition(),
				preference: [ContentWidgetPositionPreference.ABOVE, ContentWidgetPositionPreference.BELOW]
			};
		}
	};

	private update(): void {
		const reference = this.createSelectionReference();
		const shouldShow = !!reference;
		if (shouldShow && !this.isVisible) {
			this.editor.addContentWidget(this.widget);
			this.isVisible = true;
		} else if (!shouldShow && this.isVisible) {
			this.editor.removeContentWidget(this.widget);
			this.isVisible = false;
		}
		if (shouldShow) {
			this.editor.layoutContentWidget(this.widget);
		}
	}

	private async addCurrentSelectionToChat(): Promise<void> {
		const reference = this.createSelectionReference();
		if (!reference) {
			this.update();
			return;
		}

		const target = cleanSlateEditorChatTargets.get(this.editor);
		if (target) {
			target(reference);
		} else {
			const view = await this.viewsService.openView<any>(CLEANSLATE_CHAT_VIEW_ID, true);
			view?.addSelectionToChat?.(reference);
		}
		if (this.isVisible) {
			this.editor.removeContentWidget(this.widget);
			this.isVisible = false;
		}
	}

	private createSelectionReference(): ICleanSlateEditorSelectionReference | undefined {
		if (!this.editor.hasModel()) {
			return undefined;
		}
		const model = this.editor.getModel();
		const selection = this.editor.getSelection();
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

	private applyWidgetStyles(node: HTMLElement): void {
		node.style.pointerEvents = 'auto';
		node.style.zIndex = '50';
	}

	private applyButtonStyles(button: HTMLButtonElement): void {
		button.style.border = '1px solid var(--vscode-widget-border, var(--vscode-input-border))';
		button.style.borderRadius = '6px';
		button.style.background = 'var(--vscode-editorWidget-background, var(--vscode-menu-background))';
		button.style.color = 'var(--vscode-foreground)';
		button.style.boxShadow = '0 8px 24px var(--vscode-widget-shadow, rgba(0,0,0,.28))';
		button.style.font = '12px var(--vscode-font-family)';
		button.style.lineHeight = '18px';
		button.style.padding = '4px 8px';
		button.style.cursor = 'pointer';
		button.style.whiteSpace = 'nowrap';
	}
}

registerEditorContribution(CleanSlateSelectionAddToChatController.ID, CleanSlateSelectionAddToChatController, EditorContributionInstantiation.Eventually);
