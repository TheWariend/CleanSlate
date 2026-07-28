/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../core/uri.js';
import { CLEANSLATE_ARTIFACT_SCHEME } from '../protocol/cleanSlateAI.js';
import { ACTIVE_GROUP } from '../host/workspace.js';
import { CleanSlateTool, CleanSlateToolContext } from './types.js';
import { getVirtualArtifactType, isSessionWorkspaceOpenInIde } from './utils.js';

/**
 * Tool: submit_artifact
 */
const runSubmitArtifact = async (input: { summary: string; path?: string; content?: string; artifactType?: 'implementation_plan' | 'analysis' | 'walkthrough' }, context: CleanSlateToolContext): Promise<any> => {
    const { summary, path, content, artifactType } = input;

    // 1. If content is provided, we are DRAFTING or UPDATING the artifact
    if (typeof content === 'string' && content.trim().length > 0) {
        const type = artifactType || (path ? getVirtualArtifactType(path) : 'implementation_plan');
        
        // Safety: Only allow planning-related artifacts in this flow
        if (type !== 'implementation_plan' && type !== 'analysis' && type !== 'walkthrough') {
            return {
                success: false,
                code: 'invalid_artifact_type',
                message: `submit_artifact content drafting is only supported for 'implementation_plan', 'analysis', or 'walkthrough'. Found: ${type}`
            };
        }

        const filename = path || getDefaultArtifactFilename(type);
        const artifact = context.artifactService.saveArtifact(type, content, { filename, sessionId: context.sessionId, surface: context.surface });
        // Only open the artifact in the IDE editor when the session's project matches the project the
        // IDE currently has open. A cross-project Agent Manager session still saves the artifact (and
        // shows it in its own right pane); it just must not leak into the other project's editor.
        if (isSessionWorkspaceOpenInIde(context)) {
            await openArtifactEditor(context, artifact.id, filename, context.surface === 'agentManager');
        }

        return {
            success: true,
            path: filename,
            summary,
            message: `Artifact '${filename}' drafted and submitted for review.`
        };
    }

    // 2. Legacy/Finalize Flow: Submit based on existing latest artifact
    const requestedType = typeof path === 'string' ? getVirtualArtifactType(path) : undefined;
    const latestPlan = context.artifactService.getLatestArtifactByType('implementation_plan', { sessionId: context.sessionId });
    const latestAnalysis = context.artifactService.getLatestArtifactByType('analysis', { sessionId: context.sessionId });

    let selectedArtifact = undefined as typeof latestPlan | typeof latestAnalysis;
    let selectedType: 'implementation_plan' | 'analysis' | undefined;

    if (requestedType === 'implementation_plan' || requestedType === 'analysis') {
        selectedType = requestedType;
        selectedArtifact = requestedType === 'implementation_plan' ? latestPlan : latestAnalysis;
    } else {
        if (latestPlan) {
            selectedType = 'implementation_plan';
            selectedArtifact = latestPlan;
        } else if (latestAnalysis) {
            selectedType = 'analysis';
            selectedArtifact = latestAnalysis;
        }
    }

    if (!selectedArtifact || !selectedType) {
        return {
            success: false,
            code: 'missing_planning_artifact',
            message: 'submit_artifact requires either a "content" parameter to draft a new plan, or an existing planning artifact in the session.'
        };
    }

    const cleanSummary = typeof summary === 'string' ? summary.trim() : '';
    if (!cleanSummary) {
        return {
            success: false,
            code: 'missing_handoff_summary',
            message: 'submit_artifact requires a short task-specific summary for the visible plan handoff.'
        };
    }

    return {
        success: true,
        path: typeof path === 'string' && path.trim().length > 0 ? path : (selectedType === 'analysis' ? 'analysis.md' : 'implementation_plan.md'),
        summary: cleanSummary
    };
};

async function openArtifactEditor(context: CleanSlateToolContext, artifactId: string, filename: string, preserveFocus: boolean): Promise<void> {
    if (!context.instantiationService || !context.editorService) {
        return;
    }

    const virtualUri = URI.from({
        scheme: CLEANSLATE_ARTIFACT_SCHEME,
        path: `/plans/${artifactId}/${filename}`
    });

    // Presenting the artifact is the host's call: the IDE opens a dedicated
    // editor input, a terminal prints the path. The tool only needs it shown.
    if (!context.artifactPresentationHost) {
        return;
    }
    try {
        await context.artifactPresentationHost.openArtifact(virtualUri, artifactId, { preserveFocus });
    } catch (e) {
        console.error('[SubmitArtifactTool] Failed to present artifact:', e);
    }
}

function getDefaultArtifactFilename(type: 'implementation_plan' | 'analysis' | 'walkthrough'): string {
    if (type === 'analysis') {
        return 'analysis.md';
    }
    if (type === 'walkthrough') {
        return 'walkthrough.md';
    }
    return 'implementation_plan.md';
}

export const submitArtifactTool: CleanSlateTool = {
    name: 'submit_artifact',
    description: 'Submits a planning artifact for user review. For implementation_plan, content must be the concise final plan only—not research notes, deliberation, progress narration, or a files-inspected inventory. Use analysis only when the user explicitly requested a separate analysis artifact. Summary is the concise user handoff.',
    parametersSchema: {
        summary: 'string (required) - Short first-person handoff summary, e.g. "I\'ve drafted the dark-mode plan."',
        content: 'string (optional) - Final markdown plan or analysis. Plans should be compact, implementation-ready, and contain no research transcript.',
        path: 'string (optional) - The filename (e.g. implementation_plan.md).',
        artifactType: 'string (optional) - One of: implementation_plan, analysis, walkthrough.'
    },
    category: 'system',
    run: runSubmitArtifact
};
