/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';

export interface ICleanSlateActionButtonOptions {
	readonly label: string;
	readonly action?: () => void | Promise<void>;
	readonly variant: 'primary' | 'secondary';
	readonly leadingIcon?: string;
	readonly trailingIcon?: string;
	readonly afterAction?: () => void | Promise<void>;
}

export const CLEANSLATE_ACTION_BUTTON_STYLES = `
	.cleanSlate-action-button { display:inline-flex; align-items:center; justify-content:center; gap:4px; padding:3px 6px; font:inherit; font-size:12px; line-height:16px; cursor:pointer; white-space:nowrap; transition:background .12s ease, border-color .12s ease, opacity .12s ease; }
	.cleanSlate-action-button .codicon { font-size:14px; }
	.cleanSlate-action-button:disabled { opacity:.5; cursor:default; }
	.cleanSlate-action-button.secondary { border:1px solid color-mix(in srgb, var(--vscode-foreground) 16%, transparent); border-radius:6px; background:transparent; color:var(--vscode-foreground); }
	.cleanSlate-action-button.secondary:hover:not(:disabled) { background:color-mix(in srgb, var(--vscode-foreground) 6%, transparent); }
	.cleanSlate-action-button.secondary .codicon { color:var(--vscode-descriptionForeground); }
	.cleanSlate-action-button.primary { border:0; border-radius:5px; background:var(--vscode-button-background); color:var(--vscode-button-foreground); }
	.cleanSlate-action-button.primary:hover:not(:disabled) { background:var(--vscode-button-hoverBackground, var(--vscode-button-background)); }
	.cleanSlate-action-button.primary .codicon { color:var(--vscode-button-foreground); }
`;

export function createCleanSlateActionButton(parent: HTMLElement, options: ICleanSlateActionButtonOptions): HTMLButtonElement {
	const button = dom.append(parent, dom.$(`button.cleanSlate-action-button.${options.variant}`)) as HTMLButtonElement;
	button.type = 'button';
	if (options.leadingIcon) {
		dom.append(button, dom.$(`span.codicon.codicon-${options.leadingIcon}`));
	}
	dom.append(button, dom.$('span')).textContent = options.label;
	if (options.trailingIcon) {
		dom.append(button, dom.$(`span.codicon.codicon-${options.trailingIcon}`));
	}
	button.disabled = !options.action;
	button.onclick = async () => {
		if (!options.action) {
			return;
		}
		button.disabled = true;
		try {
			await options.action();
			await options.afterAction?.();
		} finally {
			button.disabled = !options.action;
		}
	};
	return button;
}
