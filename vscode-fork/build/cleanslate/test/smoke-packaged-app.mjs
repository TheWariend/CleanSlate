import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

function parseArgs(argv) {
	const result = {};

	for (let index = 0; index < argv.length; index++) {
		if (!argv[index].startsWith('--')) {
			continue;
		}

		result[argv[index].slice(2)] = argv[index + 1];
		index++;
	}

	return result;
}

async function reservePort() {
	const server = net.createServer();
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});

	const address = server.address();
	const port = typeof address === 'object' && address ? address.port : undefined;
	await new Promise(resolve => server.close(resolve));

	if (!port) {
		throw new Error('Unable to reserve a renderer debugging port.');
	}

	return port;
}

async function waitForRenderer(port, timeoutMs) {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/list`);
			if (response.ok) {
				const targets = await response.json();
				const renderer = targets.find(target =>
					target.type === 'page' &&
					target.webSocketDebuggerUrl &&
					target.url?.includes('/workbench/workbench.html')
				);
				if (renderer) {
					return renderer;
				}
			}
		} catch {
			// The app is still starting.
		}

		await new Promise(resolve => setTimeout(resolve, 250));
	}

	throw new Error(`No packaged-app renderer appeared within ${timeoutMs / 1000} seconds.`);
}

function connectToRenderer(webSocketDebuggerUrl) {
	const socket = new WebSocket(webSocketDebuggerUrl);
	const pending = new Map();
	const diagnostics = [];
	let sequence = 0;

	socket.addEventListener('message', event => {
		const message = JSON.parse(event.data);
		if (message.id && pending.has(message.id)) {
			const request = pending.get(message.id);
			clearTimeout(request.timeout);
			pending.delete(message.id);
			if (message.error) {
				request.reject(new Error(`Renderer protocol ${request.method} failed: ${message.error.message}`));
			} else {
				request.resolve(message);
			}
			return;
		}

		if (message.method === 'Runtime.exceptionThrown' || message.method === 'Log.entryAdded') {
			diagnostics.push(message);
		}
	});

	socket.addEventListener('close', () => {
		for (const request of pending.values()) {
			clearTimeout(request.timeout);
			request.reject(new Error(`Renderer connection closed while waiting for ${request.method}.`));
		}
		pending.clear();
	});

	function send(method, params = {}, timeoutMs = 10_000) {
		const id = ++sequence;
		const response = new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`Renderer protocol ${method} timed out after ${timeoutMs / 1000} seconds.`));
			}, timeoutMs);
			pending.set(id, { method, resolve, reject, timeout });
		});
		socket.send(JSON.stringify({ id, method, params }));
		return response;
	}

	return {
		diagnostics,
		send,
		socket,
		opened: new Promise((resolve, reject) => {
			socket.addEventListener('open', resolve, { once: true });
			socket.addEventListener('error', reject, { once: true });
		})
	};
}

async function waitForWorkbench(send, timeoutMs) {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		const response = await send('Runtime.evaluate', {
			expression: `JSON.stringify({
				ready: Boolean(document.querySelector('.monaco-workbench')),
				readyState: document.readyState,
				title: document.title,
				body: document.body?.innerHTML.slice(0, 500)
			})`,
			returnByValue: true
		}, Math.max(1_000, deadline - Date.now()));
		const state = JSON.parse(response.result?.result?.value ?? '{}');

		if (state.ready) {
			return state;
		}

		await new Promise(resolve => setTimeout(resolve, 250));
	}

	throw new Error(`The packaged app opened a renderer but the workbench did not render within ${timeoutMs / 1000} seconds.`);
}

async function stopApp(child) {
	if (child.exitCode !== null) {
		return;
	}

	const exited = new Promise(resolve => child.once('exit', resolve));
	try {
		process.kill(-child.pid, 'SIGTERM');
	} catch {
		child.kill('SIGTERM');
	}

	const stopped = await Promise.race([
		exited.then(() => true),
		new Promise(resolve => setTimeout(() => resolve(false), 5_000))
	]);

	if (!stopped && child.exitCode === null) {
		try {
			process.kill(-child.pid, 'SIGKILL');
		} catch {
			child.kill('SIGKILL');
		}
		await exited;
	}
}

const args = parseArgs(process.argv.slice(2));
const appPath = path.resolve(args.app ?? '');

if (process.platform !== 'darwin') {
	throw new Error('The packaged macOS app smoke test must run on macOS.');
}

if (!args.app) {
	throw new Error('Usage: node smoke-packaged-app.mjs --app /path/to/CleanSlate.app');
}

const infoPlist = await readFile(path.join(appPath, 'Contents', 'Info.plist'), 'utf8');
const executableName = /<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/.exec(infoPlist)?.[1];

if (!executableName) {
	throw new Error(`Unable to resolve CFBundleExecutable from ${appPath}.`);
}

const executablePath = path.join(appPath, 'Contents', 'MacOS', executableName);
const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'cleanslate-packaged-smoke-'));
const port = await reservePort();
const output = [];
const child = spawn(executablePath, [
	'--user-data-dir', userDataPath,
	'--disable-extensions',
	'--disable-updates',
	'--skip-welcome',
	`--remote-debugging-port=${port}`
], {
	detached: true,
	env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
	stdio: ['ignore', 'pipe', 'pipe']
});

for (const stream of [child.stdout, child.stderr]) {
	stream.setEncoding('utf8');
	stream.on('data', chunk => output.push(chunk));
}

try {
	const renderer = await waitForRenderer(port, 30_000);
	const connection = connectToRenderer(renderer.webSocketDebuggerUrl);
	await connection.opened;
	await connection.send('Runtime.enable');
	await connection.send('Log.enable');
	const state = await waitForWorkbench(connection.send, 30_000);
	connection.socket.close();
	console.log(`Packaged CleanSlate workbench rendered successfully (${state.title || 'untitled window'}).`);
} catch (error) {
	console.error(output.join('').slice(-12_000));
	throw error;
} finally {
	await stopApp(child);
	await rm(userDataPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
