/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../../nls.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { CleanSlateHistoryOverlayRenderer } from '../renderers/cleanSlateHistoryOverlayRenderer.js';
import { deriveCleanSlateTranscriptFromHistory, ICleanSlateSessionSnapshot, ICleanSlateTranscriptMessage } from '../types/cleanSlateChatSessionTypes.js';
import { CleanSlateChatSidebarViewModel } from './cleanSlateChatSidebarViewModel.js';
import { getCleanSlateSessionObjective } from './cleanSlateChatViewHelpers.js';

export interface ICleanSlateHistoryFlowControllerOptions {
	readonly onBeforeSessionChange: () => void;
	readonly onSessionRestored: (
		history: readonly ICleanSlateTranscriptMessage[],
		fallbackAssistantContent?: string
	) => void;
	readonly onAfterSessionRestored: () => void;
	readonly onSyntheticCommand: (text: string) => void;
}

export class CleanSlateHistoryFlowController {
	constructor(
		private readonly sidebarViewModel: CleanSlateChatSidebarViewModel,
		private readonly historyOverlayRenderer: CleanSlateHistoryOverlayRenderer,
		private readonly notificationService: INotificationService,
		private readonly options: ICleanSlateHistoryFlowControllerOptions
	) { }

	async open(container: HTMLElement): Promise<void> {
		if (this.historyOverlayRenderer.isVisible()) {
			this.historyOverlayRenderer.hide();
			return;
		}

		this.historyOverlayRenderer.show(container, this.sidebarViewModel.buildHistoryOverlayData(), {
			onRestore: (session) => {
				this.options.onBeforeSessionChange();
				this.sidebarViewModel.archiveCurrentSession();
				this.restore(session);
			},
			onResume: (session) => {
				this.options.onBeforeSessionChange();
				this.sidebarViewModel.archiveCurrentSession();
				this.restore(session);
				this.options.onSyntheticCommand('continue');
			},
			onRerun: (session) => {
				const replayObjective = getCleanSlateSessionObjective(session);
				if (!replayObjective) {
					this.notificationService.info(localize('cleanSlate.noObjectiveToRerun', 'There is no saved objective to rerun for this session.'));
					return;
				}
				this.options.onBeforeSessionChange();
				this.sidebarViewModel.archiveCurrentSession();
				this.restore(session);
				this.options.onSyntheticCommand(replayObjective);
			},
			onRemove: (sessionId) => {
				this.sidebarViewModel.removeArchivedSession(sessionId);
			}
		});
	}

	refresh(): void {
		this.historyOverlayRenderer.refresh(this.sidebarViewModel.buildHistoryOverlayData());
	}

	hide(): void {
		this.historyOverlayRenderer.hide();
	}

	private restore(session: ICleanSlateSessionSnapshot): void {
		this.sidebarViewModel.runWithRestoringSession(() => {
			this.sidebarViewModel.restoreSession(session);
			const fallbackAssistantTurn = session.taskState?.lastAssistantTurn
				?? session.threadState?.lastAssistantTurn;
			const restoredHistory = this.sidebarViewModel.getTranscriptHistory();
			this.options.onSessionRestored(
				restoredHistory.length > 0 ? restoredHistory : (session.transcript?.length ? session.transcript : deriveCleanSlateTranscriptFromHistory(session.history)),
				fallbackAssistantTurn
			);
			this.options.onAfterSessionRestored();
			this.historyOverlayRenderer.hide();
		});
	}
}
