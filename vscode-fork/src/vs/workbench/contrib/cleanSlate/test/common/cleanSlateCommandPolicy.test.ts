/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { evaluateExecutionCommandPolicy, evaluateVerificationCommandPolicy } from '../../browser/agent/cleanSlateCommandPolicy.js';

suite('CleanSlateCommandPolicy', () => {
	test('allows verification commands inside the continuous execution loop', () => {
		const decision = evaluateExecutionCommandPolicy({
			command: 'npm test -- router',
			intent: 'verification',
			writesToWorkspace: false
		});

		assert.strictEqual(decision.allowed, true);
		assert.strictEqual(decision.code, undefined);
	});

	test('allows normal-mode verification commands when no verification phase exists', () => {
		const decision = evaluateExecutionCommandPolicy({
			command: 'npm test -- router',
			intent: 'verification',
			writesToWorkspace: false
		});

		assert.strictEqual(decision.allowed, true);
	});

	test('allows broad verification lint commands', () => {
		const decision = evaluateVerificationCommandPolicy({
			command: 'npm run lint',
			intent: 'verification',
			writesToWorkspace: false
		});

		assert.strictEqual(decision.allowed, true);
	});

	test('allows scoped verification lint commands', () => {
		const decision = evaluateVerificationCommandPolicy({
			command: 'npx eslint src/components/Header.tsx --max-warnings=0',
			intent: 'verification',
			writesToWorkspace: false
		});

		assert.strictEqual(decision.allowed, true);
	});

	test('allows exact broad lint when explicitly user-requested', () => {
		const decision = evaluateVerificationCommandPolicy({
			command: 'npm run lint',
			intent: 'user_requested',
			writesToWorkspace: false
		});

		assert.strictEqual(decision.allowed, true);
	});

	test('does not treat build proof as broad lint', () => {
		const decision = evaluateVerificationCommandPolicy({
			command: 'npm run build',
			intent: 'verification',
			writesToWorkspace: false
		});

		assert.strictEqual(decision.allowed, true);
	});

	test('allows verification commands that do not produce evidence', () => {
		const decision = evaluateVerificationCommandPolicy({
			command: 'true',
			intent: 'verification',
			writesToWorkspace: false
		});

		assert.strictEqual(decision.allowed, true);
	});

	test('allows verification command with neutral setup and real proof', () => {
		const decision = evaluateVerificationCommandPolicy({
			command: 'echo "checking" && npm run build',
			intent: 'verification',
			writesToWorkspace: false
		});

		assert.strictEqual(decision.allowed, true);
	});

	test('allows verification commands that write to the workspace', () => {
		const decision = evaluateVerificationCommandPolicy({
			command: 'npm install',
			intent: 'verification',
			writesToWorkspace: true
		});

		assert.strictEqual(decision.allowed, true);
	});

	test('allows verification commands even without phase metadata', () => {
		const decision = evaluateVerificationCommandPolicy({
			command: 'npm run build'
		});

		assert.strictEqual(decision.allowed, true);
	});
});
