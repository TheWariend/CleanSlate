/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { CleanSlateFileHost } from '../../browser/host/cleanSlateFileHost.js';

suite('CleanSlateFileHost', () => {

	/**
	 * `IFileService.writeFile` tells a buffer from a readable with
	 * `instanceof VSBuffer`, and falls through to calling `read()` when the
	 * check fails. A buffer built inside the SDK is a different class with an
	 * identical shape, so it type-checks everywhere and then throws
	 * `readable.read is not a function` at runtime. The runtime therefore hands
	 * over text and the buffer is built here — this test is what stops that
	 * quietly regressing.
	 */
	test('writes through as the editor own VSBuffer, not a look-alike', async () => {
		let written: unknown;
		const host = new CleanSlateFileHost({
			writeFile: async (_resource: URI, content: unknown) => { written = content; }
		} as any);

		await host.writeFile(URI.file('/tmp/plan.md'), '# Plan\n');

		assert.ok(written instanceof VSBuffer, 'the editor discriminates this with instanceof');
		assert.strictEqual((written as VSBuffer).toString(), '# Plan\n');
	});

	test('passes every other call straight to the file service', async () => {
		const seen: string[] = [];
		const resource = URI.file('/tmp/a.ts');
		const host = new CleanSlateFileHost({
			exists: async () => { seen.push('exists'); return true; },
			stat: async () => { seen.push('stat'); return { resource, name: 'a.ts' }; },
			readFile: async () => { seen.push('readFile'); return { value: VSBuffer.fromString('x') }; },
			del: async () => { seen.push('del'); },
			createFolder: async () => { seen.push('createFolder'); return undefined; },
			resolve: async () => { seen.push('resolve'); return { resource, name: 'a.ts' }; }
		} as any);

		await host.exists(resource);
		await host.stat(resource);
		await host.readFile(resource);
		await host.del(resource);
		await host.createFolder(resource);
		await host.resolve(resource);
		await host.resolve(resource, { resolveMetadata: true });

		assert.deepStrictEqual(seen, ['exists', 'stat', 'readFile', 'del', 'createFolder', 'resolve', 'resolve']);
	});
});
