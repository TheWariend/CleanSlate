/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const EXECUTION_MODIFY_PHASE_OBJECTIVE_PROMPT = 'Implement the approved implementation plan in full.';

export const EXECUTION_PHASE_OBJECTIVE_RULES = [
    'Continue from the native conversation and use the existing context while it remains current.',
	'Use tool calls to do the work. Do not emit a status line merely because another model turn started.',
    'Keep progress text for material findings or blockers. Write the final user-facing answer as normal assistant text.',
    'Implement touched logic completely; never insert placeholder code in an edited region.',
    'Never edit workspace source files through execute_command (python heredocs, sed -i, output redirection). Use apply_edit or multi_file_replace for localized changes and write_file for new files or intentional whole-file replacements. If an edit is rejected, follow its recovery hint — do not fall back to the shell.',
    'Use diagnostics and targeted verification appropriate to the requested outcome before making verification claims.'
];

export const WEB_RESEARCH_PHASE_OBJECTIVE_RULES = [
    'When the user request depends on public web or current external information, use web_search for discovery, then web_fetch the relevant reliable pages before answering or handing off.',
    'Treat web_search results as leads, not final evidence. Cite fetched page URLs naturally when relying on web evidence.'
];

export const WEB_RESEARCH_FINAL_ANSWER_RULES = [
    'For broad requests like "search web about X", produce a useful research brief rather than a tiny recap.',
    'Lead with the direct answer, then cover the important source-backed facts, current focus, notable context, and caveats or source disagreements when they matter.',
    'Scale depth to the request: broad topics need enough synthesis that the user does not have to open every source; narrow questions should stay focused but still complete.',
    'Use short plain-text labels and compact paragraphs when they improve scanning. Do not use Markdown headings, bold markers, markdown links, fenced blocks, or list-marker formatting in visible chat text.',
    'Cite the fetched pages you relied on with natural source URLs. Do not cite search-result snippets as evidence.'
];

export const APPROVED_IMPLEMENTATION_PLAN_LABEL = 'Approved Implementation Plan:';
export const ORIGINAL_OBJECTIVE_LABEL = 'Original Objective:';
export const EXECUTION_SUMMARY_LABEL = 'Execution Summary:';
export const CONTINUATION_CONTEXT_LABEL = 'Continuation Context:';
export const KNOWN_DISCOVERED_PATHS_LABEL = 'Known Discovered Paths';
export const KNOWN_SEMANTIC_HIGHLIGHTS_LABEL = 'Known Semantic Hotspots';
