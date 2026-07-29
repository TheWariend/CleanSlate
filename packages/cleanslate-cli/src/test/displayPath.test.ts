/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import os from 'node:os';
import { displayPath } from '../displayPath.js';

const HOME = '/Users/example';

describe('displayPath', () => {
	test('abbreviates the home directory itself', () => {
		assert.equal(displayPath(HOME, HOME), '~');
		assert.equal(displayPath(HOME + '/', HOME), '~');
	});

	test('abbreviates paths inside the home directory', () => {
		assert.equal(displayPath('/Users/example/code/app', HOME), '~/code/app');
		assert.equal(displayPath('/Users/example/a', HOME), '~/a');
	});

	test('does not abbreviate a sibling whose name merely starts the same', () => {
		// The regression this guards: /Users/example-old is not inside
		// /Users/example, and abbreviating it would be wrong as well as
		// misleading.
		assert.equal(displayPath('/Users/example-old/code', HOME), '/Users/example-old/code');
		assert.equal(displayPath('/Users/exampleother', HOME), '/Users/exampleother');
	});

	test('leaves paths outside the home directory alone', () => {
		assert.equal(displayPath('/tmp/scratch', HOME), '/tmp/scratch');
		assert.equal(displayPath('/var/log', HOME), '/var/log');
	});

	test('leaves relative paths and empty input alone', () => {
		assert.equal(displayPath('code/app', HOME), 'code/app');
		assert.equal(displayPath('', HOME), '');
	});

	test('no account name survives for a real home path', () => {
		// The point of the helper: whatever the account is called, it must not
		// reach the screen.
		const real = os.homedir();
		const shown = displayPath(real + '/WARIEND/project');
		assert.ok(shown.startsWith('~'), `expected ~ prefix, got ${shown}`);
		assert.ok(!shown.includes(real), 'the home path leaked into the display string');
	});
});
