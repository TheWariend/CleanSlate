/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeToolResultForRenderer, serializeToolResultForPrompt } from '../agent/cleanSlateToolResultPromptSerializer.js';

test('file diff snapshots stay complete in the renderer without expanding model output', () => {
    const content = 'line of file contents\n'.repeat(1000);
    const source = { success: true, created: true, path: '/workspace/new.ts', beforeContent: '', afterContent: content };
    const result = sanitizeToolResultForRenderer('write_file', source) as typeof source;
    assert.equal(result.afterContent, content);
    assert.equal(result.beforeContent, '');
    assert.equal(result.created, true);
    assert.ok(serializeToolResultForPrompt('write_file', source).length < content.length);
    const batch = sanitizeToolResultForRenderer('create_multiple_files', { results: [source] }) as { results: typeof source[] };
    assert.equal(batch.results[0].afterContent, content);
});
