/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export async function resolve(specifier, context, nextResolve) {
	if (specifier.endsWith('.css')) {
		return {
			url: new URL(specifier, context.parentURL).href,
			shortCircuit: true
		};
	}
	return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
	if (url.endsWith('.css')) {
		return {
			format: 'module',
			source: 'export default undefined;',
			shortCircuit: true
		};
	}
	return nextLoad(url, context);
}
