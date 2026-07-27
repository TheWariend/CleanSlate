/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { askQuestionTool } from '../../browser/tools/AskQuestionTool.js';

suite('askQuestionTool', () => {
	test('returns a structured native question without text parsing', async () => {
		const result = await askQuestionTool.run({
			summary: 'I need one product decision before continuing.',
			question: 'Which deployment target should the plan optimize for?',
			options: [
				{ label: 'Vercel (Recommended)', description: 'Best fit for the existing Next.js setup.', recommended: true },
				{ label: 'Self-hosted Node', description: 'More control, but more operational work.' }
			],
			allowCustom: true,
			customLabel: 'Different target',
			placeholder: 'Name the target platform'
		}, {} as any);

		assert.strictEqual(result.success, true);
		assert.strictEqual(result.summary, 'I need one product decision before continuing.');
		assert.strictEqual(result.planning_question.question, 'Which deployment target should the plan optimize for?');
		assert.strictEqual(result.planning_question.options.length, 2);
		assert.strictEqual(result.planning_question.options[0].recommended, true);
		assert.strictEqual(result.planning_question.allowCustom, true);
	});

	test('rejects empty questions before they reach the UI', async () => {
		const result = await askQuestionTool.run({
			question: ' ',
			options: ['Recommended path']
		}, {} as any);

		assert.strictEqual(result.success, false);
		assert.strictEqual(result.code, 'missing_question');
	});
});
