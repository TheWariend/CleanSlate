/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
    getCleanSlateSearchActivityPresentation,
    isCleanSlateQuerySearchGroup
} from '../../browser/chat/renderers/cleanSlateActivityPresentation.js';

suite('CleanSlate activity presentation', () => {
    test('presents discovery queries with their workspace scope', () => {
        const first = {
            label: 'Explored thewariend',
            path: '/workspace/Mind_Sort',
            query: 'thewariend',
            type: 'explore' as const
        };
        const second = {
            label: 'Explored developed by',
            path: '/workspace/Mind_Sort',
            query: 'developed by',
            type: 'explore' as const
        };

        assert.strictEqual(isCleanSlateQuerySearchGroup(2, 0, [first, second]), true);
        assert.deepStrictEqual(getCleanSlateSearchActivityPresentation(first, 'Mind_Sort'), {
            action: 'Searched',
            query: 'thewariend',
            scope: 'Mind_Sort'
        });
        assert.deepStrictEqual(getCleanSlateSearchActivityPresentation(second, 'Mind_Sort'), {
            action: 'Searched',
            query: 'developed by',
            scope: 'Mind_Sort'
        });
    });

    test('uses an active label while a query is running', () => {
        assert.deepStrictEqual(getCleanSlateSearchActivityPresentation({
            label: 'Exploring thewariend',
            path: '/workspace/Mind_Sort',
            query: 'thewariend',
            type: 'explore'
        }, 'Mind_Sort'), {
            action: 'Searching',
            query: 'thewariend',
            scope: 'Mind_Sort'
        });
    });
});
