import { ITextModel } from '../../../../../editor/common/model.js';
import { IMarkerService, MarkerSeverity } from '../../../../../platform/markers/common/markers.js';

export interface ValidationResult {
    isValid: boolean;
    issues: string[];
}

export class CleanSlateGuardrails {

    /**
     * Validates a file using VS Code's native IMarkerService (Language Server Protocol).
     * This detects actual syntax errors, type errors, and compiler warnings reported by installed extensions.
     */
    public static validate(model: ITextModel, markerService: IMarkerService): ValidationResult {
        const issues: string[] = [];

        // 1. Query IMarkerService for markers on this resource
        // We focus on Errors and Warnings.
        const markers = markerService.read({ resource: model.uri, severities: MarkerSeverity.Error | MarkerSeverity.Warning });

        for (const marker of markers) {
            // Format the error message to be helpful for the AI
            // e.g. "Line 10: [Error] The name 'main' is already defined."
            const type = marker.severity === MarkerSeverity.Error ? 'Error' : 'Warning';
            issues.push(`Line ${marker.startLineNumber}: [${type}] ${marker.message}`);
        }

        // 2. Keep the basic "Git Conflict" check as a fallback (since LSP might choke on them silently)
        const content = model.getValue();
        if (content.includes('<<<<<<<') || content.includes('=======')) {
            const conflictRegex = /^(<<<<<<<|=======|>>>>>>>)/m;
            if (conflictRegex.test(content)) {
                issues.push('CRITICAL: Leftover Git conflict markers detected. The code may be corrupt.');
            }
        }

        return {
            isValid: issues.length === 0,
            issues
        };
    }
}
