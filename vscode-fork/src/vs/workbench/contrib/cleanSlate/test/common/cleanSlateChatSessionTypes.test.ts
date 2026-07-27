/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { cloneCleanSlateSessionMessages, deriveCleanSlateTranscriptFromHistory, normalizeCleanSlateTranscriptOrder, parseCleanSlatePlanningAnswerQuestion, stringifyCleanSlatePlanningAnswerPayload } from '../../browser/chat/types/cleanSlateChatSessionTypes.js';

suite('CleanSlateChatSessionTypes', () => {
    test('derives transcript from visible history without leaking hidden internal turns', () => {
        const transcript = deriveCleanSlateTranscriptFromHistory([
            { role: 'system', content: '[TASK_BOUNDARY]', isInternalState: true },
            { role: 'user', content: 'Fix reload history' },
            { role: 'user', content: 'continue' },
            { role: 'assistant', content: 'internal scratch', isInternalState: true },
            { role: 'assistant', content: 'tool card memory', isInternalState: true, renderPayload: '{"summary":"Rendered result"}' },
            { role: 'assistant', content: 'Visible final answer' }
        ]);

        assert.deepStrictEqual(transcript.map(message => message.content), [
            'Fix reload history',
            'tool card memory',
            'Visible final answer'
        ]);
        assert.strictEqual(transcript[1].renderPayload, '{"summary":"Rendered result"}');
    });

    test('clones transcript images without sharing the caller array', () => {
        const images = ['data:image/png;base64,abc'];
        const [message] = cloneCleanSlateSessionMessages([{ role: 'user', content: 'see image', images }]);

        images.push('data:image/png;base64,def');

        assert.deepStrictEqual(message.images, ['data:image/png;base64,abc']);
    });

    test('repairs inverted user and assistant transcript pairs when the prompt matches the result', () => {
        const transcript = normalizeCleanSlateTranscriptOrder([
            { role: 'user', content: 'hi' },
            {
                role: 'assistant',
                content: '',
                renderPayload: JSON.stringify({
                    summary: 'Removed the hero AI research header from src/components/Hero.tsx.',
                    timeline: [{ id: 'file-1', type: 'file', path: 'src/components/Hero.tsx', status: 'Modified' }]
                })
            },
            { role: 'user', content: 'remove ai esearch header from hero' }
        ]);

        assert.deepStrictEqual(transcript.map(message => message.content), [
            'hi',
            'remove ai esearch header from hero',
            ''
        ]);
    });

    test('keeps normal follow-up messages after assistant replies', () => {
        const transcript = normalizeCleanSlateTranscriptOrder([
            { role: 'user', content: 'remove the hero heading' },
            { role: 'assistant', content: 'Removed the hero heading.' },
            { role: 'user', content: 'thanks' }
        ]);

        assert.deepStrictEqual(transcript.map(message => message.content), [
            'remove the hero heading',
            'Removed the hero heading.',
            'thanks'
        ]);
    });

    const questionPayload = JSON.stringify({
        summary: 'Storage backend decides the migration shape.',
        planning_question: {
            question: 'Which storage backend should the sync layer use?',
            options: [
                { label: 'Postgres with row level locking' },
                { label: 'SQLite with a write ahead log' }
            ],
            allowCustom: true,
            customLabel: 'Something else entirely'
        }
    });

    test('keeps a tagged planning answer after the question that produced it', () => {
        const transcript = normalizeCleanSlateTranscriptOrder([
            { role: 'user', content: 'wire up the offline draft cache' },
            { role: 'assistant', content: '', renderPayload: questionPayload },
            {
                role: 'user',
                content: 'Postgres with row level locking',
                renderPayload: stringifyCleanSlatePlanningAnswerPayload('Which storage backend should the sync layer use?')
            }
        ]);

        assert.deepStrictEqual(transcript.map(message => message.role), ['user', 'assistant', 'user']);
    });

    test('keeps an untagged legacy planning answer after its question', () => {
        // Sessions recorded before answers carried a marker: the answer is verbatim one
        // of the option labels, which otherwise scores as a perfect prompt match.
        const transcript = normalizeCleanSlateTranscriptOrder([
            { role: 'user', content: 'wire up the offline draft cache' },
            { role: 'assistant', content: '', renderPayload: questionPayload },
            { role: 'user', content: 'SQLite with a write ahead log' }
        ]);

        assert.deepStrictEqual(transcript.map(message => message.role), ['user', 'assistant', 'user']);
    });

    test('round-trips the planning answer marker and ignores unrelated payloads', () => {
        const payload = stringifyCleanSlatePlanningAnswerPayload('  Which storage backend?  ');

        assert.strictEqual(parseCleanSlatePlanningAnswerQuestion(payload), 'Which storage backend?');
        assert.strictEqual(parseCleanSlatePlanningAnswerQuestion('{"summary":"not an answer"}'), undefined);
        assert.strictEqual(parseCleanSlatePlanningAnswerQuestion('not json'), undefined);
        assert.strictEqual(stringifyCleanSlatePlanningAnswerPayload('   '), undefined);
    });
});
