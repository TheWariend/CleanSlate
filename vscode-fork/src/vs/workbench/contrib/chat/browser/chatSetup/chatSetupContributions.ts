/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class ChatSetupContribution {
	static readonly ID = 'workbench.contrib.chatSetup';
	constructor() {}
}

export class ChatTeardownContribution {
	static readonly ID = 'workbench.contrib.chatTeardown';
	constructor() {}
}

export function refreshTokens(): void {
}
