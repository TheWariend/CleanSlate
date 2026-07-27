/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';

/* Neutralized by CleanSlate */

export class ChatExtensionPointHandler implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.chatExtensionPointHandler';
	constructor() {}
}

export class ChatCompatibilityNotifier extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.chatCompatNotifier';
	constructor() {
		super();
	}
}


