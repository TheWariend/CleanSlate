import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import prepareUI from './prepare-ui.mjs';

const require = createRequire(import.meta.url);
const version = require('@playwright/test/package.json').version;
if (version !== '1.58.2') { throw new Error('Update the CI image and review UI baselines when changing Playwright versions.'); }
await prepareUI();
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const child = spawn('docker', [
	'run', '--rm', '--init', '--ipc=host', '-e', 'CI=1', '-e', 'CLEANSLATE_UI_PREPARED=1',
	'-v', `${repository}:/workspace`, '-w', '/workspace/vscode-fork',
	'mcr.microsoft.com/playwright:v1.58.2-noble', 'node', 'node_modules/@playwright/test/cli.js',
	'test', '--config', 'test/cleanslate/playwright.config.mjs', '--workers', '1', ...process.argv.slice(2),
], { stdio: 'inherit' });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
