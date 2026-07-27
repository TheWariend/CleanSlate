/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ICleanSlateBrowserAnnotation } from '../core/cleanSlateBrowserAutomationService.js';

export const enum CleanSlateBrowserAnnotationProvenance {
	ProjectPreview = 'project_preview',
	ExternalReference = 'external_reference'
}

export function classifyBrowserAnnotationProvenance(url: string | undefined): CleanSlateBrowserAnnotationProvenance {
	if (!url) {
		return CleanSlateBrowserAnnotationProvenance.ExternalReference;
	}

	try {
		const parsed = new URL(url);
		const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
		if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(hostname)) {
			return CleanSlateBrowserAnnotationProvenance.ProjectPreview;
		}
	} catch {
		// An unparseable URL cannot be safely associated with the active workspace.
	}

	return CleanSlateBrowserAnnotationProvenance.ExternalReference;
}

function singleLine(value: unknown): string {
	return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function buildBrowserAnnotationRoutingContext(annotations: readonly ICleanSlateBrowserAnnotation[]): string {
	if (annotations.length === 0) {
		return '';
	}

	const lines = annotations.slice(0, 20).map((annotation, index) => [
		`@${index + 1}`,
		`provenance=${classifyBrowserAnnotationProvenance(annotation.url)}`,
		`url=${singleLine(annotation.url)}`,
		`comment=${singleLine(annotation.text) || 'none'}`
	].join(' | '));

	return `[BROWSER ANNOTATION ROUTING CONTEXT]\n${lines.join('\n')}`;
}

export function buildBrowserAnnotationTaskContext(annotations: readonly ICleanSlateBrowserAnnotation[]): string {
	if (annotations.length === 0) {
		return '';
	}

	const lines = annotations.slice(0, 20).map((annotation, index) => {
		const location = [
			annotation.selector ? `selector=${singleLine(annotation.selector)}` : '',
			typeof annotation.x === 'number' && typeof annotation.y === 'number' ? `viewport=(${Math.round(annotation.x)},${Math.round(annotation.y)})` : '',
			typeof annotation.pageX === 'number' && typeof annotation.pageY === 'number' ? `page=(${Math.round(annotation.pageX)},${Math.round(annotation.pageY)})` : ''
		].filter(Boolean).join('; ');
		return [
			`@${index + 1} id=${singleLine(annotation.id)}`,
			`provenance=${classifyBrowserAnnotationProvenance(annotation.url)}`,
			`USER_COMMENT="${singleLine(annotation.text) || 'No comment supplied'}"`,
			`url=${singleLine(annotation.url)}`,
			annotation.title ? `title=${singleLine(annotation.title)}` : '',
			`element=<${singleLine(annotation.tagName) || 'unknown'}> ${singleLine(annotation.label || annotation.elementText)}`.trim(),
			location,
			annotation.elementText ? `selectedText="${singleLine(annotation.elementText)}"` : ''
		].filter(Boolean).join(' | ');
	});

	return `\n\n[BROWSER ANNOTATIONS - ACTIVE TASK CONTEXT]\nAnnotations with provenance=project_preview may describe the active project's running UI. Annotations with provenance=external_reference are examples or evidence from a site outside the active project; they are not, by themselves, authorization to edit the workspace or proof of an implementation target. Use the user's current message and USER_COMMENT to determine intent. If an external reference is present and the requested workspace change is not clear, call ask_question and generate a task-specific question and options from the annotation and project context. Do not invent a target, silently ignore the annotation, or use canned wording. If the user explicitly asks to apply the reference to the active project, implement it there.\n${lines.join('\n')}`;
}
