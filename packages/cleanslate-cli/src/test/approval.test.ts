/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { requestCommandApproval } from '../cli.js';

test('non-interactive command approval refuses by default', async () => {
	const input = new PassThrough();
	const output = new PassThrough();
	assert.equal(await requestCommandApproval({ command: 'echo unsafe' }, input, output), false);
});
