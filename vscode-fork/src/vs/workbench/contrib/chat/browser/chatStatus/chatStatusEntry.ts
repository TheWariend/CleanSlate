/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/chatStatus.css';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { IStatusbarEntryAccessor } from '../../../../services/statusbar/browser/statusbar.js';

export class ChatStatusBarEntry extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.chatStatusBarEntry';

	private entry: IStatusbarEntryAccessor | undefined = undefined;

	constructor() {
		super();
	}




	override dispose(): void {
		super.dispose();

		this.entry?.dispose();
		this.entry = undefined;
	}
}
