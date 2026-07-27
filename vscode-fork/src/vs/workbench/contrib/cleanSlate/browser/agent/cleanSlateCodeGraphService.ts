/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';

interface IPathGraphRecordSerialized {
    key: string;
    displayPath: string;
    symbols: string[];
    imports: string[];
    exports: string[];
    callTargets: string[];
    linkedPaths: string[];
    lastUpdatedAt: number;
}

interface ICodeGraphSnapshot {
    paths: IPathGraphRecordSerialized[];
}

interface IPathGraphRecord {
    key: string;
    displayPath: string;
    symbols: Set<string>;
    imports: Set<string>;
    exports: Set<string>;
    callTargets: Set<string>;
    linkedPaths: Set<string>;
    lastUpdatedAt: number;
}

export interface ICodeGraphHighlights {
    highlights: string[];
    relatedPaths: string[];
}

interface ICodeGraphHighlightOptions {
    seedPaths?: string[];
    maxPaths?: number;
    maxSymbols?: number;
}

interface IScoredPath {
    path: string;
    score: number;
    matchingSymbols: string[];
}

export class CleanSlateCodeGraphService {
    private static readonly SNAPSHOT_STORE = new Map<string, ICodeGraphSnapshot>();
    private static readonly MAX_PATH_RECORDS = 1500;
    private static readonly MAX_RELATIONS_PER_PATH = 250;

    private scopeKey = 'workspace:unknown|head:unknown';
    private readonly pathRecords = new Map<string, IPathGraphRecord>();
    private readonly symbolIndex = new Map<string, Set<string>>();

    setScope(workspaceKey: string, gitHeadFingerprint: string): void {
        const normalizedWorkspaceKey = workspaceKey.trim() || 'workspace:unknown';
        const normalizedHead = gitHeadFingerprint.trim() || 'head:unknown';
        const nextScopeKey = `${normalizedWorkspaceKey}|${normalizedHead}`;
        if (nextScopeKey === this.scopeKey) {
            return;
        }
        this.saveCurrentScope();
        this.scopeKey = nextScopeKey;
        this.restoreFromScope();
    }

    ingestToolResult(toolName: string, input: any, result: any): void {
        if (!toolName || result?.success === false) {
            return;
        }

        const now = Date.now();
        const discoveredPaths = this.extractPathsFromToolResult(toolName, input, result);
        for (const discoveredPath of discoveredPaths) {
            this.touchPath(discoveredPath, now);
        }

        if (toolName === 'read_file' || toolName === 'read_file_range' || toolName === 'search_codebase' || toolName === 'semantic_search') {
            const path = typeof result?.path === 'string' ? result.path : (typeof input?.path === 'string' ? input.path : undefined);
            const content = typeof result?.content === 'string' ? result.content : undefined;
            if (path && content) {
                this.ingestContent(path, content, now);
            }
        } else if (toolName === 'read_symbols') {
            const path = typeof result?.path === 'string' ? result.path : (typeof input?.path === 'string' ? input.path : undefined);
            if (path) {
                const symbols = this.collectSymbols(result?.symbols);
                this.attachSymbols(path, symbols, now);
            }
        } else if (toolName === 'get_definitions') {
            const sourcePath = typeof result?.path === 'string' ? result.path : (typeof input?.path === 'string' ? input.path : undefined);
            if (sourcePath) {
                const targetPaths = Array.isArray(result?.definitions)
                    ? result.definitions
                        .map((entry: any) => typeof entry?.uri === 'string' ? entry.uri : '')
                        .filter((entry: string) => entry.length > 0)
                    : [];
                this.attachLinkedPaths(sourcePath, targetPaths, now);
            }
        } else if (toolName === 'find_references') {
            const sourcePath = typeof result?.path === 'string' ? result.path : (typeof input?.path === 'string' ? input.path : undefined);
            if (sourcePath) {
                const targetPaths = Array.isArray(result?.references)
                    ? result.references
                        .map((entry: any) => typeof entry?.uri === 'string' ? entry.uri : '')
                        .filter((entry: string) => entry.length > 0)
                    : [];
                this.attachLinkedPaths(sourcePath, targetPaths, now);
            }
        }

        this.trimPathRecordsIfNeeded();
        this.saveCurrentScope();
    }

    buildHighlights(query: string, options: ICodeGraphHighlightOptions = {}): ICodeGraphHighlights {
        const maxPaths = Number.isFinite(options.maxPaths) ? Math.max(1, Math.floor(options.maxPaths!)) : 6;
        const maxSymbols = Number.isFinite(options.maxSymbols) ? Math.max(1, Math.floor(options.maxSymbols!)) : 12;
        const tokens = this.tokenize(query);
        const seedPathKeys = new Set((options.seedPaths || [])
            .map(path => this.toPathKey(path))
            .filter((path): path is string => typeof path === 'string'));

        const scoredPaths: IScoredPath[] = [];
        for (const record of this.pathRecords.values()) {
            const pathLower = record.displayPath.toLowerCase();
            let score = 0;
            const matchingSymbols: string[] = [];

            for (const token of tokens) {
                if (token.length < 2) {
                    continue;
                }
                if (pathLower.includes(token)) {
                    score += 2.2;
                }
                for (const symbol of record.symbols.values()) {
                    if (symbol.toLowerCase().includes(token)) {
                        matchingSymbols.push(symbol);
                        score += 1.5;
                        if (matchingSymbols.length >= 6) {
                            break;
                        }
                    }
                }
            }

            if (seedPathKeys.has(record.key)) {
                score += 2.8;
            }
            score += this.computeRecencyBonus(record.lastUpdatedAt);

            if (score <= 0) {
                continue;
            }

            scoredPaths.push({
                path: record.displayPath,
                score,
                matchingSymbols: Array.from(new Set(matchingSymbols)).slice(0, 4)
            });
        }

        if (scoredPaths.length === 0) {
            for (const record of Array.from(this.pathRecords.values()).sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt).slice(0, maxPaths)) {
                scoredPaths.push({
                    path: record.displayPath,
                    score: this.computeRecencyBonus(record.lastUpdatedAt),
                    matchingSymbols: Array.from(record.symbols).slice(0, 2)
                });
            }
        }

        scoredPaths.sort((a, b) => b.score - a.score);
        const topPaths = scoredPaths.slice(0, maxPaths);
        const topPathSet = new Set(topPaths.map(entry => entry.path));
        const symbolCandidates: string[] = [];
        for (const entry of topPaths) {
            symbolCandidates.push(...entry.matchingSymbols);
            const record = this.pathRecords.get(this.toPathKey(entry.path) || '');
            if (record) {
                symbolCandidates.push(...Array.from(record.symbols).slice(0, 3));
            }
        }

        const uniqueSymbols = Array.from(new Set(symbolCandidates)).slice(0, maxSymbols);
        const highlights: string[] = [];
        if (topPaths.length > 0) {
            highlights.push(`Top related files: ${topPaths.map(entry => entry.path).join(', ')}`);
        }
        if (uniqueSymbols.length > 0) {
            highlights.push(`Likely relevant symbols: ${uniqueSymbols.join(', ')}`);
        }

        return {
            highlights,
            relatedPaths: Array.from(topPathSet)
        };
    }

    private ingestContent(path: string, content: string, timestamp: number): void {
        const record = this.ensurePathRecord(path, timestamp);
        if (!record) {
            return;
        }
        const imports = this.extractImports(content);
        const exports = this.extractExports(content);
        const declarations = this.extractDeclarations(content);
        const callTargets = this.extractCallTargets(content);

        for (const item of imports) {
            this.addWithCap(record.imports, item);
            const linkedPath = this.resolveImportToPossiblePath(path, item);
            if (linkedPath) {
                this.addWithCap(record.linkedPaths, linkedPath);
            }
        }
        for (const item of exports) {
            this.addWithCap(record.exports, item);
            this.addSymbol(record, item);
        }
        for (const item of declarations) {
            this.addSymbol(record, item);
        }
        for (const item of callTargets) {
            this.addWithCap(record.callTargets, item);
        }
    }

    private attachSymbols(path: string, symbols: string[], timestamp: number): void {
        const record = this.ensurePathRecord(path, timestamp);
        if (!record) {
            return;
        }
        for (const symbol of symbols) {
            this.addSymbol(record, symbol);
        }
    }

    private attachLinkedPaths(path: string, linkedPaths: string[], timestamp: number): void {
        const record = this.ensurePathRecord(path, timestamp);
        if (!record) {
            return;
        }
        for (const linkedPath of linkedPaths) {
            const normalized = this.normalizePathDisplay(linkedPath);
            if (normalized) {
                this.addWithCap(record.linkedPaths, normalized);
            }
        }
    }

    private touchPath(path: string, timestamp: number): void {
        this.ensurePathRecord(path, timestamp);
    }

    private ensurePathRecord(path: string, timestamp: number): IPathGraphRecord | undefined {
        const normalizedPath = this.normalizePathDisplay(path);
        if (!normalizedPath) {
            return undefined;
        }

        const key = this.toPathKey(normalizedPath)!;
        const existing = this.pathRecords.get(key);
        if (existing) {
            existing.lastUpdatedAt = Math.max(existing.lastUpdatedAt, timestamp);
            return existing;
        }

        const created: IPathGraphRecord = {
            key,
            displayPath: normalizedPath,
            symbols: new Set<string>(),
            imports: new Set<string>(),
            exports: new Set<string>(),
            callTargets: new Set<string>(),
            linkedPaths: new Set<string>(),
            lastUpdatedAt: timestamp
        };
        this.pathRecords.set(key, created);
        return created;
    }

    private addSymbol(record: IPathGraphRecord, symbol: string): void {
        const normalized = symbol.trim();
        if (!normalized) {
            return;
        }
        if (record.symbols.size >= CleanSlateCodeGraphService.MAX_RELATIONS_PER_PATH && !record.symbols.has(normalized)) {
            return;
        }
        record.symbols.add(normalized);

        const symbolKey = normalized.toLowerCase();
        if (!this.symbolIndex.has(symbolKey)) {
            this.symbolIndex.set(symbolKey, new Set<string>());
        }
        this.symbolIndex.get(symbolKey)!.add(record.key);
    }

    private addWithCap(setRef: Set<string>, value: string): void {
        const normalized = value.trim();
        if (!normalized) {
            return;
        }
        if (setRef.size >= CleanSlateCodeGraphService.MAX_RELATIONS_PER_PATH && !setRef.has(normalized)) {
            return;
        }
        setRef.add(normalized);
    }

    private trimPathRecordsIfNeeded(): void {
        if (this.pathRecords.size <= CleanSlateCodeGraphService.MAX_PATH_RECORDS) {
            return;
        }

        const sortedByRecency = Array.from(this.pathRecords.values())
            .sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);
        const keep = new Set(sortedByRecency.slice(0, CleanSlateCodeGraphService.MAX_PATH_RECORDS).map(record => record.key));

        for (const [pathKey, record] of this.pathRecords.entries()) {
            if (keep.has(pathKey)) {
                continue;
            }
            this.pathRecords.delete(pathKey);
            for (const symbol of record.symbols.values()) {
                const symbolKey = symbol.toLowerCase();
                const pathsForSymbol = this.symbolIndex.get(symbolKey);
                if (!pathsForSymbol) {
                    continue;
                }
                pathsForSymbol.delete(pathKey);
                if (pathsForSymbol.size === 0) {
                    this.symbolIndex.delete(symbolKey);
                }
            }
        }
    }

    private saveCurrentScope(): void {
        const serialized: ICodeGraphSnapshot = {
            paths: Array.from(this.pathRecords.values()).map(record => ({
                key: record.key,
                displayPath: record.displayPath,
                symbols: Array.from(record.symbols),
                imports: Array.from(record.imports),
                exports: Array.from(record.exports),
                callTargets: Array.from(record.callTargets),
                linkedPaths: Array.from(record.linkedPaths),
                lastUpdatedAt: record.lastUpdatedAt
            }))
        };
        CleanSlateCodeGraphService.SNAPSHOT_STORE.set(this.scopeKey, serialized);
    }

    private restoreFromScope(): void {
        this.pathRecords.clear();
        this.symbolIndex.clear();
        const snapshot = CleanSlateCodeGraphService.SNAPSHOT_STORE.get(this.scopeKey);
        if (!snapshot) {
            return;
        }

        for (const entry of snapshot.paths) {
            const record: IPathGraphRecord = {
                key: entry.key,
                displayPath: entry.displayPath,
                symbols: new Set(entry.symbols),
                imports: new Set(entry.imports),
                exports: new Set(entry.exports),
                callTargets: new Set(entry.callTargets),
                linkedPaths: new Set(entry.linkedPaths),
                lastUpdatedAt: entry.lastUpdatedAt
            };
            this.pathRecords.set(record.key, record);
            for (const symbol of record.symbols.values()) {
                const symbolKey = symbol.toLowerCase();
                if (!this.symbolIndex.has(symbolKey)) {
                    this.symbolIndex.set(symbolKey, new Set<string>());
                }
                this.symbolIndex.get(symbolKey)!.add(record.key);
            }
        }
    }

    private extractPathsFromToolResult(toolName: string, input: any, result: any): string[] {
        const paths = new Set<string>();
        const addPath = (value: unknown) => {
            const normalized = this.normalizePathDisplay(value);
            if (normalized) {
                paths.add(normalized);
            }
        };

        addPath(input?.path);
        addPath(result?.path);

        if (toolName === 'list_dir') {
            const parentPath = this.normalizePathDisplay(input?.path);
            if (parentPath && Array.isArray(result)) {
                for (const child of result) {
                    if (typeof child?.name !== 'string') {
                        continue;
                    }
                    const normalizedParent = parentPath.endsWith('/') ? parentPath.slice(0, -1) : parentPath;
                    addPath(`${normalizedParent}/${child.name}`);
                }
            }
        }

        if (Array.isArray(result)) {
            for (const entry of result) {
                if (typeof entry === 'string') {
                    addPath(entry);
                    continue;
                }
                addPath(entry?.path);
                addPath(entry?.uri);
            }
        }
        if (Array.isArray(result?.results)) {
            for (const entry of result.results) {
                addPath(entry?.path);
                addPath(entry?.uri);
            }
        }
        if (Array.isArray(result?.files)) {
            for (const entry of result.files) {
                addPath(entry);
            }
        }
        if (Array.isArray(result?.definitions)) {
            for (const definition of result.definitions) {
                addPath(definition?.uri);
            }
        }
        if (Array.isArray(result?.references)) {
            for (const reference of result.references) {
                addPath(reference?.uri);
            }
        }

        return Array.from(paths);
    }

    private collectSymbols(symbols: any): string[] {
        const names = new Set<string>();
        const visit = (candidate: any) => {
            if (!candidate || typeof candidate !== 'object') {
                return;
            }
            if (typeof candidate.name === 'string' && candidate.name.trim().length > 0) {
                names.add(candidate.name.trim());
            }
            if (Array.isArray(candidate.children)) {
                for (const child of candidate.children) {
                    visit(child);
                }
            }
        };
        if (Array.isArray(symbols)) {
            for (const symbol of symbols) {
                visit(symbol);
            }
        }
        return Array.from(names).slice(0, 200);
    }

    private extractImports(content: string): string[] {
        const imports = new Set<string>();
        const importFromRegex = /^\s*import\s+[^'"]*?from\s+['"]([^'"]+)['"]/gm;
        const requireRegex = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/gm;
        let match: RegExpExecArray | null;
        while ((match = importFromRegex.exec(content)) !== null) {
            if (match[1]) {
                imports.add(match[1]);
            }
        }
        while ((match = requireRegex.exec(content)) !== null) {
            if (match[1]) {
                imports.add(match[1]);
            }
        }
        return Array.from(imports);
    }

    private extractExports(content: string): string[] {
        const exports = new Set<string>();
        const exportRegex = /^\s*export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type|enum)\s+([A-Za-z_]\w*)/gm;
        let match: RegExpExecArray | null;
        while ((match = exportRegex.exec(content)) !== null) {
            if (match[1]) {
                exports.add(match[1]);
            }
        }
        return Array.from(exports);
    }

    private extractDeclarations(content: string): string[] {
        const declarations = new Set<string>();
        const declarationRegex = /^\s*(?:class|function|const|let|var|interface|type|enum)\s+([A-Za-z_]\w*)/gm;
        let match: RegExpExecArray | null;
        while ((match = declarationRegex.exec(content)) !== null) {
            if (match[1]) {
                declarations.add(match[1]);
            }
        }
        return Array.from(declarations);
    }

    private extractCallTargets(content: string): string[] {
        const calls = new Set<string>();
        const keywords = new Set([
            'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'new', 'super', 'import'
        ]);
        const callRegex = /\b([A-Za-z_]\w*)\s*\(/g;
        let match: RegExpExecArray | null;
        while ((match = callRegex.exec(content)) !== null) {
            const candidate = match[1];
            if (!candidate || keywords.has(candidate)) {
                continue;
            }
            calls.add(candidate);
        }
        return Array.from(calls);
    }

    private resolveImportToPossiblePath(sourcePath: string, importPath: string): string | undefined {
        if (!importPath.startsWith('.')) {
            return undefined;
        }
        const normalizedSource = this.normalizePathDisplay(sourcePath);
        if (!normalizedSource) {
            return undefined;
        }
        const sourceUri = this.parsePathToUri(normalizedSource);
        if (!sourceUri) {
            return undefined;
        }
        const sourceDir = sourceUri.with({ path: sourceUri.path.replace(/\/[^/]*$/, '/') });
        const targetUri = sourceDir.with({ path: this.normalizeRelativePath(`${sourceDir.path}${importPath}`) });
        return targetUri.toString();
    }

    private normalizeRelativePath(path: string): string {
        const parts = path.split('/');
        const stack: string[] = [];
        for (const part of parts) {
            if (!part || part === '.') {
                continue;
            }
            if (part === '..') {
                stack.pop();
                continue;
            }
            stack.push(part);
        }
        return `/${stack.join('/')}`;
    }

    private computeRecencyBonus(updatedAt: number): number {
        const ageMs = Math.max(0, Date.now() - updatedAt);
        if (ageMs < 60_000) {
            return 1.2;
        }
        if (ageMs < 300_000) {
            return 0.9;
        }
        if (ageMs < 1_800_000) {
            return 0.5;
        }
        return 0.2;
    }

    private tokenize(input: string): string[] {
        const matches = input.toLowerCase().match(/[a-z0-9_]+/g);
        return matches ? matches.slice(0, 30) : [];
    }

    private normalizePathDisplay(pathCandidate: unknown): string | undefined {
        if (typeof pathCandidate !== 'string') {
            return undefined;
        }
        const trimmed = pathCandidate.trim();
        if (!trimmed) {
            return undefined;
        }
        const uri = this.parsePathToUri(trimmed);
        if (uri) {
            return uri.toString();
        }
        return trimmed.replace(/\\/g, '/');
    }

    private toPathKey(pathCandidate: unknown): string | undefined {
        const normalized = this.normalizePathDisplay(pathCandidate);
        return normalized ? normalized.toLowerCase() : undefined;
    }

    private parsePathToUri(pathCandidate: string): URI | undefined {
        const isUri = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(pathCandidate);
        if (isUri) {
            try {
                return URI.parse(pathCandidate);
            } catch {
                return undefined;
            }
        }

        const isAbsoluteFilePath = pathCandidate.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(pathCandidate);
        if (isAbsoluteFilePath) {
            return URI.file(pathCandidate);
        }

        return undefined;
    }
}
