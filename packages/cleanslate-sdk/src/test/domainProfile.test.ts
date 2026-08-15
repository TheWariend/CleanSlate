/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { composePrompt } from '../composer/promptComposer.js';
import {
	CLEANSLATE_CODING_PROFILE,
	CLEANSLATE_GENERAL_PROFILE
} from '../agent/cleanSlateDomainProfile.js';

function promptText(profileId: string): string {
	return composePrompt({ mode: 'Execution', domainProfileId: profileId })
		.map(part => part.type === 'text' ? part.text : '')
		.join('\n');
}

test('coding remains the default domain profile', () => {
	assert.equal(CLEANSLATE_CODING_PROFILE.id, 'coding');
	assert.match(promptText('coding'), /software-engineering agent/);
});

test('general profile removes coding identity and deterministic lint verification', () => {
	assert.equal(CLEANSLATE_GENERAL_PROFILE.deterministicVerificationTool, undefined);
	const prompt = promptText('general');
	assert.match(prompt, /general-purpose agent/);
	assert.doesNotMatch(prompt, /software-engineering agent/);
});
