/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IBrowserViewAnnotation {
	id: string;
	url: string;
	title: string;
	text: string;
	tagName: string;
	label: string;
	selector: string;
	elementText?: string;
	ariaLabel?: string;
	href?: string;
	pageX: number;
	pageY: number;
	x: number;
	y: number;
	width: number;
	height: number;
	createdAt: number;
}

export function browserAnnotationScript(action: 'start' | 'stop' | 'list' | 'delete' | 'clear', annotationId?: string): string {
	return `(() => {
		const globalKey = '__cleanSlateAnnotationState';
		const action = ${JSON.stringify(action)};
		const annotationId = ${JSON.stringify(annotationId ?? '')};
		const clean = (value, max = 120) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, max);
		if (!window[globalKey]) {
			const state = {
				active: false,
				annotations: [],
				hover: undefined,
				tooltip: undefined,
				composer: undefined,
				root: undefined,
				moveHandler: undefined,
				clickHandler: undefined
			};
			const cssEscape = (value) => {
				if (window.CSS && typeof window.CSS.escape === 'function') {
					return window.CSS.escape(value);
				}
				return String(value).replace(/["\\\\#.:\\[\\]>+~*^$|=\\s]/g, '\\\\$&');
			};
			const selectorFor = (element) => {
				if (!element || !element.tagName) {
					return '';
				}
				if (element.id) {
					return '#' + cssEscape(element.id);
				}
				const parts = [];
				let current = element;
				while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
					let part = current.tagName.toLowerCase();
					const testId = current.getAttribute('data-testid') || current.getAttribute('data-test') || current.getAttribute('data-cy');
					if (testId) {
						part += '[data-testid="' + String(testId).replace(/"/g, '\\\\"') + '"]';
						parts.unshift(part);
						break;
					}
					const parent = current.parentElement;
					if (parent) {
						const siblings = Array.from(parent.children).filter(child => child.tagName === current.tagName);
						if (siblings.length > 1) {
							part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
						}
					}
					parts.unshift(part);
					current = parent;
					if (parts.length >= 5) {
						break;
					}
				}
				return parts.join(' > ');
			};
			const ensureRoot = () => {
				if (state.root) {
					return state.root;
				}
				const root = document.createElement('div');
				root.setAttribute('data-cleanslate-annotations', 'true');
				root.style.position = 'fixed';
				root.style.inset = '0';
				root.style.pointerEvents = 'none';
				root.style.zIndex = '2147483647';
				document.documentElement.appendChild(root);
				state.root = root;
				return root;
			};
			const ensureHover = () => {
				const root = ensureRoot();
				if (state.hover) {
					return state.hover;
				}
				const hover = document.createElement('div');
				hover.style.position = 'fixed';
				hover.style.border = '2px solid #3b82f6';
				hover.style.background = 'rgba(59, 130, 246, 0.16)';
				hover.style.borderRadius = '2px';
				hover.style.pointerEvents = 'none';
				hover.style.display = 'none';
				root.appendChild(hover);
				state.hover = hover;
				return hover;
			};
			const ensureTooltip = () => {
				const root = ensureRoot();
				if (state.tooltip) {
					return state.tooltip;
				}
				const tooltip = document.createElement('div');
				tooltip.style.position = 'fixed';
				tooltip.style.display = 'none';
				tooltip.style.minWidth = '190px';
				tooltip.style.maxWidth = '320px';
				tooltip.style.padding = '10px 12px';
				tooltip.style.borderRadius = '10px';
				tooltip.style.background = '#111827';
				tooltip.style.color = '#f9fafb';
				tooltip.style.boxShadow = '0 16px 40px rgba(0,0,0,.32)';
				tooltip.style.font = '12px system-ui, sans-serif';
				tooltip.style.lineHeight = '1.45';
				tooltip.style.pointerEvents = 'none';
				root.appendChild(tooltip);
				state.tooltip = tooltip;
				return tooltip;
			};
			const renderTooltip = (element, rect) => {
				const tooltip = ensureTooltip();
				const styles = window.getComputedStyle(element);
				const tag = element.tagName.toLowerCase();
				const width = Math.round(rect.width);
				const height = Math.round(rect.height);
				tooltip.replaceChildren();

				const header = document.createElement('div');
				header.style.display = 'flex';
				header.style.justifyContent = 'space-between';
				header.style.gap = '18px';
				header.style.fontWeight = '700';
				const tagNode = document.createElement('span');
				tagNode.textContent = tag;
				const sizeNode = document.createElement('span');
				sizeNode.textContent = width + 'x' + height;
				header.appendChild(tagNode);
				header.appendChild(sizeNode);
				tooltip.appendChild(header);

				const colorRow = document.createElement('div');
				colorRow.style.display = 'flex';
				colorRow.style.justifyContent = 'space-between';
				colorRow.style.gap = '18px';
				colorRow.style.opacity = '0.86';
				const colorLabel = document.createElement('span');
				colorLabel.textContent = 'Color';
				const colorValue = document.createElement('span');
				colorValue.textContent = styles.color;
				colorRow.appendChild(colorLabel);
				colorRow.appendChild(colorValue);
				tooltip.appendChild(colorRow);

				const fontRow = document.createElement('div');
				fontRow.style.display = 'flex';
				fontRow.style.justifyContent = 'space-between';
				fontRow.style.gap = '18px';
				fontRow.style.opacity = '0.86';
				const fontLabel = document.createElement('span');
				fontLabel.textContent = 'Font';
				const fontValue = document.createElement('span');
				fontValue.textContent = clean(styles.fontSize + ' ' + styles.fontFamily, 48);
				fontRow.appendChild(fontLabel);
				fontRow.appendChild(fontValue);
				tooltip.appendChild(fontRow);

				tooltip.style.display = 'block';
				tooltip.style.left = Math.round(Math.min(window.innerWidth - 340, Math.max(12, rect.x))) + 'px';
				tooltip.style.top = Math.round(Math.max(12, rect.y - tooltip.offsetHeight - 12)) + 'px';
			};
			const hideHover = () => {
				if (state.hover) {
					state.hover.style.display = 'none';
				}
				if (state.tooltip) {
					state.tooltip.style.display = 'none';
				}
			};
			const addPin = (annotation) => {
				const root = ensureRoot();
				const pin = document.createElement('div');
				pin.setAttribute('data-cleanslate-annotation-id', annotation.id);
				pin.textContent = String(state.annotations.findIndex(item => item.id === annotation.id) + 1);
				pin.title = annotation.text || annotation.label;
				pin.style.position = 'fixed';
				pin.style.left = Math.round(annotation.x) + 'px';
				pin.style.top = Math.round(annotation.y) + 'px';
				pin.style.width = '22px';
				pin.style.height = '22px';
				pin.style.borderRadius = '999px';
				pin.style.background = '#3b82f6';
				pin.style.color = '#fff';
				pin.style.font = '700 12px system-ui, sans-serif';
				pin.style.display = 'grid';
				pin.style.placeItems = 'center';
				pin.style.transform = 'translate(-50%, -50%)';
				pin.style.boxShadow = '0 6px 20px rgba(0,0,0,.25)';
				pin.style.pointerEvents = 'auto';
				pin.style.cursor = 'pointer';
				pin.addEventListener('click', (event) => {
					event.preventDefault();
					event.stopPropagation();
					state.delete(annotation.id);
				});
				root.appendChild(pin);
			};
			const rerenderPins = () => {
				const root = ensureRoot();
				for (const pin of Array.from(root.querySelectorAll('[data-cleanslate-annotation-id]'))) {
					pin.remove();
				}
				for (const annotation of state.annotations) {
					addPin(annotation);
				}
			};
			const closeComposer = () => {
				if (state.composer) {
					state.composer.remove();
					state.composer = undefined;
				}
			};
			const openComposer = (annotation) => {
				closeComposer();
				const root = ensureRoot();
				const composer = document.createElement('div');
				composer.style.position = 'fixed';
				composer.style.left = Math.round(Math.min(window.innerWidth - 380, Math.max(12, annotation.x + 12))) + 'px';
				composer.style.top = Math.round(Math.min(window.innerHeight - 86, Math.max(12, annotation.y + 12))) + 'px';
				composer.style.width = '360px';
				composer.style.padding = '10px 12px';
				composer.style.borderRadius = '16px';
				composer.style.background = '#1f2937';
				composer.style.boxShadow = '0 18px 50px rgba(0,0,0,.35)';
				composer.style.display = 'flex';
				composer.style.gap = '8px';
				composer.style.alignItems = 'center';
				composer.style.pointerEvents = 'auto';
				const input = document.createElement('input');
				input.type = 'text';
				input.placeholder = 'Add a comment...';
				input.style.flex = '1';
				input.style.minWidth = '0';
				input.style.background = 'transparent';
				input.style.border = '0';
				input.style.outline = '0';
				input.style.color = '#fff';
				input.style.font = '14px system-ui, sans-serif';
				const save = document.createElement('button');
				save.textContent = 'Save';
				save.style.border = '0';
				save.style.borderRadius = '10px';
				save.style.padding = '6px 10px';
				save.style.background = '#3b82f6';
				save.style.color = '#fff';
				save.style.font = '600 12px system-ui, sans-serif';
				const persist = () => {
					annotation.text = clean(input.value, 500);
					if (!annotation.text) {
						closeComposer();
						return;
					}
					state.annotations.push(annotation);
					addPin(annotation);
					closeComposer();
				};
				input.addEventListener('keydown', (event) => {
					if (event.key === 'Enter') {
						event.preventDefault();
						persist();
					}
					if (event.key === 'Escape') {
						event.preventDefault();
						closeComposer();
					}
				});
				save.addEventListener('click', persist);
				composer.appendChild(input);
				composer.appendChild(save);
				root.appendChild(composer);
				state.composer = composer;
				window.requestAnimationFrame(() => input.focus());
			};
			state.start = () => {
				if (state.active) {
					return;
				}
				state.active = true;
				const hover = ensureHover();
				state.moveHandler = (event) => {
					const element = document.elementFromPoint(event.clientX, event.clientY);
					if (!element || element === document.documentElement || element === document.body || element.closest('[data-cleanslate-annotations]')) {
						hideHover();
						return;
					}
					const rect = element.getBoundingClientRect();
					hover.style.display = 'block';
					hover.style.left = Math.round(rect.x) + 'px';
					hover.style.top = Math.round(rect.y) + 'px';
					hover.style.width = Math.round(rect.width) + 'px';
					hover.style.height = Math.round(rect.height) + 'px';
					renderTooltip(element, rect);
				};
				state.clickHandler = (event) => {
					const element = document.elementFromPoint(event.clientX, event.clientY);
					if (!element || element.closest('[data-cleanslate-annotations]')) {
						return;
					}
					event.preventDefault();
					event.stopPropagation();
					const rect = element.getBoundingClientRect();
					const label = clean(element.innerText || element.textContent || element.getAttribute('aria-label') || element.getAttribute('title') || element.tagName);
					const annotation = {
						id: 'annotation-' + Date.now().toString(36) + '-' + (state.annotations.length + 1),
						url: location.href,
						title: document.title,
						text: '',
						tagName: element.tagName.toLowerCase(),
						label,
						selector: selectorFor(element),
						elementText: clean(element.innerText || element.textContent, 500) || undefined,
						ariaLabel: clean(element.getAttribute('aria-label')) || undefined,
						href: element.href || undefined,
						pageX: Math.round(rect.x + window.scrollX),
						pageY: Math.round(rect.y + window.scrollY),
						x: event.clientX,
						y: event.clientY,
						width: Math.round(rect.width),
						height: Math.round(rect.height),
						createdAt: Date.now()
					};
					openComposer(annotation);
				};
				document.addEventListener('mousemove', state.moveHandler, true);
				document.addEventListener('click', state.clickHandler, true);
			};
			state.stop = () => {
				if (!state.active) {
					return;
				}
				state.active = false;
				if (state.moveHandler) {
					document.removeEventListener('mousemove', state.moveHandler, true);
				}
				if (state.clickHandler) {
					document.removeEventListener('click', state.clickHandler, true);
				}
				hideHover();
				closeComposer();
			};
			state.delete = (id) => {
				const before = state.annotations.length;
				state.annotations = state.annotations.filter(annotation => annotation.id !== id);
				if (state.annotations.length !== before) {
					rerenderPins();
				}
			};
			state.clear = () => {
				state.annotations = [];
				rerenderPins();
			};
			window[globalKey] = state;
		}
		const state = window[globalKey];
		if (action === 'start') {
			state.start();
		} else if (action === 'stop') {
			state.stop();
		} else if (action === 'delete') {
			state.delete(annotationId);
		} else if (action === 'clear') {
			state.clear();
		}
		return state.annotations.slice();
	})()`;
}
