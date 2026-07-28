/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CleanSlateTool, CleanSlateToolContext } from './types.js';
import { resolvePathToUri } from './utils.js';
import { Position } from '../core/position.js';
import { buildSymbolContext, getOwnerHierarchyForLine } from './symbolContext.js';
import { fireDefinitionProvider, resolveBackgroundLanguageFeatureModel } from './languageFeatureActivation.js';
import { cancellationTokenFromAbortSignal } from '../services/cleanSlateCancellation.js';

export const getDefinitionsTool: CleanSlateTool = {
    name: 'get_definitions',
    description: 'Find the definition(s) of a symbol at a specific line and column. Essential for understanding types and cross-file signatures.',
    parametersSchema: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Path to the file relative to the workspace root.' },
            line: { type: 'number', description: 'Line number (1-indexed).' },
            column: { type: 'number', description: 'Column number (1-indexed).' }
        },
        required: ['path', 'line', 'column']
    },
    async run(input: any, context: CleanSlateToolContext) {
        if (!input.path || typeof input.path !== 'string') {
            return {
                success: false,
                code: 'invalid_input',
                message: 'The "path" argument is required and must be a non-empty string.',
                recoveryHint: 'Specify the relative path to the file you want to get definitions for.'
            };
        }

        if (!context.languageFeaturesService && !context.commandService) {
            return { success: false, message: 'Language features command and provider services are not available.' };
        }

        const uri = resolvePathToUri(input.path, context);
        const line = Number.isFinite(input.line) ? Math.max(1, Math.floor(input.line)) : Math.max(1, Math.floor(Number(input.line) || 1));
        const column = Number.isFinite(input.column) ? Math.max(1, Math.floor(input.column)) : Math.max(1, Math.floor(Number(input.column) || 1));
        const position = new Position(line, column);
        // 1. Fire the language server in the background before checking providers.
        const firedDefinitions = await fireDefinitionProvider(uri, position, context);
        const model = await resolveBackgroundLanguageFeatureModel(uri, context);
        if (!model) {
            return {
                success: true,
                path: input.path,
                line,
                column,
                ownerHierarchy: [],
                definitions: formatLocations(firedDefinitions),
                message: 'Definitions returned from the background language-feature command without opening a visible editor model.'
            };
        }

        // 2. Wait for providers to register
        let providers = context.languageFeaturesService?.definitionProvider.ordered(model) ?? [];
        if (providers.length === 0) {
            for (let i = 0; i < 10; i++) {
                await new Promise(resolve => setTimeout(resolve, 200));
                providers = context.languageFeaturesService?.definitionProvider.ordered(model) ?? [];
                if (providers.length > 0) break;
            }
        }

        if (providers.length === 0) {
            const commandDefinitions = formatLocations(firedDefinitions);
            return { 
                success: true, 
                path: input.path, 
                line, 
                column, 
                ownerHierarchy: [],
                definitions: commandDefinitions,
                message: commandDefinitions.length > 0
                    ? 'Definitions returned from the background language-feature command.'
                    : 'No definition providers found for this file type.'
            };
        }

        const allDefinitions: any[] = Array.isArray(firedDefinitions) ? [...firedDefinitions] : [];
        const token = cancellationTokenFromAbortSignal(context.signal);
        for (const provider of providers) {
            const result = await provider.provideDefinition(model, position, token);
            if (result) {
                if (Array.isArray(result)) {
                    allDefinitions.push(...result);
                } else {
                    allDefinitions.push(result);
                }
            }
        }

        const documentSymbols: any[] = [];
        for (const provider of context.languageFeaturesService?.documentSymbolProvider.ordered(model) ?? []) {
            const symbols = await provider.provideDocumentSymbols(model, token);
            if (symbols) {
                documentSymbols.push(...symbols);
            }
        }
        const symbolContext = buildSymbolContext(documentSymbols, model.getLineCount());
        const ownerHierarchy = getOwnerHierarchyForLine(line, symbolContext.symbols).map(owner => ({
            name: owner.name,
            kind: owner.kindLabel,
            symbolPath: owner.path,
            range: owner.range
        }));

        return {
            success: true,
            path: input.path,
            line,
            column,
            ownerHierarchy,
            definitions: formatLocations(allDefinitions)
        };
    }
};

function formatLocations(locations: unknown): Array<{ uri: string; range: { startLine: number; startColumn: number; endLine: number; endColumn: number } }> {
    if (!Array.isArray(locations)) {
        return [];
    }

    return locations
        .map((location: any) => {
            const uri = location?.uri?.toString?.() ?? location?.targetUri?.toString?.();
            const range = location?.range ?? location?.targetRange;
            if (!uri || !range) {
                return undefined;
            }
            return {
                uri,
                range: {
                    startLine: range.startLineNumber,
                    startColumn: range.startColumn,
                    endLine: range.endLineNumber,
                    endColumn: range.endColumn
                }
            };
        })
        .filter((location): location is { uri: string; range: { startLine: number; startColumn: number; endLine: number; endColumn: number } } => !!location);
}
