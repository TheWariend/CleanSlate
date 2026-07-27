import http from 'node:http';
import { pathToFileURL } from 'node:url';

const defaultRepository = 'TheWariend/CleanSlate-Releases';
const defaultManifestAssetName = 'cleanslate-update.json';

function jsonResponse(status, body, headers = {}) {
	return {
		status,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': status === 200 ? 'no-store' : 'private, max-age=60',
			...headers
		},
		body: body === undefined ? undefined : JSON.stringify(body)
	};
}

function emptyResponse(status, headers = {}) {
	return {
		status,
		headers: {
			'cache-control': 'private, max-age=60',
			...headers
		}
	};
}

function getRequestPath(inputUrl) {
	const url = new URL(inputUrl, 'https://updates.local');
	return url.pathname;
}

function parseUpdateRequest(inputUrl) {
	const parts = getRequestPath(inputUrl).split('/').filter(Boolean);
	const apiIndex = parts.findIndex(part => part === 'api');

	if (apiIndex === -1 || parts[apiIndex + 1] !== 'update') {
		return undefined;
	}

	const platform = parts[apiIndex + 2];
	const quality = parts[apiIndex + 3];
	const commit = parts[apiIndex + 4];

	if (!platform || !quality || !commit) {
		return undefined;
	}

	return { platform, quality, commit };
}

function githubHeaders(extraHeaders = {}) {
	return {
		accept: 'application/vnd.github+json',
		'user-agent': 'cleanslate-updater',
		...extraHeaders
	};
}

async function fetchJson(fetchImpl, url, headers) {
	const response = await fetchImpl(url, { headers });

	if (!response.ok) {
		throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
	}

	return response.json();
}

async function fetchLatestRelease(fetchImpl, repository) {
	const releaseUrl = `https://api.github.com/repos/${repository}/releases/latest`;
	return fetchJson(fetchImpl, releaseUrl, githubHeaders());
}

async function fetchManifest(fetchImpl, release) {
	const manifestAssetName = process.env.CLEANSLATE_UPDATE_MANIFEST_NAME ?? defaultManifestAssetName;
	const manifestUrl = process.env.CLEANSLATE_UPDATE_MANIFEST_URL;

	if (manifestUrl) {
		return fetchJson(fetchImpl, manifestUrl, githubHeaders());
	}

	const manifestAsset = release.assets?.find(asset => asset.name === manifestAssetName);

	if (!manifestAsset) {
		throw new Error(`Release ${release.tag_name} does not include ${manifestAssetName}`);
	}

	return fetchJson(fetchImpl, manifestAsset.url ?? manifestAsset.browser_download_url, githubHeaders({ accept: 'application/octet-stream' }));
}

function commitsMatch(requestCommit, latestCommit) {
	if (!requestCommit || !latestCommit) {
		return false;
	}

	return requestCommit === latestCommit || requestCommit.startsWith(latestCommit) || latestCommit.startsWith(requestCommit);
}

function resolveAssetUrl(release, asset) {
	if (asset.url) {
		return asset.url;
	}

	const releaseAsset = release.assets?.find(candidate => candidate.name === asset.name);
	return releaseAsset?.browser_download_url;
}

function resolveManifestAsset(manifest, platform) {
	if (platform === 'darwin') {
		return manifest.assets?.darwin ?? manifest.assets?.['darwin-universal'];
	}

	if (platform === 'darwin-arm64') {
		return manifest.assets?.['darwin-arm64'] ?? manifest.assets?.['darwin-universal'];
	}

	if (platform === 'darwin-universal') {
		return manifest.assets?.['darwin-universal'];
	}

	return manifest.assets?.[platform];
}

function createDarwinUpdate(manifest, asset, url) {
	return {
		url,
		name: `${manifest.name ?? 'CleanSlate'} ${manifest.version}`,
		notes: `${manifest.name ?? 'CleanSlate'} ${manifest.version}`,
		pub_date: manifest.timestamp
	};
}

function createWindowsUpdate(manifest, asset, url) {
	return {
		url,
		version: manifest.commit,
		productVersion: manifest.version,
		timestamp: manifest.timestamp ? Date.parse(manifest.timestamp) : undefined,
		sha256hash: asset.sha256hash
	};
}

export async function handleCleanSlateUpdateRequest(request, options = {}) {
	const method = request.method ?? 'GET';

	if (method !== 'GET' && method !== 'HEAD') {
		return emptyResponse(405, { allow: 'GET, HEAD' });
	}

	const updateRequest = parseUpdateRequest(request.url ?? '/');

	if (!updateRequest) {
		return jsonResponse(404, { error: 'Unknown CleanSlate update endpoint.' });
	}

	const fetchImpl = options.fetch ?? globalThis.fetch;
	const repository = options.repository ?? process.env.CLEANSLATE_GITHUB_REPOSITORY ?? defaultRepository;

	if (!fetchImpl) {
		return jsonResponse(500, { error: 'No fetch implementation is available.' });
	}

	try {
		const release = await fetchLatestRelease(fetchImpl, repository);
		const manifest = await fetchManifest(fetchImpl, release);

		if (manifest.quality && manifest.quality !== updateRequest.quality) {
			return emptyResponse(204);
		}

		if (commitsMatch(updateRequest.commit, manifest.commit)) {
			return emptyResponse(204);
		}

		const asset = resolveManifestAsset(manifest, updateRequest.platform);

		if (!asset) {
			return emptyResponse(204);
		}

		const url = resolveAssetUrl(release, asset);

		if (!url) {
			return jsonResponse(502, { error: `Release asset ${asset.name} is missing a download URL.` });
		}

		const update = updateRequest.platform.startsWith('darwin')
			? createDarwinUpdate(manifest, asset, url)
			: createWindowsUpdate(manifest, asset, url);

		if (method === 'HEAD') {
			return emptyResponse(200, { 'content-type': 'application/json; charset=utf-8' });
		}

		return jsonResponse(200, update);
	} catch (error) {
		return jsonResponse(500, { error: error instanceof Error ? error.message : String(error) });
	}
}

function parseListenPort(argv) {
	const listenIndex = argv.indexOf('--listen');

	if (listenIndex === -1) {
		return undefined;
	}

	return Number(argv[listenIndex + 1] ?? 3000);
}

async function startServer(port) {
	const server = http.createServer(async (request, response) => {
		const result = await handleCleanSlateUpdateRequest({ method: request.method, url: request.url });
		response.writeHead(result.status, result.headers);
		response.end(result.body);
	});

	server.listen(port, () => {
		console.log(`CleanSlate update server listening on http://localhost:${port}`);
	});
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
	const port = parseListenPort(process.argv.slice(2));

	if (!port) {
		console.log('Usage: node build/cleanslate/update/server.mjs --listen 3000');
	} else {
		startServer(port).catch(error => {
			console.error(error);
			process.exit(1);
		});
	}
}
