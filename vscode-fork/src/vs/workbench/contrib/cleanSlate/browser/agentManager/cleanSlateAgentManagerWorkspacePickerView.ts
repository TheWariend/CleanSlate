/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { localize } from '../../../../../nls.js';
import { CleanSlateAgentManagerProjectProvider } from './cleanSlateAgentManagerProjectProvider.js';
import type { ICleanSlateWorkspaceEntry } from './cleanSlateAgentManagerTypes.js';

export interface ICleanSlateAgentManagerWorkspacePickerOptions {
	readonly targetWindow: Window;
	readonly root: HTMLElement;
	readonly anchor: HTMLElement;
	readonly entries: readonly ICleanSlateWorkspaceEntry[];
	readonly selectedEntry: ICleanSlateWorkspaceEntry;
	readonly projectProvider: CleanSlateAgentManagerProjectProvider;
	readonly onSelectWorkspace: (entry: ICleanSlateWorkspaceEntry) => void;
	readonly onAddProject: () => void;
}

export class CleanSlateAgentManagerWorkspacePickerView extends Disposable {

	private picker: HTMLElement | undefined;
	private readonly pickerDisposables = this._register(new DisposableStore());

	show(options: ICleanSlateAgentManagerWorkspacePickerOptions): void {
		this.hide();
		const selectedId = options.projectProvider.getWorkspaceEntryKey(options.selectedEntry);
		const picker = dom.append(options.root, dom.$('.cleanSlate-agent-manager-workspace-picker'));
		this.picker = picker;
		const search = dom.append(picker, dom.$('.cleanSlate-agent-manager-workspace-picker-search'));
		dom.append(search, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.search)}`));
		const input = dom.append(search, dom.$('input')) as HTMLInputElement;
		input.placeholder = localize('cleanSlate.agentManager.searchProjects', 'Search projects');
		const list = dom.append(picker, dom.$('.cleanSlate-agent-manager-workspace-picker-list'));
		const render = (): void => {
			dom.clearNode(list);
			const filter = input.value.trim().toLowerCase();
			const visibleEntries = options.entries.filter(entry => options.projectProvider.containsFilter(filter, entry.label, entry.description));
			if (!visibleEntries.length) {
				dom.append(list, dom.$('.cleanSlate-agent-manager-workspace-picker-empty')).textContent = localize('cleanSlate.agentManager.noProjectsFound', 'No projects found');
				return;
			}
			for (const entry of visibleEntries) {
				this.renderEntry(list, entry, selectedId, options);
			}
		};
		render();

		const actions = dom.append(picker, dom.$('.cleanSlate-agent-manager-workspace-picker-actions'));
		const addProject = dom.append(actions, dom.$('button.cleanSlate-agent-manager-workspace-picker-action')) as HTMLButtonElement;
		addProject.type = 'button';
		dom.append(addProject, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.newFolder)}.workspace-picker-icon`));
		dom.append(addProject, dom.$('span.workspace-picker-title')).textContent = localize('cleanSlate.agentManager.addNewProject', 'Add new project');
		dom.append(addProject, dom.$(`span${ThemeIcon.asCSSSelector(Codicon.chevronRight)}.workspace-picker-check`));
		addProject.onclick = options.onAddProject;

		this.position(options.root, options.anchor, picker);
		this.pickerDisposables.add(dom.addDisposableListener(input, 'input', () => render()));
		this.pickerDisposables.add(dom.addDisposableListener(options.targetWindow, 'mousedown', event => {
			const target = event.target as Node | null;
			if (target && (picker.contains(target) || options.anchor.contains(target))) {
				return;
			}
			this.hide();
		}));
		this.pickerDisposables.add(dom.addDisposableListener(options.targetWindow, 'keydown', event => {
			if ((event as KeyboardEvent).key === 'Escape') {
				this.hide();
			}
		}));
		options.targetWindow.requestAnimationFrame(() => input.focus());
	}

	hide(): void {
		this.pickerDisposables.clear();
		this.picker?.remove();
		this.picker = undefined;
	}

	private renderEntry(
		list: HTMLElement,
		entry: ICleanSlateWorkspaceEntry,
		selectedId: string,
		options: ICleanSlateAgentManagerWorkspacePickerOptions
	): void {
		const selected = options.projectProvider.getWorkspaceEntryKey(entry) === selectedId;
		const item = dom.append(list, dom.$('button.cleanSlate-agent-manager-workspace-picker-item')) as HTMLButtonElement;
		item.type = 'button';
		item.classList.toggle('active', selected);
		item.title = entry.description ?? entry.label;
		dom.append(item, dom.$(`span${ThemeIcon.asCSSSelector(entry.current ? Codicon.repo : Codicon.folder)}.workspace-picker-icon`));
		const copy = dom.append(item, dom.$('.workspace-picker-copy'));
		dom.append(copy, dom.$('.workspace-picker-title')).textContent = entry.label;
		if (entry.description && entry.description !== entry.label) {
			dom.append(copy, dom.$('.workspace-picker-description')).textContent = entry.description;
		}
		dom.append(item, dom.$(`span${ThemeIcon.asCSSSelector(selected ? Codicon.check : Codicon.blank)}.workspace-picker-check`));
		item.onclick = () => {
			this.hide();
			options.onSelectWorkspace(entry);
		};
	}

	private position(root: HTMLElement, anchor: HTMLElement, picker: HTMLElement): void {
		const rootRect = root.getBoundingClientRect();
		const anchorRect = anchor.getBoundingClientRect();
		const edgePadding = 8;
		const width = Math.min(320, Math.max(260, rootRect.width - edgePadding * 2));
		picker.style.width = `${width}px`;
		const pickerRect = picker.getBoundingClientRect();
		let left = anchorRect.left - rootRect.left;
		let top = anchorRect.bottom - rootRect.top + 6;
		if (top + pickerRect.height > rootRect.height - edgePadding) {
			top = anchorRect.top - rootRect.top - pickerRect.height - 6;
		}
		left = Math.max(edgePadding, Math.min(left, rootRect.width - pickerRect.width - edgePadding));
		top = Math.max(edgePadding, Math.min(top, rootRect.height - pickerRect.height - edgePadding));
		picker.style.left = `${left}px`;
		picker.style.top = `${top}px`;
	}
}
