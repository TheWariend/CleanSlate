// Copies the chosen vs/ base modules into the SDK, rewriting the few imports
// that change at the boundary and converting `const enum` to `enum` so the
// package can build with isolatedModules on.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';

const SRC = '/Users/mohammedmazin/WARIEND/CleanSlate/vscode-fork/src';
const DEST = '/Users/mohammedmazin/WARIEND/CleanSlate/packages/cleanslate-sdk/src/core';

// vs path -> destination file inside core/
const FILES = {
	'vs/base/common/uri.ts': 'uri.ts',
	'vs/base/common/charCode.ts': 'charCode.ts',
	'vs/base/common/marshallingIds.ts': 'marshallingIds.ts',
	'vs/base/common/event.ts': 'event.ts',
	'vs/base/common/lifecycle.ts': 'lifecycle.ts',
	'vs/base/common/cancellation.ts': 'cancellation.ts',
	'vs/base/common/errors.ts': 'errors.ts',
	'vs/base/common/functional.ts': 'functional.ts',
	'vs/base/common/iterator.ts': 'iterator.ts',
	'vs/base/common/linkedList.ts': 'linkedList.ts',
	'vs/base/common/stopwatch.ts': 'stopwatch.ts',
	'vs/base/common/collections.ts': 'collections.ts',
	'vs/base/common/arrays.ts': 'arrays.ts',
	'vs/base/common/arraysFind.ts': 'arraysFind.ts',
	'vs/base/common/map.ts': 'map.ts',
	'vs/base/common/types.ts': 'types.ts',
	'vs/base/common/assert.ts': 'assert.ts',
	'vs/editor/common/core/position.ts': 'position.ts',
	'vs/editor/common/core/range.ts': 'range.ts',
	'vs/base/common/diff/diff.ts': 'diff/diff.ts',
	'vs/base/common/diff/diffChange.ts': 'diff/diffChange.ts'
};

const HEADER = `/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/*
 * Vendored from microsoft/vscode (vs/%SOURCE%) for @cleanslate/sdk.
 * Changes: see packages/cleanslate-sdk/VENDOR.md.
 */
`;

let converted = 0;
for (const [from, to] of Object.entries(FILES)) {
	let text = readFileSync(path.join(SRC, from), 'utf8');
	const depth = to.includes('/') ? '../' : './';

	// node:path replaces vs/base/common/path.ts — the SDK runs on Node, so the
	// browser-safe port is dead weight. uri.ts uses only win32.join/posix.join.
	text = text.replace(/import \* as paths from '\.\/path\.js';/, `import * as paths from 'node:path';`);
	// platform.ts exists to read the nls locale config; the SDK needs only the
	// OS booleans, which live in a local module with no nls dependency.
	text = text.replace(/from '\.\/platform\.js'/g, `from '${depth}platform.js'`);
	// stringHash is reimplemented locally rather than pulling hash.ts -> buffer, strings.
	text = text.replace(/from '\.\.\/hash\.js'/g, `from '../hash.js'`);

	// const enums cannot cross module boundaries under isolatedModules.
	const before = text;
	text = text.replace(/export const enum /g, 'export enum ');
	if (text !== before) { converted++; }

	const header = HEADER.replace('%SOURCE%', from.replace(/^vs\//, ''));
	const body = text.replace(/^\/\*-+[\s\S]*?-+\*\/\n/, '');

	const dest = path.join(DEST, to);
	mkdirSync(path.dirname(dest), { recursive: true });
	writeFileSync(dest, header + body);
	console.log(`${from} -> core/${to}`);
}
console.log(`\n${Object.keys(FILES).length} files vendored, ${converted} had const enums converted`);
