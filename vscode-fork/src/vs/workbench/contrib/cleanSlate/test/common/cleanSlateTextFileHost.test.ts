/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { CleanSlateTextFileHost } from '../../browser/host/cleanSlateTextFileHost.js';

/**
 * Stands in for a URI built inside the runtime: the same shape as the
 * workbench's `URI`, but not the same class, so `instanceof URI` is false.
 * That is exactly what the vendored copy in `@cleanslate/sdk` produces.
 */
function foreignUri(fsPath: string): any {
	const real = URI.file(fsPath);
	return {
		scheme: real.scheme,
		authority: real.authority,
		path: real.path,
		query: real.query,
		fragment: real.fragment,
		fsPath: real.fsPath,
		with: () => { throw new Error('not used'); },
		toString: () => real.toString()
	};
}

suite('CleanSlateTextFileHost', () => {

	/**
	 * `files.resolve` registers a text file model under the resource it is
	 * given and keeps it. When that model goes dirty, TextFileEditorTracker
	 * hands the resource to ITextEditorService, which checks `instanceof URI`
	 * and throws "Unable to create texteditor from ..." when it fails. So every
	 * URI has to be rebuilt as the workbench's own on the way in.
	 */
	test('rebuilds foreign URIs so the editor own instanceof checks hold', async () => {
		const seen: unknown[] = [];
		const host = new CleanSlateTextFileHost({
			files: {
				get: (resource: URI) => { seen.push(resource); return undefined; },
				resolve: async (resource: URI) => { seen.push(resource); return {} as any; },
				onDidResolve: undefined
			},
			save: async (resource: URI) => { seen.push(resource); return undefined; },
			read: async (resource: URI) => { seen.push(resource); return { value: '' } as any; },
			create: async (operations: readonly { resource: URI }[]) => {
				seen.push(operations[0].resource);
				return undefined;
			}
		} as any);

		const foreign = foreignUri('/tmp/app.ts');
		assert.ok(!(foreign instanceof URI), 'the fixture must not already be a workbench URI');

		host.files.get(foreign);
		await host.files.resolve(foreign);
		await host.save(foreign);
		await host.read(foreign);
		await host.create([{ resource: foreign, value: 'x' }]);

		assert.strictEqual(seen.length, 5);
		for (const resource of seen) {
			assert.ok(resource instanceof URI, 'every resource must reach the service as a workbench URI');
			assert.strictEqual((resource as URI).fsPath, foreign.fsPath);
		}
	});
});
