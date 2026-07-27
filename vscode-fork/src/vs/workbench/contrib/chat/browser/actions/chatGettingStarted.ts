/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';

export class ChatGettingStartedContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.chatGettingStarted';

	constructor() {
		super();
		// CleanSlate: Neutralized proprietary chat getting started logic
	}
}
