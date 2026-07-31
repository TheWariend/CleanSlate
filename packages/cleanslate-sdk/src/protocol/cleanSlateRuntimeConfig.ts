/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICleanSlateRuntimeConfig } from './cleanSlateAI.js';

/**
 * Resolves a variable to its trimmed value, or `undefined` when unset or blank.
 * Hosts layer their own sources behind this (process env, `.env` files, …); the
 * lookup is the only thing they need to supply to build a runtime config.
 */
export type CleanSlateEnvLookup = (name: string) => string | undefined;

export const CLEANSLATE_DEFAULT_AUTH_WEB_URL = 'https://thewariend.com/auth';
export const CLEANSLATE_DEFAULT_API_BASE_URL = 'https://api.thewariend.com/api';
export const CLEANSLATE_DEFAULT_PRO_CHECKOUT_URL = 'https://api.thewariend.com/checkout/cleanslate/pro';

/** Trims a raw env value, treating blank as unset. Does not touch the value otherwise. */
export function normalizeEnvValue(value: string | undefined): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Trims a base URL and drops trailing slashes so callers can join paths with a
 * plain `${base}/x` without producing `//`, which strict gateways 404 on.
 */
export function normalizeBaseUrlValue(value: string | undefined): string | undefined {
	const trimmed = normalizeEnvValue(value);
	if (!trimmed) {
		return undefined;
	}
	const stripped = trimmed.replace(/\/+$/, '');
	return stripped.length > 0 ? stripped : undefined;
}

/**
 * Resolves a CleanSlate service URL from the environment, falling back to the
 * shipped default. Throws rather than returning a malformed URL — a bad
 * override should fail loudly at startup instead of producing requests to a
 * nonsense host later.
 */
export function resolveCleanSlateUrl(name: string, fallback: string, lookup: CleanSlateEnvLookup): string {
	const value = normalizeBaseUrlValue(lookup(name)) ?? fallback.replace(/\/+$/, '');
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error(`${name} must be an absolute HTTP(S) URL.`);
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error(`${name} must use HTTP or HTTPS.`);
	}
	return value;
}

/**
 * Builds the runtime config every host serves from `getRuntimeConfig`. The
 * managed AI base is always derived from the API base so the two can never
 * point at different deployments.
 */
export function buildCleanSlateRuntimeConfig(lookup: CleanSlateEnvLookup): ICleanSlateRuntimeConfig {
	const authWebUrl = resolveCleanSlateUrl('CLEANSLATE_AUTH_WEB_URL', CLEANSLATE_DEFAULT_AUTH_WEB_URL, lookup);
	const apiBaseUrl = resolveCleanSlateUrl('CLEANSLATE_API_BASE_URL', CLEANSLATE_DEFAULT_API_BASE_URL, lookup);
	const proCheckoutUrl = resolveCleanSlateUrl('CLEANSLATE_PRO_CHECKOUT_URL', CLEANSLATE_DEFAULT_PRO_CHECKOUT_URL, lookup);
	return { authWebUrl, apiBaseUrl, managedAIBaseUrl: `${apiBaseUrl}/cleanslate`, proCheckoutUrl };
}

/** The managed-provider base URL, derived from the same API base as the runtime config. */
export function resolveCleanSlateManagedBaseUrl(lookup: CleanSlateEnvLookup): string {
	return `${resolveCleanSlateUrl('CLEANSLATE_API_BASE_URL', CLEANSLATE_DEFAULT_API_BASE_URL, lookup)}/cleanslate`;
}
