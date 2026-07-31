/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../core/uri.js';
import { isEqualOrParent } from '../core/resources.js';
import { ISlateTextModel } from '../host/textModel.js';
import { IWorkspaceHost } from '../host/workspace.js';
import { CLEANSLATE_ARTIFACT_SCHEME } from '../protocol/cleanSlateAI.js';
import { CleanSlateToolContext } from './types.js';

export interface ResolvePathToUriOptions {
    /**
     * Legacy compatibility mode for model-provided root-like paths.
     * When true, unresolved POSIX absolute paths are treated as workspace-relative to the first folder.
     * Mutation tools should set this to false to avoid editing the wrong file silently.
     */
    allowWorkspaceRootRelativeAbsolute?: boolean;
}

function artifactBasename(path: string): string {
    const normalized = path.replace(/\\/g, '/').toLowerCase();
    const parts = normalized.split('/');
    return parts[parts.length - 1] || normalized;
}

export function getVirtualArtifactType(path: string): 'implementation_plan' | 'walkthrough' | 'analysis' | 'task' | undefined {
    const basename = artifactBasename(path);

    if (basename === 'implementation_plan.md') {
        return 'implementation_plan';
    }
    if (basename === 'walkthrough.md') {
        return 'walkthrough';
    }
    if (basename === 'analysis.md') {
        return 'analysis';
    }
    if (basename === 'task.md') {
        return 'task';
    }

    return undefined;
}

export function isVirtualArtifactPath(path: string): boolean {
    return getVirtualArtifactType(path) !== undefined;
}

/**
 * Strip ANSI escape codes from a string
 */
export function stripAnsi(str: unknown): string {
    if (typeof str !== 'string') {
        return '';
    }
    // eslint-disable-next-line no-control-regex
    return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]|(?:\u001b\u009b]|\u001b\]).*?(?:\u0007|\u001b\\)/g, '');
}

/**
 * Resolves cwd for command execution: use workspace root when missing, validate model-provided paths,
 * and fall back to the first workspace folder when the path is missing or not a directory (e.g. hallucinated `/workspace`).
 */
export async function resolveCommandCwd(requested: string | undefined, context: CleanSlateToolContext): Promise<string | undefined> {
    const folders = context.workspaceContextService.getWorkspace().folders;
    const defaultRoot = folders[0]?.uri.fsPath;

    const trimmed = requested?.trim();
    if (!trimmed) {
        return defaultRoot;
    }

    try {
        const uri = URI.file(trimmed);
        const stat = await context.fileService.stat(uri);
        if (stat.isDirectory && context.workspaceContextService.getWorkspaceFolder(uri)) {
            return trimmed;
        }
    } catch {
        // Path missing or inaccessible — use workspace root when available.
    }

    return defaultRoot;
}

/**
 * Shared prefix of path resolution: virtual artifacts, exact in-workspace matches, and
 * workspace-relative paths are unambiguous and require no filesystem I/O to resolve.
 * A genuine absolute path that falls outside every workspace folder is left as an
 * `outsideWorkspaceAbsolute` outcome for the caller (sync or async) to decide on.
 */
type PathResolutionOutcome =
    | { kind: 'resolved'; uri: URI }
    | { kind: 'outsideWorkspaceAbsolute'; potentialUri: URI; isPosixAbsolutePath: boolean; firstFolder: { toResource(relativePath: string): URI } };

function resolvePathCore(path: string, context: CleanSlateToolContext): PathResolutionOutcome {
    if (typeof path !== 'string' || !path.trim()) {
        throw new Error('Path must be a non-empty string.');
    }
    const requestedPath = path.trim();

    // 1. Special check for virtual artifacts (must be first to avoid URI.file errors)
    if (isVirtualArtifactPath(requestedPath)) {
        const normalizedArtifactPath = requestedPath.replace(/^\/+/, '');
        return {
            kind: 'resolved',
            uri: URI.from({ scheme: CLEANSLATE_ARTIFACT_SCHEME, path: `/${normalizedArtifactPath}` })
        };
    }

    const workspaceFolders = context.workspaceContextService.getWorkspace().folders;
    const potentialUri = URI.file(requestedPath);

    const matchingFolder = context.workspaceContextService.getWorkspaceFolder(potentialUri);
    if (matchingFolder) {
        return { kind: 'resolved', uri: potentialUri };
    }

    if (workspaceFolders.length === 0) {
        // No workspace: refuse to access arbitrary filesystem paths.
        throw new Error('No workspace folders available; refusing to access filesystem paths');
    }

    const firstFolder = workspaceFolders[0];
    const isWindowsAbsolutePath = /^[a-zA-Z]:[\\/]/.test(requestedPath);
    const isPosixAbsolutePath = requestedPath.startsWith('/');

    // Relative path - resolve against first workspace folder
    if (!isPosixAbsolutePath && !isWindowsAbsolutePath) {
        const resolved = firstFolder.toResource(requestedPath);
        const resolvedFolder = context.workspaceContextService.getWorkspaceFolder(resolved);
        if (!resolvedFolder) {
            throw new Error(`Resolved path is outside the workspace: ${requestedPath}`);
        }
        return { kind: 'resolved', uri: resolved };
    }

    return { kind: 'outsideWorkspaceAbsolute', potentialUri, isPosixAbsolutePath, firstFolder };
}

/**
 * Helper to resolve paths reliably across workspace folders.
 *
 * Synchronous — does no filesystem I/O, so a genuine absolute path outside the workspace
 * is only ever handled via the legacy workspace-root-relative compatibility mapping (or
 * rejected outright when `allowWorkspaceRootRelativeAbsolute` is false). Mutation tools use
 * this: they intentionally cannot target another project's files by surprise. Read tools
 * should prefer {@link resolvePathToUriAsync}, which can actually check whether the literal
 * path exists on disk and access it.
 */
export function resolvePathToUri(path: string, context: CleanSlateToolContext, options: ResolvePathToUriOptions = {}): URI {
    const allowWorkspaceRootRelativeAbsolute = options.allowWorkspaceRootRelativeAbsolute ?? true;
    const outcome = resolvePathCore(path, context);
    if (outcome.kind === 'resolved') {
        return outcome.uri;
    }

    // POSIX absolute path outside workspace.
    // In compatibility mode, allow `/foo/bar` to map into the first workspace as `foo/bar`.
    if (outcome.isPosixAbsolutePath && allowWorkspaceRootRelativeAbsolute) {
        const relativePath = path.trim().replace(/^\/+/, '');
        return outcome.firstFolder.toResource(relativePath);
    }

    throw new Error(`Path is outside the workspace and cannot be resolved safely: ${path.trim()}`);
}

/**
 * Async counterpart to {@link resolvePathToUri}, for read-only tools. A path outside every
 * workspace folder is not automatically a dead end: a genuine absolute path (e.g. a sibling
 * repo on disk while a different project is the active workspace) should resolve to itself
 * when it actually exists, rather than being silently remapped into a nonexistent path inside
 * the current workspace. Falls back to the legacy workspace-root-relative interpretation (for
 * hallucinated `/foo` paths that meant "workspace root/foo") only when the literal path is not
 * found on disk, and only ever widens access for reads — write tools keep calling the sync,
 * strictly-scoped `resolvePathToUri` above.
 */
export async function resolvePathToUriAsync(path: string, context: CleanSlateToolContext, options: ResolvePathToUriOptions = {}): Promise<URI> {
    const allowWorkspaceRootRelativeAbsolute = options.allowWorkspaceRootRelativeAbsolute ?? true;
    const outcome = resolvePathCore(path, context);
    if (outcome.kind === 'resolved') {
        return outcome.uri;
    }

    if (!allowWorkspaceRootRelativeAbsolute) {
        throw new Error(`Path is outside the workspace and cannot be resolved safely: ${path.trim()}`);
    }

    const realExists = await context.fileService.exists(outcome.potentialUri).catch(() => false);
    if (realExists) {
        return outcome.potentialUri;
    }

    if (outcome.isPosixAbsolutePath) {
        const relativePath = path.trim().replace(/^\/+/, '');
        const compatUri = outcome.firstFolder.toResource(relativePath);
        const compatExists = await context.fileService.exists(compatUri).catch(() => false);
        if (compatExists) {
            return compatUri;
        }
    }

    // Neither the literal path nor the legacy compat mapping exists on disk; return the
    // literal absolute path so the resulting not-found error names the path actually given.
    return outcome.potentialUri;
}

/**
 * The IDE's currently-open workspace context. For an Agent Manager session, `workspaceContextService`
 * is scoped to that session's own project, so `ideWorkspaceContextService` is the real IDE workspace.
 * Falls back to the session context when unset so existing (reveal) behavior is preserved.
 */
function getIdeWorkspaceContextService(context: CleanSlateToolContext): IWorkspaceHost | undefined {
    return context.ideWorkspaceContextService ?? context.workspaceContextService;
}

/**
 * True when `uri` lives inside the workspace the IDE currently has open (i.e. same project as the
 * editor), so revealing it in the IDE editor is appropriate. Used to gate editor reveals for real
 * files created/edited by a tool. When no workspace context is available (e.g. in tests) it defaults
 * to `true` to preserve the legacy always-reveal behavior.
 */
export function isUriInIdeWorkspace(context: CleanSlateToolContext, uri: URI): boolean {
    const ide = getIdeWorkspaceContextService(context);
    if (!ide) {
        return true;
    }
    return !!ide.getWorkspaceFolder(uri);
}

/**
 * True when the session's project is the same project the IDE currently has open. Used for artifacts,
 * whose virtual `cleanslate-artifact:` URIs are not part of any workspace folder and so can't be
 * checked with `isUriInIdeWorkspace`. When no workspace context is available (e.g. in tests) it
 * defaults to `true` to preserve the legacy always-open behavior.
 */
export function isSessionWorkspaceOpenInIde(context: CleanSlateToolContext): boolean {
    const ide = getIdeWorkspaceContextService(context);
    const session = context.workspaceContextService;
    if (!ide || !session) {
        return true;
    }
    const ideWorkspace = ide.getWorkspace();
    const sessionWorkspace = session.getWorkspace();
    const ideFolders = ideWorkspace.folders;
    const sessionFolders = sessionWorkspace.folders;
    if (sessionFolders.length === 0 || ideFolders.length === 0) {
        return sessionWorkspace.id === ideWorkspace.id;
    }
    return sessionFolders.some(sessionFolder =>
        ideFolders.some(ideFolder =>
            isEqualOrParent(sessionFolder.uri, ideFolder.uri) || isEqualOrParent(ideFolder.uri, sessionFolder.uri)));
}

/**
 * Materializes the text model for `uri` without opening a visible editor. Replaces `openEditor` calls
 * that existed only to load a model as a side effect of revealing the file.
 */
export async function resolveTextModelHeadless(uri: URI, context: CleanSlateToolContext): Promise<ISlateTextModel | null> {
    await context.textFileService.files.resolve(uri);
    return context.modelService.getModel(uri);
}


/**
 * Escapes characters for use in a regular expression
 */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Finds the actual string in fileContent using a whitespace-agnostic regex.
 * This is the ultimate fallback for when exact and quote-normalized matches fail.
 */
export function regexFindActualString(fileContent: string, searchString: string): string | null {
    // 1. Prepare search pattern
    // Trim to avoid matching leading/trailing whitespace at start/end of block
    const trimmedSearch = searchString.trim();
    if (!trimmedSearch) return null;

    let pattern = escapeRegex(trimmedSearch);

    // 2. Replace any whitespace sequence in the search string with a whitespace-agnostic regex segment
    // This handles tabs, spaces, and variety of newlines
    pattern = pattern.replace(/\s+/g, '[\\s\\r\\n]+');

    try {
        const regex = new RegExp(pattern, 'm');
        const match = fileContent.match(regex);
        if (match && match[0]) {
            return match[0];
        }
    } catch {
        // Fallback for extremely large or complex regexes
    }

    return null;
}

/**
 * Helper to identify documentation files that should skip interactive preview
 */
export function isDocumentationFile(path: string): boolean {
    return isVirtualArtifactPath(path);
}

export function shellEscapeSingleQuotes(value: string): string {
    // Wrap in single quotes and escape embedded single quotes: abc'def -> 'abc'"'"'def'
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}
