/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../base/browser/dom.js';
import { localize } from '../../../../../../nls.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { ICleanSlateBrowserAutomationService, type CleanSlateBrowserSurface, type ICleanSlateBrowserAnnotation } from '../../core/cleanSlateBrowserAutomationService.js';
import { CleanSlateComposerView } from '../view/sections/cleanSlateComposerView.js';

export class CleanSlateAnnotationController {
	private refreshHandle: number | undefined;

	constructor(
		private readonly browserAutomationService: ICleanSlateBrowserAutomationService,
		private readonly notificationService: INotificationService,
		private readonly getComposerView: () => CleanSlateComposerView | undefined,
		private readonly onDidChange: () => void,
		private readonly browserSurface: CleanSlateBrowserSurface | (() => CleanSlateBrowserSurface) = 'ide'
	) { }

	dispose(container: HTMLElement | undefined): void {
		if (this.refreshHandle !== undefined && container) {
			dom.getWindow(container).clearInterval(this.refreshHandle);
			this.refreshHandle = undefined;
		}
	}

	update(annotations: readonly ICleanSlateBrowserAnnotation[]): void {
		this.getComposerView()?.updateAnnotationReferences(annotations);
		this.onDidChange();
	}

	start(container: HTMLElement): void {
		if (this.refreshHandle !== undefined) {
			return;
		}

		const win = dom.getWindow(container);
		this.refreshHandle = win.setInterval(() => {
			void this.browserAutomationService.refreshVisibleAnnotations(this.getBrowserSurface())
				.then(annotations => this.update(annotations))
				.catch(() => undefined);
		}, 1500);
	}

	async deleteVisible(annotations: readonly ICleanSlateBrowserAnnotation[]): Promise<void> {
		if (annotations.length === 0) {
			return;
		}

		try {
			const surface = this.getBrowserSurface();
			if (annotations.length === this.browserAutomationService.listCachedAnnotations(surface).length) {
				await this.browserAutomationService.clearAnnotations(surface);
				this.update([]);
				return;
			}

			for (const annotation of annotations) {
				await this.browserAutomationService.deleteAnnotation(surface, annotation.id);
			}
			this.update(this.browserAutomationService.listCachedAnnotations(surface));
		} catch (error) {
			this.notificationService.error(localize('cleanSlate.deleteAnnotationFailed', 'Failed to delete browser annotation: {0}', String(error)));
		}
	}

	private getBrowserSurface(): CleanSlateBrowserSurface {
		return typeof this.browserSurface === 'function' ? this.browserSurface() : this.browserSurface;
	}
}
