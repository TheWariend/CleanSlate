/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CleanSlateFileHistory } from '../services/cleanSlateFileHistory.js';
import { CleanSlateTool, CleanSlateToolContext } from './types.js';
import { PathOutsideWorkspaceError, buildPathOutsideWorkspaceResult, resolvePathToUriForMutationAsync } from './utils.js';
import { URI } from '../core/uri.js';

export const fileHistoryRewindTool: CleanSlateTool = {
	name: 'file_history_rewind',
	description: 'Restore a file from the hidden CleanSlate file history snapshot captured immediately before an agent edit. Input: { path?: string, historyEntryId?: string }.',
	category: 'edit',
	parametersSchema: {
		path: 'string - Optional file path to rewind. If omitted, historyEntryId must be provided.',
		historyEntryId: 'string - Optional exact CleanSlate file history entry id to restore.'
	},
	async run(input: { path?: string; historyEntryId?: string }, context: CleanSlateToolContext): Promise<any> {
		if (!input.path && !input.historyEntryId) {
			throw new Error('file_history_rewind requires either "path" or "historyEntryId".');
		}

		let resource: URI | undefined;
		if (input.path) {
			try {
				resource = await resolvePathToUriForMutationAsync(input.path, context);
			} catch (error) {
				if (error instanceof PathOutsideWorkspaceError) {
					return buildPathOutsideWorkspaceResult(input.path, error);
				}
				throw error;
			}
		}
		const workspaceRoot = resource
			? context.workspaceContextService.getWorkspaceFolder(resource)?.uri
			: context.workspaceContextService.getWorkspace().folders[0]?.uri;
		const workspaceId = context.workspaceContextService.getWorkspace().id;
		const storageRoot = context.environmentService ? URI.joinPath(context.environmentService.workspaceStorageHome, workspaceId) : undefined;
		const result = await CleanSlateFileHistory.rewind({
			workspaceRoot,
			storageRoot,
			resource,
			historyEntryId: input.historyEntryId,
			fileService: context.fileService,
			modelService: context.modelService,
			textFileService: context.textFileService
		});

		return {
			success: result.success,
			path: resource?.fsPath ?? result.entry?.path,
			historyEntryId: result.entry?.id,
			message: result.message
		};
	}
};
