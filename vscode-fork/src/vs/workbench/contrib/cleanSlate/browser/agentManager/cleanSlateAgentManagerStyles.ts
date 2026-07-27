/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerThemingParticipant } from '../../../../../platform/theme/common/themeService.js';

registerThemingParticipant((_theme, collector) => {
	collector.addRule(`
		.cleanSlate-agent-manager-host-active {
			--cleanSlate-agent-manager-titlebar-control-offset: 12px;
			position: relative;
			width: 100%;
			height: 100%;
			overflow: hidden;
		}

		.cleanSlate-agent-manager-host-active > :not(.cleanSlate-agent-manager-surface):not(.part.titlebar) {
			display: none !important;
		}

		.cleanSlate-agent-manager-host-active > .part.titlebar {
			display: flex !important;
			position: relative;
			background: var(--vscode-sideBar-background);
			border-bottom: none;
			-webkit-app-region: drag;
		}

		.cleanSlate-agent-manager-host-active > .part.titlebar > .titlebar-container {
			visibility: hidden;
			pointer-events: none;
		}

		.cleanSlate-agent-manager-host-active > .part.titlebar > .titlebar-container > .titlebar-drag-region {
			visibility: visible;
		}

		.cleanSlate-agent-manager-surface {
			--cleanSlate-agent-manager-nav-width: 320px;
			--cleanSlate-agent-manager-right-width: 440px;
			--cleanSlate-agent-manager-ease: cubic-bezier(0.2, 0, 0, 1);
			--cleanSlate-agent-manager-surface-bg: var(--vscode-editor-background);
				--cleanSlate-agent-manager-nav-bg: var(--vscode-sideBar-background);
				--cleanSlate-agent-manager-panel-bg: var(--vscode-editor-background);
				--cleanSlate-agent-manager-card-bg: var(--vscode-input-background);
				--cleanSlate-agent-manager-card-hover-bg: var(--vscode-list-hoverBackground);
				--cleanSlate-agent-manager-active-bg: var(--vscode-list-inactiveSelectionBackground, var(--vscode-list-activeSelectionBackground));
				--cleanSlate-agent-manager-project-active-bg: var(--vscode-list-hoverBackground);
				--cleanSlate-agent-manager-row-border: var(--vscode-contrastBorder, var(--vscode-panel-border));
				--cleanSlate-agent-manager-subtle-bg: var(--vscode-toolbar-hoverBackground);
				--cleanSlate-agent-manager-hover-bg: var(--vscode-list-hoverBackground);
				--cleanSlate-agent-manager-border: var(--vscode-panel-border);
					--cleanSlate-agent-manager-border-strong: var(--vscode-focusBorder);
					--cleanSlate-agent-manager-text: var(--vscode-foreground);
					/* Actually softer than full foreground — chat titles sit one tier
					   below project names. Was previously an alias of
					   foreground, which flattened the sidebar hierarchy. */
					--cleanSlate-agent-manager-text-soft: color-mix(in srgb, var(--vscode-foreground) 72%, var(--vscode-descriptionForeground));
					--cleanSlate-agent-manager-text-muted: var(--vscode-descriptionForeground);
				--cleanSlate-agent-manager-row-radius: 7px;
				--cleanSlate-agent-manager-shadow: var(--vscode-widget-shadow);
				position: relative;
				width: 100%;
				height: 100%;
			min-width: 0;
			min-height: 0;
			display: grid;
			grid-template-columns: var(--cleanSlate-agent-manager-nav-width) minmax(0, 1fr) 0;
			grid-template-rows: minmax(0, 1fr);
			box-sizing: border-box;
				background: var(--cleanSlate-agent-manager-surface-bg);
				color: var(--cleanSlate-agent-manager-text);
				font-family: var(--vscode-font-family);
				overflow: hidden;
			}

		.cleanSlate-agent-manager-surface:focus,
		.cleanSlate-agent-manager-surface:focus-visible {
			outline: none !important;
		}

		.cleanSlate-agent-manager-host-active button:focus,
		.cleanSlate-agent-manager-host-active button:focus-visible,
		.cleanSlate-agent-manager-host-active [role="button"]:focus,
		.cleanSlate-agent-manager-host-active [role="button"]:focus-visible,
		.cleanSlate-agent-manager-surface button:focus,
		.cleanSlate-agent-manager-surface button:focus-visible,
		.cleanSlate-agent-manager-surface [role="button"]:focus,
		.cleanSlate-agent-manager-surface [role="button"]:focus-visible {
			outline: none !important;
			box-shadow: none !important;
		}

		.cleanSlate-agent-manager-surface.integrated-titlebar {
			--cleanSlate-agent-workspace-titlebar-height: 40px;
			--cleanSlate-agent-manager-titlebar-content-left: calc(var(--cleanSlate-agent-manager-nav-width) + 18px);
			grid-template-rows: var(--cleanSlate-agent-workspace-titlebar-height) minmax(0, 1fr);
		}

		.cleanSlate-agent-manager-surface.right-pane-visible {
			grid-template-columns: var(--cleanSlate-agent-manager-nav-width) minmax(560px, 1fr) var(--cleanSlate-agent-manager-right-width);
		}

		.cleanSlate-agent-manager-surface.nav-collapsed {
			grid-template-columns: 0 minmax(0, 1fr) 0;
		}

		.cleanSlate-agent-manager-surface.nav-collapsed.right-pane-visible {
			grid-template-columns: 0 minmax(560px, 1fr) var(--cleanSlate-agent-manager-right-width);
		}

		.cleanSlate-agent-manager-surface.hidden {
			display: none;
		}

		.cleanSlate-agent-manager-integrated-titlebar-nav {
			grid-column: 1;
			grid-row: 1;
			position: relative;
			z-index: 2;
			min-width: 0;
			min-height: 0;
			box-sizing: border-box;
			border-right: 1px solid var(--cleanSlate-agent-manager-border);
			border-bottom: none;
			background: var(--cleanSlate-agent-manager-nav-bg);
			-webkit-app-region: drag;
		}

		.cleanSlate-agent-manager-integrated-titlebar-main {
			grid-column: 1 / -1;
			grid-row: 1;
			z-index: 1;
			min-width: 0;
			min-height: 0;
			display: flex;
			align-items: center;
			box-sizing: border-box;
			border-bottom: none;
			background: var(--cleanSlate-agent-manager-surface-bg);
			-webkit-app-region: drag;
		}

		.cleanSlate-agent-manager-integrated-titlebar-nav > .cleanSlate-agent-manager-nav-toggle-inline {
			position: absolute;
			top: 3px;
			left: 83px;
			width: 28px;
			height: 28px;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			border: 0;
			border-radius: 6px;
			background: transparent;
			color: var(--cleanSlate-agent-manager-text-muted);
			cursor: pointer;
			padding: 0;
			font-size: 16px;
			line-height: 1;
			pointer-events: auto;
			visibility: visible;
			transition: background-color 120ms ease, color 120ms ease;
			-webkit-app-region: no-drag;
		}

		.cleanSlate-agent-manager-integrated-titlebar-nav > .cleanSlate-agent-manager-nav-toggle-inline:hover {
			background: var(--vscode-toolbar-hoverBackground);
			color: var(--vscode-foreground);
		}

		.cleanSlate-agent-manager-surface ::-webkit-scrollbar {
			width: 8px;
			height: 8px;
		}

		.cleanSlate-agent-manager-surface ::-webkit-scrollbar-track {
			background: transparent !important;
		}

		.cleanSlate-agent-manager-surface ::-webkit-scrollbar-thumb {
			min-height: 28px;
			border: 2px solid transparent;
			border-radius: 999px;
			background: var(--vscode-scrollbarSlider-background);
			background-clip: padding-box;
		}

		.cleanSlate-agent-manager-surface ::-webkit-scrollbar-thumb:hover {
			background: var(--vscode-scrollbarSlider-hoverBackground);
			background-clip: padding-box;
		}

		.cleanSlate-agent-manager-nav {
			grid-column: 1;
			grid-row: 1;
			min-width: 0;
			min-height: 0;
					display: flex;
					flex-direction: column;
					gap: 2px;
					padding: 14px 10px 10px;
			box-sizing: border-box;
			border-right: 1px solid var(--cleanSlate-agent-manager-border);
				background: var(--cleanSlate-agent-manager-nav-bg);
				overflow: hidden;
				position: relative;
				will-change: opacity, transform;
		}

		.cleanSlate-agent-manager-surface.integrated-titlebar .cleanSlate-agent-manager-nav {
			grid-row: 2;
			padding-top: 10px;
		}

		.cleanSlate-agent-manager-surface.nav-collapsed .cleanSlate-agent-manager-nav {
			visibility: hidden;
			opacity: 0;
			transform: translateX(-10px);
			pointer-events: none;
			border-right-color: transparent;
		}

		.cleanSlate-agent-manager-surface.nav-collapsed .cleanSlate-agent-manager-resize-handle {
			display: none;
		}

		.cleanSlate-agent-manager-resize-handle {
			position: absolute;
			top: 0;
			bottom: 0;
			left: var(--cleanSlate-agent-manager-nav-width);
			z-index: 4;
			width: 8px;
			transform: translateX(-4px);
			cursor: col-resize;
			outline: 0;
		}

		.cleanSlate-agent-manager-resize-handle::before {
			content: '';
			position: absolute;
			top: 0;
			bottom: 0;
			left: 3px;
			width: 1px;
			background: transparent;
		}

		.cleanSlate-agent-manager-resize-handle:hover::before,
		.cleanSlate-agent-manager-resize-handle:focus-visible::before,
		.cleanSlate-agent-manager-surface.resizing-nav .cleanSlate-agent-manager-resize-handle::before {
			background: transparent;
		}

		.cleanSlate-agent-manager-surface.resizing-nav {
			user-select: none;
			transition: none !important;
		}

		.cleanSlate-agent-manager-surface.resizing-nav iframe,
		.cleanSlate-agent-manager-surface.resizing-nav webview {
			pointer-events: none !important;
		}

			.cleanSlate-agent-manager-main {
				grid-column: 2;
				grid-row: 1;
				min-width: 0;
				min-height: 0;
				display: flex;
				flex-direction: column;
				align-items: stretch;
				position: relative;
				overflow: hidden;
				background: var(--cleanSlate-agent-manager-surface-bg);
			}

		.cleanSlate-agent-manager-surface.integrated-titlebar .cleanSlate-agent-manager-main {
			grid-row: 2;
		}

		.cleanSlate-agent-manager-surface.right-pane-visible .cleanSlate-agent-manager-main {
			border-right: 1px solid var(--cleanSlate-agent-manager-border);
		}

		.cleanSlate-agent-manager-right-resize-handle {
			display: none;
			position: absolute;
			top: 0;
			bottom: 0;
			right: var(--cleanSlate-agent-manager-right-width);
			z-index: 5;
			width: 8px;
			transform: translateX(4px);
			cursor: col-resize;
			outline: 0;
		}

		.cleanSlate-agent-manager-surface.integrated-titlebar .cleanSlate-agent-manager-right-resize-handle {
			top: var(--cleanSlate-agent-workspace-titlebar-height);
		}

		.cleanSlate-agent-manager-surface.right-pane-visible .cleanSlate-agent-manager-right-resize-handle {
			display: block;
		}

		.cleanSlate-agent-manager-right-resize-handle::before {
			content: '';
			position: absolute;
			top: 0;
			bottom: 0;
			right: 3px;
			width: 1px;
			background: transparent;
		}

		.cleanSlate-agent-manager-right-resize-handle:hover::before,
		.cleanSlate-agent-manager-right-resize-handle:focus-visible::before,
		.cleanSlate-agent-manager-surface.resizing-right .cleanSlate-agent-manager-right-resize-handle::before {
			background: transparent;
		}

		.cleanSlate-agent-manager-surface.resizing-right {
			user-select: none;
			transition: none !important;
		}

		.cleanSlate-agent-manager-surface.resizing-right iframe,
		.cleanSlate-agent-manager-surface.resizing-right webview {
			pointer-events: none !important;
		}

		.cleanSlate-agent-manager-right-pane {
			grid-column: 3;
			grid-row: 1;
			display: flex;
			min-width: 0;
			min-height: 0;
			flex-direction: column;
			background: var(--cleanSlate-agent-manager-panel-bg);
			color: var(--cleanSlate-agent-manager-text);
			overflow: hidden;
			visibility: hidden;
			opacity: 0;
			transform: translateX(12px);
			pointer-events: none;
			will-change: opacity, transform;
		}

		.cleanSlate-agent-manager-surface.integrated-titlebar .cleanSlate-agent-manager-right-pane {
			grid-row: 2;
		}

		.cleanSlate-agent-manager-surface.right-pane-visible .cleanSlate-agent-manager-right-pane {
			visibility: visible;
			opacity: 1;
			transform: translateX(0);
			pointer-events: auto;
		}

		.cleanSlate-agent-manager-right-header {
			flex: 0 0 auto;
			min-height: 52px;
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 8px;
			padding: 8px 10px;
			box-sizing: border-box;
			border-bottom: 1px solid var(--cleanSlate-agent-manager-border);
			background: var(--cleanSlate-agent-manager-panel-bg);
		}

		.cleanSlate-agent-manager-right-pane.launcher > .cleanSlate-agent-manager-right-header {
			display: none;
		}

		.cleanSlate-agent-manager-right-header-main {
			min-width: 0;
			flex: 1 1 auto;
			display: flex;
			flex-direction: row;
			align-items: center;
			justify-content: flex-start;
			gap: 8px;
		}

		.cleanSlate-agent-manager-right-title {
			display: none;
		}

		.cleanSlate-agent-manager-right-tabs {
			min-width: 0;
			display: flex;
			align-items: center;
			gap: 4px;
			overflow-x: auto;
			scrollbar-width: none;
			order: 1;
		}

		.cleanSlate-agent-manager-right-tabs::-webkit-scrollbar {
			display: none;
		}

		.cleanSlate-agent-manager-right-tab {
			flex: 0 0 auto;
			height: 32px;
			display: inline-flex;
			align-items: center;
			gap: 6px;
			padding: 0 10px;
			box-sizing: border-box;
			border: 1px solid transparent;
			border-radius: 9px;
			background: transparent;
			color: var(--cleanSlate-agent-manager-text-muted);
			font-family: var(--vscode-font-family);
			font-size: 12px;
			font-weight: 600;
			cursor: pointer;
			transition: background-color 140ms var(--cleanSlate-agent-manager-ease), color 140ms var(--cleanSlate-agent-manager-ease), border-color 140ms var(--cleanSlate-agent-manager-ease);
		}

		.cleanSlate-agent-manager-right-tab:hover {
			background: var(--cleanSlate-agent-manager-card-bg);
			color: var(--cleanSlate-agent-manager-text);
		}

		.cleanSlate-agent-manager-right-tab:focus {
			outline: none !important;
			box-shadow: none !important;
			border-color: transparent !important;
		}

		.cleanSlate-agent-manager-right-tab:focus-visible {
			outline: none !important;
			box-shadow: none !important;
			border-color: transparent !important;
		}

		.cleanSlate-agent-manager-right-tab.active {
			background: var(--cleanSlate-agent-manager-card-bg);
			border-color: transparent !important;
			color: var(--cleanSlate-agent-manager-text);
		}

		.cleanSlate-agent-manager-right-tab-label {
			max-width: 140px;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.cleanSlate-agent-manager-right-tab-close {
			width: 16px;
			height: 16px;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			margin: 0 -2px 0 2px;
			border-radius: 4px;
			color: var(--cleanSlate-agent-manager-text-muted);
			opacity: 0;
			transition: opacity 120ms ease, background-color 120ms ease, color 120ms ease;
		}

		.cleanSlate-agent-manager-right-tab-close .codicon {
			font-size: 12px;
		}

		.cleanSlate-agent-manager-right-tab:hover .cleanSlate-agent-manager-right-tab-close,
		.cleanSlate-agent-manager-right-tab.active .cleanSlate-agent-manager-right-tab-close {
			opacity: 1;
		}

		.cleanSlate-agent-manager-right-tab-close:hover {
			background: var(--cleanSlate-agent-manager-card-hover-bg);
			color: var(--cleanSlate-agent-manager-text);
		}

		.cleanSlate-agent-manager-right-tab-add {
			width: 28px;
			height: 28px;
			flex: 0 0 auto;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			border: 0;
			border-radius: 7px;
			background: transparent;
			color: var(--cleanSlate-agent-manager-text-muted);
			cursor: pointer;
			padding: 0;
			transition: background-color 120ms ease, color 120ms ease;
		}

		.cleanSlate-agent-manager-right-tab-add:hover {
			background: var(--cleanSlate-agent-manager-card-bg);
			color: var(--cleanSlate-agent-manager-text);
		}

		/* Empty-pane launcher: centered stack of surface rows. */
		.cleanSlate-agent-manager-right-body.launcher {
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 24px 28px;
		}

		.cleanSlate-agent-manager-launcher {
			width: 100%;
			max-width: 560px;
			display: flex;
			flex-direction: column;
			gap: 10px;
		}

		.cleanSlate-agent-manager-launcher-row {
			display: flex;
			align-items: center;
			gap: 12px;
			width: 100%;
			min-height: 48px;
			padding: 0 16px;
			border: 0;
			border-radius: 10px;
			background: var(--cleanSlate-agent-manager-card-bg);
			color: var(--cleanSlate-agent-manager-text-soft);
			font-family: var(--vscode-font-family);
			font-size: 14px;
			text-align: left;
			cursor: pointer;
			box-sizing: border-box;
			transition: background-color 120ms ease, color 120ms ease;
		}

		.cleanSlate-agent-manager-launcher-row:hover {
			background: var(--cleanSlate-agent-manager-card-hover-bg);
			color: var(--cleanSlate-agent-manager-text);
		}

		.cleanSlate-agent-manager-launcher-icon {
			width: 20px;
			height: 20px;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			flex: 0 0 auto;
			color: var(--cleanSlate-agent-manager-text-muted);
			font-size: 16px;
		}

		.cleanSlate-agent-manager-launcher-row:hover .cleanSlate-agent-manager-launcher-icon {
			color: var(--cleanSlate-agent-manager-text);
		}

		/* File tab: embedded editor + workspace tree */
		.cleanSlate-agent-manager-right-body.file {
			display: block;
			overflow: hidden;
			padding: 0;
		}

		.cleanSlate-agent-manager-file {
			display: flex;
			width: 100%;
			height: 100%;
			min-height: 0;
		}

		.cleanSlate-agent-manager-file-editor {
			position: relative;
			flex: 1 1 auto;
			min-width: 0;
			height: 100%;
			overflow: hidden;
			background: var(--vscode-editor-background);
		}

		.cleanSlate-agent-manager-file-placeholder {
			position: absolute;
			inset: 0;
			display: flex;
			align-items: center;
			justify-content: center;
			color: var(--cleanSlate-agent-manager-text-muted);
			font-family: var(--vscode-font-family);
			font-size: 13px;
			pointer-events: none;
		}

		.cleanSlate-agent-manager-file-placeholder.hidden {
			display: none;
		}

		.cleanSlate-agent-manager-file-resizer {
			flex: 0 0 auto;
			width: 6px;
			height: 100%;
			margin: 0 -3px;
			z-index: 2;
			cursor: col-resize;
			background: transparent;
			position: relative;
		}

		.cleanSlate-agent-manager-file-resizer::after {
			content: "";
			position: absolute;
			top: 0;
			bottom: 0;
			left: 50%;
			width: 1px;
			transform: translateX(-50%);
			background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
			transition: background 120ms ease;
		}

		.cleanSlate-agent-manager-file-resizer:hover::after,
		.cleanSlate-agent-manager-file-resizer.resizing::after {
			background: var(--vscode-focusBorder, color-mix(in srgb, var(--vscode-foreground) 30%, transparent));
			width: 2px;
		}

		.cleanSlate-agent-manager-file-tree {
			flex: 0 0 auto;
			min-width: 160px;
			height: 100%;
			overflow: auto;
			padding: 8px 6px;
			box-sizing: border-box;
		}

		.cleanSlate-agent-manager-file-row {
			display: flex;
			align-items: center;
			gap: 6px;
			width: 100%;
			height: 24px;
			padding: 0 8px;
			border: 0;
			border-radius: 5px;
			background: transparent;
			color: var(--cleanSlate-agent-manager-text);
			font-family: var(--vscode-font-family);
			font-size: 13px;
			text-align: left;
			cursor: pointer;
			box-sizing: border-box;
		}

		.cleanSlate-agent-manager-file-row:hover {
			background: var(--vscode-list-hoverBackground, color-mix(in srgb, var(--vscode-foreground) 8%, transparent));
		}

		.cleanSlate-agent-manager-file-row.active {
			background: var(--vscode-list-activeSelectionBackground, color-mix(in srgb, var(--vscode-foreground) 14%, transparent));
			color: var(--vscode-list-activeSelectionForeground, var(--cleanSlate-agent-manager-text));
		}

		.cleanSlate-agent-manager-file-icon {
			flex: 0 0 auto;
			font-size: 14px;
			color: var(--cleanSlate-agent-manager-text-muted);
			transition: transform 120ms ease;
		}

		.cleanSlate-agent-manager-file-icon.expanded {
			transform: rotate(90deg);
		}

		.cleanSlate-agent-manager-file-name {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.cleanSlate-agent-manager-file-empty {
			padding: 16px;
			color: var(--cleanSlate-agent-manager-text-muted);
			font-size: 13px;
		}

		.cleanSlate-agent-manager-right-body {
			flex: 1 1 auto;
			min-width: 0;
			min-height: 0;
			overflow: auto;
			overscroll-behavior: contain;
			scrollbar-gutter: stable;
			padding: 24px 28px 36px;
			box-sizing: border-box;
			line-height: 1.6;
			background: var(--cleanSlate-agent-manager-panel-bg);
			scrollbar-width: thin;
			scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
		}

		.cleanSlate-agent-manager-right-body.browser {
			padding: 0;
			overflow: hidden;
			scrollbar-gutter: auto;
		}

		.cleanSlate-agent-manager-right-body.review {
			padding: 0;
			overflow: hidden;
			scrollbar-gutter: auto;
			line-height: 1.35;
		}

		.cleanSlate-agent-manager-right-body.terminal {
			padding: 0;
			overflow: hidden;
			scrollbar-gutter: auto;
			background: var(--vscode-terminal-background, var(--cleanSlate-agent-manager-panel-bg));
		}

		.cleanSlate-agent-manager-terminal-container {
			position: relative;
			width: 100%;
			height: 100%;
			min-width: 0;
			min-height: 0;
			padding: 10px 0;
			box-sizing: border-box;
			background: var(--vscode-terminal-background, var(--cleanSlate-agent-manager-panel-bg));
		}

		.cleanSlate-agent-manager-browser-shell {
			width: 100%;
			height: 100%;
			min-width: 0;
			min-height: 0;
			display: flex;
			flex-direction: column;
			background: var(--cleanSlate-agent-manager-panel-bg);
		}

		.cleanSlate-agent-manager-browser-shell > .cleanSlate-agent-manager-right-empty {
			flex: 1 1 auto;
			min-height: 0;
		}

		.cleanSlate-agent-manager-browser-toolbar {
			flex: 0 0 46px;
			min-width: 0;
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 7px 10px;
			box-sizing: border-box;
			border-bottom: 1px solid var(--cleanSlate-agent-manager-border);
			background: var(--cleanSlate-agent-manager-panel-bg);
		}

		.cleanSlate-agent-manager-browser-button {
			width: 30px;
			height: 30px;
			flex: 0 0 auto;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			border: 0;
			border-radius: 8px;
			background: transparent;
			color: var(--cleanSlate-agent-manager-text-muted);
			cursor: pointer;
			padding: 0;
			transition: background-color 120ms ease, color 120ms ease;
		}

		.cleanSlate-agent-manager-browser-button:hover:not(:disabled) {
			background: var(--cleanSlate-agent-manager-card-bg);
			color: var(--cleanSlate-agent-manager-text);
		}

		.cleanSlate-agent-manager-browser-button:disabled {
			opacity: 0.4;
			cursor: default;
		}

		.cleanSlate-agent-manager-browser-annotation-toggle {
			height: 30px;
			flex: 0 0 auto;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			gap: 6px;
			padding: 0 10px;
			box-sizing: border-box;
			border: 1px solid transparent;
			border-radius: 10px;
			background: transparent;
			color: var(--cleanSlate-agent-manager-text-muted);
			font-family: var(--vscode-font-family);
			font-size: 13px;
			line-height: 1;
			white-space: nowrap;
			cursor: pointer;
			transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
		}

		.cleanSlate-agent-manager-browser-annotation-toggle:hover {
			background: var(--cleanSlate-agent-manager-card-bg);
			color: var(--cleanSlate-agent-manager-text);
		}

		.cleanSlate-agent-manager-browser-annotation-toggle:focus-visible {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: 2px;
		}

		.cleanSlate-agent-manager-browser-annotation-toggle.active {
			background: var(--vscode-toolbar-activeBackground, var(--cleanSlate-agent-manager-card-bg));
			border-color: var(--vscode-focusBorder);
			color: var(--cleanSlate-agent-manager-text);
		}

		.cleanSlate-agent-manager-browser-address {
			flex: 1 1 auto;
			min-width: 0;
			height: 32px;
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 0 14px;
			box-sizing: border-box;
			border: 1px solid var(--cleanSlate-agent-manager-border);
			border-radius: 999px;
			background: var(--vscode-input-background);
			color: var(--cleanSlate-agent-manager-text-muted);
		}

		.cleanSlate-agent-manager-browser-address input {
			flex: 1 1 auto;
			min-width: 0;
			border: 0;
			outline: 0;
			background: transparent;
			color: var(--cleanSlate-agent-manager-text);
			font-family: var(--vscode-font-family);
			font-size: 13px;
		}

		.cleanSlate-agent-manager-browser-address:focus-within {
			border-color: var(--vscode-focusBorder);
			background: var(--vscode-input-background);
		}

		.cleanSlate-agent-manager-browser-viewport {
			position: relative;
			flex: 1 1 auto;
			min-width: 0;
			min-height: 0;
			overflow: hidden;
			overscroll-behavior: contain;
			background: var(--vscode-editor-background);
		}

		.cleanSlate-agent-manager-right-body::-webkit-scrollbar {
			width: 10px;
			height: 10px;
		}

		.cleanSlate-agent-manager-right-body::-webkit-scrollbar-track {
			background: transparent;
		}

		.cleanSlate-agent-manager-right-body::-webkit-scrollbar-thumb {
			background: var(--vscode-scrollbarSlider-background);
			border-radius: 999px;
			border: 2px solid transparent;
			background-clip: padding-box;
		}

		.cleanSlate-agent-manager-right-body::-webkit-scrollbar-thumb:hover {
			background: var(--vscode-scrollbarSlider-hoverBackground);
			background-clip: padding-box;
		}

		.cleanSlate-agent-manager-right-body::-webkit-scrollbar-thumb:active {
			background: var(--vscode-scrollbarSlider-activeBackground);
			background-clip: padding-box;
		}

		.cleanSlate-agent-manager-artifact-meta {
			display: flex;
			align-items: center;
			gap: 8px;
			margin: 0 0 18px;
		}

		.cleanSlate-agent-manager-artifact-kind {
			padding: 3px 8px;
			border-radius: 999px;
			background: var(--cleanSlate-agent-manager-card-bg);
			color: var(--cleanSlate-agent-manager-text);
			font-size: 11px;
			font-weight: 700;
			text-transform: uppercase;
		}

		.cleanSlate-agent-manager-artifact-copy {
			margin-left: auto;
			display: inline-flex;
			align-items: center;
			gap: 6px;
			padding: 5px 9px;
			border: 1px solid var(--vscode-button-border, transparent);
			border-radius: 5px;
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			font: inherit;
			font-size: 12px;
			cursor: pointer;
		}

		.cleanSlate-agent-manager-artifact-copy:hover {
			background: var(--vscode-button-secondaryHoverBackground);
		}

		.cleanSlate-agent-manager-artifact-copy:focus-visible {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: 2px;
		}

		.cleanSlate-agent-manager-artifact-content {
			user-select: text;
			-webkit-user-select: text;
		}

		.cleanSlate-agent-manager-right-empty {
			min-height: 100%;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 8px;
			padding: 24px;
			box-sizing: border-box;
			text-align: center;
			color: var(--cleanSlate-agent-manager-text-muted);
		}

		.cleanSlate-agent-manager-right-empty-icon {
			width: auto;
			height: auto;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			color: var(--cleanSlate-agent-manager-text-muted);
			font-size: 28px;
			line-height: 1;
			margin-bottom: 8px;
		}

		.cleanSlate-agent-manager-right-empty-icon::before {
			line-height: 1;
		}

		.cleanSlate-agent-manager-right-empty-title {
			color: var(--cleanSlate-agent-manager-text);
			font-size: 13px;
			font-weight: 700;
		}

		.cleanSlate-agent-manager-right-empty-description {
			max-width: 280px;
			font-size: 11px;
			line-height: 1.5;
		}

		.cleanSlate-agent-manager-right-body h1 {
			font-size: 28px;
			line-height: 1.18;
			margin: 0 0 18px;
		}

		.cleanSlate-agent-manager-right-body h2 {
			font-size: 18px;
			line-height: 1.3;
			margin: 28px 0 12px;
		}

		.cleanSlate-agent-manager-right-body h3 {
			font-size: 15px;
			margin: 22px 0 8px;
		}

		.cleanSlate-agent-manager-right-body p,
		.cleanSlate-agent-manager-right-body ul,
		.cleanSlate-agent-manager-right-body ol {
			margin-top: 0;
			margin-bottom: 14px;
		}

		.cleanSlate-agent-manager-right-body code {
			background: var(--vscode-textCodeBlock-background);
			border: 1px solid var(--cleanSlate-agent-manager-border);
			border-radius: 6px;
			padding: 1px 5px;
		}

			.cleanSlate-agent-manager-nav-button,
			.cleanSlate-agent-manager-project,
			.cleanSlate-agent-manager-session {
				width: 100%;
				min-width: 0;
				border: 0;
				border-radius: var(--cleanSlate-agent-manager-row-radius);
				background: transparent;
				color: var(--cleanSlate-agent-manager-text-soft);
				font-family: var(--vscode-font-family);
				text-align: left;
				cursor: pointer;
				box-sizing: border-box;
				outline: 0;
				transition: background-color 120ms ease, color 120ms ease, opacity 120ms ease;
			}

			.cleanSlate-agent-manager-nav-button {
				height: 30px;
				display: flex;
				align-items: center;
				gap: 10px;
				padding: 0 9px;
				font-size: 13px;
				color: var(--cleanSlate-agent-manager-text-soft);
			}

			.cleanSlate-agent-manager-new-chat {
				color: var(--cleanSlate-agent-manager-text);
			}

				.cleanSlate-agent-manager-nav-button > .codicon {
					width: 18px;
					height: 18px;
					display: inline-flex;
				align-items: center;
				justify-content: center;
				flex: 0 0 auto;
				color: currentColor;
				font-size: 16px;
					opacity: 0.9;
				}

				.cleanSlate-agent-manager-search {
					height: 30px;
				display: flex;
				align-items: center;
				gap: 10px;
				margin: 0 0 8px;
				padding: 0 9px;
				border-radius: var(--cleanSlate-agent-manager-row-radius);
				color: var(--cleanSlate-agent-manager-text-muted);
				background: transparent;
				border: 1px solid transparent;
				box-sizing: border-box;
				transition: border-color 120ms ease, background-color 120ms ease, color 120ms ease;
			}

			.cleanSlate-agent-manager-search:hover {
				background: var(--cleanSlate-agent-manager-card-hover-bg);
				color: var(--cleanSlate-agent-manager-text-soft);
			}

			.cleanSlate-agent-manager-search:focus-within {
				border-color: var(--cleanSlate-agent-manager-row-border);
				background: var(--cleanSlate-agent-manager-card-hover-bg);
				color: var(--cleanSlate-agent-manager-text);
			}

			.cleanSlate-agent-manager-search > .codicon {
				width: 18px;
				height: 18px;
				display: inline-flex;
				align-items: center;
				justify-content: center;
				flex: 0 0 auto;
				font-size: 16px;
			}

		.cleanSlate-agent-manager-search input {
			flex: 1 1 auto;
			min-width: 0;
			border: 0;
			outline: 0;
				background: transparent;
				color: var(--cleanSlate-agent-manager-text);
				font-family: var(--vscode-font-family);
				font-size: 13px;
			}

			.cleanSlate-agent-manager-search input::placeholder {
				color: var(--cleanSlate-agent-manager-text-muted);
				opacity: 0.95;
			}

			.cleanSlate-agent-manager-projects {
				min-width: 0;
				flex: 1 1 auto;
				min-height: 0;
				padding-right: 2px;
				overflow: auto;
			overscroll-behavior: contain;
			scrollbar-gutter: stable;
			scrollbar-width: thin;
			scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
		}

		.cleanSlate-agent-manager-projects::-webkit-scrollbar {
			width: 10px;
			height: 10px;
		}

		.cleanSlate-agent-manager-projects::-webkit-scrollbar-track {
			background: transparent;
		}

		.cleanSlate-agent-manager-projects::-webkit-scrollbar-thumb {
			min-height: 28px;
			border: 2px solid transparent;
			border-radius: 999px;
			background: var(--vscode-scrollbarSlider-background);
			background-clip: padding-box;
		}

		.cleanSlate-agent-manager-projects::-webkit-scrollbar-thumb:hover {
			background: var(--vscode-scrollbarSlider-hoverBackground);
			background-clip: padding-box;
		}

		.cleanSlate-agent-manager-projects::-webkit-scrollbar-thumb:active {
			background: var(--vscode-scrollbarSlider-activeBackground);
			background-clip: padding-box;
		}

			.cleanSlate-agent-manager-section-label {
				padding: 10px 8px 5px;
				color: var(--cleanSlate-agent-manager-text-muted);
				font-size: 12px;
				font-weight: 600;
				line-height: 1.3;
				letter-spacing: 0;
				opacity: 0.82;
			}

			.cleanSlate-agent-manager-project-group {
				min-width: 0;
				margin-bottom: 3px;
			}

			.cleanSlate-agent-manager-loading-group {
				padding: 2px 0 4px;
			}

			.cleanSlate-agent-manager-project-chats {
				min-width: 0;
				display: flex;
				flex-direction: column;
				gap: 1px;
				margin: 1px 8px 6px 20px;
			}

			.cleanSlate-agent-manager-project,
			.cleanSlate-agent-manager-session {
				display: grid;
				align-items: center;
				gap: 8px;
				min-height: 28px;
				padding: 3px 8px;
				position: relative;
			}

			.cleanSlate-agent-manager-project {
				grid-template-columns: 18px minmax(0, 1fr) 22px 22px;
				color: var(--cleanSlate-agent-manager-text);
			}

			.cleanSlate-agent-manager-session {
				grid-template-columns: minmax(0, 1fr) 18px auto;
				padding-left: 12px;
			}

			.session-meta {
				position: relative;
				min-width: 22px;
				height: 20px;
				display: inline-flex;
				align-items: center;
				justify-content: flex-end;
			}

			/* The trailing slot stays empty until the row reveals Delete on hover. */
			.session-meta .cleanSlate-agent-manager-delete-chat {
				position: absolute;
				right: 0;
				top: 50%;
				transform: translateY(-50%);
			}

			.cleanSlate-agent-manager-project.cleanSlate-agent-manager-skeleton-row,
			.cleanSlate-agent-manager-session.cleanSlate-agent-manager-skeleton-row {
				pointer-events: none;
			}

			.cleanSlate-agent-manager-project.cleanSlate-agent-manager-skeleton-row {
				grid-template-columns: 18px minmax(0, 1fr) 22px;
				column-gap: 8px;
			}

			.cleanSlate-agent-manager-session.cleanSlate-agent-manager-skeleton-row {
				grid-template-columns: minmax(0, 1fr);
				padding-left: 8px;
			}

			.cleanSlate-agent-manager-project.cleanSlate-agent-manager-skeleton-row .project-copy,
			.cleanSlate-agent-manager-session.cleanSlate-agent-manager-skeleton-row .project-copy {
				min-width: 0;
			}

			.cleanSlate-agent-manager-nav-button:hover,
			.cleanSlate-agent-manager-project:hover,
			.cleanSlate-agent-manager-session:hover {
				background: var(--cleanSlate-agent-manager-card-hover-bg);
				color: var(--cleanSlate-agent-manager-text);
			}

			.cleanSlate-agent-manager-nav-button:focus-visible,
			.cleanSlate-agent-manager-project:focus-visible,
			.cleanSlate-agent-manager-session:focus-visible,
			.cleanSlate-agent-manager-nav-toggle-left:focus-visible,
			.cleanSlate-agent-manager-nav-toggle-inline:focus-visible {
				outline: none !important;
				box-shadow: none !important;
			}

			.cleanSlate-agent-manager-project.active {
				background: var(--cleanSlate-agent-manager-project-active-bg);
				color: var(--cleanSlate-agent-manager-text);
			}

			.cleanSlate-agent-manager-project.active.has-active-session {
				background: transparent;
			}

			.cleanSlate-agent-manager-project.active.has-active-session:hover {
				background: var(--cleanSlate-agent-manager-card-hover-bg);
			}

			.cleanSlate-agent-manager-project.has-active-session:not(.active) {
				color: var(--cleanSlate-agent-manager-text);
			}

			.cleanSlate-agent-manager-session.active {
				background: var(--cleanSlate-agent-manager-active-bg);
				color: var(--cleanSlate-agent-manager-text);
				box-shadow: none;
			}

			.cleanSlate-agent-manager-session.active::before {
				content: none;
			}

		.cleanSlate-agent-manager-session-running {
			width: 18px;
			height: 18px;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			color: var(--vscode-progressBar-background, var(--vscode-focusBorder));
			font-size: 13px;
			line-height: 1;
			opacity: 0;
			pointer-events: none;
		}

		.cleanSlate-agent-manager-session.running .cleanSlate-agent-manager-session-running {
			opacity: 0.9;
		}

			.project-icon {
				width: 18px;
				height: 18px;
				display: inline-flex;
				align-items: center;
				justify-content: center;
				color: currentColor;
				font-size: 15px;
				line-height: 1;
				opacity: 0.68;
			}

			.cleanSlate-agent-manager-project.active .project-icon,
			.cleanSlate-agent-manager-project.has-active-session .project-icon {
				opacity: 0.9;
			}

		.project-copy,
		.session-copy {
			min-width: 0;
			display: flex;
			flex-direction: column;
			gap: 1px;
		}

		.project-title,
		.session-title {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

			.project-title,
			.session-title {
				font-size: 13px;
				line-height: 1.3;
				color: currentColor;
			}

			.project-title {
				font-weight: 500;
			}

			.session-title {
				font-weight: 400;
			}

		.cleanSlate-agent-manager-empty {
			font-size: 11px;
			color: var(--cleanSlate-agent-manager-text-muted);
		}

		.cleanSlate-agent-manager-empty {
			padding: 8px 10px;
		}

		.cleanSlate-agent-manager-project-menu,
		.cleanSlate-agent-manager-project-new-chat,
		.cleanSlate-agent-manager-delete-chat {
				width: 20px;
				height: 20px;
			display: inline-flex;
			align-items: center;
			justify-content: center;
				border-radius: 6px;
				color: var(--cleanSlate-agent-manager-text-muted);
				opacity: 0;
				transition: background-color 120ms ease, color 120ms ease, opacity 120ms ease;
			}

		.cleanSlate-agent-manager-project:hover .cleanSlate-agent-manager-project-new-chat,
		.cleanSlate-agent-manager-project:focus-visible .cleanSlate-agent-manager-project-new-chat,
		.cleanSlate-agent-manager-project:hover .cleanSlate-agent-manager-project-menu,
		.cleanSlate-agent-manager-project:focus-visible .cleanSlate-agent-manager-project-menu,
		.cleanSlate-agent-manager-session:hover .cleanSlate-agent-manager-delete-chat,
		.cleanSlate-agent-manager-session:focus-visible .cleanSlate-agent-manager-delete-chat {
			opacity: 1;
		}

		.cleanSlate-agent-manager-project-menu:hover,
		.cleanSlate-agent-manager-project-new-chat:hover,
		.cleanSlate-agent-manager-delete-chat:hover {
			background: var(--cleanSlate-agent-manager-card-hover-bg);
		}

		.cleanSlate-agent-manager-project-new-chat:hover {
			color: var(--cleanSlate-agent-manager-text);
			opacity: 1;
		}

		.cleanSlate-agent-manager-project-new-chat {
			width: 18px;
			height: 18px;
			border-radius: 5px;
			font-size: 13px;
		}

		.cleanSlate-agent-manager-delete-chat:hover {
			color: var(--vscode-errorForeground);
		}

		.cleanSlate-agent-manager-footer {
			flex: 0 0 auto;
			position: relative;
			padding-top: 8px;
			border-top: 1px solid var(--cleanSlate-agent-manager-border);
		}

		/* Account + settings share one compact row. */
		.cleanSlate-agent-manager-footer-row {
			display: flex;
			align-items: center;
			gap: 2px;
			min-width: 0;
		}

		.cleanSlate-agent-manager-footer-row .cleanSlate-agent-manager-account {
			flex: 1 1 auto;
			min-width: 0;
			position: relative;
		}

		/* Sole cue that a pending update is parked inside the account popover. Trailing
		   rather than over the avatar, which can be a photo — a badge on top of one reads
		   as a presence indicator. Accent blue so it carries against the muted footer. */
		/* Parent in the selector to out-weigh the nav-button codicon rule above, which
		   would otherwise fix the size. Colour is left to inherit with the rest of the
		   footer row. */
		.cleanSlate-agent-manager-nav-button > .cleanSlate-agent-manager-account-update-badge {
			flex: 0 0 auto;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 20px;
			height: 20px;
			margin-left: auto;
			border-radius: 6px;
			font-size: 15px;
		}

		.cleanSlate-agent-manager-account-update-badge.hidden {
			display: none;
		}

		.cleanSlate-agent-manager-footer-settings {
			flex: 0 0 auto;
			width: 30px;
			height: 30px;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			border: 0;
			border-radius: var(--cleanSlate-agent-manager-row-radius);
			background: transparent;
			color: var(--cleanSlate-agent-manager-text-muted);
			cursor: pointer;
			padding: 0;
			font-size: 15px;
			transition: background-color 120ms ease, color 120ms ease;
		}

		.cleanSlate-agent-manager-footer-settings:hover {
			background: var(--cleanSlate-agent-manager-card-hover-bg);
			color: var(--cleanSlate-agent-manager-text);
		}

		.cleanSlate-agent-manager-account.hidden {
			display: none;
		}

		.cleanSlate-agent-manager-account-avatar {
			width: 20px;
			height: 20px;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			flex: 0 0 auto;
			border-radius: 50%;
			background-position: center;
			background-size: cover;
			font-size: 18px;
		}

		.cleanSlate-agent-manager-account-avatar.has-image {
			box-shadow: inset 0 0 0 1px var(--cleanSlate-agent-manager-border);
		}

		.cleanSlate-agent-manager-account-name {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.cleanSlate-agent-manager-account-popover {
			position: absolute;
			left: 0;
			right: 0;
			bottom: calc(100% + 8px);
			z-index: 20;
			padding: 12px;
			border: 1px solid var(--cleanSlate-agent-manager-border);
			border-radius: 10px;
			background: var(--vscode-menu-background);
			color: var(--vscode-menu-foreground);
			box-shadow: 0 8px 24px var(--vscode-widget-shadow);
		}

		.cleanSlate-agent-manager-account-popover.hidden,
		.cleanSlate-agent-manager-account-email.hidden,
		.cleanSlate-agent-manager-account-signed-in.hidden,
		.cleanSlate-agent-manager-account-signed-out.hidden,
		.cleanSlate-agent-manager-account-actions.hidden,
		.cleanSlate-agent-manager-account-confirm.hidden {
			display: none;
		}

		.cleanSlate-agent-manager-account-summary {
			display: flex;
			align-items: center;
			gap: 10px;
			min-width: 0;
			padding-bottom: 10px;
		}

		.cleanSlate-agent-manager-account-summary .cleanSlate-agent-manager-account-avatar {
			width: 30px;
			height: 30px;
			font-size: 24px;
		}

		.cleanSlate-agent-manager-account-identity {
			min-width: 0;
		}

		.cleanSlate-agent-manager-account-popover-name,
		.cleanSlate-agent-manager-account-email {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.cleanSlate-agent-manager-account-popover-name {
			font-size: 13px;
			font-weight: 600;
		}

		.cleanSlate-agent-manager-account-email {
			margin-top: 2px;
			color: var(--cleanSlate-agent-manager-text-muted);
			font-size: 11px;
		}

		.cleanSlate-agent-manager-account-actions,
		.cleanSlate-agent-manager-account-update-actions {
			padding-top: 8px;
			border-top: 1px solid var(--cleanSlate-agent-manager-border);
		}

		/* Sits below the account block and stays put while the sign-out confirmation
		   swaps in above it, so the row does not jump. */
		.cleanSlate-agent-manager-account-update-actions {
			margin-top: 8px;
		}

		.cleanSlate-agent-manager-account-action:disabled {
			opacity: .6;
			cursor: default;
		}

		.cleanSlate-agent-manager-account-action:disabled:hover {
			background: transparent;
			color: inherit;
		}

		.cleanSlate-agent-manager-account-action {
			width: 100%;
			height: 30px;
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 0 8px;
			border: 0;
			border-radius: 6px;
			background: transparent;
			color: inherit;
			font-family: var(--vscode-font-family);
			text-align: left;
			cursor: pointer;
		}

		.cleanSlate-agent-manager-account-action:hover,
		.cleanSlate-agent-manager-account-action:focus-visible {
			background: var(--vscode-menu-selectionBackground);
			color: var(--vscode-menu-selectionForeground);
			outline: 0;
		}

		.cleanSlate-agent-manager-account-confirm > span {
			display: block;
			margin-bottom: 10px;
			font-size: 12px;
		}

		.cleanSlate-agent-manager-account-confirm-actions {
			display: flex;
			justify-content: flex-end;
			gap: 6px;
		}

		.cleanSlate-agent-manager-account-confirm-actions button {
			height: 28px;
			padding: 0 10px;
			border: 1px solid var(--vscode-button-border, transparent);
			border-radius: 5px;
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			font-family: var(--vscode-font-family);
			cursor: pointer;
		}

		.cleanSlate-agent-manager-account-confirm-actions button.primary {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
		}

		.cleanSlate-agent-manager-account-signed-out-message {
			margin-bottom: 10px;
			color: var(--cleanSlate-agent-manager-text-muted);
			font-size: 12px;
			line-height: 1.4;
		}

		.cleanSlate-agent-manager-account-sign-in {
			width: 100%;
			height: 30px;
			border: 1px solid var(--vscode-button-border, transparent);
			border-radius: 5px;
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			font-family: var(--vscode-font-family);
			cursor: pointer;
		}

			.cleanSlate-agent-manager-header {
				flex: 0 0 52px;
				min-width: 0;
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 8px;
				padding: 0 12px 0 16px;
				box-sizing: border-box;
				border-bottom: 1px solid var(--cleanSlate-agent-manager-border);
				background: var(--cleanSlate-agent-manager-surface-bg);
			}

			.cleanSlate-agent-manager-header.in-window-titlebar {
				flex: 1 1 auto;
				width: 100%;
				height: 100%;
				padding: 0 12px 0 var(--cleanSlate-agent-manager-titlebar-content-left);
				border-bottom: 0;
				background: transparent;
				-webkit-app-region: no-drag;
			}

		.cleanSlate-agent-manager-titlebar {
			min-width: 0;
			display: inline-flex;
			align-items: center;
			gap: 9px;
			color: var(--cleanSlate-agent-manager-text);
		}

		.cleanSlate-agent-manager-title {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			font-size: 15px;
			font-weight: 650;
			line-height: 1.2;
			letter-spacing: 0;
		}

		.cleanSlate-agent-manager-header-actions {
			flex: 0 0 auto;
			display: inline-flex;
			align-items: center;
			gap: 4px;
			-webkit-app-region: no-drag;
		}

		.cleanSlate-agent-manager-update {
			height: 28px;
			display: inline-flex;
			align-items: center;
			gap: 6px;
			padding: 0 9px;
			border: 1px solid color-mix(in srgb, var(--vscode-textLink-foreground) 35%, transparent);
			border-radius: 7px;
			background: color-mix(in srgb, var(--vscode-textLink-foreground) 10%, transparent);
			color: var(--vscode-textLink-foreground);
			font-family: var(--vscode-font-family);
			font-size: 12px;
			font-weight: 500;
			cursor: pointer;
			-webkit-app-region: no-drag;
		}

		.cleanSlate-agent-manager-update.hidden {
			display: none;
		}

		.cleanSlate-agent-manager-update:hover:not(:disabled) {
			background: color-mix(in srgb, var(--vscode-textLink-foreground) 17%, transparent);
		}

		.cleanSlate-agent-manager-update:disabled {
			opacity: .75;
			cursor: default;
		}

		.cleanSlate-agent-manager-update .codicon {
			font-size: 14px;
		}

		/* Quiet header controls: borderless muted-gray
		   text/icon buttons that only gain a soft background on hover. */
		.cleanSlate-agent-manager-pane-toggle {
			width: 30px;
			height: 30px;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			border: none;
			border-radius: 7px;
			background: transparent;
			color: var(--cleanSlate-agent-manager-text-muted);
			cursor: pointer;
			padding: 0;
			transition: background-color 120ms ease, color 120ms ease;
			-webkit-app-region: no-drag;
		}

		.cleanSlate-agent-manager-pane-toggle .codicon {
			font-size: 16px;
		}

		/* Outline panel glyph when closed; swaps to the filled
		   layout-sidebar-right (0xebf4) while the pane is open. */
		.cleanSlate-agent-manager-pane-toggle.active .codicon-layout-sidebar-right-off::before {
			content: "\\ebf4";
		}

		.cleanSlate-agent-manager-pane-toggle:hover,
		.cleanSlate-agent-manager-pane-toggle.active {
			background: var(--cleanSlate-agent-manager-card-bg);
			color: var(--cleanSlate-agent-manager-text);
		}

		.cleanSlate-agent-manager-exit {
			height: 30px;
			display: inline-flex;
			align-items: center;
			gap: 4px;
			border: none;
			border-radius: 7px;
			background: transparent;
			color: var(--cleanSlate-agent-manager-text-muted);
			font-family: var(--vscode-font-family);
			font-size: 13px;
			cursor: pointer;
			padding: 0 9px;
			transition: background-color 120ms ease, color 120ms ease;
			-webkit-app-region: no-drag;
		}

		/* Bare ↗ — no diagonal-arrow codicon exists, so rotate arrow-right. */
		.cleanSlate-agent-manager-exit .codicon-arrow-right {
			font-size: 12px;
			transform: rotate(-45deg);
		}

		.cleanSlate-agent-manager-exit:hover {
			background: var(--cleanSlate-agent-manager-card-bg);
			color: var(--cleanSlate-agent-manager-text);
		}

			.cleanSlate-agent-manager-chat.cleanSlate-chat-view {
				--cleanSlate-agent-manager-bottom-height: 150px;
				--cleanSlate-agent-manager-content-width: 1080px;
				flex: 1 1 0;
				width: 100%;
				min-width: 0;
				min-height: 0;
				display: flex;
				flex-direction: column;
				align-items: center;
				position: relative;
			overflow: hidden;
			background: var(--cleanSlate-agent-manager-surface-bg);
		}

		.cleanSlate-agent-manager-startup-loading {
			position: absolute;
			inset: 0;
			z-index: 20;
			display: none;
			pointer-events: none;
			background: var(--cleanSlate-agent-manager-surface-bg);
		}

		.cleanSlate-agent-manager-startup-loading.visible {
			display: flex;
			align-items: center;
			justify-content: center;
			box-sizing: border-box;
		}

		.cleanSlate-agent-manager-loading-container {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 12px;
		}

		.cleanSlate-agent-manager-loading-dots {
			display: flex;
			align-items: center;
			gap: 6px;
		}

		.cleanSlate-agent-manager-loading-dot {
			width: 6px;
			height: 6px;
			border-radius: 50%;
			background-color: var(--vscode-foreground);
			opacity: 0.35;
			animation: cleanSlateDotPulse 1.4s infinite ease-in-out both;
		}

		.cleanSlate-agent-manager-loading-dot:nth-child(1) {
			animation-delay: -0.32s;
		}

		.cleanSlate-agent-manager-loading-dot:nth-child(2) {
			animation-delay: -0.16s;
		}

		@keyframes cleanSlateDotPulse {
			0%, 80%, 100% {
				transform: scale(0.85);
				opacity: 0.35;
			}
			40% {
				transform: scale(1.15);
				opacity: 1;
			}
		}

		.cleanSlate-agent-manager-loading-text {
			font-size: 11px;
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
			color: var(--vscode-descriptionForeground);
			letter-spacing: 0.2px;
		}

		/* --- Inline settings overlay --- */

			.cleanSlate-agent-manager-settings-overlay {
				position: absolute;
				inset: 0;
				z-index: 60;
				display: none;
				min-width: 0;
				min-height: 0;
				background: var(--vscode-editor-background);
				pointer-events: all;
				overflow: hidden;
			}

			.cleanSlate-agent-manager-settings-overlay.visible {
				display: block;
			}

			.cleanSlate-agent-manager-settings-save-status {
				position: absolute;
				top: 76px;
				right: 36px;
				z-index: 2;
			}

		.cleanSlate-settings-panel-header {
			flex: 0 0 auto;
			display: flex;
			align-items: center;
			gap: 12px;
			height: 48px;
			padding: 0 18px;
			border-bottom: 1px solid var(--vscode-editorGroup-border, var(--vscode-sideBar-border));
			background: var(--vscode-editor-background);
		}

		.cleanSlate-settings-panel-title {
			font-size: 14px;
			font-weight: 650;
			color: var(--vscode-foreground);
			flex: 1 1 auto;
		}

		.cleanSlate-settings-panel-close {
			width: 28px;
			height: 28px;
			display: flex;
			align-items: center;
			justify-content: center;
			border: 0;
			border-radius: 5px;
			background: transparent;
			color: var(--vscode-foreground);
			cursor: pointer;
			font-size: 14px;
			line-height: 1;
			opacity: 0.7;
			flex: 0 0 auto;
		}

		.cleanSlate-settings-panel-close:hover {
			background: var(--vscode-list-hoverBackground);
			opacity: 1;
		}

			.cleanSlate-settings-panel-shell {
				width: 100%;
				height: 100%;
				min-height: 0;
				min-width: 0;
				display: grid;
				grid-template-columns: 320px minmax(0, 1fr);
				overflow: hidden;
			}

			.cleanSlate-settings-sidebar {
				box-sizing: border-box;
				padding: 64px 12px 24px;
				background: var(--vscode-sideBar-background);
				border-right: 1px solid var(--vscode-editorGroup-border, var(--vscode-sideBar-border));
				overflow-y: auto;
				scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
				scrollbar-width: thin;
			}

			.cleanSlate-settings-sidebar-header {
				display: flex;
				flex-direction: column;
				gap: 16px;
				margin: 0 0 22px;
			}

			.cleanSlate-settings-back {
				width: 100%;
				height: 34px;
				display: inline-flex;
				align-items: center;
				gap: 10px;
				box-sizing: border-box;
				padding: 0 10px;
				border: 0;
				border-radius: 6px;
				background: transparent;
				color: var(--vscode-descriptionForeground);
				font: inherit;
				font-size: 14px;
				cursor: pointer;
				text-align: left;
			}

			.cleanSlate-settings-back:hover {
				background: var(--vscode-list-hoverBackground);
				color: var(--vscode-foreground);
			}

		.cleanSlate-settings-nav {
			display: flex;
			flex-direction: column;
			gap: 4px;
		}

		.cleanSlate-settings-nav-item {
			width: 100%;
			height: 34px;
			display: flex;
			align-items: center;
			gap: 10px;
			padding: 0 10px;
			border: 0;
			border-radius: 5px;
			background: transparent;
			color: var(--vscode-descriptionForeground);
			text-align: left;
			font: inherit;
			cursor: pointer;
		}

		.cleanSlate-settings-nav-item:hover {
			background: var(--vscode-list-hoverBackground, color-mix(in srgb, var(--vscode-editor-foreground) 8%, transparent));
			color: var(--vscode-foreground);
		}

		.cleanSlate-settings-nav-item.active {
			background: var(--vscode-list-activeSelectionBackground, color-mix(in srgb, var(--vscode-focusBorder) 18%, transparent));
			color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
			box-shadow: inset 2px 0 0 var(--vscode-focusBorder);
		}

			.cleanSlate-settings-content {
				box-sizing: border-box;
				min-width: 0;
				min-height: 0;
				overflow-y: auto;
				overflow-x: hidden;
				padding: 56px 48px 160px;
				scroll-behavior: smooth;
				scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
				scrollbar-width: thin;
			}

		.cleanSlate-settings-sidebar::-webkit-scrollbar,
		.cleanSlate-settings-content::-webkit-scrollbar {
			width: 10px;
		}

		.cleanSlate-settings-sidebar::-webkit-scrollbar-track,
		.cleanSlate-settings-content::-webkit-scrollbar-track {
			background: transparent;
		}

		.cleanSlate-settings-sidebar::-webkit-scrollbar-thumb,
		.cleanSlate-settings-content::-webkit-scrollbar-thumb {
			background: var(--vscode-scrollbarSlider-background, rgba(121, 121, 121, 0.4));
			border: 3px solid transparent;
			border-radius: 999px;
			background-clip: content-box;
		}

		.cleanSlate-settings-sidebar::-webkit-scrollbar-thumb:hover,
		.cleanSlate-settings-content::-webkit-scrollbar-thumb:hover {
			background: var(--vscode-scrollbarSlider-hoverBackground, rgba(100, 100, 100, 0.55));
			background-clip: content-box;
		}

		.cleanSlate-settings-save-status {
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
			white-space: nowrap;
		}

		.cleanSlate-settings-save-status.saved {
			color: var(--vscode-testing-iconPassed, #35a56a);
		}

			.cleanSlate-settings-page-section {
				width: 100%;
				max-width: 900px;
				margin: 0 auto 36px;
				scroll-margin-top: 24px;
			}

		.cleanSlate-settings-page-section-title {
			margin: 0 0 14px;
			font-size: 17px;
			line-height: 21px;
			font-weight: 500;
			color: var(--vscode-foreground);
		}

		.cleanSlate-settings-section {
			margin: 0 0 22px;
		}

		.cleanSlate-settings-section-header {
			display: flex;
			align-items: flex-start;
			margin: 0 0 9px;
			color: var(--vscode-descriptionForeground);
		}

		.cleanSlate-settings-section-header h2 {
			margin: 0;
			font-size: 12px;
			line-height: 16px;
			font-weight: 400;
			color: var(--vscode-descriptionForeground);
		}

			.cleanSlate-settings-group {
				min-width: 0;
				background: color-mix(in srgb, var(--vscode-foreground) 4.5%, transparent);
				border-radius: 12px;
				overflow: visible;
			}

			.cleanSlate-settings-row {
				position: relative;
				display: grid;
				grid-template-columns: minmax(0, 1fr) minmax(160px, 320px);
				align-items: center;
				gap: 20px;
				box-sizing: border-box;
				padding: 12px 14px;
		}

		.cleanSlate-settings-row + .cleanSlate-settings-row::before {
			content: "";
			position: absolute;
			top: 0;
			left: 12px;
			right: 12px;
			height: 1px;
			background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
		}

			.cleanSlate-settings-label {
				font-size: 13px;
				line-height: 18px;
				font-weight: 400;
				color: var(--vscode-foreground);
				overflow-wrap: anywhere;
			}

		.cleanSlate-settings-description {
			margin-top: 1px;
			font-size: 13px;
			line-height: 18px;
			font-weight: 400;
			color: var(--vscode-descriptionForeground);
		}

			.cleanSlate-settings-value {
				width: 100%;
				min-width: 0;
				display: flex;
				justify-content: flex-end;
			}

		.cleanSlate-settings-control {
			box-sizing: border-box;
			width: 100%;
			min-width: 0;
			height: 28px;
			padding: 4px 9px;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border, transparent);
			border-radius: 5px;
			font-size: 12px;
			font-family: var(--vscode-font-family);
			outline: none;
		}

		.cleanSlate-settings-control:focus {
			border-color: var(--vscode-focusBorder);
		}

			.cleanSlate-settings-control:disabled {
				opacity: 0.68;
				cursor: default;
			}

			.cleanSlate-settings-toggle {
				width: 40px;
				height: 22px;
				flex: 0 0 40px;
				display: inline-flex;
				align-items: center;
				justify-content: flex-start;
				box-sizing: border-box;
				border: 1px solid color-mix(in srgb, var(--vscode-editor-foreground) 12%, transparent);
				border-radius: 999px;
				background: color-mix(in srgb, var(--vscode-editor-foreground) 16%, transparent);
				cursor: pointer;
				padding: 2px;
			}

			.cleanSlate-settings-toggle:disabled {
				opacity: 0.75;
				cursor: default;
			}

			.cleanSlate-settings-toggle[aria-checked="true"] {
				background: var(--vscode-testing-iconPassed, #35a56a);
			}

			.cleanSlate-settings-toggle-knob {
				display: block;
				width: 16px;
				height: 16px;
				border-radius: 50%;
				background: var(--vscode-editor-foreground);
				transform: translateX(0);
				transition: transform 0.12s ease;
			}

			.cleanSlate-settings-toggle[aria-checked="true"] .cleanSlate-settings-toggle-knob {
				transform: translateX(18px);
			}


			.cleanSlate-agent-manager-startup-shell {
			width: 100%;
			height: 100%;
			display: grid;
			grid-template-rows: auto minmax(0, 1fr) auto;
			gap: 16px;
		}

		.cleanSlate-agent-manager-startup-header,
		.cleanSlate-agent-manager-startup-footer {
			display: flex;
			align-items: center;
			gap: 12px;
		}

		.cleanSlate-agent-manager-startup-header {
			justify-content: space-between;
			padding: 10px 10px 0;
		}

		.cleanSlate-agent-manager-startup-main {
			min-height: 0;
			display: grid;
			grid-template-columns: minmax(220px, 320px) minmax(0, 1fr);
			gap: 18px;
			padding: 0 10px;
		}

		.cleanSlate-agent-manager-startup-footer {
			justify-content: space-between;
			padding: 0 10px 8px;
		}

		.cleanSlate-agent-manager-skeleton-line,
		.cleanSlate-agent-manager-skeleton-avatar,
		.cleanSlate-agent-manager-skeleton-pill {
			position: relative;
			overflow: hidden;
			background: color-mix(in srgb, var(--cleanSlate-agent-manager-card-hover-bg) 72%, transparent);
		}

		.cleanSlate-agent-manager-skeleton-line::after,
		.cleanSlate-agent-manager-skeleton-avatar::after,
		.cleanSlate-agent-manager-skeleton-pill::after {
			content: '';
			position: absolute;
			inset: 0;
			background: linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--vscode-foreground) 14%, transparent) 50%, transparent 100%);
			transform: translateX(-100%);
			animation: cleanSlateAgentManagerShimmer 1.45s ease-in-out infinite;
		}

		.cleanSlate-agent-manager-skeleton-line {
			--skeleton-width: 100%;
			width: var(--skeleton-width);
			height: 12px;
			border-radius: 999px;
		}

		.cleanSlate-agent-manager-skeleton-title {
			height: 14px;
		}

		.cleanSlate-agent-manager-skeleton-avatar {
			width: 18px;
			height: 18px;
			border-radius: 6px;
			flex: 0 0 auto;
		}

		.cleanSlate-agent-manager-skeleton-pill {
			width: 78px;
			height: 10px;
			border-radius: 999px;
			flex: 0 0 auto;
		}

		.cleanSlate-agent-manager-startup-nav,
		.cleanSlate-agent-manager-startup-content {
			display: grid;
			gap: 10px;
			align-content: start;
			min-width: 0;
			padding: 16px;
			border-radius: 20px;
			background: color-mix(in srgb, var(--cleanSlate-agent-manager-card-bg) 68%, transparent);
			border: 1px solid color-mix(in srgb, var(--cleanSlate-agent-manager-border) 72%, transparent);
		}

		.cleanSlate-agent-manager-startup-nav {
			grid-auto-rows: 12px;
		}

		.cleanSlate-agent-manager-startup-content {
			grid-auto-rows: 12px;
		}

		.cleanSlate-agent-manager-startup-preview {
			display: grid;
			gap: 10px;
			margin-top: 12px;
			padding: 14px;
			border-radius: 18px;
			background: color-mix(in srgb, var(--cleanSlate-agent-manager-card-hover-bg) 54%, transparent);
		}

		.cleanSlate-agent-manager-surface.is-startup-loading > :not(.cleanSlate-agent-manager-startup-loading) {
			opacity: 0;
		}

		.cleanSlate-agent-manager-surface.is-startup-loading .cleanSlate-agent-manager-nav {
			pointer-events: none;
			filter: saturate(0.8) brightness(0.9);
		}

		.cleanSlate-agent-manager-surface.is-startup-loading .cleanSlate-agent-manager-chat.cleanSlate-chat-view {
			filter: saturate(0.85) brightness(0.92);
		}

		.cleanSlate-agent-manager-surface.right-pane-visible .cleanSlate-agent-manager-chat.cleanSlate-chat-view {
			--cleanSlate-agent-manager-content-width: 720px;
		}

		.cleanSlate-agent-manager-transcript .cleanSlate-chat-messages {
			width: 100% !important;
			max-width: none !important;
			margin-left: 0 !important;
			margin-right: 0 !important;
			padding: 28px 40px 26px;
			gap: 18px;
			align-items: center !important;
			overscroll-behavior: contain;
			scrollbar-gutter: stable;
			scrollbar-width: thin;
			scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
		}

		.cleanSlate-agent-manager-transcript .cleanSlate-chat-messages > *,
		.cleanSlate-agent-manager-transcript .cleanSlate-chat-message-row,
		.cleanSlate-agent-manager-transcript .cleanSlate-turn-container {
			width: 100% !important;
			max-width: 760px !important;
			margin-left: auto !important;
			margin-right: auto !important;
			align-self: center !important;
			box-sizing: border-box;
		}

		.cleanSlate-agent-manager-transcript .cleanSlate-chat-message.user {
			border-radius: 14px;
			background: var(--cleanSlate-agent-manager-card-bg);
			border: 1px solid var(--cleanSlate-agent-manager-border) !important;
		}

		.cleanSlate-agent-manager-transcript .cleanSlate-chat-message.cleanSlate {
			font-size: 15px;
			line-height: 1.55;
		}

		/* Desktop-app type scale: the standalone surface reads
		   at 15px, not the IDE's 13px. The block-level 13px in
		   cleanSlateChatStyles outweighs the inherited size above, so restate it
		   on the text blocks. Reasoning bodies keep their own smaller size. */
		.cleanSlate-agent-manager-transcript .cleanSlate-assistant-text-block,
		.cleanSlate-agent-manager-transcript .cleanSlate-timeline-block.type-summary {
			font-size: 15px;
			line-height: 1.6;
		}

		.cleanSlate-agent-manager-transcript .cleanSlate-chat-message.user {
			font-size: 14px;
			line-height: 1.5;
		}

		.cleanSlate-agent-manager-transcript {
			flex: 1 1 auto;
			width: min(calc(100% - 80px), var(--cleanSlate-agent-manager-content-width));
			max-width: var(--cleanSlate-agent-manager-content-width);
			min-width: 0;
			min-height: 0;
			display: flex;
			flex-direction: column;
			overflow: hidden;
		}

		.cleanSlate-agent-manager-transcript .cleanSlate-chat-messages {
			min-height: 0;
			flex: 1 1 auto;
			overflow-x: hidden;
			overflow-y: auto;
			box-sizing: border-box;
		}

		.cleanSlate-agent-manager-transcript .cleanSlate-chat-messages::-webkit-scrollbar-track {
			background: transparent;
		}

		.cleanSlate-agent-manager-bottom {
			position: relative;
			flex: 0 0 auto;
			width: min(calc(100% - 80px), var(--cleanSlate-agent-manager-content-width));
			max-width: var(--cleanSlate-agent-manager-content-width);
			z-index: 2;
			display: flex;
			flex-direction: column;
			overflow: visible;
			background: var(--cleanSlate-agent-manager-surface-bg);
		}

			.cleanSlate-agent-manager-bottom .cleanSlate-chat-input-container {
				flex: 0 0 auto;
				width: 100%;
				position: relative;
				z-index: 1;
				display: flex;
				flex-direction: column;
				align-items: stretch;
				box-sizing: border-box;
				padding: 0 40px 18px;
				background: transparent;
			}

		.cleanSlate-agent-manager-bottom .cleanSlate-workspace-label {
			margin-top: 0;
			margin-bottom: 6px;
		}

		.cleanSlate-agent-manager-bottom .cleanSlate-input-box {
			border-radius: 18px;
			border: 1px solid var(--cleanSlate-agent-manager-border) !important;
			background: var(--vscode-input-background) !important;
			box-shadow: 0 18px 60px var(--cleanSlate-agent-manager-shadow) !important;
			padding: 8px 14px;
			transition: border-color 120ms ease, box-shadow 120ms ease, background-color 120ms ease;
		}

		.cleanSlate-agent-manager-bottom .cleanSlate-input-box:focus-within {
			border-color: var(--vscode-focusBorder) !important;
			box-shadow: 0 20px 64px var(--cleanSlate-agent-manager-shadow) !important;
		}

		.cleanSlate-agent-manager-bottom .cleanSlate-chat-input {
			white-space: pre-wrap !important;
			overflow-x: hidden !important;
			overflow-y: auto !important;
			overscroll-behavior: contain;
			max-height: 150px;
			scrollbar-width: none;
		}

		.cleanSlate-agent-manager-progress {
			display: none;
			width: 100%;
			max-width: var(--cleanSlate-agent-manager-content-width);
			margin: 0 auto;
			padding: 0 6px 6px;
			box-sizing: border-box;
			flex-wrap: wrap;
			gap: 6px;
		}

		.cleanSlate-agent-manager-progress.visible {
			display: flex;
		}

		.cleanSlate-agent-manager-progress-item {
			min-width: 0;
			max-width: 100%;
			display: inline-flex;
			align-items: center;
			gap: 6px;
			padding: 4px 8px;
			border-radius: 6px;
			background: var(--vscode-list-hoverBackground);
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
			line-height: 1.35;
		}

		.cleanSlate-agent-manager-progress-item.active {
			color: var(--vscode-foreground);
		}

		.cleanSlate-agent-manager-progress-item span:last-child {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		@keyframes cleanSlateAgentManagerShimmer {
			0% {
				transform: translateX(-100%);
			}
			100% {
				transform: translateX(100%);
			}
		}

		@media (prefers-reduced-motion: reduce) {
			.cleanSlate-agent-manager-skeleton-line::after,
			.cleanSlate-agent-manager-skeleton-avatar::after,
			.cleanSlate-agent-manager-skeleton-pill::after {
				animation: none;
			}
		}

		.cleanSlate-agent-manager-surface.is-indexing .cleanSlate-agent-manager-title::after {
			content: '  Indexing...';
			color: var(--vscode-descriptionForeground);
			font-weight: 400;
		}

		.cleanSlate-agent-manager-workspace-picker {
			position: absolute;
			z-index: 1000001;
			max-height: min(360px, calc(100% - 16px));
			display: flex;
			flex-direction: column;
			gap: 6px;
			padding: 8px;
			box-sizing: border-box;
			border: 1px solid var(--vscode-widget-border);
			border-radius: 8px;
			background: var(--vscode-dropdown-background);
			color: var(--vscode-dropdown-foreground);
			box-shadow: 0 8px 24px var(--vscode-widget-shadow);
			font-family: var(--vscode-font-family);
		}

		.cleanSlate-agent-manager-workspace-picker-search {
			height: 30px;
			display: flex;
			align-items: center;
			gap: 7px;
			padding: 0 8px;
			box-sizing: border-box;
			border-radius: 6px;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
		}

		.cleanSlate-agent-manager-workspace-picker-search input {
			flex: 1 1 auto;
			min-width: 0;
			border: 0;
			outline: 0;
			background: transparent;
			color: var(--vscode-input-foreground);
			font-family: var(--vscode-font-family);
			font-size: 13px;
		}

		.cleanSlate-agent-manager-workspace-picker-list {
			min-height: 0;
			overflow: auto;
		}

		.cleanSlate-agent-manager-workspace-picker-item {
			width: 100%;
			min-width: 0;
			min-height: 34px;
			display: grid;
			grid-template-columns: 18px minmax(0, 1fr) 18px;
			align-items: center;
			gap: 8px;
			padding: 7px 8px;
			box-sizing: border-box;
			border: 0;
			border-radius: 6px;
			background: transparent;
			color: inherit;
			font-family: var(--vscode-font-family);
			text-align: left;
			cursor: pointer;
		}

		.cleanSlate-agent-manager-workspace-picker-item:hover,
		.cleanSlate-agent-manager-workspace-picker-item.active {
			background: var(--vscode-list-hoverBackground);
		}

		.cleanSlate-agent-manager-workspace-picker-actions {
			border-top: 1px solid var(--vscode-widget-border);
			padding-top: 6px;
		}

		.cleanSlate-agent-manager-workspace-picker-action {
			width: 100%;
			min-height: 34px;
			display: grid;
			grid-template-columns: 18px minmax(0, 1fr) 18px;
			align-items: center;
			gap: 8px;
			padding: 7px 8px;
			box-sizing: border-box;
			border: 0;
			border-radius: 6px;
			background: transparent;
			color: inherit;
			font-family: var(--vscode-font-family);
			text-align: left;
			cursor: pointer;
		}

		.cleanSlate-agent-manager-workspace-picker-action:hover {
			background: var(--vscode-list-hoverBackground);
		}

		.workspace-picker-icon,
		.workspace-picker-check {
			color: var(--vscode-icon-foreground);
			font-size: 13px;
		}

		.workspace-picker-copy {
			min-width: 0;
			display: flex;
			flex-direction: column;
			gap: 1px;
		}

		.workspace-picker-title,
		.workspace-picker-description {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.workspace-picker-title {
			font-size: 13px;
			line-height: 1.25;
			color: var(--vscode-dropdown-foreground);
		}

		.workspace-picker-description,
		.cleanSlate-agent-manager-workspace-picker-empty {
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
		}

		.cleanSlate-agent-manager-workspace-picker-empty {
			padding: 8px;
		}

		@keyframes cleanSlateAgentManagerSurfaceEnter {
			from {
				opacity: 0;
				transform: translateY(5px);
			}
			to {
				opacity: 1;
				transform: translateY(0);
			}
		}

		@keyframes cleanSlateAgentManagerPulse {
			0% {
				opacity: 0.42;
				transform: scale(0.9);
			}
			50% {
				opacity: 1;
				transform: scale(1);
			}
			100% {
				opacity: 0.42;
				transform: scale(0.9);
			}
		}

		.cleanSlate-agent-manager-progress-item.active::before {
			content: '';
			width: 6px;
			height: 6px;
			border-radius: 50%;
			background: var(--vscode-focusBorder);
			flex: 0 0 auto;
		}

		@media (prefers-reduced-motion: no-preference) {
			.cleanSlate-agent-manager-surface {
				animation: cleanSlateAgentManagerSurfaceEnter 180ms var(--cleanSlate-agent-manager-ease);
				transition: grid-template-columns 180ms var(--cleanSlate-agent-manager-ease);
			}

			.cleanSlate-agent-manager-nav,
			.cleanSlate-agent-manager-right-pane {
				transition:
					opacity 180ms var(--cleanSlate-agent-manager-ease),
					transform 180ms var(--cleanSlate-agent-manager-ease),
					visibility 180ms step-end,
					border-color 180ms var(--cleanSlate-agent-manager-ease);
			}

			.cleanSlate-agent-manager-surface.right-pane-visible .cleanSlate-agent-manager-right-pane,
			.cleanSlate-agent-manager-surface:not(.nav-collapsed) .cleanSlate-agent-manager-nav {
				transition:
					opacity 180ms var(--cleanSlate-agent-manager-ease),
					transform 180ms var(--cleanSlate-agent-manager-ease),
					visibility 0ms step-start,
					border-color 180ms var(--cleanSlate-agent-manager-ease);
			}

			.cleanSlate-agent-manager-progress-item.active::before {
				animation: cleanSlateAgentManagerPulse 1.2s var(--cleanSlate-agent-manager-ease) infinite;
			}
		}

		@media (prefers-reduced-motion: reduce) {
			.cleanSlate-agent-manager-surface,
			.cleanSlate-agent-manager-nav,
			.cleanSlate-agent-manager-right-pane,
			.cleanSlate-agent-manager-pane-toggle,
			.cleanSlate-agent-manager-right-tab,
			.cleanSlate-agent-manager-exit,
			.cleanSlate-agent-manager-search,
			.cleanSlate-agent-manager-bottom .cleanSlate-input-box {
				transition: none !important;
				animation: none !important;
			}
		}

		@media (max-width: 1100px) {
			.cleanSlate-agent-manager-surface,
			.cleanSlate-agent-manager-surface.right-pane-visible {
				grid-template-columns: var(--cleanSlate-agent-manager-nav-width) minmax(0, 1fr);
			}

			.cleanSlate-agent-manager-surface.nav-collapsed,
			.cleanSlate-agent-manager-surface.nav-collapsed.right-pane-visible {
				grid-template-columns: 0 minmax(0, 1fr);
			}

			.cleanSlate-agent-manager-right-pane,
			.cleanSlate-agent-manager-right-resize-handle {
				display: none !important;
			}
		}

		@media (max-width: 760px) {
			.cleanSlate-agent-manager-surface,
			.cleanSlate-agent-manager-surface.right-pane-visible,
			.cleanSlate-agent-manager-surface.nav-collapsed,
			.cleanSlate-agent-manager-surface.nav-collapsed.right-pane-visible {
				grid-template-columns: 1fr;
			}

			.cleanSlate-agent-manager-nav {
				display: none;
			}

			.cleanSlate-agent-manager-resize-handle {
				display: none;
			}

			.cleanSlate-agent-manager-header {
				padding: 0 12px 0 16px;
			}

			.cleanSlate-agent-manager-transcript .cleanSlate-chat-messages {
				padding: 28px 16px 32px;
			}

			.cleanSlate-agent-manager-bottom .cleanSlate-chat-input-container {
				padding: 0 16px 16px;
			}
		}
	`);
});
