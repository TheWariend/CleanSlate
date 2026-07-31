/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICleanSlatePersistedSession } from './cleanSlateAI.js';

/**
 * The bucket an archived session belongs to. Identity is the workspace the
 * session ran in, but sessions arrive from hosts that populate different
 * fields — the editor knows a project root, a headless run may only know a work
 * dir. Every writer must agree on this order or the same session lands under
 * two keys and the archive lists it twice.
 */
export function resolveArchivedSessionWorkspaceId(session: ICleanSlatePersistedSession): string {
	return session.projectRoot?.trim()
		|| session.workDir?.trim()
		|| session.workspaceId?.trim()
		|| session.workspaceName?.trim()
		|| 'default';
}

/**
 * Rewrites a session for archival after it was published by whichever host owns
 * it. A session that was still generating is recorded as `detached` rather than
 * `running`: the run does not survive the publish, and a persisted `running`
 * status would show as a live agent that nothing is driving.
 */
export function toArchivedSessionSnapshot(session: ICleanSlatePersistedSession): ICleanSlatePersistedSession {
	const wasLive = session.status === 'running' || session.isGenerating === true;
	return {
		...session,
		status: wasLive ? 'detached' : session.status,
		isGenerating: undefined,
		updatedAt: Date.now()
	};
}
