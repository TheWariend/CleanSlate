/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'istanbul-to-vscode' {
	import * as vscode from 'vscode';

	export class IstanbulCoverageContext {
		apply(
			run: vscode.TestRun,
			coverageDir: string,
			options: {
				mapFileUri(uri: vscode.Uri): vscode.Uri | undefined | Thenable<vscode.Uri | undefined>;
				mapLocation(uri: vscode.Uri, position: vscode.Position): vscode.Location | undefined | Thenable<vscode.Location | undefined>;
			}
		): Thenable<void>;
	}
}

declare module 'cockatiel' {
	export function bulkhead<T = unknown>(concurrency: number, queue: number): {
		execute<R>(task: () => Promise<R>): Promise<R>;
	};
}
