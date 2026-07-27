/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { detectShellSourceEditAttempt } from '../../browser/tools/ExecuteCommandTool.js';

suite('CleanSlateShellSourceEditGuard', () => {
	test('blocks the observed python heredoc rewrite', () => {
		const command = [
			`python3 - <<'PY'`,
			`from pathlib import Path`,
			`path = Path('lib/screens/settings_screen.dart')`,
			`content = path.read_text()`,
			`path.write_text(replacement)`,
			`PY`
		].join('\n');
		assert.strictEqual(detectShellSourceEditAttempt(command), 'python file-write call');
	});

	test('blocks sed -i, redirection into source, python open-write, and tee', () => {
		assert.ok(detectShellSourceEditAttempt(`sed -i '' 's/foo/bar/' lib/main.dart`));
		assert.ok(detectShellSourceEditAttempt('echo "class X {}" > lib/screens/new.dart'));
		assert.ok(detectShellSourceEditAttempt(`python3 -c "open('a.py','w').write('x')"`));
		assert.ok(detectShellSourceEditAttempt('cat file | tee lib/main.ts'));
	});

	test('allows builds, logs, diffs, greps, read-only heredocs, and stderr redirects', () => {
		assert.strictEqual(detectShellSourceEditAttempt('npm run build'), undefined);
		assert.strictEqual(detectShellSourceEditAttempt('flutter test > test-output.log'), undefined);
		assert.strictEqual(detectShellSourceEditAttempt('git diff HEAD -- lib/main.dart'), undefined);
		assert.strictEqual(detectShellSourceEditAttempt('grep -n "write" lib/screens/settings_screen.dart'), undefined);
		assert.strictEqual(detectShellSourceEditAttempt(`python3 - <<'PY'\nfrom pathlib import Path\nprint(Path('lib/main.dart').read_text()[:100])\nPY`), undefined);
		assert.strictEqual(detectShellSourceEditAttempt('ls -la 2>&1'), undefined);
		assert.strictEqual(detectShellSourceEditAttempt('dart format --output=none --set-exit-if-changed lib'), undefined);
	});
});
