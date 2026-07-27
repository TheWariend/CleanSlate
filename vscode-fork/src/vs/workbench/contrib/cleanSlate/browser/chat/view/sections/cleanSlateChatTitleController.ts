/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../../../nls.js';
import { IViewDescriptorService } from '../../../../../../common/views.js';
import type { ICleanSlateChatSidebarState } from '../../viewModel/cleanSlateChatSidebarViewModel.js';
import { getCleanSlateVisibleUserRequestText, normalizeCleanSlateVisibleWhitespace } from '../../runtime/cleanSlateVisibleText.js';

export class CleanSlateChatTitleController {
	constructor(
		private readonly viewId: string,
		private readonly viewDescriptorService: IViewDescriptorService,
		private readonly updateTitle: (title: string) => void
	) { }

	update(state: ICleanSlateChatSidebarState): void {
		const finalTitle = this.resolveTitle(state);
		this.updateTitle(finalTitle);

		const container = this.viewDescriptorService.getViewContainerByViewId(this.viewId);
		if (container) {
			const model = this.viewDescriptorService.getViewContainerModel(container);
			if (model && (model as any).setTitle) {
				(model as any).setTitle(finalTitle);
			}
		}
	}

	private resolveTitle(state: ICleanSlateChatSidebarState): string {
		const runSummary = state.runSummary;
		const history = state.history;

		if (state.title && state.title.trim() && state.title.trim().toLowerCase() !== 'agent') {
			return this.limitTitleLength(state.title);
		}

		if (!history.length && !runSummary.objective) {
			return localize('cleanSlate.agent', 'Agent');
		}

		const firstUserMessage = history.find(message => message.role === 'user' && message.content.trim().length > 0)?.content ?? '';
		const userTaskTitle = normalizeCleanSlateVisibleWhitespace(getCleanSlateVisibleUserRequestText(runSummary.objective || firstUserMessage));
		const fallbackWork = userTaskTitle || this.getPhaseLabel(state.phase);
		const currentWork = userTaskTitle || state.currentWorkItem || fallbackWork;
		const activeContext = state.currentAgent?.name
			? `${state.currentAgent.name}: ${currentWork}`
			: currentWork;

		return this.limitTitleLength(activeContext);
	}

	private getPhaseLabel(phase: string): string {
		switch (phase) {
			case 'PLANNING':
				return localize('cleanSlate.phasePlanning', 'Planning');
			case 'PREPARING':
			case 'EXECUTION':
				return localize('cleanSlate.phaseExecution', 'Executing');
			case 'VERIFICATION':
				return localize('cleanSlate.phaseVerification', 'Verifying');
			default:
				return localize('cleanSlate.phaseWorking', 'Working');
		}
	}

	private limitTitleLength(text: string): string {
		const trimmed = text.trim();
		if (trimmed.length <= 72) {
			return trimmed;
		}
		return `${trimmed.slice(0, 69)}...`;
	}
}
