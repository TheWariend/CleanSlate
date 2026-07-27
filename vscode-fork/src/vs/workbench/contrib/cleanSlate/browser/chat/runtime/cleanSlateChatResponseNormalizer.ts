/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChatResponse, CleanSlatePlanningQuestion, CleanSlatePlanningQuestionOption } from '../types/cleanSlateChatTypes.js';

export function normalizeChatResponse(data: ChatResponse): ChatResponse {
    const fallbackSummary = data.summary ?? data.response;
    const rawToDo = Array.isArray(data.to_do)
        ? data.to_do
        : Array.isArray(data.execution_plan)
            ? data.execution_plan
            : [];

    const normalizedToDo = rawToDo
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0);

    return {
        ...data,
        summary: fallbackSummary,
        to_do: normalizedToDo,
        planning_question: normalizePlanningQuestion(data.planning_question)
    };
}

export function normalizePlanningQuestion(raw: unknown): CleanSlatePlanningQuestion | undefined {
    if (!raw || typeof raw !== 'object') {
        return undefined;
    }

    const source = raw as {
        question?: unknown;
        options?: unknown;
        allowCustom?: unknown;
        customLabel?: unknown;
        placeholder?: unknown;
    };

    const question = typeof source.question === 'string' ? source.question.trim() : '';
    if (!question) {
        return undefined;
    }

    const rawOptions = Array.isArray(source.options) ? source.options : [];
    const options = rawOptions
        .map((option): CleanSlatePlanningQuestionOption | undefined => {
            if (typeof option === 'string') {
                return { label: option.trim() };
            }
            if (!option || typeof option !== 'object') {
                return undefined;
            }
            const optionRecord = option as { label?: unknown; description?: unknown; recommended?: unknown };
            const label = typeof optionRecord.label === 'string' ? optionRecord.label.trim() : '';
            if (!label) {
                return undefined;
            }
            const description = typeof optionRecord.description === 'string' ? optionRecord.description.trim() : undefined;
            return {
                label,
                description,
                recommended: optionRecord.recommended === true
            };
        })
        .filter((option): option is CleanSlatePlanningQuestionOption => !!option)
        .slice(0, 4);

    if (options.length === 0) {
        return undefined;
    }

    const customLabel = typeof source.customLabel === 'string' && source.customLabel.trim()
        ? source.customLabel.trim()
        : undefined;
    const placeholder = typeof source.placeholder === 'string' && source.placeholder.trim()
        ? source.placeholder.trim()
        : undefined;

    return {
        question,
        options,
        allowCustom: source.allowCustom === true,
        customLabel,
        placeholder
    };
}
