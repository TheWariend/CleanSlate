/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NodeHttpHandler } from '@smithy/node-http-handler';
import { HttpsProxyAgent } from 'https-proxy-agent';
import {
	Agent,
	Dispatcher,
	ProxyAgent,
	fetch as undiciFetch,
	setGlobalDispatcher
} from 'undici';
import { CleanSlateEnvLookup, normalizeEnvValue } from '../protocol/cleanSlateRuntimeConfig.js';

interface ICleanSlateProxyEnvironment {
	httpProxy?: string;
	httpsProxy?: string;
	noProxy?: string;
}

interface INoProxyEntry {
	hostname: string;
	port?: number;
}

/**
 * Node's fetch did not gain native environment-proxy support until after the
 * SDK's minimum Node 20 release. Keep proxy selection local to this host and
 * feed the values supplied by its environment seam to every transport.
 */
export class CleanSlateNodeHttpTransport {
	private readonly proxyEnvironment: ICleanSlateProxyEnvironment;
	private readonly dispatcher: CleanSlateProxyDispatcher | undefined;
	private globalDispatcherInstalled = false;

	constructor(lookup: CleanSlateEnvLookup) {
		this.proxyEnvironment = readProxyEnvironment(lookup);
		if (this.proxyEnvironment.httpProxy || this.proxyEnvironment.httpsProxy) {
			this.dispatcher = new CleanSlateProxyDispatcher(this.proxyEnvironment);
		}
	}

	get usesProxy(): boolean {
		return this.dispatcher !== undefined;
	}

	/** Uses the original global fetch unchanged when no proxy is configured. */
	fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
		if (!this.dispatcher) {
			return globalThis.fetch(input, init);
		}
		return undiciFetch(input as any, { ...init, dispatcher: this.dispatcher } as any) as unknown as Promise<Response>;
	}

	/**
	 * Gemini currently calls global fetch without a client-level transport hook.
	 * Install the same dispatcher lazily, only for a proxy-configured host.
	 */
	ensureGlobalDispatcher(): void {
		if (!this.dispatcher || this.globalDispatcherInstalled) {
			return;
		}
		setGlobalDispatcher(this.dispatcher);
		this.globalDispatcherInstalled = true;
	}

	/**
	 * AWS uses node:http rather than fetch. Route each Smithy request through a
	 * direct or CONNECT handler after applying NO_PROXY to its actual endpoint.
	 */
	createAwsRequestHandler(): any | undefined {
		if (!this.usesProxy) {
			return undefined;
		}

		const directHandler = new NodeHttpHandler();
		const proxyHandlers = new Map<string, NodeHttpHandler>();
		const getHandler = (request: any): NodeHttpHandler => {
			const protocol = request.protocol || 'https:';
			const port = request.port ? `:${request.port}` : '';
			const url = new URL(`${protocol}//${request.hostname}${port}${request.path || '/'}`);
			const proxyUrl = proxyUrlFor(url, this.proxyEnvironment);
			if (!proxyUrl) {
				return directHandler;
			}
			let handler = proxyHandlers.get(proxyUrl);
			if (!handler) {
				const agent = new HttpsProxyAgent(proxyUrl);
				handler = new NodeHttpHandler({ httpAgent: agent, httpsAgent: agent });
				proxyHandlers.set(proxyUrl, handler);
			}
			return handler;
		};

		return {
			metadata: directHandler.metadata,
			handle: (request: any, options: any) => getHandler(request).handle(request, options),
			destroy: () => {
				directHandler.destroy();
				for (const handler of proxyHandlers.values()) {
					handler.destroy();
				}
			}
		};
	}
}

class CleanSlateProxyDispatcher extends Dispatcher {
	private readonly direct = new Agent();
	private readonly httpProxy: Dispatcher;
	private readonly httpsProxy: Dispatcher;

	constructor(private readonly environment: ICleanSlateProxyEnvironment) {
		super();
		this.httpProxy = environment.httpProxy ? new ProxyAgent(environment.httpProxy) : this.direct;
		this.httpsProxy = environment.httpsProxy
			? new ProxyAgent(environment.httpsProxy)
			: this.httpProxy;
	}

	override dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandlers): boolean {
		const origin = new URL(options.origin ?? 'http://localhost');
		const proxyUrl = proxyUrlFor(origin, this.environment);
		if (!proxyUrl) {
			return this.direct.dispatch(options, handler);
		}
		return (origin.protocol === 'https:' ? this.httpsProxy : this.httpProxy).dispatch(options, handler);
	}

	override close(): Promise<void>;
	override close(callback: () => void): void;
	override close(callback?: () => void): Promise<void> | void {
		const result = Promise.all(uniqueDispatchers(this.direct, this.httpProxy, this.httpsProxy).map(dispatcher => dispatcher.close())).then(() => undefined);
		if (callback) {
			void result.then(callback, callback);
			return;
		}
		return result;
	}

	override destroy(): Promise<void>;
	override destroy(error: Error | null): Promise<void>;
	override destroy(callback: () => void): void;
	override destroy(error: Error | null, callback: () => void): void;
	override destroy(errorOrCallback?: Error | null | (() => void), callback?: () => void): Promise<void> | void {
		const error = typeof errorOrCallback === 'function' ? null : errorOrCallback ?? null;
		const done = typeof errorOrCallback === 'function' ? errorOrCallback : callback;
		const result = Promise.all(
			uniqueDispatchers(this.direct, this.httpProxy, this.httpsProxy).map(dispatcher => dispatcher.destroy(error))
		).then(() => undefined);
		if (done) {
			void result.then(done, done);
			return;
		}
		return result;
	}
}

function uniqueDispatchers(...dispatchers: Dispatcher[]): Dispatcher[] {
	return Array.from(new Set(dispatchers));
}

function readProxyEnvironment(lookup: CleanSlateEnvLookup): ICleanSlateProxyEnvironment {
	// Match the conventional precedence used by Undici/curl when both cases exist.
	return {
		httpProxy: normalizeEnvValue(lookup('http_proxy')) ?? normalizeEnvValue(lookup('HTTP_PROXY')),
		httpsProxy: normalizeEnvValue(lookup('https_proxy')) ?? normalizeEnvValue(lookup('HTTPS_PROXY')),
		noProxy: normalizeEnvValue(lookup('no_proxy')) ?? normalizeEnvValue(lookup('NO_PROXY'))
	};
}

export function proxyUrlFor(url: URL, environment: ICleanSlateProxyEnvironment): string | undefined {
	if (matchesNoProxy(url, environment.noProxy)) {
		return undefined;
	}
	if (url.protocol === 'https:') {
		return environment.httpsProxy ?? environment.httpProxy;
	}
	if (url.protocol === 'http:') {
		return environment.httpProxy;
	}
	return undefined;
}

function matchesNoProxy(url: URL, noProxy: string | undefined): boolean {
	if (!noProxy) {
		return false;
	}
	const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
	const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
	for (const rawEntry of noProxy.split(/[,\s]+/)) {
		if (!rawEntry) {
			continue;
		}
		if (rawEntry === '*') {
			return true;
		}
		const entry = parseNoProxyEntry(rawEntry);
		if (entry.port !== undefined && entry.port !== port) {
			continue;
		}
		const pattern = entry.hostname.toLowerCase();
		if (pattern.startsWith('.') || pattern.startsWith('*.')) {
			const suffix = pattern.replace(/^\*/, '');
			if (hostname.endsWith(suffix)) {
				return true;
			}
		} else if (hostname === pattern) {
			return true;
		}
	}
	return false;
}

function parseNoProxyEntry(value: string): INoProxyEntry {
	if (value.startsWith('[')) {
		const match = /^\[([^\]]+)\](?::(\d+))?$/.exec(value);
		if (match) {
			return { hostname: match[1], port: match[2] ? Number(match[2]) : undefined };
		}
	}
	const match = /^(.*?)(?::(\d+))?$/.exec(value);
	return { hostname: match?.[1] || value, port: match?.[2] ? Number(match[2]) : undefined };
}
