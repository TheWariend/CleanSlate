/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CleanSlateCommandApprovalService } from '../../browser/core/cleanSlateCommandApprovalService.js';

suite('CleanSlateCommandApprovalService', () => {
	test('registers pending approval before change listeners run', async () => {
		const service = new CleanSlateCommandApprovalService();
		let pendingIdDuringChange: string | undefined;

		service.onDidChangeApprovalRequests(() => {
			pendingIdDuringChange = service.getPendingApproval()?.id;
		});

		const approval = service.requestApproval({
			id: 'approval-1',
			command: 'npm run build',
			toolCallId: 'call-1'
		});

		assert.strictEqual(pendingIdDuringChange, 'approval-1');
		assert.strictEqual(service.getPendingApproval()?.toolCallId, 'call-1');

		assert.strictEqual(service.approve('approval-1'), true);
		assert.strictEqual(await approval, true);
		service.dispose();
	});

	test('resolves the latest approval from chat text', async () => {
		const service = new CleanSlateCommandApprovalService();
		const approval = service.requestApproval({
			id: 'approval-2',
			command: 'npm run lint'
		});

		assert.strictEqual(service.resolveFromChat('no'), 'rejected');
		assert.strictEqual(await approval, false);
		assert.strictEqual(service.hasPendingApproval(), false);
		service.dispose();
	});

	test('resumes the approval promise before resolve listeners run', async () => {
		const service = new CleanSlateCommandApprovalService();
		const order: string[] = [];
		const approval = service.requestApproval({
			id: 'approval-3',
			command: 'npm run build'
		}).then(approved => {
			order.push('promise');
			return approved;
		});

		service.onDidResolveApproval(() => {
			order.push('event');
		});

		assert.strictEqual(service.approve('approval-3'), true);
		assert.strictEqual(await approval, true);
		assert.deepStrictEqual(order, ['promise', 'event']);
		service.dispose();
	});

	test('filters pending approvals by session', async () => {
		const service = new CleanSlateCommandApprovalService();
		const sessionA = service.requestApproval({
			id: 'approval-session-a',
			sessionId: 'session-a',
			command: 'npm run a'
		});
		const sessionB = service.requestApproval({
			id: 'approval-session-b',
			sessionId: 'session-b',
			command: 'npm run b'
		});

		assert.strictEqual(service.getPendingApproval('session-a')?.id, 'approval-session-a');
		assert.strictEqual(service.getPendingApproval('session-b')?.id, 'approval-session-b');
		assert.strictEqual(service.resolveFromChat('yes', 'session-a'), 'approved');
		assert.strictEqual(await sessionA, true);
		assert.strictEqual(service.hasPendingApproval('session-a'), false);
		assert.strictEqual(service.hasPendingApproval('session-b'), true);

		service.rejectAll('session-b');
		assert.strictEqual(await sessionB, false);
		service.dispose();
	});
});
