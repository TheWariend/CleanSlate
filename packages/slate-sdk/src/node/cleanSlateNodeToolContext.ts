/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { URI } from '../core/uri.js';
import { IWorkspaceFolder } from '../host/workspace.js';
import { CleanSlateNodeFileService, CleanSlateNodeModelService, CleanSlateNodeTextFileService } from './cleanSlateNodeFileServices.js';
import { CleanSlateNodeCommandService } from './cleanSlateNodeCommandService.js';

/**
 * A single-folder workspace rooted at the directory the run was pointed at.
 * `getWorkspaceFolder` doubles as the containment check the tools use to refuse
 * paths outside the repository, so it returns undefined rather than clamping.
 */
export class CleanSlateNodeWorkspaceService {

	private readonly folder: { uri: URI; name: string; index: number; toResource: (relative: string) => URI };

	constructor(rootPath: string) {
		const root = URI.file(path.resolve(rootPath));
		this.folder = {
			uri: root,
			name: path.basename(root.fsPath),
			index: 0,
			toResource: (relative: string) => URI.file(path.resolve(root.fsPath, relative))
		};
	}

	getWorkspace(): { folders: IWorkspaceFolder[] } {
		return { folders: [this.folder] };
	}

	getWorkspaceFolder(resource: URI): IWorkspaceFolder | undefined {
		const root = this.folder.uri.fsPath;
		const target = resource.fsPath;
		const relative = path.relative(root, target);
		const inside = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
		return inside ? this.folder : undefined;
	}
}

export interface ICleanSlateNodeRuntimeOptions {
	/** Directory the agent may read and write. */
	rootPath: string;
	/** Provider settings, returned verbatim by `configService.getConfiguration`. */
	configuration: Record<string, any>;
	/**
	 * Decides whether a command may run. Defaults to refusing everything, so a
	 * host that forgets to supply a policy fails safe rather than executing
	 * whatever the model asks for.
	 */
	approveCommand?: (request: { command: string; cwd?: string; reason?: string }) => Promise<boolean>;
	onProgress?: (event: { type: string;[key: string]: any }) => void;
}

/**
 * Assembles the tool context for a headless run.
 *
 * Members that only exist to move the editor's UI — revealing a file,
 * decorating a diff, opening an editor — are present but inert. The tools
 * already treat them as optional or ignore their return, so a run behaves the
 * same minus the visuals.
 */
export function createCleanSlateNodeToolContext(options: ICleanSlateNodeRuntimeOptions): any {
	const fileService = new CleanSlateNodeFileService();
	const textFileService = new CleanSlateNodeTextFileService(fileService);
	const modelService = new CleanSlateNodeModelService(textFileService);
	const workspaceContextService = new CleanSlateNodeWorkspaceService(options.rootPath);
	const commandExecutionService = new CleanSlateNodeCommandService(path.resolve(options.rootPath));

	const noEditorOpen = {
		getActiveCodeEditor: () => null,
		openCodeEditor: async () => null
	};

	return {
		surface: 'headless',
		fileService,
		textFileService,
		modelService,
		workspaceContextService,
		commandExecutionService,
		codeEditorService: noEditorOpen,
		configService: {
			getConfiguration: () => options.configuration,
			getResolvedConfiguration: async () => options.configuration
		},
		// No language server headlessly, so nothing reports markers. Diagnostics
		// come from running the project's own compiler or linter as a command.
		markerService: {
			read: () => [],
			onMarkerChanged: () => ({ dispose: () => { } })
		},
		editorService: {
			activeEditor: undefined,
			visibleEditors: [],
			getEditors: () => [],
			openEditor: async () => undefined,
			closeEditor: async () => undefined
		},
		instantiationService: {
			createInstance: (Ctor: any, ...args: any[]) => new Ctor(...args)
		},
		artifactService: {
			getArtifact: async () => undefined,
			setArtifact: async () => undefined
		},
		contextService: {
			getContext: async () => ({ activeFile: undefined, openFiles: [] })
		},
		indexService: {
			search: async () => [],
			isIndexing: () => false
		},
		requestCommandApproval: options.approveCommand
			?? (async () => false),
		onProgress: options.onProgress,
		recentFocusLines: new Map(),
		readFileState: new Map()
	};
}
