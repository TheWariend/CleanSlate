/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICleanSlateBrowserAutomationService, type CleanSlateBrowserSurface } from '../../core/cleanSlateBrowserAutomationService.js';
import { CleanSlateComposerView } from '../view/sections/cleanSlateComposerView.js';
import { IResponseRenderer } from '../types/cleanSlateChatTypes.js';
import { buildCleanSlateAnnotationSubmitContext, buildCleanSlateSelectionSubmitContext, createCleanSlateUserSelectionDisplay, formatCleanSlateUserSelectionDisplayText, stringifyCleanSlateUserSelectionDisplay } from './cleanSlateChatViewHelpers.js';
import { CleanSlateChatSidebarViewModel } from './cleanSlateChatSidebarViewModel.js';
import type { ICleanSlateEditorSelectionReference } from '../providers/cleanSlateChatComposerProvider.js';

export interface ICleanSlateMessageSubmitControllerOptions {
	readonly getComposerView: () => CleanSlateComposerView;
	readonly getRenderer: () => IResponseRenderer;
	readonly onBeforeSend: () => void;
	readonly onUpdateTitle: () => void;
	readonly onAnnotationsChanged: () => void;
	readonly getImplicitSelectionReference?: () => ICleanSlateEditorSelectionReference | undefined;
}

export class CleanSlateMessageSubmitController {
	constructor(
		private readonly sidebarViewModel: CleanSlateChatSidebarViewModel,
		private readonly browserAutomationService: ICleanSlateBrowserAutomationService,
		private readonly options: ICleanSlateMessageSubmitControllerOptions,
		private readonly browserSurface: CleanSlateBrowserSurface | (() => CleanSlateBrowserSurface) = 'ide'
	) { }

	async sendSynthetic(text: string): Promise<void> {
		if (!text.trim()) {
			return;
		}

		const sessionId = this.sidebarViewModel.getActiveSessionId();
		if (text.trim().toLowerCase() !== 'continue') {
			this.options.getRenderer().addMessage(text, 'user');
			this.sidebarViewModel.recordTranscriptMessage({ role: 'user', content: text });
		}
		this.options.onUpdateTitle();

		return this.sidebarViewModel.sendMessage(
			text,
			this.options.getRenderer(),
			(isGenerating) => {
				if (this.sidebarViewModel.getActiveSessionId() === sessionId) {
					this.options.getComposerView().setGenerating(isGenerating);
					this.options.onUpdateTitle();
				}
			}
		).finally(() => {
			if (this.sidebarViewModel.getActiveSessionId() === sessionId) {
				this.options.onUpdateTitle();
			}
		});
	}

	/**
	 * `userRenderPayload` tags the recorded user turn (e.g. as a planning-question
	 * answer) so a restored transcript can classify it without re-reading its text.
	 */
	async send(messageOverride?: string, displayOverride?: string, options?: { readonly userRenderPayload?: string }): Promise<void> {
		const composerView = this.options.getComposerView();
		const sessionId = this.sidebarViewModel.getActiveSessionId();
		const rawInput = (messageOverride ?? composerView.getValue()).trim();
		if (this.sidebarViewModel.hasPendingCommandApproval()) {
			if (!rawInput) {
				return;
			}
			const approvalResolved = this.sidebarViewModel.resolvePendingCommandApprovalFromChat(rawInput, this.options.getRenderer());
			if (approvalResolved) {
				composerView.clearValue();
				const displayText = displayOverride ?? rawInput;
				this.options.getRenderer().addMessage(displayText, 'user');
				this.sidebarViewModel.recordTranscriptMessage({ role: 'user', content: displayText });
				this.options.onUpdateTitle();
			}
			return;
		}

		if (this.sidebarViewModel.getIsGenerating()) {
			this.sidebarViewModel.abortGeneration(this.options.getRenderer());
			return;
		}

		const browserSurface = this.resolveBrowserSurface();
		const annotations = this.browserAutomationService.listCachedAnnotations(browserSurface);
		const annotationContext = buildCleanSlateAnnotationSubmitContext(annotations);
		const pendingSelectionReferences = this.sidebarViewModel.getPendingSelectionReferences();
		const implicitSelectionReference = pendingSelectionReferences.length === 0 && this.shouldAttachCurrentSelection(rawInput)
			? this.options.getImplicitSelectionReference?.()
			: undefined;
		const selectionReferences = implicitSelectionReference
			? [implicitSelectionReference]
			: pendingSelectionReferences;
		const selectionContext = buildCleanSlateSelectionSubmitContext(selectionReferences);
		const baseInput = rawInput
			|| (selectionReferences.length > 0
				? 'Use the attached editor selection(s) as context for this request.'
				: '');
		const input = [
			baseInput,
			selectionContext,
			annotationContext
		].filter(part => part.trim().length > 0).join('\n\n');
		const images = [...this.sidebarViewModel.getPendingImages()];
		if (!input && images.length === 0) {
			return;
		}

		composerView.clearValue();
		if (annotations.length > 0) {
			composerView.suppressAnnotationReferences();
		}

		this.sidebarViewModel.clearPendingImages();
		this.sidebarViewModel.clearPendingSelectionReferences();
		this.options.onBeforeSend();

		const annotationDisplay = annotations.length === 1 ? '1 annotation' : `${annotations.length} annotations`;
		const selectionDisplay = createCleanSlateUserSelectionDisplay(selectionReferences, rawInput);
		const displayText = displayOverride ?? (selectionDisplay ? formatCleanSlateUserSelectionDisplayText(selectionDisplay) : rawInput || (annotations.length > 0 ? annotationDisplay : input));
		const renderer = this.options.getRenderer();
		if (selectionDisplay && !displayOverride && renderer.addUserSelectionMessage) {
			renderer.addUserSelectionMessage(selectionDisplay, images);
			this.sidebarViewModel.recordTranscriptMessage({
				role: 'user',
				content: displayText,
				images,
				renderPayload: stringifyCleanSlateUserSelectionDisplay(selectionDisplay)
			});
		} else {
			renderer.addMessage(displayText, 'user', images);
			this.sidebarViewModel.recordTranscriptMessage({
				role: 'user',
				content: displayText,
				images,
				...(options?.userRenderPayload ? { renderPayload: options.userRenderPayload } : {})
			});
		}
		this.options.onUpdateTitle();

		this.sidebarViewModel.sendMessage(
			input,
			this.options.getRenderer(),
			(isGenerating) => {
				if (this.sidebarViewModel.getActiveSessionId() === sessionId) {
					composerView.setGenerating(isGenerating);
					this.options.onUpdateTitle();
				}
			},
			images
		).catch(err => {
			console.error(err);
		}).finally(() => {
			if (annotations.length > 0) {
				void this.browserAutomationService.clearAnnotations(browserSurface)
					.catch(() => undefined)
					.finally(() => {
						if (this.sidebarViewModel.getActiveSessionId() === sessionId) {
							composerView.clearAnnotationSuppression(this.browserAutomationService.listCachedAnnotations(browserSurface));
							this.options.onAnnotationsChanged();
						}
					});
			}
			if (this.sidebarViewModel.getActiveSessionId() === sessionId) {
				this.options.onUpdateTitle();
			}
		});
	}

	private shouldAttachCurrentSelection(rawInput: string): boolean {
		return /^\/(?:fix|explain|test|rewrite|doc|review|optimize|migrate)(?:\s|$)/i.test(rawInput);
	}

	private resolveBrowserSurface(): CleanSlateBrowserSurface {
		return typeof this.browserSurface === 'function' ? this.browserSurface() : this.browserSurface;
	}

}
