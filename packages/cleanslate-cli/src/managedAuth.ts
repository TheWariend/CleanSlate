/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICleanSlateManagedEntitlements } from '@slate/sdk';

export interface ICleanSlateManagedSignIn {
	token: string;
	entitlements: ICleanSlateManagedEntitlements;
}

function apiBaseUrl(env: NodeJS.ProcessEnv): string {
	return (env['CLEANSLATE_API_BASE_URL']?.trim() || 'https://api.thewariend.com/api').replace(/\/+$/, '');
}

async function readJson(response: Response): Promise<any> {
	try {
		return await response.json();
	} catch {
		return {};
	}
}

function responseMessage(body: any, fallback: string): string {
	const errors = body?.errors;
	if (errors && typeof errors === 'object') {
		for (const value of Object.values(errors)) {
			if (Array.isArray(value) && typeof value[0] === 'string') {
				return value[0];
			}
		}
	}
	return typeof body?.message === 'string' && body.message.trim() ? body.message : fallback;
}

export async function signInToCleanSlate(
	email: string,
	password: string,
	env: NodeJS.ProcessEnv = process.env,
	fetcher: typeof fetch = fetch
): Promise<ICleanSlateManagedSignIn> {
	const baseUrl = apiBaseUrl(env);
	const loginResponse = await fetcher(`${baseUrl}/auth/login`, {
		method: 'POST',
		headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
		body: JSON.stringify({
			email: email.trim(),
			password,
			device_name: `CleanSlate CLI ${process.platform}`,
			source: 'cleanslate-cli'
		})
	});
	const loginBody = await readJson(loginResponse);
	if (!loginResponse.ok || typeof loginBody?.token !== 'string' || !loginBody.token) {
		throw new Error(responseMessage(loginBody, `CleanSlate sign in failed (${loginResponse.status}).`));
	}

	const token = loginBody.token;
	const entitlementResponse = await fetcher(`${baseUrl}/cleanslate/entitlements`, {
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
	});
	const entitlementBody = await readJson(entitlementResponse);
	if (!entitlementResponse.ok || !entitlementBody?.data) {
		throw new Error(responseMessage(entitlementBody, `Unable to load CleanSlate models (${entitlementResponse.status}).`));
	}
	return { token, entitlements: entitlementBody.data as ICleanSlateManagedEntitlements };
}
