/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Shared semantic colors; resolve again automatically whenever the workbench theme changes. */
export const CLEANSLATE_THEME_STYLES = `
	.monaco-workbench {
		--cleanSlate-surface: var(--vscode-editorWidget-background, var(--vscode-editor-background));
		--cleanSlate-border: var(--vscode-contrastBorder, var(--vscode-widget-border, var(--vscode-panel-border, color-mix(in srgb, var(--vscode-foreground) 18%, transparent))));
		--cleanSlate-subtle-background: var(--vscode-toolbar-hoverBackground, color-mix(in srgb, var(--vscode-foreground) 6%, transparent));
		--cleanSlate-muted: var(--vscode-descriptionForeground, var(--vscode-foreground));
		--cleanSlate-success: var(--vscode-testing-iconPassed, var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-foreground)));
		--cleanSlate-warning: var(--vscode-editorWarning-foreground, var(--vscode-inputValidation-warningBorder, var(--vscode-foreground)));
		--cleanSlate-error: var(--vscode-errorForeground, var(--vscode-editorError-foreground, var(--vscode-foreground)));
		--cleanSlate-info: var(--vscode-editorInfo-foreground, var(--vscode-textLink-foreground, var(--vscode-foreground)));
		--cleanSlate-terminal-background: var(--vscode-terminal-background, var(--vscode-editor-background));
		--cleanSlate-terminal-foreground: var(--vscode-terminal-foreground, var(--vscode-editor-foreground, var(--vscode-foreground)));
	}

	:is(.cleanSlate-chat-view, .cleanSlate-agent-manager-surface, .cleanSlate-settings-panel-shell, .cleanSlate-browser-import-dialog, .cleanSlate-artifact-editor)
		:is(button, [role="button"], a, summary, input, select, textarea:not(.cleanSlate-chat-input), [tabindex]):focus-visible {
		outline: 2px solid var(--vscode-focusBorder) !important;
		outline-offset: -2px;
	}

	.cleanSlate-input-box:focus-within {
		border-color: var(--vscode-focusBorder) !important;
	}

	:is(.hc-black, .hc-light) {
		--cleanSlate-muted: var(--vscode-foreground);
		--cleanSlate-subtle-background: var(--vscode-editor-background);
	}

	:is(.hc-black, .hc-light) :is(.cleanSlate-chat-view, .cleanSlate-agent-manager-surface, .cleanSlate-settings-panel-shell, .cleanSlate-browser-import-dialog, .cleanSlate-artifact-editor)
		:is(button, [role="button"], input, select, textarea:not(.cleanSlate-chat-input)) {
		outline: 1px solid var(--vscode-contrastBorder, var(--vscode-foreground));
		outline-offset: -1px;
	}

	:is(.hc-black, .hc-light) :is(.cleanSlate-command-approval, .cleanSlate-plan-approval, .cleanSlate-planning-question, .cleanSlate-input-box, .cleanSlate-history-overlay, .cleanSlate-agent-popup) {
		border: 1px solid var(--vscode-contrastBorder, var(--vscode-foreground));
		box-shadow: none;
	}

	:is(.hc-black, .hc-light) :is(.cleanSlate-settings-panel-shell, .cleanSlate-settings-shell) {
		--cs-border: var(--vscode-contrastBorder, var(--vscode-foreground));
		--cs-border-soft: var(--cs-border);
	}

	:is(.hc-black, .hc-light) .cleanSlate-browser-import-dialog {
		--import-line: var(--vscode-contrastBorder, var(--vscode-foreground));
	}

	:is(.hc-black, .hc-light) .cleanSlate-action-button:disabled {
		opacity: 1;
		color: var(--vscode-disabledForeground);
	}

	:is(.hc-black, .hc-light) :is(.cleanSlate-chat-view, .cleanSlate-agent-manager-surface, .cleanSlate-settings-panel-shell)
		:is([aria-pressed="true"], [aria-selected="true"]) {
		outline: 1px solid var(--vscode-contrastActiveBorder, var(--vscode-focusBorder));
		outline-offset: -1px;
	}
`;
