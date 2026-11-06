/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { displayPath } from '../displayPath.js';

const testHome = path.resolve('test-home');

describe('displayPath', () => {
	test('abbreviates the home directory itself', () => {
		assert.equal(displayPath(testHome, testHome), '~');
		assert.equal(displayPath(testHome + path.sep, testHome), '~');
	});

	test('abbreviates paths inside the home directory', () => {
		assert.equal(displayPath(path.join(testHome, 'code', 'app'), testHome), path.join('~', 'code', 'app'));
		assert.equal(displayPath(path.join(testHome, 'a'), testHome), path.join('~', 'a'));
	});

	test('does not abbreviate a sibling whose name merely starts the same', () => {
		const sibling = `${testHome}-old`;
		assert.equal(displayPath(path.join(sibling, 'code'), testHome), path.join(sibling, 'code'));
		assert.equal(displayPath(`${testHome}other`, testHome), `${testHome}other`);
	});

	test('leaves paths outside the home directory alone', () => {
		assert.equal(displayPath('/tmp/scratch', testHome), '/tmp/scratch');
		assert.equal(displayPath('/var/log', testHome), '/var/log');
	});

	test('leaves relative paths and empty input alone', () => {
		assert.equal(displayPath('code/app', testHome), 'code/app');
		assert.equal(displayPath('', testHome), '');
	});

	test('abbreviates Windows home paths with mixed separators and drive casing', { skip: process.platform !== 'win32' }, () => {
		assert.equal(displayPath('c:/Users/example/code/app', 'C:\\Users\\example'), '~\\code\\app');
		assert.equal(displayPath('c:/Users/example-old/code', 'C:\\Users\\example'), 'c:/Users/example-old/code');
	});

	test('no account name survives for a real home path', () => {
		// The point of the helper: whatever the account is called, it must not
		// reach the screen.
		const real = os.homedir();
		const shown = displayPath(path.join(real, 'projects', 'app'));
		assert.ok(shown.startsWith('~'), `expected ~ prefix, got ${shown}`);
		assert.ok(!shown.includes(real), 'the home path leaked into the display string');
	});
});
