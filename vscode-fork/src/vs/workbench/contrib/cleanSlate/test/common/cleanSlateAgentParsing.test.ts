/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CLEANSLATE_FALLBACK_CONTEXT_WINDOW_TOKENS } from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { CleanSlateAgentParsingSupport } from '@cleanslate/sdk/agent/cleanSlateAgentParsing.js';

suite('CleanSlateAgentParsingSupport', () => {
	function createParsingSupport(config: Record<string, unknown>): CleanSlateAgentParsingSupport {
		return new CleanSlateAgentParsingSupport({
			getConfiguration: () => config
		} as any);
	}

	test('uses the real effective model window and its configured compaction reserve', () => {
		const parsingSupport = createParsingSupport({
			contextWindow: 20_480,
			autoCompactReserveTokens: 4_096,
			globalContextBudget: 1_000_000
		});

		assert.strictEqual(parsingSupport.getExecutionContextBudgetChars(), 20_480 * 4);
		assert.strictEqual(parsingSupport.getExecutionAutoCompactThresholdChars(), (20_480 - 4_096) * 4);
	});

	test('uses a conservative provider-agnostic fallback when runtime config is missing', () => {
		const parsingSupport = createParsingSupport({});

		assert.strictEqual(parsingSupport.getExecutionContextBudgetChars(), CLEANSLATE_FALLBACK_CONTEXT_WINDOW_TOKENS * 4);
		assert.strictEqual(parsingSupport.getExecutionAutoCompactThresholdChars(), (CLEANSLATE_FALLBACK_CONTEXT_WINDOW_TOKENS - 6_400) * 4);
	});

	test('never uses the smaller retrieval budget as a compaction trigger', () => {
		const parsingSupport = createParsingSupport({
			contextWindow: 252_000,
			autoCompactReserveTokens: 20_000,
			globalContextBudget: 80_000
		});

		assert.strictEqual(parsingSupport.getExecutionContextBudgetChars(), 252_000 * 4);
		assert.strictEqual(parsingSupport.getExecutionAutoCompactThresholdChars(), 232_000 * 4);
	});

	test('uses an optional positive integer maxTurns budget', () => {
		assert.strictEqual(createParsingSupport({ maxTurns: 12.9 }).getExecutionLoopSettings().maxTurns, 12);
		assert.strictEqual(createParsingSupport({ maxTurns: 0 }).getExecutionLoopSettings().maxTurns, undefined);
		assert.strictEqual(createParsingSupport({}).getExecutionLoopSettings().maxTurns, undefined);
	});
});
