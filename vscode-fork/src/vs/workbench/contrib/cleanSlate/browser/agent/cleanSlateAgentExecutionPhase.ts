/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { URI } from '../../../../../base/common/uri.js';
import { resolvePathToUri } from '../tools/utils.js';
import { AgentPhase } from './cleanSlatePrompts.js';
import { CleanSlateExecutionEvidenceLedger } from './cleanSlateExecutionEvidenceLedger.js';
import type { IExecutionRunnerOptions } from './cleanSlateQueryRunner.js';

export interface IFailedEditOperation {
    toolName: string;
    path?: string;
    code?: string;
    message?: string;
    recoveryHint?: string;
    currentVersionId?: number;
    attemptedEdits?: number;
    allMatches?: Array<{ lineNumber: number; endLineNumber: number; lineContent: string; confidence: number }>;
}

export interface IExecutionEditFailureState {
    count: number;
    lastCode?: string;
    path?: string;
}

export class CleanSlateAgentExecutionPhase {
    constructor(private readonly options: IExecutionRunnerOptions) { }

    public validateToolCallForPhase(
        phase: AgentPhase,
        toolName: string,
        input: any
    ): string | undefined {
        if (toolName === 'apply_edit') {
            if (typeof input?.file_path !== 'string'
                || typeof input?.old_string !== 'string'
                || typeof input?.new_string !== 'string') {
                return 'apply_edit requires file_path, old_string, and new_string. Read the file first and retry with exact current text.';
            }
        }

        if (toolName === 'multi_file_replace') {
            const hasEntries = Array.isArray(input?.edits) && input.edits.length > 0;
            const hasInvalidEntry = !hasEntries || input.edits.some((entry: any) =>
                typeof entry?.file_path !== 'string'
                || typeof entry?.old_string !== 'string'
                || typeof entry?.new_string !== 'string'
            );
            if (hasInvalidEntry) {
                return 'multi_file_replace requires edits: Array<{ file_path, old_string, new_string, replace_all? }>.';
            }
        }

        if (toolName === 'spawn_worker') {
            return 'Nested worker spawning is disabled inside phase workers.';
        }

        return undefined;
    }

    public primeExecutionEvidenceLedgerForPlannedToolCall(
        evidenceLedger: CleanSlateExecutionEvidenceLedger,
        phase: AgentPhase,
        toolName: string,
        input: any
    ): void {
        if (phase !== AgentPhase.EXECUTION) {
            return;
        }
        for (const scope of this.extractLocatorScopesFromToolCallInput(toolName, input)) {
            const scopeKey = this.toEvidencePathKey(scope);
            if (scopeKey) {
                evidenceLedger.recordLocatedScope(scopeKey);
            }
        }
        const candidatePaths = this.extractLocatedPathsFromToolCallInput(toolName, input);
        for (const pathCandidate of candidatePaths) {
            const pathKey = this.toEvidencePathKey(pathCandidate);
            if (!pathKey) {
                continue;
            }
            const versionId = this.getCurrentModelVersionForPathCandidate(pathCandidate);
            evidenceLedger.recordLocatedPath(pathKey, versionId);
            if (this.isExecutionReadTool(toolName)) {
                evidenceLedger.recordReadPath(pathKey, versionId, this.extractSymbolEvidenceFromToolInput(toolName, input));
            }
        }
    }
    public updateExecutionEvidenceLedgerFromToolResult(
        evidenceLedger: CleanSlateExecutionEvidenceLedger,
        toolName: string,
        input: any,
        result: any
    ): void {
        const locatedPaths = this.extractLocatedPathsFromToolResult(toolName, input, result);
        for (const pathCandidate of locatedPaths) {
            const pathKey = this.toEvidencePathKey(pathCandidate);
            if (!pathKey) {
                continue;
            }
            const versionId = this.getCurrentModelVersionForPathCandidate(pathCandidate);
            evidenceLedger.recordLocatedPath(pathKey, versionId);
        }
        if (!this.isExecutionReadTool(toolName)) {
            return;
        }
        const readPaths = this.extractReadPathsFromToolCallAndResult(toolName, input, result);
        const symbols = this.extractSymbolEvidenceFromToolResult(toolName, input, result);
        for (const pathCandidate of readPaths) {
            const pathKey = this.toEvidencePathKey(pathCandidate);
            if (!pathKey) {
                continue;
            }
            const versionId = this.getCurrentModelVersionForPathCandidate(pathCandidate);
            evidenceLedger.recordReadPath(pathKey, versionId, symbols);
        }
    }
    public registerPostMutationEvidence(
        evidenceLedger: CleanSlateExecutionEvidenceLedger,
        toolName: string,
        input: any
    ): void {
        const targetPaths = this.extractMutationTargetPaths(toolName, input);
        for (const pathCandidate of targetPaths) {
            const pathKey = this.toEvidencePathKey(pathCandidate);
            if (pathKey) {
                const versionId = this.getCurrentModelVersionForPathCandidate(pathCandidate);
                evidenceLedger.recordLocatedPath(pathKey, versionId);
                evidenceLedger.invalidateReadPath(pathKey);
            }
        }
    }
    public extractMutationTargetPaths(toolName: string, input: any): string[] {
        const paths: string[] = [];
        const addPath = (value: unknown) => {
            if (typeof value !== 'string') {
                return;
            }
            const trimmed = value.trim();
            if (trimmed.length > 0) {
                paths.push(trimmed);
            }
        };
        if (toolName === 'apply_edit' || toolName === 'write_file' || toolName === 'create_and_write_file') {
            addPath(input?.file_path ?? input?.path);
        } else if (toolName === 'multi_file_replace' && Array.isArray(input?.edits)) {
            for (const editEntry of input.edits) {
                addPath(editEntry?.file_path ?? editEntry?.path);
            }
        } else if (toolName === 'create_multiple_files' && Array.isArray(input?.files)) {
            for (const fileEntry of input.files) {
                addPath(fileEntry?.path);
            }
        }
        return Array.from(new Set(paths));
    }
    public extractLocatorScopesFromToolCallInput(toolName: string, input: any): string[] {
        const scopes: string[] = [];
        const addScope = (value: unknown) => {
            if (typeof value !== 'string') {
                return;
            }
            const trimmed = value.trim();
            if (trimmed.length > 0) {
                scopes.push(trimmed);
            }
        };
        if (toolName === 'list_dir') {
            addScope(input?.path);
        }
        if (toolName === 'find_by_name') {
            addScope(input?.path);
        }
        if (toolName === 'grep_search' || toolName === 'search_workspace' || toolName === 'search_codebase' || toolName === 'semantic_search') {
            addScope(input?.path);
            addScope(input?.SearchPath);
        }
        return scopes;
    }
    public extractLocatedPathsFromToolCallInput(toolName: string, input: any): string[] {
        const paths: string[] = [];
        const addPath = (value: unknown) => {
            if (typeof value !== 'string') {
                return;
            }
            const trimmed = value.trim();
            if (trimmed.length > 0) {
                paths.push(trimmed);
            }
        };
        if (this.isExecutionReadTool(toolName) || this.isExecutionLocatorTool(toolName)) {
            addPath(input?.path);
        }
        if (toolName === 'get_open_files') {
            // Tool has no input, leave empty for prediction phase.
        }
        return paths;
    }
    public extractLocatedPathsFromToolResult(toolName: string, input: any, result: any): string[] {
        const paths = new Set<string>();
        const addPath = (value: unknown) => {
            if (typeof value !== 'string') {
                return;
            }
            const trimmed = value.trim();
            if (trimmed.length > 0) {
                paths.add(trimmed);
            }
        };
        addPath(input?.path);
        addPath(input?.file_path);
        addPath(result?.path);
        if (toolName === 'list_dir' && Array.isArray(result)) {
            const parentPath = typeof input?.path === 'string' ? input.path.trim() : '';
            if (parentPath.length > 0) {
                for (const entry of result) {
                    if (typeof entry?.name !== 'string') {
                        continue;
                    }
                    const normalizedParent = parentPath.endsWith('/') ? parentPath.slice(0, -1) : parentPath;
                    addPath(`${normalizedParent}/${entry.name}`);
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
            for (const filePath of result.files) {
                addPath(filePath);
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
    public extractReadPathsFromToolCallAndResult(toolName: string, input: any, result: any): string[] {
        const paths = new Set<string>();
        const addPath = (value: unknown) => {
            if (typeof value !== 'string') {
                return;
            }
            const trimmed = value.trim();
            if (trimmed.length > 0) {
                paths.add(trimmed);
            }
        };
        if (toolName === 'read_file'
            || toolName === 'read_file_range'
            || toolName === 'read_symbols'
            || toolName === 'get_definitions'
            || toolName === 'find_references'
            || toolName === 'read_lints') {
            addPath(input?.path);
            addPath(result?.path);
        }
        return Array.from(paths);
    }
    public extractSymbolEvidenceFromToolInput(toolName: string, input: any): string[] {
        if (toolName === 'get_definitions' || toolName === 'find_references') {
            const line = Number.isFinite(input?.line) ? Math.floor(input.line) : undefined;
            const column = Number.isFinite(input?.column) ? Math.floor(input.column) : undefined;
            if (typeof line === 'number' && typeof column === 'number') {
                return [`${toolName}@${line}:${column}`];
            }
        }
        return [];
    }
    public extractSymbolEvidenceFromToolResult(toolName: string, input: any, result: any): string[] {
        if (toolName === 'read_symbols') {
            return this.collectSymbolNames(result?.symbols);
        }
        return this.extractSymbolEvidenceFromToolInput(toolName, input);
    }
    public collectSymbolNames(symbols: any): string[] {
        const names = new Set<string>();
        const visit = (node: any) => {
            if (!node || typeof node !== 'object') {
                return;
            }
            if (typeof node.name === 'string' && node.name.trim().length > 0) {
                names.add(node.name.trim());
            }
            if (Array.isArray(node.children)) {
                for (const child of node.children) {
                    visit(child);
                }
            }
        };
        if (Array.isArray(symbols)) {
            for (const symbol of symbols) {
                visit(symbol);
            }
        }
        return Array.from(names).slice(0, 50);
    }
    public toEvidencePathKey(pathCandidate: unknown): string | undefined {
        const uri = this.resolveEvidenceCandidateToUri(pathCandidate);
        return uri?.toString();
    }
    public resolveEvidenceCandidateToUri(pathCandidate: unknown): URI | undefined {
        if (typeof pathCandidate !== 'string') {
            return undefined;
        }
        const trimmed = pathCandidate.trim();
        if (trimmed.length === 0) {
            return undefined;
        }
        const uriLike = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
        if (uriLike) {
            try {
                const parsed = URI.parse(trimmed);
                if (parsed.scheme === 'file') {
                    const workspaceFolder = this.options.toolContext.workspaceContextService.getWorkspaceFolder(parsed);
                    if (!workspaceFolder) {
                        return undefined;
                    }
                }
                return parsed;
            } catch {
                return undefined;
            }
        }
        const absoluteFilePath = trimmed.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(trimmed);
        if (absoluteFilePath) {
            const asFileUri = URI.file(trimmed);
            const workspaceFolder = this.options.toolContext.workspaceContextService.getWorkspaceFolder(asFileUri);
            if (workspaceFolder) {
                return asFileUri;
            }
        }
        try {
            return resolvePathToUri(trimmed, this.options.toolContext);
        } catch {
            return undefined;
        }
    }
    public getCurrentModelVersionForPathCandidate(pathCandidate: unknown): number | undefined {
        const uri = this.resolveEvidenceCandidateToUri(pathCandidate);
        if (!uri) {
            return undefined;
        }
        const model = this.options.toolContext.modelService.getModel(uri);
        return model?.getVersionId();
    }
    public isExecutionLocatorTool(toolName: string): boolean {
        return toolName === 'search_workspace'
            || toolName === 'semantic_search'
            || toolName === 'search_codebase'
            || toolName === 'find_by_name'
            || toolName === 'grep_search'
            || toolName === 'list_dir'
            || toolName === 'get_open_files';
    }
    public isExecutionReadTool(toolName: string): boolean {
        return toolName === 'read_file'
            || toolName === 'read_file_range'
            || toolName === 'read_reference'
            || toolName === 'read_symbols'
            || toolName === 'get_definitions'
            || toolName === 'find_references'
            || toolName === 'read_lints';
    }
    public getStructuredEditFailureKey(toolName: string, input: any): string {
        return `${toolName}:${JSON.stringify(input ?? {})}`;
    }
    public collectFailedEditOperations(toolName: string, toolResult: any): IFailedEditOperation[] {
        if (toolName === 'apply_edit') {
            return [{
                toolName,
                path: typeof toolResult?.path === 'string' ? toolResult.path : undefined,
                code: typeof toolResult?.code === 'string' ? toolResult.code : undefined,
                message: typeof toolResult?.message === 'string' ? toolResult.message : undefined,
                recoveryHint: typeof toolResult?.recoveryHint === 'string' ? toolResult.recoveryHint : undefined,
                currentVersionId: typeof toolResult?.currentVersionId === 'number' ? toolResult.currentVersionId : undefined,
                attemptedEdits: typeof toolResult?.attemptedEdits === 'number' ? toolResult.attemptedEdits : undefined,
                allMatches: Array.isArray(toolResult?.allMatches)
                    ? toolResult.allMatches
                    : Array.isArray(toolResult?.primaryDiagnostic?.allMatches)
                        ? toolResult.primaryDiagnostic.allMatches
                        : undefined
            }];
        }
        if (toolName === 'multi_file_replace' && Array.isArray(toolResult?.failures) && toolResult.failures.length > 0) {
            return toolResult.failures.map((failure: any) => ({
                toolName,
                path: typeof failure?.path === 'string' ? failure.path : undefined,
                code: typeof failure?.code === 'string' ? failure.code : undefined,
                message: typeof failure?.message === 'string' ? failure.message : undefined,
                recoveryHint: typeof failure?.recoveryHint === 'string' ? failure.recoveryHint : undefined,
                currentVersionId: typeof failure?.currentVersionId === 'number' ? failure.currentVersionId : undefined,
                attemptedEdits: typeof failure?.attemptedEdits === 'number' ? failure.attemptedEdits : undefined,
                allMatches: Array.isArray(failure?.allMatches)
                    ? failure.allMatches
                    : Array.isArray(failure?.primaryDiagnostic?.allMatches)
                        ? failure.primaryDiagnostic.allMatches
                        : undefined
            }));
        }
        return [{
            toolName,
            path: typeof toolResult?.path === 'string' ? toolResult.path : undefined,
            code: typeof toolResult?.code === 'string' ? toolResult.code : undefined,
            message: typeof toolResult?.message === 'string' ? toolResult.message : undefined,
            recoveryHint: typeof toolResult?.recoveryHint === 'string' ? toolResult.recoveryHint : undefined,
            currentVersionId: typeof toolResult?.currentVersionId === 'number' ? toolResult.currentVersionId : undefined,
            attemptedEdits: typeof toolResult?.attemptedEdits === 'number' ? toolResult.attemptedEdits : undefined
        }];
    }
    public buildEditRecoveryPrompt(failures: IFailedEditOperation[], repeatedFailures: IExecutionEditFailureState[] = []): string {
        const failureLines = failures.map((failure, index) => {
            const lines = [
                `${index + 1}. ${failure.toolName}${failure.path ? ` on ${failure.path}` : ''}`
            ];
            if (failure.code) { lines.push(` code: ${failure.code}`); }
            if (failure.message) { lines.push(` message: ${failure.message}`); }
            if (failure.recoveryHint) { lines.push(` recovery: ${failure.recoveryHint}`); }
            return lines.join('\n');
        }).join('\n');

        const repeatedFailureLines = repeatedFailures
            .filter(failure => failure.count > 1)
            .map(failure => `- ${failure.path ?? 'unknown path'} repeated ${failure.count} times${failure.lastCode ? ` (${failure.lastCode})` : ''}`);

        const escalationBlock = repeatedFailureLines.length > 0
            ? `\nRepeated failure escalation:\n${repeatedFailureLines.join('\n')}\n- Your next turn MUST be a focused recovery turn. Do not continue other tasks until the current file is fixed.\n`
            : '';

        const ambiguityBlock = failures
            .filter(f => f.code === 'ambiguous_match' && f.allMatches && f.allMatches.length > 0)
            .map(f => {
                const recommendedAction = 'ACTION: retry with a larger current old_string that uniquely identifies the intended occurrence, or set replace_all only if every occurrence should change.';
                return `Ambiguity detected for ${f.path}:\nMatches found at:\n${f.allMatches!.map(m => `- Lines ${m.lineNumber}-${m.endLineNumber}: "${m.lineContent}" (confidence ${m.confidence.toFixed(2)})`).join('\n')}\n${recommendedAction}`;
            })
            .join('\n\n');

        return `One or more exact-string edit operations failed. Recover before continuing.\n\nFailed edit details:\n${failureLines}\n${escalationBlock}${ambiguityBlock ? `\n${ambiguityBlock}\n` : ''}\nRequired recovery actions:\n1. Re-read only when the result reports stale content or when you need more current context.\n2. Retry with the current file_path, a corrected unique old_string, and new_string.\n3. Return concrete tool calls instead of treating the failed edit as completion.`;
    }

    public buildUnknownToolRecoveryPrompt(requestedToolName: string, toolResult: any): string {
        const suggestedTool = typeof toolResult?.suggestedTool === 'string' ? toolResult.suggestedTool : undefined;
        const availableTools = Array.isArray(toolResult?.availableTools) ? toolResult.availableTools.slice(0, 12).join(', ') : undefined;
        const suggestionLine = suggestedTool
            ? `Use "${suggestedTool}" instead of "${requestedToolName}".`
            : `The requested tool "${requestedToolName}" is unavailable in this environment.`;
        const availableLine = availableTools ? `Available tools include: ${availableTools}.` : '';
        return `Unknown tool call detected. ${suggestionLine}${availableLine ? ` ${availableLine}` : ''}\n\nReturn corrected tool_calls only.`;
    }
    public async hasMaterializedBootstrapWorkspace(): Promise<boolean> {
        try {
            const root = this.options.toolContext.workspaceContextService.getWorkspace().folders[0]?.uri;
            if (!root) {
                return false;
            }
            const stat = await this.options.toolContext.fileService.resolve(root);
            const children = stat.children ?? [];
            return children.some(child => !this.isIgnorableWorkspaceEntry(child.name) && !this.isVirtualArtifactPath(child.name));
        } catch {
            return false;
        }
    }
    public isIgnorableWorkspaceEntry(name: string): boolean {
        const normalized = name.trim().toLowerCase();
        return normalized === '.ds_store'
            || normalized === '.git'
            || normalized === '.gitignore'
            || normalized === '.gitattributes'
            || normalized === '.editorconfig'
            || normalized === '.vscode'
            || normalized === '.idea'
            || normalized === 'thumbs.db';
    }
    public isImplementationPlanPath(pathCandidate: unknown): boolean {
        return typeof pathCandidate === 'string' && pathCandidate.toLowerCase().endsWith('implementation_plan.md');
    }
    public isAnalysisPath(pathCandidate: unknown): boolean {
        if (typeof pathCandidate !== 'string') {
            return false;
        }
        const normalized = pathCandidate.replace(/\\/g, '/').toLowerCase();
        const basename = normalized.split('/').pop() || normalized;
        return basename === 'analysis.md';
    }
    public isVirtualArtifactPath(pathCandidate: unknown): boolean {
        return this.isImplementationPlanPath(pathCandidate) || this.isAnalysisPath(pathCandidate);
    }
}
