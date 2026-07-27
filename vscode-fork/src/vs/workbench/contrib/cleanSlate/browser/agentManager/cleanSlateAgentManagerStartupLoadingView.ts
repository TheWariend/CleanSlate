/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';

export class CleanSlateAgentManagerStartupLoadingView {

	show(root: HTMLElement, overlay: HTMLElement): void {
		root.classList.add('is-startup-loading');
		// Keep the surface blank while project/session state hydrates. Showing an
		// animated loader here creates another visible flash during fast switches.
		dom.clearNode(overlay);
		overlay.classList.remove('visible');
	}

	hide(root: HTMLElement | undefined, overlay: HTMLElement | undefined): void {
		root?.classList.remove('is-startup-loading');
		overlay?.classList.remove('visible');
	}

}
