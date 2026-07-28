/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { Position } from '../core/position.js';
import { URI } from '../core/uri.js';
import { CleanSlateNodeLanguageCommands } from '../node/cleanSlateNodeLanguageCommands.js';

test('Node language commands return symbols, definitions and references', async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-language-'));
	try {
		const definitionFile = path.join(root, 'math.ts');
		const usageFile = path.join(root, 'app.ts');
		fs.writeFileSync(definitionFile, 'export function calculateTotal(values: number[]) { return values.length; }\n');
		fs.writeFileSync(usageFile, 'import { calculateTotal } from "./math.js";\nconsole.log(calculateTotal([1, 2]));\n');
		const commands = new CleanSlateNodeLanguageCommands(root);
		const symbols = await commands.executeCommand('_executeDocumentSymbolProvider', URI.file(definitionFile));
		assert.equal(symbols.some(symbol => symbol.name === 'calculateTotal'), true);

		const definitions = await commands.executeCommand(
			'_executeDefinitionProvider',
			URI.file(usageFile),
			new Position(2, 18)
		);
		assert.equal(definitions.some(location => location.uri.fsPath === definitionFile), true);

		const references = await commands.executeCommand(
			'_executeReferenceProvider',
			URI.file(definitionFile),
			new Position(1, 20)
		);
		assert.equal(references.length >= 3, true);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
