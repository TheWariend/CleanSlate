/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const DEFAULT_MAX_CHARS = 12000;
const MAX_STRING_CHARS = 3000;
const MAX_BODY_TEXT_CHARS = 1200;
const MAX_ELEMENTS = 30;
const MAX_ARRAY_ITEMS = 40;
const MAX_OBJECT_KEYS = 40;
const MAX_DEPTH = 5;

export function serializeToolResultForPrompt(toolName: string, result: unknown, maxChars?: number): string {
	const sanitized = sanitizeToolResultForRuntime(toolName, result);
	const serialized = safeJsonStringify(sanitized);
	return clampForPrompt(serialized, maxChars ?? (isFileReadTool(toolName) ? Number.POSITIVE_INFINITY : DEFAULT_MAX_CHARS));
}

export function sanitizeToolResultForRuntime(toolName: string, result: unknown): unknown {
	return sanitizeToolResult(result, toolName, 0, new WeakSet<object>());
}

/**
 * Keeps the runtime result bounded while retaining the small slice of browser
 * image evidence that the transcript can actually display. Prompt serialization
 * sanitizes this value again, so raw media never enters model context.
 */
export function sanitizeToolResultForRenderer(toolName: string, result: unknown): unknown {
	const sanitized = sanitizeToolResultForRuntime(toolName, result);
	if (!result || typeof result !== 'object' || !sanitized || typeof sanitized !== 'object') {
		return sanitized;
	}

	if (toolName === 'browser_screenshot') {
		return restoreBrowserScreenshotPayload(
			sanitized as Record<string, unknown>,
			result as Record<string, unknown>
		);
	}

	return sanitized;
}

function restoreBrowserScreenshotPayload(
	sanitized: Record<string, unknown>,
	source: Record<string, unknown>
): Record<string, unknown> {
	return typeof source.base64 === 'string' && source.base64.length > 0
		? { ...sanitized, base64: source.base64 }
		: sanitized;
}

function sanitizeToolResult(value: unknown, toolName: string, depth: number, seen: WeakSet<object>): unknown {
	if (value === null || value === undefined) {
		return value;
	}

	if (typeof value === 'string') {
		return clampString(value, MAX_STRING_CHARS);
	}

	if (typeof value !== 'object') {
		return value;
	}

	if (seen.has(value)) {
		return '[Circular]';
	}

	if (depth >= MAX_DEPTH) {
		return `[Object omitted after depth ${MAX_DEPTH}]`;
	}

	seen.add(value);

	if (Array.isArray(value)) {
		const items = value.slice(0, MAX_ARRAY_ITEMS).map(item => sanitizeToolResult(item, toolName, depth + 1, seen));
		if (value.length > MAX_ARRAY_ITEMS) {
			items.push(`[${value.length - MAX_ARRAY_ITEMS} item(s) omitted]`);
		}
		return items;
	}

	const source = value as Record<string, unknown>;

	if (isBrowserScreenshotObject(source)) {
		return {
			position: source.position,
			mimeType: source.mimeType,
			base64: summarizeBase64(source.base64)
		};
	}

	return sanitizePlainObject(source, toolName, depth, seen);
}

function sanitizePlainObject(
	source: Record<string, unknown>,
	toolName: string,
	depth: number,
	seen: WeakSet<object>,
	omitKeys = new Set<string>()
): Record<string, unknown> {
	const target: Record<string, unknown> = {};
	let written = 0;

	for (const [key, rawValue] of Object.entries(source)) {
		if (omitKeys.has(key)) {
			continue;
		}

		if (key === 'content' && isFileReadTool(toolName) && typeof rawValue === 'string') {
			// File reads already enforce their own complete-read/range budget. Do
			// not run successful file content through the generic 3k string clamp:
			// that created a false partial read and made the model read it again.
			target[key] = rawValue;
		} else if (key === 'base64' && typeof rawValue === 'string') {
			target[key] = summarizeBase64(rawValue);
		} else if (key === 'bodyText' && typeof rawValue === 'string') {
			target[key] = clampString(rawValue, MAX_BODY_TEXT_CHARS);
		} else if (key === 'elements' && Array.isArray(rawValue)) {
			target[key] = rawValue.slice(0, MAX_ELEMENTS).map(element => sanitizeBrowserElement(element, seen));
			if (rawValue.length > MAX_ELEMENTS) {
				target.elementCount = rawValue.length;
			}
		} else if (key === 'screenshots' && Array.isArray(rawValue)) {
			target[key] = rawValue.map(screenshot => sanitizeBrowserScreenshot(screenshot));
			target.screenshotCount = rawValue.length;
		} else {
			target[key] = sanitizeToolResult(rawValue, toolName, depth + 1, seen);
		}

		written++;
		if (written >= MAX_OBJECT_KEYS) {
			target.__omittedKeys = Math.max(0, Object.keys(source).length - written);
			break;
		}
	}

	return target;
}

function isFileReadTool(toolName: string): boolean {
	return toolName === 'read_file' || toolName === 'read_file_range';
}

function sanitizeBrowserElement(value: unknown, seen: WeakSet<object>): unknown {
	if (!value || typeof value !== 'object') {
		return value;
	}

	const element = value as Record<string, unknown>;
	return sanitizePlainObject({
		id: element.id,
		tagName: element.tagName,
		role: element.role,
		name: typeof element.name === 'string' ? clampString(element.name, 300) : element.name,
		testId: element.testId,
		text: typeof element.text === 'string' ? clampString(element.text, 500) : element.text,
		ariaLabel: typeof element.ariaLabel === 'string' ? clampString(element.ariaLabel, 300) : element.ariaLabel,
		placeholder: typeof element.placeholder === 'string' ? clampString(element.placeholder, 300) : element.placeholder,
		href: element.href,
		type: element.type,
		checked: element.checked,
		disabled: element.disabled,
		selector: element.selector,
		boundingBox: element.boundingBox,
		visual: element.visual
	}, 'browser_element', 0, seen);
}

function sanitizeBrowserScreenshot(value: unknown): unknown {
	if (!value || typeof value !== 'object') {
		return value;
	}
	const screenshot = value as Record<string, unknown>;
	return {
		position: screenshot.position,
		mimeType: screenshot.mimeType,
		base64: typeof screenshot.base64 === 'string' ? summarizeBase64(screenshot.base64) : screenshot.base64
	};
}

function isBrowserScreenshotObject(value: Record<string, unknown>): value is Record<string, unknown> & { base64: string } {
	return typeof value.base64 === 'string'
		&& (value.mimeType === 'image/jpeg' || value.mimeType === 'image/png' || typeof value.position === 'string');
}

function summarizeBase64(value: unknown): string {
	return typeof value === 'string'
		? `[base64 omitted: ${value.length} chars]`
		: '[base64 omitted]';
}

function safeJsonStringify(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch (error) {
		return JSON.stringify({
			success: false,
			code: 'tool_result_serialization_failed',
			message: (error as Error).message
		});
	}
}

function clampString(value: string, maxChars: number): string {
	if (value.length <= maxChars) {
		return value;
	}
	return `${value.slice(0, Math.max(0, maxChars - 80))}\n...[truncated ${value.length - maxChars} chars]`;
}

function clampForPrompt(value: string, maxChars: number): string {
	if (value.length <= maxChars) {
		return value;
	}
	return `${value.slice(0, Math.max(0, maxChars - 100))}\n...[truncated ${value.length - maxChars} chars]`;
}
