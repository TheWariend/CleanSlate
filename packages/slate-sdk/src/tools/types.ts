/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IModelHost } from '../host/textModel.js';
import { ITextFileHost } from '../host/textModel.js';
import { IFileHost } from '../host/files.js';
import { ICleanSlateIndexService, ICleanSlateConfigurationService, ICleanSlateContextService, ICleanSlateArtifactService, IMCPClientService, ICleanSlateMainService } from '../protocol/cleanSlateAI.js';
import { ICleanSlateCommandExecutionService } from '../services/cleanSlateCommandExecutionService.js';
import { IWorkspaceHost } from '../host/workspace.js';
import { IMarkerHost } from '../host/diagnostics.js';
import { ICleanSlateBulkEditHost, ICleanSlateEditorDecorationHost, ICleanSlateEditorRevealHost } from './cleanSlateHostTypes.js';
import { IArtifactPresentationHost, IInstantiationHost } from '../host/services.js';
import { IEditorOpenHost } from '../host/workspace.js';
import { ISearchHost } from '../host/workspace.js';
import { ILanguageFeaturesHost } from '../host/services.js';
import { IUndoRedoHost } from '../host/workspace.js';
import { ITreeSitterHost } from '../host/services.js';
import { IEnvironmentHost } from '../host/workspace.js';
import { ICommandHost } from '../host/workspace.js';
import { ICleanSlateBrowserAutomationService } from '../host/browserAutomation.js';

export type CleanSlateToolSurface = 'ide' | 'agentManager';

export interface CleanSlateFileReadBudgetContext {
    /** Resolved usable input window for the active provider/model. */
    contextWindowTokens: number;
    /** Estimated input tokens still available before adding the next tool result. */
    availableInputTokens: number;
}

export interface CleanSlateToolContext {
    surface: CleanSlateToolSurface;
    sessionId?: string;
    signal?: AbortSignal;
    modelService: IModelHost;
    codeEditorService: ICleanSlateEditorRevealHost;
    textFileService: ITextFileHost;
    fileService: IFileHost;
    contextService: ICleanSlateContextService;
    indexService: ICleanSlateIndexService;
    workspaceContextService: IWorkspaceHost;
    /**
     * The IDE's currently-open workspace (distinct from `workspaceContextService`, which for an
     * Agent Manager session is scoped to that session's own project). Used to decide whether a
     * file/artifact belongs to the same project the IDE has open before revealing it in the editor.
     * Defaults to `workspaceContextService` for the IDE surface, where the two are equivalent.
     */
    ideWorkspaceContextService?: IWorkspaceHost;
    configService: ICleanSlateConfigurationService;
    markerService: IMarkerHost;
    artifactService: ICleanSlateArtifactService;
    mcpClientService?: IMCPClientService;
    cleanSlateMainService?: ICleanSlateMainService;
    instantiationService: IInstantiationHost;
    /** Shows a generated artifact. Absent on hosts with nowhere to show it. */
    artifactPresentationHost?: IArtifactPresentationHost;
    editorService: IEditorOpenHost;
    commandExecutionService: ICleanSlateCommandExecutionService;
    browserAutomationService: ICleanSlateBrowserAutomationService;
    bulkEditService?: ICleanSlateBulkEditHost;
    /** Inline diff decorations. Absent when nothing is on screen to decorate. */
    editorDecorationHost?: ICleanSlateEditorDecorationHost;
    searchService?: ISearchHost;
    languageFeaturesService?: ILanguageFeaturesHost;
    undoRedoService?: IUndoRedoHost;
    treeSitterLibraryService?: ITreeSitterHost;
    environmentService?: IEnvironmentHost;
    commandService?: ICommandHost;
    recentFocusLines?: Map<string, Set<number>>;
    readFileState?: Map<string, CleanSlateReadFileState>;
    fileReadBudget?: CleanSlateFileReadBudgetContext;
    requestCommandApproval: (request: { command: string; cwd?: string; reason?: string; toolName?: string; toolCallId?: string }) => Promise<boolean>;
    onProgress?: (event: { type: string; [key: string]: any }) => void;
}

export interface CleanSlateReadFileState {
    path: string;
    uri: string;
    content?: string;
    currentVersionId?: number;
    mtime?: number;
    totalLines?: number;
    isPartialView: boolean;
    readAt: number;
    ranges?: CleanSlateReadRangeEvidence[];
}

export interface CleanSlateReadRangeEvidence {
    startLine: number;
    endLine: number;
    content: string;
    currentVersionId?: number;
    mtime?: number;
    readAt: number;
}

/**
 * Core tool interface for CleanSlate agent capabilities
 */
export interface CleanSlateTool {
    name: string;
    description: string;
    parametersSchema?: Record<string, any>;
    planningHint?: string;
    category?: string;
    run(input: any, context: CleanSlateToolContext): Promise<any>;
}
