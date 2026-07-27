/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CLEANSLATE_FALLBACK_CONTEXT_WINDOW_TOKENS } from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { CleanSlateChatSidebarViewModel } from '../chat/viewModel/cleanSlateChatSidebarViewModel.js';
import { CleanSlateComposerView } from '../chat/view/sections/cleanSlateComposerView.js';

export class CleanSlateAgentManagerComposerDraftController {

	private activeComposerSessionId: string | undefined;
	private readonly drafts = new Map<string, string>();

	constructor(
		private readonly sidebarViewModel: CleanSlateChatSidebarViewModel,
		private readonly getComposerView: () => CleanSlateComposerView | undefined
	) {}

	handleInputChange(): void {
		const sessionId = this.activeComposerSessionId ?? this.sidebarViewModel.getActiveSessionId();
		this.activeComposerSessionId = sessionId;
		this.storeDraft(sessionId, this.getComposerView()?.getValue() ?? '');
		this.updateContextWindowUsage();
	}

	persistDraft(sessionId: string | undefined = this.activeComposerSessionId): void {
		if (!sessionId) {
			return;
		}
		this.storeDraft(sessionId, this.getComposerView()?.getValue() ?? '');
	}

	switchToActiveSession(forceEmpty = false): void {
		const composerView = this.getComposerView();
		if (!composerView) {
			return;
		}
		const nextSessionId = this.sidebarViewModel.getActiveSessionId();
		const previousSessionId = this.activeComposerSessionId;
		if (previousSessionId === nextSessionId && !forceEmpty) {
			return;
		}
		if (previousSessionId && previousSessionId !== nextSessionId) {
			this.persistDraft(previousSessionId);
		}
		this.activeComposerSessionId = nextSessionId;
		if (forceEmpty) {
			this.drafts.delete(nextSessionId);
		}
		composerView.setValue(forceEmpty ? '' : this.drafts.get(nextSessionId) ?? '');
	}

	clearDraft(sessionId: string): void {
		this.drafts.delete(sessionId);
		if (this.activeComposerSessionId === sessionId) {
			this.activeComposerSessionId = undefined;
		}
	}

	resetActiveSession(): void {
		this.activeComposerSessionId = undefined;
	}

	updateContextWindowUsage(): void {
		const state = this.sidebarViewModel.getState();
		const maxTokens = Math.max(1, state.settings.contextWindow || CLEANSLATE_FALLBACK_CONTEXT_WINDOW_TOKENS);
		const usedTokens = this.estimateCurrentContextTokens();
		this.getComposerView()?.updateContextWindowUsage({ usedTokens, maxTokens, percent: (usedTokens / maxTokens) * 100, isGenerating: state.isGenerating });
	}

	private storeDraft(sessionId: string, value: string): void {
		if (value.length > 0) {
			this.drafts.set(sessionId, value);
		} else {
			this.drafts.delete(sessionId);
		}
	}

	private estimateCurrentContextTokens(): number {
		const history = this.sidebarViewModel.getRawHistoryReference();
		const inputValue = this.getComposerView()?.getValue() ?? '';
		const charCount = history.reduce((total, message) => total + this.estimateContextChars(message.role) + this.estimateContextChars(message.content) + this.estimateContextChars(message.renderPayload), this.estimateContextChars(inputValue));
		const selectionChars = this.sidebarViewModel.getPendingSelectionReferences().reduce((total, reference) => total + this.estimateContextChars(reference.selectedText) + this.estimateContextChars(reference.uri.toString()), 0);
		return Math.ceil((charCount + selectionChars) / 4) + this.sidebarViewModel.getPendingImages().length * 1024;
	}

	private estimateContextChars(value: unknown): number {
		if (typeof value === 'string') {
			return value.length;
		}
		if (Array.isArray(value)) {
			return value.reduce((total, item) => total + this.estimateContextChars(item), 0);
		}
		if (value && typeof value === 'object') {
			try {
				return JSON.stringify(value).length;
			} catch {
				return 0;
			}
		}
		return 0;
	}
}
