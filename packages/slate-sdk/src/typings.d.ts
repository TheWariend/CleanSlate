/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Slate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The vendored modules refer to a bare `Timeout` type, which VS Code declares
 * globally in `typings/base-common.d.ts`. There it is an opaque handle, to stop
 * timer handles being used as numbers in code that also targets the browser.
 *
 * The SDK is Node-only, so it is aliased to whatever `setTimeout` actually
 * returns here. That keeps the vendored files compiling unmodified and keeps
 * the handles assignable back to `clearTimeout`.
 */
type Timeout = ReturnType<typeof setTimeout>;
