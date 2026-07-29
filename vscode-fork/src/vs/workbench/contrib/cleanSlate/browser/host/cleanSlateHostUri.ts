/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI, UriComponents } from '../../../../../base/common/uri.js';

/**
 * Rebuilds a URI as the workbench's own `URI`.
 *
 * The runtime carries a vendored copy of `URI` — identical code, different
 * class. Most of the workbench compares URIs with `URI.isUri`, which is
 * duck-typed and accepts either, but a handful of places use a bare
 * `instanceof URI`: `ITextEditorService.createTextEditor` throws outright when
 * it fails, and the language-feature commands assert on it. Anything that
 * *keeps* a URI — a text file model, an editor input, an undo-redo element —
 * therefore has to be handed one built on this side.
 *
 * `URI.revive` returns the argument untouched when it is already ours, so this
 * costs nothing on the paths that never touch the runtime.
 */
export function reviveHostUri(resource: URI | UriComponents): URI {
	return URI.revive(resource);
}
