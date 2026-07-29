/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CleanSlateService as CleanSlateServiceBase } from '@cleanslate/sdk/protocol/cleanSlateService.js';
import { ICleanSlateConfigurationService, ICleanSlateLogger, ICleanSlateMainService, ICleanSlateService } from './cleanSlateAI.js';

/**
 * The provider bridge, wired for the workbench.
 *
 * The SDK's `CleanSlateService` takes its three collaborators as ordinary
 * constructor arguments, because a terminal front-end hands them over directly.
 * All this subclass adds is the injection: the decorators tell the workbench's
 * container which singletons to pass.
 */
export class CleanSlateService extends CleanSlateServiceBase implements ICleanSlateService {

	constructor(
		@ICleanSlateConfigurationService configService: ICleanSlateConfigurationService,
		@ICleanSlateMainService cleanSlateMainService: ICleanSlateMainService,
		@ICleanSlateLogger logger: ICleanSlateLogger
	) {
		super(configService, cleanSlateMainService, logger);
	}
}
