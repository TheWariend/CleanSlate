/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { extractPlanFileEntries, planEntryTargetToPath, validateImplementationPlanStructure, type ICleanSlatePlanTargetStat } from '../../browser/tools/cleanSlatePlanArtifactPolicy.js';

function statMap(entries: Record<string, ICleanSlatePlanTargetStat>): (path: string) => Promise<ICleanSlatePlanTargetStat | undefined> {
	return async path => entries[path] ?? { exists: false, isDirectory: false };
}

suite('CleanSlatePlanArtifactPolicy', () => {
	test('extracts linked MODIFY and NEW entries with bodies', () => {
		const entries = extractPlanFileEntries([
			'## 3. Proposed Changes',
			'### Home',
			'#### [MODIFY] [home_screen.dart](file:///proj/lib/screens/home_screen.dart)',
			'- **Technical Change**: Rework the header into a control area.',
			'#### [NEW] [quick_prompts.dart](file:///proj/lib/widgets/quick_prompts.dart)',
			'- **Purpose**: Extracted quick prompt chips.',
			'## 4. Impact'
		].join('\n'));

		assert.strictEqual(entries.length, 2);
		assert.strictEqual(entries[0].kind, 'modify');
		assert.strictEqual(entries[0].target, 'file:///proj/lib/screens/home_screen.dart');
		assert.ok(entries[0].body.includes('Rework the header'));
		assert.strictEqual(entries[1].kind, 'new');
	});

	test('decodes file URIs to paths', () => {
		assert.strictEqual(planEntryTargetToPath('file:///proj/lib/a%20b.dart'), '/proj/lib/a b.dart');
		assert.strictEqual(planEntryTargetToPath('lib/plain/path.ts'), 'lib/plain/path.ts');
	});

	test('rejects a plan with no file entries', async () => {
		const result = await validateImplementationPlanStructure('## Goal\nImprove the UX broadly.', statMap({}));
		assert.strictEqual(result.errors.length, 1);
		assert.strictEqual(result.errors[0].code, 'plan_missing_file_entries');
	});

	test('rejects subtree-level MODIFY entries (the Mind_Sort failure)', async () => {
		const result = await validateImplementationPlanStructure([
			'#### [MODIFY] [screens subtree](file:///proj/lib/screens)',
			'- **Technical Change**: Identify the primary user-facing screens in lib/screens, then improve information hierarchy.'
		].join('\n'), statMap({ '/proj/lib/screens': { exists: true, isDirectory: true } }));

		assert.strictEqual(result.errors.some(issue => issue.code === 'plan_modify_target_directory'), true);
		assert.strictEqual(result.warnings.some(issue => issue.code === 'plan_deferred_discovery'), true);
	});

	test('rejects MODIFY entries whose target does not exist', async () => {
		const result = await validateImplementationPlanStructure(
			'#### [MODIFY] [ghost.ts](file:///proj/src/ghost.ts)\n- **Technical Change**: Update handler.',
			statMap({})
		);
		assert.strictEqual(result.errors.some(issue => issue.code === 'plan_modify_target_missing'), true);
	});

	test('rejects entries without a file link', async () => {
		const result = await validateImplementationPlanStructure(
			'#### [MODIFY] the relevant provider files\n- **Technical Change**: Improve state handling.',
			statMap({})
		);
		assert.strictEqual(result.errors.some(issue => issue.code === 'plan_entry_missing_file_link'), true);
	});

	test('accepts a concrete plan and flags NEW-exists only as a warning', async () => {
		const result = await validateImplementationPlanStructure([
			'#### [MODIFY] [home_screen.dart](file:///proj/lib/screens/home_screen.dart)',
			'- **Technical Change**: Replace the floating mic with a labeled control row.',
			'#### [NEW] [existing.dart](file:///proj/lib/widgets/existing.dart)',
			'- **Purpose**: Shared chips.'
		].join('\n'), statMap({
			'/proj/lib/screens/home_screen.dart': { exists: true, isDirectory: false },
			'/proj/lib/widgets/existing.dart': { exists: true, isDirectory: false }
		}));

		assert.strictEqual(result.errors.length, 0);
		assert.strictEqual(result.warnings.some(issue => issue.code === 'plan_new_target_exists'), true);
	});

	test('greenfield plans made only of NEW entries pass', async () => {
		const result = await validateImplementationPlanStructure([
			'#### [NEW] [main.py](file:///proj/src/main.py)',
			'- **Purpose**: Entrypoint.',
			'#### [NEW] [api.py](file:///proj/src/api.py)',
			'- **Purpose**: Routes.'
		].join('\n'), statMap({}));

		assert.strictEqual(result.errors.length, 0);
		assert.strictEqual(result.warnings.length, 0);
	});
});
