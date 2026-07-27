/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../../base/browser/dom.js';
import type { ICleanSlateTransportStatus } from '../../../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { ChatResponse, CleanSlateUserSelectionDisplay } from '../../types/cleanSlateChatTypes.js';
import { isCleanSlateControlTranscriptMessage, normalizeCleanSlateTranscriptOrder, parseCleanSlatePlanningAnswerQuestion } from '../../types/cleanSlateChatSessionTypes.js';
import { normalizeChatResponse, normalizePlanningQuestion } from '../../runtime/cleanSlateChatResponseNormalizer.js';
import { CleanSlateTranscriptRenderer } from '../../renderers/cleanSlateTranscriptRenderer.js';
import { parseCleanSlateUserSelectionDisplay } from '../../viewModel/cleanSlateChatViewHelpers.js';

export class CleanSlateTranscriptView {
	readonly element: HTMLElement;
	private readonly bottomEdgeFade: HTMLElement;
	private readonly scrollToBottomButton: HTMLButtonElement;
	// Auto-scroll follows the bottom while streaming until the user scrolls away.
	// Our own programmatic scrolls must be distinguished from genuine user
	// scrolls, or fast streaming falsely "un-sticks" the view. See markAutoScroll.
	private userScrolled = false;
	private pendingAutoScrollWrites = 0;
	private pendingScrollFrame: number | undefined;
	private smoothScrollInProgress = false;
	private scrollButtonDismissed = false;
	private transportStatusElement: HTMLElement | undefined;
	// Eased stick-to-bottom follow. Instead of snapping scrollTop to
	// the end on every stream delta — which steps by each chunk's height and reads
	// as jerky — a rAF loop glides scrollTop toward the bottom a fraction per frame.
	private followFrame: number | undefined;
	private lastWrittenTop = 0;
	private lastKnownScrollTop = 0;
	private followIdleSince = 0;
	// How far the settled position may differ from the last value we wrote before
	// an arriving scroll event counts as the user's rather than ours.
	private static readonly AUTO_SCROLL_TOLERANCE_PX = 2;
	private static readonly BOTTOM_THRESHOLD_PX = 10;
	// Fraction of the remaining distance to close each frame, plus a floor so the
	// glide never crawls to a stop on the last pixels. Tuned to keep up with fast
	// streaming while still visibly easing.
	private static readonly FOLLOW_EASE = 0.24;
	private static readonly FOLLOW_MIN_STEP_PX = 6;
	private static readonly FOLLOW_SNAP_PX = 1;
	// Upward movement (px) we did not write ourselves that counts as the user
	// grabbing the scroll and leaving the bottom.
	private static readonly USER_SCROLL_UP_PX = 8;
	// Keep the loop alive a beat after it settles so back-to-back deltas glide
	// continuously instead of restarting; stop it once streaming truly goes quiet.
	private static readonly FOLLOW_IDLE_STOP_MS = 900;

	// While replaying persisted history we must NOT re-fire the interactive planning
	// question for every turn that happens to carry a `planning_question` payload —
	// an already-answered question still has that field persisted. Instead we track
	// the question of the conversation *tail* and re-surface it once, only if the last
	// turn is an unanswered assistant question (any later user/assistant turn clears it).
	private isRestoringHistory = false;
	private restoreTailPlanningQuestion: NonNullable<ReturnType<typeof normalizePlanningQuestion>> | undefined;
	// Questions the transcript already carries an answer for. Tail position alone is not
	// enough: normalizeCleanSlateTranscriptOrder may hoist an answer above its question,
	// because an answer is worded from the question's own options and so scores as a
	// near-perfect text match for the turn it belongs to.
	private readonly restoreAnsweredQuestions = new Set<string>();

	constructor(
		container: HTMLElement,
		private readonly transcriptRenderer: CleanSlateTranscriptRenderer,
		private readonly onPlanningQuestion: (question: NonNullable<ReturnType<typeof normalizePlanningQuestion>>) => void
	) {
		const transcriptShell = dom.append(container, dom.$('.cleanSlate-transcript-shell'));
		this.element = dom.append(transcriptShell, dom.$('.cleanSlate-chat-messages'));
		this.bottomEdgeFade = dom.append(transcriptShell, dom.$('.cleanSlate-transcript-bottom-fade'));
		this.bottomEdgeFade.setAttribute('aria-hidden', 'true');
		this.scrollToBottomButton = dom.append(transcriptShell, dom.$('button.cleanSlate-scroll-to-bottom')) as HTMLButtonElement;
		this.scrollToBottomButton.type = 'button';
		this.scrollToBottomButton.title = 'Scroll to bottom';
		this.scrollToBottomButton.setAttribute('aria-label', 'Scroll to bottom');
		dom.append(this.scrollToBottomButton, dom.$('i.codicon.codicon-arrow-down'));
		this.scrollToBottomButton.addEventListener('click', () => this.smoothScrollToBottom());
		this.updateScrollToBottomButton();
		this.element.style.overflowAnchor = 'none';
		this.element.addEventListener('scroll', () => this.handleScroll(), { passive: true });
		// Only an explicit upward wheel gesture counts as the user leaving the bottom.
		this.element.addEventListener('wheel', (e: WheelEvent) => {
			if (this.smoothScrollInProgress) {
				this.cancelPendingScroll();
			}
			if (e.deltaY < 0) {
				this.scrollButtonDismissed = false;
				this.stopFollowing();
				this.updateScrollToBottomButton();
			}
		}, { passive: true });
	}

	clear(showEmptyState = false): void {
		this.cancelPendingScroll();
		this.transcriptRenderer.disposeMarkdownRenders();
		dom.clearNode(this.element);
		this.userScrolled = false;
		this.scrollButtonDismissed = false;
		this.element.style.overflowAnchor = 'none';
		this.transportStatusElement = undefined;
		this.updateScrollToBottomButton();
		if (showEmptyState) {
			this.renderEmptyState();
		}
	}

	restore(
		history: readonly { role: string; content: string; isInternalState?: boolean; renderPayload?: string; images?: string[] }[],
		fallbackAssistantContent?: string
	): void {
		this.clear();
		this.isRestoringHistory = true;
		this.restoreTailPlanningQuestion = undefined;
		this.restoreAnsweredQuestions.clear();
		this.collectAnsweredPlanningQuestions(history);
		let stats: { renderedCount: number; assistantCount: number };
		try {
			stats = this.renderSessionHistory(history);
			if (stats.assistantCount === 0 && typeof fallbackAssistantContent === 'string' && fallbackAssistantContent.trim().length > 0) {
				if (this.renderAssistantHistoryMessage({ content: fallbackAssistantContent })) {
					stats.renderedCount++;
					stats.assistantCount++;
				}
			}
		} finally {
			this.isRestoringHistory = false;
		}
		if (stats.renderedCount === 0) {
			this.renderEmptyState();
		}
		// Only re-open the picker when the restored conversation genuinely ends on an
		// unanswered question. Answered questions were superseded by a later turn during
		// the replay above, which cleared this.
		const pendingQuestion = this.restoreTailPlanningQuestion;
		this.restoreTailPlanningQuestion = undefined;
		this.restoreAnsweredQuestions.clear();
		if (pendingQuestion) {
			this.onPlanningQuestion(pendingQuestion);
		}
		this.scrollToBottom(true);
	}

	private collectAnsweredPlanningQuestions(
		history: readonly { role: string; renderPayload?: string }[]
	): void {
		for (const message of history) {
			if (message.role !== 'user') {
				continue;
			}
			const answered = parseCleanSlatePlanningAnswerQuestion(message.renderPayload);
			if (answered) {
				this.restoreAnsweredQuestions.add(answered);
			}
		}
	}

	addMessage(text: string, role: 'user' | 'cleanSlate', images?: string[]): HTMLElement {
		if (text.startsWith('QUOTA_EXCEEDED:')) {
			return this.renderQuotaError(text.replace('QUOTA_EXCEEDED:', '').trim());
		}

		const msg = this.createMessageElement(role, images, !!text);
		if (text) {
			const textEl = dom.append(msg, dom.$('span'));
			textEl.innerText = text;
		}
		this.scrollToBottom(role === 'user');
		return msg;
	}

	addUserSelectionMessage(display: CleanSlateUserSelectionDisplay, images?: string[]): HTMLElement {
		const msg = this.createMessageElement('user', images, true);
		msg.classList.add('cleanSlate-user-selection-message');
		msg.title = [display.label, display.command].filter(Boolean).join(' ');

		const icon = dom.append(msg, dom.$('.cleanSlate-user-selection-icon'));
		dom.append(icon, dom.$('i.codicon.codicon-symbol-file'));

		const body = dom.append(msg, dom.$('.cleanSlate-user-selection-body'));
		const label = dom.append(body, dom.$('.cleanSlate-user-selection-label'));
		label.textContent = display.label;

		if (display.command) {
			const command = dom.append(body, dom.$('.cleanSlate-user-selection-command'));
			command.textContent = display.command;
		}

		this.scrollToBottom(true);
		return msg;
	}

	private createMessageElement(role: 'user' | 'cleanSlate', images: string[] | undefined, hasText: boolean): HTMLElement {
		this.clearEmptyState();
		const row = dom.append(this.element, dom.$(`.cleanSlate-chat-message-row.${role}`));
		const msg = dom.append(row, dom.$(`.cleanSlate-chat-message.${role}`));

		if (images && images.length > 0) {
			const userImagesContainer = dom.append(msg, dom.$('.cleanSlate-user-images'));
			userImagesContainer.style.display = 'flex';
			userImagesContainer.style.flexWrap = 'wrap';
			userImagesContainer.style.gap = '8px';
			userImagesContainer.style.marginBottom = hasText ? '8px' : '0';

			for (const imgData of images) {
				const imgEl = dom.append(userImagesContainer, dom.$('img')) as HTMLImageElement;
				imgEl.src = imgData;
				imgEl.style.maxWidth = '150px';
				imgEl.style.maxHeight = '150px';
				imgEl.style.borderRadius = '6px';
				imgEl.style.objectFit = 'contain';
				// Let the user reopen the upload at full size — the thumbnail alone
				// isn't enough to actually re-read what was sent.
				imgEl.style.cursor = 'zoom-in';
				imgEl.title = 'Click to view full size';
				imgEl.addEventListener('click', () => this.openImageLightbox(imgData));
			}
		}

		return msg;
	}

	private openImageLightbox(src: string): void {
		const overlay = dom.append(this.element.ownerDocument.body, dom.$('.cleanSlate-image-lightbox'));
		overlay.style.position = 'fixed';
		overlay.style.inset = '0';
		overlay.style.zIndex = '10000';
		overlay.style.display = 'flex';
		overlay.style.alignItems = 'center';
		overlay.style.justifyContent = 'center';
		overlay.style.padding = '32px';
		overlay.style.background = 'rgba(0, 0, 0, 0.72)';
		overlay.style.cursor = 'zoom-out';

		const full = dom.append(overlay, dom.$('img')) as HTMLImageElement;
		full.src = src;
		full.style.maxWidth = '100%';
		full.style.maxHeight = '100%';
		full.style.objectFit = 'contain';
		full.style.borderRadius = '8px';
		full.style.boxShadow = '0 12px 48px rgba(0, 0, 0, 0.5)';

		const close = () => {
			overlay.remove();
			this.element.ownerDocument.removeEventListener('keydown', onKey);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				close();
			}
		};
		overlay.addEventListener('click', close);
		this.element.ownerDocument.addEventListener('keydown', onKey);
	}

	addSystemConfirmation(title: string, message: string, icon: string = 'check'): HTMLElement {
		this.clearEmptyState();
		const container = dom.append(this.element, dom.$('.cleanSlate-system-confirmation'));
		dom.append(container, dom.$('.cleanSlate-system-confirmation-glow'));

		const inner = dom.append(container, dom.$('.cleanSlate-system-confirmation-inner'));
		const header = dom.append(inner, dom.$('.cleanSlate-system-confirmation-header'));
		const iconContainer = dom.append(header, dom.$('.cleanSlate-system-confirmation-icon'));
		dom.append(iconContainer, dom.$(`i.codicon.codicon-${icon}`));
		dom.append(header, dom.$('.cleanSlate-system-confirmation-title')).textContent = title;

		if (message) {
			const body = dom.append(inner, dom.$('.cleanSlate-system-confirmation-body'));
			body.textContent = message;
		}

		this.scrollToBottom();
		return container;
	}

	showTransportRetry(status: ICleanSlateTransportStatus): void {
		this.clearEmptyState();
		this.element.querySelectorAll('.cleanSlate-working-placeholder.placeholder').forEach(placeholder => placeholder.remove());
		let container = this.transportStatusElement;
		if (!container?.isConnected) {
			container = dom.append(this.element, dom.$('.cleanSlate-transport-status'));
			dom.append(container, dom.$('i.codicon.codicon-loading.codicon-modifier-spin'));
			dom.append(container, dom.$('.cleanSlate-transport-status-copy'));
			this.transportStatusElement = container;
		}

		const copy = container.querySelector<HTMLElement>('.cleanSlate-transport-status-copy');
		if (copy) {
			copy.textContent = `Reconnecting... ${status.attempt}/${status.maxAttempts}`;
		}
		container.title = status.delayMs
			? `Retrying the model connection in ${Math.max(1, Math.ceil(status.delayMs / 1000))}s`
			: 'Retrying the model connection';
		this.scrollToBottom();
	}

	clearTransportRetry(): void {
		this.transportStatusElement?.remove();
		this.transportStatusElement = undefined;
	}

	addModelTerminated(_message: string, onContinue: () => void): HTMLElement {
		this.removeStreamingPlaceholders();
		this.clearTransportRetry();
		this.clearEmptyState();
		this.element.querySelectorAll('.cleanSlate-model-terminated-card').forEach(card => card.remove());

		const card = dom.append(this.element, dom.$('.cleanSlate-model-terminated-card'));
		const header = dom.append(card, dom.$('.cleanSlate-model-terminated-header'));
		dom.append(header, dom.$('i.codicon.codicon-debug-disconnect'));
		dom.append(header, dom.$('span')).textContent = 'Model terminated';

		const actions = dom.append(card, dom.$('.cleanSlate-model-terminated-actions'));
		const continueButton = dom.append(actions, dom.$('button.cleanSlate-model-continue-button')) as HTMLButtonElement;
		continueButton.type = 'button';
		continueButton.textContent = 'Continue';
		continueButton.addEventListener('click', () => {
			if (continueButton.disabled) {
				return;
			}
			continueButton.disabled = true;
			card.remove();
			onContinue();
		});

		this.scrollToBottom();
		return card;
	}

	removeStreamingPlaceholders(): void {
		const messages = this.element.querySelectorAll('.cleanSlate-chat-message.cleanSlate');
		messages.forEach(msg => {
			const hasExecutionPlan = !!msg.querySelector('.cleanSlate-message-execution-plan');
			const hasTranscript = !!msg.querySelector('.cleanSlate-message-transcript');
			const placeholders = msg.querySelectorAll('.cleanSlate-working-placeholder.placeholder');
			if (placeholders.length > 0 && (hasExecutionPlan || hasTranscript)) {
				placeholders.forEach(placeholder => placeholder.remove());
			} else if (placeholders.length > 0) {
				msg.remove();
			} else if (!hasExecutionPlan && !hasTranscript && msg.textContent?.trim() === '') {
				msg.remove();
			}
		});
	}

	setLiveThinkingIndicator(isGenerating: boolean): void {
		const liveMessages = Array.from(this.element.querySelectorAll('.cleanSlate-chat-message.cleanSlate[data-clean-slate-live-thinking="true"]')) as HTMLElement[];
		const liveMessage = liveMessages[0] ?? null;
		for (const duplicate of liveMessages.slice(1)) {
			this.removeMessageElement(duplicate);
		}

		if (!isGenerating) {
			for (const message of liveMessages) {
				if (message.isConnected) {
					this.removeMessageElement(message);
				}
			}
			return;
		}

		if (this.hasNonLiveWorkingIndicator()) {
			if (liveMessage?.isConnected) {
				this.removeMessageElement(liveMessage);
			}
			return;
		}

		const target = liveMessage ?? this.addMessage('', 'cleanSlate');
		target.dataset.cleanSlateLiveThinking = 'true';
		this.renderJSONResponse({}, true, target);
	}

	private hasNonLiveWorkingIndicator(): boolean {
		const indicators = this.element.querySelectorAll('.cleanSlate-working-placeholder.placeholder, .cleanSlate-working-row');
		for (const indicator of indicators) {
			if (!indicator.closest('.cleanSlate-chat-message.cleanSlate[data-clean-slate-live-thinking="true"]')) {
				return true;
			}
		}
		return false;
	}

	private removeMessageElement(message: HTMLElement): void {
		const row = message.closest('.cleanSlate-chat-message-row');
		if (row?.parentElement === this.element) {
			row.remove();
			return;
		}
		message.remove();
	}

	scrollToBottom(force = false): void {
		// `force` (a new user message, explicit jump) resumes following unconditionally
		// and lands immediately — a brand-new message shouldn't drift in.
		if (force) {
			this.userScrolled = false;
			this.updateOverflowAnchor();
			this.cancelPendingScroll();
			this.stopFollowLoop();
			this.applyScrollToBottom();
			return;
		}

		if (this.userScrolled) {
			return;
		}
		// Streaming path: glide toward the bottom instead of snapping each delta.
		this.ensureFollowLoop();
	}

	// Start (or keep feeding) the eased follow loop. Cheap to call on every delta:
	// it no-ops while the loop is already running and just refreshes the idle clock.
	private ensureFollowLoop(): void {
		if (this.userScrolled || this.smoothScrollInProgress) {
			return;
		}
		this.followIdleSince = 0;
		if (this.followFrame !== undefined) {
			return;
		}
		const target = Math.max(0, this.element.scrollHeight - this.element.clientHeight);
		if (target - this.element.scrollTop <= CleanSlateTranscriptView.FOLLOW_SNAP_PX) {
			// Already pinned — nothing to animate, just keep the anchor/button honest.
			this.lastWrittenTop = target;
			this.updateOverflowAnchor();
			this.updateScrollToBottomButton();
			return;
		}
		this.startFollowLoop();
	}

	private startFollowLoop(): void {
		const win = dom.getWindow(this.element);
		const step = () => {
			if (this.userScrolled || this.smoothScrollInProgress) {
				this.followFrame = undefined;
				return;
			}
			const target = Math.max(0, this.element.scrollHeight - this.element.clientHeight);
			const current = this.element.scrollTop;
			const diff = target - current;

			if (diff <= CleanSlateTranscriptView.FOLLOW_SNAP_PX) {
				// Pinned. Linger briefly so the next delta continues the same glide,
				// then let the loop die once streaming stops producing new content.
				if (diff > 0) {
					this.writeFollowTop(target);
				}
				const now = Date.now();
				if (this.followIdleSince === 0) {
					this.followIdleSince = now;
				}
				if (now - this.followIdleSince >= CleanSlateTranscriptView.FOLLOW_IDLE_STOP_MS) {
					this.followFrame = undefined;
					this.updateScrollToBottomButton();
					return;
				}
				this.followFrame = win.requestAnimationFrame(step);
				return;
			}

			this.followIdleSince = 0;
			const move = Math.max(CleanSlateTranscriptView.FOLLOW_MIN_STEP_PX, diff * CleanSlateTranscriptView.FOLLOW_EASE);
			this.writeFollowTop(Math.min(target, current + move));
			this.followFrame = win.requestAnimationFrame(step);
		};
		this.followFrame = win.requestAnimationFrame(step);
	}

	// One eased write. Kept to a pure scrollTop write — no layout reads afterward —
	// so the glide never triggers a synchronous reflow mid-frame. The button stays
	// hidden and the anchor stays 'none' for the whole follow, both already set when
	// following began. Records the position so handleScroll can tell our own downward
	// glide apart from the user dragging the scroll upward.
	private writeFollowTop(top: number): void {
		this.lastWrittenTop = top;
		this.element.scrollTop = top;
	}

	private stopFollowLoop(): void {
		if (this.followFrame === undefined) {
			return;
		}
		dom.getWindow(this.element).cancelAnimationFrame(this.followFrame);
		this.followFrame = undefined;
	}

	private smoothScrollToBottom(): void {
		if (!this.canScroll()) {
			this.scrollToBottom(true);
			return;
		}

		this.cancelPendingScroll();
		// Keep streaming renders from snapping to the end while the smooth
		// animation is in flight. Following resumes once we actually arrive.
		this.userScrolled = true;
		this.smoothScrollInProgress = true;
		this.scrollButtonDismissed = true;
		this.updateOverflowAnchor();
		this.updateScrollToBottomButton();

		const win = dom.getWindow(this.element);
		const startedAt = Date.now();
		this.element.scrollTo({
			top: Math.max(0, this.element.scrollHeight - this.element.clientHeight),
			behavior: 'smooth'
		});

		const finishWhenSettled = () => {
			if (!this.smoothScrollInProgress) {
				this.pendingScrollFrame = undefined;
				return;
			}
			if (this.distanceFromBottom() < CleanSlateTranscriptView.BOTTOM_THRESHOLD_PX || Date.now() - startedAt > 1200) {
				this.smoothScrollInProgress = false;
				this.pendingScrollFrame = undefined;
				this.userScrolled = false;
				this.updateOverflowAnchor();
				this.applyScrollToBottom();
				return;
			}
			this.pendingScrollFrame = win.requestAnimationFrame(finishWhenSettled);
		};
		this.pendingScrollFrame = win.requestAnimationFrame(finishWhenSettled);
	}

	private distanceFromBottom(): number {
		return this.element.scrollHeight - this.element.scrollTop - this.element.clientHeight;
	}

	private canScroll(): boolean {
		return this.element.scrollHeight - this.element.clientHeight > 1;
	}

	// The browser dispatches `scroll` asynchronously, so an event we caused can
	// arrive after the content has already grown past the position we wrote. A
	// naive handler reads that as "not at the bottom" and un-sticks the view
	// mid-stream.
	//
	// Rather than timestamping each write, we count outstanding writes: every
	// programmatic scroll increments the counter, and each arriving event
	// consumes one. While the counter is non-zero the event is ours, so it is
	// ignored. Nothing expires on a timer — a write and its event are one to
	// one — and any surplus is drained if the element settles at a position we
	// never wrote.
	private markAutoScroll(): void {
		this.pendingAutoScrollWrites++;
	}

	private isAutoScroll(): boolean {
		if (this.pendingAutoScrollWrites <= 0) {
			return false;
		}
		this.pendingAutoScrollWrites--;
		// A scroll that settled somewhere we never wrote means the user moved in
		// the same frame; drop the rest of the queue so the next event is treated
		// as genuine input.
		if (Math.abs(this.element.scrollTop - this.lastWrittenTop) > CleanSlateTranscriptView.AUTO_SCROLL_TOLERANCE_PX) {
			this.pendingAutoScrollWrites = 0;
			return false;
		}
		return true;
	}

	private applyScrollToBottom(): void {
		const target = Math.max(0, this.element.scrollHeight - this.element.clientHeight);
		this.markAutoScroll();
		this.lastWrittenTop = target;
		// Direct scrollTop assignment is immediate (bypasses CSS smooth scrolling),
		// so the bottom stays pinned in the same frame content grows — no lag/jump.
		if (Math.abs(this.element.scrollTop - target) > 1) {
			this.element.scrollTop = target;
		}
		this.updateOverflowAnchor();
		this.updateScrollToBottomButton();
	}

	private stopFollowing(): void {
		if (!this.canScroll() || this.userScrolled) {
			return;
		}
		this.userScrolled = true;
		this.scrollButtonDismissed = false;
		this.stopFollowLoop();
		this.updateOverflowAnchor();
		this.updateScrollToBottomButton();
	}

	private handleScroll(): void {
		const scrollTop = this.element.scrollTop;
		const previousScrollTop = this.lastKnownScrollTop;
		this.lastKnownScrollTop = scrollTop;

		if (this.smoothScrollInProgress) {
			if (this.distanceFromBottom() < CleanSlateTranscriptView.BOTTOM_THRESHOLD_PX) {
				this.smoothScrollInProgress = false;
				this.cancelPendingScroll();
				this.userScrolled = false;
				this.updateOverflowAnchor();
			}
			this.updateScrollToBottomButton();
			return;
		}
		if (!this.canScroll()) {
			this.userScrolled = false;
			this.updateOverflowAnchor();
			this.updateScrollToBottomButton();
			return;
		}
		if (this.distanceFromBottom() < CleanSlateTranscriptView.BOTTOM_THRESHOLD_PX) {
			this.userScrolled = false;
			this.updateOverflowAnchor();
			this.updateScrollToBottomButton();
			return;
		}
		// While the eased follow loop owns the scroll, its own writes only ever move
		// downward toward the bottom. So the only thing that unsticks following is an
		// upward move we did not write — the user grabbing the scrollbar/trackpad.
		if (!this.userScrolled && this.followFrame !== undefined) {
			const movedUp = scrollTop < previousScrollTop - CleanSlateTranscriptView.USER_SCROLL_UP_PX
				&& scrollTop < this.lastWrittenTop - CleanSlateTranscriptView.USER_SCROLL_UP_PX;
			if (movedUp) {
				this.stopFollowing();
			}
			this.updateScrollToBottomButton();
			return;
		}
		// A scroll event that lands exactly where our own programmatic scroll aimed
		// is ours, not the user's — keep following.
		if (!this.userScrolled && this.isAutoScroll()) {
			this.applyScrollToBottom();
			return;
		}
		this.stopFollowing();
	}

	private updateScrollToBottomButton(): void {
		const showBottomFade = this.canScroll()
			&& this.distanceFromBottom() >= CleanSlateTranscriptView.BOTTOM_THRESHOLD_PX;
		this.bottomEdgeFade.classList.toggle('visible', showBottomFade);

		const show = !this.smoothScrollInProgress
			&& !this.scrollButtonDismissed
			&& this.userScrolled
			&& this.canScroll()
			&& this.distanceFromBottom() >= CleanSlateTranscriptView.BOTTOM_THRESHOLD_PX;
		this.scrollToBottomButton.classList.toggle('visible', show);
		// Fully remove the control from rendering and hit testing at the bottom.
		// Opacity alone can leave a stale circular button visible after layout shifts.
		this.scrollToBottomButton.hidden = !show;
		this.scrollToBottomButton.tabIndex = show ? 0 : -1;
		this.scrollToBottomButton.setAttribute('aria-hidden', show ? 'false' : 'true');
	}

	private updateOverflowAnchor(): void {
		this.element.style.overflowAnchor = this.userScrolled ? 'auto' : 'none';
	}

	private cancelPendingScroll(): void {
		this.smoothScrollInProgress = false;
		this.stopFollowLoop();
		if (this.pendingScrollFrame === undefined) {
			return;
		}

		dom.getWindow(this.element).cancelAnimationFrame(this.pendingScrollFrame);
		this.pendingScrollFrame = undefined;
	}

	renderJSONResponse(data: ChatResponse, isStreaming: boolean, targetMessage?: HTMLElement): void {
		const planningQuestion = normalizePlanningQuestion(data.planning_question);
		if (this.isRestoringHistory) {
			// Each restored assistant turn overwrites the tail: it either carries the
			// (still-unanswered) question, or clears an earlier one now superseded.
			const isUnanswered = !!planningQuestion
				&& !isStreaming
				&& !this.restoreAnsweredQuestions.has(planningQuestion.question.trim());
			this.restoreTailPlanningQuestion = isUnanswered ? planningQuestion : undefined;
		} else if (planningQuestion && !isStreaming) {
			this.onPlanningQuestion(planningQuestion);
		}

		const wasFollowing = !this.userScrolled;

		this.transcriptRenderer.renderJSONResponse(
			data,
			isStreaming,
			this.element,
			targetMessage,
			() => this.stabilizeAfterContentRender()
		);

		// The standalone live "Thinking…" fallback is added when Agent Manager mounts
		// over an already-generating session (setLiveThinkingIndicator). Once the real
		// streaming turn re-attaches and shows something, drop the fallback so the two
		// "Thinking…" indicators never render side by side.
		if (targetMessage?.dataset.cleanSlateLiveThinking !== 'true') {
			this.dropSupersededLiveThinkingIndicator(targetMessage);
		}

		this.stabilizeAfterContentRender(wasFollowing);
	}

	private dropSupersededLiveThinkingIndicator(target?: HTMLElement): void {
		const liveMessages = Array.from(
			this.element.querySelectorAll('.cleanSlate-chat-message.cleanSlate[data-clean-slate-live-thinking="true"]')
		) as HTMLElement[];
		if (liveMessages.length === 0) {
			return;
		}
		// Only supersede once the real turn actually shows something (a working
		// indicator or rendered content); otherwise the fallback stays visible so the
		// user is never left with a blank, silent transcript mid-generation.
		const realTarget = target && target.dataset.cleanSlateLiveThinking !== 'true' && target.isConnected ? target : undefined;
		const realHasContent = realTarget ? this.messageHasVisibleTranscript(realTarget) : this.hasNonLiveWorkingIndicator();
		if (!realHasContent) {
			return;
		}
		for (const live of liveMessages) {
			this.removeMessageElement(live);
		}
	}

	private messageHasVisibleTranscript(message: HTMLElement): boolean {
		const transcript = message.querySelector('.cleanSlate-message-transcript');
		return !!transcript && (transcript.children.length > 0 || !!transcript.textContent?.trim());
	}

	private stabilizeAfterContentRender(wasFollowing?: boolean): void {
		// While following the bottom, re-pin in the same frame content changed so
		// streaming never lags behind or jumps. When the user has scrolled away,
		// overflow-anchor: auto keeps their viewport stable — no manual fix-up.
		if (wasFollowing ?? !this.userScrolled) {
			this.applyScrollToBottom();
		}
	}

	private renderSessionHistory(
		history: readonly { id?: string; role: string; content: string; isInternalState?: boolean; renderPayload?: string; images?: string[] }[]
	): { renderedCount: number; assistantCount: number } {
		let renderedCount = 0;
		let assistantCount = 0;
		const normalizedHistory = normalizeCleanSlateTranscriptOrder(history);

		for (const message of normalizedHistory) {
			if (message.role === 'user') {
				// Any user turn after a question means it was answered — supersede it so
				// the picker is not re-surfaced even if no assistant continuation exists yet.
				this.restoreTailPlanningQuestion = undefined;
				if (message.isInternalState || !message.content.trim() || isCleanSlateControlTranscriptMessage(message)) {
					continue;
				}
				const selectionDisplay = parseCleanSlateUserSelectionDisplay(message.renderPayload);
				const element = selectionDisplay
					? this.addUserSelectionMessage(selectionDisplay, message.images)
					: this.addMessage(message.content, 'user', message.images);
				if (message.id) {
					element.dataset.cleanSlateTranscriptId = message.id;
				}
				renderedCount++;
				continue;
			}

			if (message.role === 'assistant' || message.role === 'cleanSlate') {
				if (this.renderAssistantHistoryMessage(message)) {
					renderedCount++;
					assistantCount++;
				}
			}
		}

		return { renderedCount, assistantCount };
	}

	private renderAssistantHistoryMessage(message: { id?: string; content: string; isInternalState?: boolean; renderPayload?: string }): boolean {
		if (typeof message.renderPayload === 'string' && message.renderPayload.trim().length > 0) {
			try {
				const persisted = this.toRestorableTranscriptPayload(normalizeChatResponse(JSON.parse(message.renderPayload) as ChatResponse));
				if (this.hasRenderableAssistantPayload(persisted)) {
					const target = this.addMessage('', 'cleanSlate');
					if (message.id) {
						target.dataset.cleanSlateTranscriptId = message.id;
					}
					this.renderJSONResponse(persisted, this.shouldRestorePayloadAsStreaming(persisted), target);
					return true;
				}
			} catch {
			}
		}

		const content = typeof message.content === 'string' ? message.content.trim() : '';
		if (!content) {
			return false;
		}

		try {
			const parsed = this.toRestorableTranscriptPayload(normalizeChatResponse(JSON.parse(content) as ChatResponse));
			if (!this.hasRenderableAssistantPayload(parsed)) {
				if (message.isInternalState) {
					return false;
				}
				const target = this.addMessage(content, 'cleanSlate');
				if (message.id) {
					target.dataset.cleanSlateTranscriptId = message.id;
				}
				return true;
			}

			const target = this.addMessage('', 'cleanSlate');
			if (message.id) {
				target.dataset.cleanSlateTranscriptId = message.id;
			}
			this.renderJSONResponse(parsed, this.shouldRestorePayloadAsStreaming(parsed), target);
			return true;
		} catch {
			if (message.isInternalState) {
				return false;
			}
			const target = this.addMessage(content, 'cleanSlate');
			if (message.id) {
				target.dataset.cleanSlateTranscriptId = message.id;
			}
			return true;
		}
	}

	private hasRenderableAssistantPayload(parsed: ChatResponse): boolean {
		const hasSummary = Array.isArray(parsed.summary)
			? parsed.summary.some(summary => typeof summary === 'string' && summary.trim().length > 0)
			: (typeof parsed.summary === 'string' && parsed.summary.trim().length > 0);
		const hasSteps = Array.isArray(parsed.to_do) && parsed.to_do.length > 0;
		const hasPlanningQuestion = !!normalizePlanningQuestion(parsed.planning_question);
		const hasTimeline = Array.isArray(parsed.timeline) && parsed.timeline.length > 0;
		const hasCodeSnippet = typeof parsed.code_snippet === 'string' && parsed.code_snippet.trim().length > 0;

		return hasSummary || hasSteps || hasPlanningQuestion || hasTimeline || hasCodeSnippet;
	}

	private shouldRestorePayloadAsStreaming(parsed: ChatResponse): boolean {
		if (parsed.transcriptStatus === 'completed' || parsed.transcriptStatus === 'interrupted') {
			return false;
		}
		return Array.isArray(parsed.timeline) && parsed.timeline.some(block => this.isStreamingTimelineBlock(block));
	}

	private isStreamingTimelineBlock(block: NonNullable<ChatResponse['timeline']>[number]): boolean {
		if (block.isStreaming === true
			|| block.toolStatus === 'running'
			|| block.browserStatus === 'running'
			|| block.webStatus === 'running'
		) {
			return true;
		}

		const status = typeof block.status === 'string' ? block.status.trim().toLowerCase() : '';
		if (status === 'running' || status === 'working' || status === 'pending' || status.endsWith('...')) {
			return true;
		}

		return Array.isArray(block.blocks) && block.blocks.some(child => this.isStreamingTimelineBlock(child));
	}

	private toRestorableTranscriptPayload(parsed: ChatResponse): ChatResponse {
		if (parsed.transcriptStatus || !Array.isArray(parsed.timeline) || parsed.timeline.length === 0) {
			return parsed;
		}

		return {
			...parsed,
			transcriptStatus: 'completed'
		};
	}

	private renderEmptyState(): void {
		this.clearEmptyState();
	}

	private clearEmptyState(): void {
		const emptyState = this.element.querySelector('.cleanSlate-empty-state');
		if (emptyState) {
			emptyState.remove();
		}
	}

	private renderQuotaError(message: string): HTMLElement {
		this.removeStreamingPlaceholders();
		const card = dom.append(this.element, dom.$('.cleanSlate-quota-card'));

		const header = dom.append(card, dom.$('.cleanSlate-quota-header'));
		dom.append(header, dom.$('i.codicon.codicon-error'));
		dom.append(header, dom.$('span')).textContent = 'Model quota limit exceeded';

		const body = dom.append(card, dom.$('.cleanSlate-quota-body'));
		body.textContent = message;

		this.scrollToBottom();
		return card;
	}
}
