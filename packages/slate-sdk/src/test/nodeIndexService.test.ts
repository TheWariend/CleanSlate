/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { CleanSlateNodeIndexService } from '../node/cleanSlateNodeIndexService.js';

test('Node code index ranks relevant source chunks and skips dependencies', async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-index-'));
	try {
		fs.writeFileSync(path.join(root, 'payments.ts'), 'export function calculateInvoiceTotal(items: number[]) { return items.reduce((a, b) => a + b, 0); }');
		fs.writeFileSync(path.join(root, 'unrelated.ts'), 'export const greeting = "hello";');
		fs.mkdirSync(path.join(root, 'node_modules'));
		fs.writeFileSync(path.join(root, 'node_modules', 'ignored.ts'), 'calculateInvoiceTotal calculateInvoiceTotal');
		const index = new CleanSlateNodeIndexService(root);
		const results = await index.search('calculate invoice total', 5, 0.1);
		assert.equal(results.length > 0, true);
		assert.equal(results[0]?.uri.fsPath, path.join(root, 'payments.ts'));
		assert.equal(results.some(result => result.uri.fsPath.includes('node_modules')), false);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
