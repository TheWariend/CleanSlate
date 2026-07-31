/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ICleanSlatePersistedSession } from '../protocol/cleanSlateAI.js';
import {
	resolveArchivedSessionWorkspaceId,
	toArchivedSessionSnapshot
} from '../protocol/cleanSlateThreadSession.js';

describe('published thread session archival', () => {
	const base: ICleanSlatePersistedSession = { id: 's1', title: 't', savedAt: 0, history: [] };

	test('prefers project root over the weaker workspace identifiers', () => {
		assert.equal(
			resolveArchivedSessionWorkspaceId({ ...base, projectRoot: '/a', workDir: '/b', workspaceId: 'c', workspaceName: 'd' }),
			'/a'
		);
	});

	test('walks the fallback chain in order', () => {
		assert.equal(resolveArchivedSessionWorkspaceId({ ...base, workDir: '/b', workspaceId: 'c' }), '/b');
		assert.equal(resolveArchivedSessionWorkspaceId({ ...base, workspaceId: 'c', workspaceName: 'd' }), 'c');
		assert.equal(resolveArchivedSessionWorkspaceId({ ...base, workspaceName: 'd' }), 'd');
		assert.equal(resolveArchivedSessionWorkspaceId(base), 'default');
	});

	test('treats whitespace-only identifiers as absent', () => {
		assert.equal(resolveArchivedSessionWorkspaceId({ ...base, projectRoot: '   ', workDir: '/b' }), '/b');
	});

	test('records a still-running session as detached, not running', () => {
		const archived = toArchivedSessionSnapshot({ ...base, status: 'running', isGenerating: true });
		assert.equal(archived.status, 'detached');
		assert.equal(archived.isGenerating, undefined);
	});

	test('detaches a session that was generating under a non-running status', () => {
		assert.equal(toArchivedSessionSnapshot({ ...base, status: 'starting', isGenerating: true }).status, 'detached');
	});

	test('leaves a settled status alone', () => {
		assert.equal(toArchivedSessionSnapshot({ ...base, status: 'stopped' }).status, 'stopped');
	});
});
