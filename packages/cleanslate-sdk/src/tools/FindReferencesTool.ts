/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Position } from '../core/position.js';
import { CleanSlateTool, CleanSlateToolContext } from './types.js';
import { resolvePathToUriAsync } from './utils.js';
import { fireReferenceProvider, resolveBackgroundLanguageFeatureModel } from './languageFeatureActivation.js';
import { cancellationTokenFromAbortSignal } from '../services/cleanSlateCancellation.js';

export const findReferencesTool: CleanSlateTool = {
	name: 'find_references',
	description: 'Find all references for the symbol at a given path/line/column. Use this to map blast radius before edits.',
	parametersSchema: {
		type: 'object',
		properties: {
			path: { type: 'string', description: 'Path to the file relative to the workspace root.' },
			line: { type: 'number', description: 'Line number (1-indexed).' },
			column: { type: 'number', description: 'Column number (1-indexed).' },
			includeDeclaration: { type: 'boolean', description: 'Whether to include the symbol declaration in results. Defaults to false.' }
		},
		required: ['path', 'line', 'column']
	},
	category: 'discovery',
	async run(input: any, context: CleanSlateToolContext) {
		if (!input.path || typeof input.path !== 'string') {
			return {
				success: false,
				code: 'invalid_input',
				message: 'The "path" argument is required and must be a non-empty string.',
				recoveryHint: 'Specify the relative path to the file you want to find references in.'
			};
		}

		if (!context.languageFeaturesService && !context.commandService) {
			return { success: false, message: 'Language features command and provider services are not available.' };
		}

		const line = Number.isFinite(input.line) ? Math.max(1, Math.floor(input.line)) : Math.max(1, Math.floor(Number(input.line) || 1));
		const column = Number.isFinite(input.column) ? Math.max(1, Math.floor(input.column)) : Math.max(1, Math.floor(Number(input.column) || 1));
		const includeDeclaration = input.includeDeclaration === true;
		const position = new Position(line, column);
		const uri = await resolvePathToUriAsync(input.path, context);
		const firedReferences = await fireReferenceProvider(uri, position, context);
		const model = await resolveBackgroundLanguageFeatureModel(uri, context);
		if (!model) {
			const references = dedupeLocations(firedReferences);
			return {
				success: true,
				path: input.path,
				line,
				column,
				includeDeclaration,
				count: references.length,
				references,
				message: references.length > 0
					? 'References returned from the background language-feature command without opening a visible editor model.'
					: 'No model was loaded after background LSP activation.'
			};
		}

		// 2. Wait for providers to register
		let providers = context.languageFeaturesService?.referenceProvider.ordered(model) ?? [];
		if (providers.length === 0) {
			for (let i = 0; i < 10; i++) {
				await new Promise(resolve => setTimeout(resolve, 200));
				providers = context.languageFeaturesService?.referenceProvider.ordered(model) ?? [];
				if (providers.length > 0) break;
			}
		}

		if (providers.length === 0) {
			const references = dedupeLocations(firedReferences);
			return { 
				success: true, 
				path: input.path, 
				line, 
				column, 
				includeDeclaration,
				count: references.length,
				references,
				message: references.length > 0
					? 'References returned from the background language-feature command.'
					: 'No reference providers found for this file type.'
			};
		}

		const allReferences: any[] = Array.isArray(firedReferences) ? [...firedReferences] : [];
		const token = cancellationTokenFromAbortSignal(context.signal);
		for (const provider of providers) {
			const result = await provider.provideReferences(
				model,
				position,
				{ includeDeclaration },
				token
			);
			if (Array.isArray(result) && result.length > 0) {
				allReferences.push(...result);
			}
		}

		const references = dedupeLocations(allReferences);

		return {
			success: true,
			path: input.path,
			line,
			column,
			includeDeclaration,
			count: references.length,
			references
		};
	}
};

function dedupeLocations(locations: unknown): Array<{
	uri: string;
	range: { startLine: number; startColumn: number; endLine: number; endColumn: number };
}> {
	if (!Array.isArray(locations)) {
		return [];
	}

	const deduped = new Map<string, {
		uri: string;
		range: { startLine: number; startColumn: number; endLine: number; endColumn: number };
	}>();

	for (const reference of locations) {
		const refUri = reference?.uri?.toString?.() ?? reference?.targetUri?.toString?.();
		const range = reference?.range ?? reference?.targetRange;
		if (!refUri || !range) {
			continue;
		}
		const key = `${refUri}:${range.startLineNumber}:${range.startColumn}:${range.endLineNumber}:${range.endColumn}`;
		if (!deduped.has(key)) {
			deduped.set(key, {
				uri: refUri,
				range: {
					startLine: range.startLineNumber,
					startColumn: range.startColumn,
					endLine: range.endLineNumber,
					endColumn: range.endColumn
				}
			});
		}
	}

	return Array.from(deduped.values());
}
