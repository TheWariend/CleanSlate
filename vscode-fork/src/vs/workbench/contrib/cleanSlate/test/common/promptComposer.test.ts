/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { SLASH_COMMANDS } from '@cleanslate/sdk/composer/commands/slashCommands.js';
import { composePrompt } from '@cleanslate/sdk/composer/promptComposer.js';

suite('promptComposer', () => {
    function flattenPromptText(parts: readonly { text: string }[]): string {
        return parts.map(part => part.text).join('\n');
    }

	test('keeps the cached prefix stable and appends dynamic mode context', () => {
		const planning = composePrompt({ mode: 'Planning', userMessage: 'inspect the change' }) as Array<{ text: string }>;
		const execution = composePrompt({ mode: 'Execution', userMessage: 'implement the change' }) as Array<{ text: string }>;

		assert.strictEqual(planning[0].text, execution[0].text);
		assert.strictEqual((planning[0] as any).cache_control?.type, 'ephemeral');
		assert.match(planning[1].text, /<planning_mode>/);
		assert.match(execution[1].text, /<execution_mode>/);
	});

    test('does not inject research override for implementation requests', () => {
        const wrappedObjective = [
            'RESEARCH FIRST: You are a pro-level engineer.',
            'AUDIT MANDATE: Before you call submit_artifact, do broad discovery.',
            'User Instruction:',
            'implement a new screen when tapping status pill inside leave management screen'
        ].join('\n');

        const prompt = composePrompt({
            mode: 'Planning',
            userMessage: wrappedObjective
        });

        const combined = flattenPromptText(prompt as Array<{ text: string }>);
        assert.strictEqual(combined.includes('RESEARCH OVERRIDE (ACTIVE)'), false);
        assert.strictEqual(combined.includes('RESEARCH & AUDIT FOCUS'), false);
    });

    test('does not inject research override for audit wording either', () => {
        const prompt = composePrompt({
            mode: 'Planning',
            userMessage: 'audit and analyze the leave module architecture and risks'
        });

        const combined = flattenPromptText(prompt as Array<{ text: string }>);
        assert.strictEqual(combined.includes('RESEARCH OVERRIDE (ACTIVE)'), false);
        assert.strictEqual(combined.includes('RESEARCH & AUDIT FOCUS'), false);
    });

	test('execution prompt keeps completion in the same native loop', () => {
		const prompt = composePrompt({
			mode: 'Execution',
			userMessage: 'shrink the typing indicator dots'
		});

		const combined = flattenPromptText(prompt as Array<{ text: string }>);
		assert.strictEqual(combined.includes('planning, reads, tool results, questions, and edits in this conversation'), true);
		assert.strictEqual(combined.includes('write the concise user-facing result with no tool call and stop'), true);
		assert.strictEqual(combined.includes('A non-empty user-facing assistant answer with no tool call is the natural stop'), true);
		assert.strictEqual(combined.includes('Completion is a host lifecycle event, not a model-facing tool call'), true);
		assert.strictEqual(combined.includes('verification handoff'), false);
	});

	test('task prompts use native tools without forced narration rituals', () => {
		const prompt = composePrompt({
			mode: 'Execution',
			userMessage: 'update the profile screen'
        });

        const combined = flattenPromptText(prompt as Array<{ text: string }>);
		assert.strictEqual(combined.includes('JSON RESPONSE SCHEMA'), false);
		assert.strictEqual(combined.includes('"summary": "STRING | OPTIONAL'), false);
		assert.strictEqual(combined.includes('provider-native tool calls'), true);
		assert.strictEqual(combined.includes('Never serialize tool-call syntax into prose'), true);
		assert.strictEqual(combined.includes('Do not announce progress merely because another model turn started'), true);
		assert.strictEqual(combined.includes('one concise progress update at a meaningful checkpoint'), true);
		assert.strictEqual(combined.includes('Do not expose private deliberation'), true);
		assert.strictEqual(combined.includes('Use a todo list for genuinely multi-step work when it helps'), true);
		assert.strictEqual(combined.includes('Use update_todo only when a multi-step checklist genuinely improves coordination'), true);
		assert.strictEqual(combined.includes('The first summary must include a noun phrase from the user'), false);
		assert.strictEqual(combined.includes('Progress Summaries'), false);
	});

	test('greenfield execution prefers official scaffolds and asks before inventing a stack', () => {
		const prompt = composePrompt({
			mode: 'Execution',
			userMessage: 'create an app'
		});

		const combined = flattenPromptText(prompt as Array<{ text: string }>);
		assert.strictEqual(combined.includes('run that generator in the workspace root with non-interactive flags'), true);
		assert.strictEqual(combined.includes('before manually creating framework-owned boilerplate'), true);
		assert.strictEqual(combined.includes('ask one concise question instead of silently choosing an ecosystem'), true);
		assert.strictEqual(combined.includes('prefer its official generator through execute_command'), true);
	});

	test('planning prompts are proportional and ask only blocking questions', () => {
		const prompt = composePrompt({
			mode: 'Planning',
			userMessage: 'implement dark mode'
		});

		const combined = flattenPromptText(prompt as Array<{ text: string }>);
		assert.strictEqual(combined.includes('there is no required number or order of discovery calls'), true);
		assert.strictEqual(combined.includes('Ask a question only when a consequential product, scope, safety, or irreversible design decision blocks a useful plan'), true);
		assert.strictEqual(combined.includes('The submitted artifact is the implementation plan, not a research transcript'), true);
		assert.strictEqual(combined.includes('Prefer 3-5 short sections'), true);
		assert.strictEqual(combined.includes('normally name no more than three paths'), true);
		assert.strictEqual(combined.includes('usually fit within 40 lines'), true);
		assert.strictEqual(combined.includes('submit it with submit_artifact as type implementation_plan'), true);
		assert.strictEqual(combined.includes('Never serialize tool-call syntax into prose'), true);
	});

    test('injects slash command instructions into the prompt', () => {
        const prompt = composePrompt({
            mode: 'Planning',
            command: '/fix',
            userMessage: 'Fix the selected code.'
        });

		const combined = flattenPromptText(prompt as Array<{ text: string }>);
		assert.strictEqual(combined.includes('[SLASH COMMAND /fix]'), true);
		assert.strictEqual(combined.includes('treat it as the primary target'), true);
		assert.strictEqual(combined.includes('TASK: Fix bugs, errors, and potential issues in the selected code.'), true);
	});

    test('keeps explain slash command instruction minimal', () => {
        const prompt = composePrompt({
            mode: 'Execution',
            command: '/explain',
            userMessage: 'Explain the selected code.'
        });

		const combined = flattenPromptText(prompt as Array<{ text: string }>);
		assert.strictEqual(combined.includes('[SLASH COMMAND /explain]'), true);
		assert.strictEqual(SLASH_COMMANDS['/explain'].instruction, '\nTASK: Explain this to me.\n');
		assert.strictEqual(combined.includes('TASK: Explain this to me.'), true);
    });
});
