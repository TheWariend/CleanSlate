/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { formatChatErrorMessage, parseStreamingJSON } from '../../browser/chat/runtime/cleanSlateStreamingResponseParser.js';

suite('cleanSlateStreamingResponseParser', () => {
    test('keeps text-serialized tool calls out of the runtime contract', () => {
        const parsed = parseStreamingJSON(JSON.stringify({
            summary: 'Drafted and submitted the plan for review.',
            tool_calls: [
                {
                    name: 'submit_artifact',
                    arguments: {
                        summary: 'I drafted the plan and it is ready for review.'
                    }
                }
            ]
        }));

        assert.strictEqual(parsed.summary, 'Drafted and submitted the plan for review.');
        assert.strictEqual((parsed as any).tool_calls, undefined);
    });

    test('does not infer tool calls from unfinished JSON text', () => {
        const parsed = parseStreamingJSON('{"summary":"still streaming","tool_calls":[{"name":"apply_edit"');

        assert.strictEqual(parsed.summary, undefined);
        assert.strictEqual((parsed as any).tool_calls, undefined);
    });

    test('parses fenced JSON without raw text sniffing', () => {
        const parsed = parseStreamingJSON([
            '```json',
            JSON.stringify({
                files_created: ['implementation_plan.md'],
                summary: 'Plan ready.'
            }),
            '```'
        ].join('\n'));

        assert.strictEqual(parsed.summary, 'Plan ready.');
        assert.strictEqual(parsed.isImplementationPlan, true);
        assert.strictEqual(parsed.planAction, 'created');
    });

    test('formats nested Gemini quota payloads as quota-card messages', () => {
        const nested = JSON.stringify({
            error: {
                code: 429,
                message: 'You exceeded your current quota. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests. Please retry in 46.7s.',
                status: 'RESOURCE_EXHAUSTED'
            }
        });
        const formatted = formatChatErrorMessage(new Error(JSON.stringify({
            error: {
                message: nested,
                code: 429,
                status: 'Too Many Requests'
            }
        })));

        assert.strictEqual(formatted, 'QUOTA_EXCEEDED: Rate Limit Exceeded: Please wait 46.7s before retrying.');
    });

    test('preserves explicit quota marker from service errors', () => {
        assert.strictEqual(
            formatChatErrorMessage(new Error('QUOTA_EXCEEDED: Provider quota exhausted.')),
            'QUOTA_EXCEEDED: Provider quota exhausted.'
        );
    });

    test('maps managed-plan HTTP 429 errors with JSON bodies to quota-card messages', () => {
        const formatted = formatChatErrorMessage(new Error('ERROR: HTTP 429: ' + JSON.stringify({
            error: {
                code: 'plan_limit_exceeded',
                message: 'Daily usage limit reached. Resets Wed 05:29.'
            }
        })));

        assert.strictEqual(formatted, 'QUOTA_EXCEEDED: Daily usage limit reached. Resets Wed 05:29.');
    });

    test('maps plain-text HTTP 429 errors to quota-card messages', () => {
        const formatted = formatChatErrorMessage(new Error('ERROR: HTTP 429: Too Many Requests'));

        assert.ok(formatted.startsWith('QUOTA_EXCEEDED:'), formatted);
    });

    test('maps Anthropic rate_limit_error payloads to quota-card messages', () => {
        const formatted = formatChatErrorMessage(new Error(JSON.stringify({
            type: 'error',
            error: {
                type: 'rate_limit_error',
                message: 'This request would exceed your usage limit.'
            }
        })));

        assert.strictEqual(formatted, 'QUOTA_EXCEEDED: This request would exceed your usage limit.');
    });

    test('maps the managed-backend usage_limit_exceeded 429 body to its specific message', () => {
        // Mirrors ChatCompletionController's plan-limit response shape.
        const body = JSON.stringify({
            error: {
                type: 'usage_limit_exceeded',
                code: 429,
                reason: 'daily_limit_exhausted',
                message: "You've reached your daily usage limit. It resets tomorrow, or add credits to keep going.",
                resets_at: '2026-07-22T00:00:00.000Z'
            },
            message: "You've reached your daily usage limit. It resets tomorrow, or add credits to keep going.",
            reason: 'daily_limit_exhausted',
            entitlement: { can_use_managed_ai: false }
        });
        const formatted = formatChatErrorMessage(new Error('ERROR: HTTP 429: ' + body));

        assert.strictEqual(
            formatted,
            "QUOTA_EXCEEDED: You've reached your daily usage limit. It resets tomorrow, or add credits to keep going."
        );
    });

    test('keeps managed provider throttling retryable instead of showing the plan quota card', () => {
        const formatted = formatChatErrorMessage(new Error('ERROR: HTTP 429: ' + JSON.stringify({
            error: {
                type: 'provider_rate_limit',
                code: 429,
                message: 'The selected model is temporarily rate limited. Retrying is available in 42s.',
                retry_after_seconds: 42
            }
        })));

        assert.strictEqual(
            formatted,
            'Error (429): The selected model is temporarily rate limited. Retrying is available in 42s.'
        );
    });

    test('keeps non-quota provider errors out of the quota card', () => {
        const formatted = formatChatErrorMessage(new Error(JSON.stringify({
            error: {
                code: 500,
                message: 'Internal server error.'
            }
        })));

        assert.strictEqual(formatted, 'Error (500): Internal server error.');
    });
});
