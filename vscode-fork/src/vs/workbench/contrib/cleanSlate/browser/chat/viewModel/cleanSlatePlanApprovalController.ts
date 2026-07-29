/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICleanSlateArtifactService } from '../../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { CleanSlateTaskLifecycleStatus } from '@cleanslate/sdk/services/cleanSlateTaskState.js';
import { IResponseRenderer } from '../types/cleanSlateChatTypes.js';
import { CleanSlateChatSidebarViewModel } from './cleanSlateChatSidebarViewModel.js';

export class CleanSlatePlanApprovalController {
	constructor(
		private readonly sidebarViewModel: CleanSlateChatSidebarViewModel,
		private readonly artifactService: ICleanSlateArtifactService
	) { }

	shouldShow(isDismissed: boolean, hasPlanningQuestion: boolean): boolean {
		if (isDismissed || hasPlanningQuestion || this.sidebarViewModel.getIsGenerating()) {
			return false;
		}

		return this.sidebarViewModel.canApprovePlan()
			|| this.canApproveFromCurrentPlanArtifact(this.getLatestPlanArtifact());
	}

	canApprove(): boolean {
		return this.sidebarViewModel.canApprovePlan()
			|| this.canApproveFromCurrentPlanArtifact(this.getLatestPlanArtifact());
	}

	async approve(renderer: IResponseRenderer, onGeneratingChange?: (isGenerating: boolean) => void): Promise<void> {
		if (!this.canApprove()) {
			return;
		}

		const planArtifact = this.getLatestPlanArtifact();
		const planContext = planArtifact?.content
			? `\n\nHere is the approved implementation plan to execute:\n\n${planArtifact.content}`
			: '';

		await this.sidebarViewModel.approvePlan(renderer, planContext, onGeneratingChange);
	}

	private getLatestPlanArtifact(): { timestamp?: number; content?: string } | undefined {
		return this.artifactService.getLatestArtifactByType('implementation_plan', { sessionId: this.sidebarViewModel.getActiveSessionId() });
	}

	private canApproveFromCurrentPlanArtifact(planArtifact: { timestamp?: number; content?: string } | undefined): boolean {
		if (!planArtifact || this.sidebarViewModel.getPhase() !== 'PLANNING' || this.sidebarViewModel.getIsGenerating()) {
			return false;
		}

		const runSummary = this.sidebarViewModel.getRunSummary();
		if (runSummary.status === CleanSlateTaskLifecycleStatus.IDLE) {
			return false;
		}

		const startedAt = typeof runSummary.startedAt === 'number' && Number.isFinite(runSummary.startedAt)
			? runSummary.startedAt
			: 0;
		const artifactTimestamp = typeof planArtifact.timestamp === 'number' && Number.isFinite(planArtifact.timestamp)
			? planArtifact.timestamp
			: 0;
		const artifactBelongsToCurrentRun = artifactTimestamp > 0 && startedAt > 0 && artifactTimestamp >= startedAt;
		const hasCurrentRunPlanHandoff = typeof runSummary.lastSummary === 'string' && runSummary.lastSummary.trim().length > 0;

		return artifactBelongsToCurrentRun && hasCurrentRunPlanHandoff;
	}
}
