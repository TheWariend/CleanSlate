/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';

export function resolveCleanSlateBrowserAddress(value: string): string {
	const text = value.trim();
	if (!text) {
		throw new Error(localize('cleanSlate.browser.emptyAddress', 'Enter a website address or search.'));
	}
	if (/^(localhost|127\.\d+\.\d+\.\d+|\[[\da-f:]+\])(?::\d+)?(?:[/?#]|$)/i.test(text)) {
		return new URL(`http://${text}`).href;
	}
	if (!/\s/.test(text) && /^(?:[^/?#:.]+\.)+[^/?#:.]+(?::\d+)?(?:[/?#]|$)/.test(text)) {
		return new URL(`https://${text}`).href;
	}
	if (/^[a-z][a-z\d+.-]*:/i.test(text)) {
		const url = new URL(text);
		if (!['http:', 'https:', 'file:'].includes(url.protocol)) {
			throw new Error(localize('cleanSlate.browser.unsupportedAddress', 'Use an HTTP, HTTPS, or local file address.'));
		}
		return url.href;
	}
	return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
}
