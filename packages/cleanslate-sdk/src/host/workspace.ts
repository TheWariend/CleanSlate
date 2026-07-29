/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Slate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../core/uri.js';

/**
 * The workspace the agent is working in, plus the host services that are scoped
 * to it: search, editors, commands and storage.
 *
 * Each is reduced to the members the runtime uses. The editor's own services
 * satisfy these as written, so the IDE host passes them through unchanged.
 */

export interface IWorkspaceFolder {
	uri: URI;
	name?: string;
	index?: number;
	/** Resolves a workspace-relative path against this folder. */
	toResource(relativePath: string): URI;
}

export interface IWorkspace {
	id: string;
	folders: readonly IWorkspaceFolder[];
}

export interface IWorkspaceHost {
	getWorkspace(): IWorkspace;
	getWorkspaceFolder(resource: URI): IWorkspaceFolder | null | undefined;
}

//#region search

/** Mirrors the editor's `QueryType`, which callers pass numerically. */
export enum SearchQueryType {
	File = 1,
	Text = 2,
	AI = 3
}

export interface ITextSearchPattern {
	pattern: string;
	isRegExp?: boolean;
	isCaseSensitive?: boolean;
	isWordMatch?: boolean;
	isMultiline?: boolean;
}

export interface IFolderQuery {
	folder: URI;
	includePattern?: Record<string, boolean>;
	disregardIgnoreFiles?: boolean;
	disregardGlobalIgnoreFiles?: boolean;
}

export interface ITextQuery {
	type: SearchQueryType.Text | number;
	contentPattern: ITextSearchPattern;
	folderQueries: IFolderQuery[];
	includePattern?: Record<string, boolean>;
	maxResults?: number;
	maxFileSize?: number;
	previewOptions?: { matchLines: number; charsPerLine: number };
	afterContext?: number;
	beforeContext?: number;
	/** Lines of context to return either side of a match. */
	surroundingContext?: number;
}

export interface ISearchRange {
	startLineNumber: number;
	startColumn: number;
	endLineNumber: number;
	endColumn: number;
}

export interface ITextSearchMatch {
	previewText: string;
	rangeLocations: readonly { source: ISearchRange; preview: ISearchRange }[];
}

export interface ITextSearchResult {
	previewText?: string;
	rangeLocations?: readonly { source: ISearchRange; preview: ISearchRange }[];
	lineNumber?: number;
	text?: string;
}

export interface IFileMatch {
	resource: URI;
	results?: readonly ITextSearchResult[];
}

/** A status line from the search engine rather than a result. */
export interface ISearchProgressMessage {
	message: string;
}

/** A keyword suggestion, which only an AI-backed search emits. */
export interface ISearchKeyword {
	keyword: string;
}

/**
 * Everything a search can report while it runs.
 *
 * The runtime only reads file matches — `isFileMatch` filters the rest out —
 * but the other kinds have to be named, because the editor's search service
 * emits them and its callback would otherwise not fit this one.
 */
export type ISearchProgressItem = IFileMatch | ITextSearchResult | ISearchProgressMessage | ISearchKeyword;

export interface ISearchComplete {
	results: readonly IFileMatch[];
	limitHit?: boolean;
	messages?: readonly unknown[];
}

/**
 * Narrows a progress item to a file match. Reproduced from the editor's search
 * service, where it is a value rather than a type, so it has to exist here too.
 */
export function isFileMatch(item: ISearchProgressItem): item is IFileMatch {
	return !!(item as IFileMatch).resource;
}

/** Narrows a result to one that carries preview text. */
export function resultIsMatch(result: ITextSearchResult): result is ITextSearchResult & ITextSearchMatch {
	return !!result.rangeLocations && !!result.previewText;
}

export interface ISearchHost {
	textSearch(
		query: ITextQuery,
		token?: unknown,
		onProgress?: (item: ISearchProgressItem) => void
	): Promise<ISearchComplete>;
}

//#endregion

//#region editors, commands, storage

/**
 * Opening an editor group. `-1` is the active group, matching the editor's
 * `ACTIVE_GROUP`; hosts without editors ignore it.
 */
export const ACTIVE_GROUP = -1;

export interface IEditorOpenHost {
	openEditor(input: unknown, options?: unknown, group?: number): Promise<unknown>;
	getEditors?(order: number): readonly unknown[];
}

export interface ICommandHost {
	executeCommand<T = unknown>(commandId: string, ...args: unknown[]): Promise<T | undefined>;
}

/** Where per-workspace state is kept — used to locate the edit-history store. */
export interface IEnvironmentHost {
	workspaceStorageHome: URI;
}

export interface IUndoRedoHost {
	undo?(resource: URI): Promise<void> | void;
	redo?(resource: URI): Promise<void> | void;
}

//#endregion
