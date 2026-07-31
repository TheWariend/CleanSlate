/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dns from 'node:dns';
import * as net from 'node:net';
import { CancellationToken } from '../core/cancellation.js';
import { normalizeEnvValue } from '../protocol/cleanSlateRuntimeConfig.js';
import {
	CleanSlateWebSearchProvider,
	ICleanSlateWebFetchOptions,
	ICleanSlateWebFetchResponse,
	ICleanSlateWebSearchOptions,
	ICleanSlateWebSearchResponse,
	ICleanSlateWebSearchResult
} from '../protocol/cleanSlateAI.js';
import { CleanSlateNodeHttpTransport } from './cleanSlateNodeHttpTransport.js';

const EXA_MCP_URL = 'https://mcp.exa.ai/mcp';
const PARALLEL_MCP_URL = 'https://search.parallel.ai/mcp';
const MAX_FETCH_BYTES = 5 * 1024 * 1024;

export class CleanSlateNodeWebRetrieval {
	constructor(
		private readonly httpTransport = new CleanSlateNodeHttpTransport(
			(name: string) => normalizeEnvValue(process.env[name])
		)
	) { }

	async search(options: ICleanSlateWebSearchOptions, token: CancellationToken): Promise<ICleanSlateWebSearchResponse> {
		const query = options.query?.trim();
		if (!query) {
			return { success: false, query: '', results: [], citations: [], attempts: [], error: 'web_search requires a query.' };
		}
		const providers = options.providerOrder?.length
			? options.providerOrder
			: ['searxng', 'exaMcpAnonymous', 'parallelMcpAnonymous'] as CleanSlateWebSearchProvider[];
		const attempts: ICleanSlateWebSearchResponse['attempts'] = [];
		for (const provider of providers) {
			if (token.isCancellationRequested) {
				break;
			}
			if (provider === 'searxng' && !options.searxngBaseUrl) {
				attempts.push({ provider, status: 'skipped', reason: 'No SearXNG base URL configured.' });
				continue;
			}
			if (provider !== 'searxng' && options.includeAnonymousHostedProviders === false) {
				attempts.push({ provider, status: 'skipped', reason: 'Anonymous hosted search is disabled.' });
				continue;
			}
			const started = Date.now();
			try {
				const searched: { results: ICleanSlateWebSearchResult[]; rawContent?: string } = provider === 'searxng'
					? await this.searchSearxng(options, token)
					: await this.searchMcp(provider, options, token);
				const results = this.filterDomains(searched.results, options).slice(0, this.maxResults(options.maxResults));
				if (results.length === 0 && !searched.rawContent) {
					throw new Error('Provider returned no usable results.');
				}
				attempts.push({ provider, status: 'success', durationMs: Date.now() - started });
				return {
					success: true,
					query,
					provider,
					results,
					citations: results.map(result => ({ url: result.url, title: result.title, source: result.source })),
					attempts,
					rawContent: searched.rawContent
				};
			} catch (error) {
				attempts.push({
					provider,
					status: 'failed',
					reason: error instanceof Error ? error.message : String(error),
					durationMs: Date.now() - started
				});
			}
		}
		return {
			success: false,
			query,
			results: [],
			citations: [],
			attempts,
			error: attempts.at(-1)?.reason ?? 'No web search provider is available.'
		};
	}

	async fetch(options: ICleanSlateWebFetchOptions, token: CancellationToken): Promise<ICleanSlateWebFetchResponse> {
		const format = options.format === 'html' || options.format === 'text' ? options.format : 'markdown';
		let url: URL;
		try {
			url = new URL(options.url);
			if (url.protocol === 'http:' && options.allowPlainHttp !== true) {
				url.protocol = 'https:';
			}
			await assertPublicUrl(url);
		} catch (error) {
			return {
				success: false,
				url: options.url,
				format,
				citations: [],
				code: 'invalid_url',
				error: error instanceof Error ? error.message : String(error)
			};
		}
		try {
			const response = await this.request(url, {
				method: 'GET',
				headers: { 'user-agent': 'CleanSlate/1.0 WebFetch', accept: 'text/html,text/plain,application/json' }
			}, options.timeoutMs ?? 30_000, options.maxBytes ?? MAX_FETCH_BYTES, token, true);
			const contentType = response.headers.get('content-type') ?? undefined;
			if (!response.ok) {
				return {
					success: false,
					url: options.url,
					finalUrl: response.url,
					format,
					contentType,
					bytes: response.body.length,
					citations: [{ url: response.url }],
					code: 'http_error',
					error: `HTTP ${response.status}`
				};
			}
			const limit = Math.min(120_000, Math.max(1_000, options.maxContentCharacters ?? 120_000));
			const title = this.extractTitle(response.body);
			const extracted = format === 'html'
				? response.body
				: this.htmlToText(response.body, format === 'markdown');
			return {
				success: true,
				url: options.url,
				finalUrl: response.url,
				format,
				title,
				contentType,
				content: extracted.slice(0, limit),
				bytes: response.body.length,
				truncated: extracted.length > limit,
				citations: [{ url: response.url, title }]
			};
		} catch (error) {
			return {
				success: false,
				url: options.url,
				format,
				citations: [],
				code: token.isCancellationRequested ? 'cancelled' : 'request_failed',
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}

	private async searchSearxng(
		options: ICleanSlateWebSearchOptions,
		token: CancellationToken
	): Promise<{ results: ICleanSlateWebSearchResult[] }> {
		const url = new URL('search', `${options.searxngBaseUrl!.replace(/\/+$/, '')}/`);
		url.searchParams.set('q', options.query);
		url.searchParams.set('format', 'json');
		url.searchParams.set('categories', 'general');
		const response = await this.request(url, {
			headers: { accept: 'application/json', 'user-agent': 'CleanSlate/1.0 WebSearch' }
		}, options.timeoutMs ?? 25_000, 2 * 1024 * 1024, token);
		if (!response.ok) {
			throw new Error(`SearXNG returned HTTP ${response.status}.`);
		}
		const data = JSON.parse(response.body);
		return {
			results: (Array.isArray(data.results) ? data.results : []).flatMap((item: any) => {
				const url = this.resultUrl(item?.url);
				return url ? [{
					title: String(item?.title || new URL(url).hostname),
					url,
					snippet: String(item?.content || item?.snippet || '').trim(),
					publishedDate: item?.publishedDate,
					source: item?.engine || item?.source,
					provider: 'searxng' as const,
					score: typeof item?.score === 'number' ? item.score : undefined
				}] : [];
			})
		};
	}

	private async searchMcp(
		provider: Exclude<CleanSlateWebSearchProvider, 'searxng'>,
		options: ICleanSlateWebSearchOptions,
		token: CancellationToken
	): Promise<{ results: ICleanSlateWebSearchResult[]; rawContent?: string }> {
		const exa = provider === 'exaMcpAnonymous';
		const body = exa ? {
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/call',
			params: {
				name: 'web_search_exa',
				arguments: { query: options.query, type: 'auto', numResults: this.maxResults(options.maxResults) }
			}
		} : {
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/call',
			params: {
				name: 'web_search',
				arguments: { objective: options.query, search_queries: [options.query] }
			}
		};
		const response = await this.request(new URL(exa ? EXA_MCP_URL : PARALLEL_MCP_URL), {
			method: 'POST',
			headers: {
				accept: 'application/json, text/event-stream',
				'content-type': 'application/json',
				'user-agent': 'CleanSlate/1.0 WebSearch'
			},
			body: JSON.stringify(body)
		}, options.timeoutMs ?? 25_000, 2 * 1024 * 1024, token);
		if (!response.ok) {
			throw new Error(`${exa ? 'Exa' : 'Parallel'} MCP returned HTTP ${response.status}.`);
		}
		const rawContent = this.parseMcpText(response.body);
		return { results: this.resultsFromText(rawContent, provider, options.maxResults), rawContent };
	}

	private async request(
		url: URL,
		init: RequestInit,
		timeoutMs: number,
		maxBytes: number,
		token: CancellationToken,
		validateRedirects = false
	): Promise<{ ok: boolean; status: number; url: string; headers: Headers; body: string }> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), Math.min(120_000, Math.max(1_000, timeoutMs)));
		const cancellation = token.onCancellationRequested(() => controller.abort());
		try {
			const response = await this.httpTransport.fetch(url, { ...init, redirect: 'follow', signal: controller.signal });
			if (validateRedirects) {
				await assertPublicUrl(new URL(response.url));
			}
			const contentLength = Number(response.headers.get('content-length') || 0);
			if (contentLength > maxBytes) {
				throw new Error(`Response exceeds ${maxBytes} byte limit.`);
			}
			const reader = response.body?.getReader();
			const chunks: Uint8Array[] = [];
			let bytes = 0;
			while (reader) {
				const next = await reader.read();
				if (next.done) {
					break;
				}
				bytes += next.value.byteLength;
				if (bytes > maxBytes) {
					await reader.cancel();
					throw new Error(`Response exceeds ${maxBytes} byte limit.`);
				}
				chunks.push(next.value);
			}
			const joined = new Uint8Array(bytes);
			let offset = 0;
			for (const chunk of chunks) {
				joined.set(chunk, offset);
				offset += chunk.byteLength;
			}
			return {
				ok: response.ok,
				status: response.status,
				url: response.url,
				headers: response.headers,
				body: new TextDecoder().decode(joined)
			};
		} finally {
			clearTimeout(timeout);
			cancellation.dispose();
		}
	}

	private parseMcpText(body: string): string | undefined {
		const payloads = body.split(/\r?\n/)
			.filter(line => line.startsWith('data: '))
			.map(line => line.slice(6));
		if (body.trim().startsWith('{')) {
			payloads.unshift(body.trim());
		}
		const texts: string[] = [];
		for (const payload of payloads) {
			try {
				for (const item of JSON.parse(payload)?.result?.content ?? []) {
					if (typeof item?.text === 'string') {
						texts.push(item.text);
					}
				}
			} catch { /* ignore non-JSON SSE fields */ }
		}
		return texts.join('\n\n') || undefined;
	}

	private resultsFromText(
		text: string | undefined,
		provider: CleanSlateWebSearchProvider,
		maxResults?: number
	): ICleanSlateWebSearchResult[] {
		if (!text) {
			return [];
		}
		const results: ICleanSlateWebSearchResult[] = [];
		const seen = new Set<string>();
		for (const line of text.split(/\r?\n/)) {
			for (const match of line.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
				const url = this.resultUrl(match[0]);
				if (url && !seen.has(url)) {
					seen.add(url);
					results.push({
						title: new URL(url).hostname,
						url,
						snippet: line.replace(/\s+/g, ' ').slice(0, 500),
						provider
					});
				}
				if (results.length >= this.maxResults(maxResults)) {
					return results;
				}
			}
		}
		return results;
	}

	private filterDomains(results: ICleanSlateWebSearchResult[], options: ICleanSlateWebSearchOptions): ICleanSlateWebSearchResult[] {
		const allowed = options.domains?.allowed?.map(value => value.toLowerCase());
		const blocked = options.domains?.blocked?.map(value => value.toLowerCase()) ?? [];
		return results.filter(result => {
			const host = new URL(result.url).hostname.toLowerCase();
			return !blocked.some(domain => host === domain || host.endsWith(`.${domain}`))
				&& (!allowed?.length || allowed.some(domain => host === domain || host.endsWith(`.${domain}`)));
		});
	}

	private htmlToText(html: string, markdown: boolean): string {
		let value = html
			.replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, '\n')
			.replace(/<li\b[^>]*>/gi, markdown ? '- ' : '')
			.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_all, href, text) =>
				markdown ? `[${this.decodeEntities(this.stripTags(text))}](${href})` : this.stripTags(text))
			.replace(/<[^>]+>/g, '');
		value = this.decodeEntities(value);
		return value.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
	}

	private extractTitle(html: string): string | undefined {
		const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
		return title ? this.decodeEntities(this.stripTags(title)).trim() : undefined;
	}

	private stripTags(value: string): string {
		return value.replace(/<[^>]+>/g, '');
	}

	private decodeEntities(value: string): string {
		return value
			.replace(/&nbsp;/gi, ' ')
			.replace(/&amp;/gi, '&')
			.replace(/&lt;/gi, '<')
			.replace(/&gt;/gi, '>')
			.replace(/&quot;/gi, '"')
			.replace(/&#39;|&apos;/gi, "'");
	}

	private resultUrl(value: unknown): string | undefined {
		try {
			const url = new URL(String(value));
			return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
		} catch {
			return undefined;
		}
	}

	private maxResults(value: number | undefined): number {
		return Math.min(20, Math.max(1, Number.isFinite(value) ? Math.floor(value!) : 8));
	}
}

export async function assertPublicUrl(url: URL): Promise<void> {
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('Only HTTP and HTTPS URLs are supported.');
	}
	if (url.username || url.password) {
		throw new Error('URLs with embedded credentials are not allowed.');
	}
	const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
		throw new Error(`Refusing to fetch local/private hostname: ${hostname || '(empty)'}.`);
	}
	if (net.isIP(hostname)) {
		if (isPrivateIp(hostname)) {
			throw new Error(`Refusing to fetch private IP address: ${hostname}.`);
		}
		return;
	}
	const addresses = await dns.promises.lookup(hostname, { all: true });
	if (!addresses.length || addresses.some(address => isPrivateIp(address.address))) {
		throw new Error(`Refusing hostname that resolves to a private address: ${hostname}.`);
	}
}

function isPrivateIp(address: string): boolean {
	const value = address.toLowerCase();
	if (value.startsWith('::ffff:')) {
		return isPrivateIp(value.slice(7));
	}
	if (net.isIP(value) === 4) {
		const [a, b] = value.split('.').map(Number);
		return a === 0 || a === 10 || a === 127 || a >= 224
			|| (a === 100 && b >= 64 && b <= 127)
			|| (a === 169 && b === 254)
			|| (a === 172 && b >= 16 && b <= 31)
			|| (a === 192 && b === 168)
			|| (a === 198 && (b === 18 || b === 19));
	}
	return net.isIP(value) === 6
		&& (value === '::' || value === '::1' || value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd'));
}
