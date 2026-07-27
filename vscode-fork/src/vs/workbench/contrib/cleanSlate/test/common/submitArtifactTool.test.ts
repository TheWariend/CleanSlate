/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ACTIVE_GROUP } from '../../../../services/editor/common/editorService.js';
import { submitArtifactTool } from '../../browser/tools/SubmitArtifactTool.js';

function workspaceContext(folderPath: string, id: string): any {
    return {
        getWorkspace: () => ({ id, folders: folderPath ? [{ uri: URI.file(folderPath) }] : [] }),
        getWorkspaceFolder: (resource: URI) => (folderPath && resource.fsPath.startsWith(folderPath) ? { uri: URI.file(folderPath) } : null)
    };
}

suite('submitArtifactTool', () => {
    function createContext(hasPlan = true): any {
        return {
            artifactService: {
                getLatestArtifactByType: (type: string) => {
                    if (!hasPlan) {
                        return undefined;
                    }
                    if (type === 'implementation_plan') {
                        return {
                            content: '# Implementation Plan',
                            timestamp: Date.now()
                        };
                    }
                    return undefined;
                }
            }
        };
    }

    test('requires an existing planning artifact before accepting a handoff', async () => {
        const result = await submitArtifactTool.run({
            summary: "I've drafted the dark-mode implementation plan and it is ready for review."
        }, createContext(false));

        assert.strictEqual(result.success, false);
        assert.strictEqual(result.code, 'missing_planning_artifact');
    });

    test('requires a task-specific handoff summary', async () => {
        const result = await submitArtifactTool.run({}, createContext());

        assert.strictEqual(result.success, false);
        assert.strictEqual(result.code, 'missing_handoff_summary');
    });

    test('returns the model-authored handoff summary', async () => {
        const summary = "I've drafted the dark-mode implementation plan and it is ready for review.";
        const result = await submitArtifactTool.run({ summary }, createContext());

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.path, 'implementation_plan.md');
        assert.strictEqual(result.summary, summary);
    });

    test('saves authored artifacts with session metadata', async () => {
        let saved: { type: string; content: string; metadata: any } | undefined;
        const context = {
            surface: 'agentManager',
            sessionId: 'session-1',
            artifactService: {
                saveArtifact: (type: string, content: string, metadata: any) => {
                    saved = { type, content, metadata };
                    return { id: 'artifact-1', type, content, timestamp: Date.now(), metadata };
                }
            }
        };

        const result = await submitArtifactTool.run({
            summary: 'Plan ready.',
            path: 'implementation_plan.md',
            content: '# Plan'
        }, context as any);

        assert.strictEqual(result.success, true);
        assert.strictEqual(saved?.type, 'implementation_plan');
        assert.strictEqual(saved?.metadata.sessionId, 'session-1');
        assert.strictEqual(saved?.metadata.surface, 'agentManager');
    });

    test('opens authored IDE artifacts in the active editor group', async () => {
        let openedGroup: unknown;
        let openedOptions: any;
        const artifactInput = { id: 'artifact-input' };
        const context = {
            surface: 'ide',
            sessionId: 'session-1',
            artifactService: {
                saveArtifact: (type: string, content: string, metadata: any) => ({ id: 'artifact-1', type, content, timestamp: Date.now(), metadata })
            },
            instantiationService: {
                createInstance: () => artifactInput
            },
            editorService: {
                openEditor: async (_input: unknown, options: unknown, group: unknown) => {
                    openedOptions = options;
                    openedGroup = group;
                }
            }
        };

        const result = await submitArtifactTool.run({
            summary: 'Plan ready.',
            path: 'implementation_plan.md',
            content: '# Plan'
        }, context as any);

        assert.strictEqual(result.success, true);
        assert.strictEqual(openedGroup, ACTIVE_GROUP);
        assert.strictEqual(openedOptions?.preserveFocus, false);
    });

    test('opens Agent Manager-authored artifacts in IDE active group without stealing focus', async () => {
        let openedGroup: unknown;
        let openedOptions: any;
        const artifactInput = { id: 'artifact-input' };
        const context = {
            surface: 'agentManager',
            sessionId: 'session-1',
            artifactService: {
                saveArtifact: (type: string, content: string, metadata: any) => ({ id: 'artifact-1', type, content, timestamp: Date.now(), metadata })
            },
            instantiationService: {
                createInstance: () => artifactInput
            },
            editorService: {
                openEditor: async (_input: unknown, options: unknown, group: unknown) => {
                    openedOptions = options;
                    openedGroup = group;
                }
            }
        };

        const result = await submitArtifactTool.run({
            summary: 'Plan ready.',
            path: 'implementation_plan.md',
            content: '# Plan'
        }, context as any);

        assert.strictEqual(result.success, true);
        assert.strictEqual(openedGroup, ACTIVE_GROUP);
        assert.strictEqual(openedOptions?.preserveFocus, true);
    });

    test('opens same-project Agent Manager artifacts in the IDE editor', async () => {
        let opened = false;
        const context = {
            surface: 'agentManager',
            sessionId: 'session-1',
            workspaceContextService: workspaceContext('/projects/app-a', 'ws-a'),
            ideWorkspaceContextService: workspaceContext('/projects/app-a', 'ws-a'),
            artifactService: {
                saveArtifact: (type: string, content: string, metadata: any) => ({ id: 'artifact-1', type, content, timestamp: Date.now(), metadata })
            },
            instantiationService: { createInstance: () => ({ id: 'artifact-input' }) },
            editorService: {
                openEditor: async () => { opened = true; }
            }
        };

        const result = await submitArtifactTool.run({
            summary: 'Plan ready.',
            path: 'implementation_plan.md',
            content: '# Plan'
        }, context as any);

        assert.strictEqual(result.success, true);
        assert.strictEqual(opened, true, 'artifact should open when the session project matches the IDE project');
    });

    test('does not leak artifacts into the IDE when the session project differs from the open project', async () => {
        let opened = false;
        let saved = false;
        const context = {
            surface: 'agentManager',
            sessionId: 'session-1',
            workspaceContextService: workspaceContext('/projects/app-a', 'ws-a'),
            ideWorkspaceContextService: workspaceContext('/projects/app-b', 'ws-b'),
            artifactService: {
                saveArtifact: (type: string, content: string, metadata: any) => { saved = true; return { id: 'artifact-1', type, content, timestamp: Date.now(), metadata }; }
            },
            instantiationService: { createInstance: () => ({ id: 'artifact-input' }) },
            editorService: {
                openEditor: async () => { opened = true; }
            }
        };

        const result = await submitArtifactTool.run({
            summary: 'Plan ready.',
            path: 'implementation_plan.md',
            content: '# Plan'
        }, context as any);

        assert.strictEqual(result.success, true);
        assert.strictEqual(saved, true, 'artifact must still be saved');
        assert.strictEqual(opened, false, 'artifact must not open in a different project\'s IDE editor');
    });

    test('finalizes artifacts using the active session lookup', async () => {
        const lookups: Array<{ type: string; sessionId?: string }> = [];
        const context = {
            sessionId: 'session-2',
            artifactService: {
                getLatestArtifactByType: (type: string, options?: { sessionId?: string }) => {
                    lookups.push({ type, sessionId: options?.sessionId });
                    if (type === 'implementation_plan') {
                        return { content: '# Session Plan', timestamp: Date.now() };
                    }
                    return undefined;
                }
            }
        };

        const result = await submitArtifactTool.run({ summary: 'Ready for review.' }, context as any);

        assert.strictEqual(result.success, true);
        assert.deepStrictEqual(lookups, [
            { type: 'implementation_plan', sessionId: 'session-2' },
            { type: 'analysis', sessionId: 'session-2' }
        ]);
    });
});
