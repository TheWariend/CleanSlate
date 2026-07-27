/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IModelService } from '../../../../../editor/common/services/model.js';
import { ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ICleanSlateIndexService, ICleanSlateConfigurationService, ICleanSlateContextService, ICleanSlateArtifactService, IMCPClientService, ICleanSlateMainService } from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { ICleanSlateCommandExecutionService } from '../core/cleanSlateCommandExecutionService.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IMarkerService } from '../../../../../platform/markers/common/markers.js';
import { ICleanSlateBulkEditHost, ICleanSlateEditorDecorationHost, ICleanSlateEditorRevealHost } from './cleanSlateHostTypes.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { ISearchService } from '../../../../services/search/common/search.js';
import { ILanguageFeaturesService } from '../../../../../editor/common/services/languageFeatures.js';
import { IUndoRedoService } from '../../../../../platform/undoRedo/common/undoRedo.js';
import { ITreeSitterLibraryService } from '../../../../../editor/common/services/treeSitter/treeSitterLibraryService.js';
import { IEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ICleanSlateBrowserAutomationService } from '../core/cleanSlateBrowserAutomationService.js';

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
    modelService: IModelService;
    codeEditorService: ICleanSlateEditorRevealHost;
    textFileService: ITextFileService;
    fileService: IFileService;
    contextService: ICleanSlateContextService;
    indexService: ICleanSlateIndexService;
    workspaceContextService: IWorkspaceContextService;
    /**
     * The IDE's currently-open workspace (distinct from `workspaceContextService`, which for an
     * Agent Manager session is scoped to that session's own project). Used to decide whether a
     * file/artifact belongs to the same project the IDE has open before revealing it in the editor.
     * Defaults to `workspaceContextService` for the IDE surface, where the two are equivalent.
     */
    ideWorkspaceContextService?: IWorkspaceContextService;
    configService: ICleanSlateConfigurationService;
    markerService: IMarkerService;
    artifactService: ICleanSlateArtifactService;
    mcpClientService?: IMCPClientService;
    cleanSlateMainService?: ICleanSlateMainService;
    instantiationService: IInstantiationService;
    editorService: IEditorService;
    commandExecutionService: ICleanSlateCommandExecutionService;
    browserAutomationService: ICleanSlateBrowserAutomationService;
    bulkEditService?: ICleanSlateBulkEditHost;
    /** Inline diff decorations. Absent when nothing is on screen to decorate. */
    editorDecorationHost?: ICleanSlateEditorDecorationHost;
    searchService?: ISearchService;
    languageFeaturesService?: ILanguageFeaturesService;
    undoRedoService?: IUndoRedoService;
    treeSitterLibraryService?: ITreeSitterLibraryService;
    environmentService?: IEnvironmentService;
    commandService?: ICommandService;
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
