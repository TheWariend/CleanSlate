/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { InteractionBlock } from '../types/cleanSlateChatTypes.js';

export function isCleanSlateReasoningVisuallyStreaming(block: InteractionBlock, isActive: boolean): boolean {
    return block.type === 'reasoning' && block.isStreaming === true && isActive;
}

/** Unwrap ACP/MCP text envelopes before they reach the reader-facing transcript. */
export function getCleanSlateExternalToolOutput(block: InteractionBlock): string {
    const output = block.output ?? '';
    if (!block.externalTool || !output.trim()) { return output; }
    try {
        const parsed: unknown = JSON.parse(output);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { return output; }
        const content = (parsed as Record<string, unknown>).content;
        if (typeof content === 'string') { return content; }
        if (Array.isArray(content)) {
            const text = content.map(item => {
                if (typeof item === 'string') { return item; }
                if (!item || typeof item !== 'object' || Array.isArray(item)) { return ''; }
                const record = item as Record<string, unknown>;
                return typeof record.text === 'string' ? record.text : typeof record.content === 'string' ? record.content : '';
            }).filter(Boolean).join('\n\n');
            if (text) { return text; }
        }
    } catch { /* Non-JSON output is already presentation-ready. */ }
    return output;
}

/** Keep transport state available to the agent, but out of the reader-facing transcript. */
export function getCleanSlateExternalBrowserPresentation(block: InteractionBlock): { label: string; output: string } | undefined {
    if (!block.externalTool) { return undefined; }
    const name = block.content?.match(/^cleanslate-ide[_:](browser_[a-z_]+)(?:\s|$)/i)?.[1];
    if (!name) { return undefined; }
    const running = block.toolStatus === 'running' || block.isStreaming === true;
    let result: Record<string, unknown> | undefined;
    try {
        const parsed: unknown = JSON.parse(block.output || 'null');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) { result = parsed as Record<string, unknown>; }
    } catch { /* Plain-text tool errors remain readable. */ }
    const failed = block.toolStatus === 'failed' || result?.success === false;
    const interrupted = block.status === 'interrupted';
    const action = name === 'browser_open' ? (running ? 'Opening IDE browser' : 'Opened IDE browser')
        : name === 'browser_snapshot' ? (running ? 'Reading page' : 'Read page')
        : name === 'browser_screenshot' ? (running ? 'Capturing page' : 'Captured page')
        : running ? 'Using IDE browser' : 'Used IDE browser';
    const title = typeof result?.title === 'string' ? result.title.trim() : '';
    const label = interrupted ? 'Browser action cancelled' : failed ? 'Browser action failed' : `${action}${title ? ` · ${title}` : ''}`;
    // Explicitly select content, rather than hiding a growing list of internal fields.
    const output = result
        ? ['error', 'message', 'text', 'snapshot'].map(key => typeof result[key] === 'string' ? result[key] as string : '').filter(Boolean).join('\n\n')
        : block.output || '';
    return { label, output };
}

export function getCleanSlateExternalFileMutationBlocks(block: InteractionBlock): InteractionBlock[] {
    if (!block.externalTool || !block.fileChanges?.length) { return []; }
    const changes = block.fileChanges;
    const running = block.toolStatus === 'running' || block.isStreaming === true;
    const failed = block.toolStatus === 'failed' || block.status === 'interrupted';
    return changes.map((change, index) => ({
        ...change,
        id: `${block.id}:file:${index}`,
        type: 'file',
        externalTool: true,
        isStreaming: running && !failed,
        status: failed ? (block.status === 'interrupted' ? 'Interrupted' : 'Failed')
            : running ? 'Editing' : block.toolName === 'delete' ? 'Deleted'
                : block.toolName === 'move' ? 'Moved' : 'created' in change && change.created === true ? 'Created' : 'Modified'
    }));
}

/** Presentation from normalized tool capability; unrelated agent labels stay intact. */
export function getCleanSlateHostToolPresentation(title: string, running: boolean, toolKind?: string): { label: string; icon: string } | undefined {
    const match = title.match(/^cleanslate-ide[_:]([a-z_]+)(?:\s|$)/i);
    const normalizedKind = toolKind?.trim().toLowerCase().replace(/[\s-]+/g, '_');
    const knownKinds = new Set(['read', 'search', 'execute', 'edit', 'delete', 'move', 'fetch']);
    const name = match?.[1].toLowerCase() ?? (normalizedKind && knownKinds.has(normalizedKind) ? normalizedKind : undefined);
    if (!name) { return undefined; }
    if (name === 'ask_question') { return { label: running ? 'Waiting for your answer' : 'Asked a question', icon: 'codicon-comment-discussion' }; }
    if (name === 'list_dir') { return { label: running ? 'Exploring folder' : 'Explored folder', icon: 'codicon-folder' }; }
    if (['read', 'read_file', 'read_file_range', 'get_open_files'].includes(name)) { return { label: running ? 'Reading files' : 'Read files', icon: 'codicon-file' }; }
    if (['search', 'find_by_name', 'grep_search', 'search_workspace', 'search_codebase', 'semantic_search'].includes(name)) { return { label: running ? 'Searching workspace' : 'Searched workspace', icon: 'codicon-search' }; }
    if (name.startsWith('browser_')) { return { label: running ? 'Using IDE browser' : 'Used IDE browser', icon: 'codicon-globe' }; }
    if (['read_lints', 'read_symbols', 'get_definitions', 'find_references'].includes(name)) { return { label: running ? 'Analyzing code' : 'Analyzed code', icon: 'codicon-symbol-method' }; }
    if (name === 'cleanslate_context') { return { label: running ? 'Checking workspace context' : 'Checked workspace context', icon: 'codicon-layout' }; }
    return { label: name.replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase()), icon: 'codicon-tools' };
}

export type ICleanSlateActivityDetailMetadata = NonNullable<InteractionBlock['detailMetadata']>[number];

export interface ICleanSlateSearchActivityPresentation {
    action: 'Searching' | 'Searched';
    query: string;
    scope: string;
}

export function isCleanSlateQuerySearchGroup(
    searchCount: number,
    fileCount: number,
    detailsMetadata: readonly ICleanSlateActivityDetailMetadata[]
): boolean {
    const searchMetadata = detailsMetadata.filter(meta => meta.type === 'explore');
    return searchCount > 0
        && fileCount === 0
        && searchMetadata.length > 0
        && searchMetadata.every(meta => !!meta.query);
}

export function getCleanSlateSearchActivityPresentation(
    metadata: ICleanSlateActivityDetailMetadata,
    scope: string
): ICleanSlateSearchActivityPresentation | undefined {
    const query = metadata.query?.trim();
    if (metadata.type !== 'explore' || !query) {
        return undefined;
    }

    return {
        action: metadata.label.startsWith('Exploring ') ? 'Searching' : 'Searched',
        query,
        scope
    };
}
