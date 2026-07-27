/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { applyCleanSlateAgentDisplayPolicy } from '../../browser/chat/runtime/cleanSlateAgentDisplayPolicy.js';
import type { ChatResponse } from '../../browser/chat/types/cleanSlateChatTypes.js';

suite('CleanSlateAgentDisplayPolicy', () => {
    test('preserves completed native activity blocks without restoring generic tool widgets', () => {
        const response: ChatResponse = {
            transcriptStatus: 'interrupted',
            timeline: [
                { id: 'tool-1', type: 'tool', content: 'Read file', toolStatus: 'completed' },
                { id: 'file-1', type: 'file', path: '/workspace/src/app.ts', status: 'Read' },
                { id: 'browser-1', type: 'browser', browserAction: 'Captured DOM snapshot', browserStatus: 'completed' }
            ]
        };

        const display = applyCleanSlateAgentDisplayPolicy(response, { isStreaming: false, preserveTimeline: true });

        assert.deepStrictEqual(display.timeline?.map(block => block.id), ['file-1', 'browser-1']);
    });

    test('preserves assistant text as the visible answer channel', () => {
        const response: ChatResponse = {
            timeline: [
                { id: 'answer-1', type: 'assistant_text', content: 'Here is the explanation.' },
                { id: 'tool-1', type: 'tool', content: 'Internal helper', toolStatus: 'completed' }
            ]
        };

        const display = applyCleanSlateAgentDisplayPolicy(response, { isStreaming: false });

        assert.deepStrictEqual(display.timeline?.map(block => block.id), ['answer-1']);
    });

    test('hides progress summaries once explicit assistant text exists', () => {
        const response: ChatResponse = {
            timeline: [
                { id: 'summary-1', type: 'summary', content: 'Explaining selected code.', summaryRole: 'progress' },
                { id: 'answer-1', type: 'assistant_text', content: 'Here is the explanation.' }
            ]
        };

        const display = applyCleanSlateAgentDisplayPolicy(response, { isStreaming: false });

        assert.deepStrictEqual(display.timeline?.map(block => block.id), ['answer-1']);
    });
});
