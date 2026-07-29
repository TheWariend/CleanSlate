/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ICodeEditor, IViewZoneChangeAccessor } from '../../editorBrowser.js';
import { EditorContributionInstantiation, registerEditorContribution } from '../../editorExtensions.js';
import { IEditorContribution, IEditorDecorationsCollection } from '../../../common/editorCommon.js';
import { IIdentifiedSingleEditOperation, IModelDeltaDecoration, ITextModel } from '../../../common/model.js';
import { ModelDecorationOptions } from '../../../common/model/textModel.js';
import { InlineCleanSlateWidget } from '../ui/inlineCleanSlateWidget.js';
import { CleanSlateEditParser } from '../utils/cleanSlateEditParser.js';
import '../ui/inlineCleanSlate.css';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { Selection } from '../../../common/core/selection.js';
import { IRange, Range } from '../../../common/core/range.js';
import { URI } from '../../../../base/common/uri.js';
import { ICleanSlateEditCodeService } from '../../../../workbench/services/cleanSlate/common/core/cleanSlateAI.js';
import { ICodeEditorService } from '../../services/codeEditorService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { CleanSlateEditDiagnostic, CleanSlateEditService } from '@cleanslate/sdk/services/cleanSlateEditService.js';
import { CleanSlateDiffService } from '@cleanslate/sdk/services/cleanSlateDiffService.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ITextFileService } from '../../../../workbench/services/textfile/common/textfiles.js';
import { mainWindow } from '../../../../base/browser/window.js';

interface CleanSlateSession {
	edits: IIdentifiedSingleEditOperation[];
	originalEdits: { range: IRange; text: string; originalStartLine: number }[];
	instruction: string;
	beforeContent: string;
}

interface CleanSlateEditState {
	sessions: CleanSlateSession[];
	undoCount: number;
}

export class InlineCleanSlateController extends Disposable implements IEditorContribution {
	public static readonly ID = 'editor.contrib.inlineCleanSlate';
	private static readonly ACCEPT_ALL_COMMAND_ID = 'cleanSlate.acceptAll';
	private static readonly REJECT_ALL_COMMAND_ID = 'cleanSlate.rejectAll';

	private static readonly _onDidChangeGlobalState = new Emitter<void>();
	public static readonly onDidChangeGlobalState: Event<void> = InlineCleanSlateController._onDidChangeGlobalState.event;

	// Static map to persist state across editor model switches (tabs)
	private static stateMap = new Map<string, CleanSlateEditState>();
	private static globalShortcutListener: IDisposable | undefined;

	private static readonly DIFF_INSERT_DECORATION = ModelDecorationOptions.register({
		className: 'cleanSlate-line-insert',
		description: 'line-insert',
		isWholeLine: true,
	});

	private widget?: InlineCleanSlateWidget;
	private keyListener?: IDisposable;
	private decorationCollection?: IEditorDecorationsCollection;
	private viewZoneIds: string[] = [];
	private currentEditIndex: number = 0;

	public static get(editor: ICodeEditor): InlineCleanSlateController | null {
		return editor.getContribution<InlineCleanSlateController>(InlineCleanSlateController.ID);
	}

	public static hasAnyPendingEdits(): boolean {
		for (const state of InlineCleanSlateController.stateMap.values()) {
			if (state.sessions.length > 0) {
				return true;
			}
		}
		return false;
	}

	public static getPendingEditsCount(): number {
		let count = 0;
		for (const state of InlineCleanSlateController.stateMap.values()) {
			if (state.sessions.length > 0) {
				count++;
			}
		}
		return count;
	}

	public static getPendingEditsInfo(): { uri: URI; added: number; deleted: number }[] {
		const merged = new Map<string, { uri: URI; added: number; deleted: number }>();
		for (const [uriStr, state] of InlineCleanSlateController.stateMap.entries()) {
			if (state.sessions.length > 0) {
				let added = 0;
				let deleted = 0;
				for (const session of state.sessions) {
					for (const edit of session.edits) {
						if (edit.text && edit.text.length > 0) {
							added += edit.text.split('\n').length;
						}
						// If range is empty (start === end), then 0 lines deleted
						if (edit.range.startLineNumber === edit.range.endLineNumber &&
							edit.range.startColumn === edit.range.endColumn) {
							// Pure insertion
						} else {
							deleted += (edit.range.endLineNumber - edit.range.startLineNumber + 1);
						}
					}
				}
				const uri = URI.parse(uriStr);
				const key = InlineCleanSlateController.normalizePendingEditKey(uri);
				const previous = merged.get(key);
				if (previous) {
					previous.added += added;
					previous.deleted += deleted;
				} else {
					merged.set(key, { uri, added, deleted });
				}
			}
		}
		return Array.from(merged.values());
	}

	public static getPendingEditsDiffs(_editorService: ICodeEditorService): { uri: URI; added: number; deleted: number; diff: string; beforeContent: string; afterContent: string }[] {
		const pendingInfo = InlineCleanSlateController.getPendingEditsInfo();
		const result: { uri: URI; added: number; deleted: number; diff: string; beforeContent: string; afterContent: string }[] = [];

		for (const info of pendingInfo) {
			const uriKey = info.uri.toString();
			const state = InlineCleanSlateController.stateMap.get(uriKey);
			const beforeContent = state?.sessions[0]?.beforeContent;
			if (typeof beforeContent !== 'string') {
				continue;
			}

			// Review must describe the pending CleanSlate edits only. Reading an open model here
			// also includes unrelated editor-side transformations (such as formatting), which can
			// make the same edit appear as a full-file replacement only while its project is open.
			const currentContent = InlineCleanSlateController.reconstructContentFromSessions(state!.sessions);
			const edits = CleanSlateDiffService.computeDiff(beforeContent, currentContent);
			const diff = CleanSlateDiffService.renderUnifiedDiff(info.uri.fsPath || info.uri.path, beforeContent, edits);
			result.push({
				...info,
				diff,
				beforeContent,
				afterContent: currentContent
			});
		}

		return result;
	}

	private static normalizePendingEditKey(uri: URI): string {
		return (uri.fsPath || uri.path || uri.toString()).replace(/\\/g, '/').trim().toLowerCase();
	}

	private static reconstructContentFromSessions(sessions: CleanSlateSession[]): string {
		let content = sessions[0]?.beforeContent ?? '';
		for (const session of sessions) {
			content = InlineCleanSlateController.applyEditsToContent(content, session.edits);
		}
		return content;
	}

	private static applyEditsToContent(content: string, edits: IIdentifiedSingleEditOperation[]): string {
		const sortedEdits = [...edits].sort((a, b) => {
			if (a.range.startLineNumber !== b.range.startLineNumber) {
				return b.range.startLineNumber - a.range.startLineNumber;
			}
			return b.range.startColumn - a.range.startColumn;
		});
		let updated = content;
		for (const edit of sortedEdits) {
			const start = InlineCleanSlateController.offsetAt(updated, edit.range.startLineNumber, edit.range.startColumn);
			const end = InlineCleanSlateController.offsetAt(updated, edit.range.endLineNumber, edit.range.endColumn);
			updated = `${updated.slice(0, start)}${edit.text ?? ''}${updated.slice(end)}`;
		}
		return updated;
	}

	private static offsetAt(content: string, lineNumber: number, column: number): number {
		let line = 1;
		let offset = 0;
		while (line < lineNumber && offset < content.length) {
			const nextNewline = content.indexOf('\n', offset);
			if (nextNewline === -1) {
				return content.length;
			}
			offset = nextNewline + 1;
			line++;
		}
		return Math.min(content.length, offset + Math.max(0, column - 1));
	}

	public static acceptAllGlobal(editorService: ICodeEditorService, textFileService: ITextFileService, commandService: ICommandService): void {
		const uris = Array.from(InlineCleanSlateController.stateMap.keys());
		for (const uriStr of uris) {
			// Clear state first
			InlineCleanSlateController.stateMap.delete(uriStr);

			// Find any active editor for this URI to clear decorations
			const editors = editorService.listCodeEditors();
			for (const editor of editors) {
				if (editor.getModel()?.uri.toString() === uriStr) {
					const controller = InlineCleanSlateController.get(editor);
					controller?.clear();
				}
			}

			// Persist the accepted content to disk directly by URI (see accept() for why this
			// can't go through the generic "save active editor" command).
			textFileService.save(URI.parse(uriStr)).catch(err => {
				console.error('[CleanSlate] Auto-save failed on acceptAll:', err);
			});
		}
		if (uris.length > 0) {
			InlineCleanSlateController.refreshGitDecorations(commandService);
		}
		InlineCleanSlateController._onDidChangeGlobalState.fire();
	}

	public static rejectAllGlobal(editorService: ICodeEditorService, textFileService: ITextFileService, commandService: ICommandService): void {
		const uris = Array.from(InlineCleanSlateController.stateMap.keys());
		for (const uriStr of uris) {
			const state = InlineCleanSlateController.stateMap.get(uriStr);
			if (!state) continue;
			const targetContent = state.sessions[0]?.beforeContent;
			InlineCleanSlateController.stateMap.delete(uriStr);

			const editors = editorService.listCodeEditors();
			for (const editor of editors) {
				if (editor.getModel()?.uri.toString() === uriStr) {
					if (typeof targetContent === 'string') {
						InlineCleanSlateController.replaceModelContents(editor.getModel()!, targetContent);
					}
					const controller = InlineCleanSlateController.get(editor);
					controller?.clear();
					break;
				}
			}

			// Persist the reverted content to disk directly by URI (see reject() for why this
			// can't go through the generic "save active editor" command).
			textFileService.save(URI.parse(uriStr)).catch(err => {
				console.error('[CleanSlate] Auto-revert save failed on rejectAll:', err);
			});
		}
		if (uris.length > 0) {
			InlineCleanSlateController.refreshGitDecorations(commandService);
		}
		InlineCleanSlateController._onDidChangeGlobalState.fire();
	}

	public static registerPostApplySession(
		editorService: ICodeEditorService,
		uri: URI,
		edits: IIdentifiedSingleEditOperation[],
		originalEdits: { range: IRange; text: string; originalStartLine: number }[],
		beforeContent: string,
		initialInstruction: string = ''
	): void {
		let state = InlineCleanSlateController.stateMap.get(uri.toString());
		if (!state) {
			state = { sessions: [], undoCount: 0 };
			InlineCleanSlateController.stateMap.set(uri.toString(), state);
		}

		state.sessions.push({
			edits,
			originalEdits,
			instruction: initialInstruction,
			beforeContent
		});
		state.undoCount++;

		const matchingEditors = editorService.listCodeEditors().filter(editor => editor.getModel()?.uri.toString() === uri.toString());
		for (const editor of matchingEditors) {
			const controller = InlineCleanSlateController.get(editor);
			if (controller) {
				controller.render(state.sessions);
				controller.revealLatestSession(state.sessions);
			}
		}

		InlineCleanSlateController._onDidChangeGlobalState.fire();
	}

	private static replaceModelContents(model: ITextModel, content: string): void {
		model.pushStackElement();
		model.pushEditOperations(
			null,
			[{ range: model.getFullModelRange(), text: content }],
			() => null
		);
		model.pushStackElement();
	}

	public static undoLastTrackedEdit(editorService: ICodeEditorService, uri: URI): boolean {
		const uriKey = uri.toString();
		const state = InlineCleanSlateController.stateMap.get(uriKey);
		if (!state || state.sessions.length === 0) {
			return false;
		}

		const lastSession = state.sessions[state.sessions.length - 1];
		const matchingEditors = editorService.listCodeEditors().filter(editor => editor.getModel()?.uri.toString() === uriKey);
		if (matchingEditors.length === 0) {
			return false;
		}

		const model = matchingEditors[0].getModel();
		if (!model) {
			return false;
		}

		state.sessions.pop();
		state.undoCount = Math.max(0, state.undoCount - 1);
		if (state.sessions.length === 0) {
			InlineCleanSlateController.stateMap.delete(uriKey);
		}

		InlineCleanSlateController.replaceModelContents(model, lastSession.beforeContent);

		for (const editor of matchingEditors) {
			const controller = InlineCleanSlateController.get(editor);

			if (state.sessions.length === 0) {
				controller?.clear();
			} else if (controller) {
				controller.render(state.sessions);
				controller.revealLatestSession(state.sessions);
			}
		}

		InlineCleanSlateController._onDidChangeGlobalState.fire();
		return true;
	}

	constructor(
		private readonly editor: ICodeEditor,
		@ICleanSlateEditCodeService private readonly editCodeService: ICleanSlateEditCodeService,
		@INotificationService private readonly notificationService: INotificationService,
		@ICommandService private readonly commandService: ICommandService,
		@ITextFileService private readonly textFileService: ITextFileService
	) {
		super();
		InlineCleanSlateController.ensureGlobalShortcutListener(this.commandService);

		// Restore state when switching tabs/models
		this._register(this.editor.onDidChangeModel(() => {
			this.clear();
			const model = this.editor.getModel();
			if (model) {
				const state = InlineCleanSlateController.stateMap.get(model.uri.toString());
				if (state) {
					this.restore(state);
				}
			}
		}));
	}

	private static ensureGlobalShortcutListener(commandService: ICommandService): void {
		if (this.globalShortcutListener) {
			return;
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			if (!InlineCleanSlateController.hasAnyPendingEdits()) {
				return;
			}

			const hasPrimaryModifier = event.metaKey || event.ctrlKey;
			const hasOnlyPrimaryModifier = hasPrimaryModifier && !event.shiftKey && !event.altKey;
			const commandId = hasOnlyPrimaryModifier && event.key === 'Enter'
				? InlineCleanSlateController.ACCEPT_ALL_COMMAND_ID
				: hasOnlyPrimaryModifier && event.key === 'Backspace'
					? InlineCleanSlateController.REJECT_ALL_COMMAND_ID
					: undefined;

			if (!commandId) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			void commandService.executeCommand(commandId);
		};

		mainWindow.document.addEventListener('keydown', handleKeyDown, true);
		this.globalShortcutListener = toDisposable(() => mainWindow.document.removeEventListener('keydown', handleKeyDown, true));
	}

	public show(edits: IIdentifiedSingleEditOperation[], initialInstruction: string = ''): void {
		const model = this.editor.getModel();
		if (!model) return;
		const beforeContent = model.getValue();

		// Sanitize edit ranges to prevent "Illegal value for lineNumber"
		const lineCount = model.getLineCount();
		const sanitizedEdits = edits.map(edit => {
			const startLine = Math.max(1, Math.min(edit.range.startLineNumber, lineCount));
			const endLine = Math.max(startLine, Math.min(edit.range.endLineNumber, lineCount));
			const startCol = Math.max(1, edit.range.startColumn);
			const endCol = Math.max(1, edit.range.endColumn);
			return {
				...edit,
				range: new Range(startLine, startCol, endLine, endCol)
			};
		}).filter(edit => edit.text !== undefined); // Remove any invalid edits

		if (sanitizedEdits.length === 0) return;

		// 1. Capture original text for each edit before applying
		const originalEdits = sanitizedEdits.map(edit => ({
			range: edit.range,
			text: model.getValueInRange(edit.range),
			originalStartLine: edit.range.startLineNumber
		}));

		// 2. Apply edits directly to the model for perfect rendering
		model.pushStackElement();
		this.editor.executeEdits('cleanSlate.preview', sanitizedEdits, () => null);
		model.pushStackElement();

		// 3. Save state (Cumulative)
		let state = InlineCleanSlateController.stateMap.get(model.uri.toString());
		if (!state) {
			state = { sessions: [], undoCount: 0 };
			InlineCleanSlateController.stateMap.set(model.uri.toString(), state);
		}

		state.sessions.push({
			edits: sanitizedEdits,
			originalEdits,
			instruction: initialInstruction,
			beforeContent
		});
		state.undoCount++;

		// 4. Render EVERYTHING in the session
		this.render(state.sessions);
		this.revealLatestSession(state.sessions);
		InlineCleanSlateController._onDidChangeGlobalState.fire();
	}

	public showPostApply(edits: IIdentifiedSingleEditOperation[], originalEdits: any[], beforeContent: string, initialInstruction: string = ''): void {
		const model = this.editor.getModel();
		if (!model) return;

		// 1. Save state WITHOUT calling executeEdits
		let state = InlineCleanSlateController.stateMap.get(model.uri.toString());
		if (!state) {
			state = { sessions: [], undoCount: 0 };
			InlineCleanSlateController.stateMap.set(model.uri.toString(), state);
		}

		state.sessions.push({
			edits: edits,
			originalEdits,
			instruction: initialInstruction,
			beforeContent
		});
		state.undoCount++; // Maintain undo count for Reject/Undo sync

		// 2. Render IMMEDIATELY
		this.render(state.sessions);
		this.revealLatestSession(state.sessions);
		InlineCleanSlateController._onDidChangeGlobalState.fire();
	}

	private restore(state: CleanSlateEditState): void {
		if (state.sessions.length > 0) {
			this.render(state.sessions);
			this.revealLatestSession(state.sessions);
		}
	}

	private revealLatestSession(sessions: CleanSlateSession[]): void {
		const latestSession = sessions[sessions.length - 1];
		const latestEdit = latestSession?.edits[latestSession.edits.length - 1];
		if (!latestEdit) {
			return;
		}

		this.editor.revealRangeInCenterIfOutsideViewport(latestEdit.range);
	}

	private render(sessions: CleanSlateSession[]): void {
		const model = this.editor.getModel();
		if (!model) return;

		// Clear any existing preview state FIRST
		this.clear();

		const totalLines = model.getLineCount();
		const insertionDecorations: IModelDeltaDecoration[] = [];

		// Render deletions and insertions for EACH session
		this.editor.changeViewZones((accessor: IViewZoneChangeAccessor) => {

			for (let s = 0; s < sessions.length; s++) {
				const session = sessions[s];
				const edits = session.edits;
				const originalEdits = session.originalEdits;

				let currentLineShift = 0;

				for (let i = 0; i < originalEdits.length; i++) {
					const original = originalEdits[i];
					const edit = edits[i];

					// Deletions (View Zones)
					if (original.text.trim()) {
						const domNode = document.createElement('div');
						domNode.className = 'cleanSlate-view-zone-delete';
						domNode.style.display = 'block';
						domNode.style.width = '100%';
						domNode.style.boxSizing = 'border-box';

						const lines = original.text.split('\n');
						lines.forEach(line => {
							const lineDiv = document.createElement('div');
							lineDiv.textContent = line || ' ';
							lineDiv.className = 'cleanSlate-view-zone-delete-line';
							domNode.appendChild(lineDiv);
						});

						const zoneId = accessor.addZone({
							afterLineNumber: original.originalStartLine + currentLineShift - 1,
							heightInLines: lines.length,
							domNode: domNode,
							ordinal: 5
						});
						this.viewZoneIds.push(zoneId);
					}

					// Insertions (Decorations)
					const numLinesAdded = edit.text ? edit.text.split('\n').length : 0;
					const numLinesDeleted = edit.range.endLineNumber - edit.range.startLineNumber + 1;

					if (edit.text && edit.text.trim()) {
						let startLine = edit.range.startLineNumber + currentLineShift;
						let endLine = startLine + numLinesAdded - 1;

						startLine = Math.max(1, Math.min(startLine, totalLines));
						endLine = Math.max(startLine, Math.min(endLine, totalLines));

						insertionDecorations.push({
							range: new Range(startLine, 1, endLine, model.getLineMaxColumn(endLine)),
							options: InlineCleanSlateController.DIFF_INSERT_DECORATION
						});
					}

					// Update shift for NEXT block within this session
					currentLineShift += (numLinesAdded - numLinesDeleted);
				}
			}
		});

		this.decorationCollection = this.editor.createDecorationsCollection(insertionDecorations);

		// Create ONLY ONE overlay widget
		if (sessions.length > 0) {
			this.widget = new InlineCleanSlateWidget(
				() => this.accept(),
				() => this.reject()
			);
			this.editor.addOverlayWidget(this.widget);
		}

		this.registerKeyListener();
	}

	private nextEdit(): void {
		const model = this.editor.getModel();
		if (!model) return;
		const state = InlineCleanSlateController.stateMap.get(model.uri.toString());
		if (!state) return;

		const allEdits: IRange[] = [];
		for (const session of state.sessions) {
			for (const edit of session.edits) {
				allEdits.push(edit.range);
			}
		}

		if (allEdits.length === 0) return;
		this.currentEditIndex = (this.currentEditIndex + 1) % allEdits.length;
		this.editor.revealRangeInCenterIfOutsideViewport(allEdits[this.currentEditIndex]);
	}

	private previousEdit(): void {
		const model = this.editor.getModel();
		if (!model) return;
		const state = InlineCleanSlateController.stateMap.get(model.uri.toString());
		if (!state) return;

		const allEdits: IRange[] = [];
		for (const session of state.sessions) {
			for (const edit of session.edits) {
				allEdits.push(edit.range);
			}
		}

		if (allEdits.length === 0) return;
		this.currentEditIndex = (this.currentEditIndex - 1 + allEdits.length) % allEdits.length;
		this.editor.revealRangeInCenterIfOutsideViewport(allEdits[this.currentEditIndex]);
	}

	/**
	 * Git's Source Control panel refreshes from its own file watcher/poll cycle, which can lag
	 * behind a programmatic save (as opposed to an interactive Cmd+S) enough to show a stale
	 * "modified" badge even after the file content is correctly reverted on disk. Nudge it to
	 * re-check status immediately. Best-effort: the git extension may not be active/installed.
	 */
	private static refreshGitDecorations(commandService: ICommandService): void {
		commandService.executeCommand('git.refresh').catch(() => { /* git extension not active; ignore */ });
	}

	public accept(): void {
		const model = this.editor.getModel();
		if (model) {
			InlineCleanSlateController.stateMap.delete(model.uri.toString());
			// PILLAR 12: Auto-Save Enforcement. Save the exact model URI directly rather than the
			// generic "save active editor" command: that command targets the active editor/explorer
			// selection, not the URI passed to it, so it silently no-ops (or saves the wrong file)
			// whenever this editor isn't the one currently focused.
			this.textFileService.save(model.uri)
				.then(() => InlineCleanSlateController.refreshGitDecorations(this.commandService))
				.catch(err => {
					console.error('[CleanSlate] Auto-save failed on accept:', err);
				});
		}
		this.clear();
		InlineCleanSlateController._onDidChangeGlobalState.fire();
	}

	public reject(): void {
		const model = this.editor.getModel();
		if (!model) return;

		const state = InlineCleanSlateController.stateMap.get(model.uri.toString());
		const targetContent = state?.sessions[0]?.beforeContent;

		InlineCleanSlateController.stateMap.delete(model.uri.toString());

		if (typeof targetContent === 'string') {
			InlineCleanSlateController.replaceModelContents(model, targetContent);
		}

		// PILLAR 12: Auto-revert Disk State on Reject. See accept() above for why this saves the
		// exact model URI directly instead of the generic "save active editor" command.
		this.textFileService.save(model.uri)
			.then(() => InlineCleanSlateController.refreshGitDecorations(this.commandService))
			.catch(err => {
				console.error('[CleanSlate] Auto-revert save failed on reject:', err);
			});

		this.clear();
		InlineCleanSlateController._onDidChangeGlobalState.fire();
	}

	public cancel(): void {
		// Ensure any state is cleaned up
		this.clear();
		const model = this.editor.getModel();
		if (model) InlineCleanSlateController.stateMap.delete(model.uri.toString());
		InlineCleanSlateController._onDidChangeGlobalState.fire();
	}

	private clear(): void {
		if (this.widget) {
			this.editor.removeOverlayWidget(this.widget);
			this.widget.dispose();
			this.widget = undefined;
		}
		this.keyListener?.dispose();
		this.keyListener = undefined;

		if (this.viewZoneIds.length > 0) {
			this.editor.changeViewZones((accessor: IViewZoneChangeAccessor) => {
				for (const id of this.viewZoneIds) {
					accessor.removeZone(id);
				}
			});
			this.viewZoneIds = [];
		}

		if (this.decorationCollection) {
			this.decorationCollection.clear();
			this.decorationCollection = undefined;
		}
	}

	private registerKeyListener(): void {
		this.keyListener?.dispose();
		this.keyListener = this.editor.onKeyDown(e => {
			// Alt + J for Next
			if (e.keyCode === KeyCode.KeyJ && e.altKey) {
				e.preventDefault();
				e.stopPropagation();
				this.nextEdit();
			}
			// Alt + K for Previous
			else if (e.keyCode === KeyCode.KeyK && e.altKey) {
				e.preventDefault();
				e.stopPropagation();
				this.previousEdit();
			}
		});
	}

	public previewDetailed(
		text: string,
		selections: Selection[],
		isRawContent: boolean = false
	): { count: number; added: number; deleted: number; diagnostics?: CleanSlateEditDiagnostic[]; error?: string } {
		const model = this.editor.getModel();
		if (!model) {
			return {
				count: 0,
				added: 0,
				deleted: 0,
				diagnostics: [{ code: 'invalid_input', message: 'No active model is available for preview.' }],
				error: 'No active model is available for preview.'
			};
		}

		// DIRECT FALLBACK FOR NEW FILES (Legacy Logic)
		if (model.getValue().trim().length === 0) {
			let codeBlocks = CleanSlateEditParser.parseCodeBlocks(text);

			// If no backticks found but there's content, treat the whole thing as code (raw input from tools)
			if (codeBlocks.length === 0 && text.trim().length > 0) {
				codeBlocks = [text];
			}

			if (codeBlocks.length > 0) {
				const range = new Range(1, 1, 1, 1);
				const content = codeBlocks[0];
				this.show([{ range, text: content }], '');
				const addedLines = content.split('\n').length;
				return { count: 1, added: addedLines, deleted: 0 };
			}
		}

		try {
			// Delegate calculation to the new Service for EXISTING files
			let allEdits: IIdentifiedSingleEditOperation[] = [];

			if (isRawContent) {
				// We already have the full final content, just compute a direct line-diff
				allEdits = CleanSlateDiffService.computeDiff(model.getValue(), text);
			} else {
				// Convert legacy preview text into structured edits before planning.
				let blocks = CleanSlateEditParser.parseSearchReplace(text);
				if (blocks.length === 0) {
					let codeBlocks = CleanSlateEditParser.parseCodeBlocks(text);
					if (codeBlocks.length === 0 && text.trim().length > 0) {
						codeBlocks = [text];
					}
					if (codeBlocks.length > 0) {
						blocks = [{ orig: '', final: codeBlocks[0], state: 'done' }];
					}
				}

				const structuredEdits = blocks.map(block => block.orig.length > 0
					? { mode: 'replace_exact' as const, originalText: block.orig, replacementText: block.final }
					: { mode: 'full_file' as const, content: block.final });
				const plan = CleanSlateEditService.planEdits(model, { edits: structuredEdits });
				if (!plan.ok) {
					return {
						count: 0,
						added: 0,
						deleted: 0,
						diagnostics: plan.diagnostics,
						error: CleanSlateEditService.formatFailure(plan)
					};
				}
				allEdits = plan.edits;
			}

			if (allEdits.length > 0) {
				// Apply Edits via the standard flow
				this.show(allEdits, '');

				let totalAdded = 0;
				let totalDeleted = 0;

				for (const edit of allEdits) {
					// Add lines count
					if (edit.text && edit.text.length > 0) {
						totalAdded += edit.text.split('\n').length;
					}

					// Delete lines count
					// If range is empty (start === end), then 0 lines deleted
					if (edit.range.startLineNumber === edit.range.endLineNumber &&
						edit.range.startColumn === edit.range.endColumn) {
						// Pure insertion
					} else {
						totalDeleted += (edit.range.endLineNumber - edit.range.startLineNumber + 1);
					}
				}

				return { count: allEdits.length, added: totalAdded, deleted: totalDeleted };
			} else {
				return {
					count: 0,
					added: 0,
					deleted: 0,
					diagnostics: [{ code: 'no_op', message: 'Preview produced no visible file changes.' }],
					error: 'Preview produced no visible file changes.'
				};
			}
		} catch (error: any) {
			console.error('[CleanSlate] preview() error:', error);
			// Return structured diagnostics instead of re-throwing so callers can recover intelligently.
			return {
				count: 0,
				added: 0,
				deleted: 0,
				diagnostics: [{ code: 'invalid_input', message: String(error) }],
				error: String(error)
			};
		}
	}

	public preview(text: string, selections: Selection[], isRawContent: boolean = false): { count: number; added: number; deleted: number } {
		const result = this.previewDetailed(text, selections, isRawContent);
		return { count: result.count, added: result.added, deleted: result.deleted };
	}

	public undoLastAIEdit(): void {
		const model = this.editor.getModel();
		if (model) {
			this.editCodeService.undoLastAIEdit(model.uri);
			this.notificationService.info('AI edit undone.');
			this.editor.focus();
		}
	}
}

registerEditorContribution(InlineCleanSlateController.ID, InlineCleanSlateController, EditorContributionInstantiation.Lazy);
