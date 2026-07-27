/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CleanSlateAgentParsingSupport } from '../../browser/agent/cleanSlateAgentParsing.js';
import { CleanSlateExecutionQueryEngine } from '../../browser/agent/cleanSlateExecutionQuery.js';
import { CleanSlateQueryRunner } from '../../browser/agent/cleanSlateQueryRunner.js';
import { PHASE_CONCLUSION_SIGNAL_PLAN_CREATED } from '../../browser/agent/cleanSlateAgentTypes.js';
import { AgentPhase } from '../../browser/agent/cleanSlatePrompts.js';
import { CleanSlateThreadService } from '../../browser/core/cleanSlateThreadService.js';
import { CleanSlateTaskSessionService } from '../../browser/core/cleanSlateTaskSessionService.js';

suite('CleanSlateQueryRunner', () => {
    test('planning-profile execution keeps prompt context stable across model turns', async () => {
        const parsingSupport = new CleanSlateAgentParsingSupport({
            getConfiguration: () => ({ planMode: true, reasoningLevel: 'medium' })
        } as any);

        let chatCalls = 0;
        let getContextCalls = 0;
        let promptContextBuilds = 0;
        const runner = new CleanSlateExecutionQueryEngine({
            cleanSlateService: {
                chat: async () => (async function* () {
                    chatCalls++;
					if (chatCalls === 1) {
						yield {
							type: 'tool_call',
							call: {
								toolName: 'read_file',
                                input: { path: 'current.ts' }
                            }
						};
						return;
					}
					yield {
						type: 'text',
						content: 'Finished after reading current.ts.'
					};
                })()
            },
            cleanSlateContextService: {
                getContext: async () => {
                    getContextCalls++;
                    return {
                        activeFile: { languageId: 'typescript' },
                        openFiles: []
                    };
                }
            },
            buildPromptContext: async () => {
                promptContextBuilds++;
                return 'Prompt Context';
            },
            getCurrentAgentDefinition: () => undefined,
            parsingSupport,
            executionSupport: {
                createMarkerBaseline: () => new Map(),
                collectNewMarkerIssues: async () => [],
                trackTouchedPaths: () => { },
                didToolSucceed: () => true,
                isConfirmedMutationResult: () => false
            },
            executeTool: async function* (toolName: string) {
                yield {
                    type: 'tool_result',
                    toolName,
                    result: { success: true }
                };
            },
            toolContext: { configService: { getConfiguration: () => ({}) } } as any,
            recentFocusLines: new Map(),
            referenceBuffer: new Map(),
            checkCrossFileReferences: async () => [],
            getToolCategory: (toolName: string) => toolName === 'read_file' ? 'discovery' : undefined
        } as any);

        const threadService = new CleanSlateThreadService();
        const taskSessionService = new CleanSlateTaskSessionService();
        taskSessionService.setPhase(AgentPhase.EXECUTION);

        for await (const part of runner.run(
            [
                { role: 'system', content: 'placeholder' },
                { role: 'user', content: '[CONTEXT]\nplaceholder' }
            ] as any,
            'Finish carefully',
            'Execution',
            { activeFile: { languageId: 'typescript' } },
            '',
            threadService,
            taskSessionService,
            undefined,
            { executionFlow: 'planning' }
        )) {
            void part;
            // Drain the run.
        }

        assert.strictEqual(chatCalls, 2);
        assert.strictEqual(getContextCalls, 1);
        assert.strictEqual(promptContextBuilds, 1);
    });

    test('planning-profile execution keeps CLI available while preferring lint diagnostics', async () => {
        const parsingSupport = new CleanSlateAgentParsingSupport({
            getConfiguration: () => ({ planMode: true, reasoningLevel: 'medium' })
        } as any);

        let chatCalls = 0;
        let firstTurnToolNames: string[] = [];
        const runner = new CleanSlateExecutionQueryEngine({
            cleanSlateService: {
                chat: async (_messages: any[], options: any) => (async function* () {
                    chatCalls++;
					if (chatCalls === 1) {
						firstTurnToolNames = Array.isArray(options?.tools)
							? options.tools.map((tool: any) => tool.name)
							: [];
                        yield {
                            type: 'tool_call',
                            call: {
                                toolName: 'read_file',
                                input: { path: 'current.ts' }
                            }
						};
						return;
					}
					yield {
						type: 'text',
						content: 'Finished after lint-first execution verification.'
					};
                })()
            },
            cleanSlateContextService: {
                getContext: async () => ({
                    activeFile: { languageId: 'typescript' },
                    openFiles: []
                })
            },
            buildPromptContext: async () => 'Prompt Context',
            getCurrentAgentDefinition: () => undefined,
            parsingSupport,
            executionSupport: {
                createMarkerBaseline: () => new Map(),
                collectNewMarkerIssues: async () => [],
                trackTouchedPaths: () => { },
                didToolSucceed: () => true,
                isConfirmedMutationResult: () => false
            },
            executeTool: async function* (toolName: string) {
                yield {
                    type: 'tool_result',
                    toolName,
                    result: { success: true }
                };
            },
            toolContext: { configService: { getConfiguration: () => ({}) } } as any,
            recentFocusLines: new Map(),
            referenceBuffer: new Map(),
            checkCrossFileReferences: async () => [],
            getToolCategory: (toolName: string) => toolName === 'read_file' ? 'discovery' : undefined
        } as any);

        const threadService = new CleanSlateThreadService();
        const taskSessionService = new CleanSlateTaskSessionService();
        taskSessionService.setPhase(AgentPhase.EXECUTION);

        for await (const part of runner.run(
            [
                { role: 'system', content: 'placeholder' },
                { role: 'user', content: '[CONTEXT]\nplaceholder' }
            ] as any,
            'Finish carefully',
            'Execution',
            { activeFile: { languageId: 'typescript' } },
            '',
            threadService,
            taskSessionService,
            undefined,
            { executionFlow: 'planning' }
        )) {
            void part;
        }

        assert.strictEqual(chatCalls, 2);
        assert.strictEqual(firstTurnToolNames.includes('execute_command'), true);
        assert.strictEqual(firstTurnToolNames.includes('read_lints'), true);
    });

    test('normal execution exposes browser tools for explicit browser requests', async () => {
        const parsingSupport = new CleanSlateAgentParsingSupport({
            getConfiguration: () => ({ planMode: false, reasoningLevel: 'low' })
        } as any);

        let firstTurnToolNames: string[] = [];
		const runner = new CleanSlateExecutionQueryEngine({
			cleanSlateService: {
				chat: async (_messages: any[], options: any) => (async function* () {
					firstTurnToolNames = Array.isArray(options?.tools)
						? options.tools.map((tool: any) => tool.name)
						: [];
					yield {
						type: 'tool_call',
						call: {
							toolName: 'browser_snapshot',
							input: {}
						}
					};
				})()
			},
            cleanSlateContextService: {
                getContext: async () => ({
                    activeFile: { languageId: 'typescript' },
                    openFiles: []
                })
            },
            buildPromptContext: async () => 'Prompt Context',
            getCurrentAgentDefinition: () => undefined,
            parsingSupport,
            executionSupport: {
                createMarkerBaseline: () => new Map(),
                collectNewMarkerIssues: async () => [],
                trackTouchedPaths: () => { },
                didToolSucceed: () => true,
                isConfirmedMutationResult: () => false
            },
            executeTool: async function* (toolName: string) {
                yield {
                    type: 'tool_result',
                    toolName,
                    result: { success: true }
                };
            },
            toolContext: { configService: { getConfiguration: () => ({}) } } as any,
            recentFocusLines: new Map(),
            referenceBuffer: new Map(),
            checkCrossFileReferences: async () => [],
            getToolCategory: (toolName: string) => toolName.startsWith('browser_') ? 'browser' : undefined
        } as any);

        const threadService = new CleanSlateThreadService();
        const taskSessionService = new CleanSlateTaskSessionService();
        taskSessionService.setPhase(AgentPhase.EXECUTION);

        for await (const part of runner.run(
            [
                { role: 'system', content: 'placeholder' },
                { role: 'user', content: '[CONTEXT]\nplaceholder' }
            ] as any,
            'Open browser and check http://localhost:4180',
            'Execution',
            { activeFile: { languageId: 'typescript' } },
            '',
            threadService,
            taskSessionService,
            undefined,
            { executionFlow: 'normal' }
		)) {
			void part;
			if (firstTurnToolNames.length > 0) {
				break;
			}
		}

        assert.strictEqual(firstTurnToolNames.includes('browser_open'), true);
        assert.strictEqual(firstTurnToolNames.includes('browser_snapshot'), true);
        assert.strictEqual(firstTurnToolNames.includes('browser_screenshot'), true);
        assert.strictEqual(firstTurnToolNames.includes('execute_command'), true);
        assert.strictEqual(firstTurnToolNames.includes('update_todo'), true);
    });

    test('normal execution accepts an honest visible explanation without a semantic completion gate', async () => {
        const parsingSupport = new CleanSlateAgentParsingSupport({
            getConfiguration: () => ({ planMode: false, reasoningLevel: 'low' })
        } as any);

        let chatCalls = 0;
        const executedBrowserInputs: any[] = [];
        const runner = new CleanSlateExecutionQueryEngine({
            cleanSlateService: {
                chat: async () => (async function* () {
                    chatCalls++;
                    if (chatCalls === 1) {
                        yield {
                            type: 'tool_call',
                            call: {
                                toolName: 'browser_open',
                                input: {}
                            }
                        };
                        return;
                    }
                    yield {
                        type: 'text',
                        content: 'Browser needs a URL.'
                    };
                })()
            },
            cleanSlateContextService: {
                getContext: async () => ({
                    activeFile: { languageId: 'typescript' },
                    openFiles: []
                })
            },
            buildPromptContext: async () => 'Prompt Context',
            getCurrentAgentDefinition: () => undefined,
            parsingSupport,
            executionSupport: {
                createMarkerBaseline: () => new Map(),
                collectNewMarkerIssues: async () => [],
                trackTouchedPaths: () => { },
                didToolSucceed: (result: any) => result?.success !== false,
                isConfirmedMutationResult: () => false
            },
            executeTool: async function* (toolName: string, input: any) {
                if (toolName === 'browser_open') {
                    executedBrowserInputs.push(input);
                }
                yield {
                    type: 'tool_result',
                    toolName,
                    result: {
                        success: toolName !== 'browser_open',
                        error: toolName === 'browser_open' ? 'browser_open requires a URL.' : undefined
                    }
                };
            },
            toolContext: { configService: { getConfiguration: () => ({}) } } as any,
            recentFocusLines: new Map(),
            referenceBuffer: new Map(),
            checkCrossFileReferences: async () => [],
            getToolCategory: (toolName: string) => toolName.startsWith('browser_') ? 'browser' : undefined
        } as any);

        const threadService = new CleanSlateThreadService();
        const taskSessionService = new CleanSlateTaskSessionService();
        taskSessionService.setPhase(AgentPhase.EXECUTION);

        const parts: any[] = [];
        for await (const part of runner.run(
            [
                { role: 'system', content: 'placeholder' },
                { role: 'user', content: '[CONTEXT]\nplaceholder' }
            ] as any,
            'plz open browser tool',
            'Execution',
            { activeFile: { languageId: 'typescript' } },
            '',
            threadService,
            taskSessionService,
            undefined,
            { executionFlow: 'normal' }
        )) {
            parts.push(part);
        }

        assert.deepStrictEqual(executedBrowserInputs, [{}]);
        assert.strictEqual(chatCalls, 2);
        assert.strictEqual(parts.some(part => part.type === 'task_complete'), true);
        assert.strictEqual(parts.some(part => part.type === 'chat_text' && part.kind === 'model_terminated_pause'), false);
    });

    test('finishes from native assistant tool calls after technical progress', async () => {
        const parsingSupport = new CleanSlateAgentParsingSupport({
            getConfiguration: () => ({ planMode: false, reasoningLevel: 'low' })
        } as any);

        let chatCalls = 0;
        const runner = new CleanSlateQueryRunner({
            cleanSlateService: {
                chat: async () => (async function* () {
                    chatCalls++;
                    if (chatCalls === 1) {
                        yield {
                            type: 'tool_call',
                            call: {
                                toolName: 'read_file',
                                input: { path: 'current.ts' }
                            }
						};
						return;
					}
					yield {
						type: 'text',
						content: 'Finished after reading current.ts.'
					};
                })()
            },
            cleanSlateContextService: {
                getContext: async () => ({
                    activeFile: { languageId: 'typescript' },
                    openFiles: []
                })
            },
            buildPromptContext: async () => 'Prompt Context',
            getCurrentAgentDefinition: () => undefined,
            parsingSupport,
            executionSupport: {
                createMarkerBaseline: () => new Map(),
                collectNewMarkerIssues: async () => [],
                trackTouchedPaths: () => { },
                didToolSucceed: () => true,
                isConfirmedMutationResult: () => false
            },
            executeTool: async function* (toolName: string) {
                yield {
                    type: 'tool_result',
                    toolName,
                    result: { success: true }
                };
            },
            toolContext: { configService: { getConfiguration: () => ({}) } } as any,
            recentFocusLines: new Map(),
            referenceBuffer: new Map(),
            checkCrossFileReferences: async () => [],
            getToolCategory: (toolName: string) => toolName === 'read_file' ? 'discovery' : undefined
        } as any);

        const threadService = new CleanSlateThreadService();
        const taskSessionService = new CleanSlateTaskSessionService();
        taskSessionService.setPhase(AgentPhase.EXECUTION);

        const parts = [];
        for await (const part of runner.run(
            [
                { role: 'system', content: 'placeholder' },
                { role: 'user', content: '[CONTEXT]\nplaceholder' }
            ] as any,
            'Finish quickly',
            'Execution',
            { activeFile: { languageId: 'typescript' } },
            '',
            threadService,
            taskSessionService
        )) {
            parts.push(part);
        }

        assert.strictEqual(parts.some((part: any) => part.type === 'task_complete'), true);
        assert.strictEqual(taskSessionService.getPhase(), AgentPhase.EXECUTION);
    });

    test('finishes from native streamed tool_call events after technical progress', async () => {
        const parsingSupport = new CleanSlateAgentParsingSupport({
            getConfiguration: () => ({ planMode: false, reasoningLevel: 'low' })
        } as any);

        let chatCalls = 0;
        const runner = new CleanSlateQueryRunner({
            cleanSlateService: {
                chat: async () => (async function* () {
                    chatCalls++;
					if (chatCalls === 1) {
						yield {
							type: 'tool_call',
							call: {
								toolName: 'read_file',
								input: { path: 'current.ts' }
							}
						};
						return;
					}
					yield {
						type: 'text',
						content: 'Finished after reading current.ts.'
					};
                })()
            },
            cleanSlateContextService: {
                getContext: async () => ({
                    activeFile: { languageId: 'typescript' },
                    openFiles: []
                })
            },
            buildPromptContext: async () => 'Prompt Context',
            getCurrentAgentDefinition: () => undefined,
            parsingSupport,
            executionSupport: {
                createMarkerBaseline: () => new Map(),
                collectNewMarkerIssues: async () => [],
                trackTouchedPaths: () => { },
                didToolSucceed: () => true,
                isConfirmedMutationResult: () => false
            },
            executeTool: async function* (toolName: string) {
                yield {
                    type: 'tool_result',
                    toolName,
                    result: { success: true }
                };
            },
            toolContext: { configService: { getConfiguration: () => ({}) } } as any,
            recentFocusLines: new Map(),
            referenceBuffer: new Map(),
            checkCrossFileReferences: async () => [],
            getToolCategory: (toolName: string) => toolName === 'read_file' ? 'discovery' : undefined
        } as any);

        const threadService = new CleanSlateThreadService();
        const taskSessionService = new CleanSlateTaskSessionService();
        taskSessionService.setPhase(AgentPhase.EXECUTION);

        const parts = [];
        for await (const part of runner.run(
            [
                { role: 'system', content: 'placeholder' },
                { role: 'user', content: '[CONTEXT]\nplaceholder' }
            ] as any,
            'Finish quickly',
            'Execution',
            { activeFile: { languageId: 'typescript' } },
            '',
            threadService,
            taskSessionService
        )) {
            parts.push(part);
        }

        assert.strictEqual(chatCalls, 2);
        assert.strictEqual(parts.some((part: any) => part.type === 'task_complete'), true);
    });

    test('runs discovery tool batches concurrently and streams completed results', async () => {
        const parsingSupport = new CleanSlateAgentParsingSupport({
            getConfiguration: () => ({ planMode: false, reasoningLevel: 'low' })
        } as any);

        let chatCalls = 0;
        const runner = new CleanSlateQueryRunner({
            cleanSlateService: {
                chat: async () => (async function* () {
                    chatCalls++;
					if (chatCalls === 1) {
						yield {
							type: 'tool_call',
							call: {
								toolName: 'read_file',
								input: { path: 'slow.ts', delay: 25 }
                            }
                        };
                        yield {
                            type: 'tool_call',
                            call: {
                                toolName: 'grep_search',
                                input: { pattern: 'fast', delay: 1 }
                            }
						};
						return;
					}
					yield {
						type: 'text',
						content: 'Finished after concurrent discovery.'
					};
                })()
            },
            cleanSlateContextService: {
                getContext: async () => ({
                    activeFile: { languageId: 'typescript' },
                    openFiles: []
                })
            },
            buildPromptContext: async () => 'Prompt Context',
            getCurrentAgentDefinition: () => undefined,
            parsingSupport,
            executionSupport: {
                createMarkerBaseline: () => new Map(),
                collectNewMarkerIssues: async () => [],
                trackTouchedPaths: () => { },
                didToolSucceed: () => true,
                isConfirmedMutationResult: () => false
            },
            executeTool: async function* (toolName: string, input: any) {
                await new Promise(resolve => setTimeout(resolve, input.delay));
                yield {
                    type: 'tool_result',
                    toolName,
                    result: { success: true, toolName }
                };
            },
            toolContext: { configService: { getConfiguration: () => ({}) } } as any,
            recentFocusLines: new Map(),
            referenceBuffer: new Map(),
            checkCrossFileReferences: async () => [],
            getToolCategory: (toolName: string) => toolName === 'read_file' || toolName === 'grep_search' ? 'discovery' : undefined
        } as any);

        const threadService = new CleanSlateThreadService();
        const taskSessionService = new CleanSlateTaskSessionService();
        taskSessionService.setPhase(AgentPhase.EXECUTION);

        const parts = [];
        for await (const part of runner.run(
            [
                { role: 'system', content: 'placeholder' },
                { role: 'user', content: '[CONTEXT]\nplaceholder' }
            ] as any,
            'Search quickly',
            'Execution',
            { activeFile: { languageId: 'typescript' } },
            '',
            threadService,
            taskSessionService
        )) {
            parts.push(part);
        }

        const toolResultNames = parts
            .filter((part: any) => part.type === 'tool_result')
            .map((part: any) => part.toolName);

        assert.strictEqual(toolResultNames[0], 'grep_search');
        assert.strictEqual(toolResultNames[1], 'read_file');
        assert.strictEqual(parts.some((part: any) => part.type === 'task_complete'), true);
    });

    test('runs finite command tool batches concurrently', async () => {
        const parsingSupport = new CleanSlateAgentParsingSupport({
            getConfiguration: () => ({ planMode: false, reasoningLevel: 'low' })
        } as any);

        let chatCalls = 0;
        let runningCommands = 0;
        let maxRunningCommands = 0;
        const runner = new CleanSlateQueryRunner({
            cleanSlateService: {
                chat: async () => (async function* () {
                    chatCalls++;
                    if (chatCalls === 1) {
                        yield {
                            type: 'tool_call',
                            call: {
                                toolName: 'execute_command',
								input: { command: 'slow-check', reason: 'slow verification', intent: 'diagnostic', writesToWorkspace: false, delay: 25 }
                            }
                        };
                        yield {
                            type: 'tool_call',
                            call: {
                                toolName: 'execute_command',
								input: { command: 'fast-check', reason: 'fast verification', intent: 'diagnostic', writesToWorkspace: false, delay: 1 }
                            }
						};
						return;
					}
					yield {
						type: 'text',
						content: 'Finished after parallel command checks.'
					};
                })()
            },
            cleanSlateContextService: {
                getContext: async () => ({
                    activeFile: { languageId: 'typescript' },
                    openFiles: []
                })
            },
            buildPromptContext: async () => 'Prompt Context',
            getCurrentAgentDefinition: () => undefined,
            parsingSupport,
            executionSupport: {
                createMarkerBaseline: () => new Map(),
                collectNewMarkerIssues: async () => [],
                trackTouchedPaths: () => { },
                didToolSucceed: () => true,
                isConfirmedMutationResult: () => false
            },
            executeTool: async function* (toolName: string, input: any) {
                assert.strictEqual(toolName, 'execute_command');
                runningCommands++;
                maxRunningCommands = Math.max(maxRunningCommands, runningCommands);
                await new Promise(resolve => setTimeout(resolve, input.delay));
                runningCommands--;
                yield {
                    type: 'tool_result',
                    toolName,
                    result: { success: true, command: input.command }
                };
            },
            toolContext: { configService: { getConfiguration: () => ({}) } } as any,
            recentFocusLines: new Map(),
            referenceBuffer: new Map(),
            checkCrossFileReferences: async () => [],
            getToolCategory: () => undefined
        } as any);

        const threadService = new CleanSlateThreadService();
        const taskSessionService = new CleanSlateTaskSessionService();
        taskSessionService.setPhase(AgentPhase.EXECUTION);

        const parts = [];
        for await (const part of runner.run(
            [
                { role: 'system', content: 'placeholder' },
                { role: 'user', content: '[CONTEXT]\nplaceholder' }
            ] as any,
            'Run checks quickly',
            'Execution',
            { activeFile: { languageId: 'typescript' } },
            '',
            threadService,
            taskSessionService
        )) {
            parts.push(part);
        }

        const commandResults = parts
            .filter((part: any) => part.type === 'tool_result' && part.toolName === 'execute_command')
            .map((part: any) => part.result.command);

        assert.strictEqual(maxRunningCommands, 2);
        assert.deepStrictEqual(commandResults, ['fast-check', 'slow-check']);
        assert.strictEqual(parts.some((part: any) => part.type === 'task_complete'), true);
    });

    test('streams command start before command completion after model stream ends', async () => {
        const parsingSupport = new CleanSlateAgentParsingSupport({
            getConfiguration: () => ({ planMode: false, reasoningLevel: 'low' })
        } as any);

        let chatCalls = 0;
        let commandCompletedAt = 0;
        let sawCommandStartBeforeCompletion = false;
        const runner = new CleanSlateQueryRunner({
            cleanSlateService: {
                chat: async () => (async function* () {
                    chatCalls++;
                    if (chatCalls === 1) {
                        yield {
                            type: 'tool_call',
                            call: {
                                toolName: 'execute_command',
                                input: {
                                    command: 'npm run lint',
                                    reason: 'Run the lint script as requested',
                                    intent: 'user_requested',
                                    writesToWorkspace: false
                                }
                            }
                        };
                        return;
                    }
                    yield { type: 'text', content: 'Finished after lint.' };
                })()
            },
            cleanSlateContextService: {
                getContext: async () => ({
                    activeFile: { languageId: 'typescript' },
                    openFiles: []
                })
            },
            buildPromptContext: async () => 'Prompt Context',
            getCurrentAgentDefinition: () => undefined,
            parsingSupport,
            executionSupport: {
                createMarkerBaseline: () => new Map(),
                collectNewMarkerIssues: async () => [],
                trackTouchedPaths: () => { },
                didToolSucceed: () => true,
                isConfirmedMutationResult: () => false
            },
            executeTool: async function* (toolName: string, input: any) {
                yield {
                    type: 'tool_start',
                    toolName,
                    input
                };
                await new Promise(resolve => setTimeout(resolve, 25));
                commandCompletedAt = Date.now();
                yield {
                    type: 'tool_result',
                    toolName,
                    result: { success: true, command: input.command }
                };
            },
            toolContext: { configService: { getConfiguration: () => ({}) } } as any,
            recentFocusLines: new Map(),
            referenceBuffer: new Map(),
            checkCrossFileReferences: async () => [],
            getToolCategory: () => undefined
        } as any);

        const threadService = new CleanSlateThreadService();
        const taskSessionService = new CleanSlateTaskSessionService();
        taskSessionService.setPhase(AgentPhase.EXECUTION);

        const parts = [];
        for await (const part of runner.run(
            [
                { role: 'system', content: 'placeholder' },
                { role: 'user', content: '[CONTEXT]\nplaceholder' }
            ] as any,
            'Run npm run lint',
            'Execution',
            { activeFile: { languageId: 'typescript' } },
            '',
            threadService,
            taskSessionService
        )) {
            parts.push(part);
            if ((part as any).type === 'tool_start' && (part as any).toolName === 'execute_command') {
                sawCommandStartBeforeCompletion = commandCompletedAt === 0;
            }
        }

        assert.strictEqual(sawCommandStartBeforeCompletion, true);
        assert.strictEqual(parts.some((part: any) => part.type === 'tool_result' && part.toolName === 'execute_command'), true);
        assert.strictEqual(parts.some((part: any) => part.type === 'task_complete'), true);
    });

    test('starts native streamed tool calls before the model stream finishes', async () => {
        const parsingSupport = new CleanSlateAgentParsingSupport({
            getConfiguration: () => ({ planMode: false, reasoningLevel: 'low' })
        } as any);

        let chatCalls = 0;
        let toolStartedAt = 0;
        let streamFinishedAt = 0;
        const runner = new CleanSlateQueryRunner({
            cleanSlateService: {
                chat: async () => (async function* () {
                    chatCalls++;
                    if (chatCalls === 1) {
                        yield {
                            type: 'tool_call',
                            call: {
                                toolName: 'read_file',
                                input: { path: 'streamed.ts' }
                            }
                        };
                        await new Promise(resolve => setTimeout(resolve, 25));
                        streamFinishedAt = Date.now();
                        yield { type: 'text', content: 'Inspecting streamed file.' };
                        return;
                    }
                    yield { type: 'text', content: 'Finished after streamed discovery.' };
                })()
            },
            cleanSlateContextService: {
                getContext: async () => ({
                    activeFile: { languageId: 'typescript' },
                    openFiles: []
                })
            },
            buildPromptContext: async () => 'Prompt Context',
            getCurrentAgentDefinition: () => undefined,
            parsingSupport,
            executionSupport: {
                createMarkerBaseline: () => new Map(),
                collectNewMarkerIssues: async () => [],
                trackTouchedPaths: () => { },
                didToolSucceed: () => true,
                isConfirmedMutationResult: () => false
            },
            executeTool: async function* (toolName: string) {
                toolStartedAt = Date.now();
                yield {
                    type: 'tool_result',
                    toolName,
                    result: { success: true, toolName }
                };
            },
            toolContext: { configService: { getConfiguration: () => ({}) } } as any,
            recentFocusLines: new Map(),
            referenceBuffer: new Map(),
            checkCrossFileReferences: async () => [],
            getToolCategory: (toolName: string) => toolName === 'read_file' ? 'discovery' : undefined
        } as any);

        const threadService = new CleanSlateThreadService();
        const taskSessionService = new CleanSlateTaskSessionService();
        taskSessionService.setPhase(AgentPhase.EXECUTION);

        const parts = [];
        for await (const part of runner.run(
            [
                { role: 'system', content: 'placeholder' },
                { role: 'user', content: '[CONTEXT]\nplaceholder' }
            ] as any,
            'Read quickly',
            'Execution',
            { activeFile: { languageId: 'typescript' } },
            '',
            threadService,
            taskSessionService
        )) {
            parts.push(part);
        }

        assert.strictEqual(toolStartedAt > 0, true);
        assert.strictEqual(streamFinishedAt > 0, true);
        assert.strictEqual(toolStartedAt < streamFinishedAt, true);
        assert.strictEqual(parts.some((part: any) => part.type === 'tool_result' && part.toolName === 'read_file'), true);
        assert.strictEqual(
            parts.findIndex((part: any) => part.type === 'tool_result' && part.toolName === 'read_file') <
            parts.findIndex((part: any) => part.type === 'assistant_turn_complete'),
            true
        );
    });

    test('normal mode exposes the full enabled tool registry for a short imperative request', async () => {
        const parsingSupport = new CleanSlateAgentParsingSupport({
            getConfiguration: () => ({ planMode: false, reasoningLevel: 'low' })
        } as any);

        let receivedToolNames: string[] = [];
        let chatCalls = 0;
        const runner = new CleanSlateQueryRunner({
            cleanSlateService: {
                chat: async (_messages: any[], options: any) => (async function* () {
                    chatCalls++;
                    receivedToolNames = options.tools.map((tool: any) => tool.name);
					if (chatCalls === 1) {
						yield {
							type: 'tool_call',
							call: {
								toolName: 'read_file',
								input: { path: 'current.ts' }
							}
						};
						return;
					}
					yield {
						type: 'text',
						content: 'Finished after registered native tool discovery.'
					};
                })()
            },
            cleanSlateContextService: {
                getContext: async () => ({
                    activeFile: { languageId: 'typescript' },
                    openFiles: []
                })
            },
            buildPromptContext: async () => 'Prompt Context',
            getCurrentAgentDefinition: () => undefined,
            parsingSupport,
            executionSupport: {
                createMarkerBaseline: () => new Map(),
                collectNewMarkerIssues: async () => [],
                trackTouchedPaths: () => { },
                didToolSucceed: () => true,
                isConfirmedMutationResult: () => false
            },
            executeTool: async function* (toolName: string) {
                yield {
                    type: 'tool_result',
                    toolName,
                    result: { success: true }
                };
            },
            toolContext: { configService: { getConfiguration: () => ({}) } } as any,
            recentFocusLines: new Map(),
            referenceBuffer: new Map(),
            checkCrossFileReferences: async () => [],
            getToolCategory: (toolName: string) => toolName === 'read_file' ? 'discovery' : undefined
        } as any);

        const threadService = new CleanSlateThreadService();
        const taskSessionService = new CleanSlateTaskSessionService();
        taskSessionService.setPhase(AgentPhase.EXECUTION);

        const parts = [];
        for await (const part of runner.run(
            [
                { role: 'system', content: 'placeholder' },
                { role: 'user', content: '[CONTEXT]\nplaceholder' }
            ] as any,
			'improve ux',
            'Execution',
            { activeFile: { languageId: 'typescript' } },
            '',
            threadService,
            taskSessionService
        )) {
            parts.push(part);
        }

        assert.strictEqual(receivedToolNames.includes('read_file'), true);
        assert.strictEqual(receivedToolNames.includes('apply_edit'), true);
		assert.strictEqual(receivedToolNames.includes('finish_task'), false);
		assert.strictEqual(receivedToolNames.some(toolName => toolName.startsWith('browser_')), true);
        assert.strictEqual(parts.some((part: any) => part.type === 'task_complete'), true);
    });

    test('keeps the full tool profile available across repeated diagnostics turns', async () => {
        const parsingSupport = new CleanSlateAgentParsingSupport({
            getConfiguration: () => ({ planMode: false, reasoningLevel: 'low' })
        } as any);

        let chatCalls = 0;
        const toolNamesByTurn: string[][] = [];
        const executedTools: string[] = [];
        const targetPath = 'src/app/globals.css';
        const runner = new CleanSlateQueryRunner({
            cleanSlateService: {
                chat: async (_messages: any[], options: any) => (async function* () {
                    chatCalls++;
                    const toolNames = (options?.tools ?? []).map((tool: any) => tool.name);
                    toolNamesByTurn.push(toolNames);

					if (chatCalls > 3) {
						yield { type: 'text', content: 'Dark mode implementation is complete and linted.' };
                        return;
                    }

                    // A self-directed model: two diagnostics turns, then it
                    // moves to implementation on its own (no host suppression).
                    if (chatCalls <= 2 && toolNames.includes('read_lints')) {
                        yield {
                            type: 'tool_call',
                            call: {
                                toolName: 'read_lints',
                                input: { paths: [targetPath] }
                            }
                        };
                        return;
                    }

                    yield {
                        type: 'tool_call',
                        call: {
                            toolName: 'apply_edit',
                            input: {
                                file_path: targetPath,
                                old_string: ':root { color: black; }',
                                new_string: ':root { color: white; }'
                            }
                        }
                    };
                })()
            },
            cleanSlateContextService: {
                getContext: async () => ({
                    activeFile: { languageId: 'css' },
                    openFiles: []
                })
            },
            buildPromptContext: async () => 'Prompt Context',
            getCurrentAgentDefinition: () => undefined,
            parsingSupport,
            executionSupport: {
                createMarkerBaseline: () => new Map(),
                collectNewMarkerIssues: async () => [],
                trackTouchedPaths: (_toolName: string, input: any, result: any, touchedPaths: Set<string>) => {
                    for (const path of [input?.file_path, input?.path, result?.path, ...(Array.isArray(input?.paths) ? input.paths : [])]) {
                        if (typeof path === 'string') {
                            touchedPaths.add(path);
                        }
                    }
                },
                didToolSucceed: (result: any) => result?.success !== false,
                isConfirmedMutationResult: (toolName: string, _input: any, result: any) => toolName === 'apply_edit' && result?.success === true
            },
            executeTool: async function* (toolName: string) {
                executedTools.push(toolName);
                if (toolName === 'read_file_range') {
                    yield {
                        type: 'tool_result',
                        toolName,
                        result: {
                            success: true,
                            path: targetPath,
                            content: ':root { color: white; }',
                            startLine: 1,
                            endLine: 4,
                            currentVersionId: 1
                        }
                    };
                    return;
                }
                if (toolName === 'apply_edit') {
                    yield {
                        type: 'tool_result',
                        toolName,
                        result: {
                            success: true,
                            path: targetPath,
                            appliedBlocks: 1,
                            changes: [{ lines: '1-2' }],
                            added: 1,
                            deleted: 1,
                            message: 'Applied 1 edit.'
                        }
                    };
                    return;
                }
                yield {
                    type: 'tool_result',
                    toolName,
                    result: {
                        success: true,
                        scopedPaths: [targetPath],
                        errors: [],
                        message: `No lints found in ${targetPath}.`
                    }
                };
            },
            toolContext: { configService: { getConfiguration: () => ({}) } } as any,
            recentFocusLines: new Map(),
            referenceBuffer: new Map(),
            checkCrossFileReferences: async () => [],
            getToolCategory: (toolName: string) => toolName === 'read_lints' || toolName === 'read_file_range' ? 'discovery' : undefined
        } as any);

        const threadService = new CleanSlateThreadService();
        const taskSessionService = new CleanSlateTaskSessionService();
        taskSessionService.setPhase(AgentPhase.EXECUTION);

        const parts = [];
        for await (const part of runner.run(
            [
                { role: 'system', content: 'placeholder' },
                { role: 'user', content: '[CONTEXT]\nplaceholder' }
            ] as any,
            'Implement dark mode',
            'Execution',
            { activeFile: { languageId: 'css' } },
            '',
            threadService,
            taskSessionService
        )) {
            parts.push(part);
        }

        // There is no host-side
        // discovery suppression — research tools stay available every turn and
        // the model decides when it has read enough.
        for (const toolNames of toolNamesByTurn) {
            assert.strictEqual(toolNames.includes('read_lints'), true, 'discovery tools must never be suppressed from the tool list');
        }
        assert.strictEqual(parts.some((part: any) => part.type === 'task_complete'), true);
    });

    test('host-finalizes verified work from the provider final answer', async () => {
        const parsingSupport = new CleanSlateAgentParsingSupport({
            getConfiguration: () => ({ planMode: false, reasoningLevel: 'low' })
        } as any);

        let chatCalls = 0;
        const requiredToolNames: Array<string | undefined> = [];
        const providerMessagesByCall: any[][] = [];
        const executedTools: string[] = [];
        let visibleText = '';
        const reasoningBlocks: string[] = [];
        let currentReasoning = '';
        const layoutPath = 'src/app/layout.tsx';
        const globalsPath = 'src/app/globals.css';
        const runner = new CleanSlateQueryRunner({
            cleanSlateService: {
                chat: async (messages: any[], options: any) => (async function* () {
                    chatCalls++;
                    providerMessagesByCall.push(messages);
                    requiredToolNames.push(options?.requiredToolName);
                    if (chatCalls === 1) {
                        yield {
                            type: 'tool_call',
                            call: {
                                toolName: 'apply_edit',
                                input: {
                                    file_path: layoutPath,
                                    old_string: 'export default function Layout() {}',
                                    new_string: 'export default function Layout() { return null; }'
                                }
                            }
                        };
                        return;
                    }
                    if (chatCalls === 2) {
                        yield {
                            type: 'text',
                            content: 'Updating the shared theme tokens.\n\n'
                        };
                        yield {
                            type: 'tool_call',
                            call: {
                                toolName: 'apply_edit',
                                input: {
                                    file_path: globalsPath,
                                    old_string: ':root { color: black; }',
                                    new_string: ':root { color: white; }'
                                }
                            }
                        };
                        return;
                    }
                    if (chatCalls === 3) {
                        yield {
                            type: 'text',
                            content: 'Dark mode is fully implemented and verified.'
                        };
                        return;
                    }
                    yield {
                        type: 'text',
                        content: 'Dark mode implementation is complete and verified.'
                    };
                })()
            },
            cleanSlateContextService: {
                getContext: async () => ({
                    activeFile: { languageId: 'typescriptreact' },
                    openFiles: []
                })
            },
            buildPromptContext: async () => 'Prompt Context',
            getCurrentAgentDefinition: () => undefined,
            parsingSupport,
            executionSupport: {
                createMarkerBaseline: () => new Map(),
                collectNewMarkerIssues: async () => [],
                trackTouchedPaths: (_toolName: string, input: any, result: any, touchedPaths: Set<string>) => {
                    for (const path of [input?.path, result?.path]) {
                        if (typeof path === 'string') {
                            touchedPaths.add(path);
                        }
                    }
                },
                didToolSucceed: (result: any) => result?.success !== false,
                isConfirmedMutationResult: (toolName: string, _input: any, result: any) => toolName === 'apply_edit' && result?.success === true
            },
            executeTool: async function* (toolName: string, input: any) {
                executedTools.push(toolName);
                if (toolName === 'read_file_range') {
                    yield {
                        type: 'tool_result',
                        toolName,
                        result: {
                            success: true,
                            path: input.file_path ?? input.path,
                            content: 'current content',
                            startLine: input.startLine,
                            endLine: input.endLine,
                            currentVersionId: 1
                        }
                    };
                    return;
                }
                if (toolName === 'apply_edit') {
                    yield {
                        type: 'tool_result',
                        toolName,
                        result: {
                            success: true,
                            path: input.file_path ?? input.path,
                            appliedBlocks: 1,
                            changes: [{ lines: '1-2' }],
                            added: 1,
                            deleted: 1,
                            message: 'Applied 1 edit.'
                        }
                    };
                    return;
                }
                yield {
                    type: 'tool_result',
                    toolName,
                    result: {
                        success: true,
                        scopedPaths: [layoutPath, globalsPath],
                        errors: [],
                        message: 'No lints found.'
                    }
                };
            },
            toolContext: { configService: { getConfiguration: () => ({}) } } as any,
            recentFocusLines: new Map(),
            referenceBuffer: new Map(),
            checkCrossFileReferences: async () => [],
            getToolCategory: (toolName: string) => toolName === 'read_lints' || toolName === 'read_file_range' ? 'discovery' : undefined
        } as any);

        const threadService = new CleanSlateThreadService();
        const taskSessionService = new CleanSlateTaskSessionService();
        taskSessionService.setPhase(AgentPhase.EXECUTION);

        const parts = [];
        for await (const part of runner.run(
            [
                { role: 'system', content: 'placeholder' },
                { role: 'user', content: '[CONTEXT]\nplaceholder' }
            ] as any,
            'Implement dark mode',
            'Execution',
            { activeFile: { languageId: 'typescriptreact' } },
            '',
            threadService,
            taskSessionService
        )) {
            parts.push(part);
            if (part.type === 'assistant_turn_start') {
                if (currentReasoning.trim().length > 0) {
                    reasoningBlocks.push(currentReasoning);
                }
                currentReasoning = '';
            }
            if (part.type === 'chat_text') {
                visibleText += part.content;
            }
            if (part.type === 'chat_text_reset') {
                visibleText = '';
            }
            if (part.type === 'reasoning') {
                currentReasoning += part.content;
            }
            if (part.type === 'reasoning_reset') {
                currentReasoning = '';
            }
        }
        if (currentReasoning.trim().length > 0) {
            reasoningBlocks.push(currentReasoning);
        }

        // Refs stop semantics: the turn-3 prose answer IS the stop — the host
        // finalizes from it directly; no completion tool is demanded.
        assert.deepStrictEqual(requiredToolNames, [undefined, undefined, undefined]);
        assert.strictEqual(chatCalls, 3);
        // Assistant text blocks that share a tool-use turn are preserved,
        // along with the assistant message and its phase.
        assert.deepStrictEqual(reasoningBlocks, []);
        assert.strictEqual(visibleText, 'Updating the shared theme tokens.\n\nDark mode is fully implemented and verified.');
        assert.strictEqual(JSON.stringify(providerMessagesByCall[2] ?? []).includes('Updating the shared theme tokens.'), true);
        assert.strictEqual(executedTools.filter(toolName => toolName === 'apply_edit').length, 2);
        const finishPart = parts.find((part: any) => part.type === 'task_complete') as any;
        assert.ok(finishPart);
        assert.strictEqual(finishPart.result?.completionSource, 'host_finalized');
        assert.strictEqual(finishPart.result?.completionState?.completionSource, 'host_finalized');
    });

    test('leaves a natural prose stop interrupted when final marker verification finds issues', async () => {
        const parsingSupport = new CleanSlateAgentParsingSupport({
            getConfiguration: () => ({ planMode: false, reasoningLevel: 'low' })
        } as any);

        let chatCalls = 0;
        let markerChecks = 0;
        const requiredToolNames: Array<string | undefined> = [];
        const executedTools: string[] = [];
        const targetPath = 'src/app/globals.css';
        const runner = new CleanSlateQueryRunner({
            cleanSlateService: {
                chat: async (_messages: any[], options: any) => (async function* () {
                    chatCalls++;
                    requiredToolNames.push(options?.requiredToolName);
                    if (chatCalls === 1) {
                        yield {
                            type: 'tool_call',
                            call: {
                                toolName: 'apply_edit',
                                input: {
                                    file_path: targetPath,
                                    old_string: ':root { color: black; }',
                                    new_string: ':root { color: white; }'
                                }
                            }
                        };
                        return;
                    }
                    if (chatCalls === 2) {
                        yield {
                            type: 'text',
                            content: 'Styles are updated and verified.'
                        };
                        return;
                    }
                    yield { type: 'text', content: 'Styles are updated and verified.' };
                })()
            },
            cleanSlateContextService: {
                getContext: async () => ({
                    activeFile: { languageId: 'css' },
                    openFiles: []
                })
            },
            buildPromptContext: async () => 'Prompt Context',
            getCurrentAgentDefinition: () => undefined,
            parsingSupport,
            executionSupport: {
                createMarkerBaseline: () => new Map(),
                collectNewMarkerIssues: async () => {
                    markerChecks++;
                    return markerChecks <= 1 ? [] : [`${targetPath}:1: color token is invalid`];
                },
                trackTouchedPaths: (_toolName: string, input: any, result: any, touchedPaths: Set<string>) => {
                    for (const path of [input?.path, result?.path]) {
                        if (typeof path === 'string') {
                            touchedPaths.add(path);
                        }
                    }
                },
                didToolSucceed: (result: any) => result?.success !== false,
                isConfirmedMutationResult: (toolName: string, _input: any, result: any) => toolName === 'apply_edit' && result?.success === true
            },
            executeTool: async function* (toolName: string, input: any) {
                executedTools.push(toolName);
                if (toolName === 'read_file_range') {
                    yield {
                        type: 'tool_result',
                        toolName,
                        result: {
                            success: true,
                            path: input.file_path ?? input.path,
                            content: 'current content',
                            startLine: input.startLine,
                            endLine: input.endLine,
                            currentVersionId: 1
                        }
                    };
                    return;
                }
                if (toolName === 'apply_edit') {
                    yield {
                        type: 'tool_result',
                        toolName,
                        result: {
                            success: true,
                            path: input.file_path ?? input.path,
                            appliedBlocks: 1,
                            changes: [{ lines: '1-2' }],
                            added: 1,
                            deleted: 1,
                            message: 'Applied 1 edit.'
                        }
                    };
                    return;
                }
                yield {
                    type: 'tool_result',
                    toolName,
                    result: {
                        success: true,
                        scopedPaths: [targetPath],
                        errors: [],
                        message: 'No lints found.'
                    }
                };
            },
            toolContext: { configService: { getConfiguration: () => ({}) } } as any,
            recentFocusLines: new Map(),
            referenceBuffer: new Map(),
            checkCrossFileReferences: async () => [],
            getToolCategory: (toolName: string) => toolName === 'read_lints' || toolName === 'read_file_range' ? 'discovery' : undefined
        } as any);

        const threadService = new CleanSlateThreadService();
        const taskSessionService = new CleanSlateTaskSessionService();
        taskSessionService.setPhase(AgentPhase.EXECUTION);

        const parts = [];
        for await (const part of runner.run(
            [
                { role: 'system', content: 'placeholder' },
                { role: 'user', content: '[CONTEXT]\nplaceholder' }
            ] as any,
            'Implement dark mode styles',
            'Execution',
            { activeFile: { languageId: 'css' } },
            '',
            threadService,
            taskSessionService
        )) {
            parts.push(part);
        }

        assert.strictEqual(requiredToolNames[1], undefined);
        assert.strictEqual(requiredToolNames.length, 2);
        assert.strictEqual(parts.some((part: any) => part.type === 'task_complete'), false);
        assert.strictEqual(parts.some((part: any) => part.type === 'tool_result' && part.result?.completionSource === 'host_finalized'), false);
        assert.strictEqual(taskSessionService.getStatus(), 'INTERRUPTED');
        assert.strictEqual(executedTools.includes('apply_edit'), true);
    });

    test('keeps own writes current and verifies without host-injected readbacks', async () => {
        const parsingSupport = new CleanSlateAgentParsingSupport({
            getConfiguration: () => ({ planMode: false, reasoningLevel: 'low' })
        } as any);

        let chatCalls = 0;
        let applyAttempts = 0;
        const executedTools: string[] = [];
        const requiredToolNames: Array<string | undefined> = [];
        const targetPath = 'src/components/Footer.module.css';
        const runner = new CleanSlateQueryRunner({
            cleanSlateService: {
                chat: async (_messages: any[], options: any) => (async function* () {
                    chatCalls++;
                    requiredToolNames.push(options?.requiredToolName);
                    if (chatCalls === 3) {
                        yield {
                            type: 'text',
                            content: 'The edit is already in place and verification passed.'
                        };
                        return;
                    }
                    if (chatCalls > 3) {
                        yield { type: 'text', content: 'Footer dark mode is already current and verified.' };
                        return;
                    }
                    yield {
                        type: 'tool_call',
                        call: {
                            toolName: 'apply_edit',
                            input: {
                                file_path: targetPath,
                                old_string: '.footer { color: black; }',
                                new_string: '.footer { color: white; }'
                            }
                        }
                    };
                })()
            },
            cleanSlateContextService: {
                getContext: async () => ({
                    activeFile: { languageId: 'css' },
                    openFiles: []
                })
            },
            buildPromptContext: async () => 'Prompt Context',
            getCurrentAgentDefinition: () => undefined,
            parsingSupport,
            executionSupport: {
                createMarkerBaseline: () => new Map(),
                collectNewMarkerIssues: async () => [],
                trackTouchedPaths: (_toolName: string, _input: any, result: any, touchedPaths: Set<string>) => {
                    if (typeof result?.path === 'string') {
                        touchedPaths.add(result.path);
                    }
                },
                didToolSucceed: (result: any) => result?.success !== false,
                isConfirmedMutationResult: () => false
            },
            executeTool: async function* (toolName: string) {
                executedTools.push(toolName);
                if (toolName === 'apply_edit') {
                    applyAttempts++;
                    if (applyAttempts === 1) {
                        yield {
                            type: 'tool_result',
                            toolName,
                            result: {
                                success: false,
                                code: 'no_match',
                                path: targetPath,
                                message: 'String to replace not found in file.'
                            }
                        };
                        return;
                    }
                    yield {
                        type: 'tool_result',
                        toolName,
                        result: {
                            success: true,
                            code: 'no_op',
                            path: targetPath,
                            appliedBlocks: 0,
                            message: `NO_OP: The file content already matches the target for ${targetPath}. No changes were necessary.`
                        }
                    };
                    return;
                }
                if (toolName === 'read_file_range') {
                    yield {
                        type: 'tool_result',
                        toolName,
                        result: {
                            success: true,
                            path: targetPath,
                            content: '.footer { color: white; }',
                            startLine: 84,
                            endLine: 98,
                            currentVersionId: 2
                        }
                    };
                    return;
                }
                yield {
                    type: 'tool_result',
                    toolName,
                    result: {
                        success: true,
                        scopedPaths: [targetPath],
                        errors: [],
                        message: `No lints found in ${targetPath}.`
                    }
                };
            },
            toolContext: { configService: { getConfiguration: () => ({}) } } as any,
            recentFocusLines: new Map(),
            referenceBuffer: new Map(),
            checkCrossFileReferences: async () => [],
            getToolCategory: (toolName: string) => toolName === 'read_lints' ? 'discovery' : undefined
        } as any);

        const threadService = new CleanSlateThreadService();
        const taskSessionService = new CleanSlateTaskSessionService();
        taskSessionService.setPhase(AgentPhase.EXECUTION);

        const parts = [];
        for await (const part of runner.run(
            [
                { role: 'system', content: 'placeholder' },
                { role: 'user', content: '[CONTEXT]\nplaceholder' }
            ] as any,
            'Fix footer dark mode',
            'Execution',
            { activeFile: { languageId: 'css' } },
            '',
            threadService,
            taskSessionService
        )) {
            parts.push(part);
        }

        assert.deepStrictEqual(executedTools, ['apply_edit', 'apply_edit', 'read_lints']);
        assert.strictEqual(chatCalls, 3);
        assert.strictEqual(requiredToolNames[2], undefined);
        assert.strictEqual(applyAttempts, 2);
        assert.strictEqual(parts.some((part: any) => part.type === 'task_complete'), true);
        assert.strictEqual(executedTools.includes('read_lints'), true);
    });

    test('recovers an ambiguous exact replacement with a more contextual old_string', async () => {
        const parsingSupport = new CleanSlateAgentParsingSupport({
            getConfiguration: () => ({ planMode: false, reasoningLevel: 'low' })
        } as any);

        let chatCalls = 0;
        let applyExecutions = 0;
        const targetPath = 'lib/screens/tasks_screen.dart';
        const makeEdit = (retry: boolean) => ({
            file_path: targetPath,
            old_string: retry
                ? 'Column(children: [\n  const Text("duplicate");\n])'
                : 'const Text("duplicate");',
            new_string: 'const Text("updated");'
        });

        const runner = new CleanSlateQueryRunner({
            cleanSlateService: {
                chat: async () => (async function* () {
                    chatCalls++;
                    if (chatCalls > 2) {
                        yield { type: 'text', content: 'Updated the intended task widget.' };
                        return;
                    }
                    yield {
                        type: 'tool_call',
                        call: {
                            toolName: 'apply_edit',
                            input: makeEdit(chatCalls === 2)
                        }
                    };
                })()
            },
            cleanSlateContextService: {
                getContext: async () => ({ activeFile: { languageId: 'dart' }, openFiles: [] })
            },
            buildPromptContext: async () => 'Prompt Context',
            getCurrentAgentDefinition: () => undefined,
            parsingSupport,
            executionSupport: {
                createMarkerBaseline: () => new Map(),
                collectNewMarkerIssues: async () => [],
                trackTouchedPaths: () => undefined,
                didToolSucceed: (result: any) => result?.success !== false,
                isConfirmedMutationResult: () => false
            },
            executeTool: async function* (toolName: string, input: any) {
                if (toolName === 'read_file_range') {
                    yield {
                        type: 'tool_result',
                        toolName,
                        result: {
                            success: true,
                            path: input.file_path ?? input.path,
                            content: 'const Text("duplicate");',
                            range: { startLine: input.startLine, endLine: input.endLine },
                            currentVersionId: 4
                        }
                    };
                    return;
                }
                if (toolName !== 'apply_edit') {
                    yield { type: 'tool_result', toolName, result: { success: true } };
                    return;
                }
                applyExecutions++;
                if (applyExecutions > 1) {
                    yield {
                        type: 'tool_result',
                        toolName,
                        result: { success: true, path: targetPath, appliedBlocks: 1 }
                    };
                    return;
                }
                yield {
                    type: 'tool_result',
                    toolName,
                    result: {
                        success: false,
                        path: targetPath,
                        code: 'ambiguous_match',
                        matchCount: 2,
                        message: 'Found 2 matches of old_string.'
                    }
                };
            },
            toolContext: { configService: { getConfiguration: () => ({}) } } as any,
            recentFocusLines: new Map(),
            referenceBuffer: new Map(),
            checkCrossFileReferences: async () => [],
            getToolCategory: (toolName: string) => toolName === 'read_file_range' ? 'discovery' : 'mutation'
        } as any);

        const threadService = new CleanSlateThreadService();
        const taskSessionService = new CleanSlateTaskSessionService();
        taskSessionService.setPhase(AgentPhase.EXECUTION);

        const parts: any[] = [];
        for await (const part of runner.run(
            [{ role: 'system', content: 'placeholder' }, { role: 'user', content: '[CONTEXT]\nplaceholder' }] as any,
            'Update duplicate task widgets',
            'Execution',
            { activeFile: { languageId: 'dart' } },
            '',
            threadService,
            taskSessionService
        )) {
            parts.push(part);
        }

        assert.strictEqual(applyExecutions, 2);
		assert.ok(chatCalls >= 3);
		assert.strictEqual(parts.some(part => part.type === 'tool_result' && part.toolName === 'apply_edit' && part.result?.success === true), true);
    });

    test('uses read_lints instead of a terminal command before host completion after edits', async () => {
        const parsingSupport = new CleanSlateAgentParsingSupport({
            getConfiguration: () => ({
                executionFlow: 'normal',
                verificationCommands: ['npm run lint']
            })
        } as any);

        let chatCalls = 0;
        const executedTools: string[] = [];
        const readLintInputs: any[] = [];
        const targetPath = 'src/app/page.tsx';
        const runner = new CleanSlateQueryRunner({
            cleanSlateService: {
                chat: async () => (async function* () {
                    chatCalls++;
                    if (chatCalls === 1) {
                        yield {
                            type: 'tool_call',
                            call: {
                                toolName: 'apply_edit',
                                input: {
                                    file_path: targetPath,
                                    old_string: 'export default function Page() {}',
                                    new_string: 'export default function Page() { return null; }'
                                }
                            }
                        };
                        return;
                    }
                    yield { type: 'text', content: 'Page edit is complete and linted.' };
                })()
            },
            cleanSlateContextService: {
                getContext: async () => ({
                    activeFile: { languageId: 'typescriptreact' },
                    openFiles: []
                })
            },
            buildPromptContext: async () => 'Prompt Context',
            getCurrentAgentDefinition: () => undefined,
            parsingSupport,
            executionSupport: {
                createMarkerBaseline: () => new Map(),
                collectNewMarkerIssues: async () => [],
                trackTouchedPaths: (_toolName: string, input: any, result: any, touchedPaths: Set<string>) => {
                    for (const path of [input?.path, result?.path]) {
                        if (typeof path === 'string') {
                            touchedPaths.add(path);
                        }
                    }
                },
                didToolSucceed: (result: any) => result?.success !== false,
                isConfirmedMutationResult: (toolName: string, _input: any, result: any) => toolName === 'apply_edit' && result?.success === true
            },
            executeTool: async function* (toolName: string, input: any) {
                executedTools.push(toolName);
                if (toolName === 'read_lints') {
                    readLintInputs.push(input);
                }
                if (toolName === 'read_file_range') {
                    yield {
                        type: 'tool_result',
                        toolName,
                        result: {
                            success: true,
                            path: input.file_path ?? input.path,
                            content: 'current content',
                            startLine: input.startLine,
                            endLine: input.endLine,
                            currentVersionId: 1
                        }
                    };
                    return;
                }
                if (toolName === 'apply_edit') {
                    yield {
                        type: 'tool_result',
                        toolName,
                        result: {
                            success: true,
                            path: input.file_path ?? input.path,
                            appliedBlocks: 1,
                            changes: [{ lines: '1-3' }],
                            added: 1,
                            deleted: 1,
                            message: 'Applied 1 edit.'
                        }
                    };
                    return;
                }
                yield {
                    type: 'tool_result',
                    toolName,
                    result: {
                        success: true,
                        scopedPaths: [targetPath],
                        errors: [],
                        message: 'No lints found.'
                    }
                };
            },
            toolContext: { configService: { getConfiguration: () => ({}) } } as any,
            recentFocusLines: new Map(),
            referenceBuffer: new Map(),
            checkCrossFileReferences: async () => [],
            getToolCategory: (toolName: string) => toolName === 'read_lints' || toolName === 'read_file_range' ? 'discovery' : undefined
        } as any);

        const threadService = new CleanSlateThreadService();
        const taskSessionService = new CleanSlateTaskSessionService();
        taskSessionService.setPhase(AgentPhase.EXECUTION);

        const parts = [];
        for await (const part of runner.run(
            [
                { role: 'system', content: 'placeholder' },
                { role: 'user', content: '[CONTEXT]\nplaceholder' }
            ] as any,
            'Implement dark mode',
            'Execution',
            { activeFile: { languageId: 'typescriptreact' } },
            '',
            threadService,
            taskSessionService
        )) {
            parts.push(part);
        }

        assert.strictEqual(executedTools.includes('execute_command'), false);
        assert.strictEqual(executedTools.includes('start_background_command'), false);
        assert.strictEqual(executedTools.includes('read_lints'), true);
        assert.strictEqual(readLintInputs.some(input => Array.isArray(input?.paths) && input.paths.includes(targetPath)), true);
        assert.strictEqual(parts.some((part: any) => part.type === 'task_complete'), true);
    });

    test('does not turn model-authored todo state into a host completion gate', async () => {
        const parsingSupport = new CleanSlateAgentParsingSupport({
            getConfiguration: () => ({ planMode: false, reasoningLevel: 'low' })
        } as any);

        let chatCalls = 0;
        const runner = new CleanSlateQueryRunner({
            cleanSlateService: {
                chat: async () => (async function* () {
                    chatCalls++;
                    if (chatCalls === 1) {
                        yield {
                            type: 'tool_call',
                            call: {
                                toolName: 'update_todo',
                                input: {
                                    items: [
                                        { content: 'Inspect files', status: 'completed' },
                                        { content: 'Run lint', status: 'pending' }
                                    ]
                                }
                            }
                        };
                        return;
                    }
                    if (chatCalls === 2) {
                        yield {
                            type: 'text',
                            content: 'The requested work is complete.'
                        };
                        return;
                    }
                })()
            },
            cleanSlateContextService: {
                getContext: async () => ({
                    activeFile: { languageId: 'typescript' },
                    openFiles: []
                })
            },
            buildPromptContext: async () => 'Prompt Context',
            getCurrentAgentDefinition: () => undefined,
            parsingSupport,
            executionSupport: {
                createMarkerBaseline: () => new Map(),
                collectNewMarkerIssues: async () => [],
                trackTouchedPaths: () => { },
                didToolSucceed: (result: any) => result?.success !== false,
                isConfirmedMutationResult: () => false
            },
            executeTool: async function* (toolName: string, input: any) {
                if (toolName === 'update_todo') {
                    const toDo = input.items.map((item: any) => `${item.status === 'completed' ? '[x]' : '[ ]'} ${item.content}`);
                    yield {
                        type: 'tool_result',
                        toolName,
                        result: {
                            success: true,
                            to_do: toDo
                        }
                    };
                    return;
                }
                yield {
                    type: 'tool_result',
                    toolName,
                    result: { success: true }
                };
            },
            toolContext: { configService: { getConfiguration: () => ({}) } } as any,
            recentFocusLines: new Map(),
            referenceBuffer: new Map(),
            checkCrossFileReferences: async () => [],
            getToolCategory: () => undefined
        } as any);

        const threadService = new CleanSlateThreadService();
        const taskSessionService = new CleanSlateTaskSessionService();
        taskSessionService.setPhase(AgentPhase.EXECUTION);

        const parts = [];
        for await (const part of runner.run(
            [
                { role: 'system', content: 'placeholder' },
                { role: 'user', content: '[CONTEXT]\nplaceholder' }
            ] as any,
            'Finish with todo accountability',
            'Execution',
            { activeFile: { languageId: 'typescript' } },
            '',
            threadService,
            taskSessionService
        )) {
            parts.push(part);
        }

        assert.strictEqual(parts.some((part: any) => part.type === 'task_complete'), true);
    });

    test('allows normal-mode verification command and carries proof into completion state', async () => {
        const parsingSupport = new CleanSlateAgentParsingSupport({
            getConfiguration: () => ({ planMode: false, reasoningLevel: 'low' })
        } as any);

        let chatCalls = 0;
        const executedCommands: string[] = [];
        const runner = new CleanSlateQueryRunner({
            cleanSlateService: {
                chat: async () => (async function* () {
                    chatCalls++;
                    if (chatCalls === 1) {
                        yield {
                            type: 'tool_call',
                            call: {
                                toolName: 'read_file',
                                input: { path: 'src/router.ts' }
                            }
                        };
                        return;
                    }
                    if (chatCalls === 2) {
                        yield {
                            type: 'tool_call',
                            call: {
                                toolName: 'execute_command',
                                input: {
                                    command: 'npm test -- router',
                                    reason: 'Verify normal-mode router behavior with the focused test.',
                                    intent: 'verification',
                                    writesToWorkspace: false
                                }
                            }
                        };
                        return;
                    }
                    yield {
                        type: 'text',
                        content: 'Router behavior is implemented and the focused verification passed.'
                    };
                })()
            },
            cleanSlateContextService: {
                getContext: async () => ({
                    activeFile: { languageId: 'typescript' },
                    openFiles: []
                })
            },
            buildPromptContext: async () => 'Prompt Context',
            getCurrentAgentDefinition: () => undefined,
            parsingSupport,
            executionSupport: {
                createMarkerBaseline: () => new Map(),
                collectNewMarkerIssues: async () => [],
                trackTouchedPaths: () => { },
                didToolSucceed: (result: any) => result?.success !== false && result?.exitCode !== 1,
                isConfirmedMutationResult: () => false
            },
            executeTool: async function* (toolName: string, input: any) {
                if (toolName === 'execute_command') {
                    assert.strictEqual(input.intent, 'verification');
                    executedCommands.push(input.command);
                    yield {
                        type: 'tool_result',
                        toolName,
                        result: {
                            success: true,
                            command: input.command,
                            status: 'completed',
                            exitCode: 0,
                            output: 'router tests passed'
                        }
                    };
                    return;
                }

                yield {
                    type: 'tool_result',
                    toolName,
                    result: { success: true }
                };
            },
            toolContext: { configService: { getConfiguration: () => ({}) } } as any,
            recentFocusLines: new Map(),
            referenceBuffer: new Map(),
            checkCrossFileReferences: async () => [],
            getToolCategory: (toolName: string) => toolName === 'read_file' ? 'discovery' : undefined
        } as any);

        const threadService = new CleanSlateThreadService();
        const taskSessionService = new CleanSlateTaskSessionService();
        taskSessionService.setPhase(AgentPhase.EXECUTION);

        const parts = [];
        for await (const part of runner.run(
            [
                { role: 'system', content: 'placeholder' },
                { role: 'user', content: '[CONTEXT]\nplaceholder' }
            ] as any,
            'Implement execution-loop hardening',
            'Execution',
            { activeFile: { languageId: 'typescript' } },
            '',
            threadService,
            taskSessionService
        )) {
            parts.push(part);
        }

        const taskFinished = parts.find((part: any) => part.type === 'task_complete') as any;
        assert.deepStrictEqual(executedCommands, ['npm test -- router']);
        assert.ok(taskFinished);
        assert.strictEqual(taskFinished.result.completionState.proofSummaries.includes('"npm test -- router" succeeded (verification)'), true);
        assert.deepStrictEqual(taskFinished.result.completionSummary.proofSummaries, ['"npm test -- router" succeeded (verification)']);
    });

    test('uses the native stop contract without a second completion-auditor model loop', async () => {
        const parsingSupport = new CleanSlateAgentParsingSupport({
            getConfiguration: () => ({ planMode: false, reasoningLevel: 'low' })
        } as any);

        let chatCalls = 0;
        let auditCalls = 0;
        const auditMessages: any[][] = [];
        let visibleText = '';
        const runner = new CleanSlateQueryRunner({
            cleanSlateService: {
                chat: async (messages: any[]) => (async function* () {
                    const systemText = typeof messages?.[0]?.content === 'string' ? messages[0].content : '';
                    if (systemText.includes('CleanSlate completion auditor')) {
                        auditCalls++;
                        auditMessages.push(messages);
                        yield {
                            type: 'text',
                            content: auditCalls === 1
                                ? JSON.stringify({
                                    decision: 'revise',
                                    reason: 'The visible answer says the project was checked but does not provide the requested rating.',
                                    missing: ['project rating'],
                                    nextAction: 'Provide a clear project rating in the visible answer.'
                                })
                                : JSON.stringify({
                                    decision: 'accept',
                                    reason: 'The visible answer now provides a direct project rating.',
                                    missing: [],
                                    nextAction: ''
                                })
                        };
                        return;
                    }

                    chatCalls++;
                    if (chatCalls === 1) {
                        yield {
                            type: 'tool_call',
                            call: {
                                toolName: 'read_file',
                                input: { path: 'package.json' }
                            }
                        };
                        return;
                    }
                    if (chatCalls === 2) {
                        yield {
                            type: 'text',
                            content: 'I inspected the project structure.'
                        };
                        return;
                    }
                    yield {
                        type: 'text',
                        content: 'Project rating: 7/10. The foundations are solid, but the project still needs stronger tests and polish before I would call it production mature.'
                    };
                })(),
                getProviderCapabilities: () => ({ provider: 'openai', nativeToolCalls: true })
            } as any,
            cleanSlateContextService: {
                getContext: async () => ({
                    activeFile: { languageId: 'json' },
                    openFiles: []
                })
            },
            buildPromptContext: async () => 'Prompt Context',
            getCurrentAgentDefinition: () => undefined,
            parsingSupport,
            executionSupport: {
                createMarkerBaseline: () => new Map(),
                collectNewMarkerIssues: async () => [],
                trackTouchedPaths: () => { },
                didToolSucceed: (result: any) => result?.success !== false,
                isConfirmedMutationResult: () => false
            },
            executeTool: async function* (toolName: string) {
                yield {
                    type: 'tool_result',
                    toolName,
                    result: {
                        success: true,
                        path: 'package.json',
                        content: '{"scripts":{"test":"vitest"}}'
                    }
                };
            },
            toolContext: { configService: { getConfiguration: () => ({}) } } as any,
            recentFocusLines: new Map(),
            referenceBuffer: new Map(),
            checkCrossFileReferences: async () => [],
            getToolCategory: (toolName: string) => toolName === 'read_file' ? 'discovery' : undefined
        } as any);

        const threadService = new CleanSlateThreadService();
        const taskSessionService = new CleanSlateTaskSessionService();
        taskSessionService.setPhase(AgentPhase.EXECUTION);

        const parts = [];
        for await (const part of runner.run(
            [
                { role: 'system', content: 'placeholder' },
                { role: 'user', content: '[CONTEXT]\nplaceholder' }
            ] as any,
            'rate this project',
            'Execution',
            { activeFile: { languageId: 'json' } },
            '',
            threadService,
            taskSessionService
        )) {
            parts.push(part);
            if (part.type === 'chat_text') {
                visibleText += part.content;
            }
            if (part.type === 'chat_text_reset') {
                visibleText = '';
            }
        }

        assert.strictEqual(auditCalls, 0);
        assert.strictEqual(auditMessages.length, 0);
        assert.strictEqual(visibleText, 'I inspected the project structure.');
        assert.strictEqual(parts.some((part: any) => part.type === 'task_complete'), true);
    });

    test('keeps ordinary text visible when a discovery tool follows it', async () => {
        const parsingSupport = new CleanSlateAgentParsingSupport({
            getConfiguration: () => ({ planMode: false, reasoningLevel: 'low' })
        } as any);
        const completionSummary = 'Completed the requested route and verified scoped diagnostics.';
        let chatCalls = 0;
        let auditCalls = 0;
        let visibleText = '';
        let reasoningText = '';

        const runner = new CleanSlateQueryRunner({
            cleanSlateService: {
                chat: async (messages: any[]) => (async function* () {
                    const systemText = typeof messages?.[0]?.content === 'string' ? messages[0].content : '';
                    if (systemText.includes('CleanSlate completion auditor')) {
                        auditCalls++;
                        const payload = JSON.stringify(messages);
                        yield {
                            type: 'text',
                            content: JSON.stringify(payload.includes(completionSummary)
                                ? { decision: 'accept', reason: 'Visible answer is complete.', missing: [], nextAction: '' }
                                : { decision: 'revise', reason: 'No visible answer.', missing: ['visible answer'], nextAction: 'Write a visible answer.' })
                        };
                        return;
                    }

                    chatCalls++;
                    if (chatCalls === 1) {
                        yield {
                            type: 'tool_call',
                            call: { toolName: 'apply_edit', input: { path: 'lib/routes.dart', edits: [] } }
                        };
                        return;
                    }
                    if (chatCalls === 2) {
                        yield { type: 'tool_call', call: { toolName: 'read_file', input: { path: 'lib/routes.dart' } } };
                        return;
                    }
                    if (chatCalls === 3) {
                        yield { type: 'tool_call', call: { toolName: 'read_lints', input: { paths: ['lib/routes.dart'] } } };
                        return;
                    }
                    if (chatCalls === 4) {
                        yield { type: 'reasoning', content: 'Checking the final route diagnostics.' };
                        yield { type: 'text', content: 'Final route context checked. ' };
                        yield { type: 'tool_call', call: { toolName: 'read_file', input: { path: 'lib/routes.dart' } } };
                        return;
                    }
                    yield { type: 'text', content: completionSummary };
                })(),
                getProviderCapabilities: () => ({ provider: 'openai', nativeToolCalls: true })
            } as any,
            cleanSlateContextService: {
                getContext: async () => ({ activeFile: { languageId: 'dart' }, openFiles: [] })
            },
            buildPromptContext: async () => 'Prompt Context',
            getCurrentAgentDefinition: () => undefined,
            parsingSupport,
            executionSupport: {
                createMarkerBaseline: () => new Map(),
                collectNewMarkerIssues: async () => [],
                trackTouchedPaths: (_toolName: string, input: any, result: any, touchedPaths: Set<string>) => {
                    for (const path of [input?.path, result?.path]) {
                        if (typeof path === 'string') {
                            touchedPaths.add(path);
                        }
                    }
                },
                didToolSucceed: (result: any) => result?.success !== false,
                isConfirmedMutationResult: (toolName: string, _input: any, result: any) => toolName === 'apply_edit' && result?.success === true
            },
            executeTool: async function* (toolName: string, input: any) {
                yield {
                    type: 'tool_result',
                    toolName,
                    result: toolName === 'apply_edit'
                        ? { success: true, path: input.file_path ?? input.path, appliedBlocks: 1, changes: [{ lines: '1-1' }], added: 1, deleted: 0 }
                        : { success: true, scopedPaths: ['lib/routes.dart'], errors: [] }
                };
            },
            toolContext: { configService: { getConfiguration: () => ({}) } } as any,
            recentFocusLines: new Map(),
            referenceBuffer: new Map(),
            checkCrossFileReferences: async () => [],
            getToolCategory: (toolName: string) => toolName === 'read_lints' || toolName === 'read_file' ? 'discovery' : undefined
        } as any);

        const threadService = new CleanSlateThreadService();
        const taskSessionService = new CleanSlateTaskSessionService();
        taskSessionService.setPhase(AgentPhase.EXECUTION);
        const parts = [];
        for await (const part of runner.run(
            [{ role: 'system', content: 'placeholder' }, { role: 'user', content: '[CONTEXT]\nplaceholder' }] as any,
            'Update the route',
            'Execution',
            { activeFile: { languageId: 'dart' } },
            '',
            threadService,
            taskSessionService
        )) {
            parts.push(part);
            if (part.type === 'chat_text') {
                visibleText += part.content;
            }
            if (part.type === 'chat_text_reset') {
                visibleText = '';
            }
            if (part.type === 'reasoning') {
                reasoningText += part.content;
            }
        }

        assert.strictEqual(chatCalls, 5);
        assert.ok(auditCalls <= 1);
        assert.strictEqual(visibleText.includes('Final route context checked.'), true);
        assert.strictEqual(visibleText.includes(completionSummary), true);
        assert.strictEqual(visibleText.includes('Checking the final route diagnostics.'), false);
        assert.strictEqual(reasoningText.includes('Checking the final route diagnostics.'), true);
        assert.strictEqual(parts.some((part: any) => part.type === 'reasoning_reset'), false);
    });

    test('continues after a progress-and-tool turn, then host-completes on the final answer', async () => {
        const parsingSupport = new CleanSlateAgentParsingSupport({
            getConfiguration: () => ({ planMode: false, reasoningLevel: 'low' })
        } as any);

        let chatCalls = 0;
        const runner = new CleanSlateQueryRunner({
            cleanSlateService: {
                chat: async () => (async function* () {
                    chatCalls++;
                    if (chatCalls === 1) {
                        yield {
                            type: 'tool_call',
                            call: {
                                toolName: 'read_file',
                                input: { path: 'src/router.ts' }
                            }
                        };
                        return;
                    }
                    if (chatCalls === 2) {
                        yield {
                            type: 'text',
                            content: 'I still need to verify one acceptance item.'
                        };
                        yield {
                            type: 'tool_call',
                            call: {
                                toolName: 'read_lints',
                                input: { paths: ['src/router.ts'] }
                            }
                        };
                        return;
                    }
                    yield {
                        type: 'text',
                        content: 'Router proof is now complete.'
                    };
                })()
            },
            cleanSlateContextService: {
                getContext: async () => ({
                    activeFile: { languageId: 'typescript' },
                    openFiles: []
                })
            },
            buildPromptContext: async () => 'Prompt Context',
            getCurrentAgentDefinition: () => undefined,
            parsingSupport,
            executionSupport: {
                createMarkerBaseline: () => new Map(),
                collectNewMarkerIssues: async () => [],
                trackTouchedPaths: () => { },
                didToolSucceed: (result: any) => result?.success !== false,
                isConfirmedMutationResult: () => false
            },
            executeTool: async function* (toolName: string) {
                yield {
                    type: 'tool_result',
                    toolName,
                    result: { success: true }
                };
            },
            toolContext: { configService: { getConfiguration: () => ({}) } } as any,
            recentFocusLines: new Map(),
            referenceBuffer: new Map(),
            checkCrossFileReferences: async () => [],
            getToolCategory: (toolName: string) => toolName === 'read_file' ? 'discovery' : undefined
        } as any);

        const threadService = new CleanSlateThreadService();
        const taskSessionService = new CleanSlateTaskSessionService();
        taskSessionService.setPhase(AgentPhase.EXECUTION);

        const parts = [];
        for await (const part of runner.run(
            [
                { role: 'system', content: 'placeholder' },
                { role: 'user', content: '[CONTEXT]\nplaceholder' }
            ] as any,
            'Finish with proof',
            'Execution',
            { activeFile: { languageId: 'typescript' } },
            '',
            threadService,
            taskSessionService
        )) {
            parts.push(part);
        }

        const taskFinished = parts.find((part: any) => part.type === 'task_complete') as any;
        assert.strictEqual(chatCalls, 3);
        assert.ok(taskFinished);
        assert.strictEqual(taskFinished.result.completionState.summary, 'Router proof is now complete.');
    });

	test('does not complete from a reasoning-only stop after earlier progress and command evidence', async () => {
		const parsingSupport = new CleanSlateAgentParsingSupport({
			getConfiguration: () => ({ planMode: false, reasoningLevel: 'low' })
		} as any);

        let chatCalls = 0;
        const requiredToolNames: Array<string | undefined> = [];
        const chatTexts: string[] = [];
        const runner = new CleanSlateQueryRunner({
            cleanSlateService: {
                chat: async (_messages: any[], options: any) => (async function* () {
                    chatCalls++;
                    requiredToolNames.push(options?.requiredToolName);
                    if (chatCalls === 1) {
						yield {
							type: 'text',
							content: 'I found the selected block and am checking its lifecycle wiring.'
						};
                        yield {
                            type: 'tool_call',
                            call: {
                                toolName: 'execute_command',
                                input: {
                                    command: 'node --check script.js',
                                    intent: 'verification',
                                    writesToWorkspace: false,
                                    reason: 'Verify the generated script syntax.'
                                }
                            }
                        };
                        return;
                    }
                    if (chatCalls === 2) {
                        yield { type: 'reasoning', content: 'Deciding how to explain the lifecycle.' };
                        return;
                    }
                    yield {
                        type: 'text',
                        content: 'The selected block wires the controller into the editor lifecycle.'
                    };
                })()
            },
            cleanSlateContextService: {
                getContext: async () => ({
                    activeFile: { languageId: 'typescript' },
                    openFiles: []
                })
            },
            buildPromptContext: async () => 'Prompt Context',
            getCurrentAgentDefinition: () => undefined,
            parsingSupport,
            executionSupport: {
                createMarkerBaseline: () => new Map(),
                collectNewMarkerIssues: async () => [],
                trackTouchedPaths: () => { },
                didToolSucceed: (result: any) => result?.success !== false,
                isConfirmedMutationResult: () => false
            },
            executeTool: async function* (toolName: string, input: any) {
                yield {
                    type: 'tool_result',
                    toolName,
                    result: {
                        success: true,
                        command: input.command,
                        status: 'completed',
                        exitCode: 0
                    }
                };
            },
            toolContext: { configService: { getConfiguration: () => ({}) } } as any,
            recentFocusLines: new Map(),
            referenceBuffer: new Map(),
            checkCrossFileReferences: async () => [],
            getToolCategory: (toolName: string) => toolName === 'execute_command' ? 'execution' : 'system'
        } as any);

        const threadService = new CleanSlateThreadService();
        const taskSessionService = new CleanSlateTaskSessionService();
        taskSessionService.setPhase(AgentPhase.EXECUTION);

        const parts = [];
        for await (const part of runner.run(
            [
                { role: 'system', content: 'placeholder' },
                { role: 'user', content: '[CONTEXT]\nplaceholder' }
            ] as any,
            'Explain selected code',
            'Execution',
            { activeFile: { languageId: 'typescript' } },
            '',
            threadService,
            taskSessionService
        )) {
            parts.push(part);
            if (part.type === 'chat_text') {
                chatTexts.push(part.content);
            }
        }

        assert.strictEqual(requiredToolNames[2], undefined);
        assert.deepStrictEqual(chatTexts, [
			'I found the selected block and am checking its lifecycle wiring.',
			'The selected block wires the controller into the editor lifecycle.'
		]);
		assert.strictEqual(parts.some((part: any) => part.type === 'task_complete'), true);
	});

	test('preserves provider text in the answer lane when a tool call follows it', async () => {
		const parsingSupport = new CleanSlateAgentParsingSupport({
			getConfiguration: () => ({ planMode: false, reasoningLevel: 'low' })
		} as any);

		let chatCalls = 0;
		let visibleText = '';
		let resetCount = 0;
		// Track thinking-lane content per turn so a promote (reasoning_reset) clears
		// only the turn it belongs to, not earlier turns' thought blocks.
		const reasoningBlocks: string[] = [];
		let currentReasoning = '';
		const runner = new CleanSlateQueryRunner({
			cleanSlateService: {
				chat: async () => (async function* () {
					chatCalls++;
					if (chatCalls === 1) {
						yield {
							type: 'tool_call',
							call: {
								toolName: 'read_file_range',
								input: { path: 'src/example.ts', startLine: 1, endLine: 5 }
							}
						};
						return;
					}
					if (chatCalls === 2) {
						yield { type: 'reasoning', content: 'Checking whether another range is needed.' };
						return;
					}
					if (chatCalls === 3) {
						yield {
							type: 'text',
							content: 'Checked the remaining range. ',
							phase: 'commentary'
						};
						yield {
							type: 'text',
							content: 'Unphased provider text. '
						};
						yield {
							type: 'tool_call',
							call: {
								toolName: 'read_file_range',
								input: { path: 'src/example.ts', startLine: 6, endLine: 9 }
							}
						};
						return;
					}
					yield {
						type: 'text',
						content: 'The real answer streams after the extra read.'
					};
				})()
			},
			cleanSlateContextService: {
				getContext: async () => ({
					activeFile: { languageId: 'typescript' },
					openFiles: []
				})
			},
			buildPromptContext: async () => 'Prompt Context',
			getCurrentAgentDefinition: () => undefined,
			parsingSupport,
			executionSupport: {
				createMarkerBaseline: () => new Map(),
				collectNewMarkerIssues: async () => [],
				trackTouchedPaths: () => { },
				didToolSucceed: (result: any) => result?.success !== false,
				isConfirmedMutationResult: () => false
			},
			executeTool: async function* (toolName: string) {
				yield {
					type: 'tool_result',
					toolName,
					result: { success: true }
				};
			},
			toolContext: { configService: { getConfiguration: () => ({}) } } as any,
			recentFocusLines: new Map(),
			referenceBuffer: new Map(),
			checkCrossFileReferences: async () => [],
			getToolCategory: (toolName: string) => toolName === 'read_file_range' ? 'discovery' : 'system'
		} as any);

		const threadService = new CleanSlateThreadService();
		const taskSessionService = new CleanSlateTaskSessionService();
		taskSessionService.setPhase(AgentPhase.EXECUTION);

		const parts = [];
		for await (const part of runner.run(
			[
				{ role: 'system', content: 'placeholder' },
				{ role: 'user', content: '[CONTEXT]\nplaceholder' }
			] as any,
			'Explain selected code',
			'Execution',
			{ activeFile: { languageId: 'typescript' } },
			'',
			threadService,
			taskSessionService
		)) {
			parts.push(part);
			if (part.type === 'assistant_turn_start') {
				if (currentReasoning.trim().length > 0) {
					reasoningBlocks.push(currentReasoning);
				}
				currentReasoning = '';
			}
			if (part.type === 'chat_text') {
				visibleText += part.content;
			}
			if (part.type === 'reasoning') {
				currentReasoning += part.content;
			}
			if (part.type === 'reasoning_reset') {
				currentReasoning = '';
			}
			if (part.type === 'chat_text_reset') {
				resetCount++;
				visibleText = '';
			}
		}
		if (currentReasoning.trim().length > 0) {
			reasoningBlocks.push(currentReasoning);
		}

		// Phase metadata is preserved when available, but missing phase metadata
		// never authorizes the host to discard a normal assistant text block.
		assert.strictEqual(resetCount, 0);
		assert.deepStrictEqual(reasoningBlocks, []);
		assert.strictEqual(visibleText, 'Checked the remaining range. Unphased provider text. The real answer streams after the extra read.');
		assert.strictEqual(parts.some((part: any) => part.type === 'task_complete'), true);
	});

	test('does not host-complete after a failed user-requested command', async () => {
		const parsingSupport = new CleanSlateAgentParsingSupport({
			getConfiguration: () => ({ planMode: false, reasoningLevel: 'low' })
		} as any);

        let chatCalls = 0;
        const runner = new CleanSlateQueryRunner({
            cleanSlateService: {
                chat: async () => (async function* () {
                    chatCalls++;
                    if (chatCalls === 1) {
                        yield {
                            type: 'tool_call',
                            call: {
                                toolName: 'execute_command',
                                input: {
                                    command: 'npm run build',
                                    reason: 'Run the requested build command.',
                                    intent: 'user_requested',
                                    writesToWorkspace: false
                                }
                            }
                        };
                        return;
                    }
                    if (chatCalls === 2) {
                        yield { type: 'text', content: 'npm run build failed with exit code 1 after partial compilation output.' };
                        return;
                    }
                })()
            },
            cleanSlateContextService: {
                getContext: async () => ({
                    activeFile: { languageId: 'typescript' },
                    openFiles: []
                })
            },
            buildPromptContext: async () => 'Prompt Context',
            getCurrentAgentDefinition: () => undefined,
            parsingSupport,
            executionSupport: {
                createMarkerBaseline: () => new Map(),
                collectNewMarkerIssues: async () => [],
                trackTouchedPaths: () => { },
                didToolSucceed: (result: any) => result?.success !== false && result?.exitCode !== 1,
                isConfirmedMutationResult: () => false
            },
            executeTool: async function* (toolName: string, input: any) {
                assert.strictEqual(toolName, 'execute_command');
                yield {
                    type: 'tool_result',
                    toolName,
                    result: {
                        success: false,
                        command: input.command,
                        status: 'failed',
                        exitCode: 1,
                        output: 'Compiled successfully\nCannot read properties of null (reading useContext)\nCommand exited with code 1.'
                    }
                };
            },
            toolContext: { configService: { getConfiguration: () => ({}) } } as any,
            recentFocusLines: new Map(),
            referenceBuffer: new Map(),
            checkCrossFileReferences: async () => [],
            getToolCategory: () => undefined
        } as any);

        const threadService = new CleanSlateThreadService();
        const taskSessionService = new CleanSlateTaskSessionService();
        taskSessionService.setPhase(AgentPhase.EXECUTION);

        const parts = [];
        for await (const part of runner.run(
            [
                { role: 'system', content: 'placeholder' },
                { role: 'user', content: '[CONTEXT]\nplaceholder' }
            ] as any,
            'Run npm run build',
            'Execution',
            { activeFile: { languageId: 'typescript' } },
            '',
            threadService,
            taskSessionService
        )) {
            parts.push(part);
        }

        assert.strictEqual(parts.some((part: any) => part.type === 'task_complete'), false);
        assert.strictEqual(taskSessionService.getStatus(), 'INTERRUPTED');
    });

	test('recovers a failed implementation command before returning the final answer', async () => {
		const parsingSupport = new CleanSlateAgentParsingSupport({
			getConfiguration: () => ({ planMode: false, reasoningLevel: 'low' })
		} as any);

		let chatCalls = 0;
		const executedCommands: string[] = [];
		const runner = new CleanSlateQueryRunner({
			cleanSlateService: {
				chat: async () => (async function* () {
					chatCalls++;
					if (chatCalls === 1) {
						yield {
							type: 'tool_call',
							call: {
								toolName: 'execute_command',
								input: {
									command: 'git add .',
									reason: 'Stage the current project files.',
									intent: 'implementation',
									writesToWorkspace: true
								}
							}
						};
						return;
					}
					if (chatCalls === 2) {
						yield {
							type: 'tool_call',
							call: {
								toolName: 'execute_command',
								input: {
									command: 'git init',
									reason: 'Initialize the repository before staging files.',
									intent: 'implementation',
									writesToWorkspace: true
								}
							}
						};
						return;
					}
					if (chatCalls === 3) {
						yield {
							type: 'tool_call',
							call: {
								toolName: 'execute_command',
								input: {
									command: 'git add .',
									reason: 'Stage the files after repository initialization.',
									intent: 'implementation',
									writesToWorkspace: true
								}
							}
						};
						return;
					}
					yield { type: 'text', content: 'Initialized the repository and staged the project files successfully.' };
				})()
			},
			cleanSlateContextService: {
				getContext: async () => ({
					activeFile: { languageId: 'html' },
					openFiles: []
				})
			},
			buildPromptContext: async () => 'Prompt Context',
			getCurrentAgentDefinition: () => undefined,
			parsingSupport,
			executionSupport: {
				createMarkerBaseline: () => new Map(),
				collectNewMarkerIssues: async () => [],
				trackTouchedPaths: () => { },
				didToolSucceed: (result: any) => result?.success !== false && result?.exitCode !== 128,
				isConfirmedMutationResult: () => false
			},
			executeTool: async function* (toolName: string, input: any) {
				assert.strictEqual(toolName, 'execute_command');
				executedCommands.push(input.command);
				if (input.command === 'git add .' && executedCommands.length === 1) {
					yield {
						type: 'tool_result',
						toolName,
						result: {
							success: false,
							command: input.command,
							status: 'failed',
							exitCode: 128,
							error: 'fatal: not a git repository (or any of the parent directories): .git'
						}
					};
					return;
				}
				yield {
					type: 'tool_result',
					toolName,
					result: {
						success: true,
						command: input.command,
						status: 'completed',
						exitCode: 0,
						output: input.command === 'git init'
							? 'Initialized empty Git repository.'
							: ''
					}
				};
			},
			toolContext: { configService: { getConfiguration: () => ({}) } } as any,
			recentFocusLines: new Map(),
			referenceBuffer: new Map(),
			checkCrossFileReferences: async () => [],
			getToolCategory: () => undefined
		} as any);

		const threadService = new CleanSlateThreadService();
		const taskSessionService = new CleanSlateTaskSessionService();
		taskSessionService.setPhase(AgentPhase.EXECUTION);

		const parts = [];
		for await (const part of runner.run(
			[
				{ role: 'system', content: 'placeholder' },
				{ role: 'user', content: '[CONTEXT]\nplaceholder' }
			] as any,
			'Add git to this project',
			'Execution',
			{ activeFile: { languageId: 'html' } },
			'',
			threadService,
			taskSessionService
		)) {
			parts.push(part);
		}

		assert.deepStrictEqual(executedCommands, ['git add .', 'git init', 'git add .']);
		assert.strictEqual(parts.some((part: any) => part.type === 'task_complete'), true);
	});

	test('normal mode does not require a host-inferred mutation before stopping', async () => {
		const parsingSupport = new CleanSlateAgentParsingSupport({
			getConfiguration: () => ({ planMode: false, reasoningLevel: 'low' })
		} as any);

		let chatCalls = 0;
		const runner = new CleanSlateExecutionQueryEngine({
			cleanSlateService: {
				chat: async () => (async function* () {
					chatCalls++;
					if (chatCalls === 1) {
						yield {
							type: 'tool_call',
							call: {
								toolName: 'execute_command',
								input: {
									command: 'npm run compile-check-ts-native',
									intent: 'diagnostic',
									writesToWorkspace: false,
									reason: 'Typecheck workspace'
								}
							}
						};
						return;
					}
					yield { type: 'text', content: 'Compile check passed, so the fix is done.' };
				})()
			},
			cleanSlateContextService: {
				getContext: async () => ({ activeFile: { languageId: 'typescript' }, openFiles: [] })
			},
			buildPromptContext: async () => 'Prompt Context',
			getCurrentAgentDefinition: () => undefined,
			parsingSupport,
			executionSupport: {
				createMarkerBaseline: () => new Map(),
				collectNewMarkerIssues: async () => [],
				trackTouchedPaths: () => { },
				didToolSucceed: () => true,
				isConfirmedMutationResult: () => false
			},
			executeTool: async function* (toolName: string) {
				yield {
					type: 'tool_result',
					toolName,
					result: { success: true, exitCode: 0 }
				};
			},
			toolContext: { configService: { getConfiguration: () => ({}) } } as any,
			recentFocusLines: new Map(),
			referenceBuffer: new Map(),
			checkCrossFileReferences: async () => [],
			getToolCategory: (toolName: string) => toolName === 'execute_command' ? 'execution' : undefined
		} as any);

		const threadService = new CleanSlateThreadService();
		const taskSessionService = new CleanSlateTaskSessionService();
		taskSessionService.setPhase(AgentPhase.EXECUTION);

		const parts: any[] = [];
		for await (const part of runner.run(
			[
				{ role: 'system', content: 'placeholder' },
				{ role: 'user', content: 'Fix cleanSlateAgentWorkspaceOverlay.ts diff widget rendering' }
			] as any,
			'Fix cleanSlateAgentWorkspaceOverlay.ts diff widget rendering',
			'Execution',
			{ activeFile: { languageId: 'typescript' } },
			'',
			threadService,
			taskSessionService,
			undefined,
			{ executionFlow: 'normal' }
		)) {
			parts.push(part);
		}

		assert.strictEqual(parts.some(part => part.type === 'task_complete'), true);
	});

	test('normal mode does not impose an inferred file-scope completion router', async () => {
		const parsingSupport = new CleanSlateAgentParsingSupport({
			getConfiguration: () => ({ planMode: false, reasoningLevel: 'low' })
		} as any);

		let chatCalls = 0;
		const runner = new CleanSlateExecutionQueryEngine({
			cleanSlateService: {
				chat: async () => (async function* () {
					chatCalls++;
					if (chatCalls === 1) {
						yield {
							type: 'tool_call',
							call: {
								toolName: 'apply_edit',
								input: {
									file_path: 'src/vs/workbench/services/cleanSlate/common/cleanSlateAI.ts',
									old_string: 'export interface ICleanSlateMainService {}',
									new_string: 'export interface ICleanSlateMainService {}\nexport const IGardenApiService = ICleanSlateMainService;'
								}
							}
						};
						return;
					}
					yield { type: 'text', content: 'Added the missing export alias.' };
				})()
			},
			cleanSlateContextService: {
				getContext: async () => ({ activeFile: { languageId: 'typescript' }, openFiles: [] })
			},
			buildPromptContext: async () => 'Prompt Context',
			getCurrentAgentDefinition: () => undefined,
			parsingSupport,
			executionSupport: {
				createMarkerBaseline: () => new Map(),
				collectNewMarkerIssues: async () => [],
				trackTouchedPaths: () => { },
				didToolSucceed: () => true,
				isConfirmedMutationResult: (toolName: string) => toolName === 'apply_edit'
			},
			executeTool: async function* (toolName: string) {
				yield {
					type: 'tool_result',
					toolName,
					result: {
						success: true,
						path: 'src/vs/workbench/services/cleanSlate/common/cleanSlateAI.ts',
						diff: '+export const IGardenApiService = ICleanSlateMainService;'
					}
				};
			},
			toolContext: { configService: { getConfiguration: () => ({}) } } as any,
			recentFocusLines: new Map(),
			referenceBuffer: new Map(),
			checkCrossFileReferences: async () => [],
			getToolCategory: (toolName: string) => toolName === 'apply_edit' ? 'mutation' : undefined
		} as any);

		const threadService = new CleanSlateThreadService();
		const taskSessionService = new CleanSlateTaskSessionService();
		taskSessionService.setPhase(AgentPhase.EXECUTION);

		const parts: any[] = [];
		for await (const part of runner.run(
			[
				{ role: 'system', content: 'placeholder' },
				{ role: 'user', content: 'Fix cleanSlateAgentWorkspaceOverlay.ts diff widget rendering' }
			] as any,
			'Fix cleanSlateAgentWorkspaceOverlay.ts diff widget rendering',
			'Execution',
			{ activeFile: { languageId: 'typescript' } },
			'',
			threadService,
			taskSessionService,
			undefined,
			{ executionFlow: 'normal' }
		)) {
			parts.push(part);
		}

		assert.strictEqual(parts.some(part => part.type === 'task_complete'), true);
	});

	test('normal execution pauses on a native ask_question tool call', async () => {
		const parsingSupport = new CleanSlateAgentParsingSupport({
			getConfiguration: () => ({ planMode: false, reasoningLevel: 'low' })
		} as any);

		let chatCalls = 0;
		const runner = new CleanSlateQueryRunner({
			cleanSlateService: {
				chat: async () => (async function* () {
					chatCalls++;
					yield {
						type: 'tool_call',
						call: {
							toolName: 'ask_question',
							input: {
								summary: 'I need one decision before continuing.',
								question: 'Which database should I target?',
								options: [
									{ label: 'Postgres', recommended: true },
									{ label: 'SQLite' }
								]
							}
						}
					};
				})()
			},
			cleanSlateContextService: {
				getContext: async () => ({ activeFile: { languageId: 'typescript' }, openFiles: [] })
			},
			buildPromptContext: async () => 'Prompt Context',
			getCurrentAgentDefinition: () => undefined,
			parsingSupport,
			executionSupport: {
				createMarkerBaseline: () => new Map(),
				collectNewMarkerIssues: async () => [],
				trackTouchedPaths: () => { },
				didToolSucceed: () => true,
				isConfirmedMutationResult: () => false
			},
			executeTool: async function* (toolName: string, input: any) {
				if (toolName === 'ask_question') {
					yield {
						type: 'tool_result',
						toolName,
						result: {
							success: true,
							summary: input.summary,
							planning_question: { question: input.question, options: input.options }
						}
					};
					return;
				}
				yield { type: 'tool_result', toolName, result: { success: true } };
			},
			toolContext: { configService: { getConfiguration: () => ({}) } } as any,
			recentFocusLines: new Map(),
			referenceBuffer: new Map(),
			checkCrossFileReferences: async () => [],
			getToolCategory: () => undefined
		} as any);

		const threadService = new CleanSlateThreadService();
		const taskSessionService = new CleanSlateTaskSessionService();
		taskSessionService.setPhase(AgentPhase.EXECUTION);

		const parts: any[] = [];
		for await (const part of runner.run(
			[
				{ role: 'system', content: 'placeholder' },
				{ role: 'user', content: '[CONTEXT]\nplaceholder' }
			] as any,
			'Set up the database',
			'Execution',
			{ activeFile: { languageId: 'typescript' } },
			'',
			threadService,
			taskSessionService
		)) {
			parts.push(part);
		}

		const questionResult = parts.find((part: any) => part.type === 'tool_result' && part.toolName === 'ask_question');
		const finished = parts.find((part: any) => part.type === 'task_complete');

		assert.strictEqual(chatCalls, 1, 'run should pause after the question instead of taking another model turn');
		assert.ok(questionResult, 'the ask_question tool_result should be streamed to the UI');
		assert.strictEqual(questionResult?.result?.planning_question?.question, 'Which database should I target?');
		assert.strictEqual(finished, undefined, 'the task must not finish while paused for a question');
	});

	function createPlanModeEngine(chatTurns: Array<() => AsyncIterable<any>>, executedTools: Array<{ toolName: string; input: any }>, capturedChatOptions: any[]) {
		const parsingSupport = new CleanSlateAgentParsingSupport({
			getConfiguration: () => ({ planMode: true, reasoningLevel: 'low' })
		} as any);
		let chatCalls = 0;
		const engine = new CleanSlateExecutionQueryEngine({
			cleanSlateService: {
				chat: async (_messages: any, options: any) => {
					capturedChatOptions.push(options);
					const turn = chatTurns[Math.min(chatCalls, chatTurns.length - 1)];
					chatCalls++;
					return turn();
				}
			},
			cleanSlateContextService: {
				getContext: async () => ({ activeFile: { languageId: 'typescript' }, openFiles: [] })
			},
			buildPromptContext: async () => 'Prompt Context',
			getCurrentAgentDefinition: () => undefined,
			parsingSupport,
			executionSupport: {
				createMarkerBaseline: () => new Map(),
				collectNewMarkerIssues: async () => [],
				trackTouchedPaths: () => { },
				didToolSucceed: (result: any) => result?.success !== false,
				isConfirmedMutationResult: () => false
			},
			executeTool: async function* (toolName: string, input: any) {
				executedTools.push({ toolName, input });
				if (toolName === 'submit_artifact') {
					yield {
						type: 'tool_result',
						toolName,
						result: { success: true, path: input?.path ?? 'implementation_plan.md', summary: input?.summary ?? 'Plan drafted.' }
					};
					return;
				}
				yield { type: 'tool_result', toolName, result: { success: true } };
			},
			toolContext: {
				modelService: { getModel: () => undefined },
				workspaceContextService: { getWorkspaceFolder: () => undefined },
				configService: { getConfiguration: () => ({}) }
			} as any,
			recentFocusLines: new Map(),
			referenceBuffer: new Map(),
			checkCrossFileReferences: async () => [],
			getToolCategory: (toolName: string) => ['read_file', 'grep_search', 'list_dir'].includes(toolName) ? 'discovery' : undefined
		} as any);
		return { engine, getChatCalls: () => chatCalls };
	}

	test('plan mode concludes with a plan-created signal and awaits approval on submit_artifact', async () => {
		const executedTools: Array<{ toolName: string; input: any }> = [];
		const capturedChatOptions: any[] = [];
		const { engine, getChatCalls } = createPlanModeEngine([
			() => (async function* () {
				yield {
					type: 'tool_call',
					call: {
						toolName: 'submit_artifact',
						input: {
							summary: 'I drafted the dark-mode plan.',
							artifactType: 'implementation_plan',
							content: '# Implementation Plan\n\n#### [MODIFY] [a.ts](file:///w/a.ts)\nChange the theme.'
						}
					}
				};
			})()
		], executedTools, capturedChatOptions);

		const threadService = new CleanSlateThreadService();
		const taskSessionService = new CleanSlateTaskSessionService();
		taskSessionService.setPhase(AgentPhase.PLANNING);

		const parts: any[] = [];
		for await (const part of engine.run(
			[
				{ role: 'system', content: 'placeholder' },
				{ role: 'user', content: '[CONTEXT]\nplaceholder' }
			] as any,
			'Add dark mode',
			'Planning',
			{ activeFile: { languageId: 'typescript' } },
			'',
			threadService,
			taskSessionService,
			undefined,
			{ phase: AgentPhase.PLANNING }
		)) {
			parts.push(part);
		}

		const planCreated = parts.find((part: any) => part.type === 'tool_result' && part.toolName === PHASE_CONCLUSION_SIGNAL_PLAN_CREATED);
		const finished = parts.find((part: any) => part.type === 'task_complete');

		assert.strictEqual(getChatCalls(), 1, 'submit_artifact must conclude the plan-mode run');
		assert.ok(planCreated, 'a successful implementation plan submission must emit the plan-created conclusion signal');
		assert.strictEqual(planCreated?.result?.planCreated, true);
		assert.strictEqual(finished, undefined, 'a plan submission must not finish the task');
		assert.strictEqual(taskSessionService.isAwaitingApproval(), true, 'the plan must pause the task for user approval');
		assert.strictEqual(taskSessionService.getPhase(), AgentPhase.PLANNING);
		const offeredToolNames = (capturedChatOptions[0]?.tools ?? []).map((tool: any) => tool.name);
		assert.strictEqual(offeredToolNames.includes('apply_edit'), false, 'plan mode must not offer mutation tools to the provider');
		assert.strictEqual(offeredToolNames.includes('execute_command'), false, 'plan mode must not offer command tools to the provider');
		assert.strictEqual(offeredToolNames.includes('finish_task'), false, 'plan mode must not offer finish_task');
		assert.strictEqual(offeredToolNames.includes('submit_artifact'), true, 'plan mode must offer submit_artifact as the exit');
	});

	test('plan mode blocks mutation tool calls that bypass the provider tool filter', async () => {
		const executedTools: Array<{ toolName: string; input: any }> = [];
		const capturedChatOptions: any[] = [];
		const { engine } = createPlanModeEngine([
			() => (async function* () {
				yield {
					type: 'tool_call',
					call: {
						toolName: 'apply_edit',
						input: { file_path: 'a.ts', old_string: 'before', new_string: 'after' }
					}
				};
			})(),
			() => (async function* () {
				yield {
					type: 'tool_call',
					call: {
						toolName: 'submit_artifact',
						input: { summary: 'Plan ready.', artifactType: 'implementation_plan', content: '# Plan' }
					}
				};
			})()
		], executedTools, capturedChatOptions);

		const threadService = new CleanSlateThreadService();
		const taskSessionService = new CleanSlateTaskSessionService();
		taskSessionService.setPhase(AgentPhase.PLANNING);

		const parts: any[] = [];
		for await (const part of engine.run(
			[
				{ role: 'system', content: 'placeholder' },
				{ role: 'user', content: '[CONTEXT]\nplaceholder' }
			] as any,
			'Add dark mode',
			'Planning',
			{ activeFile: { languageId: 'typescript' } },
			'',
			threadService,
			taskSessionService,
			undefined,
			{ phase: AgentPhase.PLANNING }
		)) {
			parts.push(part);
		}

		const blockedResult = parts.find((part: any) => part.type === 'tool_result' && part.result?.code === 'plan_mode_tool_blocked');
		assert.ok(blockedResult, 'a mutation tool call in plan mode must be rejected with plan_mode_tool_blocked');
		assert.strictEqual(executedTools.some(call => call.toolName === 'apply_edit'), false, 'the blocked mutation must never reach executeTool');
		assert.strictEqual(executedTools.some(call => call.toolName === 'submit_artifact'), true, 'the corrected turn should still conclude with a plan');
	});

	test('plan mode preserves unphased assistant text from tool turns', async () => {
		const executedTools: Array<{ toolName: string; input: any }> = [];
		const capturedChatOptions: any[] = [];
		const { engine, getChatCalls } = createPlanModeEngine([
			() => (async function* () {
				yield { type: 'text', content: 'I need to inspect the relevant screens and think about the UX.' };
				yield { type: 'tool_call', call: { toolName: 'read_file', input: { path: 'lib/screens/home.dart' } } };
			})(),
			() => (async function* () {
				yield {
					type: 'tool_call',
					call: {
						toolName: 'submit_artifact',
						input: {
							summary: 'I drafted the UX plan.',
							artifactType: 'implementation_plan',
							content: '# UX polish\n\n## Summary\nImprove feedback and discoverability.\n\n## Implementation Changes\n- Refine the primary task flow.\n\n## Test Plan\n- Run widget tests.'
						}
					}
				};
			})()
		], executedTools, capturedChatOptions);

		const threadService = new CleanSlateThreadService();
		const taskSessionService = new CleanSlateTaskSessionService();
		taskSessionService.setPhase(AgentPhase.PLANNING);

		const parts: any[] = [];
		for await (const part of engine.run(
			[{ role: 'system', content: 'placeholder' }, { role: 'user', content: '[CONTEXT]\nplaceholder' }] as any,
			'Improve UX',
			'Planning',
			{ activeFile: { languageId: 'dart' } },
			'',
			threadService,
			taskSessionService,
			undefined,
			{ phase: AgentPhase.PLANNING }
		)) {
			parts.push(part);
		}

		const visibleText = parts.filter(part => part.type === 'chat_text').map(part => part.content).join('');
		assert.strictEqual(getChatCalls(), 2);
		assert.strictEqual(visibleText.includes('I need to inspect'), true);
		assert.strictEqual(parts.some(part => part.type === 'tool_result' && part.toolName === PHASE_CONCLUSION_SIGNAL_PLAN_CREATED), true);
	});

	test('plan mode ends the turn on a text-only response without completion machinery', async () => {
		const executedTools: Array<{ toolName: string; input: any }> = [];
		const capturedChatOptions: any[] = [];
		const { engine, getChatCalls } = createPlanModeEngine([
			() => (async function* () {
				yield { type: 'text', content: 'Before I plan this: the repo has two theme systems. I need to look closer, but here is what I see so far.' };
			})()
		], executedTools, capturedChatOptions);

		const threadService = new CleanSlateThreadService();
		const taskSessionService = new CleanSlateTaskSessionService();
		taskSessionService.setPhase(AgentPhase.PLANNING);

		const parts: any[] = [];
		for await (const part of engine.run(
			[
				{ role: 'system', content: 'placeholder' },
				{ role: 'user', content: '[CONTEXT]\nplaceholder' }
			] as any,
			'Add dark mode',
			'Planning',
			{ activeFile: { languageId: 'typescript' } },
			'',
			threadService,
			taskSessionService,
			undefined,
			{ phase: AgentPhase.PLANNING }
		)) {
			parts.push(part);
		}

		const finished = parts.find((part: any) => part.type === 'task_complete');
		const chatText = parts.filter((part: any) => part.type === 'chat_text').map((part: any) => part.content).join('');

		assert.strictEqual(getChatCalls(), 1, 'a text-only plan-mode turn must end the run without retry nudges');
		assert.strictEqual(finished, undefined, 'a text-only plan-mode turn must not finish the task');
		assert.ok(chatText.includes('two theme systems'), 'the model text must stream to the user');
		const assistantMessages = threadService.getHistory().filter(message => message.role === 'assistant');
		assert.strictEqual(assistantMessages.length, 1, 'the assistant text must persist to the thread history');
	});
});
