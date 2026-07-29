/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Slate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import { URI } from '../core/uri.js';
import { basename, dirname, extname, joinPath, normalizePath, relativePath, isEqualOrParent } from '../core/resources.js';
import { stringHash, numberHash } from '../core/hash.js';
import { VSBuffer } from '../core/buffer.js';
import { Range } from '../core/range.js';
import { Position } from '../core/position.js';
import { Emitter } from '../core/event.js';
import { DisposableStore, toDisposable } from '../core/lifecycle.js';
import { CancellationTokenSource } from '../core/cancellation.js';

/**
 * `resources`, `hash` and `buffer` are hand-written replacements for VS Code
 * modules rather than copies (see VENDOR.md). These pin the behaviour that was
 * verified against the originals, so a future edit that drifts is caught here
 * rather than in the edit engine.
 */
describe('resources', () => {
	test('basename and extname read the path, not the filesystem', () => {
		assert.equal(basename(URI.file('/w/src/app.ts')), 'app.ts');
		assert.equal(basename(URI.file('/w/src/')), 'src');
		assert.equal(basename(URI.file('/')), '');
		assert.equal(extname(URI.file('/w/src/app.ts')), '.ts');
		assert.equal(extname(URI.file('/w/src/a.b.c.d.ts')), '.ts');
		assert.equal(extname(URI.file('/w/no-ext')), '');
		assert.equal(extname(URI.file('/w/.hidden')), '');
	});

	test('dirname walks up and stops at the root', () => {
		assert.equal(dirname(URI.file('/w/src/app.ts')).path, '/w/src');
		assert.equal(dirname(URI.file('/w')).path, '/');
		assert.equal(dirname(URI.file('/')).path, '/');
	});

	test('joinPath resolves . and .. segments', () => {
		assert.equal(joinPath(URI.file('/w'), 'src', 'app.ts').path, '/w/src/app.ts');
		assert.equal(joinPath(URI.file('/w/src'), '..', 'test').path, '/w/test');
		assert.equal(joinPath(URI.file('/w'), './q').path, '/w/q');
		assert.equal(joinPath(URI.file('/w')).path, '/w');
	});

	test('normalizePath collapses traversal', () => {
		assert.equal(normalizePath(URI.file('/a/b/c/../d')).path, '/a/b/d');
		assert.equal(normalizePath(URI.file('/a/./b')).path, '/a/b');
	});

	test('relativePath is undefined across schemes and authorities', () => {
		assert.equal(relativePath(URI.file('/w'), URI.file('/w/src/app.ts')), 'src/app.ts');
		assert.equal(relativePath(URI.file('/w/src'), URI.file('/w/test')), '../test');
		assert.equal(relativePath(URI.file('/w'), URI.parse('untitled:/w/a')), undefined);
		assert.equal(
			relativePath(URI.parse('vscode-remote://a/x'), URI.parse('vscode-remote://b/x')),
			undefined
		);
	});

	test('isEqualOrParent does not treat a name prefix as a parent', () => {
		assert.equal(isEqualOrParent(URI.file('/w/src/app.ts'), URI.file('/w/src')), true);
		assert.equal(isEqualOrParent(URI.file('/w/src'), URI.file('/w/src')), true);
		// The regression this guards: /w/srcabc is not inside /w/src.
		assert.equal(isEqualOrParent(URI.file('/w/srcabc/a.ts'), URI.file('/w/src')), false);
		assert.equal(isEqualOrParent(URI.file('/other/a.ts'), URI.file('/w/src')), false);
		assert.equal(isEqualOrParent(URI.file('/w/src'), URI.parse('untitled:/w')), false);
	});

	test('non-file schemes keep their authority and take the posix branch', () => {
		const remote = URI.parse('vscode-remote://host/a/b.ts');
		assert.equal(basename(remote), 'b.ts');
		assert.equal(dirname(remote).toString(), 'vscode-remote://host/a');
		assert.equal(joinPath(remote, 'c').path, '/a/b.ts/c');
	});
});

describe('hash', () => {
	test('stringHash is stable, seeded and int32', () => {
		assert.equal(stringHash('export const x = 1;', 0), stringHash('export const x = 1;', 0));
		assert.notEqual(stringHash('a', 0), stringHash('b', 0));
		assert.notEqual(stringHash('a', 0), stringHash('a', 17));
		assert.ok(Number.isInteger(stringHash('x'.repeat(500), 0)));
		assert.ok(stringHash('🎉 unicode', 0) === (stringHash('🎉 unicode', 0) | 0));
	});

	test('numberHash matches the documented int32 recurrence', () => {
		// hashVal * 31 + val, truncated to int32.
		assert.equal(numberHash(5, 0), 5);
		assert.equal(numberHash(1, 1), 32);
		assert.equal(numberHash(0, 2), 62);
		assert.ok(Number.isInteger(numberHash(2 ** 31, 12345)));
	});
});

describe('buffer', () => {
	test('round-trips utf8 including multi-byte characters', () => {
		assert.equal(VSBuffer.fromString('hello').toString(), 'hello');
		assert.equal(VSBuffer.fromString('🎉 ünïcode').toString(), '🎉 ünïcode');
		assert.equal(VSBuffer.fromString('').toString(), '');
	});

	test('byteLength counts bytes, not characters', () => {
		assert.equal(VSBuffer.fromString('abc').byteLength, 3);
		assert.equal(VSBuffer.fromString('é').byteLength, 2);
	});

	test('wrap and slice share the underlying bytes correctly', () => {
		const wrapped = VSBuffer.wrap(new TextEncoder().encode('abcdef'));
		assert.equal(wrapped.toString(), 'abcdef');
		assert.equal(wrapped.slice(1, 3).toString(), 'bc');
		assert.equal(VSBuffer.concat([VSBuffer.fromString('ab'), VSBuffer.fromString('cd')]).toString(), 'abcd');
	});
});

describe('vendored primitives are wired up', () => {
	test('Range and Position behave as upstream', () => {
		const r = new Range(1, 1, 2, 5);
		assert.equal(r.startLineNumber, 1);
		assert.equal(r.endColumn, 5);
		assert.ok(r.containsPosition(new Position(2, 1)));
		assert.ok(!r.containsPosition(new Position(3, 1)));
		assert.ok(Range.areIntersecting(new Range(1, 1, 3, 1), new Range(2, 1, 4, 1)));
	});

	test('Emitter delivers to listeners and stops after dispose', () => {
		const store = new DisposableStore();
		const emitter = new Emitter<number>();
		const seen: number[] = [];
		store.add(emitter.event(n => seen.push(n)));
		emitter.fire(1);
		emitter.fire(2);
		store.dispose();
		emitter.fire(3);
		assert.deepEqual(seen, [1, 2]);
	});

	test('toDisposable runs exactly once', () => {
		let count = 0;
		const d = toDisposable(() => count++);
		d.dispose();
		d.dispose();
		assert.equal(count, 1);
	});

	test('cancellation token fires on cancel', () => {
		const source = new CancellationTokenSource();
		let cancelled = false;
		source.token.onCancellationRequested(() => { cancelled = true; });
		assert.equal(source.token.isCancellationRequested, false);
		source.cancel();
		assert.equal(cancelled, true);
		assert.equal(source.token.isCancellationRequested, true);
	});
});

describe('no editor or nls code reached the SDK', () => {
	test('URI works without any localization layer present', () => {
		// URI is the module that used to drag platform -> nls in.
		assert.equal(URI.file('/a/b.ts').scheme, 'file');
		assert.equal(URI.parse('https://example.com/x').authority, 'example.com');
		assert.equal(URI.file('/a/b.ts').with({ path: '/c' }).path, '/c');
	});
});
