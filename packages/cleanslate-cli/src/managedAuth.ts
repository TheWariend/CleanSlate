/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICleanSlateManagedEntitlements } from '@slate/sdk';
import { spawnSync } from 'node:child_process';

export interface ICleanSlateManagedSignIn {
	token: string;
	entitlements: ICleanSlateManagedEntitlements;
}

interface IDeviceAuthorization {
	device_code: string;
	verification_uri_complete: string;
	expires_in?: number;
	interval?: number;
}

export interface ICleanSlateBrowserAuthOptions {
	env?: NodeJS.ProcessEnv;
	fetcher?: typeof fetch;
	onReady?: (url: string) => void;
	openBrowser?: (url: string) => void | Promise<void>;
	signal?: AbortSignal;
	sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

function apiBaseUrl(env: NodeJS.ProcessEnv): string {
	return (env['CLEANSLATE_API_BASE_URL']?.trim() || 'https://api.thewariend.com/api').replace(/\/+$/, '');
}

async function responseError(response: Response): Promise<Error> {
	const body = await response.json().catch(() => ({})) as { message?: string; error?: string; errors?: Record<string, string[]> };
	const validation = body.errors ? Object.values(body.errors)[0]?.[0] : undefined;
	return new Error(validation || body.message || body.error || `CleanSlate authentication failed (${response.status}).`);
}

async function loadEntitlements(baseUrl: string, token: string, fetcher: typeof fetch): Promise<ICleanSlateManagedEntitlements> {
	const response = await fetcher(`${baseUrl}/cleanslate/entitlements`, {
		headers: {
			Accept: 'application/json',
			Authorization: `Bearer ${token}`
		}
	});
	if (!response.ok) {
		throw await responseError(response);
	}
	const body = await response.json() as { data?: ICleanSlateManagedEntitlements };
	if (!body.data) {
		throw new Error('CleanSlate authentication succeeded, but no managed-model entitlements were returned.');
	}
	return body.data;
}

export async function signInToCleanSlate(
	email: string,
	password: string,
	env: NodeJS.ProcessEnv = process.env,
	fetcher: typeof fetch = fetch
): Promise<ICleanSlateManagedSignIn> {
	const baseUrl = apiBaseUrl(env);
	const response = await fetcher(`${baseUrl}/auth/login`, {
		method: 'POST',
		headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
		body: JSON.stringify({
			email,
			password,
			device_name: `CleanSlate CLI (${process.platform})`,
			source: 'cleanslate-cli'
		})
	});
	if (!response.ok) {
		throw await responseError(response);
	}
	const body = await response.json() as { token?: string };
	const token = body.token?.trim();
	if (!token) {
		throw new Error('CleanSlate authentication succeeded without returning a session token.');
	}
	return { token, entitlements: await loadEntitlements(baseUrl, token, fetcher) };
}

function openSystemBrowser(url: string): void {
	const command = process.platform === 'darwin'
		? '/usr/bin/open'
		: process.platform === 'win32' ? 'cmd' : 'xdg-open';
	const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
	const result = spawnSync(command, args, { stdio: 'ignore' });
	if (result.status !== 0) {
		throw new Error(`Could not open the system browser. Open this URL manually: ${url}`);
	}
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error('CleanSlate sign-in was cancelled.'));
			return;
		}
		const finish = () => {
			signal?.removeEventListener('abort', cancel);
			resolve();
		};
		const timeout = setTimeout(finish, milliseconds);
		const cancel = () => {
			clearTimeout(timeout);
			signal?.removeEventListener('abort', cancel);
			reject(new Error('CleanSlate sign-in was cancelled.'));
		};
		signal?.addEventListener('abort', cancel, { once: true });
	});
}

export async function authenticateCleanSlateInBrowser(
	options: ICleanSlateBrowserAuthOptions = {}
): Promise<ICleanSlateManagedSignIn> {
	const env = options.env ?? process.env;
	const fetcher = options.fetcher ?? fetch;
	const baseUrl = apiBaseUrl(env);
	const startResponse = await fetcher(`${baseUrl}/auth/device`, {
		method: 'POST',
		headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
		body: JSON.stringify({
			device_name: `CleanSlate CLI (${process.platform})`,
			source: 'cleanslate-cli'
		}),
		signal: options.signal
	});
	if (!startResponse.ok) {
		throw await responseError(startResponse);
	}
	const authorization = await startResponse.json() as Partial<IDeviceAuthorization>;
	if (!authorization.device_code || !authorization.verification_uri_complete) {
		throw new Error('TheWariend did not return a valid CleanSlate device authorization.');
	}

	options.onReady?.(authorization.verification_uri_complete);
	await (options.openBrowser ?? openSystemBrowser)(authorization.verification_uri_complete);

	const deadline = Date.now() + Math.max(30, authorization.expires_in ?? 600) * 1_000;
	const interval = Math.max(1, authorization.interval ?? 2) * 1_000;
	const sleep = options.sleep ?? wait;
	while (Date.now() < deadline) {
		if (options.signal?.aborted) {
			throw new Error('CleanSlate sign-in was cancelled.');
		}
		const tokenResponse = await fetcher(`${baseUrl}/auth/device/token`, {
			method: 'POST',
			headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
			body: JSON.stringify({ device_code: authorization.device_code }),
			signal: options.signal
		});
		const tokenBody = await tokenResponse.json().catch(() => ({})) as { token?: string; error?: string };
		if (tokenResponse.ok && tokenBody.token) {
			return {
				token: tokenBody.token,
				entitlements: await loadEntitlements(baseUrl, tokenBody.token, fetcher)
			};
		}
		if (tokenBody.error !== 'authorization_pending') {
			throw await responseError(new Response(JSON.stringify(tokenBody), {
				status: tokenResponse.status,
				headers: { 'Content-Type': 'application/json' }
			}));
		}
		await sleep(interval, options.signal);
	}
	throw new Error('CleanSlate browser sign-in timed out. Run /setup to try again.');
}
