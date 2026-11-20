/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IOverlayWidget, OverlayWidgetPositionPreference } from '../../editorBrowser.js';

export class InlineCleanSlateWidget extends Disposable implements IOverlayWidget {
	public readonly domNode: HTMLElement;

	constructor(
		private readonly onAccept: () => void,
		private readonly onReject: () => void
	) {
		super();

		this.domNode = dom.$('.cleanSlate-preview-widget-overlay');
		this.domNode.style.display = 'flex';
		this.domNode.style.zIndex = '1000';
		this.domNode.style.pointerEvents = 'none';

		this._render();
	}

	public getId(): string {
		return 'editor.contrib.inlineCleanSlateWidget';
	}

	public getDomNode(): HTMLElement {
		return this.domNode;
	}

	public getPosition(): { preference: OverlayWidgetPositionPreference } {
		return {
			preference: OverlayWidgetPositionPreference.BOTTOM_RIGHT_CORNER
		};
	}

	private _render(): void {
		this.domNode.style.position = 'absolute';
		this.domNode.style.bottom = '30px';
		this.domNode.style.left = '0';
		this.domNode.style.right = '0';
		this.domNode.style.width = '100%';
		this.domNode.style.display = 'flex';
		this.domNode.style.justifyContent = 'center';
		this.domNode.style.pointerEvents = 'none';

		const container = dom.append(this.domNode, dom.$('div.cleanSlate-preview-actions-container'));
		container.style.display = 'flex';
		container.style.gap = '8px';
		container.style.alignItems = 'center';
		container.style.pointerEvents = 'auto';
		container.style.background = 'transparent';
		container.style.backdropFilter = 'none';
		container.style.border = 'none';
		container.style.boxShadow = 'none';
		container.style.padding = '0';

		const focusStyle = dom.append(this.domNode, dom.$('style'));
		focusStyle.textContent = '.cleanSlate-preview-widget-overlay button:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }';

		const styleButton = (btn: HTMLElement, type: 'accept' | 'reject') => {
			btn.style.padding = '4px 12px';
			btn.style.height = '26px';
			btn.style.borderRadius = '6px';
			btn.style.fontSize = '12px';
			btn.style.fontWeight = '500';
			btn.style.cursor = 'pointer';
			btn.style.display = 'flex';
			btn.style.flexShrink = '0';
			btn.style.alignItems = 'center';
			btn.style.gap = '6px';
			btn.style.border = 'none';
			btn.style.transition = 'background 0.15s ease, opacity 0.15s ease';

			const background = type === 'accept' ? 'var(--vscode-button-background)' : 'var(--vscode-button-secondaryBackground)';
			const hoverBackground = type === 'accept' ? 'var(--vscode-button-hoverBackground)' : 'var(--vscode-button-secondaryHoverBackground)';
			btn.style.background = background;
			btn.style.color = type === 'accept' ? 'var(--vscode-button-foreground)' : 'var(--vscode-button-secondaryForeground)';
			btn.style.border = '1px solid var(--vscode-contrastBorder, var(--vscode-button-border, transparent))';

			this._register(dom.addDisposableListener(btn, 'mouseenter', () => {
				btn.style.background = hoverBackground;
			}));
			this._register(dom.addDisposableListener(btn, 'mouseleave', () => {
				btn.style.background = background;
			}));

		};

		// Accept Changes
		const acceptBtn = dom.append(container, dom.$('button.accept-changes'));
		const acceptLabel = dom.append(acceptBtn, dom.$('span'));
		acceptLabel.textContent = 'Accept';
		const acceptShortcut = dom.append(acceptBtn, dom.$('span.shortcut'));
		acceptShortcut.textContent = '⌘↩';
		acceptShortcut.style.opacity = '0.7';
		acceptShortcut.style.fontSize = '11px';
		styleButton(acceptBtn, 'accept');
		this._register(dom.addDisposableListener(acceptBtn, 'click', () => this.onAccept()));

		// Reject
		const rejectBtn = dom.append(container, dom.$('button.reject-changes'));
		const rejectLabel = dom.append(rejectBtn, dom.$('span'));
		rejectLabel.textContent = 'Reject';
		const rejectShortcut = dom.append(rejectBtn, dom.$('span.shortcut'));
		rejectShortcut.textContent = '⌘⌫';
		rejectShortcut.style.opacity = '0.6';
		rejectShortcut.style.fontSize = '11px';
		styleButton(rejectBtn, 'reject');
		this._register(dom.addDisposableListener(rejectBtn, 'click', () => this.onReject()));

	}
}
