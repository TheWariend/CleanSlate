/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IInstantiationService, ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IWorkspaceTrustEnablementService, IWorkspaceTrustManagementService, IWorkspaceTrustRequestService } from '../../../../../platform/workspace/common/workspaceTrust.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../common/contributions.js';
import { showCleanSlateChatImport } from './cleanSlateChatImport.js';
import { localize } from '../../../../../nls.js';

// Share the prompt across Agent Manager and the IDE for this window. Serializing
// requests also keeps a fast project switch from stacking trust/import dialogs.
export const CLEANSLATE_PROJECT_IMPORT_PROMPT_KEY = 'cleanSlate.project.importPromptShown.';
export const CLEANSLATE_PROJECT_TRUST_KEY = 'cleanSlate.project.trustConfirmed.';
let pending: Promise<unknown> = Promise.resolve();

export function prepareCleanSlateProject(accessor: ServicesAccessor, uri: URI, currentWorkspace = false, trustJustConfirmed = false): Promise<boolean> {
	const trust = accessor.get(IWorkspaceTrustManagementService);
	const enablement = accessor.get(IWorkspaceTrustEnablementService);
	const requests = accessor.get(IWorkspaceTrustRequestService);
	const dialogs = accessor.get(IDialogService);
	const notifications = accessor.get(INotificationService);
	const instantiation = accessor.get(IInstantiationService);
	const storage = accessor.get(IStorageService);
	const operation = pending.then(async () => {
		await trust.workspaceTrustInitialized;
		const trustKey = CLEANSLATE_PROJECT_TRUST_KEY + uri.toString();
		let explicitlyTrusted = trustJustConfirmed || storage.getBoolean(trustKey, StorageScope.PROFILE, false);
		if (enablement.isWorkspaceTrustEnabled()) {
			const requestWouldPrompt = currentWorkspace
				? !trust.isWorkspaceTrusted()
				: !(await trust.getUriTrustInfo(uri)).trusted;
			const trusted = currentWorkspace
				? await requests.requestWorkspaceTrust()
				: await requests.requestResourcesTrust({ uri });
			if (!trusted) { return false; }
			explicitlyTrusted ||= requestWouldPrompt;
		}
		// VS Code grants trust recursively. A trusted home/parent folder must not
		// silently skip CleanSlate's first-use confirmation for a different project.
		if (uri.scheme === 'file' && !explicitlyTrusted) {
			const { confirmed } = await dialogs.confirm({
				type: 'warning',
				message: localize('cleanSlate.project.trustFolder', 'Do you trust the files in {0}?', basename(uri)),
				detail: localize('cleanSlate.project.trustFolderDetail', 'CleanSlate agents can read and edit files and run commands in this project. Continue only if you trust its contents.\n\n{0}', uri.fsPath),
				primaryButton: localize('cleanSlate.project.trustFolderContinue', 'Trust Folder & Continue'),
				cancelButton: localize('cleanSlate.project.trustFolderCancel', 'Cancel')
			});
			if (!confirmed) { return false; }
			explicitlyTrusted = true;
		}
		if (uri.scheme === 'file' && explicitlyTrusted) { storage.store(trustKey, true, StorageScope.PROFILE, StorageTarget.MACHINE); }
		const promptKey = CLEANSLATE_PROJECT_IMPORT_PROMPT_KEY + uri.toString();
		if (uri.scheme !== 'file' || storage.getBoolean(promptKey, StorageScope.PROFILE, false)) { return true; }
		const { confirmed } = await dialogs.confirm({
			type: 'info',
			message: `Import threads for ${basename(uri)}?`,
			detail: `Bring existing Claude and Codex conversations for this project into CleanSlate. You can choose an account folder and select which threads to import.\n\n${uri.fsPath}`,
			primaryButton: 'Import threads',
			cancelButton: 'Not now'
		});
		storage.store(promptKey, true, StorageScope.PROFILE, StorageTarget.MACHINE);
		if (confirmed) { await instantiation.invokeFunction(showCleanSlateChatImport, uri.fsPath); }
		return true;
	}).catch(error => {
		notifications.error(error instanceof Error ? error.message : String(error));
		return false;
	});
	pending = operation;
	return operation;
}

class CleanSlateProjectOpenContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cleanSlateProjectOpen';
	constructor(
		@IWorkspaceContextService workspace: IWorkspaceContextService,
		@IInstantiationService instantiation: IInstantiationService,
		@IWorkspaceTrustManagementService trust: IWorkspaceTrustManagementService,
		@IWorkspaceTrustEnablementService enablement: IWorkspaceTrustEnablementService
	) {
		super();
		const open = (uri: URI, trustJustConfirmed = false) => instantiation.invokeFunction(prepareCleanSlateProject, uri, true, trustJustConfirmed);
		// The IDE already presents its startup trust dialog. Wait for its result
		// instead of presenting a second request after the user declines it.
		const openTrustedWorkspace = (trustJustConfirmed = false) => {
			if (enablement.isWorkspaceTrustEnabled() && !trust.isWorkspaceTrusted()) { return; }
			for (const folder of workspace.getWorkspace().folders) { void open(folder.uri, trustJustConfirmed); }
		};
		void trust.workspaceTrustInitialized.then(() => openTrustedWorkspace());
		this._register(trust.onDidChangeTrust(trusted => { if (trusted) { openTrustedWorkspace(true); } }));
		this._register(workspace.onDidChangeWorkspaceFolders(event => {
			if (enablement.isWorkspaceTrustEnabled() && !trust.isWorkspaceTrusted()) { return; }
			for (const folder of event.added) { void open(folder.uri); }
		}));
	}
}

registerWorkbenchContribution2(CleanSlateProjectOpenContribution.ID, CleanSlateProjectOpenContribution, WorkbenchPhase.AfterRestored);
