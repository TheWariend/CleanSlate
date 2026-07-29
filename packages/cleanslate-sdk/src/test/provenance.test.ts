/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Slate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

/**
 * Comments are stripped before scanning for imports: the vendored files carry
 * upstream doc comments that show `import ... from 'vs/...'` as examples, and
 * the vendoring notes name the modules they replaced.
 */
function codeOf(file: string): string {
	return readFileSync(file, 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) {
			out.push(...sourceFiles(full));
		} else if (full.endsWith('.ts')) {
			out.push(full);
		}
	}
	return out;
}

/**
 * The SDK is meant to stand alone. These are cheap structural checks that catch
 * the boundary being crossed again by accident — a stray relative import back
 * into the fork, or a dependency that reintroduces the subtree the vendoring
 * was done to avoid.
 */
describe('SDK boundary', () => {
	const files = sourceFiles(SRC);

	test('finds the source tree', () => {
		assert.ok(files.length > 20, `expected the SDK sources, found ${files.length} files`);
	});

	test('nothing imports the fork or any vs/ path', () => {
		const offenders: string[] = [];
		for (const file of files) {
			for (const m of codeOf(file).matchAll(/from\s+'([^']+)'/g)) {
				const spec = m[1];
				if (spec.includes('vscode-fork') || /(^|\/)vs\//.test(spec) || spec.includes('../../../')) {
					offenders.push(`${path.relative(SRC, file)}: ${spec}`);
				}
			}
		}
		assert.deepEqual(offenders, []);
	});

	test('no localization layer is present, directly or transitively', () => {
		// Import specifiers only — the vendoring notes mention nls in prose to
		// explain why it is absent.
		const offenders: string[] = [];
		for (const file of files) {
			for (const m of codeOf(file).matchAll(/from\s+'([^']+)'/g)) {
				if (/\bnls\b/.test(m[1])) {
					offenders.push(`${path.relative(SRC, file)}: ${m[1]}`);
				}
			}
		}
		assert.deepEqual(offenders, [], 'vs/nls must not reach the SDK');
	});

	test('vendored files keep their upstream attribution', () => {
		const vendored = files.filter(f => f.includes(`${path.sep}core${path.sep}`));
		const missing = vendored.filter(f => {
			const head = readFileSync(f, 'utf8').slice(0, 800);
			return !/Copyright \(c\) (Microsoft Corporation|Slate)/.test(head);
		}).map(f => path.relative(SRC, f));
		assert.deepEqual(missing, []);
	});

	test('the root entry point reaches no Node built-in', () => {
		// The editor loads this graph in a renderer: no `require`, no `node:`
		// scheme, no `Buffer`. Anything that needs Node belongs behind
		// `@cleanslate/sdk/node`, which is a separate entry point for exactly
		// this reason.
		const DIST = path.resolve(SRC, '../dist');
		const seen = new Set<string>();
		const bare: string[] = [];
		const visit = (file: string) => {
			if (seen.has(file)) {
				return;
			}
			seen.add(file);
			const code = readFileSync(file, 'utf8');
			// Anchored at the start of a line so that a specifier quoted inside
			// a doc comment or a string literal is not mistaken for an import.
			const importRe = /^\s*(?:import|export)[^'";]*?from\s*'([^']+)'|^\s*import\s*\(\s*'([^']+)'\s*\)/gm;
			for (const m of code.matchAll(importRe)) {
				const spec = m[1] ?? m[2];
				if (spec.startsWith('.')) {
					visit(path.resolve(path.dirname(file), spec));
				} else {
					bare.push(`${path.relative(DIST, file)}: ${spec}`);
				}
			}
		};
		visit(path.join(DIST, 'index.js'));
		assert.deepEqual(bare, [], 'the browser-safe entry point must import nothing by bare name');

		const usesBuffer = [...seen]
			.filter(f => /(^|[^.\w])Buffer\s*\./.test(codeOf(f)))
			.map(f => path.relative(DIST, f));
		assert.deepEqual(usesBuffer, [], 'Buffer is a Node global and is absent in a renderer');
	});

	test('runtime code carries no DI decorators', () => {
		// The SDK uses plain constructor injection; @IFooService is a fork idiom
		// and needs experimentalDecorators, which this package builds without.
		const offenders = files
			.filter(f => /@I[A-Z][A-Za-z]*\s+(private|public|protected|readonly)/.test(codeOf(f)))
			.map(f => path.relative(SRC, f));
		assert.deepEqual(offenders, []);
	});
});
