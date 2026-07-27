/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChatResponse } from '../types/cleanSlateChatTypes.js';
import { normalizePlanningQuestion } from './cleanSlateChatResponseNormalizer.js';

export function parseStreamingJSON(text: string): ChatResponse {
    const result: ChatResponse = {};
    const parsedObject = parseLatestJsonObject(text);

    if (!isRecord(parsedObject)) {
        return result;
    }

    result.summary = normalizeSummaryField(parsedObject.summary);
    result.code_snippet = normalizeStringField(parsedObject.code_snippet);

    result.to_do = normalizeStringArrayField(parsedObject.to_do);
    if (result.to_do.length === 0) {
        result.to_do = normalizeStringArrayField(parsedObject.execution_plan);
    }
    result.execution_plan = result.to_do;
    result.files_accessed = normalizeStringArrayField(parsedObject.files_accessed);
    result.files_created = normalizeStringArrayField(parsedObject.files_created);
    result.planning_question = normalizePlanningQuestion(parsedObject.planning_question);

    const planAction = getImplementationPlanAction(result);
    if (planAction) {
        result.isImplementationPlan = true;
        result.planAction = planAction;
    }

    return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStringArrayField(rawValue: unknown): string[] {
    if (!Array.isArray(rawValue)) {
        return [];
    }

    return rawValue
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function getImplementationPlanAction(result: ChatResponse): 'created' | 'modified' | undefined {
    if (result.files_created?.some(path => isImplementationPlanPath(path))) {
        return 'created';
    }

    const codeSnippet = result.code_snippet || '';
    if (codeSnippet.includes('# Implementation Plan') || codeSnippet.includes('## Proposed Changes')) {
        return 'created';
    }

    return undefined;
}

function isImplementationPlanPath(value: string): boolean {
    return value.toLowerCase().includes('implementation_plan.md');
}

function normalizeSummaryField(rawSummary: unknown): ChatResponse['summary'] | undefined {
    if (typeof rawSummary === 'string' && rawSummary.trim().length > 0) {
        return rawSummary;
    }

    if (Array.isArray(rawSummary)) {
        const summaries = rawSummary
            .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
        return summaries.length > 0 ? summaries : undefined;
    }

    return undefined;
}

function normalizeStringField(rawValue: unknown): string | undefined {
    return typeof rawValue === 'string' && rawValue.trim().length > 0
        ? rawValue
        : undefined;
}

function parseLatestJsonObject(text: string): unknown {
    const candidates = extractJsonCandidates(text);

    for (let i = candidates.length - 1; i >= 0; i--) {
        try {
            return JSON.parse(candidates[i]);
        } catch {
            continue;
        }
    }

    return undefined;
}

function extractJsonCandidates(text: string): string[] {
    const trimmed = text.trim();
    const candidates: string[] = [];

    if (trimmed.length > 0) {
        candidates.push(trimmed);
    }

    candidates.push(...extractFencedJsonCandidates(text));
    candidates.push(...extractBalancedJsonObjects(text));
    return candidates;
}

function extractFencedJsonCandidates(text: string): string[] {
    const candidates: string[] = [];
    let searchIndex = 0;

    while (searchIndex < text.length) {
        const fenceStart = text.indexOf('```', searchIndex);
        if (fenceStart < 0) {
            break;
        }

        const headerStart = fenceStart + 3;
        const headerEnd = text.indexOf('\n', headerStart);
        if (headerEnd < 0) {
            break;
        }

        const fenceEnd = text.indexOf('```', headerEnd + 1);
        if (fenceEnd < 0) {
            break;
        }

        const header = text.substring(headerStart, headerEnd).trim().toLowerCase();
        if (header.length === 0 || header === 'json') {
            const content = text.substring(headerEnd + 1, fenceEnd).trim();
            if (content.length > 0) {
                candidates.push(content);
            }
        }

        searchIndex = fenceEnd + 3;
    }

    return candidates;
}

function extractBalancedJsonObjects(text: string): string[] {
    const candidates: string[] = [];
    let objectStart = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < text.length; index++) {
        const char = text[index];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }

        if (char === '{') {
            if (depth === 0) {
                objectStart = index;
            }
            depth++;
            continue;
        }

        if (char === '}' && depth > 0) {
            depth--;
            if (depth === 0 && objectStart >= 0) {
                candidates.push(text.substring(objectStart, index + 1));
                objectStart = -1;
            }
        }
    }

    return candidates;
}

export function formatChatErrorMessage(err: any): string {
    const errStr = String(err);
    const quotaMarkerIndex = errStr.indexOf('QUOTA_EXCEEDED:');
    if (quotaMarkerIndex >= 0) {
        return stripRepeatedErrorPrefix(errStr.substring(quotaMarkerIndex));
    }
    try {
        const data = parseLatestJsonObject(errStr) as any;
        if (data) {
            const errorObj = Array.isArray(data) ? data[0]?.error : data.error;

            if (errorObj) {
                const code = errorObj.code || data.code;
                const message = typeof errorObj.message === 'string'
                    ? errorObj.message
                    : typeof data.message === 'string'
                        ? data.message
                        : '';

                if (isUsageLimitError(errStr, code, errorObj.type)) {
                    if (message.includes('retry in')) {
                        const delay = extractRetryDelay(message);
                        if (delay) {
                            return `QUOTA_EXCEEDED: Rate Limit Exceeded: Please wait ${delay} before retrying.`;
                        }
                    }
                    return `QUOTA_EXCEEDED: ${message || 'You have reached your plan usage limit. It resets automatically, or add credits to keep going.'}`;
                }

                if (message) {
                    return `Error (${code || 'AI API'}): ${message}`;
                }
            }
        }
    } catch {
        // Fall back to normalized string below.
    }
    if (isUsageLimitError(errStr)) {
        return 'QUOTA_EXCEEDED: You have reached your plan usage limit. It resets automatically, or add credits to keep going.';
    }
    return stripRepeatedErrorPrefix(errStr);
}

function isUsageLimitError(errStr: string, code?: unknown, errorType?: unknown): boolean {
    // Managed-plan exhaustion and upstream provider throttling both use HTTP
    // 429, but only the former is terminal. Preserve provider_rate_limit as a
    // normal error so the service can honor Retry-After and reconnect once.
    if (errorType === 'provider_rate_limit') {
        return false;
    }
    if (code === 429 || String(code) === '429' || errorType === 'rate_limit_error' || errorType === 'usage_limit_exceeded') {
        return true;
    }
    return /\bHTTP\s*429\b/i.test(errStr)
        || /too[\s_-]?many[\s_-]?requests/i.test(errStr)
        || /rate[\s_-]?limit/i.test(errStr)
        || /usage[\s_-]?limit/i.test(errStr);
}

function extractRetryDelay(message: string): string | undefined {
    const marker = 'retry in ';
    const start = message.toLowerCase().indexOf(marker);
    if (start < 0) {
        return undefined;
	}

	const valueStart = start + marker.length;
	const match = /^(\d+(?:\.\d+)?\s*(?:ms|s)?)/i.exec(message.substring(valueStart));
	return match?.[1]?.trim();
}

function stripRepeatedErrorPrefix(value: string): string {
    let normalized = value.trim();
    const repeatedPrefix = 'Error: Error:';
    while (normalized.startsWith(repeatedPrefix)) {
        normalized = `Error:${normalized.substring(repeatedPrefix.length)}`.trim();
    }
    return normalized;
}
