/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Position } from '../../../../../editor/common/core/position.js';
import { CancellationError } from '../../../../../base/common/errors.js';
import { URI } from '../../../../../base/common/uri.js';
import { Location, SymbolKind } from '../../../../../editor/common/languages.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ILanguageFeaturesService } from '../../../../../editor/common/services/languageFeatures.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { CLEANSLATE_FALLBACK_CONTEXT_WINDOW_TOKENS, ICleanSlateConfigurationService } from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IMarkerService } from '../../../../../platform/markers/common/markers.js';
import { cancellationTokenFromAbortSignal } from '@cleanslate/sdk/services/cleanSlateCancellation.js';

interface IPinnedSymbol {
    name: string;
    kind: string;
    range: any;
}

export class CleanSlateAgentContextHelper {
    constructor(
        private readonly modelService: IModelService,
        private readonly workspaceContextService: IWorkspaceContextService,
        private readonly configService: ICleanSlateConfigurationService,
        private readonly languageFeaturesService: ILanguageFeaturesService,
        private readonly markerService: IMarkerService,
        private readonly fileService: IFileService,
        private readonly recentFocusLines: Map<string, Set<number>>
    ) { }

    public async buildPromptContext(context: any, signal?: AbortSignal): Promise<string> {
        let promptContext = '';

        const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
        if (workspaceFolders.length > 0) {
            promptContext += 'Workspace root(s) (use these paths for command `cwd`; do not assume paths like /workspace unless they appear here):\n';
            promptContext += workspaceFolders.map(f => `- ${f.uri.fsPath}`).join('\n') + '\n\n';
        }

        const config = this.configService.getConfiguration();
        
        // 1 token approx 4 characters. The resolved global budget caps eager prompt context.
        const tokenWindow = config.contextWindow || CLEANSLATE_FALLBACK_CONTEXT_WINDOW_TOKENS;
        const contextWindowChars = tokenWindow * 4;
        const configuredGlobalBudget = Number.isFinite(config.globalContextBudget)
            ? Math.max(12000, Math.floor(config.globalContextBudget!))
            : contextWindowChars;
        const GLOBAL_BUDGET = Math.max(12000, Math.min(contextWindowChars, configuredGlobalBudget));
        const activeFileSkeletonBudget = Math.min(
            config.fileTruncation || 16000,
            Math.max(6000, Math.floor(GLOBAL_BUDGET * 0.25))
        );

        // NEW: Codebase Health Dashboard (Proactive Diagnostics)
        const globalDiagnostics = await this.getGlobalHealthSummary(context);
        if (globalDiagnostics) {
            promptContext += `[CODEBASE HEALTH DASHBOARD]\n${globalDiagnostics}\n\n`;
        }

        if (context.activeFile) {
            const uri = context.activeFile.uri;
            promptContext += `Active File: ${uri.fsPath}\n`;
            promptContext += `Language: ${context.activeFile.languageId}\n`;

            const focusLines = this.recentFocusLines.get(uri.toString()) || new Set<number>();
            const activeFileContent = this.getModelContent(uri) || context.activeFile.content || '';
            const displayContent = await this.getSkeletonizedContent(
                uri,
                activeFileContent,
                context.activeFile.cursorLine || 0,
                focusLines,
                activeFileSkeletonBudget,
                signal
            ) || '[Skeleton unavailable. Use read_file if full context is required.]';

            const symbolContext = await this.getSymbolAwareContext(uri, signal);
            if (symbolContext) {
                promptContext += `Pinned Symbols (High-Level Structure):\n${symbolContext}\n\n`;
                
                // NEW: Blast Radius Awareness
                const blastRadius = await this.getBlastRadiusSummary(uri, signal);
                if (blastRadius) {
                    promptContext += `[SEMANTIC BLAST RADIUS]\n${blastRadius}\n\n`;
                }
            }

            // PRO ACTIVE: Immediate Dependency Intelligence
            const dependencySummary = await this.getImmediateDependencySummary(uri, activeFileContent, signal);
            if (dependencySummary) {
                promptContext += `[IMMEDIATE DEPENDENCIES (SIGNATURES ONLY)]\n${dependencySummary}\n\n`;
            }

            promptContext += `Active File Skeleton (imports, signatures, and cursor focus lines only):\n\`\`\`${context.activeFile.languageId}\n${displayContent}\n\`\`\`\n\n`;

            if (context.activeFile.selection) {
                promptContext += `Selected Text:\n\`\`\`\n${context.activeFile.selection}\n\`\`\`\n\n`;
            }
        }

        if (context.openFiles.length > 0) {
            promptContext += `Other Open Files (Metadata Only):\n${context.openFiles.map((f: any) => `- ${f.uri.fsPath}`).join('\n')}\n\n`;
        }

        return promptContext;
    }

    public async buildLeanPromptContext(context: any, signal?: AbortSignal): Promise<string> {
        let promptContext = '';

        const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
        if (workspaceFolders.length > 0) {
            promptContext += 'Workspace root(s):\n';
            promptContext += workspaceFolders.map(f => `- ${f.uri.fsPath}`).join('\n') + '\n\n';
        }

        if (context?.activeFile) {
            const uri = context.activeFile.uri;
            promptContext += `Active File: ${uri.fsPath}\n`;
            promptContext += `Language: ${context.activeFile.languageId}\n`;

            const focusLines = this.recentFocusLines.get(uri.toString()) || new Set<number>();
            const activeFileContent = this.getModelContent(uri) || context.activeFile.content || '';
            const displayContent = await this.getSkeletonizedContent(
                uri,
                activeFileContent,
                context.activeFile.cursorLine || 0,
                focusLines,
                4500,
                signal
            ) || '[Skeleton unavailable. Use read_file if full context is required.]';

            promptContext += `Active File Skeleton:\n\`\`\`${context.activeFile.languageId}\n${displayContent}\n\`\`\`\n\n`;

            if (context.activeFile.selection) {
                promptContext += `Selected Text:\n\`\`\`\n${context.activeFile.selection}\n\`\`\`\n\n`;
            }
        }

        const openFiles = Array.isArray(context?.openFiles) ? context.openFiles : [];
        if (openFiles.length > 0) {
            promptContext += `Open Files:\n${openFiles
                .slice(0, 12)
                .map((f: any) => `- ${f.uri.fsPath}`)
                .join('\n')}\n\n`;
        }

        return promptContext;
    }

    private async asyncIsEmptyWorkspace(): Promise<boolean> {
        try {
            const folders = this.workspaceContextService.getWorkspace().folders;
            if (folders.length === 0) return true;
            
            for (const folder of folders) {
                const stat = await this.fileService.resolve(folder.uri);
                if (stat.children && stat.children.length > 0) {
                    // Filter out boilerplate only (e.g. .DS_Store, .git)
                    const substantiveFiles = stat.children.filter(c => !c.name.startsWith('.') && c.name !== 'README.md' && c.name !== 'LICENSE');
                    if (substantiveFiles.length > 0) return false;
                }
            }
            return true;
        } catch {
            return false;
        }
    }

    private async getGlobalHealthSummary(context: any): Promise<string | undefined> {
        try {
            const isEmpty = await this.asyncIsEmptyWorkspace();
            if (isEmpty) {
                return '[EMPTY WORKSPACE DETECTED] This is a blank canvas. Please transition to creation_mode/Greenfield protocol.';
            }

            const markers = this.markerService?.read({ take: 20 }) || [];
            if (markers.length === 0) return '✓ Codebase is currently healthy (No lint/type errors).';
            
            const summary = markers.map((m: any) => `- [${m.source || 'TS'}] ${m.message} (${m.resource.path}:${m.startLineNumber})`).join('\n');
            return `Active Issues (First 20):\n${summary}`;
        } catch {
            return undefined;
        }
    }

    private async getBlastRadiusSummary(uri: URI, signal?: AbortSignal): Promise<string | undefined> {
        try {
            const references = await this.checkCrossFileReferences(uri, new Set([uri.fsPath]), signal);
            if (references.length === 0) return undefined;
            
            // Deduplicate and group by file
            const filesWithRefs = new Set<string>();
            references.forEach(ref => {
                const match = ref.match(/found in (.*) at line/);
                if (match) filesWithRefs.add(match[1]);
            });

            return `Note: Modifying symbols in this file may impact ${filesWithRefs.size} other file(s), including:\n${Array.from(filesWithRefs).slice(0, 5).map(f => `- ${f}`).join('\n')}${filesWithRefs.size > 5 ? '\n- ...and more' : ''}`;
        } catch {
            this.throwIfCancelled(signal);
            return undefined;
        }
    }

    private async getImmediateDependencySummary(uri: URI, content: string, signal?: AbortSignal): Promise<string | undefined> {
        try {
            // Find all imports in the file (TS/JS focus initially)
            const importMatches = content.matchAll(/import\s+.*\s+from\s+['"](.*)['"]/g);
            const importedPaths = new Set<string>();
            for (const match of importMatches) {
                if (match[1].startsWith('.')) { // Relative imports only for structural focus
                    importedPaths.add(match[1]);
                }
            }

            if (importedPaths.size === 0) return undefined;

            const summaries: string[] = [];
            const dir = uri.path.substring(0, uri.path.lastIndexOf('/'));
            
            for (const relPath of Array.from(importedPaths).slice(0, 5)) { // Limit to top 5 dependencies to save budget
                let depPath = relPath;
                if (!depPath.endsWith('.ts') && !depPath.endsWith('.js')) {
                    depPath += '.ts'; // Fallback guess for structural check
                }
                
                // Resolve relative path (simplified)
                const depUri = uri.with({ path: `${dir}/${depPath.startsWith('./') ? depPath.substring(2) : depPath}` });
                const symbols = await this.getSymbolAwareContext(depUri, signal);
                if (symbols) {
                    summaries.push(`--- Dependency: ${relPath} ---\n${symbols}`);
                }
            }

            return summaries.length > 0 ? summaries.join('\n\n') : undefined;
        } catch {
            this.throwIfCancelled(signal);
            return undefined;
        }
    }

    public async resolveMentionedFiles(text: string, context: any, signal?: AbortSignal): Promise<string> {
        const mentionedFiles: string[] = [];
        const words = text.split(/\s+/);

        for (const word of words) {
            if (word.startsWith('@')) {
                const fileNameFragment = word.substring(1).toLowerCase();
                if (fileNameFragment) {
                    const found = context.openFiles.find((f: any) => f.uri.fsPath.toLowerCase().includes(fileNameFragment));
                    if (found) {
                        const model = this.modelService.getModel(found.uri);
                        if (model) {
                            const symbols = await this.getSymbolAwareContext(found.uri, signal);
                            const symbolHeader = symbols ? `Pinned Symbols:\n${symbols}\n\n` : '';
                            const focusLines = this.recentFocusLines.get(found.uri.toString()) || new Set<number>();
                            const skeleton = await this.getSkeletonizedContent(found.uri, model.getValue(), 0, focusLines, 12000, signal)
                                || '[Skeleton unavailable. Use read_file if full context is required.]';
                            mentionedFiles.push(`### Referenced File Skeleton: ${found.uri.fsPath}\n${symbolHeader}\`\`\`${model.getLanguageId()}\n${skeleton}\n\`\`\``);
                        }
                    }
                }
            }
        }

        if (mentionedFiles.length > 0) {
            return `User Mentioned Specific Files:\n${mentionedFiles.join('\n\n')}\n\n`;
        }

        return '';
    }

    public async checkCrossFileReferences(uri: URI, touchedPaths: Set<string>, signal?: AbortSignal): Promise<string[]> {
        const model = this.modelService.getModel(uri);
        if (!model) {
            return [];
        }

        const symbols = await this.getPinnedSymbols(uri, signal);
        const issues: string[] = [];

        for (const sym of symbols) {
            const providers = this.languageFeaturesService.referenceProvider.all(model);
            if (providers.length === 0) {
                continue;
            }

            try {
                const pos = new Position(sym.range.startLineNumber, sym.range.startColumn);
                const references = await providers[0].provideReferences(model, pos, { includeDeclaration: false }, cancellationTokenFromAbortSignal(signal));

                if (references && Array.isArray(references)) {
                    for (const ref of references) {
                        const refUri = (ref as Location).uri;
                        if (!touchedPaths.has(refUri.fsPath)) {
                            issues.push(`Potential broken reference found in ${refUri.fsPath} at line ${ref.range.startLineNumber}. The symbol '${sym.name}' was modified but this file was not updated.`);
                        }
                    }
                }
            } catch {
                this.throwIfCancelled(signal);
                // Ignore reference errors.
            }
        }

        return issues;
    }

    public async getSymbolAwareContext(uri: URI, signal?: AbortSignal): Promise<string | undefined> {
        try {
            const symbols = await this.getPinnedSymbols(uri, signal);
            if (!symbols || symbols.length === 0) {
                return undefined;
            }

            return symbols
                .map((s: IPinnedSymbol) => `[${s.kind}] ${s.name} (Lines ${s.range.startLineNumber}-${s.range.endLineNumber})`)
                .join('\n');
        } catch {
            this.throwIfCancelled(signal);
            return undefined;
        }
    }

    private getModelContent(uri: URI): string | undefined {
        return this.modelService.getModel(uri)?.getValue();
    }

    private async getPinnedSymbols(uri: URI, signal?: AbortSignal): Promise<IPinnedSymbol[]> {
        const model = this.modelService.getModel(uri);
        if (!model) {
            return [];
        }

        const providers = this.languageFeaturesService.documentSymbolProvider.all(model);
        if (providers.length === 0) {
            return [];
        }

        try {
            const result = await providers[0].provideDocumentSymbols(model, cancellationTokenFromAbortSignal(signal));
            if (!result || !Array.isArray(result)) {
                return [];
            }

            const flatSymbols: IPinnedSymbol[] = [];
            const collect = (symbols: any[]) => {
                for (const s of symbols) {
                    const interesting = [
                        SymbolKind.Class,
                        SymbolKind.Interface,
                        SymbolKind.Method,
                        SymbolKind.Function,
                        SymbolKind.Constructor,
                        SymbolKind.Struct,
                        SymbolKind.Enum
                    ];

                    if (interesting.includes(s.kind)) {
                        flatSymbols.push({
                            name: s.name,
                            kind: this.getSymbolLabel(s.kind),
                            range: s.range
                        });
                    }
                    if (s.children) {
                        collect(s.children);
                    }
                }
            };

            collect(result);
            return flatSymbols;
        } catch {
            this.throwIfCancelled(signal);
            return [];
        }
    }

    private async getSkeletonizedContent(uri: URI, content: string, cursorLine: number, additionalFocusLines: Set<number>, budget: number, signal?: AbortSignal): Promise<string | undefined> {
        try {
            if (!content.trim()) {
                return '[No active file content available. Use read_file if full context is required.]';
            }

            const symbols = await this.getPinnedSymbols(uri, signal);
            const lines = content.split('\n');
            const lineProcessed = new Array(lines.length).fill(false);
            
            // 1. Identify "Focus Points"
            const focusPoints = new Set<number>();
            if (cursorLine > 0) focusPoints.add(cursorLine);
            if (additionalFocusLines) {
                for (const line of additionalFocusLines) focusPoints.add(line);
            }

            // 2. Mark High-Relevance Islands (Signatures + Imports + Focus Points)
            const islandBuffer = 6; // Lines of context around a focus point

            // Always keep imports and re-exports near the file head.
            for (let lineIndex = 0; lineIndex < Math.min(lines.length, 120); lineIndex++) {
                const lineText = lines[lineIndex].trim();
                if (this.isImportOrExportLine(lineText)) {
                    lineProcessed[lineIndex] = true;
                }
            }

            if (symbols.length > 0) {
                for (const symbol of symbols) {
                    const start = Math.max(0, symbol.range.startLineNumber - 1);
                    const end = this.findSignatureEndLine(lines, start);
                    for (let lineIndex = start; lineIndex <= end; lineIndex++) {
                        lineProcessed[lineIndex] = true;
                    }
                }
            } else {
                for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                    if (!this.looksLikeSignatureLine(lines[lineIndex])) {
                        continue;
                    }
                    const end = this.findSignatureEndLine(lines, lineIndex);
                    for (let signatureLine = lineIndex; signatureLine <= end; signatureLine++) {
                        lineProcessed[signatureLine] = true;
                    }
                }
            }

            for (const point of focusPoints) {
                const focusIndex = point - 1;
                const start = Math.max(0, focusIndex - islandBuffer);
                const end = Math.min(lines.length - 1, focusIndex + islandBuffer);
                for (let lineIndex = start; lineIndex <= end; lineIndex++) {
                    lineProcessed[lineIndex] = true;
                }
            }

            if (!lineProcessed.some(Boolean)) {
                const previewEnd = Math.min(lines.length, 80);
                for (let lineIndex = 0; lineIndex < previewEnd; lineIndex++) {
                    lineProcessed[lineIndex] = true;
                }
            }

            let resultLines: string[] = [];
            let inPlaceholder = false;
            let currentChars = 0;

            for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                if (lineProcessed[lineIndex]) {
                    if (inPlaceholder) {
                        resultLines.push('[... implementation elided ...]');
                        inPlaceholder = false;
                    }
                    const lineContent = this.formatSkeletonLine(lineIndex + 1, lines[lineIndex]);
                    if (currentChars + lineContent.length > budget) {
                        resultLines.push('[... skeleton budget exhausted; use read_file or read_file_range for more ...]');
                        break;
                    }
                    resultLines.push(lineContent);
                    currentChars += lineContent.length + 1;
                } else {
                    inPlaceholder = true;
                }
            }

            return resultLines.join('\n');
        } catch {
            this.throwIfCancelled(signal);
            return undefined;
        }
    }

    private throwIfCancelled(signal?: AbortSignal): void {
        if (signal?.aborted) {
            throw new CancellationError();
        }
    }

    private isImportOrExportLine(lineText: string): boolean {
        return lineText.startsWith('import ')
            || lineText.startsWith('from ')
            || lineText.includes('require(')
            || (lineText.startsWith('export ') && lineText.includes(' from '));
    }

    private looksLikeSignatureLine(line: string): boolean {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) {
            return false;
        }

        return /^(export\s+)?(default\s+)?(abstract\s+)?class\s+[A-Za-z_$][\w$]*/.test(trimmed)
            || /^(export\s+)?(default\s+)?interface\s+[A-Za-z_$][\w$]*/.test(trimmed)
            || /^(export\s+)?(async\s+)?function\s+[A-Za-z_$][\w$]*/.test(trimmed)
            || /^(export\s+)?(const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(async\s*)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(trimmed)
            || /^(public\s+|private\s+|protected\s+|static\s+|async\s+|readonly\s+|override\s+|get\s+|set\s+)*[A-Za-z_$][\w$]*\s*\([^)]*\)\s*[:{]/.test(trimmed)
            || /^(async\s+)?def\s+[A-Za-z_][\w]*\s*\(/.test(trimmed)
            || /^class\s+[A-Za-z_][\w]*/.test(trimmed);
    }

    private findSignatureEndLine(lines: string[], startIndex: number): number {
        const maxEnd = Math.min(lines.length - 1, startIndex + 4);
        for (let lineIndex = startIndex; lineIndex <= maxEnd; lineIndex++) {
            const trimmed = lines[lineIndex].trim();
            if (
                trimmed.endsWith('{')
                || trimmed.endsWith(';')
                || trimmed.endsWith(':')
                || trimmed.includes('=>')
                || trimmed.includes('{')
            ) {
                return lineIndex;
            }
        }

        return startIndex;
    }

    private formatSkeletonLine(lineNumber: number, text: string): string {
        return `${lineNumber}: ${text}`;
    }

    private getSymbolLabel(kind: SymbolKind): string {
        switch (kind) {
            case SymbolKind.Class: return 'Class';
            case SymbolKind.Interface: return 'Interface';
            case SymbolKind.Method: return 'Method';
            case SymbolKind.Function: return 'Function';
            case SymbolKind.Constructor: return 'Constructor';
            case SymbolKind.Struct: return 'Struct';
            case SymbolKind.Enum: return 'Enum';
            case SymbolKind.Variable: return 'Variable';
            case SymbolKind.Property: return 'Property';
            case SymbolKind.Field: return 'Field';
            case SymbolKind.Namespace: return 'Namespace';
            case SymbolKind.Module: return 'Module';
            default: return 'Symbol';
        }
    }
}
