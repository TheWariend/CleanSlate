import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const manifestFileName = 'cleanslate-update.json';

function parseArgs(argv) {
	const result = {};

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];

		if (!arg.startsWith('--')) {
			continue;
		}

		const [rawKey, inlineValue] = arg.slice(2).split('=', 2);
		const value = inlineValue ?? argv[index + 1];

		if (inlineValue === undefined) {
			index++;
		}

		result[rawKey] = value;
	}

	return result;
}

async function getGitCommit() {
	const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD']);
	return stdout.trim();
}

async function getPackageVersion(root) {
	const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
	return packageJson.version;
}

async function walkFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const entryPath = path.join(directory, entry.name);

		if (entry.isDirectory()) {
			files.push(...await walkFiles(entryPath));
		} else if (entry.isFile()) {
			files.push(entryPath);
		}
	}

	return files;
}

async function sha256(filePath) {
	const hash = createHash('sha256');

	await new Promise((resolve, reject) => {
		createReadStream(filePath)
			.on('data', chunk => hash.update(chunk))
			.on('error', reject)
			.on('end', resolve);
	});

	return hash.digest('hex');
}

function darwinKeyForArch(arch) {
	if (arch === 'universal') {
		return 'darwin-universal';
	}

	if (arch === 'arm64') {
		return 'darwin-arm64';
	}

	return 'darwin';
}

function detectArtifact(fileName) {
	const cleanName = fileName.replaceAll('\\', '/');
	const baseName = path.basename(cleanName);

	const darwinZip = /^(?:CleanSlate|VSCode)-darwin(?:-(universal|arm64|x64))?\.zip$/i.exec(baseName);
	if (darwinZip) {
		return { group: 'assets', key: darwinKeyForArch(darwinZip[1] ?? 'x64') };
	}

	const darwinDmg = /^(?:CleanSlate|VSCode)-darwin(?:-(universal|arm64|x64))?\.dmg$/i.exec(baseName);
	if (darwinDmg) {
		return { group: 'downloads', key: `${darwinKeyForArch(darwinDmg[1] ?? 'x64')}-dmg` };
	}

	const winSetup = /^(?:CleanSlate|VSCode)(User)?Setup-(x64|arm64)-.+\.exe$/i.exec(baseName);
	if (winSetup) {
		return { group: 'assets', key: `win32-${winSetup[2].toLowerCase()}${winSetup[1] ? '-user' : ''}` };
	}

	const winArchive = /^(?:CleanSlate|VSCode)-win32-(x64|arm64)(?:-.+)?\.zip$/i.exec(baseName);
	if (winArchive) {
		return { group: 'assets', key: `win32-${winArchive[1].toLowerCase()}-archive` };
	}

	return undefined;
}

async function buildArtifactEntry(filePath, artifactRoot, assetBaseUrl) {
	const baseName = path.basename(filePath);
	const fileStat = await stat(filePath);
	const entry = {
		name: baseName,
		sha256hash: await sha256(filePath),
		size: fileStat.size
	};

	if (assetBaseUrl) {
		entry.url = new URL(baseName, assetBaseUrl.endsWith('/') ? assetBaseUrl : `${assetBaseUrl}/`).toString();
	}

	entry.relativePath = path.relative(artifactRoot, filePath).replaceAll(path.sep, '/');

	return entry;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const root = path.resolve(args.root ?? process.cwd());
	const artifactRoot = path.resolve(args.artifacts ?? path.join(root, '.build', 'cleanslate-release'));
	const outFile = path.resolve(args.out ?? path.join(artifactRoot, manifestFileName));
	const commit = args.commit ?? process.env.GITHUB_SHA ?? await getGitCommit();
	const version = args.version ?? process.env.CLEANSLATE_VERSION ?? await getPackageVersion(root);
	const quality = args.quality ?? process.env.VSCODE_QUALITY ?? 'stable';
	const githubRepository = args.repository ?? process.env.GITHUB_REPOSITORY ?? 'TheWariend/CleanSlate-Releases';
	const assetBaseUrl = args.assetBaseUrl ?? process.env.CLEANSLATE_ASSET_BASE_URL;
	const manifest = {
		schemaVersion: 1,
		name: 'CleanSlate',
		version,
		commit,
		quality,
		githubRepository,
		timestamp: new Date().toISOString(),
		assets: {},
		downloads: {}
	};

	const files = await walkFiles(artifactRoot);

	for (const filePath of files) {
		if (path.basename(filePath) === manifestFileName) {
			continue;
		}

		const artifact = detectArtifact(path.relative(artifactRoot, filePath));

		if (!artifact) {
			continue;
		}

		manifest[artifact.group][artifact.key] = await buildArtifactEntry(filePath, artifactRoot, assetBaseUrl);
	}

	if (args.strict && Object.keys(manifest.assets).length === 0) {
		throw new Error(`No update assets were detected under ${artifactRoot}`);
	}

	await mkdir(path.dirname(outFile), { recursive: true });
	await writeFile(outFile, `${JSON.stringify(manifest, null, '\t')}\n`);
	console.log(`Wrote ${outFile}`);
}

main().catch(error => {
	console.error(error);
	process.exit(1);
});
