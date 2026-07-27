/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CleanSlateWebFetchFormat, CleanSlateWebSearchProvider } from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { CleanSlateTool, CleanSlateToolContext } from './types.js';
import { cancellationTokenFromAbortSignal } from '../core/cleanSlateCancellation.js';

const CURRENT_YEAR = new Date().getFullYear();

export const webSearchTool: CleanSlateTool = {
	name: 'web_search',
	description: `Search the public web for current or external information. Use this for discovery when the answer may depend on information outside the workspace or after the model training cutoff. Current year: ${CURRENT_YEAR}. Returns ranked results with URLs/citations; use web_fetch when you need to read a specific result page. Free-only mode uses configured SearXNG first and anonymous hosted MCP fallbacks only when enabled.`,
	category: 'discovery',
	parametersSchema: {
		type: 'object',
		properties: {
			query: {
				type: 'string',
				description: 'Concise web search query. Include product/library/version/date terms when freshness matters.'
			},
			maxResults: {
				type: 'number',
				description: 'Maximum number of ranked results to return. Defaults to CleanSlate web-search settings, capped at 20.'
			},
			allowedDomains: {
				type: 'array',
				items: { type: 'string' },
				description: 'Optional domain allowlist, for example ["docs.python.org", "github.com"]. Wildcards are ignored.'
			},
			blockedDomains: {
				type: 'array',
				items: { type: 'string' },
				description: 'Optional domain blocklist. Wildcards are ignored.'
			},
			recencyDays: {
				type: 'number',
				description: 'Optional freshness hint in days. Providers may not support hard recency filtering; include date terms in the query too.'
			}
		},
		required: ['query']
	},
	async run(input: { query?: string; maxResults?: number; allowedDomains?: string[]; blockedDomains?: string[]; recencyDays?: number }, context: CleanSlateToolContext): Promise<any> {
		if (!context.cleanSlateMainService) {
			return {
				success: false,
				code: 'web_retrieval_unavailable',
				error: 'CleanSlate main service is not available for web_search.'
			};
		}

		const query = input.query?.trim();
		if (!query) {
			return {
				success: false,
				code: 'missing_query',
				error: 'web_search requires a non-empty query.'
			};
		}

		const config = await context.configService.getResolvedConfiguration();
		const webSearch = config.webSearch;
		if (webSearch?.enabled === false) {
			return {
				success: false,
				code: 'web_search_disabled',
				error: 'Web search is disabled in CleanSlate settings.'
			};
		}

		const result = await context.cleanSlateMainService.webSearch({
			query,
			maxResults: input.maxResults ?? webSearch?.maxResults,
			providerOrder: normalizeProviderOrder(webSearch?.providerOrder),
			searxngBaseUrl: webSearch?.searxngBaseUrl,
			includeAnonymousHostedProviders: webSearch?.includeAnonymousHostedProviders,
			hardStopOnQuota: webSearch?.hardStopOnQuota,
			timeoutMs: webSearch?.timeoutMs,
			recencyDays: input.recencyDays,
			domains: {
				allowed: normalizeDomains(input.allowedDomains),
				blocked: normalizeDomains(input.blockedDomains)
			}
		}, cancellationTokenFromAbortSignal(context.signal));

		return {
			...result,
			freeOnly: webSearch?.mode ?? 'freeOnly',
			sourcePolicy: 'Use the returned citation URLs when relying on web_search results. Use web_fetch for any page whose content must be inspected directly.'
		};
	}
};

export const webFetchTool: CleanSlateTool = {
	name: 'web_fetch',
	description: 'Fetch and extract a specific public web URL. Use this after web_search or when the user gives a URL. The fetcher runs in the Node process with URL, redirect, DNS/private-network, timeout, size, cache, and content extraction guards. It refuses localhost/private network URLs.',
	category: 'discovery',
	parametersSchema: {
		type: 'object',
		properties: {
			url: {
				type: 'string',
				description: 'Fully qualified http or https URL to fetch. http is upgraded to https unless allowPlainHttp is true.'
			},
			format: {
				type: 'string',
				enum: ['markdown', 'text', 'html'],
				description: 'Return format. Defaults to markdown.'
			},
			maxContentCharacters: {
				type: 'number',
				description: 'Maximum extracted characters returned to the model. Defaults to 120000 and is capped at 120000.'
			},
			allowPlainHttp: {
				type: 'boolean',
				description: 'Set true only when the target is known to require plain HTTP. Private/local hosts remain blocked.'
			}
		},
		required: ['url']
	},
	async run(input: { url?: string; format?: CleanSlateWebFetchFormat; maxContentCharacters?: number; allowPlainHttp?: boolean }, context: CleanSlateToolContext): Promise<any> {
		if (!context.cleanSlateMainService) {
			return {
				success: false,
				code: 'web_retrieval_unavailable',
				error: 'CleanSlate main service is not available for web_fetch.'
			};
		}

		const url = input.url?.trim();
		if (!url) {
			return {
				success: false,
				code: 'missing_url',
				error: 'web_fetch requires a URL.'
			};
		}

		const config = await context.configService.getResolvedConfiguration();
		if (config.webSearch?.enabled === false) {
			return {
				success: false,
				code: 'web_search_disabled',
				error: 'Web retrieval is disabled in CleanSlate settings.'
			};
		}

		const result = await context.cleanSlateMainService.webFetch({
			url,
			format: normalizeFormat(input.format),
			timeoutMs: config.webSearch?.timeoutMs,
			maxContentCharacters: input.maxContentCharacters,
			allowPlainHttp: input.allowPlainHttp === true
		}, cancellationTokenFromAbortSignal(context.signal));

		return {
			...result,
			sourcePolicy: 'When using this fetched content, cite finalUrl or the returned citation URL.'
		};
	}
};

function normalizeProviderOrder(providerOrder: CleanSlateWebSearchProvider[] | undefined): CleanSlateWebSearchProvider[] | undefined {
	if (!Array.isArray(providerOrder)) {
		return undefined;
	}
	const allowed = new Set<CleanSlateWebSearchProvider>(['searxng', 'exaMcpAnonymous', 'parallelMcpAnonymous']);
	const normalized = providerOrder.filter((provider): provider is CleanSlateWebSearchProvider => allowed.has(provider));
	return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
}

function normalizeDomains(value: string[] | undefined): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const normalized = Array.from(new Set(value
		.map(domain => domain.trim())
		.filter(domain => domain.length > 0 && !domain.includes('*'))));
	return normalized.length > 0 ? normalized : undefined;
}

function normalizeFormat(format: CleanSlateWebFetchFormat | undefined): CleanSlateWebFetchFormat {
	return format === 'text' || format === 'html' ? format : 'markdown';
}
