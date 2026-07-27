/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable no-restricted-globals */

/**
 * Preload script for pages loaded in Integrated Browser
 *
 * It runs in an isolated context that Electron calls an "isolated world".
 * Specifically the isolated world with worldId 999, which shows in DevTools as "Electron Isolated Context".
 * Despite being isolated, it still runs on the same page as the JS from the actual loaded website
 * which runs on the so-called "main world" (worldId 0. In DevTools as "top").
 *
 * Learn more: see Electron docs for Security, contextBridge, and Context Isolation.
 */
(function () {

	const { contextBridge, webFrame } = require('electron');

	// Pages that style themselves dark but never declare `color-scheme` still get
	// Chromium's default light scrollbar, which reads as a bright seam against the
	// browser pane. Default the viewport scrollbar to dark instead.
	//
	// `scrollbar-color` rather than `::-webkit-scrollbar`: the standard property tints
	// the native scrollbar, while the pseudo-element swaps in a custom one, which on
	// macOS turns overlay scrollbars into classic ones and steals layout width from
	// every page. Injected without `!important` so a page that styles its own
	// scrollbars — or opts into `color-scheme` — still wins.
	//
	// The thumb is a neutral mid grey over a transparent track: this applies to every
	// page in the pane, including light ones, and a white-ish thumb would vanish there.
	const DEFAULT_DARK_SCROLLBAR_CSS = ':root { scrollbar-color: rgba(135, 135, 135, 0.55) transparent; }';

	try {
		webFrame.insertCSS(DEFAULT_DARK_SCROLLBAR_CSS);
	} catch (error) {
		console.error(error);
	}

	// #######################################################################
	// ###                                                                 ###
	// ###       !!! DO NOT USE GET/SET PROPERTIES ANYWHERE HERE !!!       ###
	// ###       !!!  UNLESS THE ACCESS IS WITHOUT SIDE EFFECTS  !!!       ###
	// ###       (https://github.com/electron/electron/issues/25516)       ###
	// ###                                                                 ###
	// #######################################################################
	const globals = {
		/**
		 * Get the currently selected text in the page.
		 */
		getSelectedText(): string {
			try {
				// Even if the page has overridden window.getSelection, our call here will still reach the original
				// implementation. That's because Electron proxies functions, such as getSelectedText here, that are
				// exposed to a different context via exposeInIsolatedWorld or exposeInMainWorld.
				return window.getSelection()?.toString() ?? '';
			} catch {
				return '';
			}
		}
	};

	try {
		// Use `contextBridge` APIs to expose globals to the same isolated world where this preload script runs (worldId 999).
		// The globals object will be recursively frozen (and for functions also proxied) by Electron to prevent
		// modification within the given context.
		contextBridge.exposeInIsolatedWorld(999, 'browserViewAPI', globals);
	} catch (error) {
		console.error(error);
	}
}());
