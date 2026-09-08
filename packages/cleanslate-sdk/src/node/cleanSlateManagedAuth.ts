/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'node:child_process';
import type { ICleanSlateManagedEntitlements } from '../protocol/cleanSlateAI.js';

const DEFAULT_API_BASE_URL = 'https://api.thewariend.com/api';

export interface ICleanSlateManagedSignIn {
	token: string;
	entitlements: ICleanSlateManagedEntitlements;
}

export interface ICleanSlateManagedAuthOptions {
	apiBaseUrl?: string;
	deviceName?: string;
	fetcher?: typeof fetch;
}

export interface ICleanSlateBrowserAuthOptions extends ICleanSlateManagedAuthOptions {
	onReady?: (url: string) => void;
	openBrowser?: (url: string) => void | Promise<void>;
	signal?: AbortSignal;
	sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

interface IDeviceAuthorization {
	device_code: string;
	verification_uri_complete: string;
	expires_in?: number;
	interval?: number;
}

function resolveApiBaseUrl(value?: string): string {
	const baseUrl = (value?.trim() || process.env['CLEANSLATE_API_BASE_URL']?.trim() || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
	const parsed = new URL(baseUrl);
	const localDevelopment = isLocalHostname(parsed.hostname);
	if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && localDevelopment)) {
		throw new Error('CleanSlate authentication requires HTTPS (HTTP is allowed only for local development).');
	}
	if (parsed.username || parsed.password || parsed.search || parsed.hash) {
		throw new Error('CleanSlate authentication API URLs cannot contain credentials, query parameters, or fragments.');
	}
	return baseUrl;
}

function isLocalHostname(hostname: string): boolean {
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function seconds(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
	return typeof value === 'number' && Number.isFinite(value)
		? Math.min(maximum, Math.max(minimum, value))
		: fallback;
}

async function responseError(response: Response): Promise<Error> {
	const body = await response.json().catch(() => ({})) as { message?: string; error?: string; errors?: Record<string, string[]> };
	const validation = body.errors ? Object.values(body.errors)[0]?.[0] : undefined;
	return new Error(validation || body.message || body.error || `CleanSlate authentication failed (${response.status}).`);
}

async function loadEntitlements(baseUrl: string, token: string, fetcher: typeof fetch, signal?: AbortSignal): Promise<ICleanSlateManagedEntitlements> {
	const response = await fetcher(`${baseUrl}/cleanslate/entitlements`, {
		headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Cache-Control': 'no-store' },
		signal
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

function openSystemBrowser(url: string): void {
	const command = process.platform === 'darwin' ? '/usr/bin/open' : process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open';
	const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
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

/** Open the browser-based device flow and return a token usable by provider `cleanslate`. */
export async function authenticateCleanSlateInBrowser(
	options: ICleanSlateBrowserAuthOptions = {}
): Promise<ICleanSlateManagedSignIn> {
	const baseUrl = resolveApiBaseUrl(options.apiBaseUrl);
	const fetcher = options.fetcher ?? fetch;
	const startResponse = await fetcher(`${baseUrl}/auth/device`, {
		method: 'POST',
		headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
		body: JSON.stringify({
			device_name: options.deviceName?.trim() || `CleanSlate SDK (${process.platform})`
		}),
		signal: options.signal
	});
	if (!startResponse.ok) {
		throw await responseError(startResponse);
	}
	const authorization = await startResponse.json() as Partial<IDeviceAuthorization>;
	if (!authorization.device_code || !authorization.verification_uri_complete) {
		throw new Error('The server did not return a valid CleanSlate device authorization.');
	}
	const verificationUrl = new URL(authorization.verification_uri_complete);
	const localVerificationUrl = verificationUrl.protocol === 'http:' && isLocalHostname(verificationUrl.hostname);
	if ((verificationUrl.protocol !== 'https:' && !localVerificationUrl) || verificationUrl.username || verificationUrl.password) {
		throw new Error('CleanSlate returned an insecure device authorization URL.');
	}

	options.onReady?.(verificationUrl.href);
	await (options.openBrowser ?? openSystemBrowser)(verificationUrl.href);

	const deadline = Date.now() + seconds(authorization.expires_in, 600, 1, 3_600) * 1_000;
	const interval = seconds(authorization.interval, 2, 1, 60) * 1_000;
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
			return { token: tokenBody.token, entitlements: await loadEntitlements(baseUrl, tokenBody.token, fetcher, options.signal) };
		}
		if (tokenBody.error !== 'authorization_pending') {
			throw new Error(tokenBody.error || `CleanSlate authentication failed (${tokenResponse.status}).`);
		}
		await sleep(interval, options.signal);
	}
	throw new Error('CleanSlate browser sign-in timed out.');
}
