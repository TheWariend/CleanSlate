/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CleanSlateTool, CleanSlateToolContext } from './types.js';
import type { CleanSlateBrowserSurface, ICleanSlateBrowserLocator, ICleanSlateBrowserTarget, ICleanSlateBrowserWaitOptions } from '../host/browserAutomation.js';

const browserOperationLocks = new Map<CleanSlateBrowserSurface, Promise<void>>();
const browserLocatorProperties = {
	elementId: { type: 'string', description: 'Stable element id from the latest browser_snapshot.' },
	selector: { type: 'string', description: 'CSS selector.' },
	testId: { type: 'string', description: 'data-testid, data-test, or data-cy value.' },
	role: { type: 'string', description: 'Accessible or implicit role, such as button, link, textbox, or checkbox.' },
	name: { type: 'string', description: 'Accessible name.' },
	label: { type: 'string', description: 'Associated form label text.' },
	placeholder: { type: 'string', description: 'Input placeholder text.' },
	text: { type: 'string', description: 'Visible element text.' },
	exact: { type: 'boolean', description: 'Require an exact text/name match instead of a case-insensitive substring match.' },
	nth: { type: 'number', description: 'Zero-based match index. Omit it to require a unique match.' }
} as const;

export const browserOpenTool: CleanSlateTool = {
	name: 'browser_open',
	description: 'Opens or reuses one CleanSlate integrated browser editor tab for a concrete URL. For localhost web UI validation, prefer the URL returned by start_background_command/read_background_command; explicit localhost URLs still open directly. Do not guess localhost ports or use about:blank.',
	category: 'browser',
	parametersSchema: {
		type: 'object',
		properties: {
			url: {
				type: 'string',
				description: 'Concrete URL to open. Non-local URLs open directly. Localhost URLs are resolved to a managed dev-server URL when available, otherwise the explicit requested URL opens directly. about:blank is invalid.'
			}
		},
		required: ['url']
	},
	async run(input: { url?: string }, context: CleanSlateToolContext): Promise<any> {
		const url = input.url?.trim();
		if (!url) {
			return { success: false, error: 'browser_open requires a URL.' };
		}
		if (isBlankBrowserUrl(url)) {
			return {
				success: false,
				error: 'browser_open requires a real URL, not about:blank. Start or read the dev server first, then open the reported Local/Network URL.'
			};
		}
		const localhostResolution = await resolveManagedLocalhostUrl(url, context);
		const resolvedUrl = localhostResolution?.url ?? url;
		const warning = localhostResolution?.warning;
		try {
			const state = await openBrowserForSurface(resolvedUrl, context);
			if (resolvedUrl === url) {
				return warning ? { ...state, warning } : state;
			}
			return { ...state, requestedUrl: url, resolvedUrl, ...(warning ? { warning } : {}) };
		} catch (error) {
			const retryUrl = await resolveLocalhostRetryUrl(resolvedUrl, context);
			if (retryUrl) {
				try {
					const state = await openBrowserForSurface(retryUrl, context);
					return {
						...state,
						requestedUrl: url,
						retriedUrl: retryUrl,
						retryReason: getErrorMessage(error)
					};
				} catch (retryError) {
					return {
						success: false,
						url: retryUrl,
						requestedUrl: url,
						error: `Failed to open ${url}; retry with ${retryUrl} also failed: ${getErrorMessage(retryError)}`
					};
				}
			}
			return {
				success: false,
				url: resolvedUrl,
				requestedUrl: resolvedUrl === url ? undefined : url,
				error: getErrorMessage(error)
			};
		}
	}
};

function openBrowserForSurface(url: string, context: CleanSlateToolContext): Promise<any> {
	return runBrowserOperation(context, async surface => {
		if (isAgentManagerBrowserSurface(surface)) {
			return context.browserAutomationService.openInAgentManager(url, surface);
		}
		return context.browserAutomationService.open(url);
	});
}

function browserSurfaceForContext(context: CleanSlateToolContext): CleanSlateBrowserSurface {
	return context.surface === 'agentManager' && context.sessionId ? `agentManager:${context.sessionId}` : context.surface === 'agentManager' ? 'agentManager' : 'ide';
}

function isAgentManagerBrowserSurface(surface: CleanSlateBrowserSurface): boolean {
	return surface === 'agentManager' || surface.startsWith('agentManager:');
}

async function runBrowserOperation<T>(context: CleanSlateToolContext, operation: (surface: CleanSlateBrowserSurface) => Promise<T>): Promise<T> {
	const surface = browserSurfaceForContext(context);
	const previous = browserOperationLocks.get(surface) ?? Promise.resolve();
	let release: () => void = () => undefined;
	const current = new Promise<void>(resolve => { release = resolve; });
	const queued = previous.then(() => current, () => current);
	browserOperationLocks.set(surface, queued);
	await previous.catch(() => undefined);
	try {
		return await operation(surface);
	} finally {
		release();
		if (browserOperationLocks.get(surface) === queued) {
			browserOperationLocks.delete(surface);
		}
	}
}

function isBlankBrowserUrl(url: string): boolean {
	return url.trim().toLowerCase() === 'about:blank';
}

async function resolveManagedLocalhostUrl(requestedUrl: string, context: CleanSlateToolContext): Promise<{ url?: string; warning?: string } | undefined> {
	const requested = parseUrl(requestedUrl);
	if (!requested || !isLocalhostHost(requested.hostname)) {
		return undefined;
	}

	const candidate = await latestManagedLocalhostUrl(context);
	if (!candidate) {
		return {
			url: requested.toString(),
			warning: 'No managed dev-server URL was found; opening the explicit localhost URL as requested.'
		};
	}
	if (candidate.origin === requested.origin) {
		return { url: requested.toString() };
	}

	candidate.pathname = requested.pathname;
	candidate.search = requested.search;
	candidate.hash = requested.hash;
	return { url: candidate.toString() };
}

async function resolveLocalhostRetryUrl(requestedUrl: string, context: CleanSlateToolContext): Promise<string | undefined> {
	const requested = parseUrl(requestedUrl);
	if (!requested || !isLocalhostHost(requested.hostname)) {
		return undefined;
	}

	const candidate = await latestManagedLocalhostUrl(context);
	if (!candidate || candidate.origin === requested.origin) {
		return undefined;
	}

	candidate.pathname = requested.pathname;
	candidate.search = requested.search;
	candidate.hash = requested.hash;
	return candidate.toString();
}

async function latestManagedLocalhostUrl(context: CleanSlateToolContext): Promise<URL | undefined> {
	const commands = filterBackgroundCommandsForContext(await context.commandExecutionService.listBackgroundCommands().catch(() => []), context);
	for (let index = commands.length - 1; index >= 0; index--) {
		const command = commands[index];
		if (!command || command.success === false || command.status === 'failed' || command.status === 'exited') {
			continue;
		}

		const candidate = latestLocalhostUrlFromText(command.output)
			?? latestLocalhostUrlFromText(command.stdout)
			?? latestLocalhostUrlFromText(command.stderr)
			?? parseLocalhostUrl(command.url);
		if (candidate) {
			return candidate;
		}
	}

	return undefined;
}

function filterBackgroundCommandsForContext<T extends { sessionId?: string; workspaceId?: string; cwd?: string }>(commands: T[], context: CleanSlateToolContext): T[] {
	const sessionId = context.sessionId;
	const workspaceId = context.workspaceContextService.getWorkspace().id;
	const workspaceFolders = context.workspaceContextService.getWorkspace().folders.map(folder => normalizeFsPathForComparison(folder.uri.fsPath));
	return commands.filter(command => {
		if (sessionId && command.sessionId) {
			return command.sessionId === sessionId;
		}
		if (workspaceId && command.workspaceId) {
			return command.workspaceId === workspaceId;
		}
		const cwd = command.cwd ? normalizeFsPathForComparison(command.cwd) : undefined;
		return !cwd || workspaceFolders.some(folder => cwd === folder || cwd.startsWith(`${folder}/`));
	});
}

function normalizeFsPathForComparison(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+$/g, '');
}

function parseLocalhostUrl(rawUrl: string | undefined): URL | undefined {
	if (!rawUrl) {
		return undefined;
	}
	const candidate = parseUrl(rawUrl);
	return candidate && isLocalhostHost(candidate.hostname) ? candidate : undefined;
}

function latestLocalhostUrlFromText(text: string | undefined): URL | undefined {
	if (!text) {
		return undefined;
	}
	const matches = Array.from(text.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[[^\]]+\])(?::\d+)?(?:\/[^\s"'<>]*)?/gi));
	for (let index = matches.length - 1; index >= 0; index--) {
		const candidate = parseLocalhostUrl(matches[index][0]);
		if (candidate) {
			return candidate;
		}
	}
	return undefined;
}

function parseUrl(rawUrl: string): URL | undefined {
	const trimmed = rawUrl.trim();
	if (!trimmed) {
		return undefined;
	}
	const normalized = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
	try {
		return new URL(normalized);
	} catch {
		return undefined;
	}
}

function isLocalhostHost(hostname: string): boolean {
	const normalized = hostname.toLowerCase();
	return normalized === 'localhost'
		|| normalized === '127.0.0.1'
		|| normalized === '0.0.0.0'
		|| normalized === '::1'
		|| normalized === '[::1]';
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	return String(error);
}

export const browserSnapshotTool: CleanSlateTool = {
	name: 'browser_snapshot',
	description: 'Reads semantic DOM state from the current integrated browser page: URL, title, visible text, viewport, and interactive elements with stable ids. This does not capture an image; use browser_screenshot for visual inspection.',
	category: 'browser',
	parametersSchema: {
		type: 'object',
		properties: {
			limit: {
				type: 'number',
				description: 'Maximum number of visible elements to return. Defaults to 120.'
			}
		}
	},
	async run(input: { limit?: number }, context: CleanSlateToolContext): Promise<any> {
		return runBrowserOperation(context, surface => context.browserAutomationService.snapshot(surface, { limit: input.limit }));
	}
};

export const browserClickTool: CleanSlateTool = {
	name: 'browser_click',
	description: 'Clicks one visible element in the live integrated browser using a stable snapshot id, semantic locator, CSS selector, or viewport coordinates. Ambiguous semantic matches fail instead of guessing.',
	category: 'browser',
	parametersSchema: {
		type: 'object',
		properties: {
			...browserLocatorProperties,
			x: {
				type: 'number',
				description: 'Viewport x coordinate when no elementId is available.'
			},
			y: {
				type: 'number',
				description: 'Viewport y coordinate when no elementId is available.'
			},
			button: { type: 'string', enum: ['left', 'middle', 'right'], description: 'Mouse button. Defaults to left.' },
			clickCount: { type: 'number', description: 'Click count from 1 to 3. Use 2 for double-click.' }
		}
	},
	async run(input: ICleanSlateBrowserTarget, context: CleanSlateToolContext): Promise<any> {
		return runBrowserOperation(context, surface => context.browserAutomationService.click(surface, input));
	}
};

export const browserHoverTool: CleanSlateTool = {
	name: 'browser_hover',
	description: 'Moves the live browser pointer over one uniquely matched visible element.',
	category: 'browser',
	parametersSchema: {
		type: 'object',
		properties: {
			...browserLocatorProperties,
			x: { type: 'number', description: 'Viewport x coordinate.' },
			y: { type: 'number', description: 'Viewport y coordinate.' }
		}
	},
	async run(input: ICleanSlateBrowserTarget, context: CleanSlateToolContext): Promise<any> {
		return runBrowserOperation(context, surface => context.browserAutomationService.hover(surface, input));
	}
};

export const browserFillTool: CleanSlateTool = {
	name: 'browser_fill',
	description: 'Replaces the value of one uniquely matched input, textarea, or contenteditable element and dispatches input/change events.',
	category: 'browser',
	parametersSchema: {
		type: 'object',
		properties: {
			...browserLocatorProperties,
			value: { type: 'string', description: 'Replacement value.' }
		},
		required: ['value']
	},
	async run(input: ICleanSlateBrowserLocator & { value?: string }, context: CleanSlateToolContext): Promise<any> {
		return runBrowserOperation(context, surface => context.browserAutomationService.fill(surface, { ...input, value: input.value ?? '' }));
	}
};

export const browserCheckTool: CleanSlateTool = {
	name: 'browser_check',
	description: 'Sets one uniquely matched checkbox or radio control to the requested checked state.',
	category: 'browser',
	parametersSchema: {
		type: 'object',
		properties: {
			...browserLocatorProperties,
			checked: { type: 'boolean', description: 'Desired checked state. Defaults to true.' }
		}
	},
	async run(input: ICleanSlateBrowserLocator & { checked?: boolean }, context: CleanSlateToolContext): Promise<any> {
		return runBrowserOperation(context, surface => context.browserAutomationService.check(surface, input));
	}
};

export const browserSelectTool: CleanSlateTool = {
	name: 'browser_select',
	description: 'Selects options by value or visible label in one uniquely matched select control.',
	category: 'browser',
	parametersSchema: {
		type: 'object',
		properties: {
			...browserLocatorProperties,
			values: { type: 'array', items: { type: 'string' }, description: 'Option values or visible labels to select.' }
		},
		required: ['values']
	},
	async run(input: ICleanSlateBrowserLocator & { values?: string[] }, context: CleanSlateToolContext): Promise<any> {
		return runBrowserOperation(context, surface => context.browserAutomationService.select(surface, { ...input, values: input.values ?? [] }));
	}
};

export const browserUploadTool: CleanSlateTool = {
	name: 'browser_upload',
	description: 'Assigns local files to one uniquely matched file input in the live browser through Chromium.',
	category: 'browser',
	parametersSchema: {
		type: 'object',
		properties: {
			...browserLocatorProperties,
			files: { type: 'array', items: { type: 'string' }, description: 'Absolute local file paths to upload.' }
		},
		required: ['files']
	},
	async run(input: ICleanSlateBrowserLocator & { files?: string[] }, context: CleanSlateToolContext): Promise<any> {
		return runBrowserOperation(context, surface => context.browserAutomationService.uploadFiles(surface, { ...input, files: input.files ?? [] }));
	}
};

export const browserDialogTool: CleanSlateTool = {
	name: 'browser_dialog',
	description: 'Accepts or dismisses the currently open JavaScript alert, confirm, or prompt in the live browser.',
	category: 'browser',
	parametersSchema: {
		type: 'object',
		properties: {
			accept: { type: 'boolean', description: 'Accept the dialog when true; dismiss it when false.' },
			promptText: { type: 'string', description: 'Optional response text for a prompt dialog.' }
		},
		required: ['accept']
	},
	async run(input: { accept?: boolean; promptText?: string }, context: CleanSlateToolContext): Promise<any> {
		return runBrowserOperation(context, surface => context.browserAutomationService.handleDialog(surface, {
			accept: input.accept === true,
			promptText: input.promptText
		}));
	}
};

export const browserClipboardTool: CleanSlateTool = {
	name: 'browser_clipboard',
	description: 'Reads or writes the clipboard from the focused live browser session.',
	category: 'browser',
	parametersSchema: {
		type: 'object',
		properties: {
			action: { type: 'string', enum: ['read', 'write'], description: 'Clipboard operation.' },
			text: { type: 'string', description: 'Text to write when action is write.' }
		},
		required: ['action']
	},
	async run(input: { action?: string; text?: string }, context: CleanSlateToolContext): Promise<any> {
		if (input.action !== 'read' && input.action !== 'write') {
			return { success: false, error: 'browser_clipboard action must be read or write.' };
		}
		return runBrowserOperation(context, surface => context.browserAutomationService.clipboard(surface, { action: input.action as 'read' | 'write', text: input.text }));
	}
};

export const browserTypeTool: CleanSlateTool = {
	name: 'browser_type',
	description: 'Types text into the currently focused input/contenteditable element in the integrated browser.',
	category: 'browser',
	parametersSchema: {
		type: 'object',
		properties: {
			text: {
				type: 'string',
				description: 'Text to type into the focused browser element.'
			}
		},
		required: ['text']
	},
	async run(input: { text?: string }, context: CleanSlateToolContext): Promise<any> {
		return runBrowserOperation(context, surface => context.browserAutomationService.typeText(surface, input.text ?? ''));
	}
};

export const browserKeyTool: CleanSlateTool = {
	name: 'browser_key',
	description: 'Sends a keyboard key event to the integrated browser, optionally with modifiers.',
	category: 'browser',
	parametersSchema: {
		type: 'object',
		properties: {
			...browserLocatorProperties,
			key: { type: 'string', description: 'Key to send, such as Enter, Escape, Tab, ArrowDown, or a character.' },
			ctrlKey: { type: 'boolean' },
			shiftKey: { type: 'boolean' },
			altKey: { type: 'boolean' },
			metaKey: { type: 'boolean' }
		},
		required: ['key']
	},
	async run(input: ICleanSlateBrowserLocator & { key?: string; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean }, context: CleanSlateToolContext): Promise<any> {
		return runBrowserOperation(context, surface => context.browserAutomationService.pressKey(surface, {
			key: input.key ?? '',
			ctrlKey: input.ctrlKey,
			shiftKey: input.shiftKey,
			altKey: input.altKey,
			metaKey: input.metaKey
		}));
	}
};

export const browserScrollTool: CleanSlateTool = {
	name: 'browser_scroll',
	description: 'Scrolls the integrated browser page or around a visible element from browser_snapshot.',
	category: 'browser',
	parametersSchema: {
		type: 'object',
		properties: {
			...browserLocatorProperties,
			x: { type: 'number', description: 'Optional viewport x coordinate.' },
			y: { type: 'number', description: 'Optional viewport y coordinate.' },
			deltaX: { type: 'number', description: 'Horizontal scroll delta.' },
			deltaY: { type: 'number', description: 'Vertical scroll delta. Positive scrolls down.' }
		}
	},
	async run(input: ICleanSlateBrowserTarget & { deltaX?: number; deltaY?: number }, context: CleanSlateToolContext): Promise<any> {
		return runBrowserOperation(context, surface => context.browserAutomationService.scroll(surface, input));
	}
};

export const browserScreenshotTool: CleanSlateTool = {
	name: 'browser_screenshot',
	description: 'Captures the current integrated browser viewport as a JPEG image. Required for visual inspection or visual verification because browser_snapshot contains DOM text only.',
	category: 'browser',
	parametersSchema: {
		type: 'object',
		properties: {
			quality: {
				type: 'number',
				description: 'JPEG quality from 1 to 100. Defaults to 85.'
			},
			fullPage: {
				type: 'boolean',
				description: 'Capture the full page instead of only the viewport.'
			}
		}
	},
	async run(input: { quality?: number; fullPage?: boolean }, context: CleanSlateToolContext): Promise<any> {
		return runBrowserOperation(context, surface => context.browserAutomationService.screenshot(surface, { quality: input.quality, fullPage: input.fullPage }));
	}
};

export const browserGetUrlTool: CleanSlateTool = {
	name: 'browser_get_url',
	description: 'Returns the integrated browser current URL, title, loading state, and view id.',
	category: 'browser',
	parametersSchema: { type: 'object', properties: {} },
	async run(_input: unknown, context: CleanSlateToolContext): Promise<any> {
		return runBrowserOperation(context, surface => context.browserAutomationService.getUrl(surface));
	}
};

export const browserDiagnosticsTool: CleanSlateTool = {
	name: 'browser_diagnostics',
	description: 'Returns bounded console messages, network requests, and downloads captured from the exact live integrated browser session.',
	category: 'browser',
	parametersSchema: {
		type: 'object',
		properties: {
			clear: { type: 'boolean', description: 'Clear captured diagnostics after reading them.' }
		}
	},
	async run(input: { clear?: boolean }, context: CleanSlateToolContext): Promise<any> {
		return runBrowserOperation(context, surface => context.browserAutomationService.getDiagnostics(surface, input));
	}
};

export const browserTabsTool: CleanSlateTool = {
	name: 'browser_tabs',
	description: 'Lists the tabs bound to the current CleanSlate browser surface and identifies the active tab.',
	category: 'browser',
	parametersSchema: { type: 'object', properties: {} },
	async run(_input: unknown, context: CleanSlateToolContext): Promise<any> {
		return runBrowserOperation(context, surface => context.browserAutomationService.listTabs(surface));
	}
};

export const browserNewTabTool: CleanSlateTool = {
	name: 'browser_new_tab',
	description: 'Creates a new tab in the same live CleanSlate browser session.',
	category: 'browser',
	parametersSchema: {
		type: 'object',
		properties: {
			url: { type: 'string', description: 'Optional concrete URL to open.' },
			background: { type: 'boolean', description: 'Create without selecting the new tab.' }
		}
	},
	async run(input: { url?: string; background?: boolean }, context: CleanSlateToolContext): Promise<any> {
		return runBrowserOperation(context, surface => context.browserAutomationService.newTab(surface, input));
	}
};

export const browserSelectTabTool: CleanSlateTool = {
	name: 'browser_select_tab',
	description: 'Selects an existing tab in the current CleanSlate browser session.',
	category: 'browser',
	parametersSchema: {
		type: 'object',
		properties: {
			tabId: { type: 'string', description: 'Tab id from browser_tabs.' }
		},
		required: ['tabId']
	},
	async run(input: { tabId?: string }, context: CleanSlateToolContext): Promise<any> {
		const tabId = input.tabId?.trim();
		if (!tabId) {
			return { success: false, error: 'browser_select_tab requires tabId.' };
		}
		return runBrowserOperation(context, surface => context.browserAutomationService.selectTab(surface, tabId));
	}
};

export const browserCloseTabTool: CleanSlateTool = {
	name: 'browser_close_tab',
	description: 'Closes one tab from the current CleanSlate browser session.',
	category: 'browser',
	parametersSchema: {
		type: 'object',
		properties: {
			tabId: { type: 'string', description: 'Tab id from browser_tabs.' }
		},
		required: ['tabId']
	},
	async run(input: { tabId?: string }, context: CleanSlateToolContext): Promise<any> {
		const tabId = input.tabId?.trim();
		if (!tabId) {
			return { success: false, error: 'browser_close_tab requires tabId.' };
		}
		return runBrowserOperation(context, surface => context.browserAutomationService.closeTab(surface, tabId));
	}
};

export const browserWaitTool: CleanSlateTool = {
	name: 'browser_wait',
	description: 'Waits for the live page to settle and optionally for a URL or semantic locator to become visible/hidden.',
	category: 'browser',
	parametersSchema: {
		type: 'object',
		properties: {
			...browserLocatorProperties,
			ms: {
				type: 'number',
				description: 'Milliseconds to wait before checking page state. Defaults to 1000; capped at 30000.'
			},
			timeoutMs: { type: 'number', description: 'Condition timeout in milliseconds. Defaults to 5000; capped at 30000.' },
			hidden: { type: 'boolean', description: 'Wait for the locator to become hidden instead of visible.' },
			url: { type: 'string', description: 'Wait for the current URL to contain this value, or equal it when exact is true.' }
		}
	},
	async run(input: ICleanSlateBrowserWaitOptions, context: CleanSlateToolContext): Promise<any> {
		return runBrowserOperation(context, surface => context.browserAutomationService.wait(surface, input));
	}
};

export const browserStartAnnotationTool: CleanSlateTool = {
	name: 'browser_start_annotation',
	description: 'Starts annotation mode in the integrated browser so page elements can be highlighted and commented.',
	category: 'browser',
	parametersSchema: { type: 'object', properties: {} },
	async run(_input: unknown, context: CleanSlateToolContext): Promise<any> {
		return runBrowserOperation(context, surface => context.browserAutomationService.startAnnotation(surface));
	}
};

export const browserStopAnnotationTool: CleanSlateTool = {
	name: 'browser_stop_annotation',
	description: 'Stops browser annotation mode and returns the collected page annotations.',
	category: 'browser',
	parametersSchema: { type: 'object', properties: {} },
	async run(_input: unknown, context: CleanSlateToolContext): Promise<any> {
		return runBrowserOperation(context, surface => context.browserAutomationService.stopAnnotation(surface));
	}
};

export const browserListAnnotationsTool: CleanSlateTool = {
	name: 'browser_list_annotations',
	description: 'Lists annotations collected in the current integrated browser page.',
	category: 'browser',
	parametersSchema: { type: 'object', properties: {} },
	async run(_input: unknown, context: CleanSlateToolContext): Promise<any> {
		return runBrowserOperation(context, surface => context.browserAutomationService.listAnnotations(surface));
	}
};

export const browserDeleteAnnotationTool: CleanSlateTool = {
	name: 'browser_delete_annotation',
	description: 'Deletes one browser annotation by id and returns the remaining active annotations.',
	category: 'browser',
	parametersSchema: {
		type: 'object',
		properties: {
			annotationId: {
				type: 'string',
				description: 'Annotation id from browser_list_annotations.'
			}
		},
		required: ['annotationId']
	},
	async run(input: { annotationId?: string }, context: CleanSlateToolContext): Promise<any> {
		const annotationId = input.annotationId?.trim();
		if (!annotationId) {
			return { success: false, error: 'browser_delete_annotation requires annotationId.' };
		}
		return runBrowserOperation(context, surface => context.browserAutomationService.deleteAnnotation(surface, annotationId));
	}
};

export const browserClearAnnotationsTool: CleanSlateTool = {
	name: 'browser_clear_annotations',
	description: 'Deletes all active browser annotations on the current integrated browser page.',
	category: 'browser',
	parametersSchema: { type: 'object', properties: {} },
	async run(_input: unknown, context: CleanSlateToolContext): Promise<any> {
		return runBrowserOperation(context, surface => context.browserAutomationService.clearAnnotations(surface));
	}
};
