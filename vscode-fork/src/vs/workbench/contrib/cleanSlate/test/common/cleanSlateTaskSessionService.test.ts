/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { AgentPhase } from '@cleanslate/sdk/agent/cleanSlatePrompts.js';
import { CleanSlateTaskSessionService } from '@cleanslate/sdk/services/cleanSlateTaskSessionService.js';
import { CleanSlateTaskKind, CleanSlateTaskLifecycleStatus, CleanSlateWorkspaceShape } from '@cleanslate/sdk/services/cleanSlateTaskState.js';

suite('CleanSlateTaskSessionService', () => {
    test('archives the previous run when a new task starts', () => {
        const service = new CleanSlateTaskSessionService();
        service.startNewTask(CleanSlateTaskKind.MODIFY_EXISTING, CleanSlateWorkspaceShape.EXISTING, 'first task');
        service.updateToDo(['[ ] edit screen']);
        service.recordAssistantSummary('Finished the first task');
        service.markCompleted();

        service.startNewTask(CleanSlateTaskKind.MODIFY_EXISTING, CleanSlateWorkspaceShape.EXISTING, 'second task');

        const ledger = service.getRunLedger();
        assert.strictEqual(ledger.length, 1);
        assert.strictEqual(ledger[0].objective, 'first task');
        assert.strictEqual(ledger[0].status, CleanSlateTaskLifecycleStatus.COMPLETED);
        assert.strictEqual(service.getRunSummary().objective, 'second task');
    });

    test('archives an in-progress run as interrupted when switching tasks', () => {
        const service = new CleanSlateTaskSessionService();
        service.startNewTask(CleanSlateTaskKind.MODIFY_EXISTING, CleanSlateWorkspaceShape.EXISTING, 'first task');
        service.setPhase(AgentPhase.EXECUTION);
        service.updateToDo(['[ ] keep going']);

        service.startNewTask(CleanSlateTaskKind.MODIFY_EXISTING, CleanSlateWorkspaceShape.EXISTING, 'second task');

        const ledger = service.getRunLedger();
        assert.strictEqual(ledger.length, 1);
        assert.strictEqual(ledger[0].status, CleanSlateTaskLifecycleStatus.INTERRUPTED);
        assert.strictEqual(ledger[0].currentWorkItem, 'keep going');
    });

    test('restores the run ledger from snapshots', () => {
        const service = new CleanSlateTaskSessionService();
        service.startNewTask(CleanSlateTaskKind.MODIFY_EXISTING, CleanSlateWorkspaceShape.EXISTING, 'first task');
        service.markCompleted();
        service.startNewTask(CleanSlateTaskKind.MODIFY_EXISTING, CleanSlateWorkspaceShape.EXISTING, 'second task');

        const snapshot = service.getStateSnapshot();
        snapshot.executionFilesChanged = undefined;
        const restored = new CleanSlateTaskSessionService();
        restored.restoreStateSnapshot(snapshot);

        const ledger = restored.getRunLedger();
        assert.strictEqual(ledger.length, 1);
        assert.strictEqual(ledger[0].objective, 'first task');
        assert.strictEqual(restored.getRunSummary().objective, 'second task');
    });

    test('records structured evidence and restores it from snapshots', () => {
        const service = new CleanSlateTaskSessionService();
        service.startNewTask(CleanSlateTaskKind.MODIFY_EXISTING, CleanSlateWorkspaceShape.EXISTING, 'inspect the app');
        service.setPhase(AgentPhase.EXECUTION);

        service.recordEvidence({
            kind: 'browser',
            phase: AgentPhase.EXECUTION,
            status: CleanSlateTaskLifecycleStatus.EXECUTING,
            toolName: 'browser_screenshot',
            success: true,
            url: 'http://localhost:3000/',
            browserPageCount: 4,
            screenshotCount: 8,
            result: { pages: [{ url: 'http://localhost:3000/' }], screenshot: 'data:image/png;base64,large' }
        });
        service.recordEvidence({
            kind: 'mutation',
            phase: AgentPhase.EXECUTION,
            status: CleanSlateTaskLifecycleStatus.EXECUTING,
            toolName: 'apply_edit',
            filesChanged: [{ path: 'src\\app.ts', added: 3, deleted: 1 }]
        });

        const restored = new CleanSlateTaskSessionService();
        restored.restoreStateSnapshot(service.getStateSnapshot());

        const evidence = restored.getEvidenceLedger();
        assert.strictEqual(evidence.length, 2);
        assert.strictEqual(evidence[0].kind, 'browser');
        assert.strictEqual(evidence[0].screenshotCount, 8);
        assert.strictEqual(evidence[1].kind, 'mutation');
        assert.deepStrictEqual(restored.getExecutionFilesChanged(), [{ path: 'src/app.ts', added: 3, deleted: 1 }]);
        assert.strictEqual((evidence[0].result as any).screenshot, '[image-data]');
    });

    test('approving a plan transitions directly into execution', () => {
        const service = new CleanSlateTaskSessionService();
        service.startNewTask(CleanSlateTaskKind.MODIFY_EXISTING, CleanSlateWorkspaceShape.EXISTING, 'update leave flow');
        service.markAwaitingApproval();

        service.approvePlan();

        assert.strictEqual(service.getPhase(), AgentPhase.EXECUTION);
        assert.strictEqual(service.getStatus(), CleanSlateTaskLifecycleStatus.EXECUTING);
        assert.strictEqual(service.isAwaitingApproval(), false);
    });

    test('persists pending recovery in snapshots', () => {
        const service = new CleanSlateTaskSessionService();
        service.startNewTask(CleanSlateTaskKind.MODIFY_EXISTING, CleanSlateWorkspaceShape.EXISTING, 'fix dark mode');
        service.setPendingRecovery('Retry the failed edit with the current file version.', { toolName: 'apply_edit', code: 'recovery_required' });

        const restored = new CleanSlateTaskSessionService();
        restored.restoreStateSnapshot(service.getStateSnapshot());

        assert.strictEqual(restored.hasPendingRecovery(), true);
        assert.strictEqual(restored.getPendingRecovery()?.toolName, 'apply_edit');
    });

    test('does not create automatic browser verification targets from UI mutations', () => {
        const service = new CleanSlateTaskSessionService();
        service.startNewTask(CleanSlateTaskKind.MODIFY_EXISTING, CleanSlateWorkspaceShape.EXISTING, 'implement dark mode');
        service.setPhase(AgentPhase.EXECUTION);

        service.recordEvidence({
            kind: 'mutation',
            phase: AgentPhase.EXECUTION,
            status: CleanSlateTaskLifecycleStatus.EXECUTING,
            toolName: 'apply_edit',
            success: true,
            filesChanged: [{ path: 'src/app/globals.css', added: 4, deleted: 2 }]
        });

        const targetsAfterMutation = service.getPendingVerificationTargets();
        assert.strictEqual(targetsAfterMutation.length, 0);

        service.recordEvidence({
            kind: 'browser',
            phase: AgentPhase.EXECUTION,
            status: CleanSlateTaskLifecycleStatus.EXECUTING,
            toolName: 'browser_snapshot',
            success: true,
            url: 'http://localhost:3000/',
            browserPageCount: 3,
            result: {
                pages: [
                    { url: 'http://localhost:3000/' },
                    { url: 'http://localhost:3000/news' },
                    { url: 'http://localhost:3000/research' }
                ]
            }
        });

        assert.strictEqual(service.hasPendingVerification(), false);
    });

    test('records browser evidence without making browser verification mandatory', () => {
        const service = new CleanSlateTaskSessionService();
        service.startNewTask(CleanSlateTaskKind.MODIFY_EXISTING, CleanSlateWorkspaceShape.EXISTING, 'implement dark mode');
        service.setPhase(AgentPhase.EXECUTION);

        service.recordEvidence({
            kind: 'mutation',
            phase: AgentPhase.EXECUTION,
            status: CleanSlateTaskLifecycleStatus.EXECUTING,
            toolName: 'apply_edit',
            success: true,
            filesChanged: [{ path: 'src/app/globals.css', added: 4, deleted: 2 }]
        });
        service.recordEvidence({
            kind: 'browser',
            phase: AgentPhase.EXECUTION,
            status: CleanSlateTaskLifecycleStatus.EXECUTING,
            toolName: 'browser_snapshot',
            success: true,
            url: 'http://localhost:3000/research',
            browserPageCount: 2,
            result: {
                pages: [
                    { url: 'http://localhost:3000/research' },
                    { url: 'http://localhost:3000/research/multi-phase-execution' }
                ]
            }
        });

        assert.strictEqual(service.hasPendingVerification(), false);
    });

    test('restores legacy PREPARING snapshots as execution', () => {
        const service = new CleanSlateTaskSessionService();
        service.restoreStateSnapshot({
            taskId: 'task-legacy',
            runId: 'run-legacy',
            startedAt: 123,
            phase: 'PREPARING' as any,
            status: 'PREPARING' as any,
            awaitingApproval: false,
            taskKind: CleanSlateTaskKind.MODIFY_EXISTING,
            workspaceShape: CleanSlateWorkspaceShape.EXISTING,
            lastCheckpointAt: 456,
            checkpoints: [{
                id: 'checkpoint-1',
                timestamp: 400,
                kind: 'phase',
                phase: 'PREPARING' as any,
                status: 'PREPARING' as any,
                summary: 'Legacy preparing checkpoint'
            }],
            runLedger: [{
                taskId: 'task-legacy',
                runId: 'run-legacy-1',
                startedAt: 100,
                phase: 'PREPARING' as any,
                status: 'PREPARING' as any,
                toDo: [],
                awaitingApproval: false,
                resumeCount: 0,
                lastCheckpointAt: 401,
                hasPendingRecovery: false,
                hasPendingVerification: false,
                pendingVerificationTargetCount: 0,
                taskKind: CleanSlateTaskKind.MODIFY_EXISTING,
                workspaceShape: CleanSlateWorkspaceShape.EXISTING,
                archivedAt: 999
            }]
        });

        const summary = service.getRunSummary();
        const checkpoints = service.getCheckpoints();
        const ledger = service.getRunLedger();

        assert.strictEqual(summary.phase, AgentPhase.EXECUTION);
        assert.strictEqual(summary.status, CleanSlateTaskLifecycleStatus.EXECUTING);
        assert.strictEqual(checkpoints.length, 1);
        assert.strictEqual(checkpoints[0].phase, AgentPhase.EXECUTION);
        assert.strictEqual(checkpoints[0].status, CleanSlateTaskLifecycleStatus.EXECUTING);
        assert.strictEqual(ledger.length, 1);
        assert.strictEqual(ledger[0].phase, AgentPhase.EXECUTION);
        assert.strictEqual(ledger[0].status, CleanSlateTaskLifecycleStatus.EXECUTING);
    });
});
