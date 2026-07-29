/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { CliProjectContext } from '../projectContext.js';

test('project context loads instructions and safe @mentioned workspace files', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-context-test-'));
	const outside = path.join(root, '..', `${path.basename(root)}-outside.txt`);
	try {
		fs.writeFileSync(path.join(root, 'AGENTS.md'), 'Always verify changes.');
		fs.mkdirSync(path.join(root, 'src'));
		fs.writeFileSync(path.join(root, 'src', 'app.ts'), 'export const app = true;');
		fs.writeFileSync(path.join(root, 'screen.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
		fs.writeFileSync(outside, 'secret outside context');
		const context = new CliProjectContext(root);
		const value = context.build(`inspect @src/app.ts and @../${path.basename(outside)}`);

		assert.match(value, /Always verify changes/);
		assert.match(value, /export const app/);
		assert.doesNotMatch(value, /secret outside context/);
		assert.deepEqual(context.inventory('inspect @src/app.ts').mentionedFiles, ['src/app.ts']);
		assert.deepEqual(context.imageAttachments('inspect @screen.png').map(item => item.path), ['screen.png']);
		assert.match(context.imageAttachments('inspect @screen.png')[0]?.dataUrl ?? '', /^data:image\/png;base64,/);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(outside, { force: true });
	}
});

test('project context does not follow workspace symlinks to outside files', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-context-root-'));
	const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanslate-context-outside-'));
	try {
		fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside-secret');
		fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'linked-secret.txt'));
		const context = new CliProjectContext(root);
		assert.equal(context.build('inspect @linked-secret.txt').includes('outside-secret'), false);
		assert.deepEqual(context.inventory('inspect @linked-secret.txt').mentionedFiles, []);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	}
});
