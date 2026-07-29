/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CleanSlateThreadService } from '@cleanslate/sdk/services/cleanSlateThreadService.js';

suite('CleanSlateThreadService', () => {
    test('preserves oversized historical tool output until context budgeting runs', () => {
        const threadService = new CleanSlateThreadService();
        const largeToolOutput = `Tool "semantic_search" executed successfully. Result: ${'x'.repeat(2500)}`;

        threadService.addMessage('system', largeToolOutput, true);

        const [message] = threadService.getHistory();
        assert.strictEqual(message.content, largeToolOutput);
        assert.strictEqual(message.isInternalState, true);
    });
});
