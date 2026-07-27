/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChatResponse, CleanSlateUserSelectionDisplay } from '../types/cleanSlateChatTypes.js';
import { normalizeChatResponse } from '../runtime/cleanSlateChatResponseNormalizer.js';
import { ICleanSlateSessionSnapshot } from '../types/cleanSlateChatSessionTypes.js';
import type { ICleanSlateBrowserAnnotation } from '../../core/cleanSlateBrowserAutomationService.js';
import type { ICleanSlateEditorSelectionReference } from '../providers/cleanSlateChatComposerProvider.js';
import { getCleanSlateVisibleUserRequestText } from '../runtime/cleanSlateVisibleText.js';
import { classifyBrowserAnnotationProvenance } from '../../agent/cleanSlateBrowserAnnotationContext.js';

export { getCleanSlateVisibleUserRequestText } from '../runtime/cleanSlateVisibleText.js';

const CLEANSLATE_USER_SELECTION_DISPLAY_KIND = 'cleanSlate.userSelectionDisplay';
const CLEANSLATE_USER_SELECTION_DISPLAY_VERSION = 1;

export function getCleanSlateSessionObjective(session: ICleanSlateSessionSnapshot): string | undefined {
	if (session.taskState?.objective?.trim()) {
		return getCleanSlateVisibleUserRequestText(session.taskState.objective);
	}

	for (const run of session.taskState?.runLedger ?? []) {
		if (run.objective?.trim()) {
			return getCleanSlateVisibleUserRequestText(run.objective);
		}
	}

	const firstUserMessage = session.history.find(message => message.role === 'user' && message.content.trim().length > 0)?.content;
	return firstUserMessage ? getCleanSlateVisibleUserRequestText(firstUserMessage) : undefined;
}

export function getLastToDoStepsFromHistory(
	history: readonly { role: string; content: string; isInternalState?: boolean; renderPayload?: string }[]
): string[] {
	try {
		const lastToDoMsg = [...history].reverse().find(message => {
			if (message.role !== 'assistant' && message.role !== 'cleanSlate') {
				return false;
			}

			const source = message.renderPayload || message.content;
			if (!source) {
				return false;
			}

			try {
				const parsed = normalizeChatResponse(JSON.parse(source) as ChatResponse);
				return Array.isArray(parsed.to_do) && parsed.to_do.length > 0;
			} catch {
				return false;
			}
		});

		if (!lastToDoMsg) {
			return [];
		}

		const source = lastToDoMsg.renderPayload || lastToDoMsg.content;
		const parsed = normalizeChatResponse(JSON.parse(source) as ChatResponse);
		return Array.isArray(parsed.to_do) ? parsed.to_do as string[] : [];
	} catch {
		return [];
	}
}

export function buildCleanSlateAnnotationSubmitContext(annotations: readonly ICleanSlateBrowserAnnotation[]): string {
	if (annotations.length === 0) {
		return '';
	}

	const lines = annotations.slice(0, 20).map((annotation, index) => {
		const details = [
			`provenance="${classifyBrowserAnnotationProvenance(annotation.url)}"`,
			`comment="${escapeAnnotationField(annotation.text || 'No comment')}"`,
			annotation.selector ? `selector="${escapeAnnotationField(annotation.selector)}"` : '',
			annotation.elementText ? `elementText="${escapeAnnotationField(annotation.elementText)}"` : '',
			annotation.label ? `label="${escapeAnnotationField(annotation.label)}"` : '',
			annotation.url ? `url="${escapeAnnotationField(annotation.url)}"` : ''
		].filter(Boolean).join(' ');
		return `@${index + 1} ${details}`;
	});

	return `[ATTACHED BROWSER ANNOTATIONS]\nPreserve each exact annotation comment and its URL provenance. project_preview may describe the active project's running UI. external_reference is an example or evidence from outside the project, not an implicit request to edit the workspace. Use the user's message to determine the intended outcome; when it is unclear, ask a task-specific follow-up instead of inventing a target or ignoring the annotation.\n${lines.join('\n')}`;
}

export function buildCleanSlateSelectionSubmitContext(selections: readonly ICleanSlateEditorSelectionReference[]): string {
	if (selections.length === 0) {
		return '';
	}

	const blocks = selections.slice(0, 20).map((selection, index) => {
		const filePath = selection.uri.fsPath || selection.uri.toString();
		const range = `${selection.range.startLineNumber}:${selection.range.startColumn}-${selection.range.endLineNumber}:${selection.range.endColumn}`;
		const fence = chooseFence(selection.selectedText);
		return [
			`@${index + 1} file="${escapeAnnotationField(filePath)}" language="${escapeAnnotationField(selection.languageId)}" range="${range}" modelVersionId="${selection.modelVersionId}"`,
			`${fence}${selection.languageId}`,
			selection.selectedText,
			fence
		].join('\n');
	});

	return `[ATTACHED EDITOR SELECTIONS]\nUse these exact selected editor ranges as the primary code context for the user request. Do not ignore them or answer from unrelated conversation history.\n${blocks.join('\n\n')}`;
}

export function formatCleanSlateSelectionReferenceLabel(reference: ICleanSlateEditorSelectionReference): string {
	const fileName = (reference.uri.path.split('/').pop() || reference.uri.fsPath || 'Selection').trim();
	const languagePrefix = reference.languageId ? `${reference.languageId.toUpperCase()} ` : '';
	const range = reference.range.startLineNumber === reference.range.endLineNumber
		? `${reference.range.startLineNumber}`
		: `${reference.range.startLineNumber}-${reference.range.endLineNumber}`;
	return `${languagePrefix}${fileName} (${range})`;
}

export function createCleanSlateUserSelectionDisplay(
	selections: readonly ICleanSlateEditorSelectionReference[],
	rawInput: string
): CleanSlateUserSelectionDisplay | undefined {
	if (selections.length === 0) {
		return undefined;
	}

	const command = getLeadingSlashCommand(rawInput);
	const label = selections.length === 1
		? formatCleanSlateSelectionReferenceLabel(selections[0])
		: `${selections.length} selections`;

	return {
		kind: 'selection',
		label,
		selectionCount: selections.length,
		...(command ? { command } : {})
	};
}

export function formatCleanSlateUserSelectionDisplayText(display: CleanSlateUserSelectionDisplay): string {
	return [display.label, display.command].filter((part): part is string => typeof part === 'string' && part.length > 0).join(' ');
}

export function stringifyCleanSlateUserSelectionDisplay(display: CleanSlateUserSelectionDisplay): string {
	return JSON.stringify({
		type: CLEANSLATE_USER_SELECTION_DISPLAY_KIND,
		version: CLEANSLATE_USER_SELECTION_DISPLAY_VERSION,
		display
	});
}

export function parseCleanSlateUserSelectionDisplay(value: string | undefined): CleanSlateUserSelectionDisplay | undefined {
	if (!value) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(value) as { type?: unknown; version?: unknown; display?: Partial<CleanSlateUserSelectionDisplay> };
		if (parsed?.type !== CLEANSLATE_USER_SELECTION_DISPLAY_KIND || parsed.version !== CLEANSLATE_USER_SELECTION_DISPLAY_VERSION) {
			return undefined;
		}
		const display = parsed.display;
		if (display?.kind !== 'selection' || typeof display.label !== 'string' || !display.label.trim()) {
			return undefined;
		}
		const selectionCount = typeof display.selectionCount === 'number' && Number.isFinite(display.selectionCount)
			? Math.max(1, Math.floor(display.selectionCount))
			: 1;
		const command = typeof display.command === 'string' && display.command.trim()
			? display.command.trim()
			: undefined;
		return {
			kind: 'selection',
			label: display.label.trim(),
			selectionCount,
			...(command ? { command } : {})
		};
	} catch {
		return undefined;
	}
}

function getLeadingSlashCommand(value: string): string {
	const trimmed = value.trimStart();
	if (!trimmed.startsWith('/')) {
		return '';
	}

	let endIndex = 1;
	while (endIndex < trimmed.length) {
		const char = trimmed[endIndex];
		if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
			break;
		}
		endIndex++;
	}

	return trimmed.slice(0, endIndex);
}

function chooseFence(text: string): string {
	let longestBacktickRun = 0;
	for (const match of text.matchAll(/`+/g)) {
		longestBacktickRun = Math.max(longestBacktickRun, match[0].length);
	}
	return '`'.repeat(Math.max(3, longestBacktickRun + 1));
}

function escapeAnnotationField(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\s+/g, ' ').trim().slice(0, 500);
}
