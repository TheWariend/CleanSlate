/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import {
	CleanSlateNodeAgentRuntime,
	createNodeProviderConfiguration
} from '@slate/sdk';
import { ICliArguments } from './argv.js';
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

const COLORS = {
	accent: '#8b5cf6',
	cyan: '#22d3ee',
	muted: '#71717a',
	success: '#22c55e',
	danger: '#ef4444',
	warning: '#f59e0b'
};

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

function TranscriptItem({ entry }: { entry: ICliTranscriptEntry }) {
	if (entry.kind === 'user') {
		return (
			<Box marginTop={1}>
				<Text color={COLORS.cyan} bold>you  </Text>
				<Text wrap="wrap">{entry.content}</Text>
			</Box>
		);
	}
	if (entry.kind === 'assistant') {
		return (
			<Box marginTop={1} flexDirection="column">
				<Text color={COLORS.accent} bold>cleanslate</Text>
				<Text wrap="wrap">{entry.content || ' '}</Text>
			</Box>
		);
	}
	if (entry.kind === 'reasoning') {
		return (
			<Box>
				<Text color={COLORS.muted}>  reasoning  {compact(entry.content, 240)}</Text>
			</Box>
		);
	}
	if (entry.kind === 'tool') {
		const color = entry.status === 'failed' ? COLORS.danger : entry.status === 'running' ? COLORS.warning : COLORS.success;
		const marker = entry.status === 'running' ? '●' : entry.status === 'failed' ? '×' : '✓';
		return (
			<Box>
				<Text color={color}>{marker} </Text>
				<Text bold>{entry.toolName}</Text>
				<Text color={COLORS.muted}>  {entry.content}</Text>
			</Box>
		);
	}
	const color = entry.kind === 'error' ? COLORS.danger : COLORS.muted;
	return <Text color={color}>  {entry.content}</Text>;
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
			<Text><Text color={COLORS.success}>[y]</Text> once  <Text color={COLORS.cyan}>[a]</Text> allow commands this session  <Text color={COLORS.danger}>[n]</Text> deny</Text>
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

export function CleanSlateTui({ args, store, initialSession, initialTask }: ITuiProps) {
	const { exit } = useApp();
	const { stdout } = useStdout();
	const [session, setSession] = useState(initialSession);
	const sessionRef = useRef(initialSession);
	const [transcript, setTranscript] = useState<ICliTranscriptEntry[]>(initialSession.transcript);
	const [input, setInput] = useState('');
	const [running, setRunning] = useState(false);
	const [status, setStatus] = useState('ready');
	const [contextUsage, setContextUsage] = useState<number | undefined>();
	const [approval, setApproval] = useState<IPendingApproval | undefined>();
	const [allowCommandsForSession, setAllowCommandsForSession] = useState(false);
	const allowCommandsRef = useRef(false);
	const [showSessions, setShowSessions] = useState(false);
	const abortRef = useRef<AbortController | undefined>(undefined);
	const runtimeRef = useRef<CleanSlateNodeAgentRuntime | undefined>(undefined);
	const initialTaskStarted = useRef(false);

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

	const createRuntime = (targetSession: ICliSession) => {
		runtimeRef.current?.dispose();
		const runtime = new CleanSlateNodeAgentRuntime({
			rootPath: args.cwd,
			sessionId: targetSession.id,
			configuration: createNodeProviderConfiguration({
				provider: args.provider,
				model: args.model!,
				apiKey: args.apiKey,
				baseUrl: args.baseUrl,
				reasoningLevel: args.reasoningLevel,
				maxTurns: args.maxTurns
			}),
			approveCommand: request => {
				if (allowCommandsRef.current) {
					return Promise.resolve(true);
				}
				return new Promise<boolean>(resolve => setApproval({ request, resolve }));
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

	const runStream = async (stream: AsyncIterable<any>) => {
		let assistantId: string | undefined;
		let reasoningId: string | undefined;
		try {
			for await (const part of stream) {
				switch (part.type) {
					case 'assistant_turn_start':
						setStatus(`turn ${part.turnIndex ?? ''}`.trim());
						break;
					case 'context_usage':
						setContextUsage(part.percentage);
						break;
					case 'reasoning':
						if (!reasoningId) {
							const entry = transcriptEntry('reasoning', part.content);
							reasoningId = entry.id;
							append(entry);
						} else {
							replaceTranscript(entries => entries.map(entry => entry.id === reasoningId
								? { ...entry, content: `${entry.content}${part.content}` }
								: entry));
						}
						break;
					case 'chat_text':
						if (!assistantId) {
							const entry = transcriptEntry('assistant', part.content);
							assistantId = entry.id;
							append(entry);
						} else {
							replaceTranscript(entries => entries.map(entry => entry.id === assistantId
								? { ...entry, content: `${entry.content}${part.content}` }
								: entry));
						}
						break;
					case 'tool_start':
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
							const updated = transcriptEntry('tool', toolSummary(part), {
								id: part.toolCallId || undefined,
								toolName: part.toolName,
								status: part.result?.success === false ? 'failed' : 'completed',
								detail: part.result
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
						setStatus('complete');
						break;
				}
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
			append(transcriptEntry('error', error instanceof Error ? error.message : String(error)));
			setStatus('error');
		} finally {
			setRunning(false);
			persist();
		}
	};

	const executeTask = async (task: string) => {
		const runtime = runtimeRef.current;
		if (!runtime) {
			return;
		}
		append(transcriptEntry('user', task));
		setRunning(true);
		setStatus('thinking');
		const abort = new AbortController();
		abortRef.current = abort;
		const pendingQuestion = runtime.getPendingQuestion();
		await runStream(pendingQuestion
			? runtime.resumePendingQuestion(task, abort.signal)
			: runtime.run(task, abort.signal));
	};

	const switchSession = (next: ICliSession) => {
		persist();
		sessionRef.current = next;
		setSession(next);
		setTranscript(next.transcript);
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

	const submit = async (raw: string) => {
		const value = raw.trim();
		setInput('');
		if (!value || running || approval) {
			return;
		}
		if (value === '/exit' || value === '/quit') {
			persist();
			exit();
			return;
		}
		if (value === '/help') {
			append(transcriptEntry('system', '/new · /sessions · /resume <id> · /model · /clear · /exit · esc cancels a running turn'));
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
		if (value === '/model') {
			append(transcriptEntry('system', `Provider: ${args.provider} · Model: ${args.model} · Reasoning: ${args.reasoningLevel}`));
			return;
		}
		if (value === '/clear') {
			replaceTranscript(() => []);
			return;
		}
		await executeTask(value);
	};

	useInput((inputValue, key) => {
		if (approval || showSessions) {
			return;
		}
		if (key.escape && running) {
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

	const visibleCount = Math.max(8, Math.floor((stdout.rows ?? 30) - 12));
	const visibleTranscript = useMemo(() => transcript.slice(-visibleCount), [transcript, visibleCount]);

	return (
		<Box flexDirection="column">
			<Box borderStyle="round" borderColor={COLORS.accent} paddingX={1} justifyContent="space-between">
				<Box>
					<Text color={COLORS.accent} bold>◆ CLEANSLATE</Text>
					<Text color={COLORS.muted}>  agent terminal</Text>
				</Box>
				<Text color={COLORS.muted}>{args.provider}/{args.model}</Text>
			</Box>

			<Box paddingX={1} justifyContent="space-between">
				<Text color={COLORS.muted}>{session.title} · {session.id.slice(0, 8)} · {args.cwd}</Text>
				<Text color={running ? COLORS.warning : COLORS.success}>
					{running && <Spinner type="dots" />} {status}
					{contextUsage !== undefined ? ` · context ${Math.round(contextUsage)}%` : ''}
					{allowCommandsForSession ? ' · commands allowed' : ''}
				</Text>
			</Box>

			<Box flexDirection="column" paddingX={1} minHeight={8}>
				{visibleTranscript.length === 0 && (
					<Box flexDirection="column" marginTop={1}>
						<Text bold>What are we building?</Text>
						<Text color={COLORS.muted}>Describe a task. CleanSlate has all 59 IDE-agent tools in this workspace.</Text>
						<Text color={COLORS.muted}>Type /help for commands.</Text>
					</Box>
				)}
				{visibleTranscript.map(entry => <TranscriptItem key={entry.id} entry={entry} />)}
			</Box>

			{approval && <ApprovalBox approval={approval} decide={decideApproval} />}
			{showSessions && <SessionPicker sessions={store.list()} onSelect={switchSession} onCancel={() => setShowSessions(false)} />}

			{!approval && !showSessions && (
				<Box borderStyle="round" borderColor={running ? COLORS.muted : COLORS.cyan} paddingX={1}>
					<Text color={COLORS.cyan}>❯ </Text>
					{running
						? <Text color={COLORS.muted}>Agent is working… press Esc to cancel</Text>
						: <TextInput value={input} onChange={setInput} onSubmit={value => void submit(value)} placeholder="Ask CleanSlate…" />}
				</Box>
			)}
			<Text color={COLORS.muted}> enter send · esc cancel · ctrl-c exit · /sessions resume · /new fresh session</Text>
		</Box>
	);
}
