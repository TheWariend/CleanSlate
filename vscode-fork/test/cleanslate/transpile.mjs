// Transpile changed src files into out/, preserving VS Code's DI decorators.
// experimentalDecorators is mandatory: without it the @IService constructor
// params are dropped and any DI-registered service written to out/ is left
// broken (injected fields become undefined at runtime).
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { pathToFileURL } from 'url';
import path from 'path';

const FORK = '/Users/mohammedmazin/WARIEND/CleanSlate/vscode-fork';
const ts = (await import(pathToFileURL(path.join(FORK, 'node_modules/typescript/lib/typescript.js')).href)).default;

const files = process.argv.slice(2);
if (!files.length) {
	console.error('usage: transpile.mjs <src-relative-path>...');
	process.exit(1);
}

for (const rel of files) {
	const srcPath = path.join(FORK, 'src', rel);
	const outPath = path.join(FORK, 'out', rel.replace(/\.ts$/, '.js'));
	const source = readFileSync(srcPath, 'utf8');

	const result = ts.transpileModule(source, {
		fileName: srcPath,
		compilerOptions: {
			module: ts.ModuleKind.ES2022,
			target: ts.ScriptTarget.ES2022,
			experimentalDecorators: true,
			emitDecoratorMetadata: false,
			useDefineForClassFields: false
		}
	});

	mkdirSync(path.dirname(outPath), { recursive: true });
	writeFileSync(outPath, result.outputText);

	const hadDecorators = /@I[A-Za-z]+\s/.test(source);
	const emittedParams = (result.outputText.match(/__param/g) || []).length;
	const flag = hadDecorators
		? (emittedParams > 0 ? `DI ok (${emittedParams} __param)` : 'DI LOST — would break at runtime')
		: '';
	console.log(`${rel} -> out  ${flag}`);
	if (hadDecorators && emittedParams === 0) {
		process.exitCode = 1;
	}
}
