/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CleanSlateTool, CleanSlateToolContext } from './types.js';
import { resolvePathToUri } from './utils.js';
import { buildSymbolContext, symbolKindToLabel } from './symbolContext.js';
import { fireDocumentSymbolProvider, resolveBackgroundLanguageFeatureModel } from './languageFeatureActivation.js';
import { cancellationTokenFromAbortSignal } from '../core/cleanSlateCancellation.js';

export const readSymbolsTool: CleanSlateTool = {
    name: 'read_symbols',
    description: 'Fetch all symbols plus a semantic owner map for each line using LSP. Use this to distinguish duplicate method/class names and target edits by symbolPath.',
    parametersSchema: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Path to the file relative to the workspace root.' }
        },
        required: ['path']
    },
    async run(input: any, context: CleanSlateToolContext) {
        if (!input.path || typeof input.path !== 'string') {
            return {
                success: false,
                code: 'invalid_input',
                message: 'The "path" argument is required and must be a non-empty string.',
                recoveryHint: 'Specify the relative path to the file you want to read symbols from.'
            };
        }

        if (!context.languageFeaturesService && !context.commandService) {
            return { success: false, message: 'Language features command and provider services are not available.' };
        }

        const uri = resolvePathToUri(input.path, context);
        const firedSymbols = await fireDocumentSymbolProvider(uri, context);
        const model = await resolveBackgroundLanguageFeatureModel(uri, context);
        if (!model) {
            const fileContent = await context.textFileService.read(uri);
            const totalLines = fileContent.value.split('\n').length;
            const symbols = Array.isArray(firedSymbols) ? firedSymbols : [];
            return {
                success: true,
                path: input.path,
                symbols: symbols.map(formatSymbol),
                symbolContext: buildSymbolContext(symbols, totalLines),
                message: symbols.length > 0
                    ? 'Symbols returned from the background language-feature command.'
                    : 'No model was loaded after background LSP activation.'
            };
        }

        // 2. Wait for providers to register
        let providers = context.languageFeaturesService?.documentSymbolProvider.ordered(model) ?? [];
        if (providers.length === 0) {
            for (let i = 0; i < 10; i++) {
                await new Promise(resolve => setTimeout(resolve, 200));
                providers = context.languageFeaturesService?.documentSymbolProvider.ordered(model) ?? [];
                if (providers.length > 0) break;
            }
        }

        if (providers.length === 0 && (!Array.isArray(firedSymbols) || firedSymbols.length === 0)) {
            return { 
                success: true, 
                path: input.path, 
                symbols: [], 
                symbolContext: [],
                message: 'No semantic symbol providers found after firing the language server for this file type.'
            };
        }

        const allSymbols: any[] = providers.length === 0 && Array.isArray(firedSymbols) ? [...firedSymbols] : [];
        const token = cancellationTokenFromAbortSignal(context.signal);
        for (const provider of providers) {
            const result = await provider.provideDocumentSymbols(model, token);
            if (result) {
                allSymbols.push(...result);
            }
        }

        const symbolContext = buildSymbolContext(allSymbols, model.getLineCount());

        return {
            success: true,
            path: input.path,
            symbols: allSymbols.map(formatSymbol),
            symbolContext
        };
    }
};

function formatSymbol(s: any): any {
    return {
        name: s.name,
        kind: s.kind,
        kindLabel: symbolKindToLabel(s.kind),
        range: {
            start: s.range.startLineNumber,
            end: s.range.endLineNumber
        },
        selectionRange: {
            start: s.selectionRange.startLineNumber,
            end: s.selectionRange.endLineNumber
        },
        children: s.children?.map(formatSymbol)
    };
}
