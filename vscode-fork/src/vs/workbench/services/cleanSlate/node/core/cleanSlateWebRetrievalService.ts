/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dns from 'dns';
import * as net from 'net';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { listenStream } from '../../../../../base/common/stream.js';
import { IHeaders } from '../../../../../base/parts/request/common/request.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IRequestService } from '../../../../../platform/request/common/request.js';
import type {
	CleanSlateWebFetchFormat,
	CleanSlateWebSearchProvider,
	ICleanSlateWebCitation,
	ICleanSlateWebDomainFilters,
	ICleanSlateWebFetchOptions,
	ICleanSlateWebFetchResponse,
	ICleanSlateWebProviderAttempt,
	ICleanSlateWebSearchOptions,
	ICleanSlateWebSearchResponse,
	ICleanSlateWebSearchResult
} from '../../common/core/cleanSlateAI.js';

const DEFAULT_SEARCH_PROVIDERS: readonly CleanSlateWebSearchProvider[] = ['searxng', 'exaMcpAnonymous', 'parallelMcpAnonymous'];
const EXA_MCP_URL = 'https://mcp.exa.ai/mcp';
const PARALLEL_MCP_URL = 'https://search.parallel.ai/mcp';

const DEFAULT_SEARCH_TIMEOUT_MS = 25_000;
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const MAX_SEARCH_RESULTS = 20;
const MAX_SEARCH_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_FETCH_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_FETCH_CONTENT_CHARS = 120_000;
const MAX_URL_LENGTH = 2_000;
const CACHE_TTL_MS = 15 * 60 * 1000;

interface ICacheEntry<T> {
	readonly expiresAt: number;
	readonly value: T;
}

interface IHttpTextResponse {
	readonly url: string;
	readonly statusCode: number;
	readonly headers: IHeaders;
	readonly body: string;
	readonly bytes: number;
	readonly redirectUrl?: string;
}

interface IHttpRequestOptions {
	readonly method?: 'GET' | 'POST';
	readonly headers?: IHeaders;
	readonly body?: string;
	readonly timeoutMs: number;
	readonly maxBytes: number;
	readonly maxRedirects?: number;
	readonly allowCrossHostRedirects?: boolean;
	readonly validatePublicWebTarget?: boolean;
}

interface IProviderSearchResult {
	readonly provider: CleanSlateWebSearchProvider;
	readonly results: ICleanSlateWebSearchResult[];
	readonly rawContent?: string;
}

export class CleanSlateWebRetrievalService {
	private readonly searchCache = new Map<string, ICacheEntry<ICleanSlateWebSearchResponse>>();
	private readonly fetchCache = new Map<string, ICacheEntry<ICleanSlateWebFetchResponse>>();

	constructor(
		private readonly requestService: IRequestService,
		private readonly logService: ILogService
	) { }

	async search(options: ICleanSlateWebSearchOptions, token: CancellationToken): Promise<ICleanSlateWebSearchResponse> {
		const query = normalizeWhitespace(options.query);
		if (!query) {
			return {
				success: false,
				query: '',
				results: [],
				citations: [],
				attempts: [],
				error: 'web_search requires a non-empty query.'
			};
		}

		const maxResults = clampInteger(options.maxResults, 8, 1, MAX_SEARCH_RESULTS);
		const providerOrder = this.normalizeProviderOrder(options.providerOrder);
		const cacheKey = JSON.stringify({
			query,
			maxResults,
			providerOrder,
			searxngBaseUrl: options.searxngBaseUrl,
			includeAnonymousHostedProviders: options.includeAnonymousHostedProviders !== false,
			domains: normalizeDomainFilters(options.domains)
		});
		const cached = this.getCached(this.searchCache, cacheKey);
		if (cached) {
			return cached;
		}

		const attempts: ICleanSlateWebProviderAttempt[] = [];
		for (const provider of providerOrder) {
			if (token.isCancellationRequested) {
				break;
			}

			if (provider === 'searxng' && !normalizeOptionalUrl(options.searxngBaseUrl)) {
				attempts.push({
					provider,
					status: 'skipped',
					reason: 'No SearXNG base URL is configured.'
				});
				continue;
			}
			if ((provider === 'exaMcpAnonymous' || provider === 'parallelMcpAnonymous') && options.includeAnonymousHostedProviders === false) {
				attempts.push({
					provider,
					status: 'skipped',
					reason: 'Anonymous hosted web-search providers are disabled.'
				});
				continue;
			}

			const start = Date.now();
			try {
				const providerResult = await this.searchWithProvider(provider, {
					...options,
					query,
					maxResults
				}, token);
				const filtered = applyDomainFilters(providerResult.results, options.domains).slice(0, maxResults);
				if (filtered.length === 0 && !providerResult.rawContent) {
					attempts.push({
						provider,
						status: 'failed',
						reason: 'Provider returned no usable results.',
						durationMs: Date.now() - start
					});
					continue;
				}

				attempts.push({
					provider,
					status: 'success',
					durationMs: Date.now() - start
				});
				const response: ICleanSlateWebSearchResponse = {
					success: true,
					query,
					provider,
					results: filtered,
					citations: toCitations(filtered),
					attempts,
					rawContent: providerResult.rawContent
				};
				this.setCached(this.searchCache, cacheKey, response);
				return response;
			} catch (error) {
				const message = getErrorMessage(error);
				attempts.push({
					provider,
					status: 'failed',
					reason: message,
					durationMs: Date.now() - start
				});
				if (options.hardStopOnQuota !== false && isQuotaOrAuthFailure(message)) {
					break;
				}
				this.logService.warn(`[CleanSlateWebRetrieval] ${provider} search failed: ${message}`);
			}
		}

		const response: ICleanSlateWebSearchResponse = {
			success: false,
			query,
			results: [],
			citations: [],
			attempts,
			error: attempts.length
				? `No web search provider returned usable results. Last status: ${attempts[attempts.length - 1].reason ?? attempts[attempts.length - 1].status}.`
				: 'No web search providers are enabled.'
		};
		return response;
	}

	async fetch(options: ICleanSlateWebFetchOptions, token: CancellationToken): Promise<ICleanSlateWebFetchResponse> {
		const format = normalizeFetchFormat(options.format);
		let normalized: { url: URL; upgradedFrom?: string };
		try {
			normalized = normalizeFetchUrl(options.url, options.allowPlainHttp === true);
			await assertPublicWebUrl(normalized.url);
		} catch (error) {
			return {
				success: false,
				url: options.url,
				format,
				citations: [],
				code: 'invalid_url',
				error: getErrorMessage(error)
			};
		}

		const timeoutMs = clampInteger(options.timeoutMs, DEFAULT_FETCH_TIMEOUT_MS, 5_000, 120_000);
		const maxBytes = clampInteger(options.maxBytes, MAX_FETCH_RESPONSE_BYTES, 256 * 1024, MAX_FETCH_RESPONSE_BYTES);
		const maxContentCharacters = clampInteger(options.maxContentCharacters, MAX_FETCH_CONTENT_CHARS, 1_000, MAX_FETCH_CONTENT_CHARS);
		const cacheKey = JSON.stringify({ url: normalized.url.toString(), format, maxBytes, maxContentCharacters });
		const cached = this.getCached(this.fetchCache, cacheKey);
		if (cached) {
			return cached;
		}

		try {
			const response = await this.requestText(normalized.url, {
				method: 'GET',
				headers: {
					'User-Agent': 'CleanSlate/1.0 WebFetch',
					'Accept': acceptHeaderForFormat(format),
					'Accept-Language': 'en-US,en;q=0.9',
					'DNT': '1',
					'Sec-GPC': '1'
				},
				timeoutMs,
				maxBytes,
				maxRedirects: 10,
				allowCrossHostRedirects: false,
				validatePublicWebTarget: true
			}, token);

			if (response.redirectUrl) {
				return {
					success: false,
					url: normalized.url.toString(),
					finalUrl: response.url,
					format,
					citations: [{ url: response.url }],
					redirectUrl: response.redirectUrl,
					code: 'cross_host_redirect',
					error: `Refusing to follow cross-host redirect to ${response.redirectUrl}. Call web_fetch on that URL explicitly if it is intended.`
				};
			}

			if (response.statusCode < 200 || response.statusCode >= 300) {
				return {
					success: false,
					url: normalized.upgradedFrom ?? normalized.url.toString(),
					finalUrl: response.url,
					format,
					contentType: getHeader(response.headers, 'content-type'),
					bytes: response.bytes,
					citations: [{ url: response.url }],
					code: 'http_error',
					error: `HTTP ${response.statusCode}`
				};
			}

			const contentType = getHeader(response.headers, 'content-type') ?? '';
			const title = extractHtmlTitle(response.body);
			const extracted = extractContent(response.body, response.url, contentType, format);
			const truncated = extracted.length > maxContentCharacters;
			const content = truncated ? extracted.slice(0, maxContentCharacters) : extracted;
			const result: ICleanSlateWebFetchResponse = {
				success: true,
				url: normalized.upgradedFrom ?? normalized.url.toString(),
				finalUrl: response.url,
				format,
				title,
				contentType,
				content,
				bytes: response.bytes,
				truncated,
				citations: [{ url: response.url, title }]
			};
			this.setCached(this.fetchCache, cacheKey, result);
			return result;
		} catch (error) {
			return {
				success: false,
				url: normalized.upgradedFrom ?? normalized.url.toString(),
				format,
				citations: [],
				code: 'request_failed',
				error: getErrorMessage(error)
			};
		}
	}

	private normalizeProviderOrder(providerOrder: CleanSlateWebSearchProvider[] | undefined): CleanSlateWebSearchProvider[] {
		const requested = Array.isArray(providerOrder) ? providerOrder : [];
		const valid = requested.filter((provider): provider is CleanSlateWebSearchProvider => DEFAULT_SEARCH_PROVIDERS.includes(provider));
		return valid.length > 0 ? Array.from(new Set(valid)) : [...DEFAULT_SEARCH_PROVIDERS];
	}

	private async searchWithProvider(provider: CleanSlateWebSearchProvider, options: ICleanSlateWebSearchOptions, token: CancellationToken): Promise<IProviderSearchResult> {
		switch (provider) {
			case 'searxng':
				return this.searchSearxng(options, token);
			case 'exaMcpAnonymous':
				return this.searchExaMcp(options, token);
			case 'parallelMcpAnonymous':
				return this.searchParallelMcp(options, token);
		}
	}

	private async searchSearxng(options: ICleanSlateWebSearchOptions, token: CancellationToken): Promise<IProviderSearchResult> {
		const base = normalizeOptionalUrl(options.searxngBaseUrl);
		if (!base) {
			throw new Error('SearXNG base URL is not configured.');
		}

		const searchUrl = new URL('search', ensureTrailingSlash(base));
		searchUrl.searchParams.set('q', options.query);
		searchUrl.searchParams.set('format', 'json');
		searchUrl.searchParams.set('categories', 'general');
		searchUrl.searchParams.set('language', 'auto');
		searchUrl.searchParams.set('safesearch', '0');

		const response = await this.requestText(searchUrl, {
			method: 'GET',
			headers: {
				'User-Agent': 'CleanSlate/1.0 WebSearch',
				'Accept': 'application/json'
			},
			timeoutMs: clampInteger(options.timeoutMs, DEFAULT_SEARCH_TIMEOUT_MS, 5_000, 60_000),
			maxBytes: MAX_SEARCH_RESPONSE_BYTES,
			maxRedirects: 3,
			allowCrossHostRedirects: false,
			validatePublicWebTarget: false
		}, token);
		if (response.statusCode < 200 || response.statusCode >= 300) {
			throw new Error(`SearXNG returned HTTP ${response.statusCode}.`);
		}

		const data = parseJsonObject(response.body);
		const rawResults = Array.isArray(data.results) ? data.results : [];
		const maxResults = clampInteger(options.maxResults, 8, 1, MAX_SEARCH_RESULTS);
		const results: ICleanSlateWebSearchResult[] = [];
		for (const item of rawResults) {
			if (!item || typeof item !== 'object') {
				continue;
			}
			const record = item as Record<string, unknown>;
			const url = normalizeResultUrl(record.url);
			if (!url) {
				continue;
			}
			const title = normalizeWhitespace(asString(record.title)) || url.hostname;
			const snippet = normalizeWhitespace(asString(record.content) || asString(record.snippet));
			results.push({
				title,
				url: url.toString(),
				snippet,
				publishedDate: normalizeWhitespace(asString(record.publishedDate)),
				source: normalizeWhitespace(asString(record.engine) || asString(record.source)),
				provider: 'searxng',
				score: typeof record.score === 'number' ? record.score : undefined
			});
			if (results.length >= maxResults) {
				break;
			}
		}
		return { provider: 'searxng', results };
	}

	private async searchExaMcp(options: ICleanSlateWebSearchOptions, token: CancellationToken): Promise<IProviderSearchResult> {
		const body = JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/call',
			params: {
				name: 'web_search_exa',
				arguments: {
					query: options.query,
					type: 'auto',
					numResults: clampInteger(options.maxResults, 8, 1, MAX_SEARCH_RESULTS),
					livecrawl: 'fallback',
					contextMaxCharacters: 12_000
				}
			}
		});
		const response = await this.requestText(new URL(EXA_MCP_URL), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Accept': 'application/json, text/event-stream',
				'User-Agent': 'CleanSlate/1.0 WebSearch'
			},
			body,
			timeoutMs: clampInteger(options.timeoutMs, DEFAULT_SEARCH_TIMEOUT_MS, 5_000, 60_000),
			maxBytes: MAX_SEARCH_RESPONSE_BYTES,
			maxRedirects: 3,
			allowCrossHostRedirects: false,
			validatePublicWebTarget: false
		}, token);
		if (response.statusCode < 200 || response.statusCode >= 300) {
			throw new Error(`Exa MCP returned HTTP ${response.statusCode}.`);
		}
		const rawContent = parseMcpTextResponse(response.body);
		return {
			provider: 'exaMcpAnonymous',
			results: extractResultsFromProviderText(rawContent, 'exaMcpAnonymous', options.maxResults),
			rawContent
		};
	}

	private async searchParallelMcp(options: ICleanSlateWebSearchOptions, token: CancellationToken): Promise<IProviderSearchResult> {
		const body = JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/call',
			params: {
				name: 'web_search',
				arguments: {
					objective: options.query,
					search_queries: [options.query],
					session_id: options.sessionId,
					model_name: options.modelName
				}
			}
		});
		const response = await this.requestText(new URL(PARALLEL_MCP_URL), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Accept': 'application/json, text/event-stream',
				'User-Agent': 'CleanSlate/1.0 WebSearch'
			},
			body,
			timeoutMs: clampInteger(options.timeoutMs, DEFAULT_SEARCH_TIMEOUT_MS, 5_000, 60_000),
			maxBytes: MAX_SEARCH_RESPONSE_BYTES,
			maxRedirects: 3,
			allowCrossHostRedirects: false,
			validatePublicWebTarget: false
		}, token);
		if (response.statusCode < 200 || response.statusCode >= 300) {
			throw new Error(`Parallel MCP returned HTTP ${response.statusCode}.`);
		}
		const rawContent = parseMcpTextResponse(response.body);
		return {
			provider: 'parallelMcpAnonymous',
			results: extractResultsFromProviderText(rawContent, 'parallelMcpAnonymous', options.maxResults),
			rawContent
		};
	}

	private async requestText(url: URL, options: IHttpRequestOptions, token: CancellationToken): Promise<IHttpTextResponse> {
		let current = url;
		const maxRedirects = options.maxRedirects ?? 0;
		for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
			if (options.validatePublicWebTarget) {
				await assertPublicWebUrl(current);
			}
			const context = await this.requestService.request({
				url: current.toString(),
				type: options.method ?? 'GET',
				headers: options.headers,
				data: options.body,
				timeout: options.timeoutMs,
				followRedirects: 0,
				disableCache: true
			}, token);
			const statusCode = context.res.statusCode ?? 0;
			if (statusCode >= 300 && statusCode < 400) {
				const location = getHeader(context.res.headers, 'location');
				if (!location) {
					const body = (await readBodyWithLimit(context.stream, options.maxBytes, token)).toString();
					return { url: current.toString(), statusCode, headers: context.res.headers, body, bytes: body.length };
				}
				const next = new URL(location, current);
				if (!options.allowCrossHostRedirects && !isSameNormalizedHost(current, next)) {
					return {
						url: current.toString(),
						statusCode,
						headers: context.res.headers,
						body: '',
						bytes: 0,
						redirectUrl: next.toString()
					};
				}
				current = next;
				continue;
			}

			const lengthHeader = getHeader(context.res.headers, 'content-length');
			const contentLength = lengthHeader ? Number.parseInt(lengthHeader, 10) : undefined;
			if (Number.isFinite(contentLength) && contentLength! > options.maxBytes) {
				throw new Error(`Response too large: ${contentLength} bytes exceeds ${options.maxBytes} byte limit.`);
			}
			const buffer = await readBodyWithLimit(context.stream, options.maxBytes, token);
			return {
				url: current.toString(),
				statusCode,
				headers: context.res.headers,
				body: buffer.toString(),
				bytes: buffer.byteLength
			};
		}
		throw new Error(`Too many redirects while fetching ${url.toString()}.`);
	}

	private getCached<T>(cache: Map<string, ICacheEntry<T>>, key: string): T | undefined {
		const cached = cache.get(key);
		if (!cached) {
			return undefined;
		}
		if (cached.expiresAt <= Date.now()) {
			cache.delete(key);
			return undefined;
		}
		return cached.value;
	}

	private setCached<T>(cache: Map<string, ICacheEntry<T>>, key: string, value: T): void {
		cache.set(key, {
			expiresAt: Date.now() + CACHE_TTL_MS,
			value
		});
		if (cache.size > 100) {
			const oldest = cache.keys().next().value;
			if (oldest) {
				cache.delete(oldest);
			}
		}
	}
}

async function readBodyWithLimit(stream: any, maxBytes: number, token: CancellationToken): Promise<VSBuffer> {
	return new Promise((resolve, reject) => {
		const chunks: VSBuffer[] = [];
		let totalBytes = 0;
		let settled = false;
		const cancellation = token.onCancellationRequested(() => finish(undefined, new Error('Request cancelled.')));
		const finish = (buffer?: VSBuffer, error?: Error) => {
			if (settled) {
				return;
			}
			settled = true;
			cancellation.dispose();
			if (error) {
				reject(error);
			} else {
				resolve(buffer ?? VSBuffer.alloc(0));
			}
		};

		listenStream<VSBuffer>(stream, {
			onData(chunk) {
				if (settled) {
					return;
				}
				totalBytes += chunk.byteLength;
				if (totalBytes > maxBytes) {
					if (typeof stream.destroy === 'function') {
						stream.destroy();
					}
					finish(undefined, new Error(`Response too large: exceeds ${maxBytes} byte limit.`));
					return;
				}
				chunks.push(chunk);
			},
			onError(error) {
				finish(undefined, error instanceof Error ? error : new Error(String(error)));
			},
			onEnd() {
				finish(VSBuffer.concat(chunks, totalBytes));
			}
		}, token);
	});
}

function normalizeProviderTextLink(url: string): string | undefined {
	try {
		const parsed = new URL(url.replace(/[),.;\]]+$/g, ''));
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			return undefined;
		}
		return parsed.toString();
	} catch {
		return undefined;
	}
}

export function extractResultsFromProviderText(text: string | undefined, provider: CleanSlateWebSearchProvider, maxResults = 8): ICleanSlateWebSearchResult[] {
	if (!text) {
		return [];
	}
	const results: ICleanSlateWebSearchResult[] = [];
	const seen = new Set<string>();
	const lines = text.split(/\r?\n/);
	for (const line of lines) {
		for (const match of line.matchAll(/\[([^\]]{1,160})\]\((https?:\/\/[^)\s]+)\)/g)) {
			const url = normalizeProviderTextLink(match[2]);
			if (!url || seen.has(url)) {
				continue;
			}
			seen.add(url);
			results.push({
				title: normalizeWhitespace(match[1]) || new URL(url).hostname,
				url,
				snippet: normalizeWhitespace(stripMarkdownLinks(line)).slice(0, 500),
				provider
			});
			if (results.length >= maxResults) {
				return results;
			}
		}
		for (const match of line.matchAll(/https?:\/\/[^\s<>"']+/g)) {
			const url = normalizeProviderTextLink(match[0]);
			if (!url || seen.has(url)) {
				continue;
			}
			seen.add(url);
			results.push({
				title: new URL(url).hostname,
				url,
				snippet: normalizeWhitespace(stripMarkdownLinks(line)).slice(0, 500),
				provider
			});
			if (results.length >= maxResults) {
				return results;
			}
		}
	}
	return results;
}

export function parseMcpTextResponse(body: string): string | undefined {
	const direct = parseMcpPayload(body.trim());
	if (direct) {
		return direct;
	}
	const parts: string[] = [];
	for (const line of body.split(/\r?\n/)) {
		if (!line.startsWith('data: ')) {
			continue;
		}
		const parsed = parseMcpPayload(line.slice(6).trim());
		if (parsed) {
			parts.push(parsed);
		}
	}
	return parts.length > 0 ? parts.join('\n\n') : undefined;
}

function parseMcpPayload(payload: string): string | undefined {
	if (!payload || !payload.startsWith('{')) {
		return undefined;
	}
	try {
		const data = JSON.parse(payload);
		const content = data?.result?.content;
		if (!Array.isArray(content)) {
			return undefined;
		}
		return content
			.map((item: unknown) => item && typeof item === 'object' && typeof (item as any).text === 'string' ? (item as any).text : undefined)
			.filter((text: unknown): text is string => typeof text === 'string' && text.trim().length > 0)
			.join('\n\n') || undefined;
	} catch {
		return undefined;
	}
}

function normalizeFetchUrl(rawUrl: string | undefined, allowPlainHttp: boolean): { url: URL; upgradedFrom?: string } {
	const trimmed = rawUrl?.trim();
	if (!trimmed) {
		throw new Error('web_fetch requires a URL.');
	}
	if (trimmed.length > MAX_URL_LENGTH) {
		throw new Error(`URL exceeds ${MAX_URL_LENGTH} characters.`);
	}
	const parsed = new URL(trimmed);
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error('Only http and https URLs are supported.');
	}
	if (parsed.username || parsed.password) {
		throw new Error('URLs with embedded credentials are not allowed.');
	}
	if (parsed.protocol === 'http:' && !allowPlainHttp) {
		const upgradedFrom = parsed.toString();
		parsed.protocol = 'https:';
		return { url: parsed, upgradedFrom };
	}
	return { url: parsed };
}

export async function assertPublicWebUrl(url: URL): Promise<void> {
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('Only http and https URLs are supported.');
	}
	if (url.username || url.password) {
		throw new Error('URLs with embedded credentials are not allowed.');
	}
	const hostname = normalizeHostname(url.hostname);
	if (!hostname) {
		throw new Error('URL hostname is required.');
	}
	if (isLocalHostname(hostname)) {
		throw new Error(`Refusing to fetch local/private hostname: ${hostname}.`);
	}
	const ipVersion = net.isIP(hostname);
	if (ipVersion !== 0) {
		if (isPrivateIpAddress(hostname)) {
			throw new Error(`Refusing to fetch private IP address: ${hostname}.`);
		}
		return;
	}

	const addresses = await dns.promises.lookup(hostname, { all: true });
	if (!addresses.length) {
		throw new Error(`Could not resolve hostname: ${hostname}.`);
	}
	for (const address of addresses) {
		if (isPrivateIpAddress(address.address)) {
			throw new Error(`Refusing to fetch hostname that resolves to private IP: ${hostname}.`);
		}
	}
}

export function isPrivateIpAddress(address: string): boolean {
	const normalized = normalizeHostname(address);
	const mappedV4 = normalized.toLowerCase().startsWith('::ffff:')
		? normalized.slice('::ffff:'.length)
		: undefined;
	if (mappedV4 && net.isIP(mappedV4) === 4) {
		return isPrivateIpAddress(mappedV4);
	}

	if (net.isIP(normalized) === 4) {
		const parts = normalized.split('.').map(part => Number.parseInt(part, 10));
		const [a, b] = parts;
		return a === 0
			|| a === 10
			|| a === 127
			|| (a === 100 && b >= 64 && b <= 127)
			|| (a === 169 && b === 254)
			|| (a === 172 && b >= 16 && b <= 31)
			|| (a === 192 && b === 168)
			|| (a === 192 && b === 0)
			|| (a === 198 && (b === 18 || b === 19))
			|| a >= 224;
	}

	if (net.isIP(normalized) === 6) {
		const lower = normalized.toLowerCase();
		return lower === '::'
			|| lower === '::1'
			|| lower.startsWith('fe80:')
			|| lower.startsWith('fc')
			|| lower.startsWith('fd');
	}

	return false;
}

function extractContent(body: string, finalUrl: string, contentType: string, format: CleanSlateWebFetchFormat): string {
	const isHtml = contentType.toLowerCase().includes('html') || /<\/?[a-z][\s\S]*>/i.test(body);
	if (format === 'html') {
		return body;
	}
	if (!isHtml) {
		return normalizeTextBody(body);
	}
	if (format === 'text') {
		return htmlToText(body);
	}
	return htmlToMarkdown(body, finalUrl);
}

export function htmlToMarkdown(html: string, finalUrl = ''): string {
	const base = finalUrl ? new URL(finalUrl) : undefined;
	let content = html
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<script\b[\s\S]*?<\/script>/gi, '')
		.replace(/<style\b[\s\S]*?<\/style>/gi, '')
		.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '')
		.replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
		.replace(/<head\b[\s\S]*?<\/head>/gi, '');

	content = content.replace(/<a\b[^>]*href=["']?([^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a>/gi, (_match, href, label) => {
		const text = normalizeWhitespace(stripHtml(label));
		const resolved = resolveHref(String(href), base);
		if (!text) {
			return resolved ?? '';
		}
		return resolved ? `[${text}](${resolved})` : text;
	});
	content = content
		.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, '\n\n# $1\n\n')
		.replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n\n')
		.replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, '\n\n### $1\n\n')
		.replace(/<h[4-6]\b[^>]*>([\s\S]*?)<\/h[4-6]>/gi, '\n\n#### $1\n\n')
		.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1\n')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|section|article|main|header|footer|blockquote|pre|table|tr|ul|ol)>/gi, '\n\n')
		.replace(/<(p|div|section|article|main|header|footer|blockquote|pre|table|tr|ul|ol)\b[^>]*>/gi, '\n\n');

	return normalizeMarkdown(decodeHtmlEntities(stripHtml(content)));
}

function htmlToText(html: string): string {
	return normalizeTextBody(decodeHtmlEntities(stripHtml(
		html
			.replace(/<!--[\s\S]*?-->/g, '')
			.replace(/<script\b[\s\S]*?<\/script>/gi, '')
			.replace(/<style\b[\s\S]*?<\/style>/gi, '')
			.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '')
			.replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
			.replace(/<head\b[\s\S]*?<\/head>/gi, '')
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/(p|div|section|article|main|header|footer|li|h[1-6])>/gi, '\n')
	)));
}

function stripHtml(value: string): string {
	return value.replace(/<[^>]+>/g, '');
}

function extractHtmlTitle(html: string): string | undefined {
	const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
	const title = titleMatch ? normalizeWhitespace(decodeHtmlEntities(stripHtml(titleMatch[1]))) : '';
	if (title) {
		return title;
	}
	const h1Match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
	const h1 = h1Match ? normalizeWhitespace(decodeHtmlEntities(stripHtml(h1Match[1]))) : '';
	return h1 || undefined;
}

function decodeHtmlEntities(value: string): string {
	return value
		.replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
		.replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/g, "'");
}

function normalizeMarkdown(value: string): string {
	return value
		.split(/\r?\n/)
		.map(line => line.replace(/[ \t]+$/g, '').replace(/[ \t]{2,}/g, ' '))
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function normalizeTextBody(value: string): string {
	return value
		.replace(/\r\n/g, '\n')
		.replace(/[ \t]+/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function resolveHref(href: string, base: URL | undefined): string | undefined {
	try {
		const url = base ? new URL(href, base) : new URL(href);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			return undefined;
		}
		return url.toString();
	} catch {
		return undefined;
	}
}

function acceptHeaderForFormat(format: CleanSlateWebFetchFormat): string {
	switch (format) {
		case 'html':
			return 'text/html, application/xhtml+xml;q=0.9, text/plain;q=0.8, */*;q=0.1';
		case 'text':
			return 'text/plain, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1';
		case 'markdown':
		default:
			return 'text/markdown, text/html;q=0.9, text/plain;q=0.8, */*;q=0.1';
	}
}

function applyDomainFilters(results: ICleanSlateWebSearchResult[], filters: ICleanSlateWebDomainFilters | undefined): ICleanSlateWebSearchResult[] {
	const normalized = normalizeDomainFilters(filters);
	return results.filter(result => {
		let hostname = '';
		try {
			hostname = new URL(result.url).hostname.toLowerCase();
		} catch {
			return false;
		}
		if (normalized.blocked.some(domain => hostMatchesDomain(hostname, domain))) {
			return false;
		}
		if (normalized.allowed.length > 0 && !normalized.allowed.some(domain => hostMatchesDomain(hostname, domain))) {
			return false;
		}
		return true;
	});
}

function normalizeDomainFilters(filters: ICleanSlateWebDomainFilters | undefined): { allowed: string[]; blocked: string[] } {
	return {
		allowed: normalizeDomains(filters?.allowed),
		blocked: normalizeDomains(filters?.blocked)
	};
}

function normalizeDomains(domains: string[] | undefined): string[] {
	if (!Array.isArray(domains)) {
		return [];
	}
	return Array.from(new Set(domains
		.map(domain => normalizeDomain(domain))
		.filter((domain): domain is string => !!domain)));
}

function normalizeDomain(domain: string): string | undefined {
	const trimmed = domain.trim().toLowerCase();
	if (!trimmed || trimmed.includes('*')) {
		return undefined;
	}
	try {
		return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname.replace(/^www\./, '');
	} catch {
		return undefined;
	}
}

function hostMatchesDomain(hostname: string, domain: string): boolean {
	const normalizedHost = hostname.replace(/^www\./, '');
	return normalizedHost === domain || normalizedHost.endsWith(`.${domain}`);
}

function toCitations(results: ICleanSlateWebSearchResult[]): ICleanSlateWebCitation[] {
	const seen = new Set<string>();
	const citations: ICleanSlateWebCitation[] = [];
	for (const result of results) {
		if (seen.has(result.url)) {
			continue;
		}
		seen.add(result.url);
		citations.push({
			url: result.url,
			title: result.title,
			source: result.source
		});
	}
	return citations;
}

function normalizeFetchFormat(format: CleanSlateWebFetchFormat | undefined): CleanSlateWebFetchFormat {
	return format === 'text' || format === 'html' ? format : 'markdown';
}

function parseJsonObject(body: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(body);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
	} catch (error) {
		throw new Error(`Invalid JSON response: ${getErrorMessage(error)}`);
	}
}

function normalizeResultUrl(value: unknown): URL | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	try {
		const url = new URL(value);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			return undefined;
		}
		return url;
	} catch {
		return undefined;
	}
}

function normalizeOptionalUrl(value: string | undefined): URL | undefined {
	if (!value?.trim()) {
		return undefined;
	}
	try {
		const url = new URL(value.trim());
		return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
	} catch {
		return undefined;
	}
}

function ensureTrailingSlash(url: URL): URL {
	const copy = new URL(url.toString());
	if (!copy.pathname.endsWith('/')) {
		copy.pathname += '/';
	}
	return copy;
}

function getHeader(headers: IHeaders, name: string): string | undefined {
	const direct = headers[name] ?? headers[name.toLowerCase()];
	if (Array.isArray(direct)) {
		return direct[0];
	}
	return direct;
}

function isSameNormalizedHost(a: URL, b: URL): boolean {
	return normalizeRedirectHost(a.hostname) === normalizeRedirectHost(b.hostname);
}

function normalizeRedirectHost(hostname: string): string {
	return normalizeHostname(hostname).toLowerCase().replace(/^www\./, '');
}

function normalizeHostname(hostname: string): string {
	const trimmed = hostname.trim();
	return trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;
}

function isLocalHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase();
	return normalized === 'localhost'
		|| normalized === 'localhost.localdomain'
		|| normalized.endsWith('.localhost')
		|| normalized.endsWith('.local')
		|| normalized.endsWith('.internal')
		|| normalized.endsWith('.test');
}

function stripMarkdownLinks(value: string): string {
	return value.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1');
}

function asString(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function normalizeWhitespace(value: string | undefined): string {
	return (value ?? '').replace(/\s+/g, ' ').trim();
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
	if (!Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(max, Math.max(min, Math.floor(value as number)));
}

function isQuotaOrAuthFailure(message: string): boolean {
	return /\b(401|402|403|429|quota|rate limit|unauthorized|payment|required)\b/i.test(message);
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	return String(error);
}

export const cleanSlateWebRetrievalTestExports = {
	extractResultsFromProviderText,
	htmlToMarkdown,
	isPrivateIpAddress,
	parseMcpTextResponse
};
