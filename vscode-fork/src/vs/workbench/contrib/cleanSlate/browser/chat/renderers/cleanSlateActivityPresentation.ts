/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { InteractionBlock } from '../types/cleanSlateChatTypes.js';

export type ICleanSlateActivityDetailMetadata = NonNullable<InteractionBlock['detailMetadata']>[number];

export interface ICleanSlateSearchActivityPresentation {
    action: 'Searching' | 'Searched';
    query: string;
    scope: string;
}

export function isCleanSlateQuerySearchGroup(
    searchCount: number,
    fileCount: number,
    detailsMetadata: readonly ICleanSlateActivityDetailMetadata[]
): boolean {
    const searchMetadata = detailsMetadata.filter(meta => meta.type === 'explore');
    return searchCount > 0
        && fileCount === 0
        && searchMetadata.length > 0
        && searchMetadata.every(meta => !!meta.query);
}

export function getCleanSlateSearchActivityPresentation(
    metadata: ICleanSlateActivityDetailMetadata,
    scope: string
): ICleanSlateSearchActivityPresentation | undefined {
    const query = metadata.query?.trim();
    if (metadata.type !== 'explore' || !query) {
        return undefined;
    }

    return {
        action: metadata.label.startsWith('Exploring ') ? 'Searching' : 'Searched',
        query,
        scope
    };
}
