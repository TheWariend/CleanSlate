/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { resolveCommandCwd, resolvePathToUri } from '@cleanslate/sdk/tools/utils.js';

suite('resolvePathToUri', () => {
    const workspaceRoot = URI.file('/tmp/cleanslate-resolver');

    const workspaceContextService = {
        getWorkspace: () => ({
            folders: [{
                uri: workspaceRoot,
                toResource: (path: string) => URI.joinPath(workspaceRoot, path)
            }]
        }),
        getWorkspaceFolder: (uri: URI) => {
            const normalizedRoot = workspaceRoot.fsPath.replace(/\\/g, '/');
            const normalizedTarget = uri.fsPath.replace(/\\/g, '/');
            return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`)
                ? { uri: workspaceRoot }
                : null;
        }
    };

    const context = {
        workspaceContextService
    } as any;

    test('resolves relative paths to the workspace root', () => {
        const resolved = resolvePathToUri('lib/main.dart', context);
        assert.strictEqual(resolved.fsPath, URI.joinPath(workspaceRoot, 'lib/main.dart').fsPath);
    });

    test('keeps absolute paths inside workspace unchanged', () => {
        const target = URI.joinPath(workspaceRoot, 'lib/main.dart');
        const resolved = resolvePathToUri(target.fsPath, context, { allowWorkspaceRootRelativeAbsolute: false });
        assert.strictEqual(resolved.fsPath, target.fsPath);
    });

    test('rejects root-relative absolute paths for strict mutation mode', () => {
        assert.throws(
            () => resolvePathToUri('/lib/main.dart', context, { allowWorkspaceRootRelativeAbsolute: false }),
            /outside the workspace|cannot be resolved safely/i
        );
    });

    test('supports compatibility root-relative paths when enabled', () => {
        const resolved = resolvePathToUri('/lib/main.dart', context);
        assert.strictEqual(resolved.fsPath, URI.joinPath(workspaceRoot, 'lib/main.dart').fsPath);
    });

    test('command cwd cannot escape the active workspace', async () => {
        const outsideRoot = URI.file('/tmp/cleanslate-outside');
        const resolved = await resolveCommandCwd(outsideRoot.fsPath, {
            workspaceContextService,
            fileService: {
                async stat() {
                    return { isDirectory: true };
                }
            }
        } as any);

        assert.strictEqual(resolved, workspaceRoot.fsPath);
    });
});
