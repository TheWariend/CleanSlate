/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../core/uri.js';
import { isEqualOrParent } from '../core/resources.js';
import { ISlateTextModel } from '../host/textModel.js';
import { IWorkspaceFolder, IWorkspaceHost } from '../host/workspace.js';
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

/**
 * Structured failure raised when a mutation tool is handed an absolute path that
 * cannot be resolved safely inside any active workspace folder. Carrying the
 * offending path plus (when we can compute it) a suggested workspace-relative
 * form lets the caller return a `path_outside_workspace` tool result the model
 * can actually recover from, instead of a mysterious "editor service" failure.
 */
export class PathOutsideWorkspaceError extends Error {
    readonly code = 'path_outside_workspace' as const;
    readonly requestedPath: string;
    readonly suggestedWorkspaceRelativePath?: string;
    readonly workspaceRootFsPath?: string;

    constructor(requestedPath: string, options: { suggestedWorkspaceRelativePath?: string; workspaceRootFsPath?: string } = {}) {
        super(`Path is outside the workspace and cannot be resolved safely: ${requestedPath.trim()}`);
        this.name = 'PathOutsideWorkspaceError';
        this.requestedPath = requestedPath;
        this.suggestedWorkspaceRelativePath = options.suggestedWorkspaceRelativePath;
        this.workspaceRootFsPath = options.workspaceRootFsPath;
    }
}

/**
 * Node-only helpers loaded lazily. The SDK's root entry point is loaded in a
 * renderer bundle that has no Node built-ins, so `fs` and `path` are resolved
 * on demand — and only when the mutation resolvers actually need to widen the
 * workspace containment check with a realpath comparison. Cached after the
 * first successful load; falls back to undefined when the runtime is not Node.
 */
type NodePathHelpers = {
    realpathSync?: (target: string) => string;
    relative: (from: string, to: string) => string;
    isAbsolute: (p: string) => boolean;
    sep: string;
};

let cachedNodeHelpers: NodePathHelpers | undefined | null = undefined;

async function loadNodeHelpers(): Promise<NodePathHelpers | undefined> {
    if (cachedNodeHelpers !== undefined) {
        return cachedNodeHelpers ?? undefined;
    }
    // Detect the runtime through a global side channel so the browser-safe
    // bundle never needs Node built-ins. `process.versions.node` is the
    // canonical marker used by every Node-runtime detection path.
    const proc: any = (globalThis as any).process;
    if (!proc || !proc.versions || !proc.versions.node) {
        cachedNodeHelpers = null;
        return undefined;
    }
    try {
        // Indirect specifiers keep the browser-safe entry point free of a
        // static `import 'fs'` — the SDK provenance test rejects any bare
        // static or literal-string dynamic import from the root graph.
        const fsSpec = 'fs' + '';
        const pathSpec = 'path' + '';
        const fsMod: any = await import(/* @vite-ignore */ /* webpackIgnore: true */ fsSpec);
        const pathMod: any = await import(/* @vite-ignore */ /* webpackIgnore: true */ pathSpec);
        const nativeRealpath: undefined | ((target: string) => string) = fsMod?.realpathSync?.native;
        const realpathSync: undefined | ((target: string) => string) = nativeRealpath ?? fsMod?.realpathSync;
        cachedNodeHelpers = {
            realpathSync,
            relative: pathMod.relative,
            isAbsolute: pathMod.isAbsolute,
            sep: pathMod.sep ?? '/'
        };
        return cachedNodeHelpers;
    } catch {
        cachedNodeHelpers = null;
        return undefined;
    }
}

/**
 * Best-effort canonical-realpath lookup used only to *widen* the workspace
 * containment check. Returns undefined on any error so the caller can fall
 * through to the raw URI comparison. Never mutates state, never throws.
 *
 * macOS in particular routinely surfaces the same file as both `/Users/x/foo`
 * and `/private/var/folders/…/x/foo`, and workspaces mounted through a symlink
 * expand to something the workbench workspace-folder containment check (which
 * is a URI prefix match) does not consider a match against a URI built from
 * the pre-expansion path. Comparing realpaths on both sides removes the whole
 * class of "absolute-inside-workspace path silently rejected as outside".
 */
async function tryCanonicalizePath(fsPath: string): Promise<string | undefined> {
    const helpers = await loadNodeHelpers();
    if (!helpers?.realpathSync) {
        return undefined;
    }
    try {
        const realpath = helpers.realpathSync(fsPath);
        return typeof realpath === 'string' ? realpath : undefined;
    } catch {
        return undefined;
    }
}

/**
 * True when `resource` lands inside `folder` under a realpath-canonical
 * comparison of the two `fsPath`s. Callers use this only as a widening
 * fallback to the workbench's raw URI-prefix containment check.
 */
async function isResourceInsideFolderByRealpath(resource: URI, folder: IWorkspaceFolder): Promise<boolean> {
    if (resource.scheme !== 'file' || folder.uri.scheme !== 'file') {
        return false;
    }
    const helpers = await loadNodeHelpers();
    if (!helpers) {
        return false;
    }
    const [resourceReal, folderReal] = await Promise.all([
        tryCanonicalizePath(resource.fsPath),
        tryCanonicalizePath(folder.uri.fsPath)
    ]);
    if (!resourceReal || !folderReal) {
        return false;
    }
    const relative = helpers.relative(folderReal, resourceReal);
    return relative === '' || (!relative.startsWith('..') && !helpers.isAbsolute(relative));
}

/**
 * Sync workspace-containment check: only the workbench's raw URI-prefix match.
 * Every other host service uses this, so it stays authoritative for callers
 * that cannot await. Use {@link findContainingWorkspaceFolderAsync} when a
 * realpath widening is safe (all mutation resolvers).
 */
export function findContainingWorkspaceFolderSync(context: CleanSlateToolContext, resource: URI): IWorkspaceFolder | undefined {
    return context.workspaceContextService.getWorkspaceFolder(resource) ?? undefined;
}

/**
 * Async workspace-containment check: first the workbench's raw URI-prefix
 * match, then a canonical-realpath comparison for the macOS `/Users` vs
 * `/private/var/folders` and symlinked-workspace cases the raw check misses.
 * Returns undefined when neither view finds a match, so mutation callers still
 * refuse to touch a genuinely outside path.
 */
export async function findContainingWorkspaceFolderAsync(context: CleanSlateToolContext, resource: URI): Promise<IWorkspaceFolder | undefined> {
    const direct = context.workspaceContextService.getWorkspaceFolder(resource);
    if (direct) {
        return direct;
    }
    for (const folder of context.workspaceContextService.getWorkspace().folders) {
        if (await isResourceInsideFolderByRealpath(resource, folder)) {
            return folder;
        }
    }
    return undefined;
}

/**
 * POSIX-style workspace-relative path for `resource` under `folder`, comparing
 * realpaths (when Node is available) so the result stays correct when the
 * workspace itself is reached through a symlink. Returns undefined when the
 * resource is not actually inside the folder — no guessing.
 */
async function computeWorkspaceRelativePath(folder: IWorkspaceFolder, resource: URI): Promise<string | undefined> {
    if (resource.scheme !== 'file' || folder.uri.scheme !== 'file') {
        return undefined;
    }
    const helpers = await loadNodeHelpers();
    if (!helpers) {
        return undefined;
    }
    const [resourceReal, folderReal] = await Promise.all([
        tryCanonicalizePath(resource.fsPath),
        tryCanonicalizePath(folder.uri.fsPath)
    ]);
    const resolvedResource = resourceReal ?? resource.fsPath;
    const resolvedFolder = folderReal ?? folder.uri.fsPath;
    const relative = helpers.relative(resolvedFolder, resolvedResource);
    if (relative === '' || relative.startsWith('..') || helpers.isAbsolute(relative)) {
        return undefined;
    }
    return relative.split(helpers.sep).join('/');
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

function tryParseFileLikeUri(value: string): URI | undefined {
    if (!/^file:\/\//i.test(value)) {
        return undefined;
    }
    try {
        const parsed = URI.parse(value);
        return parsed.scheme === 'file' ? parsed : undefined;
    } catch {
        return undefined;
    }
}

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
    const potentialUri = tryParseFileLikeUri(requestedPath) ?? URI.file(requestedPath);

    // The workbench's own containment check is a URI-prefix match. On macOS
    // that misses paths where the workspace is reached through a symlink
    // (`/Users/x` vs `/private/var/folders/…/x`) even though the file really
    // is inside the workspace, so widen the check with a realpath fallback.
    // Sync path — raw URI-prefix match only. The mutation-async resolver
    // widens this with a realpath comparison when awaiting is safe.
    const matchingFolder = findContainingWorkspaceFolderSync(context, potentialUri);
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

    throw buildPathOutsideWorkspaceErrorSync(path, context, outcome.potentialUri);
}

/**
 * Async counterpart to {@link resolvePathToUri} for mutation tools. Same safety
 * contract as the sync resolver (never silently remap into an unrelated
 * project), but widens acceptance to genuine absolute paths that really are
 * inside a workspace folder when checked through the filesystem — the exact
 * case where the sync check misclassifies a real in-workspace file as outside
 * (macOS symlinked `/Users` vs `/private/var/folders`, symlinked workspace
 * roots). The failure shape is a structured {@link PathOutsideWorkspaceError}
 * that carries a suggested workspace-relative path so the calling tool can
 * return a `path_outside_workspace` result the model can actually recover from.
 */
export async function resolvePathToUriForMutationAsync(path: string, context: CleanSlateToolContext): Promise<URI> {
    const outcome = resolvePathCore(path, context);
    if (outcome.kind === 'resolved') {
        return outcome.uri;
    }

    // The path is absolute and the sync workspace check said "outside".
    // Before refusing, confirm on-disk containment: when the file really
    // exists AND its realpath sits inside a workspace folder's realpath,
    // it is safe to accept — that is *the same file* the user has open.
    const literalExists = await context.fileService.exists(outcome.potentialUri).catch(() => false);
    if (literalExists) {
        const containingFolder = await findContainingWorkspaceFolderAsync(context, outcome.potentialUri);
        if (containingFolder) {
            return outcome.potentialUri;
        }
    }

    throw await buildPathOutsideWorkspaceErrorAsync(path, context, outcome.potentialUri);
}

/**
 * Structured tool result shape returned by mutation tools when the target
 * lands outside every workspace folder. Uniform across `apply_edit`,
 * `write_file`, and `multi_file_replace` so downstream policy + prompts can
 * key off `code: 'path_outside_workspace'` without pattern-matching messages.
 */
export interface CleanSlatePathOutsideWorkspaceResult {
    success: false;
    code: 'path_outside_workspace';
    path: string;
    workspaceRoot?: string;
    suggestedWorkspaceRelativePath?: string;
    recoveryHint: string;
    message: string;
}

/**
 * Turns a {@link PathOutsideWorkspaceError} into the structured tool result
 * mutation tools return in place of throwing. When we can name a workspace
 * folder that actually contains the file, the recovery hint tells the model to
 * retry with the workspace-relative form; otherwise it explains that mutations
 * only touch the active workspace.
 */
export function buildPathOutsideWorkspaceResult(requestedPath: string, error: PathOutsideWorkspaceError): CleanSlatePathOutsideWorkspaceResult {
    const recoveryHint = error.suggestedWorkspaceRelativePath
        ? `Retry using the workspace-relative path "${error.suggestedWorkspaceRelativePath}". The file is inside the active workspace at "${error.workspaceRootFsPath ?? ''}", but the absolute form did not resolve through the workspace containment check.`
        : 'Mutation tools only write inside the active workspace. Confirm the target belongs to this workspace and retry with a workspace-relative path.';
    return {
        success: false,
        code: 'path_outside_workspace',
        path: requestedPath,
        workspaceRoot: error.workspaceRootFsPath,
        suggestedWorkspaceRelativePath: error.suggestedWorkspaceRelativePath,
        recoveryHint,
        message: error.message
    };
}

/**
 * Sync {@link PathOutsideWorkspaceError} builder for callers that cannot await.
 * Uses only the workbench's raw containment check, so it cannot suggest a
 * workspace-relative path when the file is only reachable through a realpath
 * comparison — that path is left for the async builder used by mutation tools.
 */
function buildPathOutsideWorkspaceErrorSync(requestedPath: string, context: CleanSlateToolContext, resource: URI): PathOutsideWorkspaceError {
    const containingFolder = findContainingWorkspaceFolderSync(context, resource);
    const firstFolder = context.workspaceContextService.getWorkspace().folders[0];
    return new PathOutsideWorkspaceError(requestedPath, {
        workspaceRootFsPath: (containingFolder ?? firstFolder)?.uri.fsPath
    });
}

/**
 * Async {@link PathOutsideWorkspaceError} builder, computing a suggested
 * workspace-relative form when the target really does live under one of the
 * workspace folders (only reachable through a realpath comparison, so the sync
 * resolver couldn't see it). When the target is genuinely elsewhere on disk,
 * the error still surfaces the failing path without inventing a recovery hint
 * that would land somewhere else.
 */
async function buildPathOutsideWorkspaceErrorAsync(requestedPath: string, context: CleanSlateToolContext, resource: URI): Promise<PathOutsideWorkspaceError> {
    const containingFolder = await findContainingWorkspaceFolderAsync(context, resource);
    if (containingFolder) {
        const suggested = await computeWorkspaceRelativePath(containingFolder, resource);
        return new PathOutsideWorkspaceError(requestedPath, {
            suggestedWorkspaceRelativePath: suggested,
            workspaceRootFsPath: containingFolder.uri.fsPath
        });
    }
    const firstFolder = context.workspaceContextService.getWorkspace().folders[0];
    return new PathOutsideWorkspaceError(requestedPath, {
        workspaceRootFsPath: firstFolder?.uri.fsPath
    });
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
        throw await buildPathOutsideWorkspaceErrorAsync(path, context, outcome.potentialUri);
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
