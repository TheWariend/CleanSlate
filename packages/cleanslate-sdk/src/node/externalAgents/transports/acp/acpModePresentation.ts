/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ExternalApprovalPresentation } from '../../../../externalAgents/externalAgentTypes.js';

/** Optional extension metadata is a presentation hint, never an authorization decision. */
export function readApprovalPresentation(metadata: Record<string, unknown> | null | undefined): ExternalApprovalPresentation | undefined {
	switch (metadata?.kind) {
		case 'standard': case 'ask': return 'approval-required';
		case 'auto_review': return 'automatic-review';
		case 'full_access': return 'unrestricted';
		default: return undefined;
	}
}
