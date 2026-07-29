/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../../base/browser/dom.js';
import type { ICleanSlateBrowserAnnotation } from '../../../core/cleanSlateBrowserAutomationService.js';
import { policy } from '../../runtime/cleanSlateChatController.js';
import { SLASH_COMMANDS } from '@cleanslate/sdk/composer/commands/slashCommands.js';
import type { ICleanSlateEditorSelectionReference } from '../../providers/cleanSlateChatComposerProvider.js';
import { setCleanSlateProviderLogo } from '../../providers/cleanSlateProviderLogos.js';
import type { AIProvider } from '../../../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { formatCleanSlateSelectionReferenceLabel } from '../../viewModel/cleanSlateChatViewHelpers.js';

export interface ICleanSlateContextWindowUsage {
	readonly usedTokens: number;
	readonly maxTokens: number;
	readonly percent: number;
	readonly isGenerating: boolean;
}

export interface ICleanSlateComposerViewOptions {
	readonly workspaceName?: string;
	readonly onWorkspaceSelector?: (anchor: HTMLElement) => void;
	/** Optional larger surface that should accept dropped image files. */
	readonly imageDropTarget?: HTMLElement;
	readonly mountPanels: (inputBox: HTMLElement) => void;
	readonly onSubmit: () => void;
	readonly onImageAdded: (imageDataUrl: string) => void;
	readonly onImageRemoved: (index: number) => void;
	readonly onReasoningSelector: (anchor: HTMLElement) => void;
	readonly onPlanModeCommand: () => void;
	readonly onPlanModeDisabled: () => void;
	readonly onModelSelector: (anchor: HTMLElement) => void;
	readonly onDeleteAnnotations: (annotations: readonly ICleanSlateBrowserAnnotation[]) => void;
	readonly onRemoveSelectionReference: (index: number) => void;
	readonly onDidInputChange?: () => void;
	readonly onEscape?: () => boolean;
	readonly onKeyDown?: (event: KeyboardEvent) => boolean;
}

interface ICleanSlateSlashCommandItem {
	readonly id: string;
	readonly label: string;
	readonly description: string;
	readonly icon: string;
	readonly kind: 'insert' | 'plan';
}

export class CleanSlateComposerView {
	private static readonly CommandPopupGap = 10;
	private static readonly CommandPopupMinHeight = 96;
	private static readonly CommandPopupMaxHeight = 520;
	private static readonly InputMaxHeight = 240;

	private readonly inputContainer: HTMLElement;
	private readonly inputBox: HTMLElement;
	private readonly commandPopup: HTMLElement;
	private readonly imagePreviewContainer: HTMLElement;
	private readonly selectionRefsContainer: HTMLElement;
	private readonly annotationRefsContainer: HTMLElement;
	private readonly inputElement: HTMLTextAreaElement;
	private sendButton!: HTMLElement;
	private reasoningDropdown!: HTMLElement;
	private planModeChip!: HTMLElement;
	private modelDropdown!: HTMLElement;
	private modelProviderLogo!: HTMLElement;
	private contextWindowButton!: HTMLElement;
	private contextWindowTooltip!: HTMLElement;
	private contextWindowPercent!: HTMLElement;
	private contextWindowTokenLine!: HTMLElement;
	private fileInput!: HTMLInputElement;
	private workspaceLabel!: HTMLElement;
	private workspaceLabelText!: HTMLElement;
	private workspaceLabelChevron: HTMLElement | undefined;
	private slashCommandItems: ICleanSlateSlashCommandItem[] = [];
	private selectedSlashCommandIndex = 0;
	private suppressAnnotationRefsUntilClear = false;

	constructor(container: HTMLElement, private readonly options: ICleanSlateComposerViewOptions) {
		this.inputContainer = dom.append(container, dom.$('.cleanSlate-chat-input-container'));
		this.commandPopup = dom.append(this.inputContainer, dom.$('.cleanSlate-agent-popup'));

		this.renderWorkspaceLabel();

		this.inputBox = dom.append(this.inputContainer, dom.$('.cleanSlate-input-box'));
		this.imagePreviewContainer = dom.append(this.inputBox, dom.$('.cleanSlate-image-preview-container'));
		this.imagePreviewContainer.style.display = 'none';

		this.options.mountPanels(this.inputBox);

		this.selectionRefsContainer = dom.append(this.inputBox, dom.$('.cleanSlate-selection-refs'));
		this.selectionRefsContainer.style.display = 'none';

		this.annotationRefsContainer = dom.append(this.inputBox, dom.$('.cleanSlate-annotation-refs'));
		this.annotationRefsContainer.style.display = 'none';

		this.inputElement = dom.append(this.inputBox, dom.$('textarea.cleanSlate-chat-input')) as HTMLTextAreaElement;
		this.inputElement.placeholder = 'Ask anything (⌘L)';
		this.inputElement.rows = 1;
		this.resizeInput();

		const inputFooter = dom.append(this.inputBox, dom.$('.cleanSlate-input-footer'));
		const leftFooter = dom.append(inputFooter, dom.$('.cleanSlate-footer-left'));
		this.buildLeftFooter(leftFooter);
		const rightFooter = dom.append(inputFooter, dom.$('.cleanSlate-footer-right'));
		this.buildRightFooter(rightFooter);
		this.fileInput = this.buildFileInput();
		this.registerInputEvents();
	}

	getInputElement(): HTMLTextAreaElement {
		return this.inputElement;
	}

	getValue(): string {
		return this.inputElement.value;
	}

	setValue(value: string): void {
		if (this.inputElement.value === value) {
			return;
		}
		this.inputElement.value = value;
		this.resizeInput();
		this.options.onDidInputChange?.();
	}

	clearValue(): void {
		this.setValue('');
	}

	focus(): void {
		this.inputElement.focus();
	}

	setPlaceholder(placeholder: string): void {
		this.inputElement.placeholder = placeholder;
	}

	setCommandApprovalPending(isPending: boolean): void {
		this.inputElement.readOnly = isPending;
		this.inputElement.setAttribute('aria-readonly', String(isPending));
		this.inputBox.classList.toggle('command-approval-pending', isPending);
		if (isPending) {
			this.hideCommandPopup();
		}
	}

	setGenerating(isGenerating: boolean): void {
		const html = isGenerating
			? '<i class="codicon codicon-debug-stop"></i>'
			: '<i class="codicon codicon-arrow-right"></i>';
		this.sendButton.innerHTML = (policy ? policy.createHTML(html) : html) as unknown as string;
	}

	updateModel(label: string, warning: boolean, provider: AIProvider, model: string | undefined): void {
		const labelElement = this.modelDropdown.querySelector('.dropdown-label') as HTMLElement | null;
		if (!labelElement) {
			return;
		}

		labelElement.textContent = label;
		labelElement.style.color = warning ? 'var(--vscode-notificationsWarningIcon-foreground)' : '';
		setCleanSlateProviderLogo(this.modelProviderLogo, provider, model);
	}

	updateReasoning(label: string): void {
		const labelElement = this.reasoningDropdown.querySelector('.dropdown-label') as HTMLElement | null;
		if (labelElement) {
			labelElement.textContent = label;
		}
	}

	updatePlanMode(isActive: boolean): void {
		this.planModeChip.classList.toggle('active', isActive);
		this.planModeChip.style.display = isActive ? 'inline-flex' : 'none';
		this.planModeChip.setAttribute('aria-pressed', isActive ? 'true' : 'false');
		this.planModeChip.title = isActive ? 'Turn Plan mode off' : 'Plan mode is off';
	}

	updateContextWindowUsage(usage: ICleanSlateContextWindowUsage): void {
		const maxTokens = Math.max(1, Math.floor(usage.maxTokens));
		const usedTokens = Math.max(0, Math.floor(usage.usedTokens));
		const percent = Math.max(0, Math.min(100, Math.round(usage.percent)));
		const remainingPercent = Math.max(0, 100 - percent);
		const tokenLine = `${this.formatTokenCount(usedTokens)} / ${this.formatTokenCount(maxTokens)} tokens used`;
		const percentLine = `${percent}% used (${remainingPercent}% left)`;
		const label = `Context window: ${percentLine}, ${tokenLine}`;

		this.contextWindowButton.style.setProperty('--cleanSlate-context-window-used', `${percent}%`);
		this.contextWindowButton.classList.toggle('is-generating', usage.isGenerating);
		this.contextWindowButton.setAttribute('aria-label', label);
		this.contextWindowPercent.textContent = percentLine;
		this.contextWindowTokenLine.textContent = tokenLine;
	}

	updateWorkspaceLabel(workspaceName: string | undefined): void {
		const label = workspaceName?.trim();
		if (!this.workspaceLabel || !this.workspaceLabelText) {
			return;
		}
		this.workspaceLabel.style.display = label ? 'flex' : 'none';
		this.workspaceLabelText.textContent = label ?? '';
	}

	setWorkspaceSelectorEnabled(enabled: boolean): void {
		if (!(this.workspaceLabel instanceof HTMLButtonElement)) {
			return;
		}
		this.workspaceLabel.disabled = !enabled;
		this.workspaceLabel.setAttribute('aria-disabled', enabled ? 'false' : 'true');
		this.workspaceLabel.classList.toggle('workspace-selector-disabled', !enabled);
		if (this.workspaceLabelChevron) {
			this.workspaceLabelChevron.style.display = enabled ? '' : 'none';
		}
	}

	renderImagePreviews(pendingImages: readonly string[]): void {
		dom.clearNode(this.imagePreviewContainer);
		if (pendingImages.length === 0) {
			this.imagePreviewContainer.style.display = 'none';
			return;
		}

		this.imagePreviewContainer.style.display = 'flex';
		this.imagePreviewContainer.style.flexWrap = 'wrap';
		this.imagePreviewContainer.style.gap = '8px';
		this.imagePreviewContainer.style.marginBottom = '8px';
		this.imagePreviewContainer.style.padding = '4px';

		pendingImages.forEach((img, index) => {
			const wrapper = dom.append(this.imagePreviewContainer, dom.$('.cleanSlate-image-preview'));
			wrapper.style.position = 'relative';

			const imageEl = dom.append(wrapper, dom.$('img')) as HTMLImageElement;
			imageEl.src = img;
			imageEl.style.width = '60px';
			imageEl.style.height = '60px';
			imageEl.style.objectFit = 'cover';
			imageEl.style.borderRadius = '6px';
			imageEl.style.border = '1px solid rgba(255, 255, 255, 0.1)';

			const removeBtn = dom.append(wrapper, dom.$('.cleanSlate-image-remove'));
			removeBtn.style.position = 'absolute';
			removeBtn.style.top = '-4px';
			removeBtn.style.right = '-4px';
			removeBtn.style.background = 'var(--vscode-editorError-foreground)';
			removeBtn.style.color = '#fff';
			removeBtn.style.borderRadius = '50%';
			removeBtn.style.width = '16px';
			removeBtn.style.height = '16px';
			removeBtn.style.display = 'flex';
			removeBtn.style.justifyContent = 'center';
			removeBtn.style.alignItems = 'center';
			removeBtn.style.cursor = 'pointer';

			const icon = dom.append(removeBtn, dom.$('i.codicon.codicon-close'));
			icon.style.fontSize = '10px';
			removeBtn.onclick = () => this.options.onImageRemoved(index);
		});
	}

	updateSelectionReferences(references: readonly ICleanSlateEditorSelectionReference[]): void {
		dom.clearNode(this.selectionRefsContainer);
		if (references.length === 0) {
			this.selectionRefsContainer.style.display = 'none';
			return;
		}

		this.selectionRefsContainer.style.display = 'flex';
		this.selectionRefsContainer.style.flexWrap = 'wrap';
		this.selectionRefsContainer.style.gap = '6px';
		this.selectionRefsContainer.style.margin = '0 0 8px 0';

		references.forEach((reference, index) => {
			const chip = dom.append(this.selectionRefsContainer, dom.$('.cleanSlate-selection-ref')) as HTMLElement;
			dom.append(chip, dom.$('i.codicon.codicon-symbol-file'));
			const label = dom.append(chip, dom.$('span'));
			label.textContent = formatCleanSlateSelectionReferenceLabel(reference);
			chip.title = `${reference.uri.fsPath || reference.uri.toString()}\n${reference.selectedText.slice(0, 1000)}`;

			const deleteBtn = dom.append(chip, dom.$('button.cleanSlate-selection-ref-delete')) as HTMLButtonElement;
			deleteBtn.type = 'button';
			deleteBtn.title = 'Remove selection';
			deleteBtn.setAttribute('aria-label', deleteBtn.title);
			dom.append(deleteBtn, dom.$('i.codicon.codicon-close'));
			deleteBtn.onclick = (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.options.onRemoveSelectionReference(index);
			};
		});
	}

	updateAnnotationReferences(annotations: readonly ICleanSlateBrowserAnnotation[]): void {
		const visibleAnnotations = this.suppressAnnotationRefsUntilClear ? [] : annotations;
		dom.clearNode(this.annotationRefsContainer);
		if (visibleAnnotations.length === 0) {
			this.annotationRefsContainer.style.display = 'none';
			return;
		}

		this.annotationRefsContainer.style.display = 'flex';
		this.annotationRefsContainer.style.flexWrap = 'wrap';
		this.annotationRefsContainer.style.gap = '6px';
		this.annotationRefsContainer.style.margin = '0 0 8px 0';

		const chip = dom.append(this.annotationRefsContainer, dom.$('.cleanSlate-annotation-ref')) as HTMLElement;
		dom.append(chip, dom.$('i.codicon.codicon-comment-discussion'));
		dom.append(chip, dom.$('span')).textContent = visibleAnnotations.length === 1 ? '1 annotation' : `${visibleAnnotations.length} annotations`;
		chip.title = visibleAnnotations
			.slice(0, 5)
			.map((annotation, index) => `@${index + 1}: ${[annotation.text, annotation.label].filter(Boolean).join(' - ')}`)
			.join('\n');
		chip.style.border = '1px solid var(--vscode-input-border, rgba(255,255,255,.16))';
		chip.style.background = 'var(--vscode-button-secondaryBackground, rgba(255,255,255,.08))';
		chip.style.color = 'var(--vscode-button-secondaryForeground, var(--vscode-foreground))';
		chip.style.borderRadius = '999px';
		chip.style.padding = '4px 10px';
		chip.style.fontSize = '12px';
		chip.style.cursor = 'default';
		chip.style.display = 'inline-flex';
		chip.style.alignItems = 'center';
		chip.style.gap = '6px';

		const deleteBtn = dom.append(chip, dom.$('button.cleanSlate-annotation-ref-delete')) as HTMLButtonElement;
		deleteBtn.type = 'button';
		deleteBtn.title = visibleAnnotations.length === 1 ? 'Delete annotation' : 'Delete annotations';
		deleteBtn.setAttribute('aria-label', deleteBtn.title);
		dom.append(deleteBtn, dom.$('i.codicon.codicon-close'));
		deleteBtn.style.border = '0';
		deleteBtn.style.background = 'transparent';
		deleteBtn.style.color = 'inherit';
		deleteBtn.style.padding = '0';
		deleteBtn.style.margin = '0 0 0 2px';
		deleteBtn.style.width = '16px';
		deleteBtn.style.height = '16px';
		deleteBtn.style.display = 'inline-grid';
		deleteBtn.style.placeItems = 'center';
		deleteBtn.style.cursor = 'pointer';
		deleteBtn.style.opacity = '0.78';
		deleteBtn.onclick = (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.options.onDeleteAnnotations(visibleAnnotations);
		};
	}

	suppressAnnotationReferences(): void {
		this.suppressAnnotationRefsUntilClear = true;
		this.updateAnnotationReferences([]);
	}

	clearAnnotationSuppression(annotations: readonly ICleanSlateBrowserAnnotation[]): void {
		this.suppressAnnotationRefsUntilClear = false;
		this.updateAnnotationReferences(annotations);
	}

	private buildLeftFooter(leftFooter: HTMLElement): void {
		const photoBtn = dom.append(leftFooter, dom.$('button.cleanSlate-dropdown.photo-button')) as HTMLButtonElement;
		photoBtn.type = 'button';
		photoBtn.title = 'Upload screenshot or image';
		photoBtn.setAttribute('aria-label', 'Upload screenshot or image');
		dom.append(photoBtn, dom.$('i.codicon.codicon-attach'));
		photoBtn.onclick = () => this.fileInput.click();

		this.reasoningDropdown = dom.append(leftFooter, dom.$('.cleanSlate-dropdown.mode-dropdown.reasoning-dropdown'));
		const reasoningLabel = dom.append(this.reasoningDropdown, dom.$('span.dropdown-label'));
		reasoningLabel.textContent = 'None';
		dom.append(this.reasoningDropdown, dom.$('i.codicon.codicon-chevron-down'));
		this.reasoningDropdown.onclick = () => this.options.onReasoningSelector(this.reasoningDropdown);

		this.planModeChip = dom.append(leftFooter, dom.$('button.cleanSlate-plan-mode-chip')) as HTMLButtonElement;
		(this.planModeChip as HTMLButtonElement).type = 'button';
		dom.append(this.planModeChip, dom.$('i.codicon.codicon-checklist'));
		dom.append(this.planModeChip, dom.$('span')).textContent = 'Plan';
		this.planModeChip.onclick = () => this.options.onPlanModeDisabled();
		this.updatePlanMode(false);

		this.modelDropdown = dom.append(leftFooter, dom.$('.cleanSlate-dropdown.model-dropdown'));
		this.modelProviderLogo = dom.append(this.modelDropdown, dom.$('.model-provider-logo'));
		this.modelProviderLogo.style.display = 'none';
		const modelLabel = dom.append(this.modelDropdown, dom.$('span.dropdown-label'));
		modelLabel.textContent = 'Loading...';
		dom.append(this.modelDropdown, dom.$('i.codicon.codicon-chevron-down'));
		this.modelDropdown.onclick = () => this.options.onModelSelector(this.modelDropdown);

		this.buildContextWindowIndicator(leftFooter);
	}

	private renderWorkspaceLabel(): void {
		const workspaceName = this.options.workspaceName?.trim();
		this.workspaceLabel = dom.append(this.inputContainer, dom.$(this.options.onWorkspaceSelector ? 'button.cleanSlate-workspace-label' : '.cleanSlate-workspace-label'));
		if (this.workspaceLabel instanceof HTMLButtonElement) {
			this.workspaceLabel.type = 'button';
		}
		dom.append(this.workspaceLabel, dom.$('i.codicon.codicon-folder'));
		this.workspaceLabelText = dom.append(this.workspaceLabel, dom.$('span'));
		if (this.options.onWorkspaceSelector) {
			this.workspaceLabelChevron = dom.append(this.workspaceLabel, dom.$('i.codicon.codicon-chevron-down'));
			this.workspaceLabel.onclick = () => this.options.onWorkspaceSelector?.(this.workspaceLabel);
		}
		this.updateWorkspaceLabel(workspaceName);
	}

	private buildRightFooter(rightFooter: HTMLElement): void {
		this.sendButton = dom.append(rightFooter, dom.$('.cleanSlate-send-button'));
		dom.append(this.sendButton, dom.$('i.codicon.codicon-arrow-right'));
		this.sendButton.onclick = () => this.options.onSubmit();
	}

	private buildContextWindowIndicator(parent: HTMLElement): void {
		this.contextWindowButton = dom.append(parent, dom.$('button.cleanSlate-context-window-button')) as HTMLButtonElement;
		(this.contextWindowButton as HTMLButtonElement).type = 'button';
		dom.append(this.contextWindowButton, dom.$('span.cleanSlate-context-window-ring'));

		this.contextWindowTooltip = dom.append(this.contextWindowButton, dom.$('.cleanSlate-context-window-tooltip'));
		dom.append(this.contextWindowTooltip, dom.$('.cleanSlate-context-window-tooltip-title')).textContent = 'Context window:';
		this.contextWindowPercent = dom.append(this.contextWindowTooltip, dom.$('.cleanSlate-context-window-tooltip-percent'));
		this.contextWindowTokenLine = dom.append(this.contextWindowTooltip, dom.$('.cleanSlate-context-window-tooltip-tokens'));

		const scheduleTooltipPosition = () => {
			this.contextWindowTooltip.classList.remove('is-positioned');
			window.requestAnimationFrame(() => this.positionContextWindowTooltip());
		};
		this.contextWindowButton.addEventListener('mouseenter', scheduleTooltipPosition);
		this.contextWindowButton.addEventListener('focus', scheduleTooltipPosition);
		this.contextWindowButton.addEventListener('mouseleave', () => this.contextWindowTooltip.classList.remove('is-positioned'));
		this.contextWindowButton.addEventListener('blur', () => this.contextWindowTooltip.classList.remove('is-positioned'));
	}

	private positionContextWindowTooltip(): void {
		const tooltip = this.contextWindowTooltip;
		const buttonRect = this.contextWindowButton.getBoundingClientRect();
		const containerRect = this.inputContainer.getBoundingClientRect();
		const previousDisplay = tooltip.style.display;
		const previousVisibility = tooltip.style.visibility;
		const wasHidden = window.getComputedStyle(tooltip).display === 'none';

		if (wasHidden) {
			tooltip.style.display = 'block';
			tooltip.style.visibility = 'hidden';
		}

		const tooltipRect = tooltip.getBoundingClientRect();
		const tooltipWidth = tooltipRect.width || 190;
		const tooltipHeight = tooltipRect.height || 88;
		const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
		const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
		const margin = 8;
		const minLeft = Math.max(margin, containerRect.left + margin);
		const maxLeft = Math.min(viewportWidth - tooltipWidth - margin, containerRect.right - tooltipWidth - margin);
		const preferredLeft = buttonRect.left + (buttonRect.width / 2) - (tooltipWidth / 2);
		const left = maxLeft >= minLeft
			? Math.min(Math.max(preferredLeft, minLeft), maxLeft)
			: Math.max(margin, Math.min(preferredLeft, viewportWidth - tooltipWidth - margin));
		const preferredTop = buttonRect.top - tooltipHeight - 12;
		const top = Math.min(Math.max(preferredTop, margin), viewportHeight - tooltipHeight - margin);

		tooltip.style.left = `${Math.round(left)}px`;
		tooltip.style.top = `${Math.round(top)}px`;

		if (wasHidden) {
			tooltip.style.display = previousDisplay;
			tooltip.style.visibility = previousVisibility;
		}

		tooltip.classList.add('is-positioned');
	}

	private formatTokenCount(tokens: number): string {
		if (tokens >= 1_000_000) {
			return `${Number((tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1))}m`;
		}
		if (tokens >= 1_000) {
			return `${Number((tokens / 1_000).toFixed(tokens >= 10_000 ? 0 : 1))}k`;
		}
		return String(tokens);
	}

	private buildFileInput(): HTMLInputElement {
		const fileInput = dom.append(this.inputContainer, dom.$('input.cleanSlate-file-input')) as HTMLInputElement;
		fileInput.type = 'file';
		fileInput.accept = 'image/*';
		fileInput.multiple = true;
		fileInput.style.display = 'none';
		fileInput.onchange = () => {
			this.handleFiles(fileInput.files);
			fileInput.value = '';
		};
		return fileInput;
	}

	private registerInputEvents(): void {
		const imageDropTarget = this.options.imageDropTarget ?? this.inputBox;
		imageDropTarget.ondragover = (event) => {
			if (!event.dataTransfer?.types.includes('Files')) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			event.dataTransfer.dropEffect = 'copy';
			this.inputBox.classList.add('drag-over');
		};
		imageDropTarget.ondragleave = (event) => {
			const nextTarget = event.relatedTarget;
			if (nextTarget && imageDropTarget.contains(nextTarget as Node)) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			this.inputBox.classList.remove('drag-over');
		};
		imageDropTarget.ondrop = (event) => {
			if (!event.dataTransfer?.types.includes('Files')) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			this.inputBox.classList.remove('drag-over');
			this.handleFiles(event.dataTransfer.files);
		};
		this.inputElement.onkeydown = (event) => {
			if (this.options.onKeyDown?.(event)) {
				return;
			}
			if (this.inputElement.readOnly) {
				if (event.key === 'Escape' && this.options.onEscape?.()) {
					event.preventDefault();
					return;
				}
				if (event.key === 'Enter' && !event.shiftKey) {
					event.preventDefault();
					this.options.onSubmit();
				}
				return;
			}
			if (this.isCommandPopupVisible()) {
				if (event.key === 'Escape') {
					event.preventDefault();
					this.hideCommandPopup();
					return;
				}
				if (event.key === 'ArrowDown') {
					event.preventDefault();
					this.moveSlashCommandSelection(1);
					return;
				}
				if (event.key === 'ArrowUp') {
					event.preventDefault();
					this.moveSlashCommandSelection(-1);
					return;
				}
				if (event.key === 'Enter' && !event.shiftKey) {
					event.preventDefault();
					this.selectSlashCommand(this.slashCommandItems[this.selectedSlashCommandIndex]);
					return;
				}
			}
			if (event.key === 'Escape' && this.options.onEscape?.()) {
				event.preventDefault();
				return;
			}
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				this.options.onSubmit();
			}
		};
		this.inputElement.oninput = () => {
			this.resizeInput();
			if (this.inputElement.readOnly) {
				this.hideCommandPopup();
				return;
			}
			this.updateCommandPopup();
			this.options.onDidInputChange?.();
		};
	}

	private resizeInput(): void {
		this.inputElement.style.height = 'auto';
		const scrollHeight = this.inputElement.scrollHeight;
		// Before the composer is attached and laid out, scrollHeight is 0.
		// Writing that back pins the textarea to zero height and clips the
		// placeholder, and nothing recomputes it until the user types. Leave the
		// height unset so the CSS min-height governs until a real measurement
		// is available.
		if (scrollHeight <= 0) {
			this.inputElement.style.height = '';
			return;
		}
		const height = Math.min(scrollHeight, CleanSlateComposerView.InputMaxHeight);
		this.inputElement.style.height = `${height}px`;
		this.inputElement.style.overflowY = scrollHeight > CleanSlateComposerView.InputMaxHeight ? 'auto' : 'hidden';
	}

	private updateCommandPopup(): void {
		const value = this.inputElement.value;
		const query = this.getSlashCommandQuery(value);
		if (query === undefined) {
			this.hideCommandPopup();
			return;
		}
		dom.clearNode(this.commandPopup);
		this.slashCommandItems = this.getSlashCommandItems(query);
		this.selectedSlashCommandIndex = Math.min(this.selectedSlashCommandIndex, Math.max(0, this.slashCommandItems.length - 1));
		if (this.slashCommandItems.length === 0) {
			this.hideCommandPopup();
			return;
		}
		this.commandPopup.classList.add('visible');
		this.renderSlashCommandItems();
		this.positionCommandPopup();
	}

	private getSlashCommandQuery(value: string): string | undefined {
		const trimmedStart = value.trimStart();
		if (!trimmedStart.startsWith('/')) {
			return undefined;
		}
		if (/\s/.test(trimmedStart)) {
			return undefined;
		}
		return trimmedStart.slice(1).toLowerCase();
	}

	private getSlashCommandItems(query: string): ICleanSlateSlashCommandItem[] {
		const items: ICleanSlateSlashCommandItem[] = [
			{
				id: '/plan',
				label: 'Plan mode',
				description: 'Turn plan mode on',
				icon: 'codicon-checklist',
				kind: 'plan'
			},
			...Object.entries(SLASH_COMMANDS).map(([id, command]) => ({
				id,
				label: this.formatSlashCommandLabel(id),
				description: command.defaultMessage,
				icon: this.getSlashCommandIcon(id),
				kind: 'insert' as const
			}))
		];
		if (!query) {
			return items;
		}
		return items.filter(item => item.id.slice(1).includes(query) || item.label.toLowerCase().includes(query));
	}

	private renderSlashCommandItems(keepActiveItemVisible = false): void {
		dom.clearNode(this.commandPopup);
		for (const [index, command] of this.slashCommandItems.entries()) {
			const item = dom.append(this.commandPopup, dom.$('.cleanSlate-agent-popup-item'));
			dom.append(item, dom.$(`i.cleanSlate-agent-popup-icon.codicon.${command.icon}`));
			const content = dom.append(item, dom.$('.cleanSlate-agent-popup-content'));
			const titleRow = dom.append(content, dom.$('.cleanSlate-agent-popup-title-row'));
			dom.append(titleRow, dom.$('.cleanSlate-agent-popup-title')).textContent = command.label;
			dom.append(titleRow, dom.$('.cleanSlate-agent-popup-command')).textContent = command.id;
			dom.append(content, dom.$('.cleanSlate-agent-popup-desc')).textContent = command.description;
			item.onmouseenter = () => {
				if (this.selectedSlashCommandIndex !== index) {
					this.selectedSlashCommandIndex = index;
					this.syncSlashCommandSelection();
				}
			};
			item.onclick = () => this.selectSlashCommand(command);
		}
		this.syncSlashCommandSelection(keepActiveItemVisible);
	}

	private syncSlashCommandSelection(keepActiveItemVisible = false): void {
		let activeItem: HTMLElement | undefined;
		for (const [index, item] of Array.from(this.commandPopup.children).entries()) {
			const element = item as HTMLElement;
			const isActive = index === this.selectedSlashCommandIndex;
			element.classList.toggle('active', isActive);
			if (isActive) {
				activeItem = element;
			}
		}
		if (keepActiveItemVisible) {
			activeItem?.scrollIntoView({ block: 'nearest' });
		}
	}

	private positionCommandPopup(): void {
		const containerRect = this.inputContainer.getBoundingClientRect();
		const inputBoxRect = this.inputBox.getBoundingClientRect();
		const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
		const viewportMargin = 12;
		const left = Math.max(6, inputBoxRect.left - containerRect.left);
		const right = Math.max(6, containerRect.right - inputBoxRect.right);
		const bottom = Math.max(
			CleanSlateComposerView.CommandPopupGap,
			containerRect.bottom - inputBoxRect.top + CleanSlateComposerView.CommandPopupGap
		);
		const availableAboveInput = Math.max(
			CleanSlateComposerView.CommandPopupMinHeight,
			inputBoxRect.top - viewportMargin - CleanSlateComposerView.CommandPopupGap
		);
		const viewportLimit = Math.max(
			CleanSlateComposerView.CommandPopupMinHeight,
			viewportHeight - viewportMargin * 2
		);
		const contentHeight = this.commandPopup.scrollHeight || CleanSlateComposerView.CommandPopupMaxHeight;
		const maxHeight = Math.min(
			contentHeight,
			CleanSlateComposerView.CommandPopupMaxHeight,
			availableAboveInput,
			viewportLimit
		);

		this.commandPopup.style.setProperty('--cleanSlate-agent-popup-left', `${Math.round(left)}px`);
		this.commandPopup.style.setProperty('--cleanSlate-agent-popup-right', `${Math.round(right)}px`);
		this.commandPopup.style.setProperty('--cleanSlate-agent-popup-bottom', `${Math.round(bottom)}px`);
		this.commandPopup.style.setProperty('--cleanSlate-agent-popup-max-height', `${Math.round(maxHeight)}px`);
	}

	private moveSlashCommandSelection(delta: number): void {
		if (this.slashCommandItems.length === 0) {
			return;
		}
		this.selectedSlashCommandIndex = (this.selectedSlashCommandIndex + delta + this.slashCommandItems.length) % this.slashCommandItems.length;
		this.syncSlashCommandSelection(true);
	}

	private selectSlashCommand(command: ICleanSlateSlashCommandItem | undefined): void {
		if (!command) {
			return;
		}
		this.hideCommandPopup();
		if (command.kind === 'plan') {
			this.setValue('');
			this.options.onPlanModeCommand();
			this.focus();
			return;
		}
		this.setValue(`${command.id} `);
		this.focus();
	}

	private hideCommandPopup(): void {
		this.commandPopup.classList.remove('visible');
		dom.clearNode(this.commandPopup);
		this.slashCommandItems = [];
		this.selectedSlashCommandIndex = 0;
	}

	private isCommandPopupVisible(): boolean {
		return this.commandPopup.classList.contains('visible');
	}

	private formatSlashCommandLabel(command: string): string {
		const label = command.replace(/^\//, '').replace(/[-_]/g, ' ');
		return label.charAt(0).toUpperCase() + label.slice(1);
	}

	private getSlashCommandIcon(command: string): string {
		switch (command) {
			case '/fix':
				return 'codicon-tools';
			case '/explain':
				return 'codicon-comment-discussion';
			case '/test':
				return 'codicon-beaker';
			case '/rewrite':
				return 'codicon-edit';
			case '/doc':
				return 'codicon-book';
			case '/review':
				return 'codicon-bug';
			case '/optimize':
				return 'codicon-dashboard';
			case '/scaffold':
				return 'codicon-package';
			case '/migrate':
				return 'codicon-repo-push';
			default:
				return 'codicon-terminal';
		}
	}

	private handleFiles(files: FileList | null): void {
		if (!files) {
			return;
		}

		for (let index = 0; index < files.length; index++) {
			const file = files[index];
			if (file.type.startsWith('image/')) {
				const reader = new FileReader();
				reader.onload = (event) => {
					const result = event.target?.result as string;
					if (result) {
						this.options.onImageAdded(result);
					}
				};
				reader.readAsDataURL(file);
			}
		}
	}
}
