import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const workbenchRoot = new URL('../../../src/vs/code/electron-browser/workbench/', import.meta.url);
const bootstrapSource = await readFile(new URL('workbench.ts', workbenchRoot), 'utf8');
const policyNames = [...bootstrapSource.matchAll(/\.createPolicy\(\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
const scriptNonces = [...bootstrapSource.matchAll(/\.setAttribute\(\s*['"]nonce['"]\s*,\s*['"]([^'"]+)['"]/g)].map(match => match[1]);

if (policyNames.length === 0) {
	throw new Error('No Trusted Types policies were found in the workbench bootstrap.');
}

for (const htmlName of ['workbench.html', 'workbench-dev.html']) {
	const htmlUrl = new URL(htmlName, workbenchRoot);
	const html = await readFile(htmlUrl, 'utf8');
	const directive = /\btrusted-types\s+([^;]+);/s.exec(html)?.[1];
	const scriptDirective = /\bscript-src\s+([^;]+);/s.exec(html)?.[1];

	if (!directive) {
		throw new Error(`${fileURLToPath(htmlUrl)} does not declare a trusted-types CSP directive.`);
	}

	const allowedPolicies = new Set(directive.trim().split(/\s+/));
	const missingPolicies = policyNames.filter(policyName => !allowedPolicies.has(policyName));

	if (missingPolicies.length > 0) {
		throw new Error(`${fileURLToPath(htmlUrl)} is missing Trusted Types policies used by the bootstrap: ${missingPolicies.join(', ')}`);
	}

	if (!scriptDirective) {
		throw new Error(`${fileURLToPath(htmlUrl)} does not declare a script-src CSP directive.`);
	}

	const allowedScriptSources = new Set(scriptDirective.trim().split(/\s+/));
	const missingNonces = scriptNonces.filter(nonce => !allowedScriptSources.has(`'nonce-${nonce}'`));

	if (missingNonces.length > 0) {
		throw new Error(`${fileURLToPath(htmlUrl)} is missing script nonces used by the bootstrap: ${missingNonces.join(', ')}`);
	}
}

console.log(`Verified workbench Trusted Types policies (${policyNames.join(', ')}) and script nonces (${scriptNonces.join(', ')}).`);
