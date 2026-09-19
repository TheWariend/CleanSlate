/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Presentation follows advertised mode semantics, never an agent's identity or translated label. */
export function isFullAccessMode(kind?: string): boolean {
	return kind === 'unrestricted';
}

export function renderApprovalIcon(host: HTMLElement, kind?: string): void {
	host.replaceChildren();
	host.classList.remove('codicon', 'codicon-settings', 'codicon-shield');
	host.setAttribute('aria-hidden', 'true');
	const svg = host.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
	for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: '18', height: '18', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.65', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) { svg.setAttribute(key, value); }
	// Original compact geometry shared by the trigger and menu.
	const shield = 'M12 3 20 6v6c0 4-3.5 7-8 9-4.5-2-8-5-8-9V6Z';
	const paths = kind === 'unrestricted' ? [shield, 'M12 7v6 M12 16h.01']
		: kind === 'automatic-review' ? [shield, 'm8 9 3 3-3 3 M13 15h3']
			: kind === 'approval-required' ? ['M8 12V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v6-3a1.5 1.5 0 0 1 3 0v6c0 4-2.5 7-6.5 7-3 0-5-1.5-6.5-4L4 12c-1-2 1-3 2-2l2 2']
				: ['m12 4 8 8-8 8-8-8Z', 'M9 12h6'];
	for (const d of paths) { const path = host.ownerDocument.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); svg.append(path); }
	host.append(svg);
}
