/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CleanSlateDiffService } from '../services/cleanSlateDiffService.js';

describe('diff line statistics', () => {
    it('counts only inserted, replaced, and deleted lines', () => {
        assert.deepEqual(
            CleanSlateDiffService.computeLineChangeStats('one\ntwo\nthree\n', 'one\nnew\ntwo\nthree\n'),
            { added: 1, deleted: 0 }
        );
        assert.deepEqual(
            CleanSlateDiffService.computeLineChangeStats('one\ntwo\nthree\n', 'one\nnew\nthree\n'),
            { added: 1, deleted: 1 }
        );
        assert.deepEqual(
            CleanSlateDiffService.computeLineChangeStats('one\ntwo\nthree\n', 'one\nthree\n'),
            { added: 0, deleted: 1 }
        );
    });
});
