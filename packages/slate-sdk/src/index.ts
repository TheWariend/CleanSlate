/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Slate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * @slate/sdk — the Slate agent runtime.
 *
 * A surface (a terminal, an editor, a server) supplies host capabilities and
 * drives the loop. Nothing here assumes a particular surface, and nothing
 * requires an editor build.
 */

//#region host contracts — what a surface must provide

export type {
	ISlateTextModel,
	ISlateSingleEditOperation,
	ITextFileContent,
	IModelHost,
	ITextFileHost
} from './host/textModel.js';

export {
	FileOperationResult,
	toFileOperationResult
} from './host/files.js';
export type {
	IFileHost,
	IFileStat,
	IFileContent,
	IFileOperationError
} from './host/files.js';

export {
	SearchQueryType,
	ACTIVE_GROUP,
	isFileMatch,
	resultIsMatch
} from './host/workspace.js';
export type {
	IWorkspace,
	IWorkspaceFolder,
	IWorkspaceHost,
	ISearchHost,
	ITextQuery,
	ISearchComplete,
	ISearchProgressItem,
	IFileMatch,
	IEditorOpenHost,
	ICommandHost,
	IEnvironmentHost,
	IUndoRedoHost
} from './host/workspace.js';

export { MarkerSeverity } from './host/diagnostics.js';
export type { IMarker, IMarkerHost, IMarkerReadFilter } from './host/diagnostics.js';

export { SymbolKind } from './host/symbols.js';
export type { Location } from './host/symbols.js';

export type {
	IInstantiationHost,
	ILanguageFeaturesHost,
	ITreeSitterHost,
	IArtifactPresentationHost,
	IHeaders,
	IRequestOptions
} from './host/services.js';

export type {
	ICleanSlateBrowserAutomationService,
	ICleanSlateBrowserState,
	ICleanSlateBrowserSnapshot,
	CleanSlateBrowserSurface
} from './host/browserAutomation.js';

export type {
	ICleanSlateBulkEditHost,
	ICleanSlateBulkEditResult,
	ICleanSlateResourceTextEditDescriptor,
	ICleanSlateEditorDecorationHost,
	ICleanSlateEditorRevealHost
} from './tools/cleanSlateHostTypes.js';

//#endregion

//#region the runtime

export { ALL_TOOLS, getToolByName } from './tools/registry.js';
export type { CleanSlateTool, CleanSlateToolContext } from './tools/types.js';

export { CleanSlateExecutionQueryEngine } from './agent/cleanSlateExecutionQuery.js';
export { CleanSlateEditService } from './services/cleanSlateEditService.js';
export { CleanSlateDiffService } from './services/cleanSlateDiffService.js';

export {
	CleanSlateHeadlessRuntime,
	createNodeHost,
	NodeCleanSlateMainService,
	CleanSlateNodeAgentRuntime,
	createNodeProviderConfiguration
} from './node/index.js';
export type {
	ICleanSlateHeadlessTool,
	ICleanSlateHeadlessRunOptions,
	ICleanSlateHeadlessRunResult
} from './node/cleanSlateHeadlessRunner.js';
export type { ICleanSlateNodeRuntimeOptions } from './node/cleanSlateNodeToolContext.js';
export type { ICleanSlateNodeAgentRuntimeOptions } from './node/cleanSlateNodeAgentRuntime.js';

//#endregion

//#region primitives the host contracts are expressed in

export { URI } from './core/uri.js';
export { Range } from './core/range.js';
export { Position } from './core/position.js';
export { VSBuffer } from './core/buffer.js';
export { Emitter } from './core/event.js';
export type { Event } from './core/event.js';
export { CancellationTokenSource, CancellationToken } from './core/cancellation.js';
export { Disposable, DisposableStore, toDisposable } from './core/lifecycle.js';
export type { IDisposable } from './core/lifecycle.js';

//#endregion
