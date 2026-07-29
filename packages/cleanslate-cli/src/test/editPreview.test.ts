/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { createEditPreview } from '../editPreview.js';

test('edit approval previews the requested change without modifying the file', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-edit-preview-'));
	try {
		const file = path.join(root, 'settings.dart');
		fs.writeFileSync(file, 'first\nDeveloped by The Wariend\nlast\n');
		const preview = createEditPreview(root, {
			toolName: 'apply_edit',
			input: {
				file_path: file,
				old_string: 'Developed by The Wariend\n',
				new_string: ''
			}
		});

		assert.equal(preview?.files.length, 1);
		assert.equal(preview?.deletions, 1);
		assert.equal(preview?.files[0].lines.find(line => line.kind === 'deletion')?.oldLine, 2);
		assert.equal(fs.readFileSync(file, 'utf8'), 'first\nDeveloped by The Wariend\nlast\n');
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
