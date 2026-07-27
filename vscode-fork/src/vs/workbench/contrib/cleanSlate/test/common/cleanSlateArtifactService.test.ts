/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CleanSlateArtifactService } from '../../../../services/cleanSlate/browser/core/cleanSlateArtifactService.js';

suite('CleanSlateArtifactService', () => {
	function createService(): CleanSlateArtifactService {
		return new CleanSlateArtifactService({
			registerProvider: () => ({ dispose: () => undefined })
		} as any);
	}

	test('returns latest artifact by type and session id without leaking other sessions', () => {
		const service = createService();
		service.saveArtifact('implementation_plan', '# Session A v1', { sessionId: 'session-a', filename: 'implementation_plan.md' });
		service.saveArtifact('implementation_plan', '# Session B', { sessionId: 'session-b', filename: 'implementation_plan.md' });
		service.saveArtifact('implementation_plan', '# Session A v2', { sessionId: 'session-a', filename: 'implementation_plan.md' });

		assert.strictEqual(service.getLatestArtifactByType('implementation_plan', { sessionId: 'session-a' })?.content, '# Session A v2');
		assert.strictEqual(service.getLatestArtifactByType('implementation_plan', { sessionId: 'session-b' })?.content, '# Session B');
		assert.deepStrictEqual(
			service.getArtifactsByType('implementation_plan', { sessionId: 'session-a' }).map(artifact => artifact.content),
			['# Session A v2']
		);
	});

	test('falls back to legacy no-session artifacts but not another session', () => {
		const service = createService();
		service.saveArtifact('implementation_plan', '# Legacy', { filename: 'implementation_plan.md' });
		service.saveArtifact('implementation_plan', '# Session B', { sessionId: 'session-b', filename: 'implementation_plan.md' });

		assert.strictEqual(service.getLatestArtifactByType('implementation_plan', { sessionId: 'session-a' })?.content, '# Legacy');
		assert.strictEqual(service.getLatestArtifactByType('implementation_plan', { sessionId: 'session-b' })?.content, '# Session B');
	});
});
