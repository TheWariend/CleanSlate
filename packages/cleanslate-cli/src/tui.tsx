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
import { apiKeyFromEnvironment, ICliArguments, SUPPORTED_PROVIDERS } from './argv.js';
import { CleanSlateTerminalLogo } from './brand.js';
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

const COLORS = {
	accent: '#8b5cf6',
	cyan: '#22d3ee',
	muted: '#71717a',
	success: '#22c55e',
	danger: '#ef4444',
	warning: '#f59e0b'
};

interface ICommandPaletteItem {
	id: string;
	label: string;
	description: string;
}

const COMMAND_PALETTE_ITEMS: readonly ICommandPaletteItem[] = [
	{ id: '/plan', label: 'Plan mode', description: 'Turn planning mode on' },
	{ id: '/fix', label: 'Fix', description: 'Fix bugs and root causes' },
	{ id: '/explain', label: 'Explain', description: 'Explain relevant code' },
	{ id: '/test', label: 'Test', description: 'Write comprehensive tests' },
	{ id: '/rewrite', label: 'Rewrite', description: 'Improve code without changing behavior' },
	{ id: '/doc', label: 'Document', description: 'Add documentation' },
	{ id: '/review', label: 'Review', description: 'Review bugs, security, and quality' },
	{ id: '/optimize', label: 'Optimize', description: 'Apply targeted performance improvements' },
	{ id: '/scaffold', label: 'Scaffold', description: 'Scaffold a complete implementation' },
	{ id: '/migrate', label: 'Migrate', description: 'Migrate code to a specified target' },
	{ id: '/setup', label: 'Provider setup', description: 'Change provider, credentials, and model' },
	{ id: '/models', label: 'Models', description: 'Browse models for the active provider' },
	{ id: '/model', label: 'Set model', description: 'Switch directly to a model ID' },
	{ id: '/provider', label: 'Set provider', description: 'Switch using a saved credential' },
	{ id: '/reasoning', label: 'Reasoning', description: 'Set reasoning effort' },
	{ id: '/mode', label: 'Mode', description: 'Switch planning or execution mode' },
	{ id: '/new', label: 'New session', description: 'Start a clean session' },
	{ id: '/sessions', label: 'Sessions', description: 'Browse saved sessions' },
	{ id: '/resume', label: 'Resume', description: 'Resume a session by ID' },
	{ id: '/status', label: 'Status', description: 'Show provider and execution status' },
	{ id: '/clear', label: 'Clear', description: 'Clear conversation and transcript' },
	{ id: '/help', label: 'Help', description: 'Show terminal commands' },
	{ id: '/exit', label: 'Exit', description: 'Save and quit' }
];

function CommandPalette({ items, selected }: { items: readonly ICommandPaletteItem[]; selected: number }) {
	const start = Math.max(0, Math.min(selected - 5, items.length - 10));
	return (
		<Box borderStyle="round" borderColor={COLORS.accent} flexDirection="column" paddingX={1}>
			<Text bold>Commands</Text>
			{items.slice(start, start + 10).map((item, offset) => {
				const index = start + offset;
				return <Text key={item.id} inverse={selected === index}>
					{selected === index ? '› ' : '  '}<Text color={COLORS.cyan}>{item.id}</Text>
					<Text>  {item.label}</Text>
					<Text color={COLORS.muted}> — {item.description}</Text>
				</Text>;
			})}
			<Text color={COLORS.muted}>↑/↓ select · enter insert · esc close</Text>
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
		<Box borderStyle="round" borderColor={COLORS.cyan} flexDirection="column" paddingX={1} marginTop={1}>
			<Text bold>Models · {models.length}</Text>
			{models.slice(start, start + 10).map((model, offset) => {
				const index = start + offset;
				return <Text key={model} inverse={selected === index}>{selected === index ? '› ' : '  '}{model}{model === current ? '  ✓' : ''}</Text>;
			})}
			<Text color={COLORS.muted}>↑/↓ select · enter use model · esc close</Text>
		</Box>
	);
}

export function CleanSlateTui({ args, store, initialSession, initialTask, onConfigurationChange, getCredential, onCredentialChange, onRequestSetup }: ITuiProps) {
	const { exit } = useApp();
	const { stdout } = useStdout();
	const [session, setSession] = useState(initialSession);
	const sessionRef = useRef(initialSession);
	const [transcript, setTranscript] = useState<ICliTranscriptEntry[]>(initialSession.transcript);
	const [input, setInput] = useState('');
	const [commandSelection, setCommandSelection] = useState(0);
	const [running, setRunning] = useState(false);
	const [status, setStatus] = useState('ready');
	const [contextUsage, setContextUsage] = useState<number | undefined>();
	const [approval, setApproval] = useState<IPendingApproval | undefined>();
	const [allowCommandsForSession, setAllowCommandsForSession] = useState(false);
	const allowCommandsRef = useRef(false);
	const [showSessions, setShowSessions] = useState(false);
	const [models, setModels] = useState<string[] | undefined>();
	const [mode, setMode] = useState<'execution' | 'planning'>('execution');
	const [scrollOffset, setScrollOffset] = useState(0);
	const abortRef = useRef<AbortController | undefined>(undefined);
	const runtimeRef = useRef<CleanSlateNodeAgentRuntime | undefined>(undefined);
	const initialTaskStarted = useRef(false);
	const commandQuery = input.match(/^\/(\S*)$/)?.[1]?.toLowerCase();
	const commandItems = commandQuery === undefined
		? []
		: COMMAND_PALETTE_ITEMS.filter(item =>
			item.id.slice(1).includes(commandQuery) || item.label.toLowerCase().includes(commandQuery));
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
				maxTurns: args.maxTurns,
				bedrockRegion: args.bedrockRegion,
				bedrockCredentialMode: args.bedrockProfile ? 'profile' : 'default',
				bedrockProfile: args.bedrockProfile,
				azureEndpoint: args.azureEndpoint,
				azureApiVersion: args.azureApiVersion,
				azureDeploymentName: args.model
			}),
			onManagedTokenRefresh: token => onCredentialChange?.('cleanslate', token),
			approveCommand: request => {
				if (allowCommandsRef.current) {
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

	const executeTask = async (task: string, requestedMode: 'execution' | 'planning' = mode) => {
		const runtime = runtimeRef.current;
		if (!runtime) {
			return;
		}
		append(transcriptEntry('user', task));
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
			: requestedMode === 'planning' ? runtime.plan(task, abort.signal) : runtime.run(task, abort.signal));
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
		if (!value || running || approval) {
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
			append(transcriptEntry('system', '/setup · /new · /sessions · /resume <id> · /models · /model <id> · /provider <name> <model> · /reasoning <level> · /mode plan|execution · /plan · /fix · /explain · /test · /rewrite · /doc · /review · /optimize · /scaffold · /migrate · /clear · /exit'));
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
			const apiKey = apiKeyFromEnvironment(provider as any, process.env) ?? getCredential?.(provider as any);
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
		if (approval || showSessions || models) {
			return;
		}
		const paletteSize = commandItems.length;
		if (paletteSize > 0 && key.upArrow) {
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
		} else if (key.pageUp) {
			setScrollOffset(value => Math.min(transcript.length, value + Math.max(5, Math.floor((stdout.rows ?? 30) / 2))));
		} else if (key.pageDown) {
			setScrollOffset(value => Math.max(0, value - Math.max(5, Math.floor((stdout.rows ?? 30) / 2))));
		}
	});

	const visibleCount = Math.max(8, Math.floor((stdout.rows ?? 30) - 12));
	const visibleTranscript = useMemo(() => {
		const end = Math.max(0, transcript.length - scrollOffset);
		return transcript.slice(Math.max(0, end - visibleCount), end);
	}, [transcript, visibleCount, scrollOffset]);

	return (
		<Box flexDirection="column">
			<Box borderStyle="round" borderColor={COLORS.accent} paddingX={1} justifyContent="space-between">
				<Box alignItems="center">
					<CleanSlateTerminalLogo />
					<Box flexDirection="column">
						<Text color={COLORS.accent} bold>CLEANSLATE</Text>
						<Text color={COLORS.muted}>agent terminal</Text>
					</Box>
				</Box>
				<Text color={COLORS.muted}>{args.provider}/{args.model} · {mode}</Text>
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
			{models && <ModelPicker models={models} current={args.model} onSelect={switchModel} onCancel={() => setModels(undefined)} />}
			{!approval && !showSessions && !models && commandItems.length > 0 && (
				<CommandPalette items={commandItems} selected={visibleCommandSelection} />
			)}

			{!approval && !showSessions && !models && (
				<Box borderStyle="round" borderColor={running ? COLORS.muted : COLORS.cyan} paddingX={1}>
					<Text color={COLORS.cyan}>❯ </Text>
					{running
						? <Text color={COLORS.muted}>Agent is working… press Esc to cancel</Text>
						: <TextInput
							value={input}
							onChange={value => {
								setInput(value);
								setCommandSelection(0);
							}}
							onSubmit={value => {
								const selected = commandItems[visibleCommandSelection];
								if (selected) {
									setInput(`${selected.id} `);
									setCommandSelection(0);
									return;
								}
								void submit(value);
							}}
							placeholder="Ask CleanSlate…"
						/>}
				</Box>
			)}
			<Text color={COLORS.muted}> enter send · esc cancel · ctrl-c exit · pgup/pgdn scroll · / commands · /setup · /models</Text>
		</Box>
	);
}
