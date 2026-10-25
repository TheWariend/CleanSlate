import { createRequire } from 'node:module';
const require = createRequire(new URL('./vscode-fork/package.json', import.meta.url));
const tseslint = require('typescript-eslint');

// The fork does not contain upstream's .eslint-plugin-local. Keep a runnable
// correctness gate for the shared packages, product integration and QA code.
export default [{ ignores: ['**/dist/**', '**/out/**', '**/node_modules/**', '**/results/**'] }, {
	files: ['packages/*/src/**/*.{ts,tsx}', 'vscode-fork/src/**/cleanSlate/**/*.ts', 'vscode-fork/test/cleanslate/**/*.mjs'],
	languageOptions: { parser: tseslint.parser, parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } } },
	rules: {
		'constructor-super': 'error',
		'no-async-promise-executor': 'error',
		'no-compare-neg-zero': 'error',
		'no-dupe-args': 'error',
		'no-dupe-else-if': 'error',
		'no-dupe-keys': 'error',
		'no-duplicate-case': 'error',
		'no-func-assign': 'error',
		'no-import-assign': 'error',
		'no-self-assign': 'error',
		'no-sparse-arrays': 'error',
		'no-unsafe-finally': 'error',
		'use-isnan': 'error',
		'valid-typeof': 'error',
	},
}];
