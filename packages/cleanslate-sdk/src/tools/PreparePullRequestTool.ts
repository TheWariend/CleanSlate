/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CleanSlateTool } from './types.js';

export interface ICleanSlatePullRequestMetadata {
	title: string;
	body: string;
}

function normalizePullRequestMetadata(input: unknown): ICleanSlatePullRequestMetadata | undefined {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		return undefined;
	}
	const record = input as Record<string, unknown>;
	const title = typeof record.title === 'string' ? record.title.trim() : '';
	const body = typeof record.body === 'string' ? record.body.trim() : '';
	if (!title || !body || title.length > 256 || body.length > 50_000) {
		return undefined;
	}
	return { title, body };
}

export const preparePullRequestTool: CleanSlateTool = {
	name: 'prepare_pull_request',
	description: 'Prepares semantic pull-request metadata after meaningful repository source changes are implemented and verified. The title must describe the actual implementation, never the user prompt or chat title. The body must be a reviewer-facing change description with concise Summary and Verification sections, never a conversation transcript, reasoning log, or progress narration. This tool prepares metadata only; the host decides whether and when to create the pull request.',
	parametersSchema: {
		title: 'string (required) - Concise imperative PR title describing the implemented change (maximum 256 characters).',
		body: 'string (required) - Reviewer-facing Markdown with Summary and Verification sections. Do not include chat transcript, reasoning, or progress narration.'
	},
	category: 'system',
	async run(input: unknown): Promise<any> {
		const pullRequest = normalizePullRequestMetadata(input);
		if (!pullRequest) {
			return {
				success: false,
				code: 'invalid_pull_request_metadata',
				message: 'prepare_pull_request requires a non-empty title (maximum 256 characters) and non-empty body (maximum 50,000 characters).'
			};
		}
		return {
			success: true,
			pullRequest,
			message: 'Pull request metadata prepared for the host.'
		};
	}
};

