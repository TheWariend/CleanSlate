/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import {
	CleanSlateNodeAgentRuntime,
	createNodeProviderConfiguration
} from '@slate/sdk';
import { apiKeyFromEnvironment, ICliArguments, SUPPORTED_PROVIDERS } from './argv.js';
import { CleanSlateTerminalLogo } from './brand.js';
import { LiveTurnBuffer } from './liveTurn.js';
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
import { isTerminalMouseEvent, terminalMouseWheelDirection } from './terminalScreen.js';
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

const COLORS = {
	accent: '#d4d4d8',
	muted: '#71717a',
	success: '#22c55e',
	danger: '#ef4444',
	warning: '#f59e0b'
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

export interface ICommandPaletteItem {
	id: string;
	label: string;
	description: string;
	requiresArguments?: boolean;
}

const COMMAND_PALETTE_ITEMS: readonly ICommandPaletteItem[] = [
	{ id: '/plan', label: 'Plan mode', description: 'Turn planning mode on' },
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
	{ id: '/reasoning', label: 'Reasoning', description: 'Set reasoning effort', requiresArguments: true },
	{ id: '/permissions', label: 'Permissions', description: 'Switch read-only, default, or full mode', requiresArguments: true },
	{ id: '/new', label: 'New session', description: 'Start a clean session' },
	{ id: '/sessions', label: 'Sessions', description: 'Browse saved sessions' },
	{ id: '/resume', label: 'Resume', description: 'Resume a session by ID', requiresArguments: true },
	{ id: '/delete-session', label: 'Delete session', description: 'Delete a saved session by ID', requiresArguments: true },
	{ id: '/status', label: 'Status', description: 'Show provider and execution status' },
	{ id: '/context', label: 'Context', description: 'Show loaded project instructions and attached files' },
	{ id: '/changes', label: 'Changes', description: 'Show the current Git working tree' },
	{ id: '/diff', label: 'Diff', description: 'Review current and per-turn changes' },
	{ id: '/details', label: 'Tool details', description: 'Expand or collapse tool calls and results' },
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

const FOOTER_HELP = ' enter send · shift+tab mode · ctrl+o details · esc cancel · ctrl-c exit · ↑/↓/pgup/pgdn scroll · / commands';

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
			|| (key.ctrl && (input === 'c' || input === 'o'))
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
}

const TOOL_ACTIVITY_LABELS: Record<string, string> = {
	list_dir: 'Listed',
	find_by_name: 'Searched',
	search_files: 'Searched',
	search_workspace: 'Searched',
	grep_search: 'Searched',
	read_file: 'Read',
	read_file_range: 'Read',
	read_symbols: 'Inspected symbols',
	get_definitions: 'Found definitions',
	find_references: 'Found references',
	read_lints: 'Checked lints',
	apply_edit: 'Edited',
	write_file: 'Wrote',
	execute_command: 'Ran commands'
};

function compactToolActivity(entries: readonly ICliTranscriptEntry[]): string {
	const counts = new Map<string, number>();
	const order: string[] = [];
	const editEntries: ICliTranscriptEntry[] = [];
	let failures = 0;
	let running = 0;
	for (const entry of entries) {
		if (['apply_edit', 'multi_file_replace', 'write_file'].includes(entry.toolName ?? '')
			&& entry.status === 'completed') {
			if (editEntries.length === 0) {
				order.push('@@edit');
			}
			editEntries.push(entry);
			continue;
		}
		const label = TOOL_ACTIVITY_LABELS[entry.toolName ?? '']
			?? (entry.toolName ?? 'Tool').replace(/_/g, ' ');
		if (!counts.has(label)) {
			order.push(label);
		}
		counts.set(label, (counts.get(label) ?? 0) + 1);
		failures += entry.status === 'failed' ? 1 : 0;
		running += entry.status === 'running' ? 1 : 0;
	}
	let editActivity = '';
	if (editEntries.length > 0) {
		const results = editEntries.map(entry => {
			const detail = entry.detail && typeof entry.detail === 'object'
				? entry.detail as { input?: any; result?: any }
				: undefined;
			return detail?.result ?? detail;
		});
		const paths = [...new Set(results.map(result => result?.path).filter(Boolean))];
		const stats = results.map(result => typeof result?.diff === 'string'
			? parseCliDiffFile(String(result.path ?? 'changed file'), 'turn', result.diff)
			: { additions: Number(result?.added) || 0, deletions: Number(result?.deleted) || 0 });
		const added = stats.reduce((total, result) => total + result.additions, 0);
		const deleted = stats.reduce((total, result) => total + result.deletions, 0);
		const target = paths.length === 1
			? String(paths[0]).split(/[\\/]/).at(-1)
			: `${paths.length || editEntries.length} files`;
		editActivity = `Edited ${target} +${added} -${deleted}`;
	}
	const activities = order.map(label => {
		if (label === '@@edit') {
			return editActivity;
		}
		const count = counts.get(label) ?? 0;
		return count > 1 ? `${label} ×${count}` : label;
	}).filter(Boolean);
	const activity = activities.join(' · ');
	const suffix = [
		failures > 0 ? `${failures} failed` : '',
		running > 0 ? `${running} running` : ''
	].filter(Boolean).join(' · ');
	return `${activity}${suffix ? ` · ${suffix}` : ''}`;
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

export function transcriptViewportLines(
	entries: readonly ICliTranscriptEntry[],
	width: number,
	expandedToolGroupId?: string
): ITranscriptViewportLine[] {
	const safeWidth = Math.max(8, width);
	const lines: ITranscriptViewportLine[] = [];
	const pushWrapped = (entry: ICliTranscriptEntry, kind: TranscriptViewportLineKind, value: string) => {
		for (const [index, text] of wrapViewportText(value, safeWidth).entries()) {
			lines.push({ key: `${entry.id}-${kind}-${index}`, kind, text });
		}
	};
	const pushTurn = (entry: ICliTranscriptEntry, kind: 'user' | 'assistant', marker: string) => {
		const continuationIndent = ' '.repeat(marker.length + 1);
		for (const [index, text] of wrapViewportText(entry.content, Math.max(1, safeWidth - continuationIndent.length)).entries()) {
			lines.push({
				key: `${entry.id}-${kind}-${index}`,
				kind,
				text: `${index === 0 ? `${marker} ` : continuationIndent}${text}`
			});
		}
	};
	const pushExpandedTool = (entry: ICliTranscriptEntry) => {
		const marker = entry.status === 'running' ? '●' : entry.status === 'failed' ? '×' : '✓';
		const input = entry.detail && typeof entry.detail === 'object' && 'input' in entry.detail
			? (entry.detail as { input?: unknown }).input
			: undefined;
		const toolInput = input as any;
		const target = toolInput?.file_path ?? toolInput?.path
			?? (entry.toolName === 'execute_command' ? toolInput?.command : undefined);
		const label = ({
			execute_command: 'Bash',
			read_file: 'Read',
			read_file_range: 'Read',
			apply_edit: 'Update',
			write_file: 'Write',
			multi_file_replace: 'Update files',
			search_workspace: 'Search',
			grep_search: 'Search',
			find_by_name: 'Find',
			list_dir: 'List'
		} as Record<string, string>)[entry.toolName ?? ''] ?? (entry.toolName ?? 'Tool').replace(/_/g, ' ');
		const heading = target ? `  ${marker} ${label}(${compact(target, 140)})` : `  ${marker} ${label}`;
		pushWrapped(entry, entry.status === 'failed' ? 'toolError' : 'tool', heading);
		const result = entry.detail && typeof entry.detail === 'object' && 'result' in entry.detail
			? (entry.detail as { result?: any }).result
			: undefined;
		const resultDetail = typeof result?.output === 'string' && result.output.trim()
			? result.output
			: entry.content && entry.content !== 'completed' ? entry.content : '';
		if (resultDetail) {
			pushWrapped(entry, entry.status === 'failed' ? 'toolError' : 'tool', `    └ ${compact(resultDetail, 800)}`);
		}
		lines.push(...inlineEditDiffLines(entry, safeWidth));
	};
	for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
		const entry = entries[entryIndex];
		if (entry.kind === 'tool') {
			const toolEntries = [entry];
			while (entries[entryIndex + 1]?.kind === 'tool') {
				toolEntries.push(entries[++entryIndex]);
			}
			const expanded = expandedToolGroupId === entry.id;
			const summaryEntry = { ...entry, id: `${entry.id}-group` };
			pushWrapped(
				summaryEntry,
				toolEntries.every(item => item.status === 'failed') ? 'toolError' : 'tool',
				`${expanded ? '▾' : '▸'} ${compactToolActivity(toolEntries)}`
			);
			if (expanded) {
				for (const toolEntry of toolEntries) {
					pushExpandedTool(toolEntry);
				}
			} else {
				for (const toolEntry of toolEntries) {
					lines.push(...inlineEditDiffLines(toolEntry, safeWidth));
				}
			}
			continue;
		}
		if (entry.kind === 'user') {
			lines.push({ key: `${entry.id}-space`, kind: 'blank', text: '' });
			pushTurn(entry, 'user', '❯');
		} else if (entry.kind === 'assistant') {
			lines.push({ key: `${entry.id}-space`, kind: 'blank', text: '' });
			pushTurn(entry, 'assistant', '↳');
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
	expandedToolGroupId?: string
): ITranscriptViewportLine[] {
	const lines = transcriptViewportLines(entries, width, expandedToolGroupId);
	const safeRows = Math.max(1, rows);
	const maxOffset = Math.max(0, lines.length - safeRows);
	const offset = Math.max(0, Math.min(maxOffset, scrollOffset));
	const end = lines.length - offset;
	return lines.slice(Math.max(0, end - safeRows), end);
}

export function latestToolGroupId(entries: readonly ICliTranscriptEntry[]): string | undefined {
	let latest: string | undefined;
	let previousWasTool = false;
	for (const entry of entries) {
		if (entry.kind === 'tool' && !previousWasTool) {
			latest = entry.id;
		}
		previousWasTool = entry.kind === 'tool';
	}
	return latest;
}

export function toggleLatestToolGroup(
	current: string | undefined,
	entries: readonly ICliTranscriptEntry[]
): string | undefined {
	return current !== undefined ? undefined : latestToolGroupId(entries);
}

export function formatActivityStatus(status: string): string {
	if (/running (?:apply_edit|multi_file_replace|write_file)/.test(status)) {
		return 'Editing…';
	}
	if (/running (?:search_workspace|grep_search|find_by_name|search_files)/.test(status)) {
		return 'Searching…';
	}
	if (/running (?:read_file|read_file_range|list_dir)/.test(status)) {
		return 'Reading…';
	}
	if (/running (?:read_lints|execute_command)/.test(status)) {
		return 'Checking…';
	}
	switch (status) {
		case 'thinking':
			return 'Thinking…';
		case 'cancelling':
			return 'Cancelling…';
		case 'compacting context':
			return 'Organizing context…';
		case 'waiting for answer':
			return 'Waiting for answer…';
		default:
			return 'Working…';
	}
}

export function formatHeaderModeLabel(mode: 'execution' | 'planning'): string {
	return mode === 'planning' ? 'PLAN' : '';
}

export function nextInteractiveMode(mode: 'execution' | 'planning'): 'execution' | 'planning' {
	return mode === 'planning' ? 'execution' : 'planning';
}

function TranscriptViewportLine({ line }: { line: ITranscriptViewportLine }) {
	switch (line.kind) {
		case 'blank':
			return <Text> </Text>;
		case 'user':
			return <Text color={COLORS.accent} bold>{line.text}</Text>;
		case 'assistant':
			return line.text.startsWith('↳ ')
				? <Text><Text color={COLORS.success} bold>↳ </Text>{line.text.slice(2)}</Text>
				: <Text>{line.text || ' '}</Text>;
		case 'reasoning':
			return <Text color={COLORS.muted}>{line.text}</Text>;
		case 'tool':
			return <Text color={COLORS.success}>{line.text}</Text>;
		case 'toolError':
		case 'error':
			return <Text color={COLORS.danger}>{line.text}</Text>;
		case 'diffAddition':
			return <Text color="#bbf7d0" backgroundColor="#153f2a">{line.text}</Text>;
		case 'diffDeletion':
			return <Text color="#fecaca" backgroundColor="#4a2028">{line.text}</Text>;
		case 'diffHunk':
			return <Text color={COLORS.warning}>{line.text}</Text>;
		case 'diffHeader':
			return <Text color={COLORS.muted} bold>{line.text}</Text>;
		case 'diffContext':
			return <Text color={COLORS.muted}>{line.text}</Text>;
		case 'system':
			return <Text color={COLORS.muted}>{line.text}</Text>;
		default:
			return <Text>{line.text || ' '}</Text>;
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
			return <Text color="#bbf7d0" backgroundColor="#153f2a" wrap="truncate-end">{formatted || '+'}</Text>;
		case 'deletion':
			return <Text color="#fecaca" backgroundColor="#4a2028" wrap="truncate-end">{formatted || '-'}</Text>;
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

function ApprovalBox({ approval, decide }: { approval: IPendingApproval; decide: (approved: boolean, session?: boolean) => void }) {
	useInput((input, key) => {
		if (input === 'y' || key.return) {
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

function EditApprovalBox({ approval, decide, maxDiffRows }: {
	approval: IPendingEditApproval;
	decide: (approved: boolean, session?: boolean) => void;
	maxDiffRows: number;
}) {
	const [selected, setSelected] = useState(0);
	useInput((input, key) => {
		if (key.upArrow) {
			setSelected(value => Math.max(0, value - 1));
		} else if (key.downArrow) {
			setSelected(value => Math.min(2, value + 1));
		} else if (input === 'y') {
			decide(true);
		} else if (input === 'a') {
			decide(true, true);
		} else if (input === 'n' || key.escape) {
			decide(false);
		} else if (key.return) {
			decide(selected !== 2, selected === 1);
		}
	});
	const previewFiles = approval.preview?.files ?? [];
	const diffRows = previewFiles.flatMap(file => [
		{ kind: 'header' as const, text: `Edit file · ${file.path}  +${file.additions} -${file.deletions}` },
		...file.lines.filter(line => line.kind !== 'header' && line.text !== '')
	]).slice(0, Math.max(1, maxDiffRows));
	const target = (approval.request.input as any)?.file_path ?? (approval.request.input as any)?.path;
	return (
		<Box borderStyle="round" borderColor={COLORS.accent} flexDirection="column" paddingX={1}>
			<Text color={COLORS.accent} bold>{target ? `Edit ${String(target).split(/[\\/]/).at(-1)}` : 'Apply workspace edit'}</Text>
			{diffRows.length > 0
				? diffRows.map((line, index) => <DiffLine key={`${index}-${line.kind}-${line.text}`} line={line} />)
				: <Text color={COLORS.muted}>{compact(approval.request.input, 300)}</Text>}
			<Text bold>Apply this edit?</Text>
			<Text inverse={selected === 0}>{selected === 0 ? '› ' : '  '}1. Yes</Text>
			<Text inverse={selected === 1}>{selected === 1 ? '› ' : '  '}2. Yes, allow all edits this session</Text>
			<Text inverse={selected === 2}>{selected === 2 ? '› ' : '  '}3. No</Text>
			<Text color={COLORS.muted}>↑/↓ select · enter confirm · esc deny</Text>
		</Box>
	);
}

function SessionPicker({ sessions, onSelect, onCancel }: {
	sessions: ICliSession[];
	onSelect: (session: ICliSession) => void;
	onCancel: () => void;
}) {
	const [selected, setSelected] = useState(0);
	useInput((_input, key) => {
		if (key.upArrow) {
			setSelected(value => Math.max(0, value - 1));
		} else if (key.downArrow) {
			setSelected(value => Math.min(sessions.length - 1, value + 1));
		} else if (key.return && sessions[selected]) {
			onSelect(sessions[selected]);
		} else if (key.escape) {
			onCancel();
		}
	});
	return (
		<Box borderStyle="round" borderColor={COLORS.accent} flexDirection="column" paddingX={1} marginTop={1}>
			<Text bold>Sessions</Text>
			{sessions.length === 0 && <Text color={COLORS.muted}>No saved sessions for this workspace.</Text>}
			{sessions.slice(0, 10).map((session, index) => (
				<Text key={session.id} inverse={selected === index}>
					{selected === index ? '› ' : '  '}{session.title}  <Text color={COLORS.muted}>{new Date(session.updatedAt).toLocaleString()} · {session.model}</Text>
				</Text>
			))}
			<Text color={COLORS.muted}>↑/↓ select · enter resume · esc close</Text>
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
	const [session, setSession] = useState(initialSession);
	const sessionRef = useRef(initialSession);
	const [transcript, setTranscript] = useState<ICliTranscriptEntry[]>(initialSession.transcript);
	const [liveText, setLiveText] = useState('');
	const liveTurnRef = useRef(new LiveTurnBuffer());
	const [input, setInput] = useState('');
	const [commandSelection, setCommandSelection] = useState(0);
	const [running, setRunning] = useState(false);
	const [status, setStatus] = useState('ready');
	const [contextUsage, setContextUsage] = useState<number | undefined>();
	const [approval, setApproval] = useState<IPendingApproval | undefined>();
	const [editApproval, setEditApproval] = useState<IPendingEditApproval | undefined>();
	const [modelTermination, setModelTermination] = useState<IModelTerminationNotice | undefined>();
	const [allowCommandsForSession, setAllowCommandsForSession] = useState(false);
	const allowCommandsRef = useRef(false);
	const [allowEditsForSession, setAllowEditsForSession] = useState(false);
	const allowEditsRef = useRef(false);
	const [showSessions, setShowSessions] = useState(false);
	const [models, setModels] = useState<string[] | undefined>();
	const [mode, setMode] = useState<'execution' | 'planning'>('execution');
	const [permissionMode, setPermissionMode] = useState<CliPermissionMode>(args.permissionMode);
	const [expandedToolGroupId, setExpandedToolGroupId] = useState<string | undefined>();
	const [diffReviews, setDiffReviews] = useState<ICliDiffReview[] | undefined>();
	const [diffReviewIndex, setDiffReviewIndex] = useState(0);
	const [diffFileIndex, setDiffFileIndex] = useState(0);
	const [diffScrollOffset, setDiffScrollOffset] = useState(0);
	const [scrollOffset, setScrollOffset] = useState(0);
	const abortRef = useRef<AbortController | undefined>(undefined);
	const runtimeRef = useRef<CleanSlateNodeAgentRuntime | undefined>(undefined);
	const initialTaskStarted = useRef(false);
	const projectContext = useMemo(() => new CliProjectContext(args.cwd), [args.cwd]);
	const workspaceReview = useMemo(() => new CliWorkspaceReview(args.cwd), [args.cwd]);
	const commandQuery = input.match(/^\/(\S*)$/)?.[1]?.toLowerCase();
	const commandItems = commandQuery === undefined
		? []
		: COMMAND_PALETTE_ITEMS.filter(item =>
			(mode !== 'planning' || item.id !== '/plan')
			&& (item.id.slice(1).includes(commandQuery) || item.label.toLowerCase().includes(commandQuery)));
	const visibleCommandSelection = Math.min(commandSelection, Math.max(0, commandItems.length - 1));

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

	const updateLiveText = (value: string) => {
		setLiveText(value);
	};

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
			append(transcriptEntry('assistant', answer));
		}
		updateLiveText('');
	};

	const createRuntime = (targetSession: ICliSession, activePermissionMode: CliPermissionMode = permissionMode) => {
		runtimeRef.current?.dispose();
		const permissionPolicy = new CliPermissionPolicy(activePermissionMode);
		const runtime = new CleanSlateNodeAgentRuntime({
			rootPath: args.cwd,
			workspaceStorageHome: getCleanSlateWorkspaceStorageHome(),
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
				azureDeploymentName: args.model
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
				if (!permissionPolicy.requiresToolApproval(request) || allowEditsRef.current) {
					return true;
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
			allowEditsRef.current = true;
			setAllowEditsForSession(true);
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
					case 'context_usage':
						setContextUsage(part.percentage);
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
							updateLiveText(liveTurnRef.current.appendText(part.content).text);
						}
						break;
					case 'reasoning_reset':
						liveTurnRef.current.resetReasoning();
						break;
					case 'chat_text_reset':
						updateLiveText(liveTurnRef.current.resetText().text);
						break;
					case 'tool_start':
						const previousWasTool = sessionRef.current.transcript.at(-1)?.kind === 'tool';
						const flushedWorkingTurn = flushWorkingTurn();
						if (!previousWasTool || flushedWorkingTurn) {
							setExpandedToolGroupId(undefined);
						}
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
								detail: {
									input: started?.detail,
									result: part.result
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
				append(transcriptEntry('system', `Question: ${String(question)}`));
				setStatus('waiting for answer');
			} else {
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

	const executeTask = async (task: string, requestedMode: 'execution' | 'planning' = mode) => {
		const runtime = runtimeRef.current;
		if (!runtime) {
			return;
		}
		setExpandedToolGroupId(undefined);
		append(transcriptEntry('user', task));
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
		setModelTermination(undefined);
		setRunning(true);
		setStatus('thinking');
		const abort = new AbortController();
		abortRef.current = abort;
		await runStream(
			paused.mode === 'planning' ? runtime.plan('continue', abort.signal) : runtime.run('continue', abort.signal),
			paused.mode
		);
	};

	const switchSession = (next: ICliSession) => {
		persist();
		sessionRef.current = next;
		setSession(next);
		setTranscript(next.transcript);
		setExpandedToolGroupId(undefined);
		setShowSessions(false);
		setAllowCommandsForSession(false);
		allowCommandsRef.current = false;
		setAllowEditsForSession(false);
		allowEditsRef.current = false;
		createRuntime(next);
		setStatus('resumed');
	};

	const newSession = () => {
		const next = store.create(args.provider, args.model!);
		store.save(next);
		switchSession(next);
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
		if (!value || running || approval || editApproval) {
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
			append(transcriptEntry('system', '/setup · /new · /sessions · /resume <id> · /delete-session <id> · /models · /model <id> · /provider <name> <model> · /reasoning <level> · /plan · shift+tab mode · /permissions read-only|default|full · /context · /changes · /diff · /details · /doctor · /logout · /clear · /exit'));
			return;
		}
		if (value === '/details') {
			setExpandedToolGroupId(current => toggleLatestToolGroup(current, transcript));
			setScrollOffset(0);
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
		if (value.startsWith('/delete-session ')) {
			const id = value.slice('/delete-session '.length).trim();
			if (!id) {
				append(transcriptEntry('error', 'Use /delete-session <id>.'));
				return;
			}
			if (id === sessionRef.current.id) {
				append(transcriptEntry('error', 'The active session cannot be deleted. Start or resume another session first.'));
				return;
			}
			if (!store.load(id)) {
				append(transcriptEntry('error', `Session not found: ${id}.`));
				return;
			}
			const deleted = store.delete(id);
			append(transcriptEntry(deleted ? 'system' : 'error', deleted
				? `Deleted session ${id}.`
				: `Could not delete session ${id}.`));
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
			if (!['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(reasoning)) {
				append(transcriptEntry('error', 'Reasoning must be none, minimal, low, medium, high, xhigh, or max.'));
				return;
			}
			args.reasoningLevel = reasoning as ICliArguments['reasoningLevel'];
			createRuntime(sessionRef.current);
			onConfigurationChange?.(args);
			append(transcriptEntry('system', `Reasoning level set to ${reasoning}.`));
			return;
		}
		if (value.startsWith('/mode ')) {
			const requested = value.slice('/mode '.length).trim();
			if (requested === 'plan' || requested === 'planning') {
				setMode('planning');
				append(transcriptEntry('system', 'Planning mode enabled. Write tools are filtered until the plan is complete.'));
			} else if (requested === 'execution' || requested === 'execute') {
				setMode('execution');
				append(transcriptEntry('system', 'Execution mode enabled.'));
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
			setAllowEditsForSession(false);
			allowEditsRef.current = false;
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
			setMode('planning');
			append(transcriptEntry('system', 'Planning mode enabled. Write tools are filtered until the plan is complete.'));
			return;
		}
		if (value.startsWith('/plan ')) {
			setMode('planning');
			await executeTask(value.slice('/plan '.length).trim(), 'planning');
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
				`Context usage: ${contextUsage === undefined ? 'waiting for provider usage data' : `${Math.round(contextUsage)}%`}`
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
			setExpandedToolGroupId(undefined);
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
			setContextUsage(undefined);
			return;
		}
		await executeTask(value);
	};

	useInput((inputValue, key) => {
		const wheelDirection = terminalMouseWheelDirection(inputValue);
		if (modelTermination) {
			if (key.return) {
				void continueAfterModelTermination();
			} else if (key.escape) {
				setModelTermination(undefined);
				setStatus('ready');
			} else if (wheelDirection < 0) {
				setScrollOffset(value => value + 3);
			} else if (wheelDirection > 0) {
				setScrollOffset(value => Math.max(0, value - 3));
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
				setDiffScrollOffset(value => Math.max(0, value - Math.max(5, Math.floor((stdout.rows ?? 30) / 2))));
			} else if (key.pageDown) {
				setDiffScrollOffset(value => value + Math.max(5, Math.floor((stdout.rows ?? 30) / 2)));
			}
			return;
		}
		if (approval || editApproval || showSessions || models) {
			return;
		}
		const paletteSize = commandItems.length;
		if (wheelDirection < 0) {
			setScrollOffset(value => value + 3);
		} else if (wheelDirection > 0) {
			setScrollOffset(value => Math.max(0, value - 3));
		} else if (isTerminalMouseEvent(inputValue)) {
			return;
		} else if (inputValue === 'o' && key.ctrl) {
			setExpandedToolGroupId(current => toggleLatestToolGroup(current, transcript));
			setScrollOffset(0);
		} else if (key.tab && key.shift && !running) {
			const nextMode = nextInteractiveMode(mode);
			setMode(nextMode);
			setInput('');
			setCommandSelection(0);
		} else if (paletteSize > 0 && key.upArrow) {
			setCommandSelection(value => (value - 1 + paletteSize) % paletteSize);
		} else if (paletteSize > 0 && key.downArrow) {
			setCommandSelection(value => (value + 1) % paletteSize);
		} else if (paletteSize > 0 && key.escape) {
			setInput('');
			setCommandSelection(0);
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
		} else if (key.upArrow) {
			setScrollOffset(value => value + 3);
		} else if (key.downArrow) {
			setScrollOffset(value => Math.max(0, value - 3));
		} else if (key.pageUp) {
			setScrollOffset(value => value + Math.max(5, Math.floor((stdout.rows ?? 30) / 2)));
		} else if (key.pageDown) {
			setScrollOffset(value => Math.max(0, value - Math.max(5, Math.floor((stdout.rows ?? 30) / 2))));
		}
	});

	const viewportRows = Math.max(1, stdout.rows ?? 30);
	const viewportColumns = Math.max(20, stdout.columns ?? 80);
	const contentWidth = Math.max(8, viewportColumns - 2);
	const editPreviewRows = Math.max(3, Math.min(14, viewportRows - 16));
	const overlayRows = approval
		? 7
		: editApproval
			? editPreviewRows + 7
			: showSessions
				? Math.min(10, store.list().length) + 3
				: models
					? Math.min(10, models.length) + 3
					: !diffReviews && commandItems.length > 0
						? Math.min(10, commandItems.length) + 3
						: 0;
	const footerRows = Math.max(1, Math.ceil(FOOTER_HELP.length / viewportColumns));
	const contentRows = Math.max(1, viewportRows - 9 - footerRows - overlayRows - (modelTermination ? 1 : 0));
	const viewportEntries = useMemo<ICliTranscriptEntry[]>(() => {
		const entries = [...transcript];
		if (running && liveText) {
			entries.push({ id: 'live-answer', kind: 'assistant', content: liveText, timestamp: 0 });
		}
		return entries;
	}, [transcript, running, liveText]);
	const visibleLines = useMemo(
		() => visibleTranscriptLines(viewportEntries, contentWidth, contentRows, scrollOffset, expandedToolGroupId),
		[viewportEntries, contentWidth, contentRows, scrollOffset, expandedToolGroupId]
	);
	const activeDiffReview = diffReviews?.[Math.min(diffReviewIndex, diffReviews.length - 1)];
	const contextStatus = [
		contextUsage !== undefined ? `context ${Math.round(contextUsage)}%` : '',
		allowCommandsForSession ? 'commands allowed' : '',
		allowEditsForSession ? 'edits allowed' : ''
	].filter(Boolean).join(' · ');
	const headerModeLabel = formatHeaderModeLabel(mode);

	return (
		<Box flexDirection="column" height={viewportRows} overflow="hidden">
			<Box borderStyle="round" borderColor={COLORS.accent} paddingX={1} flexDirection="column">
				<Box justifyContent="space-between">
					<Box alignItems="center">
						<CleanSlateTerminalLogo />
						<Text color={COLORS.accent} bold>CLEANSLATE</Text>
					</Box>
					<Box flexShrink={1}>
						<Text color={COLORS.muted} wrap="truncate-middle">{args.provider}/{args.model}</Text>
						{headerModeLabel && <Text color={COLORS.warning} bold> · {headerModeLabel}</Text>}
					</Box>
				</Box>
				<Box justifyContent="space-between">
					<Box flexGrow={1} flexShrink={1}>
						<Text color={COLORS.muted} wrap="truncate-middle">{session.title} · {session.id.slice(0, 8)} · {args.cwd}</Text>
					</Box>
					{contextStatus && <Text color={COLORS.muted}> {contextStatus}</Text>}
				</Box>
			</Box>

			<Box flexDirection="column" paddingX={1} height={contentRows} overflow="hidden">
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
						{visibleLines.length === 0 && (
							<>
								{contentRows >= 1 && <Text bold>What are we building?</Text>}
								{contentRows >= 2 && <Text color={COLORS.muted}>Describe a task.</Text>}
								{contentRows >= 3 && <Text color={COLORS.muted}>Type /help for commands.</Text>}
							</>
						)}
						{visibleLines.map(line => <TranscriptViewportLine key={line.key} line={line} />)}
					</>}
			</Box>

			{approval && <ApprovalBox approval={approval} decide={decideApproval} />}
			{editApproval && <EditApprovalBox approval={editApproval} decide={decideEditApproval} maxDiffRows={editPreviewRows} />}
			{showSessions && <SessionPicker sessions={store.list()} onSelect={switchSession} onCancel={() => setShowSessions(false)} />}
			{models && <ModelPicker models={models} current={args.model} onSelect={switchModel} onCancel={() => setModels(undefined)} />}
			{!approval && !editApproval && !showSessions && !models && !modelTermination && !diffReviews && commandItems.length > 0 && (
				<CommandPalette items={commandItems} selected={visibleCommandSelection} />
			)}

			{!approval && !editApproval && !showSessions && !models && modelTermination && (
				<ModelTerminationNotice message={modelTermination.message} />
			)}

			{!approval && !editApproval && !showSessions && !models && !modelTermination && (
				<Box borderStyle="round" borderColor={running ? COLORS.muted : COLORS.accent} paddingX={1}>
					{diffReviews
						? <Text color={COLORS.muted}>←/→ view · ↑/↓ file · j/k scroll · PgUp/PgDn page · Esc close</Text>
						: running
						? <>
							<Text color={COLORS.warning}><Spinner type="line" /> {formatActivityStatus(status)}</Text>
							<Text color={COLORS.muted}> · Esc to cancel</Text>
						</>
						: <>
							<Text color={COLORS.accent}>❯ </Text>
							<PromptInput
								value={input}
								focus={!diffReviews}
								onChange={value => {
									setInput(value);
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
			)}
			<Text color={COLORS.muted}>{FOOTER_HELP}</Text>
		</Box>
	);
}
