/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../../base/browser/dom.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { CleanSlatePendingEditsRenderer } from '../../renderers/cleanSlatePendingEditsRenderer.js';

export class CleanSlatePendingEditsBarView {
	private readonly root: HTMLElement;
	private readonly fileListContainer: HTMLElement;
	private rejectAllButton: HTMLButtonElement | undefined;
	private acceptAllButton: HTMLButtonElement | undefined;

	constructor(
		container: HTMLElement,
		private readonly renderer: CleanSlatePendingEditsRenderer,
		private readonly onAcceptAll: () => void,
		private readonly onRejectAll: () => void
	) {
		this.root = dom.append(container, dom.$('.cleanSlate-global-status-container'));
		this.fileListContainer = dom.append(this.root, dom.$('.cleanSlate-file-diff-list'));
		this.buildActions();
	}

	render(
		pendingEdits: { uri: URI; added: number; deleted: number }[],
		options: { showChangeActions?: boolean } = {}
	): void {
		this.renderer.render(this.root, this.fileListContainer, pendingEdits);
		const showChangeActions = options.showChangeActions !== false;
		if (this.rejectAllButton) {
			this.rejectAllButton.style.display = showChangeActions ? '' : 'none';
		}
		if (this.acceptAllButton) {
			this.acceptAllButton.style.display = showChangeActions ? '' : 'none';
		}
	}

	private buildActions(): void {
		const actionBar = dom.append(this.root, dom.$('.cleanSlate-global-actions-bar'));

		const actionsLeft = dom.append(actionBar, dom.$('.global-actions-left'));
		dom.append(actionsLeft, dom.$('i.codicon.codicon-file-submodule'));
		const actionsText = dom.append(actionsLeft, dom.$('span.global-actions-text'));
		actionsText.textContent = 'Files With Changes';

		const rightGroup = dom.append(actionBar, dom.$('.global-actions-buttons'));
		const rejectAll = dom.append(rightGroup, dom.$('button.cleanSlate-text-button.reject-all-btn')) as HTMLButtonElement;
		rejectAll.textContent = 'Reject all';

		const acceptAll = dom.append(rightGroup, dom.$('button.cleanSlate-primary-button.accept-btn.premium-blue')) as HTMLButtonElement;
		dom.append(acceptAll, dom.$('span', undefined, 'Accept all'));
		this.rejectAllButton = rejectAll;
		this.acceptAllButton = acceptAll;

		acceptAll.onclick = () => this.onAcceptAll();
		rejectAll.onclick = () => this.onRejectAll();
	}
}
