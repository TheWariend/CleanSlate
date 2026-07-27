/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

type CleanSlateMochaCallback = (this: unknown) => void | Promise<void>;
type CleanSlateMochaNamedCallback = (name: string, callback: CleanSlateMochaCallback) => void;

declare const suite: CleanSlateMochaNamedCallback;
declare const test: CleanSlateMochaNamedCallback;
declare const setup: (callback: CleanSlateMochaCallback) => void;
declare const teardown: (callback: CleanSlateMochaCallback) => void;
declare const suiteSetup: (callback: CleanSlateMochaCallback) => void;
declare const suiteTeardown: (callback: CleanSlateMochaCallback) => void;
