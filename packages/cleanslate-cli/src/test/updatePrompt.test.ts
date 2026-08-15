import assert from 'node:assert/strict';
import test from 'node:test';
import { isNewerVersion, latestCliVersion } from '../updatePrompt.js';

test('isNewerVersion compares semantic versions', () => {
	assert.equal(isNewerVersion('1.0.6', '1.0.5'), true);
	assert.equal(isNewerVersion('1.1.0', '1.0.99'), true);
	assert.equal(isNewerVersion('1.0.5', '1.0.5'), false);
	assert.equal(isNewerVersion('1.0.4', '1.0.5'), false);
	assert.equal(isNewerVersion('invalid', '1.0.5'), false);
});

test('latestCliVersion reads the npm latest version', async () => {
	const fetcher = async () => new Response(JSON.stringify({ version: '1.2.3' }), { status: 200 });
	assert.equal(await latestCliVersion(fetcher as typeof fetch), '1.2.3');
});

test('latestCliVersion ignores network failures', async () => {
	const fetcher = async () => { throw new Error('offline'); };
	assert.equal(await latestCliVersion(fetcher as typeof fetch), undefined);
});
