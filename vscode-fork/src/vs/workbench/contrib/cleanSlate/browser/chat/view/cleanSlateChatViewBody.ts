/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../base/browser/dom.js';
import { CleanSlateTranscriptRenderer } from '../renderers/cleanSlateTranscriptRenderer.js';
import { ensureCleanSlateChatStyles } from '../styles/cleanSlateChatStyles.js';
import { CleanSlateComposerView, ICleanSlateComposerViewOptions } from './sections/cleanSlateComposerView.js';
import { CleanSlateTranscriptView } from './sections/cleanSlateTranscriptView.js';

/** The editor chat presentation, independent of its conversation/runtime provider. */
export class CleanSlateChatViewBody {
	readonly element: HTMLElement;
	readonly transcript: CleanSlateTranscriptView;

	constructor(parent: HTMLElement, renderer: CleanSlateTranscriptRenderer, onPlanningQuestion: ConstructorParameters<typeof CleanSlateTranscriptView>[2]) {
		this.element = dom.append(parent, dom.$('.cleanSlate-chat-view'));
		this.element.style.cssText = 'height:100%;width:100%;min-width:0;min-height:0;display:flex;flex-direction:column;';
		ensureCleanSlateChatStyles(this.element);
		this.transcript = new CleanSlateTranscriptView(this.element, renderer, onPlanningQuestion);
	}

	createComposer(options: Omit<ICleanSlateComposerViewOptions, 'compact'>): CleanSlateComposerView {
		return new CleanSlateComposerView(this.element, options);
	}
}
