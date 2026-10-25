import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';

// Run the existing browser Mocha tests with the real browser assert package.
export default async function prepareUI() {
	if (process.env.CLEANSLATE_UI_PREPARED === '1') {
		await access(new URL('./results/assert.js', import.meta.url));
		return;
	}
	await build({
		stdin: {
			contents: `import assert from 'assert/'; export default assert; export const { ok, equal, notEqual, strictEqual, notStrictEqual, deepEqual, notDeepEqual, deepStrictEqual, notDeepStrictEqual, match, doesNotMatch, throws, doesNotThrow, rejects, doesNotReject, fail, ifError } = assert;`,
			resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
		},
		bundle: true,
		platform: 'browser',
		banner: { js: 'const process = { env: {}, noDeprecation: true, nextTick: callback => queueMicrotask(callback), pid: 0 };' },
		format: 'esm',
		outfile: fileURLToPath(new URL('./results/assert.js', import.meta.url)),
	});
}
