/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import {
	CleanSlateCommandExecutionService as CleanSlateCommandExecutionServiceBase,
	ICleanSlateCommandExecutionService as ICleanSlateCommandExecutionServiceShape
} from '@cleanslate/sdk/services/cleanSlateCommandExecutionService.js';
import { ICleanSlateMainService } from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';

/**
 * Command execution, wired for the workbench.
 *
 * The implementation is the SDK's — it only forwards to the main service. What
 * stays here is the injection: the service identifier and the decorator that
 * hands the main service to the constructor. See `cleanSlateAI.ts` for why the
 * identifiers cannot live in the SDK.
 */

export interface ICleanSlateCommandExecutionService extends ICleanSlateCommandExecutionServiceShape { }
export const ICleanSlateCommandExecutionService = createDecorator<ICleanSlateCommandExecutionService>('cleanSlateCommandExecutionService');

export class CleanSlateCommandExecutionService extends CleanSlateCommandExecutionServiceBase {

	constructor(
		@ICleanSlateMainService mainService: ICleanSlateMainService
	) {
		super(mainService);
	}
}
