/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function normalizeCleanSlateBrowserScreenshotDataUrl(
	mimeType: string | undefined,
	rawBase64: string | undefined
): string | undefined {
	if (typeof rawBase64 !== 'string') {
		return undefined;
	}

	let normalizedMimeType = /^image\/[a-z0-9.+-]+$/i.test(mimeType || '') ? mimeType! : 'image/jpeg';
	let payload = rawBase64.trim();
	const existingDataUrl = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]*)$/i.exec(payload);
	if (existingDataUrl) {
		normalizedMimeType = existingDataUrl[1];
		payload = existingDataUrl[2];
	}
	payload = payload.replace(/\s+/g, '');
	if (!payload || payload.length % 4 === 1 || !/^[a-z0-9+/]*={0,2}$/i.test(payload)) {
		return undefined;
	}
	return `data:${normalizedMimeType};base64,${payload}`;
}
