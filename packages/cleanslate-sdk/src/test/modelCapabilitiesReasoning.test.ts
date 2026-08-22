/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ICleanSlateModelsDevModelMetadata } from '../protocol/cleanSlateAI.js';
import {
	resolveCleanSlateModelCapabilities,
	resolveCleanSlateReasoningLevelOptions
} from '../protocol/cleanSlateModelCapabilities.js';

// Real models.dev entry for stealth/ox-alpha: reasoning efforts low/high/max,
// served through OpenRouter's normalized reasoning_effort parameter.
const OX_ALPHA_METADATA: ICleanSlateModelsDevModelMetadata = {
	id: 'stealth/ox-alpha',
	provider: 'openrouter',
	releaseDate: '2026-08-20',
	reasoning: true,
	reasoningEfforts: ['low', 'high', 'max'],
	toolCall: true
};

function oxAlphaCaps(reasoningLevel: Parameters<typeof resolveCleanSlateModelCapabilities>[0]['reasoningLevel']) {
	return resolveCleanSlateModelCapabilities({
		provider: 'openrouter',
		flavor: 'openrouter',
		model: 'stealth/ox-alpha',
		reasoningLevel,
		modelsDevMetadata: OX_ALPHA_METADATA
	});
}

test('ox-alpha receives the literal catalog effort when the user picks an advertised level', () => {
	assert.equal(oxAlphaCaps('low').reasoningEffort, 'low');
	assert.equal(oxAlphaCaps('high').reasoningEffort, 'high');
	assert.equal(oxAlphaCaps('max').reasoningEffort, 'max');
});

test('ox-alpha falls back to the closest advertised effort for unlisted levels', () => {
	// Catalog has no medium: clamp to the strongest advertised effort.
	assert.equal(oxAlphaCaps('medium').reasoningEffort, 'max');
	assert.equal(oxAlphaCaps('xhigh').reasoningEffort, 'max');
	// Low clamps down instead of up.
	const minimalMetadata: ICleanSlateModelsDevModelMetadata = {
		...OX_ALPHA_METADATA,
		reasoningEfforts: ['medium']
	};
	assert.equal(
		resolveCleanSlateModelCapabilities({
			provider: 'openrouter',
			flavor: 'openrouter',
			model: 'stealth/ox-alpha',
			reasoningLevel: 'low',
			modelsDevMetadata: minimalMetadata
		}).reasoningEffort,
		'medium'
	);
});

test('ox-alpha sends no reasoning_effort when reasoning is disabled', () => {
	assert.equal(oxAlphaCaps('none').reasoningEffort, undefined);
});

test('ox-alpha always reports its catalog efforts as supported', () => {
	for (const level of ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const) {
		assert.deepEqual(oxAlphaCaps(level).supportedReasoningEfforts, ['low', 'high', 'max']);
	}
});

test('the level picker offers ox-alpha every catalog effort plus none', () => {
	const enabled = resolveCleanSlateReasoningLevelOptions({
		provider: 'openrouter',
		flavor: 'openrouter',
		model: 'stealth/ox-alpha',
		modelsDevMetadata: OX_ALPHA_METADATA
	});
	assert.deepEqual(
		enabled.filter(option => option.enabled).map(option => option.level),
		['none', 'low', 'high', 'max']
	);
	const disabled = enabled.filter(option => !option.enabled).map(option => option.level);
	assert.deepEqual(disabled, ['minimal', 'medium', 'xhigh']);
	assert.ok(enabled.find(option => option.level === 'medium')?.disabledReason?.includes('stealth/ox-alpha'));
});

test('models without catalog efforts keep their existing behavior', () => {
	const caps = resolveCleanSlateModelCapabilities({
		provider: 'openrouter',
		flavor: 'openrouter',
		model: 'some-unknown-model',
		reasoningLevel: 'high'
	});
	assert.equal(caps.reasoningEffort, undefined);

	// Dedicated resolvers win over the generic catalog path: the Sarvam branch
	// sets its own efforts, so the OpenRouter catalog hook must not re-map them.
	const sarvamCaps = resolveCleanSlateModelCapabilities({
		provider: 'openrouter',
		flavor: 'openrouter',
		model: 'sarvam-maverick',
		reasoningLevel: 'low'
	});
	assert.equal(sarvamCaps.reasoningEffort, 'low');
	assert.deepEqual(sarvamCaps.supportedReasoningEfforts, ['low', 'medium', 'high']);
});

test('budget-style families routed through OpenRouter are untouched by catalog mapping', () => {
	const caps = resolveCleanSlateModelCapabilities({
		provider: 'openrouter',
		flavor: 'openrouter',
		model: 'claude-fable-5',
		reasoningLevel: 'low',
		modelsDevMetadata: {
			...OX_ALPHA_METADATA,
			id: 'anthropic/claude-fable-5'
		}
	});
	assert.equal(caps.reasoningEffort, undefined, 'claude uses thinking budgets, not reasoning_effort');
});
