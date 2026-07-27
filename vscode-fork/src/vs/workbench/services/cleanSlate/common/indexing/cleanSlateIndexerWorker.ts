/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CleanSlateCodeParser, ICodeChunk } from './cleanSlateCodeParser.js';

export interface IParseRequest {
    text: string;
    languageId: string;
}

export interface IParseResponse {
    chunks: ICodeChunk[];
}

/**
 * CleanSlate Indexer Worker Entry Point
 * Handles CPU-intensive parsing and chunking in a background thread.
 */
function initializeWorker() {
    self.onmessage = (e: MessageEvent<IParseRequest>) => {
        try {
            const { text, languageId } = e.data;
            const chunks = CleanSlateCodeParser.parse(text, languageId);
            self.postMessage({ chunks } as IParseResponse);
        } catch (error) {
            console.error('[CleanSlateIndexerWorker] Error during parsing:', error);
            // @ts-ignore
            self.postMessage({ error: error.message });
        }
    };
}

initializeWorker();
