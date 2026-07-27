/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICleanSlateEmbeddingService, ICleanSlateConfigurationService, ICleanSlateMainService, ICleanSlateBufferedRequestResponse, ICleanSlateLogger, ICleanSlateVectorStore } from '../core/cleanSlateAI.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';

export class CleanSlateEmbeddingService implements ICleanSlateEmbeddingService {

    _serviceBrand: undefined;
    static readonly LOCAL_EMBEDDING_MODEL = 'Xenova/bge-small-en-v1.5';

    constructor(
        @ICleanSlateConfigurationService private readonly configService: ICleanSlateConfigurationService,
        @ICleanSlateMainService private readonly cleanSlateMainService: ICleanSlateMainService,
        @ICleanSlateVectorStore private readonly vectorStore: ICleanSlateVectorStore,
        @ICleanSlateLogger private readonly logger: ICleanSlateLogger
    ) { }

    async getEmbedding(text: string): Promise<number[]> {
        const results = await this.getEmbeddings([text]);
        return results[0];
    }

    async getEmbeddingProfile(): Promise<string> {
        const config = await this.configService.getResolvedConfiguration();
        return this.getEmbeddingProfileFromConfig(config);
    }

    async getEmbeddings(texts: string[]): Promise<number[][]> {
        const config = await this.configService.getResolvedConfiguration();
        const profile = this.getEmbeddingProfileFromConfig(config);
        const results: number[][] = new Array(texts.length).fill(null);
        const misses: { text: string; index: number }[] = [];

        // 1. Check persistent cache for each text
        for (let i = 0; i < texts.length; i++) {
            const cached = await this.vectorStore.getQueryEmbedding(texts[i], profile);
            if (cached) {
                results[i] = cached;
            } else {
                misses.push({ text: texts[i], index: i });
            }
        }

        if (misses.length === 0) {
            return results;
        }

        // 2. Fetch missing embeddings from provider
        const missTexts = misses.map(m => m.text);
        let fetched: number[][] = [];

        if (config.embeddingProvider === 'local') {
            fetched = await this.getLocalEmbeddings(missTexts, config);
        } else if (config.embeddingProvider === 'openai') {
            fetched = await this.getOpenAIEmbeddings(missTexts, config);
        } else if (config.embeddingProvider === 'azureOpenAI') {
            fetched = await this.getAzureOpenAIEmbeddings(missTexts, config);
        } else if (config.embeddingProvider === 'gemini') {
            fetched = await this.getGeminiEmbeddings(missTexts, config);
        } else {
            throw new Error('Select Local, OpenAI, Azure OpenAI, or Gemini as the CleanSlate embedding provider in CleanSlate Settings.');
        }

        // 3. Store new embeddings in cache and populate results
        for (let i = 0; i < misses.length; i++) {
            const { text, index } = misses[i];
            const embedding = fetched[i];
            results[index] = embedding;
            // Fire and forget cache save
            this.vectorStore.saveQueryEmbedding(text, embedding, profile).catch(e =>
                this.logger.error(`Failed to cache query embedding: ${e}`)
            );
        }

        return results;
    }

    private getEmbeddingProfileFromConfig(config: any): string {
        const provider = config.embeddingProvider || 'local';
        const model = config.embeddingModel || (provider === 'local' ? CleanSlateEmbeddingService.LOCAL_EMBEDDING_MODEL : provider === 'gemini' ? 'gemini-embedding-001' : 'text-embedding-3-small');
        return `${provider}:${model}`;
    }

    private async getLocalEmbeddings(texts: string[], config: any): Promise<number[][]> {
        const response = await this.cleanSlateMainService.localEmbeddings({
            model: config.embeddingModel || CleanSlateEmbeddingService.LOCAL_EMBEDDING_MODEL,
            texts
        }, CancellationToken.None);
        return response.embeddings;
    }

    private async fetchWithRetry(url: string, options: any, maxRetries = 3): Promise<ICleanSlateBufferedRequestResponse> {
        let lastError: any;
        for (let i = 0; i <= maxRetries; i++) {
            try {
                const res = await this.cleanSlateMainService.proxyRequest({
                    url,
                    type: options.method || 'GET',
                    headers: options.headers,
                    data: options.body,
                    timeout: 30000
                }, CancellationToken.None);

                if (res.res.statusCode && res.res.statusCode >= 200 && res.res.statusCode < 300) {
                    return res;
                }

                if (res.res.statusCode === 429 || (res.res.statusCode && res.res.statusCode >= 500)) {
                    const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
                    console.warn(`[CleanSlateEmbeddingService] Request failed with ${res.res.statusCode}. Retrying in ${Math.round(delay)}ms... (Attempt ${i + 1}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }

                // For other errors, we still return the response context so the caller can parse error body
                return res;
            } catch (e) {
                lastError = e;
                const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        throw lastError || new Error(`Request failed after ${maxRetries} retries`);
    }

    private async getOpenAIEmbeddings(texts: string[], config: any): Promise<number[][]> {
        const provider = config.providers?.openai;
        const apiKey = provider?.apiKey;
        if (!apiKey) throw new Error('OpenAI API Key is missing for embeddings. Please add it in CleanSlate Settings.');

        const baseUrl = (provider?.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const url = `${baseUrl}/embeddings`;
        const headers: any = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
        const model = config.embeddingModel || 'text-embedding-3-small';

        this.logger.info(`[CleanSlateEmbeddingService] getOpenAIEmbeddings: url=${url}`);

        const res = await this.fetchWithRetry(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model,
                input: texts
            })
        });

        if (res.res.statusCode && (res.res.statusCode < 200 || res.res.statusCode >= 300)) {
            const errorBody = res.data || 'Unknown error';
            throw new Error(`OpenAI embedding failed (${res.res.statusCode}): ${errorBody}`);
        }
        const json: any = JSON.parse(res.data);
        return json.data.map((d: any) => d.embedding);
    }

    private async getAzureOpenAIEmbeddings(texts: string[], config: any): Promise<number[][]> {
        const provider = config.providers?.azureOpenAI;
        if (!provider?.apiKey) throw new Error('Azure OpenAI API Key is missing for embeddings. Please add it in CleanSlate Settings.');
        if (!provider.endpoint) throw new Error('Azure OpenAI endpoint is missing for embeddings. Add it in CleanSlate Settings.');
        if (!provider.embeddingDeploymentName) throw new Error('Azure OpenAI embedding deployment name is missing. Add it in CleanSlate Settings under Indexing & Docs.');

        const deployment = provider.embeddingDeploymentName;
        const endpoint = provider.endpoint.replace(/\/+$/, '');
        const isV1Endpoint = this.isAzureOpenAIV1Endpoint(provider.endpoint);
        const url = isV1Endpoint
            ? `${this.toAzureOpenAIV1BaseUrl(provider.endpoint).replace(/\/+$/, '')}/embeddings`
            : `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/embeddings?api-version=${encodeURIComponent(provider.apiVersion || '2024-12-01-preview')}`;

        this.logger.info(`[CleanSlateEmbeddingService] getAzureOpenAIEmbeddings: url=${url}`);

        const res = await this.fetchWithRetry(url, {
            method: 'POST',
            headers: isV1Endpoint
                ? { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` }
                : { 'Content-Type': 'application/json', 'api-key': provider.apiKey },
            body: JSON.stringify(isV1Endpoint ? { model: deployment, input: texts } : { input: texts })
        });

        if (res.res.statusCode && (res.res.statusCode < 200 || res.res.statusCode >= 300)) {
            const errorBody = res.data || 'Unknown error';
            throw new Error(`Azure OpenAI embedding failed (${res.res.statusCode}): ${errorBody}`);
        }
        const json: any = JSON.parse(res.data);
        return json.data.map((d: any) => d.embedding);
    }

    private isAzureOpenAIV1Endpoint(endpoint: string): boolean {
        try {
            const url = new URL(endpoint);
            return url.pathname.toLowerCase().includes('/openai/v1') || url.hostname.toLowerCase().endsWith('.services.ai.azure.com');
        } catch {
            const normalized = endpoint.toLowerCase();
            return normalized.includes('/openai/v1') || normalized.includes('.services.ai.azure.com');
        }
    }

    private toAzureOpenAIV1BaseUrl(endpoint: string): string {
        try {
            const url = new URL(endpoint);
            const lowerPath = url.pathname.toLowerCase();
            const marker = '/openai/v1';
            const markerIndex = lowerPath.indexOf(marker);
            url.pathname = markerIndex >= 0
                ? `${url.pathname.slice(0, markerIndex + marker.length).replace(/\/+$/, '')}/`
                : '/openai/v1/';
            url.search = '';
            url.hash = '';
            return url.toString();
        } catch {
            const trimmed = endpoint.trim().replace(/\/+$/, '');
            return trimmed.toLowerCase().includes('/openai/v1')
                ? `${trimmed}/`
                : `${trimmed}/openai/v1/`;
        }
    }

    private async getGeminiEmbeddings(texts: string[], config: any): Promise<number[][]> {
        const apiKey = config.providers?.gemini?.apiKey;
        if (!apiKey) throw new Error('Google API Key is missing for embeddings');

        const configuredModel = config.embeddingModel || 'gemini-embedding-001';
        const model = configuredModel.startsWith('models/') ? configuredModel : `models/${configuredModel}`;
        const url = `https://generativelanguage.googleapis.com/v1beta/${model}:batchEmbedContents?key=${apiKey}`;

        // Gemini batch limit is 100 items per request
        const batchSize = 100;
        const results: number[][] = [];

        for (let i = 0; i < texts.length; i += batchSize) {
            const batch = texts.slice(i, i + batchSize);
            const body = {
                requests: batch.map(text => ({
                    model,
                    content: { parts: [{ text }] }
                }))
            };

            const res = await this.fetchWithRetry(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (res.res.statusCode && (res.res.statusCode < 200 || res.res.statusCode >= 300)) {
                const errorBody = res.data || 'Unknown error';
                throw new Error(`Gemini embedding failed (${res.res.statusCode}): ${errorBody}`);
            }

            const json: any = JSON.parse(res.data);
            results.push(...json.embeddings.map((e: any) => e.values));
        }

        return results;
    }
}
