/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CleanSlateTool, CleanSlateToolContext } from './types.js';

type TodoStatus = 'pending' | 'in_progress' | 'completed';

interface IUpdateTodoItemInput {
    content?: string;
    text?: string;
    status?: TodoStatus | 'todo' | 'doing' | 'done';
}

function normalizeStatus(status: unknown): TodoStatus {
    const normalized = typeof status === 'string' ? status.trim().toLowerCase() : '';
    if (normalized === 'completed' || normalized === 'complete' || normalized === 'done') {
        return 'completed';
    }
    if (normalized === 'in_progress' || normalized === 'in-progress' || normalized === 'doing' || normalized === 'active') {
        return 'in_progress';
    }
    return 'pending';
}

function normalizeText(text: string): string {
    return text
        .replace(/^\s*[-*]?\s*\[[xX/\s]\]\s*/, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function statusPrefix(status: TodoStatus): string {
    if (status === 'completed') {
        return '[x]';
    }
    if (status === 'in_progress') {
        return '[/]';
    }
    return '[ ]';
}

/**
 * Tool: update_todo
 */
export const updateTodoTool: CleanSlateTool = {
    name: 'update_todo',
    description: 'Creates or updates the machine-readable task checklist for the current objective. Use before and during multi-step work through a native tool call only; do not write checklist JSON or to_do fences in assistant text. Input: { items: [{ content: string, status: "pending" | "in_progress" | "completed" }] } or { to_do: string[] }. Returns normalized to_do plus completion counts.',
    parametersSchema: {
        type: 'object',
        properties: {
            items: {
                type: 'array',
                description: 'Preferred checklist format.',
                items: {
                    type: 'object',
                    properties: {
                        content: { type: 'string' },
                        text: { type: 'string' },
                        status: {
                            type: 'string',
                            enum: ['pending', 'in_progress', 'completed', 'todo', 'doing', 'done']
                        }
                    }
                }
            },
            to_do: {
                type: 'array',
                description: 'Existing checkbox format such as "[ ] Inspect files", "[/] Editing globals", "[x] Verify".',
                items: { type: 'string' }
            },
            summary: {
                type: 'string',
                description: 'Brief reason for the checklist update.'
            }
        }
    },
    category: 'system',
    async run(input: { items?: IUpdateTodoItemInput[]; to_do?: string[]; summary?: string }, _context: CleanSlateToolContext): Promise<any> {
        const normalized: string[] = [];

        if (Array.isArray(input.items)) {
            for (const item of input.items) {
                const content = normalizeText(String(item?.content ?? item?.text ?? ''));
                if (!content) {
                    continue;
                }
                normalized.push(`${statusPrefix(normalizeStatus(item?.status))} ${content}`);
            }
        }

        if (normalized.length === 0 && Array.isArray(input.to_do)) {
            for (const item of input.to_do) {
                if (typeof item !== 'string') {
                    continue;
                }
                const trimmed = item.trim();
                if (!trimmed) {
                    continue;
                }
                if (/^\s*[-*]?\s*\[[xX/\s]\]/.test(trimmed)) {
                    normalized.push(trimmed.replace(/^\s*[-*]\s*/, ''));
                } else {
                    normalized.push(`[ ] ${normalizeText(trimmed)}`);
                }
            }
        }

        const deduped = normalized.filter((item, index, arr) => arr.findIndex(other => normalizeText(other).toLowerCase() === normalizeText(item).toLowerCase()) === index);
        if (deduped.length === 0) {
            return {
                success: false,
                code: 'empty_todo',
                message: 'update_todo requires at least one non-empty task item.'
            };
        }

        const completed = deduped.filter(item => /^\s*\[x\]/i.test(item)).length;
        const inProgress = deduped.filter(item => /^\s*\[\/\]/.test(item)).length;
        const pending = deduped.length - completed;

        return {
            success: true,
            to_do: deduped,
            completed,
            inProgress,
            pending,
            allDone: pending === 0,
            summary: typeof input.summary === 'string' ? input.summary.trim() : undefined
        };
    }
};
