/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Slash command definitions
 */
export const SLASH_COMMANDS: Record<string, { instruction: string; defaultMessage: string }> = {
    '/fix': {
        instruction: '\nTASK: Fix bugs, errors, and potential issues in the selected code. Identify root causes, not just symptoms. Provide minimal, precise edits.\n',
        defaultMessage: 'Fix the selected code.'
    },
    '/explain': {
        instruction: '\nTASK: Explain this to me.\n',
        defaultMessage: 'Explain the selected code.'
    },
    '/test': {
        instruction: '\nTASK: Write comprehensive unit tests for the selected code. Cover happy paths, edge cases, and error conditions. Use the existing test framework detected in the project.\n',
        defaultMessage: 'Write unit tests for the selected code.'
    },
    '/rewrite': {
        instruction: '\nTASK: Rewrite the code for better readability and performance. Preserve all existing behavior. Follow the project\'s existing style and patterns.\n',
        defaultMessage: 'Rewrite the selected code.'
    },
    '/doc': {
        instruction: '\nTASK: Add comprehensive documentation to the selected code. Write JSDoc/Docstring comments for all public functions, classes, and interfaces. Explain parameters, return values, and thrown exceptions.\n',
        defaultMessage: 'Add documentation to the selected code.'
    },
    '/review': {
        instruction: '\nTASK: Perform a thorough code review of the selected code. Identify: (1) bugs and logic errors, (2) security vulnerabilities, (3) performance issues, (4) code style violations, (5) missing edge case handling. Be specific and actionable.\n',
        defaultMessage: 'Review the selected code for bugs, security, and quality issues.'
    },
    '/optimize': {
        instruction: '\nTASK: Optimize the selected code for performance. Profile the logic mentally, identify bottlenecks (N+1 queries, unnecessary re-renders, expensive loops), and apply targeted optimizations without changing behavior.\n',
        defaultMessage: 'Optimize the selected code for performance.'
    },
    '/scaffold': {
        instruction: '\nTASK: Scaffold a complete implementation based on the user\'s description. First list the root directory to understand the project structure. Then create all necessary files following the existing architecture patterns. Wire everything together (routes, exports, imports, navigation).\n',
        defaultMessage: 'Scaffold a complete implementation following the project architecture.'
    },
    '/migrate': {
        instruction: '\nTASK: Migrate the selected code to the specified target (new framework, language version, library, or pattern). Preserve semantics exactly. Flag any breaking changes or manual steps required after the migration.\n',
        defaultMessage: 'Migrate the selected code to the specified target.'
    }
};
