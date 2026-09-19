/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExternalFileSnapshots } from '../node/externalAgents/externalFileSnapshots.js';

test('fresh turn captures actual new and modified contents without provider diffs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cleanslate-file-evidence-'));
    try {
        await writeFile(join(root, 'existing.html'), 'before');
        const snapshot = await ExternalFileSnapshots.capture(root);
        await writeFile(join(root, 'existing.html'), 'after');
        await mkdir(join(root, 'website'));
        await writeFile(join(root, 'website', 'index.html'), '<h1>New</h1>');
        const changes = await snapshot.changes({ type: 'tool', cleanSlateSessionId: 'chat', toolCallId: 'write', kind: 'edit', status: 'completed', locations: [join(root, 'existing.html'), join(root, 'website', 'index.html')] });
        assert.deepEqual(changes?.map(({ beforeContent, afterContent, created }) => ({ beforeContent, afterContent, created })), [
            { beforeContent: 'before', afterContent: 'after', created: false },
            { beforeContent: '', afterContent: '<h1>New</h1>', created: true }
        ]);
        await writeFile(join(root, 'website', 'index.html'), '<h1>Updated</h1>');
        const next = await snapshot.changes({ type: 'tool', cleanSlateSessionId: 'chat', toolCallId: 'second-write', kind: 'edit', status: 'completed', locations: [join(root, 'website', 'index.html')] });
        assert.equal(next?.[0].created, false);
        assert.equal(next?.[0].beforeContent, '<h1>New</h1>');
        assert.equal(next?.[0].afterContent, '<h1>Updated</h1>');
        await symlink(tmpdir(), join(root, 'external'));
        assert.equal(await snapshot.changes({ type: 'tool', cleanSlateSessionId: 'chat', toolCallId: 'unsafe', locations: [join(root, 'external', 'anything'), '../outside'] }), undefined);
    } finally { await rm(root, { recursive: true, force: true }); }
});
