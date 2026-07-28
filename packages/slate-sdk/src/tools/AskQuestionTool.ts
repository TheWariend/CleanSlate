/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CleanSlateTool } from './types.js';

interface IAskQuestionInput {
	summary?: string;
	question?: string;
	options?: Array<string | { label?: string; description?: string; recommended?: boolean }>;
	allowCustom?: boolean;
	customLabel?: string;
	placeholder?: string;
}

type AskQuestionOption = { label: string; description?: string; recommended?: boolean };

export const askQuestionTool: CleanSlateTool = {
	name: 'ask_question',
	description: 'Asks the user one blocking question through a structured native tool call. Works in both planning and normal execution. Use only when no useful progress can continue without the decision.',
	category: 'system',
	parametersSchema: {
		type: 'object',
		properties: {
			summary: {
				type: 'string',
				description: 'A concise model-authored sentence explaining why the decision is needed.'
			},
			question: {
				type: 'string',
				description: 'The concrete decision needed from the user.'
			},
			options: {
				type: 'array',
				description: 'Two to four mutually exclusive answer choices.',
				items: {
					anyOf: [
						{ type: 'string' },
						{
							type: 'object',
							properties: {
								label: { type: 'string' },
								description: { type: 'string' },
								recommended: { type: 'boolean' }
							},
							required: ['label']
						}
					]
				}
			},
			allowCustom: {
				type: 'boolean',
				description: 'Whether the user may provide a custom answer.'
			},
			customLabel: {
				type: 'string',
				description: 'Optional label for the custom answer field.'
			},
			placeholder: {
				type: 'string',
				description: 'Optional placeholder for the custom answer field.'
			}
		},
		required: ['question', 'options']
	},
	async run(input: IAskQuestionInput): Promise<any> {
		const summary = normalizeOptionalString(input.summary);
		const question = normalizeOptionalString(input.question);
		const options = normalizeOptions(input.options);

		if (!question) {
			return {
				success: false,
				code: 'missing_question',
				message: 'ask_question requires a concrete question.'
			};
		}

		if (options.length === 0) {
			return {
				success: false,
				code: 'missing_question_options',
				message: 'ask_question requires at least one answer option.'
			};
		}

		return {
			success: true,
			summary,
			planning_question: {
				question,
				options,
				allowCustom: input.allowCustom === true,
				customLabel: normalizeOptionalString(input.customLabel),
				placeholder: normalizeOptionalString(input.placeholder)
			}
		};
	}
};

function normalizeOptionalString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeOptions(options: IAskQuestionInput['options']): AskQuestionOption[] {
	if (!Array.isArray(options)) {
		return [];
	}

	return options
		.map((option): AskQuestionOption | undefined => {
			if (typeof option === 'string') {
				const label = option.trim();
				return label ? { label } : undefined;
			}

			if (!option || typeof option !== 'object') {
				return undefined;
			}

			const label = normalizeOptionalString(option.label);
			if (!label) {
				return undefined;
			}

			return {
				label,
				description: normalizeOptionalString(option.description),
				recommended: option.recommended === true
			};
		})
		.filter((option): option is AskQuestionOption => !!option)
		.slice(0, 4);
}
