/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CleanSlateTool, CleanSlateToolContext } from './types.js';
import { readFileTool } from './ReadFileTool.js';
import { readFileRangeTool } from './ReadFileRangeTool.js';
import { semanticSearchTool } from './SemanticSearchTool.js';
import { searchCodebaseTool } from './SearchCodebaseTool.js';
import { findByNameTool } from './FindByNameTool.js';
import { grepSearchTool } from './GrepSearchTool.js';
import { searchWorkspaceTool } from './SearchWorkspaceTool.js';
import { executeCommandTool, readBackgroundCommandTool, startBackgroundCommandTool, stopBackgroundCommandTool } from './ExecuteCommandTool.js';
import { applyEditTool } from './ApplyEditTool.js';
import { listDirTool } from './ListDirTool.js';
import { getOpenFilesTool } from './GetOpenFilesTool.js';
import { writeFileTool } from './WriteFileTool.js';
import { createMultipleFilesTool } from './CreateMultipleFilesTool.js';
import { multiFileReplaceTool } from './MultiFileReplaceTool.js';
import { updateTodoTool } from './UpdateTodoTool.js';
import { submitArtifactTool } from './SubmitArtifactTool.js';
import { preparePullRequestTool } from './PreparePullRequestTool.js';
import { askQuestionTool } from './AskQuestionTool.js';
import { spawnWorkerTool } from './SpawnWorkerTool.js';
import { readReferenceTool } from './ReadReferenceTool.js';
import { readLintsTool } from './ReadLintsTool.js';
import { readSymbolsTool } from './ReadSymbolsTool.js';
import { getDefinitionsTool } from './GetDefinitionsTool.js';
import { findReferencesTool } from './FindReferencesTool.js';
import { undoEditTool } from './UndoEditTool.js';
import { fileHistoryRewindTool } from './FileHistoryRewindTool.js';
import { mcpCallTool, mcpListToolsTool } from './MCPTools.js';
import { listSkillsTool } from './SkillTools.js';
import { webFetchTool, webSearchTool } from './WebRetrievalTools.js';
import {
    browserClickTool,
    browserCheckTool,
    browserClipboardTool,
    browserCloseTabTool,
    browserClearAnnotationsTool,
    browserDeleteAnnotationTool,
    browserDiagnosticsTool,
    browserDialogTool,
    browserFillTool,
    browserGetUrlTool,
    browserHoverTool,
    browserKeyTool,
    browserListAnnotationsTool,
    browserNewTabTool,
    browserOpenTool,
    browserScreenshotTool,
    browserScrollTool,
    browserSelectTool,
    browserSelectTabTool,
    browserSnapshotTool,
    browserStartAnnotationTool,
    browserStopAnnotationTool,
    browserTabsTool,
    browserTypeTool,
    browserUploadTool,
    browserWaitTool
} from './BrowserAutomationTools.js';

export const ALL_TOOLS: CleanSlateTool[] = [
    readFileTool,
    readFileRangeTool,
    semanticSearchTool,
    searchWorkspaceTool,
    searchCodebaseTool,
    applyEditTool,
    multiFileReplaceTool,
    getOpenFilesTool,
    writeFileTool,
    createMultipleFilesTool,
    findByNameTool,
    grepSearchTool,
    executeCommandTool,
    startBackgroundCommandTool,
    readBackgroundCommandTool,
    stopBackgroundCommandTool,
    webSearchTool,
    webFetchTool,
    browserOpenTool,
    browserGetUrlTool,
    browserTabsTool,
    browserNewTabTool,
    browserSelectTabTool,
    browserCloseTabTool,
    browserWaitTool,
    browserSnapshotTool,
    browserClickTool,
    browserClipboardTool,
    browserHoverTool,
    browserFillTool,
    browserCheckTool,
    browserSelectTool,
    browserUploadTool,
    browserTypeTool,
    browserKeyTool,
    browserScrollTool,
    browserScreenshotTool,
    browserDiagnosticsTool,
    browserDialogTool,
    browserStartAnnotationTool,
    browserStopAnnotationTool,
    browserListAnnotationsTool,
    browserDeleteAnnotationTool,
    browserClearAnnotationsTool,
    listDirTool,
    spawnWorkerTool,
    listSkillsTool,
    mcpListToolsTool,
    mcpCallTool,
    readReferenceTool,
    updateTodoTool,
    askQuestionTool,
    preparePullRequestTool,
    submitArtifactTool,
    readLintsTool,
    readSymbolsTool,
    getDefinitionsTool,
    findReferencesTool,
    undoEditTool,
    fileHistoryRewindTool
];

export function getToolByName(name: string): CleanSlateTool | undefined {
    return ALL_TOOLS.find(tool => tool.name === name);
}

export async function executeTool(toolName: string, input: any, context: CleanSlateToolContext): Promise<any> {
    const tool = getToolByName(toolName);
    if (!tool) throw new Error(`Tool "${toolName}" not found.`);
    return await tool.run(input, context);
}
