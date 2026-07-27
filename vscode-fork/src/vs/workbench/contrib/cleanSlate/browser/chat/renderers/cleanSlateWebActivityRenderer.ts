/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InteractionBlock } from '../types/cleanSlateChatTypes.js';

export interface ICleanSlateRenderedWebActivity {
    html: string;
    renderKey: string;
}
/** Builds the web-search and web-fetch transcript presentation. */
export class CleanSlateWebActivityRenderer {
    public render(block: InteractionBlock): ICleanSlateRenderedWebActivity {
        const interrupted = (block.status || '').toLowerCase() === 'interrupted';
        const status = interrupted ? 'interrupted' : block.webStatus || (block.isStreaming ? 'running' : 'completed');
        const failed = status === 'failed';
        const running = !interrupted && (status === 'running' || block.isStreaming === true);
        const isFetch = block.webToolName === 'web_fetch';
        const classes = [
            'cleanSlate-web-block',
            `status-${this.escapeHtml(status)}`,
            isFetch ? 'kind-fetch' : 'kind-search',
            running ? 'is-running' : '',
            failed ? 'is-failed' : ''
        ].filter(Boolean).join(' ');
        const content = isFetch
            ? this.renderWebFetchActivityBlock(block, running, failed, interrupted)
            : this.renderWebSearchActivityBlock(block, running, failed, interrupted);
        const resultKey = (block.webResults || [])
            .map(result => `${result.title}:${result.url}:${result.snippet || ''}:${result.source || ''}:${result.provider || ''}:${result.publishedDate || ''}`)
            .join('\u001f');
        const attemptsKey = (block.webAttempts || [])
            .map(attempt => `${attempt.provider}:${attempt.status}:${attempt.reason || ''}:${attempt.durationMs ?? ''}`)
            .join('\u001f');
        return {
            html: `<div class="${classes}">${content}</div>`,
            renderKey: `web:${status}:${block.webToolName || ''}:${block.webAction || ''}:${block.webQuery || ''}:${block.webProvider || ''}:${block.webUrl || ''}:${block.webFinalUrl || ''}:${block.webTitle || ''}:${block.webContentType || ''}:${block.webBytes ?? ''}:${block.webTruncated === true}:${block.webContentPreview || ''}:${resultKey}:${attemptsKey}:${(block.details || []).join('\u001f')}`
        };
    }

    private renderWebSearchActivityBlock(block: InteractionBlock, running: boolean, failed: boolean, interrupted: boolean): string {
        const query = (block.webQuery || '').trim();
        const firstResultUrl = block.webResults?.find(result => typeof result.url === 'string' && result.url.trim().length > 0)?.url;
        const label = failed
            ? query ? `Search failed for ${query}` : 'Web search failed'
            : interrupted
                ? query ? `Search interrupted for ${query}` : 'Web search interrupted'
                : running
                    ? query ? `Searching the web for ${query}` : 'Searching the web'
                    : query ? `Searched the web for ${query}` : 'Searched the web';
        const resultCount = block.webResults?.length || 0;
        const metaParts = [
            resultCount > 0 ? `${resultCount} source${resultCount === 1 ? '' : 's'}` : '',
            block.webProvider ? this.formatWebProviderForDisplay(block.webProvider) : ''
        ].filter((part): part is string => typeof part === 'string' && part.length > 0);
        const details = failed ? this.renderWebDetails(block.details || []) : '';

        return `
            <div class="cleanSlate-web-activity-row">
                ${this.renderWebActivityIcon(firstResultUrl, running ? 'codicon-loading codicon-modifier-spin' : failed ? 'codicon-error' : interrupted ? 'codicon-debug-stop' : 'codicon-globe', label)}
                <span class="cleanSlate-web-activity-text">${this.escapeHtml(label)}</span>
                ${metaParts.length > 0 ? `<span class="cleanSlate-web-row-meta">${metaParts.map(part => this.escapeHtml(part)).join(' · ')}</span>` : ''}
            </div>
            ${details}
        `;
    }

    private renderWebFetchActivityBlock(block: InteractionBlock, running: boolean, failed: boolean, interrupted: boolean): string {
        if (failed) {
            return '';
        }

        const url = block.webFinalUrl || block.webUrl || '';
        const host = this.hostnameFromUrl(url);
        const title = block.webTitle || host || url || 'web page';
        const metaParts = [
            host,
            block.webContentType,
            typeof block.webBytes === 'number' ? this.formatBytes(block.webBytes) : '',
            block.webTruncated ? 'truncated' : ''
        ].filter((part): part is string => typeof part === 'string' && part.length > 0);
		const label = interrupted
				? `Interrupted reading ${title}`
				: running
					? `Reading ${title}`
					: `Read ${title}`;
		const body = `
			<span class="cleanSlate-web-activity-text">${this.escapeHtml(label)}</span>
			${metaParts.length > 0 ? `<span class="cleanSlate-web-row-meta">${metaParts.map(part => this.escapeHtml(part)).join(' · ')}</span>` : ''}
			${url ? '<i class="codicon codicon-link-external cleanSlate-web-external-icon"></i>' : ''}
		`;

		const pageHtml = url
			? `
				<a class="cleanSlate-web-activity-row cleanSlate-web-page-read" href="${this.escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="${this.escapeHtml(url)}">
					${this.renderWebFavicon(url, title)}
					${body}
				</a>
			`
			: `
				<div class="cleanSlate-web-activity-row cleanSlate-web-page-read">
					${this.renderWebActivityIcon(undefined, running ? 'codicon-loading codicon-modifier-spin' : failed ? 'codicon-error' : interrupted ? 'codicon-debug-stop' : 'codicon-globe', label)}
					${body}
				</div>
            `;

        return pageHtml;
    }

    private renderWebActivityIcon(url: string | undefined, iconClass: string, label: string): string {
        if (url) {
            return this.renderWebFavicon(url, label);
        }
        return `<span class="cleanSlate-web-activity-symbol" aria-hidden="true"><i class="codicon ${iconClass}"></i></span>`;
    }

    private renderWebFavicon(url: string | undefined, label: string): string {
        const host = this.hostnameFromUrl(url);
        const initial = (host || label || 'W').trim().charAt(0).toUpperCase() || 'W';
        const faviconUrl = host ? this.getWebFaviconUrl(host) : undefined;
        return `
            <span class="cleanSlate-web-favicon" aria-hidden="true">
                <span class="cleanSlate-web-favicon-fallback">${this.escapeHtml(initial)}</span>
                ${faviconUrl ? `<img src="${this.escapeHtml(faviconUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />` : ''}
            </span>
        `;
    }

    private renderWebDetails(details: string[]): string {
        const visibleDetails = details
            .filter(detail => typeof detail === 'string' && detail.trim().length > 0)
            .filter(detail => !/^Use the returned citation URLs/i.test(detail.trim()))
            .filter(detail => !/^When using this fetched content/i.test(detail.trim()))
            .slice(0, 4);
        if (visibleDetails.length === 0) {
            return '';
        }

        return `
            <div class="cleanSlate-web-detail-list">
                ${visibleDetails.map(detail => `<div class="cleanSlate-web-detail">${this.escapeHtml(detail)}</div>`).join('')}
            </div>
        `;
    }

	private getWebFaviconUrl(hostname: string): string {
		return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=32`;
	}

    private hostnameFromUrl(value: string | undefined): string | undefined {
        if (typeof value !== 'string' || value.trim().length === 0) {
            return undefined;
        }

        try {
            return new URL(value).hostname.replace(/^www\./i, '');
        } catch {
            return undefined;
        }
    }

    private formatWebProviderForDisplay(provider: string): string {
        switch (provider) {
            case 'searxng':
                return 'SearXNG';
            case 'exaMcpAnonymous':
                return 'Exa MCP';
            case 'parallelMcpAnonymous':
                return 'Parallel MCP';
            default:
                return provider
                    .replace(/Mcp/g, ' MCP')
                    .replace(/Anonymous/g, '')
                    .replace(/[_-]+/g, ' ')
                    .trim() || 'Provider';
        }
    }

    private formatBytes(value: number): string {
        if (!Number.isFinite(value) || value < 0) {
            return '';
        }
        if (value < 1024) {
            return `${Math.round(value)} B`;
        }
        if (value < 1024 * 1024) {
            return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
        }
        return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
    }

    private escapeHtml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}
