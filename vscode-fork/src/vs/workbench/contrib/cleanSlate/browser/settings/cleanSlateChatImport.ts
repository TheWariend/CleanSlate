/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action2, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { basename } from '../../../../../base/common/path.js';
import { localize2 } from '../../../../../nls.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IProgressService, ProgressLocation } from '../../../../../platform/progress/common/progress.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { ICleanSlateMainService } from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import type { IExternalAgentHistoryQuery } from '../../../../services/cleanSlate/common/externalAgents/externalAgentTypes.js';

export const CLEANSLATE_IMPORT_CHATS_COMMAND = 'cleanSlate.importAgentChats';

export async function showCleanSlateChatImport(accessor: ServicesAccessor, projectRoot?: string): Promise<void> {
	const main = accessor.get(ICleanSlateMainService);
	const quickInput = accessor.get(IQuickInputService);
	const files = accessor.get(IFileDialogService);
	const notifications = accessor.get(INotificationService);
	const progressService = accessor.get(IProgressService);
	try {
		const choice = await quickInput.pick([
			{ label: 'Claude and Codex', description: 'Find chats in the default account folders', source: undefined, custom: false },
			{ label: 'Claude', description: 'Find chats in your Claude account folder automatically', source: 'claude' as const, custom: false },
			{ label: 'Codex', description: 'Find chats in your Codex account folder automatically', source: 'codex' as const, custom: false },
			{ label: 'Claude — choose another account folder…', description: 'Choose a custom .claude data folder', source: 'claude' as const, custom: true },
			{ label: 'Codex — choose another account folder…', description: 'Choose a custom .codex data folder', source: 'codex' as const, custom: true }
		], { title: 'Import agent chats', placeHolder: 'Imported chats continue with their original agent. You can hand off later.' });
		if (!choice) { return; }
		let query: IExternalAgentHistoryQuery = { source: choice.source, projectRoot };
		if (choice.custom) {
			const selected = await files.showOpenDialog({ title: `Choose ${choice.source === 'claude' ? 'Claude' : 'Codex'} data folder`, canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Find chats' });
			if (!selected?.[0]) { return; }
			if (selected[0].scheme !== 'file') { throw new Error('Choose a local agent data folder.'); }
			query = { source: choice.source, dataHome: selected[0].fsPath, projectRoot };
		}
		const [discovered, existing] = await progressService.withProgress({ location: ProgressLocation.Notification, title: 'Finding agent chats…' }, () => Promise.all([
			main.discoverExternalAgentHistory(query), main.listThreadSessions()
		]));
		const importedIds = new Set(existing.map(session => session.id));
		if (discovered.warnings.length) { notifications.warn(discovered.warnings.slice(0, 3).join('\n')); }
		const available = discovered.sessions.filter(entry => !importedIds.has(entry.id));
		if (!available.length) { notifications.info(discovered.sessions.length ? 'All chats in this folder have already been imported.' : 'No local Claude or Codex chats were found in this folder.'); return; }
		const selected = await quickInput.pick(available.map(entry => ({
			label: entry.title, description: entry.source === 'claude' ? 'Claude' : 'Codex',
			detail: `${entry.cwd ? basename(entry.cwd) : 'No project'} · ${new Date(entry.updatedAt).toLocaleDateString()}`, entry
		})), { title: 'Select chats to import', placeHolder: 'Search chats', canPickMany: true, matchOnDescription: true, matchOnDetail: true });
		if (!selected?.length) { return; }
		let imported = 0, skipped = 0;
		const errors: string[] = [];
		const warnings: string[] = [];
		let cancelled = false;
		await progressService.withProgress({ location: ProgressLocation.Notification, title: 'Importing agent chats', cancellable: true }, async progress => {
			for (let index = 0; index < selected.length; index++) {
				if (cancelled) { break; }
				const entry = selected[index].entry;
				progress.report({ message: `${index + 1} of ${selected.length}: ${entry.title}`, increment: 100 / selected.length });
				try {
					const result = await main.importExternalAgentHistory(entry);
					if (result.imported) { imported++; } else { skipped++; }
					warnings.push(...result.warnings);
				} catch (error) { errors.push(`${entry.title}: ${error instanceof Error ? error.message : String(error)}`); }
			}
		}, () => { cancelled = true; });
		const message = `Imported ${imported} chat${imported === 1 ? '' : 's'}.${skipped ? ` ${skipped} already imported.` : ''} Open them in Agent Manager; use the agent picker to hand off.`;
		if (errors.length || warnings.length) { notifications.warn(`${message}\n${errors.length ? `${errors.length} could not be imported.\n` : ''}${[...errors, ...new Set(warnings)].slice(0, 3).join('\n')}`); }
		else { notifications.info(message); }
	} catch (error) { notifications.error(error instanceof Error ? error.message : String(error)); }
}

registerAction2(class extends Action2 {
	constructor() { super({ id: CLEANSLATE_IMPORT_CHATS_COMMAND, title: localize2('cleanSlate.importAgentChats', 'CleanSlate: Import Claude and Codex Chats'), f1: true }); }
	run(accessor: ServicesAccessor): Promise<void> { return showCleanSlateChatImport(accessor); }
});
