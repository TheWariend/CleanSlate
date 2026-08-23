/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Static, Text, useApp, useInput, useStdout } from 'ink';
import {
	CleanSlateNodeAgentRuntime,
	createNodeProviderConfiguration
} from '@cleanslate/sdk/node';
import { apiKeyFromEnvironment, ICliArguments, SUPPORTED_PROVIDERS } from './argv.js';
import { CleanSlateTerminalLogo } from './brand.js';
import { LiveTurnBuffer } from './liveTurn.js';
import { CleanSlateStreamReveal, REVEAL_TICK_MS } from '@cleanslate/sdk/agent/cleanSlateStreamReveal.js';
import { sanitizeToolResultForRenderer } from '@cleanslate/sdk/agent/cleanSlateToolResultPromptSerializer.js';
import { getCleanSlateContextDefaults, resolveCleanSlateReasoningLevelOptions } from '@cleanslate/sdk/protocol/cleanSlateModelCapabilities.js';
import { CliProjectContext } from './projectContext.js';
import {
	CliWorkspaceReview,
	cliTurnDiffReviews,
	ICliDiffFile,
	ICliDiffReview,
	ICliDiffLine,
	formatCliDiffLine,
	parseCliDiffFile
} from './workspaceReview.js';
import { createEditPreview, ICliEditPreview } from './editPreview.js';
import { CliPermissionMode, CliPermissionPolicy } from './permissions.js';
import { getCleanSlateWorkspaceStorageHome } from './config.js';
import { isTerminalMouseEvent, terminalMouseEvent, terminalMouseWheelDirection } from './terminalScreen.js';
import { displayPath } from './displayPath.js';
import { useTerminalSize } from './useTerminalSize.js';
import {
	CliSessionStore,
	ICliSession,
	ICliTranscriptEntry,
	transcriptEntry
} from './sessions.js';

interface ITuiProps {
	args: ICliArguments;
	store: CliSessionStore;
	initialSession: ICliSession;
	initialTask?: string;
	onConfigurationChange?: (args: ICliArguments) => void;
	getCredential?: (provider: ICliArguments['provider']) => string | undefined;
	onCredentialChange?: (provider: ICliArguments['provider'], credential: string) => void;
	onCredentialRemove?: (provider: ICliArguments['provider']) => boolean;
	onDoctor?: () => string;
	onRequestSetup?: () => void;
}

interface IApprovalRequest {
	command: string;
	cwd?: string;
	reason?: string;
}

interface IPendingApproval {
	request: IApprovalRequest;
	resolve: (approved: boolean) => void;
}

interface IPendingEditApproval {
	request: { toolName: string; category?: string; input: unknown };
	preview?: ICliEditPreview;
	resolve: (approved: boolean) => void;
}

interface IModelTerminationNotice {
	message: string;
	mode: 'execution' | 'planning';
}

interface IPlanApprovalNotice {
	message: string;
}

interface ICliContextMessage {
	role?: unknown;
	content?: unknown;
	renderPayload?: unknown;
}

function estimateContextChars(value: unknown): number {
	if (typeof value === 'string') {
		return value.length;
	}
	if (Array.isArray(value)) {
		return value.reduce((total, item) => total + estimateContextChars(item), 0);
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

/** Mirrors the IDE composer meter: visible thread history and the current draft at four chars/token. */
export function estimateCliContextWindowUsage(
	messages: readonly ICliContextMessage[],
	inputValue: string,
	contextWindowTokens: number
): { usedTokens: number; maxTokens: number; percentage: number } {
	const maxTokens = Math.max(1, Math.floor(contextWindowTokens));
	const charCount = messages.reduce((total, message) => total
		+ estimateContextChars(message.role)
		+ estimateContextChars(message.content)
		+ estimateContextChars(message.renderPayload), estimateContextChars(inputValue));
	const usedTokens = Math.ceil(charCount / 4);
	return {
		usedTokens,
		maxTokens,
		percentage: Math.max(0, Math.min(100, (usedTokens / maxTokens) * 100))
	};
}

const COLORS = {
	accent: '#d4d4d8',
	muted: '#71717a',
	success: '#22c55e',
	danger: '#ef4444',
	warning: '#f59e0b',
	shimmer: '#ffffff'
};

export function formatModelTerminationMessage(message: string): string {
	const turnLimit = message.match(/(\d+)-turn agent safety limit/i)?.[1];
	if (turnLimit) {
		return `The model reached the ${turnLimit}-turn safety limit before finishing the task.`;
	}
	if (/same tool call was repeated/i.test(message)) {
		return 'The model paused after repeatedly calling the same tool.';
	}
	if (/edit-failure recovery/i.test(message)) {
		return 'The model paused after repeated edit failures.';
	}
	return 'The model stopped before completing the task.';
}

export function ModelTerminationNotice({ message }: { message: string }): React.JSX.Element {
	return (
		<Box borderStyle="round" borderColor={COLORS.warning} paddingX={1} flexDirection="column">
			<Box justifyContent="space-between">
				<Text color={COLORS.warning} bold>⚠ Model terminated</Text>
				<Text color={COLORS.success} bold>Enter · Continue</Text>
			</Box>
			<Text color={COLORS.muted} wrap="truncate-end">{formatModelTerminationMessage(message)} · Esc dismiss</Text>
		</Box>
	);
}

export function PlanApprovalNotice({ message }: IPlanApprovalNotice): React.JSX.Element {
	return (
		<Box borderStyle="round" borderColor={COLORS.accent} paddingX={1} flexDirection="column">
			<Box justifyContent="space-between">
				<Text color={COLORS.accent} bold>Proceed with these steps?</Text>
				<Text color={COLORS.success} bold>Enter · Approve</Text>
			</Box>
			<Text color={COLORS.muted} wrap="truncate-end">{message} · Just type what should change to revise · Esc dismiss</Text>
		</Box>
	);
}

export interface ICommandPaletteItem {
	id: string;
	label: string;
	description: string;
	requiresArguments?: boolean;
}

const COMMAND_PALETTE_ITEMS: readonly ICommandPaletteItem[] = [
	{ id: '/plan', label: 'Plan mode', description: 'Turn planning mode on' },
	{ id: '/auto', label: 'Auto', description: 'Apply edits and run commands automatically' },
	{ id: '/manual', label: 'Manual approval', description: 'Review and approve each file edit' },
	{ id: '/fix', label: 'Fix', description: 'Fix bugs and root causes', requiresArguments: true },
	{ id: '/explain', label: 'Explain', description: 'Explain relevant code', requiresArguments: true },
	{ id: '/test', label: 'Test', description: 'Write comprehensive tests', requiresArguments: true },
	{ id: '/rewrite', label: 'Rewrite', description: 'Improve code without changing behavior', requiresArguments: true },
	{ id: '/doc', label: 'Document', description: 'Add documentation', requiresArguments: true },
	{ id: '/review', label: 'Review', description: 'Review bugs, security, and quality', requiresArguments: true },
	{ id: '/optimize', label: 'Optimize', description: 'Apply targeted performance improvements', requiresArguments: true },
	{ id: '/scaffold', label: 'Scaffold', description: 'Scaffold a complete implementation', requiresArguments: true },
	{ id: '/migrate', label: 'Migrate', description: 'Migrate code to a specified target', requiresArguments: true },
	{ id: '/setup', label: 'Provider setup', description: 'Change provider, credentials, and model' },
	{ id: '/models', label: 'Models', description: 'Browse models for the active provider' },
	{ id: '/model', label: 'Set model', description: 'Switch directly to a model ID', requiresArguments: true },
	{ id: '/provider', label: 'Set provider', description: 'Switch using a saved credential', requiresArguments: true },
	{ id: '/reasoning', label: 'Reasoning', description: 'Choose reasoning effort' },
	{ id: '/permissions', label: 'Permissions', description: 'Switch read-only, default, or full mode', requiresArguments: true },
	{ id: '/new', label: 'New session', description: 'Start a clean session' },
	{ id: '/sessions', label: 'Sessions', description: 'Browse saved sessions' },
	{ id: '/resume', label: 'Resume', description: 'Resume a session by ID', requiresArguments: true },
	{ id: '/status', label: 'Status', description: 'Show provider and execution status' },
	{ id: '/context', label: 'Context', description: 'Show loaded project instructions and attached files' },
	{ id: '/changes', label: 'Changes', description: 'Show the current Git working tree' },
	{ id: '/diff', label: 'Diff', description: 'Review current and per-turn changes' },
	{ id: '/details', label: 'Tool details', description: 'Expand or collapse the selected tool item' },
	{ id: '/doctor', label: 'Doctor', description: 'Check the CLI, provider, workspace, and integrations' },
	{ id: '/logout', label: 'Log out', description: 'Remove the saved credential for the active provider' },
	{ id: '/clear', label: 'Clear', description: 'Clear conversation and transcript' },
	{ id: '/help', label: 'Help', description: 'Show terminal commands' },
	{ id: '/exit', label: 'Exit', description: 'Save and quit' }
];

export function commandPaletteSelection(item: ICommandPaletteItem): { value: string; execute: boolean } {
	return item.requiresArguments
		? { value: `${item.id} `, execute: false }
		: { value: item.id, execute: true };
}

export interface ICommandPaletteFilter {
	items: readonly ICommandPaletteItem[];
	/** True when the input is a complete command followed by a space, awaiting its arguments. */
	awaitingArguments: boolean;
}

/**
 * Resolves the palette contents for the current input.
 *
 * Matches `/`, partial words, and a complete command plus trailing space (`/permissions `).
 * The trailing-space case stays open on the exact command so choosing an argument-taking
 * command keeps visible feedback instead of silently closing the dropup.
 */
export function filterCommandPaletteItems(input: string, mode: CliInteractiveMode): ICommandPaletteFilter {
	const match = /^\/(\S*)( ?)$/.exec(input);
	if (!match) {
		return { items: [], awaitingArguments: false };
	}
	const query = match[1].toLowerCase();
	const trailingSpace = Boolean(match[2]);
	const items = COMMAND_PALETTE_ITEMS.filter(item =>
		(mode !== 'planning' || item.id !== '/plan')
		&& (item.id.slice(1).includes(query) || item.label.toLowerCase().includes(query)));
	const narrowed = trailingSpace
		? items.filter(item => item.id.toLowerCase() === `/${query}`)
		: items;
	return { items: narrowed, awaitingArguments: trailingSpace };
}

// The mode label leads the footer in its own colour and is rendered separately; this is the
// remainder of the hint list. Scrolling is the terminal's own now, so it is not advertised here.
const FOOTER_HELP = 'shift+tab mode · ctrl+o details · / commands';
const TRANSCRIPT_FIRST_ROW = 6;

function PromptInput(props: {
	value: string;
	focus: boolean;
	placeholder: string;
	onChange: (value: string) => void;
	onSubmit: (value: string) => void;
}): React.JSX.Element {
	const { value, focus, placeholder, onChange, onSubmit } = props;
	const [cursor, setCursor] = useState(value.length);

	useEffect(() => {
		setCursor(current => Math.min(current, value.length));
	}, [value]);

	useInput((input, key) => {
		if (isTerminalMouseEvent(input)
			|| (key.ctrl && (input === 'c' || input === 'o' || input === 'j' || input === 'k'))
			|| key.tab
			|| key.escape
			|| key.upArrow
			|| key.downArrow
			|| key.pageUp
			|| key.pageDown) {
			return;
		}
		if (key.return) {
			onSubmit(value);
			return;
		}
		if (key.leftArrow || (key.ctrl && input === 'b')) {
			setCursor(current => Math.max(0, current - 1));
			return;
		}
		if (key.rightArrow || (key.ctrl && input === 'f')) {
			setCursor(current => Math.min(value.length, current + 1));
			return;
		}
		if (key.ctrl && input === 'a') {
			setCursor(0);
			return;
		}
		if (key.ctrl && input === 'e') {
			setCursor(value.length);
			return;
		}
		if (key.backspace || key.delete) {
			if (cursor > 0) {
				onChange(value.slice(0, cursor - 1) + value.slice(cursor));
				setCursor(current => current - 1);
			}
			return;
		}
		if (input) {
			onChange(value.slice(0, cursor) + input + value.slice(cursor));
			setCursor(current => current + input.length);
		}
	}, { isActive: focus });

	if (!value) {
		return (
			<Text color={COLORS.muted}>
				{focus && placeholder
					? <><Text inverse>{placeholder[0]}</Text>{placeholder.slice(1)}</>
					: placeholder}
			</Text>
		);
	}

	return (
		<Text>
			{value.slice(0, cursor)}
			{focus && <Text inverse>{cursor < value.length ? value[cursor] : ' '}</Text>}
			{value.slice(cursor + (focus && cursor < value.length ? 1 : 0))}
		</Text>
	);
}

function CommandPalette({ items, selected }: { items: readonly ICommandPaletteItem[]; selected: number }) {
	const start = Math.max(0, Math.min(selected - 5, items.length - 10));
	return (
		<Box borderStyle="round" borderColor={COLORS.accent} flexDirection="column" paddingX={1}>
			<Text bold>Commands</Text>
			{items.slice(start, start + 10).map((item, offset) => {
				const index = start + offset;
				return <Text key={item.id} inverse={selected === index}>
					{selected === index ? '› ' : '  '}<Text color={COLORS.accent}>{item.id}</Text>
					<Text>  {item.label}</Text>
					<Text color={COLORS.muted}> — {item.description}</Text>
				</Text>;
			})}
			<Text color={COLORS.muted}>↑/↓ select · enter choose · esc close</Text>
		</Box>
	);
}

function compact(value: unknown, limit = 180): string {
	const text = typeof value === 'string' ? value : JSON.stringify(value);
	if (!text) {
		return '';
	}
	const clean = text.replace(/\s+/g, ' ').trim();
	return clean.length <= limit ? clean : `${clean.slice(0, limit - 1)}…`;
}

function stringifyDetail(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}
	if (value === undefined) {
		return '';
	}
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function toolInputDetail(input: any): string {
	if (input === undefined) {
		return '';
	}
	if (typeof input?.command === 'string' && input.command.trim()) {
		return input.command;
	}
	if (typeof input?.file_path === 'string' && input.file_path.trim()) {
		return input.file_path;
	}
	if (typeof input?.path === 'string' && input.path.trim()) {
		return input.path;
	}
	if (typeof input?.query === 'string' && input.query.trim()) {
		return input.query;
	}
	if (typeof input?.pattern === 'string' && input.pattern.trim()) {
		return input.pattern;
	}
	if (typeof input?.name === 'string' && input.name.trim()) {
		return input.name;
	}
	return stringifyDetail(input);
}

function toolTargetDetail(entry: ICliTranscriptEntry): string {
	const detail = entry.detail;
	if (!detail || typeof detail !== 'object') {
		// Resumed sessions may only keep a short content string; show it as the target.
		const fallback = entry.content?.trim();
		return fallback && fallback !== 'completed' && fallback !== 'failed' ? fallback : '';
	}
	const input = 'input' in detail ? (detail as { input?: any }).input : undefined;
	const result = 'result' in detail ? (detail as { result?: any }).result : undefined;
	if (typeof input?.command === 'string' && input.command.trim()) {
		return input.command;
	}
	const discoveredPaths = [
		result?.path,
		...(Array.isArray(result?.results) ? result.results.map((item: any) => item?.path) : []),
		...(Array.isArray(result?.files) ? result.files.map((item: any) => item?.path) : []),
		...(Array.isArray(result?.affectedFiles) ? result.affectedFiles : [])
	].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
	if (discoveredPaths.length > 0) {
		return discoveredPaths.length === 1 ? discoveredPaths[0] : `${discoveredPaths[0]} +${discoveredPaths.length - 1}`;
	}
	if (typeof input?.file_path === 'string' && input.file_path.trim()) {
		return input.file_path;
	}
	if (typeof input?.path === 'string' && input.path.trim()) {
		return input.path;
	}
	if (typeof input?.name === 'string' && input.name.trim()) {
		return input.name;
	}
	if (typeof input?.pattern === 'string' && input.pattern.trim()) {
		return input.pattern;
	}
	if (typeof input?.query === 'string' && input.query.trim()) {
		return input.query;
	}
	return '';
}

function toolSummary(part: any): string {
	const result = part?.result;
	if (result?.error) {
		return compact(result.error);
	}
	if (result?.message) {
		return compact(result.message);
	}
	if (result?.path) {
		return compact(result.path);
	}
	if (typeof result?.output === 'string' && result.output.trim()) {
		return compact(result.output);
	}
	return result?.success === false ? 'failed' : 'completed';
}

function toolResultDetail(result: any, fallback: string): string {
	if (typeof result?.output === 'string' && result.output.trim()) {
		return result.output;
	}
	if (typeof result?.error === 'string' && result.error.trim()) {
		return result.error;
	}
	if (typeof result?.message === 'string' && result.message.trim()) {
		return result.message;
	}
	if (result !== undefined) {
		const serialized = stringifyDetail(result);
		if (serialized && serialized !== '{}' && serialized !== '[]') {
			return serialized;
		}
	}
	return fallback;
}

function toolEntryDetail(entry: ICliTranscriptEntry): string {
	const detail = entry.detail;
	if (!detail || typeof detail !== 'object') {
		return entry.content && entry.content !== 'completed' ? entry.content : '';
	}
	const input = 'input' in detail ? (detail as { input?: unknown }).input : undefined;
	const result = 'result' in detail ? (detail as { result?: unknown }).result : undefined;
	const sections: string[] = [];
	const inputDetail = toolInputDetail(input);
	if (inputDetail) {
		sections.push(`Input: ${inputDetail}`);
	}
	const resultDetail = toolResultDetail(result, entry.content && entry.content !== 'completed' ? entry.content : '');
	if (resultDetail) {
		sections.push(`Result: ${resultDetail}`);
	}
	return sections.join('\n');
}

export type TranscriptViewportLineKind =
	| 'blank'
	| 'user'
	| 'assistant'
	| 'reasoning'
	| 'tool'
	| 'toolError'
	| 'diffHeader'
	| 'diffHunk'
	| 'diffAddition'
	| 'diffDeletion'
	| 'diffContext'
	| 'system'
	| 'error';

export interface ITranscriptViewportLine {
	key: string;
	kind: TranscriptViewportLineKind;
	text: string;
	toolItemId?: string;
	selected?: boolean;
}

/**
 * An entry in the permanently-flushed <Static> region: the one-time startup banner followed by
 * every settled transcript line. Ink writes each of these exactly once, so they land in the
 * terminal's real scrollback and stay readable after scrolling off screen.
 */
export interface ICliReasoningOption {
	level: string;
	enabled: boolean;
	native?: boolean;
	disabledReason?: string;
}

export type ICliStaticItem =
	| { type: 'banner'; key: string }
	| { type: 'line'; key: string; line: ITranscriptViewportLine };

export function transcriptToolItemIds(entries: readonly ICliTranscriptEntry[]): string[] {
	return entries.filter(entry => entry.kind === 'tool').map(entry => entry.id);
}

export function formatElapsedTime(durationMs: number): string {
	const seconds = Math.max(1, Math.round(durationMs / 1000));
	if (seconds < 60) {
		return `Worked for ${seconds}s`;
	}
	const minutes = Math.floor(seconds / 60);
	const remainder = seconds % 60;
	return `Worked for ${minutes}m${remainder ? ` ${remainder}s` : ''}`;
}

function inlineEditDiffLines(
	entry: ICliTranscriptEntry,
	width: number,
	maxPreviewLines = 14
): ITranscriptViewportLine[] {
	if (!entry.detail || typeof entry.detail !== 'object') {
		return [];
	}
	const detail = entry.detail as { input?: any; result?: any };
	const result = detail.result ?? detail;
	if (entry.status !== 'completed' || typeof result?.diff !== 'string' || !result.diff.trim()) {
		return [];
	}
	const filePath = String(result.path ?? detail.input?.file_path ?? detail.input?.path ?? 'changed file');
	const parsed = parseCliDiffFile(filePath, 'turn', result.diff);
	const content = parsed.lines.filter(line => line.kind !== 'header' && line.text !== '');
	const preview = content.slice(0, maxPreviewLines);
	const safeWidth = Math.max(8, width);
	const lines: ITranscriptViewportLine[] = [{
		key: `${entry.id}-inline-diff-header`,
		kind: 'diffHeader',
		text: `  ${filePath.split(/[\\/]/).at(-1)}  +${parsed.additions} -${parsed.deletions}`
	}];
	for (const [index, line] of preview.entries()) {
		const kind: TranscriptViewportLineKind = line.kind === 'addition'
			? 'diffAddition'
			: line.kind === 'deletion'
				? 'diffDeletion'
				: line.kind === 'hunk'
					? 'diffHunk'
					: 'diffContext';
		for (const [wrapIndex, text] of wrapViewportText(`  ${formatCliDiffLine(line)}`, safeWidth).entries()) {
			lines.push({
				key: `${entry.id}-inline-diff-${index}-${wrapIndex}`,
				kind,
				text
			});
		}
	}
	if (content.length > preview.length) {
		lines.push({
			key: `${entry.id}-inline-diff-more`,
			kind: 'diffHeader',
			text: `  … ${content.length - preview.length} more diff lines · /diff to review`
		});
	}
	return lines;
}

function wrapViewportText(value: string, width: number): string[] {
	const safeWidth = Math.max(1, width);
	const result: string[] = [];
	for (const sourceLine of value.replace(/\t/g, '  ').split('\n')) {
		if (!sourceLine) {
			result.push('');
			continue;
		}
		let remaining = sourceLine;
		while (remaining.length > safeWidth) {
			let split = remaining.lastIndexOf(' ', safeWidth);
			if (split <= 0) {
				split = safeWidth;
			}
			result.push(remaining.slice(0, split).trimEnd());
			remaining = remaining.slice(split).trimStart();
		}
		result.push(remaining);
	}
	return result.length > 0 ? result : [''];
}

/**
 * Collapses runs of blank lines in a user/assistant turn to a single paragraph break, and trims
 * leading and trailing ones.
 *
 * A streamed turn accumulates newlines from two sources: the model's own text, which usually
 * already ends a paragraph with a newline, and `LiveTurnBuffer.appendText`, which inserts a
 * blank line when the text phase changes. Together they routinely produce three or four
 * consecutive newlines, and every one past the first rendered as an empty row — the visible gap
 * between two paragraphs of an answer.
 *
 * Applies only to turn prose. Tool output and diffs keep their exact spacing.
 */
export function normalizeTurnProse(content: string): string {
	return content.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
}

export function transcriptViewportLines(
	entries: readonly ICliTranscriptEntry[],
	width: number,
	expandedTools: boolean | ReadonlySet<string> = false,
	selectedToolItemId?: string,
	expandedToolEntries: boolean | ReadonlySet<string> = expandedTools
): ITranscriptViewportLine[] {
	const safeWidth = Math.max(8, width);
	const lines: ITranscriptViewportLine[] = [];
	const pushWrapped = (
		entry: ICliTranscriptEntry,
		kind: TranscriptViewportLineKind,
		value: string,
		segment = 'content'
	) => {
		for (const [index, text] of wrapViewportText(value, safeWidth).entries()) {
			lines.push({ key: `${entry.id}-${segment}-${kind}-${index}`, kind, text });
		}
	};
	const pushTurn = (entry: ICliTranscriptEntry, kind: 'user' | 'assistant', marker: string) => {
		const continuationIndent = ' '.repeat(marker.length + 1);
		for (const [index, text] of wrapViewportText(normalizeTurnProse(entry.content), Math.max(1, safeWidth - continuationIndent.length)).entries()) {
			lines.push({
				key: `${entry.id}-${kind}-${index}`,
				kind,
				text: `${index === 0 ? `${marker} ` : continuationIndent}${text}`
			});
		}
	};
	const pushTurnSpacing = (entry: ICliTranscriptEntry) => {
		if (lines.length > 0 && lines.at(-1)?.kind !== 'blank') {
			lines.push({ key: `${entry.id}-space`, kind: 'blank', text: '' });
		}
	};
	const pushExpandedTool = (entry: ICliTranscriptEntry, expanded: boolean) => {
		const marker = entry.status === 'running' ? '●' : entry.status === 'failed' ? '×' : '✓';
		const target = toolTargetDetail(entry);
		const label = ({
			execute_command: 'Ran',
			read_file: 'Read',
			read_file_range: 'Read',
			apply_edit: 'Updated',
			write_file: 'Wrote',
			multi_file_replace: 'Updated files',
			search_workspace: 'Searched',
			grep_search: 'Searched',
			find_by_name: 'Found',
			list_dir: 'Listed',
			read_lints: 'Checked lints'
		} as Record<string, string>)[entry.toolName ?? ''] ?? (entry.toolName ?? 'Tool').replace(/_/g, ' ');
		const duration = entry.durationMs === undefined ? '' : ` · ${Math.max(1, Math.round(entry.durationMs / 100) / 10)}s`;
		const heading = target
			? `  ${marker} ${expanded ? '⌄' : '›'} ${label}(${compact(target, 140)})${duration}`
			: `  ${marker} ${expanded ? '⌄' : '›'} ${label}${duration}`;
		const headingStart = lines.length;
		pushWrapped(entry, entry.status === 'failed' ? 'toolError' : 'tool', heading, 'heading');
		for (let lineIndex = headingStart; lineIndex < lines.length; lineIndex++) {
			lines[lineIndex] = {
				...lines[lineIndex],
				toolItemId: entry.id,
				selected: entry.id === selectedToolItemId
			};
		}
		const detailText = toolEntryDetail(entry);
		if (expanded && detailText) {
			const detailLines = detailText.split(/\r?\n/);
			for (const [detailIndex, detailLine] of detailLines.entries()) {
				pushWrapped(
					entry,
					entry.status === 'failed' ? 'toolError' : 'tool',
					`${detailIndex === 0 ? '    └ ' : '      '}${detailLine}`,
					`result-${detailIndex}`
				);
			}
		}
	};
	// Every tool call renders in place, in sequence, the way the IDE chat does: one status row
	// per call, with Ctrl-O (or a click) expanding that row's input and result details. Edit
	// tools additionally keep their inline diff preview directly under the call.
	for (const entry of entries) {
		if (entry.kind === 'tool') {
			pushExpandedTool(entry, expandedToolEntries === true
				|| (expandedToolEntries instanceof Set && expandedToolEntries.has(entry.id)));
			lines.push(...inlineEditDiffLines(entry, safeWidth));
			continue;
		}
		if (entry.kind === 'user') {
			pushTurnSpacing(entry);
			pushTurn(entry, 'user', '❯');
		} else if (entry.kind === 'assistant') {
			pushTurnSpacing(entry);
			pushTurn(entry, 'assistant', '↳');
			if (entry.durationMs !== undefined) {
				lines.push({
					key: `${entry.id}-elapsed`,
					kind: 'system',
					text: `  ${formatElapsedTime(entry.durationMs)}`
				});
			}
		} else if (entry.kind === 'reasoning') {
			continue;
		} else {
			pushWrapped(entry, entry.kind === 'error' ? 'error' : 'system', `  ${entry.content}`);
		}
	}
	return lines;
}

export function visibleTranscriptLines(
	entries: readonly ICliTranscriptEntry[],
	width: number,
	rows: number,
	scrollOffset = 0,
	expandedTools: boolean | ReadonlySet<string> = false,
	selectedToolItemId?: string,
	expandedToolEntries: boolean | ReadonlySet<string> = expandedTools
): ITranscriptViewportLine[] {
	const lines = transcriptViewportLines(entries, width, expandedTools, selectedToolItemId, expandedToolEntries);
	const safeRows = Math.max(1, rows);
	const maxOffset = Math.max(0, lines.length - safeRows);
	const offset = Math.max(0, Math.min(maxOffset, scrollOffset));
	const end = lines.length - offset;
	return lines.slice(Math.max(0, end - safeRows), end);
}

export function padTranscriptViewportLines(
	lines: readonly ITranscriptViewportLine[],
	rows: number
): ITranscriptViewportLine[] {
	const safeRows = Math.max(1, rows);
	const visible = lines.slice(-safeRows);
	const blanks = Array.from({ length: Math.max(0, safeRows - visible.length) }, (_, index) => ({
		key: `viewport-blank-${index}`,
		kind: 'blank' as const,
		text: ''
	}));
	return [...visible, ...blanks];
}

export function formatActivityStatus(status: string): string {
	// “Thinking…” while the model reasons between tool calls, “Working…” while a tool runs.
	const runningMatch = /^running (.+)$/.exec(status);
	if (runningMatch) {
		return 'Working…';
	}
	switch (status) {
		case 'cancelling':
			return 'Cancelling…';
		case 'compacting context':
			return 'Organizing context…';
		case 'waiting for answer':
			return 'Waiting for answer…';
		default:
			return 'Thinking…';
	}
}

export function formatToolNameForDisplay(toolName: string): string {
	return toolName
		.replace(/^mcp_/, 'MCP ')
		.split(/[_\s.-]+/)
		.filter(Boolean)
		.map(part => part.length <= 2 ? part.toUpperCase() : `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
		.join(' ');
}

// IDE parity with cleanSlate-working-sheen: a narrow highlight band sweeps across the working
// label while a turn streams, instead of leaving static text under the spinner.
export const SHIMMER_FRAME_COUNT = 16;
export const SHIMMER_TICK_MS = 90;
const SHIMMER_BAND = 7;

export interface IShimmerSegment {
	text: string;
	lit: boolean;
}

export function shimmerSegments(label: string, frame: number): IShimmerSegment[] {
	if (!label) {
		return [];
	}
	const cycle = ((frame % SHIMMER_FRAME_COUNT) + SHIMMER_FRAME_COUNT) % SHIMMER_FRAME_COUNT;
	// The band center sweeps across the label itself, so part of the highlight is always
	// visible instead of starting each sweep with a fully unlit placeholder.
	const center = Math.round((cycle / (SHIMMER_FRAME_COUNT - 1)) * (label.length - 1));
	return [...label].map((char, index) => ({
		text: char,
		lit: Math.abs(index - center) * 2 < SHIMMER_BAND
	}));
}

function ShimmerLabel({ label, frame }: { label: string; frame: number }): React.JSX.Element {
	return (
		<Text>
			{shimmerSegments(label, frame).map((segment, index) => (
				<Text key={index} color={segment.lit ? COLORS.shimmer : COLORS.muted}>{segment.text}</Text>
			))}
		</Text>
	);
}

export type CliInteractiveMode = 'planning' | 'auto' | 'manual';

export function formatHeaderModeLabel(mode: CliInteractiveMode): string {
	switch (mode) {
		case 'planning': return 'PLAN';
		case 'auto': return 'AUTO';
		case 'manual': return 'MANUAL';
	}
}

export function nextInteractiveMode(mode: CliInteractiveMode): CliInteractiveMode {
	switch (mode) {
		case 'planning': return 'auto';
		case 'auto': return 'manual';
		case 'manual': return 'planning';
	}
}

export function runtimeModeForInteractiveMode(mode: CliInteractiveMode): 'execution' | 'planning' {
	return mode === 'planning' ? 'planning' : 'execution';
}

export function executionInteractiveMode(permissionMode: CliPermissionMode): Exclude<CliInteractiveMode, 'planning'> {
	return permissionMode === 'full' ? 'auto' : 'manual';
}

type DiffSyntaxKind = 'plain' | 'keyword' | 'string' | 'number' | 'comment';

export interface IDiffSyntaxToken {
	kind: DiffSyntaxKind;
	text: string;
}

export function diffSyntaxTokens(value: string): IDiffSyntaxToken[] {
	const pattern = /(\/\/.*$|#.*$|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\b(?:class|interface|type|function|const|let|var|return|if|else|for|while|switch|case|break|continue|async|await|import|export|from|new|extends|implements|public|private|protected|static|final|void|true|false|null|undefined|this|super|try|catch|finally|throw)\b|\b\d+(?:\.\d+)?\b)/gm;
	const tokens: IDiffSyntaxToken[] = [];
	let offset = 0;
	for (const match of value.matchAll(pattern)) {
		const index = match.index ?? offset;
		if (index > offset) {
			tokens.push({ kind: 'plain', text: value.slice(offset, index) });
		}
		const text = match[0];
		const kind: DiffSyntaxKind = text.startsWith('//') || text.startsWith('#') || text.startsWith('/*')
			? 'comment'
			: /^['"`]/.test(text)
				? 'string'
				: /^\d/.test(text)
					? 'number'
					: 'keyword';
		tokens.push({ kind, text });
		offset = index + text.length;
	}
	if (offset < value.length) {
		tokens.push({ kind: 'plain', text: value.slice(offset) });
	}
	return tokens.length > 0 ? tokens : [{ kind: 'plain', text: value }];
}

function SyntaxDiffText({ text, color, backgroundColor }: { text: string; color: string; backgroundColor?: string }) {
	return (
		<Text color={color} backgroundColor={backgroundColor} wrap="truncate-end">
			{diffSyntaxTokens(text).map((token, index) => {
				const tokenColor = token.kind === 'keyword'
					? '#c4b5fd'
					: token.kind === 'string'
						? '#fde68a'
						: token.kind === 'number'
							? '#93c5fd'
							: token.kind === 'comment'
								? '#a1a1aa'
								: color;
				return <Text key={`${index}-${token.kind}`} color={tokenColor} backgroundColor={backgroundColor}>{token.text}</Text>;
			})}
		</Text>
	);
}

export interface IMarkdownSegment {
	text: string;
	bold?: boolean;
	code?: boolean;
}

/**
 * Splits one already-wrapped line into styled runs for `**bold**` and `` `code` `` spans.
 *
 * Deliberately line-local: transcript text is wrapped into physical rows before it reaches the
 * renderer, so a span opened on one row and closed on the next cannot be paired here. Only
 * balanced spans are styled; anything unmatched is left verbatim rather than guessed at, so a
 * stray asterisk in prose or code never eats the rest of the line.
 */
export function markdownSegments(text: string): IMarkdownSegment[] {
	const segments: IMarkdownSegment[] = [];
	const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(text)) !== null) {
		if (match.index > lastIndex) {
			segments.push({ text: text.slice(lastIndex, match.index) });
		}
		if (match[1] !== undefined) {
			segments.push({ text: match[1], bold: true });
		} else {
			segments.push({ text: match[2], code: true });
		}
		lastIndex = match.index + match[0].length;
	}
	if (lastIndex < text.length) {
		segments.push({ text: text.slice(lastIndex) });
	}
	return segments.length > 0 ? segments : [{ text }];
}

/** Strips a leading ATX heading marker (`## Title`), reporting whether one was present. */
export function stripMarkdownHeading(text: string): { text: string; isHeading: boolean } {
	const match = /^(\s*)#{1,6}[ \t]+(.*)$/.exec(text);
	return match ? { text: `${match[1]}${match[2]}`, isHeading: true } : { text, isHeading: false };
}

function MarkdownText({ text, width, prefix }: { text: string; width: number; prefix?: React.ReactNode }) {
	const heading = stripMarkdownHeading(text);
	const segments = markdownSegments(heading.text);
	const prefixWidth = prefix ? 2 : 0;
	const padding = ' '.repeat(Math.max(0, width - prefixWidth - heading.text.length));
	return (
		<Text>
			{prefix}
			{segments.map((segment, index) => (
				<Text
					key={index}
					bold={heading.isHeading || segment.bold}
					color={segment.code ? COLORS.warning : heading.isHeading ? COLORS.accent : undefined}
				>
					{segment.text}
				</Text>
			))}
			{padding}
		</Text>
	);
}

function TranscriptViewportLine({ line, width }: { line: ITranscriptViewportLine; width: number }) {
	const text = line.text.padEnd(Math.max(1, width));
	switch (line.kind) {
		case 'blank':
			return <Text>{text}</Text>;
		case 'user':
			return <Text color={COLORS.accent} bold>{text}</Text>;
		case 'assistant':
			return line.text.startsWith('↳ ')
				? <MarkdownText text={line.text.slice(2)} width={width} prefix={<Text color={COLORS.success} bold>↳ </Text>} />
				: <MarkdownText text={line.text} width={width} />;
		case 'reasoning':
			return <Text color={COLORS.muted}>{text}</Text>;
		case 'tool':
			return <Text color={COLORS.success} bold={line.selected}>{text}</Text>;
		case 'toolError':
			return <Text color={COLORS.danger} bold={line.selected}>{text}</Text>;
		case 'error':
			return <Text color={COLORS.danger}>{text}</Text>;
		case 'diffAddition':
			return <SyntaxDiffText text={text} color="#bbf7d0" backgroundColor="#153f2a" />;
		case 'diffDeletion':
			return <SyntaxDiffText text={text} color="#fecaca" backgroundColor="#4a2028" />;
		case 'diffHunk':
			return <Text color={COLORS.warning}>{text}</Text>;
		case 'diffHeader':
			return <Text color={COLORS.muted} bold>{text}</Text>;
		case 'diffContext':
			return <Text color={COLORS.muted}>{text}</Text>;
		case 'system':
			return <Text color={COLORS.muted}>{text}</Text>;
		default:
			return <Text>{text}</Text>;
	}
}

export function visibleDiffLines(file: ICliDiffFile, rows: number, scrollOffset: number): ICliDiffLine[] {
	const safeRows = Math.max(1, rows);
	const maxOffset = Math.max(0, file.lines.length - safeRows);
	const offset = Math.max(0, Math.min(maxOffset, scrollOffset));
	return file.lines.slice(offset, offset + safeRows);
}

function DiffLine({ line }: { line: ICliDiffLine }) {
	const formatted = formatCliDiffLine(line);
	switch (line.kind) {
		case 'addition':
			return <SyntaxDiffText text={formatted || '+'} color="#bbf7d0" backgroundColor="#153f2a" />;
		case 'deletion':
			return <SyntaxDiffText text={formatted || '-'} color="#fecaca" backgroundColor="#4a2028" />;
		case 'hunk':
			return <Text color={COLORS.warning} wrap="truncate-end">{formatted}</Text>;
		case 'header':
			return <Text color={COLORS.muted} wrap="truncate-end">{formatted}</Text>;
		default:
			return <Text color={COLORS.muted} wrap="truncate-end">{formatted || ' '}</Text>;
	}
}

function DiffViewer(props: {
	review: ICliDiffReview;
	reviewIndex: number;
	reviewCount: number;
	fileIndex: number;
	scrollOffset: number;
	rows: number;
}): React.JSX.Element {
	const { review, reviewIndex, reviewCount, fileIndex, scrollOffset, rows } = props;
	const file = review.files[fileIndex];
	if (!file) {
		return <Text color={COLORS.muted}>No changes in this view.</Text>;
	}
	const lineRows = Math.max(1, rows - 2);
	const lines = visibleDiffLines(file, lineRows, scrollOffset);
	return (
		<Box flexDirection="column" height={rows} overflow="hidden">
			<Box justifyContent="space-between">
				<Text bold>Diff · {review.label}</Text>
				<Text>
					<Text color={COLORS.success}>+{review.additions}</Text>
					<Text color={COLORS.danger}> -{review.deletions}</Text>
				</Text>
			</Box>
			<Text color={COLORS.muted} wrap="truncate-middle">
				{reviewIndex + 1}/{reviewCount} · {fileIndex + 1}/{review.files.length} · {file.scope} · {file.path}
			</Text>
			{lines.map((line, index) => <DiffLine key={`${scrollOffset + index}-${line.kind}-${line.text}`} line={line} />)}
		</Box>
	);
}

function ApprovalBox({ approval, decide, topRow }: {
	approval: IPendingApproval;
	decide: (approved: boolean, session?: boolean) => void;
	topRow: number;
}) {
	useInput((input, key) => {
		const mouse = terminalMouseEvent(input);
		const optionRow = topRow + 4 + (approval.request.reason ? 1 : 0);
		if (mouse?.action === 'press' && mouse.button === 0 && mouse.y === optionRow) {
			if (mouse.x < 14) {
				decide(true);
			} else if (mouse.x < 48) {
				decide(true, true);
			} else {
				decide(false);
			}
		} else if (input === 'y' || key.return) {
			decide(true);
		} else if (input === 'a') {
			decide(true, true);
		} else if (input === 'n' || key.escape) {
			decide(false);
		}
	});
	return (
		<Box borderStyle="round" borderColor={COLORS.warning} flexDirection="column" paddingX={1} marginTop={1}>
			<Text color={COLORS.warning} bold>Command approval</Text>
			{approval.request.reason && <Text>{approval.request.reason}</Text>}
			<Text color={COLORS.muted}>{approval.request.cwd}</Text>
			<Text bold>{approval.request.command}</Text>
			<Text><Text color={COLORS.success}>[y]</Text> once  <Text color={COLORS.accent}>[a]</Text> allow commands this session  <Text color={COLORS.danger}>[n]</Text> deny</Text>
		</Box>
	);
}

function EditApprovalBox({ approval, decide, maxDiffRows, topRow }: {
	approval: IPendingEditApproval;
	decide: (approved: boolean, session?: boolean) => void;
	maxDiffRows: number;
	topRow: number;
}) {
	const [selected, setSelected] = useState(0);
	const [diffOffset, setDiffOffset] = useState(0);
	const previewFiles = approval.preview?.files ?? [];
	const allDiffRows = previewFiles.flatMap(file => [
		{ kind: 'header' as const, text: `Edit file · ${file.path}  +${file.additions} -${file.deletions}` },
		...file.lines.filter(line => line.kind !== 'header' && line.text !== '')
	]);
	const safeDiffRows = Math.max(1, maxDiffRows);
	const maxDiffOffset = Math.max(0, allDiffRows.length - safeDiffRows);
	const visibleDiffOffset = Math.min(diffOffset, maxDiffOffset);
	const diffRows = allDiffRows.slice(visibleDiffOffset, visibleDiffOffset + safeDiffRows);
	useInput((input, key) => {
		const mouse = terminalMouseEvent(input);
		const optionStartRow = topRow + 3 + diffRows.length;
		if (mouse?.action === 'wheel' && mouse.wheelDirection < 0) {
			setDiffOffset(value => Math.max(0, value - 3));
		} else if (mouse?.action === 'wheel' && mouse.wheelDirection > 0) {
			setDiffOffset(value => Math.min(maxDiffOffset, value + 3));
		} else if (mouse?.action === 'press' && mouse.button === 0 && mouse.y >= optionStartRow && mouse.y < optionStartRow + 3) {
			const choice = mouse.y - optionStartRow;
			setSelected(choice);
			decide(choice !== 2, choice === 1);
		} else if (input === 'k') {
			setDiffOffset(value => Math.max(0, value - 1));
		} else if (input === 'j') {
			setDiffOffset(value => Math.min(maxDiffOffset, value + 1));
		} else if (key.pageUp) {
			setDiffOffset(value => Math.max(0, value - safeDiffRows));
		} else if (key.pageDown) {
			setDiffOffset(value => Math.min(maxDiffOffset, value + safeDiffRows));
		} else if (key.upArrow) {
			setSelected(value => Math.max(0, value - 1));
		} else if (key.downArrow) {
			setSelected(value => Math.min(2, value + 1));
		} else if (input === 'y' || input === '1') {
			decide(true);
		} else if (input === 'a' || input === '2') {
			decide(true, true);
		} else if (input === 'n' || input === '3' || key.escape) {
			decide(false);
		} else if (key.return) {
			decide(selected !== 2, selected === 1);
		}
	});
	const target = (approval.request.input as any)?.file_path ?? (approval.request.input as any)?.path;
	return (
		<Box borderStyle="round" borderColor={COLORS.accent} flexDirection="column" paddingX={1}>
			<Box justifyContent="space-between">
				<Text color={COLORS.accent} bold>{target ? `Edit ${String(target).split(/[\\/]/).at(-1)}` : 'Apply workspace edit'}</Text>
				{allDiffRows.length > safeDiffRows && <Text color={COLORS.muted}>{visibleDiffOffset + 1}-{Math.min(allDiffRows.length, visibleDiffOffset + safeDiffRows)}/{allDiffRows.length}</Text>}
			</Box>
			{diffRows.length > 0
				? diffRows.map((line, index) => <DiffLine key={`${index}-${line.kind}-${line.text}`} line={line} />)
				: <Text color={COLORS.muted}>{compact(approval.request.input, 300)}</Text>}
			<Text bold>Apply this edit?</Text>
			<Text inverse={selected === 0}>{selected === 0 ? '› ' : '  '}1. Yes</Text>
			<Text inverse={selected === 1}>{selected === 1 ? '› ' : '  '}2. Yes, allow all edits this session</Text>
			<Text inverse={selected === 2}>{selected === 2 ? '› ' : '  '}3. No</Text>
			<Text color={COLORS.muted}>↑/↓ select · j/k diff · enter confirm · esc deny</Text>
		</Box>
	);
}

function SessionPicker({ sessions, onSelect, onDelete, onCancel }: {
	sessions: ICliSession[];
	onSelect: (session: ICliSession) => void;
	onDelete: (session: ICliSession) => boolean;
	onCancel: () => void;
}) {
	const [items, setItems] = useState(sessions);
	const [selected, setSelected] = useState(0);
	const [deleteArmedId, setDeleteArmedId] = useState<string | undefined>();
	useInput((input, key) => {
		if (key.upArrow) {
			setSelected(value => Math.max(0, value - 1));
			setDeleteArmedId(undefined);
		} else if (key.downArrow) {
			setSelected(value => Math.min(items.length - 1, value + 1));
			setDeleteArmedId(undefined);
		} else if (input === 'd' && key.ctrl) {
			const session = items[selected];
			if (!session) {
				return;
			}
			if (deleteArmedId !== session.id) {
				setDeleteArmedId(session.id);
				return;
			}
			if (onDelete(session)) {
				setItems(current => current.filter(item => item.id !== session.id));
				setSelected(value => Math.max(0, Math.min(value, items.length - 2)));
			}
			setDeleteArmedId(undefined);
		} else if (key.return && items[selected]) {
			onSelect(items[selected]);
		} else if (key.escape) {
			if (deleteArmedId) {
				setDeleteArmedId(undefined);
			} else {
				onCancel();
			}
		}
	});
	const start = Math.max(0, Math.min(selected - 5, items.length - 10));
	return (
		<Box borderStyle="round" borderColor={COLORS.accent} flexDirection="column" paddingX={1} marginTop={1}>
			<Text bold>Sessions</Text>
			{items.length === 0 && <Text color={COLORS.muted}>No saved sessions for this workspace.</Text>}
			{items.slice(start, start + 10).map((session, offset) => {
				const index = start + offset;
				return <Text key={session.id} inverse={selected === index} color={deleteArmedId === session.id ? COLORS.danger : undefined}>
					{selected === index ? '› ' : '  '}{session.title}  <Text color={COLORS.muted}>{new Date(session.updatedAt).toLocaleString()} · {session.model}</Text>
				</Text>;
			})}
			<Text color={deleteArmedId ? COLORS.danger : COLORS.muted}>
				{deleteArmedId ? 'Press Ctrl+D again to permanently delete · Esc cancel' : '↑/↓ select · Enter resume · Ctrl+D delete · Esc close'}
			</Text>
		</Box>
	);
}

function ReasoningPicker({ options, current, onSelect, onCancel }: {
	options: ICliReasoningOption[];
	current: string;
	onSelect: (level: string) => void;
	onCancel: () => void;
}) {
	const selectable = options.filter(option => option.enabled);
	const initial = Math.max(0, selectable.findIndex(option => option.level === current));
	const [selected, setSelected] = useState(initial);
	useInput((_input, key) => {
		if (key.upArrow) {
			setSelected(value => Math.max(0, value - 1));
		} else if (key.downArrow) {
			setSelected(value => Math.min(selectable.length - 1, value + 1));
		} else if (key.return && selectable[selected]) {
			onSelect(selectable[selected].level);
		} else if (key.escape) {
			onCancel();
		}
	});
	return (
		<Box borderStyle="round" borderColor={COLORS.accent} flexDirection="column" paddingX={1} marginTop={1}>
			<Text bold>Reasoning effort</Text>
			{selectable.map((option, index) => (
				<Text key={option.level} inverse={selected === index}>
					{selected === index ? '› ' : '  '}{option.level}{option.level === current ? '  ✓' : ''}
				</Text>
			))}
			{/* Levels the active model rejects are listed but not selectable, so the set is not
			    silently different from one model to the next. */}
			{options.filter(option => !option.enabled).map(option => (
				<Text key={option.level} color={COLORS.muted}>  {option.level} — unsupported</Text>
			))}
			<Text color={COLORS.muted}>↑/↓ select · enter apply · esc close</Text>
		</Box>
	);
}

function ModelPicker({ models, current, onSelect, onCancel }: {
	models: string[];
	current?: string;
	onSelect: (model: string) => void;
	onCancel: () => void;
}) {
	const initial = Math.max(0, models.indexOf(current ?? ''));
	const [selected, setSelected] = useState(initial);
	useInput((_input, key) => {
		if (key.upArrow) {
			setSelected(value => Math.max(0, value - 1));
		} else if (key.downArrow) {
			setSelected(value => Math.min(models.length - 1, value + 1));
		} else if (key.return && models[selected]) {
			onSelect(models[selected]);
		} else if (key.escape) {
			onCancel();
		}
	});
	const start = Math.max(0, Math.min(selected - 5, models.length - 10));
	return (
		<Box borderStyle="round" borderColor={COLORS.accent} flexDirection="column" paddingX={1} marginTop={1}>
			<Text bold>Models · {models.length}</Text>
			{models.slice(start, start + 10).map((model, offset) => {
				const index = start + offset;
				return <Text key={model} inverse={selected === index}>{selected === index ? '› ' : '  '}{model}{model === current ? '  ✓' : ''}</Text>;
			})}
			<Text color={COLORS.muted}>↑/↓ select · enter use model · esc close</Text>
		</Box>
	);
}

export function CleanSlateTui({ args, store, initialSession, initialTask, onConfigurationChange, getCredential, onCredentialChange, onCredentialRemove, onDoctor, onRequestSetup }: ITuiProps) {
	const { exit } = useApp();
	const { stdout } = useStdout();
	const terminalSize = useTerminalSize(stdout);
	const [session, setSession] = useState(initialSession);
	const sessionRef = useRef(initialSession);
	const [transcript, setTranscript] = useState<ICliTranscriptEntry[]>(initialSession.transcript);
	const [liveText, setLiveText] = useState('');
	// What the provider has delivered so far. `liveText` is the paced subset actually shown:
	// providers flush in bursts, so rendering every delta as it lands makes a whole paragraph
	// appear at once instead of typing out.
	const liveTargetRef = useRef('');
	const revealRef = useRef(new CleanSlateStreamReveal());
	const revealTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
	const liveTurnRef = useRef(new LiveTurnBuffer());
	const [input, setInput] = useState('');
	const [commandSelection, setCommandSelection] = useState(0);
	// Snapshot of the line before a palette pick inserted `<id> `, so Escape can undo the
	// insertion and reopen the dropup exactly where it was.
	const [paletteUndo, setPaletteUndo] = useState<{ value: string; selection: number } | undefined>();
	const [running, setRunning] = useState(false);
	const [status, setStatus] = useState('ready');
	// Animation phase for the IDE-style shimmer sweeping across the working label.
	const [shimmerFrame, setShimmerFrame] = useState(0);
	// Advances only while a turn is running, mirroring the IDE where the CSS shimmer exists
	// only on the working placeholder; idle frames would be wasted renders.
	useEffect(() => {
		if (!running) {
			return;
		}
		const timer = setInterval(() => setShimmerFrame(frame => frame + 1), SHIMMER_TICK_MS);
		return () => clearInterval(timer);
	}, [running]);
	const [approval, setApproval] = useState<IPendingApproval | undefined>();
	const [editApproval, setEditApproval] = useState<IPendingEditApproval | undefined>();
	const [modelTermination, setModelTermination] = useState<IModelTerminationNotice | undefined>();
	const [planApproval, setPlanApproval] = useState<IPlanApprovalNotice | undefined>();
	const [allowCommandsForSession, setAllowCommandsForSession] = useState(false);
	const allowCommandsRef = useRef(false);
	const [showSessions, setShowSessions] = useState(false);
	const [models, setModels] = useState<string[] | undefined>();
	const [reasoningOptions, setReasoningOptions] = useState<ICliReasoningOption[] | undefined>();
	const initialInteractiveMode: CliInteractiveMode = executionInteractiveMode(args.permissionMode);
	const [mode, setMode] = useState<CliInteractiveMode>(initialInteractiveMode);
	const modeRef = useRef<CliInteractiveMode>(initialInteractiveMode);
	const [permissionMode, setPermissionMode] = useState<CliPermissionMode>(args.permissionMode);
	const [expandedTools, setExpandedTools] = useState<Set<string>>(() => new Set());
	const [selectedToolItemId, setSelectedToolItemId] = useState<string | undefined>();
	const [diffReviews, setDiffReviews] = useState<ICliDiffReview[] | undefined>();
	const [diffReviewIndex, setDiffReviewIndex] = useState(0);
	const [diffFileIndex, setDiffFileIndex] = useState(0);
	const [diffScrollOffset, setDiffScrollOffset] = useState(0);
	const abortRef = useRef<AbortController | undefined>(undefined);
	const runtimeRef = useRef<CleanSlateNodeAgentRuntime | undefined>(undefined);
	const turnStartedAtRef = useRef<number | undefined>(undefined);
	// Index into `transcript` where the turn currently being streamed began. Entries at or after
	// this index still mutate in place (tool status running -> completed), so they must stay out
	// of the permanently-flushed <Static> region until the turn settles.
	const turnStartIndexRef = useRef(0);
	// Bumped when the transcript is replaced wholesale (/clear, session switch) without
	// remounting, so <Static> restarts from an empty history instead of diffing against lines it
	// has already flushed.
	const [transcriptEpoch, setTranscriptEpoch] = useState(0);
	const initialTaskStarted = useRef(false);
	const projectContext = useMemo(() => new CliProjectContext(args.cwd), [args.cwd]);
	const workspaceReview = useMemo(() => new CliWorkspaceReview(args.cwd), [args.cwd]);
	const commandQuery = input.match(/^\/(\S*)$/)?.[1]?.toLowerCase();
	const commandPaletteFilter = useMemo(
		() => filterCommandPaletteItems(input, mode),
		[input, mode]
	);
	const commandItems = commandQuery === undefined
		? []
		: (commandPaletteFilter.awaitingArguments
			? commandPaletteFilter.items
			: COMMAND_PALETTE_ITEMS.filter(item =>
				(mode !== 'planning' || item.id !== '/plan')
				&& (item.id.slice(1).includes(commandQuery) || item.label.toLowerCase().includes(commandQuery))));
	const visibleCommandSelection = Math.min(commandSelection, Math.max(0, commandItems.length - 1));
	const toolItemIds = useMemo(() => transcriptToolItemIds(transcript), [transcript]);
	const activeToolItemId = selectedToolItemId && toolItemIds.includes(selectedToolItemId)
		? selectedToolItemId
		: toolItemIds.at(-1);
	const selectInteractiveMode = (nextMode: CliInteractiveMode) => {
		modeRef.current = nextMode;
		setMode(nextMode);
	};
	const toggleToolItem = (itemId = activeToolItemId) => {
		if (!itemId) {
			return;
		}
		setSelectedToolItemId(itemId);
		const update = (current: Set<string>) => {
			const next = new Set(current);
			next.has(itemId) ? next.delete(itemId) : next.add(itemId);
			return next;
		};
		setExpandedTools(update);
	};
	const persist = (nextTranscript?: ICliTranscriptEntry[]) => {
		const current = sessionRef.current;
		current.transcript = nextTranscript ?? current.transcript;
		current.runtimeSnapshot = runtimeRef.current?.getSessionSnapshot();
		store.save(current);
	};

	const replaceTranscript = (updater: (entries: ICliTranscriptEntry[]) => ICliTranscriptEntry[]) => {
		setTranscript(previous => {
			const next = updater(previous);
			sessionRef.current.transcript = next;
			persist(next);
			return next;
		});
	};

	const append = (entry: ICliTranscriptEntry) => replaceTranscript(entries => [...entries, entry]);

	const stopRevealTicker = () => {
		if (revealTimerRef.current !== undefined) {
			clearInterval(revealTimerRef.current);
			revealTimerRef.current = undefined;
		}
	};

	/**
	 * Records newly delivered text and starts (or keeps) the paced reveal ticker. The ticker
	 * advances by rate x elapsed time, so a late frame catches up instead of falling behind, and
	 * stops itself once the revealed text has caught up with everything delivered.
	 */
	const updateLiveText = (value: string) => {
		const previous = liveTargetRef.current;
		liveTargetRef.current = value;
		// An edit or reset (rather than an append) invalidates the paced position.
		if (!revealRef.current.isContinuationOf(value, previous)) {
			revealRef.current.reset();
		}
		if (value.length === 0) {
			stopRevealTicker();
			setLiveText('');
			return;
		}
		if (revealTimerRef.current === undefined) {
			revealTimerRef.current = setInterval(() => {
				const target = liveTargetRef.current;
				setLiveText(revealRef.current.advance(target));
				if (revealRef.current.hasCaughtUp(target)) {
					stopRevealTicker();
				}
			}, REVEAL_TICK_MS);
		}
	};

	useEffect(() => stopRevealTicker, []);

	const flushWorkingTurn = () => {
		const working = liveTurnRef.current.flushWorking();
		if (working) {
			append(transcriptEntry('assistant', working));
		}
		updateLiveText('');
		return Boolean(working);
	};

	const finishResponse = () => {
		const { answer } = liveTurnRef.current.finish();
		if (answer) {
			const durationMs = turnStartedAtRef.current === undefined ? undefined : Date.now() - turnStartedAtRef.current;
			append(transcriptEntry('assistant', answer, { durationMs }));
		}
		updateLiveText('');
	};

	const createRuntime = (targetSession: ICliSession, activePermissionMode: CliPermissionMode = permissionMode) => {
		runtimeRef.current?.dispose();
		const permissionPolicy = new CliPermissionPolicy(activePermissionMode);
		const runtime = new CleanSlateNodeAgentRuntime({
			rootPath: args.cwd,
			workspaceStorageHome: getCleanSlateWorkspaceStorageHome(),
			browserHeadless: false,
			sessionId: targetSession.id,
			configuration: createNodeProviderConfiguration({
				provider: args.provider,
				model: args.model!,
				apiKey: args.apiKey,
				baseUrl: args.baseUrl,
				reasoningLevel: args.reasoningLevel,
				maxTurns: args.maxTurns,
				bedrockRegion: args.bedrockRegion,
				bedrockCredentialMode: args.bedrockProfile ? 'profile' : 'default',
				bedrockProfile: args.bedrockProfile,
				azureEndpoint: args.azureEndpoint,
				azureApiVersion: args.azureApiVersion,
				azureDeploymentName: args.model,
				embeddingProvider: args.embeddingProvider,
				embeddingModel: args.embeddingModel,
				embeddingApiKey: args.embeddingApiKey,
				embeddingBaseUrl: args.embeddingBaseUrl,
				azureEmbeddingEndpoint: args.azureEmbeddingEndpoint,
				azureEmbeddingApiVersion: args.azureEmbeddingApiVersion,
				azureEmbeddingDeploymentName: args.azureEmbeddingDeploymentName
			}),
			onManagedTokenRefresh: token => onCredentialChange?.('cleanslate', token),
			additionalContext: task => projectContext.build(task),
			resolveAttachments: task => projectContext.imageAttachments(task).map(attachment => ({
				type: 'image_url',
				image_url: { url: attachment.dataUrl }
			})),
			approveTool: request => {
				if (!permissionPolicy.allowsTool(request)) {
					return false;
				}
				const isEdit = request.category === 'edit' || request.category === 'creation';
				if (!isEdit) {
					return true;
				}
				if (runtimeRef.current?.getSessionSnapshot().task?.awaitingApproval) {
					return false;
				}
				if (modeRef.current === 'auto') {
					return true;
				}
				if (modeRef.current === 'planning') {
					return false;
				}
				let preview: ICliEditPreview | undefined;
				try {
					preview = createEditPreview(args.cwd, request);
				} catch {
					// Approval remains available with the structured tool input when a
					// local preview cannot be computed safely.
				}
				return new Promise<boolean>(resolve => setEditApproval({
					request,
					preview,
					resolve
				}));
			},
			approveCommand: request => {
				if (permissionPolicy.allowsCommandWithoutPrompt() || allowCommandsRef.current) {
					return Promise.resolve(true);
				}
				return new Promise<boolean>(resolve => setApproval({ request, resolve }));
			},
			onProgress: event => {
				if (event.type === 'command_output' && typeof event.chunk === 'string') {
					replaceTranscript(entries => {
						const index = entries.findLastIndex(entry => entry.kind === 'tool' && entry.status === 'running');
						if (index < 0) {
							return entries;
						}
						return entries.map((entry, entryIndex) => entryIndex === index
							? { ...entry, content: compact(`${entry.content}\n${event.chunk}`, 500) }
							: entry);
					});
				}
			}
		});
		runtime.restoreSessionSnapshot(targetSession.runtimeSnapshot);
		runtimeRef.current = runtime;
		return runtime;
	};

	useEffect(() => {
		createRuntime(initialSession);
		if (initialTask && !initialTaskStarted.current) {
			initialTaskStarted.current = true;
			void submit(initialTask);
		}
		return () => runtimeRef.current?.dispose();
	}, []);

	const decideApproval = (approved: boolean, forSession = false) => {
		if (forSession && approved) {
			allowCommandsRef.current = true;
			setAllowCommandsForSession(true);
		}
		const pending = approval;
		setApproval(undefined);
		pending?.resolve(approved);
	};

	const decideEditApproval = (approved: boolean, forSession = false) => {
		if (forSession && approved) {
			selectInteractiveMode('auto');
		}
		const pending = editApproval;
		setEditApproval(undefined);
		pending?.resolve(approved);
	};

	const runStream = async (stream: AsyncIterable<any>, streamMode: 'execution' | 'planning') => {
		let responseFinished = false;
		let modelTerminated = false;
		try {
			for await (const part of stream) {
				switch (part.type) {
					case 'assistant_turn_start':
						setStatus('thinking');
						break;
					case 'reasoning':
						liveTurnRef.current.appendReasoning(part.content);
						break;
					case 'chat_text':
						if (part.kind === 'model_terminated_pause') {
							flushWorkingTurn();
							setModelTermination({ message: part.content, mode: streamMode });
							setStatus('paused');
							modelTerminated = true;
						} else {
							const phase = part.kind === 'commentary' || part.kind === 'final_answer'
								? part.kind
								: 'assistant';
							updateLiveText(liveTurnRef.current.appendText(part.content, phase).text);
						}
						break;
					case 'reasoning_reset':
						liveTurnRef.current.resetReasoning();
						break;
					case 'chat_text_reset':
						updateLiveText(liveTurnRef.current.resetText().text);
						break;
					case 'tool_start':
						flushWorkingTurn();
						append(transcriptEntry('tool', compact(part.input), {
							id: part.toolCallId || undefined,
							toolName: part.toolName,
							status: 'running',
							detail: part.input
						}));
						setStatus(`running ${part.toolName}`);
						break;
					case 'tool_result':
						replaceTranscript(entries => {
							const index = entries.findIndex(entry => entry.kind === 'tool' && entry.id === part.toolCallId);
							const started = index >= 0 ? entries[index] : undefined;
							const updated = transcriptEntry('tool', toolSummary(part), {
								id: part.toolCallId || undefined,
								toolName: part.toolName,
								status: part.result?.success === false ? 'failed' : 'completed',
								durationMs: started ? Date.now() - started.timestamp : undefined,
								detail: {
									input: started?.detail,
									result: sanitizeToolResultForRenderer(part.toolName, part.result)
								}
							});
							return index >= 0
								? entries.map((entry, entryIndex) => entryIndex === index ? updated : entry)
								: [...entries, updated];
						});
						break;
					case 'context_compaction_start':
						setStatus('compacting context');
						break;
					case 'transport_status':
						setStatus(part.status?.state ?? 'provider');
						break;
					case 'task_complete':
						finishResponse();
						responseFinished = true;
						setStatus('complete');
						break;
				}
			}
			if (!responseFinished && !modelTerminated) {
				finishResponse();
			}
			if (modelTerminated) {
				return;
			}
			const pendingQuestion = runtimeRef.current?.getPendingQuestion();
			if (pendingQuestion) {
				const question = (pendingQuestion.question as any)?.planning_question?.question
					?? (pendingQuestion.question as any)?.question
					?? 'The agent needs your input.';
				setPlanApproval(undefined);
				append(transcriptEntry('system', `Question: ${String(question)}`));
				setStatus('waiting for answer');
			} else if (runtimeRef.current?.getSessionSnapshot().task?.awaitingApproval) {
				setPlanApproval({ message: 'Approve to continue execution, or type what should change to revise the plan.' });
				setStatus('awaiting approval');
			} else {
				setPlanApproval(undefined);
				setStatus('ready');
			}
		} catch (error) {
			flushWorkingTurn();
			append(transcriptEntry('error', error instanceof Error ? error.message : String(error)));
			setStatus('error');
		} finally {
			setRunning(false);
			persist();
		}
	};

	const executeTask = async (task: string, requestedMode: 'execution' | 'planning' = runtimeModeForInteractiveMode(mode)) => {
		const runtime = runtimeRef.current;
		if (!runtime) {
			return;
		}
		turnStartIndexRef.current = transcript.length;
		append(transcriptEntry('user', task));
		turnStartedAtRef.current = Date.now();
		setModelTermination(undefined);
		if (sessionRef.current.title === 'New session') {
			sessionRef.current.title = compact(task, 72);
			setSession({ ...sessionRef.current });
		}
		setRunning(true);
		setStatus('thinking');
		const abort = new AbortController();
		abortRef.current = abort;
		const pendingQuestion = runtime.getPendingQuestion();
		await runStream(pendingQuestion
			? runtime.resumePendingQuestion(task, abort.signal)
			: requestedMode === 'planning' ? runtime.plan(task, abort.signal) : runtime.run(task, abort.signal), requestedMode);
	};

	const continueAfterModelTermination = async () => {
		const paused = modelTermination;
		const runtime = runtimeRef.current;
		if (!paused || !runtime || running) {
			return;
		}
		turnStartIndexRef.current = transcript.length;
		setModelTermination(undefined);
		setRunning(true);
		turnStartedAtRef.current = Date.now();
		setStatus('thinking');
		const abort = new AbortController();
		abortRef.current = abort;
		await runStream(
			paused.mode === 'planning' ? runtime.plan('continue', abort.signal) : runtime.run('continue', abort.signal),
			paused.mode
		);
	};

	const isAwaitingPlanApproval = () => Boolean(runtimeRef.current?.getSessionSnapshot().task?.awaitingApproval);
	const syncPlanApprovalFromRuntime = () => {
		if (runtimeRef.current?.getSessionSnapshot().task?.awaitingApproval) {
			setPlanApproval({ message: 'Approve to continue execution, or type what should change to revise the plan.' });
			setStatus('awaiting approval');
			return true;
		}
		setPlanApproval(undefined);
		return false;
	};

	const approvePlan = async () => {
		const runtime = runtimeRef.current;
		if (!runtime || running || !isAwaitingPlanApproval()) {
			return;
		}
		selectInteractiveMode(executionInteractiveMode(permissionMode));
		turnStartIndexRef.current = transcript.length;
		setPlanApproval(undefined);
		setRunning(true);
		turnStartedAtRef.current = Date.now();
		setStatus('thinking');
		const abort = new AbortController();
		abortRef.current = abort;
		await runStream(runtime.approvePlan(abort.signal), 'execution');
	};

	const switchSession = (next: ICliSession) => {
		persist();
		sessionRef.current = next;
		setSession(next);
		setTranscript(next.transcript);
		setTranscriptEpoch(value => value + 1);
		setExpandedTools(new Set());
		setSelectedToolItemId(undefined);
		setShowSessions(false);
		setAllowCommandsForSession(false);
		allowCommandsRef.current = false;
		createRuntime(next);
		setStatus('resumed');
	};

	const newSession = () => {
		const next = store.create(args.provider, args.model!);
		store.save(next);
		switchSession(next);
	};

	const deleteSessionFromPicker = (target: ICliSession): boolean => {
		if (target.id === sessionRef.current.id) {
			const replacement = store.create(args.provider, args.model!);
			store.save(replacement);
			switchSession(replacement);
		}
		return store.delete(target.id);
	};

	/** Reasoning levels the active provider/model actually accepts, from the shared capability table. */
	const currentReasoningOptions = (): ICliReasoningOption[] =>
		resolveCleanSlateReasoningLevelOptions({ provider: args.provider, model: args.model ?? '', flavor: args.provider === 'custom' ? 'custom' : undefined }) as ICliReasoningOption[];

	const applyReasoningLevel = (level: string) => {
		setReasoningOptions(undefined);
		args.reasoningLevel = level as ICliArguments['reasoningLevel'];
		createRuntime(sessionRef.current);
		onConfigurationChange?.(args);
		append(transcriptEntry('system', `Reasoning level set to ${level}.`));
	};

	const switchModel = (model: string) => {
		persist();
		args.model = model;
		sessionRef.current.model = model;
		setSession({ ...sessionRef.current });
		setModels(undefined);
		createRuntime(sessionRef.current);
		onConfigurationChange?.(args);
		append(transcriptEntry('system', `Switched to ${args.provider}/${model}.`));
	};

	const loadModels = async () => {
		setStatus('loading models');
		try {
			const available = await runtimeRef.current?.getModels() ?? [];
			setModels(available.length > 0 ? available : [args.model!]);
			setStatus('ready');
		} catch (error) {
			append(transcriptEntry('error', `Could not load models: ${error instanceof Error ? error.message : String(error)}`));
			setStatus('error');
		}
	};

	const submit = async (raw: string) => {
		const value = raw.trim();
		setInput('');
		// The line is gone, so a stale undo snapshot must not resurrect it on Escape.
		setPaletteUndo(undefined);
		// A cleared palette query must not keep the old highlight: the next '/' would otherwise
		// land on a stale index instead of reopening the list from the top.
		setCommandSelection(0);
		if (running || approval || editApproval) {
			return;
		}
		if (planApproval || isAwaitingPlanApproval()) {
			if (!value) {
				syncPlanApprovalFromRuntime();
				append(transcriptEntry('system', 'Plan ready. Press Enter to approve, or type what should change to revise it.'));
				return;
			}
			setPlanApproval(undefined);
			await executeTask(value, 'planning');
			return;
		}
		if (!value) {
			return;
		}
		if (value === '/exit' || value === '/quit') {
			persist();
			exit();
			return;
		}
		if (value === '/setup') {
			persist();
			onRequestSetup?.();
			exit();
			return;
		}
		if (value === '/help') {
			append(transcriptEntry('system', '/setup · /new · /sessions · /resume <id> · /models · /model <id> · /provider <name> <model> · /reasoning <level> · /plan · /auto · /manual · shift+tab mode · /permissions read-only|default|full · /context · /changes · /diff · /details · /doctor · /logout · /clear · /exit'));
			return;
		}
		if (value === '/details') {
			toggleToolItem();
			return;
		}
		if (value === '/new') {
			newSession();
			return;
		}
		if (value === '/sessions') {
			setShowSessions(true);
			return;
		}
		if (value.startsWith('/resume ')) {
			const resumed = store.load(value.slice('/resume '.length).trim());
			resumed ? switchSession(resumed) : append(transcriptEntry('error', 'Session not found.'));
			return;
		}
		if (value === '/models' || value === '/model') {
			await loadModels();
			return;
		}
		if (value.startsWith('/model ')) {
			switchModel(value.slice('/model '.length).trim());
			return;
		}
		if (value.startsWith('/provider ')) {
			const [providerName, ...modelParts] = value.slice('/provider '.length).trim().split(/\s+/);
			const provider = providerName?.toLowerCase() === 'azure' || providerName?.toLowerCase() === 'azureopenai'
				? 'azureOpenAI'
				: providerName?.toLowerCase();
			const model = modelParts.join(' ').trim();
			if (!SUPPORTED_PROVIDERS.includes(provider as any) || !model) {
				append(transcriptEntry('error', `Use /provider <name> <model>. Providers: ${SUPPORTED_PROVIDERS.join(', ')}`));
				return;
			}
			const apiKey = getCredential?.(provider as any) ?? apiKeyFromEnvironment(provider as any, process.env);
			if (provider !== 'bedrock' && provider !== 'custom' && !apiKey) {
				append(transcriptEntry('error', `No saved credential for ${provider}. Run cleanslate --setup to connect it.`));
				return;
			}
			persist();
			args.provider = provider as any;
			args.model = model;
			args.apiKey = apiKey;
			sessionRef.current.provider = provider;
			sessionRef.current.model = model;
			setSession({ ...sessionRef.current });
			createRuntime(sessionRef.current);
			onConfigurationChange?.(args);
			append(transcriptEntry('system', `Switched to ${provider}/${model}.`));
			return;
		}
		if (value.startsWith('/reasoning ')) {
			const reasoning = value.slice('/reasoning '.length).trim();
			const supported = currentReasoningOptions();
			const match = supported.find(option => option.level === reasoning);
			if (!match) {
				append(transcriptEntry('error', `Unknown reasoning level "${reasoning}". Run /reasoning to pick one.`));
				return;
			}
			if (!match.enabled) {
				append(transcriptEntry('error', match.disabledReason ?? `${args.model} does not support ${reasoning} reasoning.`));
				return;
			}
			applyReasoningLevel(reasoning);
			return;
		}
		if (value === '/reasoning') {
			// No argument: show what this model actually supports rather than failing silently.
			setReasoningOptions(currentReasoningOptions());
			return;
		}
		if (value.startsWith('/mode ')) {
			const requested = value.slice('/mode '.length).trim();
			if (requested === 'plan' || requested === 'planning') {
				selectInteractiveMode('planning');
				append(transcriptEntry('system', 'Planning mode enabled. Write tools are filtered until the plan is complete.'));
			} else if (requested === 'execution' || requested === 'execute') {
				selectInteractiveMode('manual');
				append(transcriptEntry('system', 'Manual edit approval enabled.'));
			} else {
				append(transcriptEntry('error', 'Use /mode plan or /mode execution.'));
			}
			return;
		}
		if (value === '/permissions') {
			append(transcriptEntry('system', `Permission mode: ${permissionMode}. Use /permissions read-only|default|full.`));
			return;
		}
		if (value.startsWith('/permissions ')) {
			const requested = value.slice('/permissions '.length).trim() as CliPermissionMode;
			if (!['read-only', 'default', 'full'].includes(requested)) {
				append(transcriptEntry('error', 'Use /permissions read-only|default|full.'));
				return;
			}
			setPermissionMode(requested);
			selectInteractiveMode(executionInteractiveMode(requested));
			setAllowCommandsForSession(false);
			allowCommandsRef.current = false;
			args.permissionMode = requested;
			args.permissionSpecified = true;
			createRuntime(sessionRef.current, requested);
			onConfigurationChange?.(args);
			append(transcriptEntry('system', `Permission mode set to ${requested}.`));
			return;
		}
		if (value === '/plan') {
			selectInteractiveMode('planning');
			append(transcriptEntry('system', 'Planning mode enabled. Write tools are filtered until the plan is complete.'));
			return;
		}
		if (value.startsWith('/plan ')) {
			selectInteractiveMode('planning');
			await executeTask(value.slice('/plan '.length).trim(), 'planning');
			return;
		}
		if (value === '/auto' || value === '/accept-edits') {
			selectInteractiveMode('auto');
			append(transcriptEntry('system', 'Auto mode enabled. File edits and commands may run without asking when permissions allow it.'));
			return;
		}
		if (value === '/manual') {
			selectInteractiveMode('manual');
			append(transcriptEntry('system', 'Manual edit approval enabled.'));
			return;
		}
		if (value === '/status') {
			append(transcriptEntry('system', `Provider: ${args.provider} · Model: ${args.model} · Reasoning: ${args.reasoningLevel}`));
			return;
		}
		if (value === '/context') {
			const inventory = projectContext.inventory();
			append(transcriptEntry('system', [
				`Project instructions: ${inventory.instructionFiles.join(', ') || 'none'}`,
				'Attach workspace files by mentioning them as @path/to/file in your prompt.',
				`Context usage: ${Math.round(contextUsage)}%`
			].join('\n')));
			return;
		}
		if (value === '/changes') {
			append(transcriptEntry('system', workspaceReview.summary()));
			return;
		}
		if (value === '/diff') {
			const reviews = [
				workspaceReview.review(),
				...cliTurnDiffReviews(transcript)
			].filter(review => review.files.length > 0);
			if (reviews.length === 0) {
				append(transcriptEntry('system', 'No file changes to review.'));
				return;
			}
			setDiffReviews(reviews);
			setDiffReviewIndex(0);
			setDiffFileIndex(0);
			setDiffScrollOffset(0);
			return;
		}
		if (value === '/doctor') {
			append(transcriptEntry('system', onDoctor?.() ?? 'Doctor is unavailable.'));
			return;
		}
		if (value === '/logout') {
			const removed = onCredentialRemove?.(args.provider) ?? false;
			args.apiKey = undefined;
			append(transcriptEntry('system', removed
				? `Removed the saved ${args.provider} credential. Run /setup to reconnect.`
				: `No saved ${args.provider} credential was found.`));
			return;
		}
		if (value === '/clear') {
			runtimeRef.current?.clearConversation();
			sessionRef.current.runtimeSnapshot = undefined;
			replaceTranscript(() => []);
			setTranscriptEpoch(value => value + 1);
			return;
		}
		await executeTask(value);
	};

	useInput((inputValue, key) => {
		const mouse = terminalMouseEvent(inputValue);
		const wheelDirection = terminalMouseWheelDirection(inputValue);
		if (planApproval || isAwaitingPlanApproval()) {
			syncPlanApprovalFromRuntime();
			if (key.return) {
				void approvePlan();
			} else if (key.escape) {
				setPlanApproval(undefined);
				setStatus('ready');
			} else if (inputValue === 'c' && key.ctrl) {
				persist();
				exit();
			}
			return;
		}
		if (modelTermination) {
			if (key.return) {
				void continueAfterModelTermination();
			} else if (key.escape) {
				setModelTermination(undefined);
				setStatus('ready');
			} else if (inputValue === 'c' && key.ctrl) {
				persist();
				exit();
			}
			return;
		}
		if (diffReviews) {
			const activeReview = diffReviews[diffReviewIndex];
			if (wheelDirection < 0) {
				setDiffScrollOffset(value => Math.max(0, value - 3));
			} else if (wheelDirection > 0) {
				setDiffScrollOffset(value => value + 3);
			} else if (key.escape || inputValue === 'q') {
				setDiffReviews(undefined);
				setDiffReviewIndex(0);
				setDiffFileIndex(0);
				setDiffScrollOffset(0);
			} else if (key.leftArrow) {
				setDiffReviewIndex(value => Math.max(0, value - 1));
				setDiffFileIndex(0);
				setDiffScrollOffset(0);
			} else if (key.rightArrow) {
				setDiffReviewIndex(value => Math.min(diffReviews.length - 1, value + 1));
				setDiffFileIndex(0);
				setDiffScrollOffset(0);
			} else if (key.upArrow) {
				setDiffFileIndex(value => Math.max(0, value - 1));
				setDiffScrollOffset(0);
			} else if (key.downArrow) {
				setDiffFileIndex(value => Math.min((activeReview?.files.length ?? 1) - 1, value + 1));
				setDiffScrollOffset(0);
			} else if (inputValue === 'k') {
				setDiffScrollOffset(value => Math.max(0, value - 1));
			} else if (inputValue === 'j') {
				setDiffScrollOffset(value => value + 1);
			} else if (key.pageUp) {
				setDiffScrollOffset(value => Math.max(0, value - Math.max(5, Math.floor(terminalSize.rows / 2))));
			} else if (key.pageDown) {
				setDiffScrollOffset(value => value + Math.max(5, Math.floor(terminalSize.rows / 2)));
			}
			return;
		}
		if (approval || editApproval || showSessions || models) {
			return;
		}
		const paletteSize = commandItems.length;
		// No wheel/arrow/page scrolling for the transcript: settled turns live in the terminal's
		// own scrollback now, so the terminal scrolls them.
		if (isTerminalMouseEvent(inputValue)) {
			if (mouse?.action === 'press' && mouse.button === 0) {
				const line = liveLines[mouse.y - TRANSCRIPT_FIRST_ROW];
				const itemId = line?.toolItemId;
				if (itemId) {
					toggleToolItem(itemId);
				}
			}
			return;
		} else if (inputValue === 'o' && key.ctrl) {
			toggleToolItem();
		} else if (key.tab && key.shift && !running) {
			const nextMode = nextInteractiveMode(mode);
			selectInteractiveMode(nextMode);
			setInput('');
			setCommandSelection(0);
		} else if (paletteSize > 0 && key.upArrow) {
			setCommandSelection(value => (value - 1 + paletteSize) % paletteSize);
		} else if (paletteSize > 0 && key.downArrow) {
			setCommandSelection(value => (value + 1) % paletteSize);
		} else if (!running && key.escape) {
			if (paletteUndo) {
				// Undo the last palette pick: restore the original query and reopen the
				// dropup with the same row highlighted.
				setInput(paletteUndo.value);
				setCommandSelection(paletteUndo.selection);
				setPaletteUndo(undefined);
			} else {
				setInput('');
				setCommandSelection(0);
			}
		} else if (key.escape && running) {
			abortRef.current?.abort();
			setStatus('cancelling');
		} else if (inputValue === 'c' && key.ctrl) {
			if (running) {
				abortRef.current?.abort();
				setStatus('cancelling');
			} else {
				persist();
				exit();
			}
		}
	});

	const viewportRows = terminalSize.rows;
	const viewportColumns = terminalSize.columns;
	const contentWidth = Math.max(8, viewportColumns - 2);
	const editPreviewRows = Math.max(3, Math.min(14, viewportRows - 16));
	const overlayRows = approval
		? 7
		: editApproval
			? editPreviewRows + 8
			: planApproval
				? 4
				: showSessions
					? Math.min(10, store.list().length) + 3
					: models
						? Math.min(10, models.length) + 3
						: !diffReviews && commandItems.length > 0
							? Math.min(10, commandItems.length) + 3
							: 0;
	const footerRows = Math.max(1, Math.ceil(FOOTER_HELP.length / viewportColumns));
	// The streaming activity row above the composer is fixed chrome, so the live transcript
	// area gives up a row for it instead of pushing the prompt frame off-screen.
	const activityVisible = running && !approval && !editApproval && !showSessions && !modelTermination && !diffReviews;
	const contentRows = Math.max(1, viewportRows - 9 - footerRows - overlayRows - (modelTermination ? 1 : 0) - (activityVisible ? 1 : 0));
	// Settled turns: safe to flush once into the terminal's real scrollback and never repaint.
	// While a turn runs, entries at/after turnStartIndexRef are still mutating and stay out.
	const staticEntries = useMemo<ICliTranscriptEntry[]>(
		() => running ? transcript.slice(0, Math.min(turnStartIndexRef.current, transcript.length)) : transcript,
		[transcript, running]
	);
	// The turn being streamed right now, plus its live answer preview — fully dynamic.
	const liveEntries = useMemo<ICliTranscriptEntry[]>(() => {
		if (!running) {
			return [];
		}
		const tail = transcript.slice(Math.min(turnStartIndexRef.current, transcript.length));
		return liveText ? [...tail, { id: 'live-answer', kind: 'assistant', content: liveText, timestamp: 0 }] : tail;
	}, [transcript, running, liveText]);
	const staticLines = useMemo(
		() => transcriptViewportLines(staticEntries, contentWidth, expandedTools, undefined, expandedTools),
		[staticEntries, contentWidth, expandedTools]
	);
	const liveLines = useMemo(
		() => transcriptViewportLines(liveEntries, contentWidth, expandedTools, activeToolItemId, expandedTools),
		[liveEntries, contentWidth, expandedTools, activeToolItemId]
	);
	const staticItems = useMemo<ICliStaticItem[]>(
		() => [
			{ type: 'banner', key: 'cleanslate-banner' },
			...staticLines.map(line => ({ type: 'line' as const, key: line.key, line }))
		],
		[staticLines]
	);
	const activeDiffReview = diffReviews?.[Math.min(diffReviewIndex, diffReviews.length - 1)];
	const contextDefaults = getCleanSlateContextDefaults({
		provider: args.provider,
		model: args.model,
		planMode: mode === 'planning',
		reasoningLevel: args.reasoningLevel
	});
	const contextMessages = runtimeRef.current?.getSessionSnapshot().threadHistory
		?? session.runtimeSnapshot?.threadHistory
		?? [];
	const contextUsage = estimateCliContextWindowUsage(
		liveText ? [...contextMessages, { role: 'assistant', content: liveText }] : contextMessages,
		input,
		contextDefaults.contextWindowTokens
	).percentage;
	const contextStatus = [
		`context ${Math.round(contextUsage)}%`,
		allowCommandsForSession ? 'commands allowed' : ''
	].filter(Boolean).join(' · ');
	const headerModeLabel = formatHeaderModeLabel(mode);

	return (
		<Box flexDirection="column">
			{/*
				Banner first, then settled conversation. Everything here is flushed exactly once,
				so it lands in the terminal's real scrollback: the banner scrolls up and away with
				the history above it and stays readable when scrolled back to. A flushed row is
				never repainted, so live values (mode, context) sit beside the prompt instead.
			*/}
			<Static items={staticItems} key={`${session.id}:${transcriptEpoch}`}>
				{item => item.type === 'banner'
					? (
						// Explicit width: a <Static> item renders standalone, outside the root
						// Box, so it has no parent to stretch against and would otherwise shrink
						// to fit its text instead of spanning the terminal.
						<Box key={item.key} width={viewportColumns} borderStyle="round" borderColor={COLORS.accent} paddingX={1} flexDirection="column">
							<Box>
								<Box alignItems="center">
									<CleanSlateTerminalLogo />
									<Text color={COLORS.accent} bold>CLEANSLATE</Text>
								</Box>
							</Box>
							<Box>
								<Text color={COLORS.muted} wrap="truncate-middle">{session.title} · {session.id.slice(0, 8)} · {displayPath(args.cwd)}</Text>
							</Box>
						</Box>
					)
					: <TranscriptViewportLine key={item.key} line={item.line} width={contentWidth} />}
			</Static>

			<Box flexDirection="column" paddingX={1}>
				{activeDiffReview && diffReviews
					? <DiffViewer
						review={activeDiffReview}
						reviewIndex={diffReviewIndex}
						reviewCount={diffReviews.length}
						fileIndex={Math.min(diffFileIndex, activeDiffReview.files.length - 1)}
						scrollOffset={diffScrollOffset}
						rows={contentRows}
					/>
					: <>
						{staticEntries.length === 0 && liveEntries.length === 0 && (
							<>
								<Text bold>What are we building?</Text>
								<Text color={COLORS.muted}>Describe a task.</Text>
								<Text color={COLORS.muted}>Type /help for commands.</Text>
							</>
						)}
						{liveLines.map(line => <TranscriptViewportLine key={line.key} line={line} width={contentWidth} />)}
					</>}
			</Box>

			{approval && <ApprovalBox approval={approval} decide={decideApproval} topRow={TRANSCRIPT_FIRST_ROW + contentRows + 1} />}
			{editApproval && <EditApprovalBox approval={editApproval} decide={decideEditApproval} maxDiffRows={editPreviewRows} topRow={TRANSCRIPT_FIRST_ROW + contentRows} />}
			{planApproval && <PlanApprovalNotice message={planApproval.message} />}
			{showSessions && <SessionPicker sessions={store.list()} onSelect={switchSession} onDelete={deleteSessionFromPicker} onCancel={() => setShowSessions(false)} />}
			{models && <ModelPicker models={models} current={args.model} onSelect={switchModel} onCancel={() => setModels(undefined)} />}
			{reasoningOptions && <ReasoningPicker options={reasoningOptions} current={args.reasoningLevel} onSelect={applyReasoningLevel} onCancel={() => setReasoningOptions(undefined)} />}
			{!approval && !editApproval && !planApproval && !showSessions && !models && !modelTermination && !diffReviews && commandItems.length > 0 && (
				<CommandPalette items={commandItems} selected={visibleCommandSelection} />
			)}

			{!approval && !editApproval && !planApproval && !showSessions && !models && modelTermination && (
				<ModelTerminationNotice message={modelTermination.message} />
			)}

			{/* Active model remains visible above the prompt; it is intentionally omitted only from the banner. */}
			{!approval && !editApproval && !planApproval && !showSessions && !models && !modelTermination && !diffReviews && (
				<Box paddingX={1} justifyContent="flex-end">
					<Text color={COLORS.muted} wrap="truncate-middle">{args.provider}/{args.model}</Text>
				</Box>
			)}

			{/* The activity indicator gets its own row above the composer instead of replacing the
			    input inside it, so the prompt keeps its shape while a turn streams. */}
			{activityVisible && (
				<Box paddingX={1}>
					<Text color={COLORS.warning}><ShimmerLabel label={formatActivityStatus(status)} frame={shimmerFrame} /></Text>
					<Text color={COLORS.muted}> · Esc to cancel</Text>
				</Box>
			)}

			{!approval && !editApproval && !showSessions && !models && !modelTermination && (
				<Box borderStyle="round" borderColor={running ? COLORS.muted : COLORS.accent} paddingX={1} justifyContent="space-between">
					<Box flexGrow={1} flexShrink={1}>
					{diffReviews
						? <Text color={COLORS.muted}>←/→ view · ↑/↓ file · j/k scroll · PgUp/PgDn page · Esc close</Text>
						: commandItems.length > 0 && commandPaletteFilter.awaitingArguments
						? <Text color={COLORS.muted}>{commandItems[0].label}: type a value · Enter run · Esc cancel</Text>
						: <>
							<Text color={running ? COLORS.muted : COLORS.accent}>❯ </Text>
							<PromptInput
								value={input}
								focus={!diffReviews && !running}
								onChange={value => {
									setInput(value);
									if (!value) {
										// Backspacing the pick away reopens the dropup where it was.
										setPaletteUndo(undefined);
									}
									setCommandSelection(0);
								}}
								onSubmit={value => {
									const selected = commandItems[visibleCommandSelection];
									if (selected) {
										const selection = commandPaletteSelection(selected);
										setCommandSelection(0);
										if (selection.execute) {
											void submit(selection.value);
										} else {
											setPaletteUndo({ value, selection: visibleCommandSelection });
											setInput(selection.value);
										}
										return;
									}
									void submit(value);
								}}
								placeholder="Ask CleanSlate…"
							/>
						</>}
					</Box>
					{/*
						Context usage rides inside the prompt frame, right-aligned. flexShrink={0}
						is required: the input wrapper beside it uses flexGrow, which would
						otherwise claim the whole row and collapse this to zero width.
					*/}
					{contextStatus && (
						<Box flexShrink={0}>
							<Text color={COLORS.muted}>  {contextStatus}</Text>
						</Box>
					)}
				</Box>
			)}
			{/*
				One <Text> with nested spans, deliberately NOT a flex <Box>: as Box children each
				span becomes its own flex item and wraps independently, which on a narrow terminal
				splits words and clips the mode label. Nested inside a single Text they share one
				wrapping pass and break only at spaces.
			*/}
			<Text color={COLORS.muted}>
				{headerModeLabel ? <Text color={COLORS.warning} bold>{` ${headerModeLabel} · `}</Text> : ' '}
				{FOOTER_HELP}
			</Text>
		</Box>
	);
}
