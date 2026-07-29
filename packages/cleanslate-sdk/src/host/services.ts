/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Slate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../core/uri.js';
import { IRange } from '../core/range.js';
import { ISlateTextModel } from './textModel.js';
import type * as TreeSitter from '@vscode/tree-sitter-wasm';

/**
 * The remaining host capabilities: constructing host-owned objects, language
 * intelligence, syntax parsing, HTTP, and presenting an artifact.
 *
 * Each is optional. A host that cannot provide one leaves it undefined and the
 * tools that need it report the capability as unavailable, rather than the
 * runtime failing to start.
 */

/**
 * Constructing objects the host owns.
 *
 * Upstream this is the DI container, and `IInstantiationService` doubles as a
 * decorator. The runtime uses one method, so it is reduced to that — the SDK
 * builds without `experimentalDecorators` and does not participate in DI.
 */
export interface IInstantiationHost {
	createInstance<T>(descriptor: unknown, ...args: unknown[]): T;
}

//#region language intelligence

export interface ILocation {
	uri: URI;
	range: IRange;
}

export interface IDocumentSymbol {
	name: string;
	detail?: string;
	kind: number;
	range: IRange;
	selectionRange: IRange;
	children?: IDocumentSymbol[];
}

/** A registry of providers for one language feature. */
export interface ILanguageFeatureRegistry<T> {
	ordered(model: ISlateTextModel): T[];
	all?(model: ISlateTextModel): T[];
	has?(model: ISlateTextModel): boolean;
}

export interface IDefinitionProvider {
	provideDefinition(model: ISlateTextModel, position: unknown, token: unknown): ILocation | ILocation[] | null | undefined | PromiseLike<ILocation | ILocation[] | null | undefined>;
}

export interface IReferenceProvider {
	provideReferences(model: ISlateTextModel, position: unknown, context: unknown, token: unknown): ILocation[] | null | undefined | PromiseLike<ILocation[] | null | undefined>;
}

export interface IDocumentSymbolProvider {
	provideDocumentSymbols(model: ISlateTextModel, token: unknown): IDocumentSymbol[] | null | undefined | PromiseLike<IDocumentSymbol[] | null | undefined>;
}

/**
 * Go-to-definition, find-references and outline. Backed by the editor's
 * language features in the IDE, and by a language server or nothing headless.
 */
export interface ILanguageFeaturesHost {
	definitionProvider: ILanguageFeatureRegistry<IDefinitionProvider>;
	referenceProvider: ILanguageFeatureRegistry<IReferenceProvider>;
	documentSymbolProvider: ILanguageFeatureRegistry<IDocumentSymbolProvider>;
}

//#endregion

/**
 * Tree-sitter grammars, for structural code queries.
 *
 * Typed against `@vscode/tree-sitter-wasm`, which the SDK depends on directly:
 * the symbol index and the structural edit resolver construct parsers, so the
 * constructor has to be a real type rather than `unknown`. A host that cannot
 * supply grammars leaves the capability off.
 */
export interface ITreeSitterHost {
	getParserClass(): Promise<{ new(): TreeSitter.Parser }>;
	getLanguagePromise(languageId: string): Promise<TreeSitter.Language | undefined> | undefined;
}

//#region http

export interface IHeaders {
	[header: string]: string | string[] | undefined;
}

export interface IRequestOptions {
	type?: string;
	url?: string;
	user?: string;
	password?: string;
	headers?: IHeaders;
	timeout?: number;
	data?: string;
	followRedirects?: number;
	proxyAuthorization?: string;
}

export interface IRequestContext {
	res: { headers: IHeaders; statusCode?: number };
	stream: unknown;
}

//#endregion

/**
 * Showing a generated artifact to the user.
 *
 * In the IDE this opens a dedicated editor input; a terminal host writes the
 * path, and a server host returns a link. The tool only needs the artifact to
 * become visible somehow, so the host decides what that means.
 */
export interface IArtifactPresentationHost {
	openArtifact(resource: URI, artifactId: string, options?: { preserveFocus?: boolean }): Promise<void>;
}
