/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Slate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../core/uri.js';

/**
 * Diagnostics as the runtime consumes them.
 *
 * `MarkerSeverity` is declared here rather than imported from the editor for
 * two reasons: upstream it is a plain `enum` whose companion namespace routes
 * `toString` through `vs/nls`, and the values are a bit mask that callers
 * combine (`Error | Warning`), so they have to be real runtime values.
 *
 * The severity names are deliberately not localized. They are fed to a model as
 * part of a tool result, not shown to a person, so they must stay stable
 * regardless of the host's display language.
 */
export enum MarkerSeverity {
	Hint = 1,
	Info = 2,
	Warning = 4,
	Error = 8
}

export namespace MarkerSeverity {

	/** Sorts more severe first, matching upstream. */
	export function compare(a: MarkerSeverity, b: MarkerSeverity): number {
		return b - a;
	}

	export function toString(severity: MarkerSeverity): string {
		switch (severity) {
			case MarkerSeverity.Error: return 'Error';
			case MarkerSeverity.Warning: return 'Warning';
			case MarkerSeverity.Info: return 'Info';
			case MarkerSeverity.Hint: return 'Hint';
			default: return '';
		}
	}
}

/** One diagnostic on a resource. */
export interface IMarker {
	owner: string;
	resource: URI;
	severity: MarkerSeverity;
	code?: string | { value: string; target: URI };
	message: string;
	source?: string;
	startLineNumber: number;
	startColumn: number;
	endLineNumber: number;
	endColumn: number;
	relatedInformation?: readonly IRelatedInformation[];
}

export interface IRelatedInformation {
	resource: URI;
	message: string;
	startLineNumber: number;
	startColumn: number;
	endLineNumber: number;
	endColumn: number;
}

export interface IMarkerReadFilter {
	owner?: string;
	resource?: URI;
	severities?: number;
	take?: number;
}

/**
 * The host's diagnostic store. The editor's marker service satisfies this as
 * written; a headless host can back it with a language server, a compiler, or
 * nothing at all.
 */
export interface IMarkerHost {
	read(filter?: IMarkerReadFilter): IMarker[];
	/** Fires when diagnostics for any resource change. */
	onMarkerChanged(listener: (resources: readonly URI[]) => void): { dispose(): void };
}
