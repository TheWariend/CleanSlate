/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Slate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../core/uri.js';
import { IRange } from '../core/range.js';

/**
 * Symbol kinds, as a real enum.
 *
 * Upstream this is a `const enum`, which the compiler inlines at each use site.
 * That works inside a single program but not across a package boundary under
 * `isolatedModules`, where the declaration has to survive to runtime. The
 * values match `vs/editor/common/languages` exactly, because hosts hand them
 * across as numbers.
 */
export enum SymbolKind {
	File = 0,
	Module = 1,
	Namespace = 2,
	Package = 3,
	Class = 4,
	Method = 5,
	Property = 6,
	Field = 7,
	Constructor = 8,
	Enum = 9,
	Interface = 10,
	Function = 11,
	Variable = 12,
	Constant = 13,
	String = 14,
	Number = 15,
	Boolean = 16,
	Array = 17,
	Object = 18,
	Key = 19,
	Null = 20,
	EnumMember = 21,
	Struct = 22,
	Event = 23,
	Operator = 24,
	TypeParameter = 25
}

/** A place in a document. */
export interface Location {
	uri: URI;
	range: IRange;
}
