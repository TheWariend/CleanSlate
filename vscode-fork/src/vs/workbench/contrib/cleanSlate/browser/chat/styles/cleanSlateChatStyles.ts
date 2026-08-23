/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../../../base/browser/window.js';
import { CLEANSLATE_ACTION_BUTTON_STYLES } from '../../cleanSlateActionButton.js';

export const CLEANSLATE_CHAT_STYLES = `
			${CLEANSLATE_ACTION_BUTTON_STYLES}
			/* CleanSlate Chat Styles */
			.cleanSlate-chat-view {
				position: relative;
                background: var(--vscode-sideBar-background);
                /* Antialias the whole chat surface; without this macOS renders
                   text heavier than intended. */
                -webkit-font-smoothing: antialiased;
                text-rendering: optimizeLegibility;
			}

            /* Scrollbar Styling */
            .cleanSlate-chat-view ::-webkit-scrollbar {
                width: 10px;
                height: 10px;
            }
            .cleanSlate-chat-view ::-webkit-scrollbar-thumb {
                background: var(--vscode-scrollbarSlider-background);
                border-radius: 5px;
            }
            .cleanSlate-chat-view ::-webkit-scrollbar-thumb:hover {
                background: var(--vscode-scrollbarSlider-hoverBackground);
            }
            .cleanSlate-chat-view ::-webkit-scrollbar-thumb:active {
                background: var(--vscode-scrollbarSlider-activeBackground);
            }
            .cleanSlate-chat-view ::-webkit-scrollbar-track {
                background: transparent;
            }
            .cleanSlate-chat-input::-webkit-scrollbar {
                display: none;
            }

            .cleanSlate-terminal-output::-webkit-scrollbar {
                width: 8px;
            }
            .cleanSlate-terminal-output::-webkit-scrollbar-thumb {
                background: var(--vscode-scrollbarSlider-background);
                border-radius: 4px;
            }
            .cleanSlate-terminal-output::-webkit-scrollbar-thumb:hover {
                background: var(--vscode-scrollbarSlider-hoverBackground);
            }
            .cleanSlate-terminal-output::-webkit-scrollbar-track {
                background: var(--vscode-sideBar-background);
                border-radius: 4px;
            }

			.cleanSlate-activity-disclosure {
				margin-bottom: 2px;
			}

			.cleanSlate-activity-disclosure summary {
				list-style: none;
			}

			.cleanSlate-activity-disclosure summary::-webkit-details-marker {
				display: none;
			}

			.cleanSlate-activity-summary {
				display: inline-flex;
				align-items: center;
				gap: 6px;
				cursor: pointer;
				user-select: none;
				font-size: 13px;
				color: var(--vscode-descriptionForeground);
				padding: 3px 8px;
				margin-left: -8px;
				border-radius: 6px;
				transition: background-color 0.12s ease, color 0.12s ease;
			}

			.cleanSlate-activity-summary:hover {
				color: var(--vscode-foreground);
				background: var(--vscode-list-hoverBackground);
			}

			.cleanSlate-activity-chevron {
				transition: transform 0.2s ease;
				flex-shrink: 0;
			}

			.cleanSlate-activity-disclosure[open] .cleanSlate-activity-chevron {
				transform: rotate(90deg);
			}

            .cleanSlate-activity-content {
                font-size: 13px;
                color: var(--vscode-descriptionForeground);
                line-height: 1.6;
                padding: 8px 0 4px 16px;
            }

            .cleanSlate-timeline-block {
                transform-origin: left center;
            }

            .cleanSlate-streaming-plaintext {
                white-space: pre-wrap;
                word-break: break-word;
            }

            @keyframes cleanSlateBlockIn {
                from { opacity: 0; transform: translateY(8px) scale(0.985); }
                to { opacity: 1; transform: none; }
            }

            .cleanSlate-timeline-block {
                animation: cleanSlateBlockIn 0.32s cubic-bezier(0.16, 1, 0.3, 1);
            }

            @keyframes cleanSlateDetailRowIn {
                from { opacity: 0; transform: translateX(-6px); }
                to { opacity: 1; transform: none; }
            }

            /* Rows are rebuilt wholesale on each update, so only the newest row
               animates — earlier rows re-render in place without replaying. */
            .cleanSlate-activity-content .activity-detail-item:last-child {
                animation: cleanSlateDetailRowIn 0.22s ease-out;
            }

            .cleanSlate-code-widget {
                margin: 8px 0;
                border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.12));
                border-radius: 8px;
                overflow: hidden;
                background: var(--vscode-editorWidget-background, #1e1e1e);
            }

            .cleanSlate-code-widget-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 4px 10px;
                font-size: 11px;
                font-family: var(--vscode-editor-font-family);
                color: var(--vscode-descriptionForeground);
                background: rgba(255, 255, 255, 0.04);
                border-bottom: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.12));
                user-select: none;
            }

            .cleanSlate-code-widget-copy {
                display: flex;
                align-items: center;
                background: transparent;
                border: none;
                padding: 2px;
                cursor: pointer;
                color: var(--vscode-descriptionForeground);
            }

            .cleanSlate-code-widget-copy:hover {
                color: var(--vscode-foreground);
            }

            .cleanSlate-code-widget-body {
                padding: 10px 12px;
                overflow-x: auto;
                font-family: var(--vscode-editor-font-family);
                font-size: 12px;
                line-height: 1.5;
            }

            .cleanSlate-code-widget-body > div,
            .cleanSlate-code-widget-body pre {
                white-space: pre;
                margin: 0;
            }

            .cleanSlate-reasoning-block {
                margin: 8px 0 10px;
            }

            .cleanSlate-reasoning-header {
                display: flex;
                align-items: center;
                gap: 7px;
                width: fit-content;
                margin: 0;
                padding: 0;
                border: 0;
                background: transparent;
                cursor: pointer;
                user-select: none;
                font-family: var(--vscode-font-family);
                font-size: 14px;
                font-weight: 400;
                line-height: 1.4;
                color: var(--vscode-foreground);
                text-align: left;
            }

            .cleanSlate-reasoning-header:hover {
                color: var(--vscode-foreground);
            }

            .cleanSlate-reasoning-header:focus-visible {
                outline: 1px solid var(--vscode-focusBorder);
                outline-offset: 3px;
                border-radius: 2px;
            }

            .cleanSlate-reasoning-chevron {
                flex: 0 0 auto;
                font-size: 14px;
                opacity: 0.9;
                transition: transform 140ms ease;
            }

            .cleanSlate-reasoning-block.is-collapsed .cleanSlate-reasoning-chevron {
                transform: rotate(-90deg);
            }

            @keyframes cleanSlateShimmer {
                from { background-position: 200% 0; }
                to { background-position: -200% 0; }
            }

            /*
             * Reasoning "Thinking…" sheen. A dimmed base (descriptionForeground at
             * ~58% via color-mix) gives the moving highlight something to sweep
             * against, so it reads as a soft rolling sheen rather than a harsh
             * bright stripe over already-full-brightness text. will-change promotes
             * the label to its own paint layer, keeping the clip:text repaint off
             * the shared layer during streaming.
             */
            .cleanSlate-reasoning-block.is-streaming .cleanSlate-reasoning-label {
                background: linear-gradient(
                    90deg,
                    color-mix(in srgb, var(--vscode-descriptionForeground) 58%, transparent) 0%,
                    color-mix(in srgb, var(--vscode-descriptionForeground) 58%, transparent) 40%,
                    var(--vscode-foreground) 50%,
                    color-mix(in srgb, var(--vscode-descriptionForeground) 58%, transparent) 60%,
                    color-mix(in srgb, var(--vscode-descriptionForeground) 58%, transparent) 100%
                );
                background-size: 220% 100%;
                background-position: 200% 0;
                -webkit-background-clip: text;
                background-clip: text;
                -webkit-text-fill-color: transparent;
                color: transparent;
                will-change: background-position;
                animation: cleanSlateShimmer 2.4s linear infinite;
            }

            @media (prefers-reduced-motion: reduce) {
                .cleanSlate-reasoning-block.is-streaming .cleanSlate-reasoning-label {
                    animation: none;
                    background: none;
                    -webkit-text-fill-color: currentColor;
                    color: var(--vscode-foreground);
                    will-change: auto;
                }
            }

            .cleanSlate-reasoning-block > .cleanSlate-reasoning-body.cleanSlate-message-content {
                margin-top: 8px;
                margin-bottom: 0;
                font-size: 14px;
                line-height: 1.55;
                color: color-mix(in srgb, var(--vscode-foreground) 54%, transparent);
                font-style: normal;
                font-weight: 400;
                white-space: pre-wrap;
                word-break: break-word;
                max-height: none;
                overflow: visible;
            }

            /*
             * While the thought is still streaming, soften the bottom edge so each
             * incoming line rises up through a gentle fade instead of hard-popping
             * against the clip boundary as the box auto-scrolls to the newest text.
             * Only the bottom fades — the top stays crisp so a short thought's first
             * line is never dimmed. The mask is dropped once streaming ends so the
             * settled "Thought" reads at full contrast.
             */
            .cleanSlate-reasoning-block.is-streaming .cleanSlate-reasoning-body {
                -webkit-mask-image: none;
                mask-image: none;
            }

            @media (prefers-reduced-motion: reduce) {
                .cleanSlate-reasoning-block.is-streaming .cleanSlate-reasoning-body {
                    -webkit-mask-image: none;
                    mask-image: none;
                }
            }

            .cleanSlate-reasoning-block.is-collapsed .cleanSlate-reasoning-body {
                display: none;
            }

            .cleanSlate-file-analyzed {
                display: flex;
                align-items: center;
                flex-wrap: nowrap;
                gap: 8px;
                margin: 4px 0;
                width: 100%;
                min-width: 0;
                box-sizing: border-box;
            }

            .cleanSlate-file-mutation-card {
                width: 100%;
                min-width: 0;
                border-radius: 8px;
            }

            .cleanSlate-file-mutation-card.has-diff-preview {
                border: 1px solid transparent;
                overflow: hidden;
            }

            .cleanSlate-file-mutation-card.has-diff-preview.is-open {
                background: color-mix(in srgb, var(--vscode-editorWidget-background, var(--vscode-editor-background)) 72%, transparent);
                border-color: color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
            }

            .cleanSlate-file-mutation-row {
				border: 0;
                background: transparent;
                color: inherit;
                text-align: left;
                font: inherit;
            }

            button.cleanSlate-file-mutation-row {
                cursor: pointer;
            }

            button.cleanSlate-file-mutation-row:hover {
                background: color-mix(in srgb, var(--vscode-foreground) 5%, transparent);
            }

            .cleanSlate-file-diff-chevron {
                flex-shrink: 0;
                margin-left: 2px;
                color: var(--vscode-descriptionForeground);
                font-size: 13px;
                transition: transform 0.16s ease;
            }

            .cleanSlate-file-mutation-row.is-open .cleanSlate-file-diff-chevron,
            .cleanSlate-file-mutation-card.is-open .cleanSlate-file-diff-chevron {
                transform: rotate(90deg);
            }

            .cleanSlate-file-analyzed .analyzed-label {
                font-size: 12px;
                color: var(--vscode-descriptionForeground);
                flex-shrink: 0;
            }

            .cleanSlate-file-analyzed .file-name {
                font-size: 13px;
                font-weight: 500;
                color: var(--vscode-foreground);
                flex: 1;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .cleanSlate-file-analyzed .file-range {
                font-size: 12px;
                color: var(--vscode-descriptionForeground);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                flex-shrink: 0;
                min-width: 0;
            }

            .cleanSlate-file-analyzed .cleanSlate-file-delta {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                font-family: var(--vscode-editor-font-family, monospace);
                font-size: 13px;
                font-variant-numeric: tabular-nums;
                overflow: visible;
            }

            .cleanSlate-file-analyzed .file-marker-count {
                color: var(--vscode-notificationsWarningIcon-foreground);
            }

            .activity-group {
                margin: 2px 0;
            }

            .activity-details {
                padding: 4px 0 8px 16px !important;
            }

            .activity-detail-item {
                font-size: 12px;
                color: var(--vscode-descriptionForeground);
                opacity: 0.85;
                margin-bottom: 2px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                font-family: var(--vscode-font-family);
                flex: 1;
                min-width: 0;
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 2px 4px;
            }

            .activity-detail-item.clickable-file {
                cursor: pointer;
                border-radius: 4px;
                transition: background-color 0.15s ease, color 0.15s ease;
            }

            .activity-detail-item.clickable-file:hover {
                background-color: var(--vscode-list-hoverBackground);
                color: var(--vscode-foreground);
                opacity: 1;
            }

            .activity-detail-item .activity-action {
                font-weight: 500;
                min-width: 55px;
                opacity: 0.7;
            }

            .activity-detail-item .file-icon-container {
                font-size: 14px;
                width: 16px;
                height: 16px;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0.8;
            }

            .activity-detail-item .activity-file {
                flex: 1;
                overflow: hidden;
                text-overflow: ellipsis;
                text-decoration: none;
            }

            .activity-detail-item .activity-query {
                color: var(--vscode-foreground);
            }

            .activity-detail-item .activity-scope {
                opacity: 0.7;
            }

            .activity-detail-item:last-child {
                margin-bottom: 0;
            }

            .cleanSlate-activity-disclosure.activity-group summary {
                padding: 0;
            }

			.cleanSlate-chat-messages,
			.cleanSlate-chat-message,
			.cleanSlate-message-content,
			.cleanSlate-tool-result {
				user-select: text !important;
				cursor: text;
			}

			.cleanSlate-transcript-shell {
				position: relative;
				flex: 1;
				min-height: 0;
				display: flex;
				flex-direction: column;
			}

            .cleanSlate-empty-state {
                display: none !important;
            }

            .cleanSlate-chat-messages {
                flex: 1;
                overflow-y: auto;
                overflow-anchor: none;
                padding: 28px 20px 32px;
                display: flex;
                flex-direction: column;
                gap: 18px;
                align-items: center; /* Centering for the column */
                background: transparent;
			}

			.cleanSlate-transcript-bottom-fade {
				position: absolute;
				z-index: 4;
				right: 12px;
				bottom: 0;
				left: 0;
				height: 72px;
				background: linear-gradient(
					to bottom,
					transparent,
					color-mix(in srgb, var(--vscode-editor-background) 94%, transparent) 72%,
					var(--vscode-editor-background)
				);
				opacity: 0;
				pointer-events: none;
				transition: opacity 120ms ease-out;
			}

			.cleanSlate-transcript-bottom-fade.visible {
				opacity: 1;
			}

			.cleanSlate-scroll-to-bottom {
				position: absolute;
				left: 50%;
				bottom: 12px;
				z-index: 5;
				width: 42px;
				height: 42px;
				padding: 0;
				display: flex;
				align-items: center;
				justify-content: center;
				border: 2px solid color-mix(in srgb, var(--vscode-foreground) 17%, transparent);
				border-radius: 50%;
				background: color-mix(in srgb, var(--vscode-sideBar-background) 97%, var(--vscode-foreground) 3%);
				color: var(--vscode-foreground);
				box-shadow:
					0 4px 14px rgba(0, 0, 0, 0.18),
					inset 0 1px 0 color-mix(in srgb, white 5%, transparent);
				-webkit-backdrop-filter: blur(12px);
				backdrop-filter: blur(12px);
				cursor: pointer;
				opacity: 0;
				pointer-events: none;
				transform: translate(-50%, 8px) scale(0.94);
				transition:
					opacity 160ms ease,
					transform 220ms cubic-bezier(0.16, 1, 0.3, 1),
					border-color 140ms ease,
					box-shadow 180ms ease,
					color 140ms ease;
			}

			.cleanSlate-scroll-to-bottom.visible {
				opacity: 1;
				pointer-events: auto;
				transform: translate(-50%, 0) scale(1);
			}

			.cleanSlate-scroll-to-bottom[hidden] {
				display: none !important;
			}

			.cleanSlate-scroll-to-bottom:hover {
				border-color: color-mix(in srgb, var(--vscode-foreground) 28%, transparent);
				background: color-mix(in srgb, var(--vscode-sideBar-background) 93%, var(--vscode-foreground) 7%);
				box-shadow:
					0 7px 18px rgba(0, 0, 0, 0.22),
					inset 0 1px 0 color-mix(in srgb, white 7%, transparent);
				transform: translate(-50%, -2px) scale(1.035);
			}

			.cleanSlate-scroll-to-bottom:active {
				box-shadow:
					0 4px 12px rgba(0, 0, 0, 0.24),
					inset 0 1px 2px rgba(0, 0, 0, 0.18);
				transform: translate(-50%, 0) scale(0.97);
			}

			.cleanSlate-scroll-to-bottom:focus-visible {
				outline: 2px solid var(--vscode-focusBorder);
				outline-offset: 3px;
			}

			.cleanSlate-scroll-to-bottom .codicon {
				font-size: 22px;
				line-height: 1;
			}

			@media (prefers-reduced-motion: reduce) {
				.cleanSlate-scroll-to-bottom {
					transition: opacity 80ms linear;
				}
			}

            .cleanSlate-turn-container {
                width: 100%;
                max-width: 760px;
                padding-left: 0;
                margin-bottom: 8px;
                transition: opacity 0.4s ease;
                position: relative;
            }

            .cleanSlate-turn-container.streaming {
                border-left-color: transparent;
                background: transparent;
            }

            .cleanSlate-turn-content {
                display: flex;
                flex-direction: column;
                gap: 2px;
            }

				.cleanSlate-chat-input-container {
					padding: 4px 6px 10px;
					background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--vscode-sideBar-background) 94%, black 6%));
	                position: relative;
					display: flex;
				flex-direction: column;
				align-items: center;
				width: 100%;
					box-sizing: border-box;
				}

	            .cleanSlate-workspace-label {
	                align-self: center;
	                width: 100%;
	                max-width: 760px;
	                margin: 0 auto 6px;
	                padding: 0 4px;
	                box-sizing: border-box;
	                display: flex;
	                align-items: center;
	                gap: 5px;
	                min-width: 0;
	                border: 0;
	                background: transparent;
	                color: var(--vscode-descriptionForeground);
	                font-family: var(--vscode-font-family);
	                font-size: 11px;
	                font-weight: 500;
	                opacity: 0.72;
	                text-align: left;
	                user-select: none;
	                transition: opacity 120ms ease;
	            }

	            button.cleanSlate-workspace-label {
	                cursor: pointer;
	            }

	            button.cleanSlate-workspace-label.workspace-selector-disabled {
	                cursor: default;
	            }

	            .cleanSlate-workspace-label:hover {
	                opacity: 1;
	            }

	            button.cleanSlate-workspace-label.workspace-selector-disabled:hover {
	                opacity: 0.72;
	            }

	            .cleanSlate-workspace-label i {
	                flex: 0 0 auto;
	                font-size: 12px;
	                opacity: 0.82;
	            }

	            .cleanSlate-workspace-label span {
	                min-width: 0;
	                overflow: hidden;
	                text-overflow: ellipsis;
	                white-space: nowrap;
	            }

				.cleanSlate-chat-view .cleanSlate-input-box {
					background: var(--vscode-input-background, #202020);
					border: none !important;
				border-radius: 12px;
				padding: 6px 14px;
				outline: none !important;
				box-shadow: none !important;
				max-width: 760px; /* Centered column */
				width: 100%;
				container-type: inline-size;
				box-sizing: border-box;
				margin: 0 auto;
			}

			.cleanSlate-chat-view .cleanSlate-input-box:focus-within {
				outline: none !important;
				box-shadow: none !important;
			}

            .cleanSlate-chat-view .cleanSlate-input-box.drag-over {
                border-color: var(--vscode-focusBorder, #3d87fb) !important;
                background: rgba(61, 135, 251, 0.06);
            }

            .cleanSlate-planning-question {
                display: none;
                flex-direction: column;
                gap: 10px;
                padding: 10px 0 12px;
                margin-bottom: 4px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            }

            .cleanSlate-planning-question.visible {
                display: flex;
            }

            .cleanSlate-planning-question-header {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: 12px;
                min-width: 0;
            }

            .cleanSlate-planning-question-title {
                min-width: 0;
                color: var(--vscode-foreground);
                font-size: 14px;
                font-weight: 650;
                line-height: 1.45;
                letter-spacing: 0;
                overflow-wrap: anywhere;
            }

            .cleanSlate-planning-question-close {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 26px;
                height: 26px;
                flex: 0 0 auto;
                border: none;
                border-radius: 50%;
                color: var(--vscode-descriptionForeground);
                background: transparent;
                cursor: pointer;
            }

            .cleanSlate-planning-question-close:hover {
                color: var(--vscode-foreground);
                background: rgba(255, 255, 255, 0.06);
            }

            .cleanSlate-planning-question-options {
                display: flex;
                flex-direction: column;
                gap: 5px;
            }

            .cleanSlate-planning-question-option {
                display: grid;
                grid-template-columns: auto minmax(0, 1fr);
                gap: 10px;
                align-items: start;
                width: 100%;
                min-height: 36px;
                padding: 8px 10px;
                border: none;
                border-radius: 8px;
                color: var(--vscode-descriptionForeground);
                background: transparent;
                font-family: var(--vscode-font-family);
                text-align: left;
                cursor: pointer;
            }

            .cleanSlate-planning-question-option:hover {
                color: var(--vscode-foreground);
                background: rgba(255, 255, 255, 0.05);
            }

            .cleanSlate-planning-question-option.selected {
                color: var(--vscode-foreground);
                background: rgba(255, 255, 255, 0.08);
            }

            .cleanSlate-planning-question-index {
                color: var(--vscode-descriptionForeground);
                font-size: 13px;
                font-variant-numeric: tabular-nums;
                line-height: 1.45;
            }

            .cleanSlate-planning-question-copy {
                display: flex;
                flex-direction: column;
                gap: 2px;
                min-width: 0;
            }

            .cleanSlate-planning-question-label {
                min-width: 0;
                overflow-wrap: anywhere;
                font-size: 13px;
                font-weight: 600;
                line-height: 1.45;
                letter-spacing: 0;
            }

            .cleanSlate-planning-question-description {
                min-width: 0;
                color: var(--vscode-descriptionForeground);
                font-size: 12px;
                line-height: 1.35;
                overflow-wrap: anywhere;
            }

            .cleanSlate-planning-question-footer {
                display: flex;
                justify-content: flex-end;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
            }

            .cleanSlate-planning-question-dismiss,
            .cleanSlate-planning-question-submit {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 7px;
                min-height: 26px;
                border: none;
                border-radius: 7px;
                font-family: var(--vscode-font-family);
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                white-space: nowrap;
            }

            .cleanSlate-planning-question-dismiss {
                color: var(--vscode-descriptionForeground);
                background: transparent;
                padding: 0 6px;
            }

            .cleanSlate-planning-question-dismiss:hover {
                color: var(--vscode-foreground);
            }

            .cleanSlate-planning-question-dismiss kbd {
                min-width: 34px;
                padding: 3px 8px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                color: var(--vscode-foreground);
                background: rgba(255, 255, 255, 0.08);
                font-family: var(--vscode-font-family);
                font-size: 12px;
                font-weight: 700;
                line-height: 1;
                text-align: center;
            }

            .cleanSlate-planning-question-submit {
                color: var(--vscode-button-foreground);
                background: var(--vscode-button-background);
                padding: 0 10px;
            }

            .cleanSlate-planning-question-submit:hover {
                background: var(--vscode-button-hoverBackground);
            }

            .cleanSlate-plan-approval {
                display: none;
                flex-direction: column;
                gap: 10px;
                padding: 8px 0 10px;
                margin-bottom: 4px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            }

            .cleanSlate-plan-approval.visible {
                display: flex;
            }

            .cleanSlate-plan-approval-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                min-width: 0;
            }

            .cleanSlate-plan-approval-title {
                min-width: 0;
                color: var(--vscode-foreground);
                font-size: 14px;
                font-weight: 600;
                line-height: 1.35;
                letter-spacing: 0;
            }

            .cleanSlate-plan-approval-close {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 26px;
                height: 26px;
                flex: 0 0 auto;
                border: none;
                border-radius: 50%;
                color: var(--vscode-descriptionForeground);
                background: transparent;
                cursor: pointer;
            }

            .cleanSlate-plan-approval-close:hover {
                color: var(--vscode-foreground);
                background: rgba(255, 255, 255, 0.06);
            }

            .cleanSlate-plan-approval-options {
                display: flex;
                flex-direction: column;
                gap: 5px;
            }

            .cleanSlate-plan-approval-option {
                display: grid;
                grid-template-columns: auto minmax(0, 1fr) auto;
                align-items: center;
                gap: 10px;
                width: 100%;
                min-height: 38px;
                padding: 8px 10px;
                border: none;
                border-radius: 8px;
                color: var(--vscode-descriptionForeground);
                background: transparent;
                font-family: var(--vscode-font-family);
                text-align: left;
                cursor: pointer;
            }

            .cleanSlate-plan-approval-option:hover {
                color: var(--vscode-foreground);
                background: rgba(255, 255, 255, 0.05);
            }

            .cleanSlate-plan-approval-option.selected {
                color: var(--vscode-foreground);
                background: rgba(255, 255, 255, 0.08);
            }

            .cleanSlate-plan-approval-index {
                color: var(--vscode-descriptionForeground);
                font-size: 13px;
                font-variant-numeric: tabular-nums;
            }

            .cleanSlate-plan-approval-label {
                min-width: 0;
                overflow-wrap: anywhere;
                font-size: 13px;
                font-weight: 600;
                line-height: 1.35;
                letter-spacing: 0;
            }

            .cleanSlate-plan-approval-footer {
                display: flex;
                justify-content: flex-end;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
            }

            .cleanSlate-plan-approval-dismiss,
            .cleanSlate-plan-approval-submit {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 7px;
                min-height: 30px;
                border: none;
                border-radius: 8px;
                font-family: var(--vscode-font-family);
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                white-space: nowrap;
            }

            .cleanSlate-plan-approval-dismiss {
                color: var(--vscode-descriptionForeground);
                background: transparent;
                padding: 0 6px;
            }

            .cleanSlate-plan-approval-dismiss:hover {
                color: var(--vscode-foreground);
            }

            .cleanSlate-plan-approval-dismiss kbd {
                min-width: 34px;
                padding: 3px 8px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                color: var(--vscode-foreground);
                background: rgba(255, 255, 255, 0.08);
                font-family: var(--vscode-font-family);
                font-size: 12px;
                font-weight: 700;
                line-height: 1;
                text-align: center;
            }

            .cleanSlate-plan-approval-submit {
                color: var(--vscode-button-foreground);
                background: var(--vscode-button-background);
                min-height: 26px;
                padding: 0 10px;
                border-radius: 7px;
                font-size: 12px;
            }

            .cleanSlate-plan-approval-submit:hover {
                background: var(--vscode-button-hoverBackground);
            }

            .cleanSlate-command-approval {
                display: none;
                flex-direction: column;
                gap: 7px;
                padding: 10px;
                margin: 0 0 4px;
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 12px;
                background: #2b2b2b;
                box-shadow: 0 10px 28px rgba(0, 0, 0, 0.24);
                outline: none;
            }

            .cleanSlate-command-approval.visible {
                display: flex;
            }

            .cleanSlate-command-approval-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                min-width: 0;
            }

            .cleanSlate-command-approval-title {
                min-width: 0;
                color: #f4f4f4;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-size: 14px;
                font-weight: 500;
                line-height: 1.25;
                letter-spacing: 0;
            }

            .cleanSlate-command-approval-command {
                position: relative;
                display: block;
                min-width: 0;
                height: 46px;
                padding: 8px 70px 8px 10px;
                border: none;
                border-radius: 8px;
                background: #252525;
                box-sizing: border-box;
                overflow: hidden;
            }

            .cleanSlate-command-approval-command.expanded {
                height: 118px;
                padding-right: 10px;
                padding-bottom: 24px;
            }

            .cleanSlate-command-approval-command-text {
                display: block;
                min-width: 0;
                height: 100%;
                overflow: auto;
                overflow-wrap: anywhere;
                color: #a9a9a9;
                background: transparent;
                font-family: var(--vscode-editor-font-family);
                font-size: 12px;
                line-height: 1.35;
                white-space: pre-wrap;
                scrollbar-width: thin;
                scrollbar-color: rgba(122, 122, 122, 0.65) #0b0b0b;
            }

            .cleanSlate-command-approval-command-text::-webkit-scrollbar {
                width: 10px;
                height: 10px;
            }

            .cleanSlate-command-approval-command-text::-webkit-scrollbar-track {
                background: #0b0b0b;
            }

            .cleanSlate-command-approval-command-text::-webkit-scrollbar-thumb {
                background: rgba(122, 122, 122, 0.65);
                border: 2px solid #0b0b0b;
                border-radius: 999px;
            }

            .cleanSlate-command-approval-command-text::-webkit-scrollbar-thumb:hover {
                background: rgba(150, 150, 150, 0.78);
            }

            .cleanSlate-command-approval-expand {
                position: absolute;
                right: 10px;
                bottom: 8px;
                padding: 0;
                border: none;
                color: #a5a5a5;
                background: transparent;
                font-family: var(--vscode-font-family);
                font-size: 12px;
                font-weight: 500;
                line-height: 1;
                cursor: pointer;
            }

            .cleanSlate-command-approval-expand:hover {
                color: #f4f4f4;
            }

            .cleanSlate-command-approval-cwd {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                color: #a0a0a0;
                font-size: 11px;
                line-height: 1.2;
                margin-top: -3px;
            }

            .cleanSlate-command-approval-cwd.empty {
                display: none;
            }

            .cleanSlate-command-approval-options {
                display: flex;
                flex-direction: column;
                gap: 3px;
            }

            .cleanSlate-command-approval-option {
                display: grid;
                grid-template-columns: 26px minmax(0, 1fr) auto;
                align-items: center;
                gap: 2px;
                width: 100%;
                min-height: 27px;
                padding: 0 8px 0 4px;
                border: none;
                border-radius: 14px;
                color: #a0a0a0;
                background: transparent;
                font-family: var(--vscode-font-family);
                text-align: left;
                cursor: pointer;
            }

            .cleanSlate-command-approval-option:hover {
                color: #f4f4f4;
                background: rgba(255, 255, 255, 0.05);
            }

            .cleanSlate-command-approval-option.selected {
                color: #ffffff;
                background: #3a3a3a;
            }

            .cleanSlate-command-approval-index {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 19px;
                height: 19px;
                border: 1px solid rgba(255, 255, 255, 0.14);
                border-radius: 50%;
                color: #8f8f8f;
                font-size: 11px;
                font-variant-numeric: tabular-nums;
                box-sizing: border-box;
            }

            .cleanSlate-command-approval-option.selected .cleanSlate-command-approval-index {
                border-color: #ffffff;
                color: #2b2b2b;
                background: #ffffff;
            }

            .cleanSlate-command-approval-label {
                min-width: 0;
                overflow-wrap: anywhere;
                font-size: 12px;
                font-weight: 500;
                line-height: 1.25;
                letter-spacing: 0;
            }

            .cleanSlate-command-approval-indicator {
                display: inline-flex;
                align-items: center;
                gap: 2px;
                min-width: 24px;
                justify-content: flex-end;
                color: #8e8e8e;
                opacity: 0;
            }

            .cleanSlate-command-approval-option.selected .cleanSlate-command-approval-indicator {
                opacity: 1;
            }

            .cleanSlate-command-approval-option[data-choice="cancel"] {
                color: #9f9f9f;
            }

            .cleanSlate-command-approval-option[data-choice="cancel"] .cleanSlate-command-approval-index {
                border-color: rgba(255, 255, 255, 0.12);
                color: #8e8e8e;
                background: rgba(255, 255, 255, 0.04);
            }

            .cleanSlate-command-approval-option[data-choice="cancel"].selected .cleanSlate-command-approval-index {
                border-color: #ffffff;
                color: #2b2b2b;
                background: #ffffff;
            }

            .cleanSlate-command-approval-footer {
                display: flex;
                justify-content: flex-end;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
                margin-top: -1px;
            }

            .cleanSlate-command-approval-submit {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                min-height: 26px;
                border: none;
                border-radius: 999px;
                font-family: var(--vscode-font-family);
                font-size: 12px;
                font-weight: 500;
                cursor: pointer;
                white-space: nowrap;
            }

            .cleanSlate-command-approval-submit {
                color: #2c2c2c;
                background: #f7f7f7;
                min-height: 26px;
                padding: 0 6px 0 11px;
            }

            .cleanSlate-command-approval-submit:hover {
                background: #ffffff;
            }

            .cleanSlate-command-approval-submit .cleanSlate-command-approval-return {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 28px;
                height: 19px;
                padding: 0 6px;
                border-radius: 999px;
                color: #4b4b4b;
                background: #e6e6e6;
                font-size: 10px;
                line-height: 1;
            }

			.cleanSlate-chat-view .cleanSlate-chat-input {
				width: 100%;
				/* One full line plus padding. The height is normally driven by an
				   inline style from resizeInput(); this floor keeps the placeholder
				   readable if that measurement ever runs before layout. */
				min-height: calc(1.5em + 8px);
				max-height: 240px;
				box-sizing: border-box;
				background: transparent !important;
				border: none !important;
				color: var(--vscode-input-foreground);
				font-family: var(--vscode-font-family);
				font-size: 14px;
				line-height: 1.5;
				padding: 4px 0;
				resize: none !important;
				outline: none !important;
				box-shadow: none !important;
				white-space: pre-wrap;
				overflow-x: hidden;
				overflow-y: hidden;
				overflow-wrap: anywhere;
				scrollbar-width: none;
			}

			.cleanSlate-chat-view .cleanSlate-chat-input::placeholder {
				color: var(--vscode-input-placeholderForeground);
			}

			.cleanSlate-chat-view .cleanSlate-chat-input:focus {
				outline: none !important;
				border: none !important;
				box-shadow: none !important;
			}

			.cleanSlate-chat-view *:focus {
				outline: none !important;
			}

			.cleanSlate-input-footer {
				display: flex;
				justify-content: space-between;
				align-items: center;
				gap: 8px;
				margin-top: 4px;
				padding: 0 4px;
				width: 100%;
				box-sizing: border-box;
				flex-wrap: nowrap;
				overflow: visible;
				scrollbar-width: none;
			}

			.cleanSlate-input-footer::-webkit-scrollbar {
				display: none;
			}

			.cleanSlate-footer-left {
				display: flex;
				align-items: center;
				gap: 8px;
				flex: 1 1 auto;
				min-width: 0;
				overflow: visible;
			}
			.cleanSlate-dropdown {
				padding: 4px 8px;
				background: transparent;
				border-radius: 999px;
				cursor: pointer;
				display: inline-flex;
				align-items: center;
				gap: 4px;
				font-size: 11px;
				color: var(--vscode-descriptionForeground);
				transition: color 0.15s;
				white-space: nowrap;
				user-select: none;
				outline: none !important;
				box-shadow: none !important;
				border: none !important;
				min-width: 0;
				max-width: 140px;
				flex: 0 1 auto;
			}

			.cleanSlate-dropdown .dropdown-label {
				white-space: nowrap;
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				flex: 0 1 auto;
			}

			.cleanSlate-dropdown .model-provider-logo,
			.cleanSlate-model-selector-overlay .model-item-provider-logo {
				width: 15px;
				height: 15px;
				flex: 0 0 15px;
				background-color: currentColor;
				mask-position: center;
				mask-repeat: no-repeat;
				mask-size: contain;
				-webkit-mask-position: center;
				-webkit-mask-repeat: no-repeat;
				-webkit-mask-size: contain;
				opacity: 0.9;
			}

			.cleanSlate-dropdown i.codicon {
				font-size: 10px;
				opacity: 0.8;
				flex-shrink: 0;
			}

            .cleanSlate-dropdown:hover {
                color: var(--vscode-foreground);
            }

            .cleanSlate-plan-mode-chip {
                display: none;
                align-items: center;
                gap: 4px;
                padding: 4px 8px;
                border: 0;
                border-left: 1px solid var(--vscode-input-border, rgba(255,255,255,.18));
                background: transparent;
                color: var(--vscode-descriptionForeground);
                cursor: pointer;
                font-size: 11px;
                white-space: nowrap;
                height: 24px;
                box-sizing: border-box;
            }

            .cleanSlate-plan-mode-chip.active {
                color: var(--vscode-foreground);
            }

            .cleanSlate-plan-mode-chip .codicon {
                font-size: 12px;
            }

            .cleanSlate-edit-mode-chip {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 4px 8px;
                border: 0;
                border-left: 1px solid var(--vscode-input-border, rgba(255,255,255,.18));
                background: transparent;
                color: var(--vscode-descriptionForeground);
                cursor: pointer;
                font-size: 11px;
                white-space: nowrap;
                height: 24px;
                box-sizing: border-box;
            }

            .cleanSlate-edit-mode-chip.active {
                color: var(--vscode-foreground);
            }

            .cleanSlate-edit-mode-chip .codicon {
                font-size: 12px;
            }

            .cleanSlate-dropdown.mode-dropdown {
                flex: 0 1 auto;
                max-width: 96px;
            }

            .cleanSlate-dropdown.model-dropdown {
                flex: 1 1 auto;
                max-width: 128px;
            }

            .cleanSlate-dropdown.photo-button {
                padding: 0;
                width: 24px;
                height: 24px;
                justify-content: center;
                background: transparent;
                border: none !important;
                opacity: 0.7;
                transition: opacity 0.15s;
                flex-shrink: 0;
            }

            .cleanSlate-dropdown.photo-button:hover {
                opacity: 1;
                background: rgba(255, 255, 255, 0.05);
            }

            .cleanSlate-context-window-button {
                --cleanSlate-context-window-used: 0%;
                position: relative;
                width: 28px;
                height: 28px;
                padding: 0;
                border: none;
                background: transparent;
                color: var(--vscode-descriptionForeground);
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: default;
                flex: 0 0 auto;
            }

            .cleanSlate-context-window-ring {
                position: relative;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: conic-gradient(
                    var(--vscode-progressBar-background, var(--vscode-focusBorder)) var(--cleanSlate-context-window-used),
                    var(--vscode-disabledForeground, rgba(255, 255, 255, 0.28)) 0
                );
                opacity: 0.92;
            }

            .cleanSlate-context-window-ring::after {
                content: '';
                position: absolute;
                inset: 4px;
                border-radius: 50%;
                background: var(--vscode-input-background, var(--vscode-editor-background));
            }

            .cleanSlate-context-window-button:hover .cleanSlate-context-window-ring,
            .cleanSlate-context-window-button:focus-visible .cleanSlate-context-window-ring {
                opacity: 1;
            }

            .cleanSlate-context-window-button.is-generating .cleanSlate-context-window-ring {
                animation: cleanSlate-context-window-spin 1.1s linear infinite;
            }

            @keyframes cleanSlate-context-window-spin {
                to {
                    transform: rotate(360deg);
                }
            }

            .cleanSlate-context-window-tooltip {
                display: none;
                position: fixed;
                left: 0;
                top: 0;
                width: min(190px, calc(100cqw - 16px));
                max-width: calc(100vw - 16px);
                box-sizing: border-box;
                padding: 12px 16px 13px;
                border-radius: 10px;
                border: 1px solid var(--vscode-widget-border, var(--vscode-input-border));
                background: var(--vscode-editorWidget-background, var(--vscode-menu-background));
                box-shadow: 0 12px 32px rgba(0, 0, 0, 0.42);
                color: var(--vscode-foreground);
                font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
                font-variant-numeric: tabular-nums;
                -webkit-font-smoothing: antialiased;
                text-rendering: optimizeLegibility;
                text-align: center;
                pointer-events: none;
                z-index: 80;
                visibility: hidden;
            }

            .cleanSlate-context-window-tooltip.is-positioned {
                visibility: visible;
            }

            @container (max-width: 380px) {
                .cleanSlate-input-footer {
                    gap: 6px;
                }

                .cleanSlate-footer-left {
                    gap: 6px;
                }

                .cleanSlate-dropdown {
                    padding-left: 6px;
                    padding-right: 6px;
                    max-width: 104px;
                }

                .cleanSlate-dropdown.mode-dropdown {
                    max-width: 76px;
                }

                .cleanSlate-dropdown.model-dropdown {
                    max-width: 104px;
                }

            }

            .cleanSlate-context-window-button:hover .cleanSlate-context-window-tooltip,
            .cleanSlate-context-window-button:focus-visible .cleanSlate-context-window-tooltip {
                display: block;
            }

            .cleanSlate-context-window-tooltip-title,
            .cleanSlate-context-window-tooltip-percent {
                color: var(--vscode-descriptionForeground);
                font-size: 13.5px;
                font-weight: 500;
                line-height: 21px;
            }

            .cleanSlate-context-window-tooltip-title {
                margin-bottom: 1px;
            }

            .cleanSlate-context-window-tooltip-tokens {
                margin-top: 4px;
                color: var(--vscode-foreground);
                font-size: 14px;
                line-height: 22px;
                font-weight: 500;
            }

			.cleanSlate-send-button {
				width: 28px;
				height: 28px;
				background: rgba(255, 255, 255, 0.06);
				color: var(--vscode-foreground);
				border-radius: 50%;
				cursor: pointer;
				display: flex;
				justify-content: center;
				align-items: center;
				transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
				border: none;
                flex-shrink: 0;
			}

            .cleanSlate-send-button i {
                font-size: 14px;
                display: flex;
                align-items: center;
                justify-content: center;
            }

			.cleanSlate-send-button:hover {
				background: rgba(255, 255, 255, 0.12);
                transform: translateY(-1px);
			}

            .cleanSlate-send-button:active {
                transform: scale(0.95);
            }

            .cleanSlate-primary-button.approve-btn {
                background: var(--vscode-button-background, #0078D4);
                color: var(--vscode-button-foreground, #ffffff);
                border-radius: 999px;
                padding: 0 14px;
                height: 30px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                font-size: 12px;
                font-weight: 600;
                border: none;
                cursor: pointer;
                transition: background 0.15s, transform 0.1s;
            }

            .cleanSlate-primary-button.approve-btn:hover {
                background: var(--vscode-button-hoverBackground, #106ebe);
                transform: translateY(-1px);
            }

			.cleanSlate-primary-button {
				padding: 4px 10px;
				background: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
				border: none;
				border-radius: 4px;
				cursor: pointer;
				font-size: 12px;
				font-weight: 600;
				text-align: center;
			}

			.cleanSlate-primary-button:hover {
				background: var(--vscode-button-hoverBackground);
			}
			
			.cleanSlate-primary-button.premium-blue {
				background: var(--vscode-button-background, #0078D4);
				color: var(--vscode-button-foreground, #ffffff);
				border: none;
			}
			
			.cleanSlate-primary-button.premium-blue:hover {
				background: var(--vscode-button-hoverBackground, #106ebe);
			}

			.cleanSlate-text-button {
				background: transparent;
				color: var(--vscode-descriptionForeground);
				border: 1px solid rgba(255, 255, 255, 0.1);
				border-radius: 4px;
				padding: 4px 10px;
				cursor: pointer;
				font-size: 11px;
				transition: background 0.15s, color 0.15s;
			}

			.cleanSlate-text-button:hover {
				background: rgba(255, 255, 255, 0.05);
				color: var(--vscode-foreground);
			}

            .cleanSlate-primary-button.apply-btn, .cleanSlate-primary-button.accept-btn {
                background: linear-gradient(135deg, #34A853, #2E7D32);
                color: white;
            }

            .cleanSlate-primary-button.apply-btn:hover, .cleanSlate-primary-button.accept-btn:hover {
                background: linear-gradient(135deg, #3dbd5e, #34A853);
            }

            .cleanSlate-primary-button.reject-btn {
                background: rgba(255, 255, 255, 0.05);
                color: rgba(255, 255, 255, 0.8);
                border: 1px solid rgba(255, 255, 255, 0.1);
            }

            .cleanSlate-primary-button.reject-btn:hover {
                background: rgba(255, 255, 255, 0.1);
                color: #fff;
            }

			.cleanSlate-chat-message-row {
				width: 100%;
				max-width: 760px;
				display: flex;
				flex-direction: column;
				box-sizing: border-box;
			}

			.cleanSlate-chat-message-row.user {
				align-items: flex-end;
			}

			.cleanSlate-chat-message-row.cleanSlate {
				align-items: flex-start;
			}

			.cleanSlate-chat-message {
				border-radius: 14px;
				width: 100%;
				line-height: 1.6;
				font-size: 13px;
				word-wrap: break-word;
				box-sizing: border-box;
			}

			.cleanSlate-chat-message.user {
				background: var(--vscode-button-secondaryBackground, #2b2b2b);
				color: var(--vscode-button-secondaryForeground, #ffffff);
				padding: 10px 16px;
				border-radius: 12px;
				width: fit-content;
				max-width: 100%;
				border: none !important;
			}

			.cleanSlate-chat-message.user.cleanSlate-user-selection-message {
				display: inline-flex;
				align-items: center;
				gap: 9px;
				max-width: min(540px, 86%);
				padding: 7px 9px;
				border-radius: 10px;
				background: color-mix(in srgb, var(--vscode-editorWidget-background, var(--vscode-sideBar-background)) 92%, var(--vscode-foreground) 8%);
				color: var(--vscode-foreground);
				border: 1px solid color-mix(in srgb, var(--vscode-foreground) 10%, transparent) !important;
				box-shadow: 0 1px 0 color-mix(in srgb, var(--vscode-foreground) 5%, transparent) inset;
				line-height: 1.2;
			}

			.cleanSlate-user-selection-icon {
				width: 24px;
				height: 24px;
				border-radius: 6px;
				display: inline-flex;
				align-items: center;
				justify-content: center;
				flex: 0 0 auto;
				color: var(--vscode-symbolIcon-fileForeground, var(--vscode-descriptionForeground));
				background: color-mix(in srgb, var(--vscode-foreground) 7%, transparent);
			}

			.cleanSlate-user-selection-icon .codicon {
				font-size: 14px;
			}

			.cleanSlate-user-selection-body {
				min-width: 0;
				display: flex;
				align-items: center;
				gap: 7px;
				flex-wrap: wrap;
			}

			.cleanSlate-user-selection-label {
				min-width: 0;
				max-width: min(390px, 100%);
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
				font-size: 13px;
				font-weight: 600;
				letter-spacing: 0;
			}

			.cleanSlate-user-selection-command {
				flex: 0 0 auto;
				padding: 2px 6px;
				border-radius: 999px;
				font-family: var(--vscode-editor-font-family, 'Menlo', 'Courier New', monospace);
				font-size: 11px;
				font-weight: 600;
				line-height: 1.3;
				color: var(--vscode-textLink-foreground, #7aa2ff);
				background: color-mix(in srgb, var(--vscode-textLink-foreground, #7aa2ff) 14%, transparent);
				border: 1px solid color-mix(in srgb, var(--vscode-textLink-foreground, #7aa2ff) 24%, transparent);
			}

			.cleanSlate-chat-message.cleanSlate {
				color: var(--vscode-foreground);
				width: 100%;
			}

            .cleanSlate-quota-card {
                background-color: rgba(30, 30, 30, 0.4);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 10px;
                width: 100%;
                max-width: 760px;
                padding: 12px 14px;
                margin: 4px 0;
                display: flex;
                flex-direction: column;
                gap: 6px;
                width: 100%;
                box-sizing: border-box;
            }

            .cleanSlate-quota-header {
                display: flex;
                align-items: center;
                gap: 8px;
                color: #fff;
                font-weight: 600;
                font-size: 13px;
            }

            .cleanSlate-quota-header i {
                color: rgba(255, 255, 255, 0.85);
                font-size: 14px;
            }

            .cleanSlate-quota-body {
                color: rgba(255, 255, 255, 0.6);
                font-size: 12px;
                line-height: 1.4;
            }

            .cleanSlate-transport-status {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                width: fit-content;
                max-width: 760px;
                margin: 6px 0;
                padding: 6px 9px;
                border-radius: 7px;
                color: var(--vscode-descriptionForeground);
                background: color-mix(in srgb, var(--vscode-foreground) 5%, transparent);
                font-size: 12px;
                line-height: 1.35;
                font-variant-numeric: tabular-nums;
            }

            .cleanSlate-transport-status .codicon {
                color: var(--vscode-progressBar-background, #4daafc);
                font-size: 13px;
            }

            .cleanSlate-model-terminated-card {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                width: 100%;
                max-width: 760px;
                box-sizing: border-box;
                margin: 6px 0;
                padding: 10px 12px;
                border: 1px solid color-mix(in srgb, var(--vscode-errorForeground) 26%, var(--vscode-widget-border, transparent));
                border-radius: 10px;
                background: color-mix(in srgb, var(--vscode-errorForeground) 5%, var(--vscode-editor-background));
            }

            .cleanSlate-model-terminated-header {
                display: flex;
                align-items: center;
                gap: 8px;
                color: var(--vscode-foreground);
                font-size: 13px;
                font-weight: 650;
            }

            .cleanSlate-model-terminated-header .codicon {
                color: var(--vscode-errorForeground);
                font-size: 14px;
            }

            .cleanSlate-model-terminated-actions {
                display: flex;
                justify-content: flex-end;
                flex-shrink: 0;
            }

            .cleanSlate-model-continue-button {
                min-width: 76px;
                padding: 5px 12px;
                border: 1px solid transparent;
                border-radius: 6px;
                color: var(--vscode-button-foreground);
                background: var(--vscode-button-background);
                font-family: var(--vscode-font-family);
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
            }

            .cleanSlate-model-continue-button:hover:not(:disabled) {
                background: var(--vscode-button-hoverBackground);
            }

            .cleanSlate-model-continue-button:focus-visible {
                outline: 1px solid var(--vscode-focusBorder);
                outline-offset: 2px;
            }

            .cleanSlate-model-continue-button:disabled {
                opacity: 0.65;
                cursor: default;
            }

			.cleanSlate-file-row {
				display: flex;
				justify-content: space-between;
				align-items: center;
				padding: 8px 14px;
				background: rgba(255, 255, 255, 0.03);
				border: 1px solid rgba(255, 255, 255, 0.07);
				border-radius: 8px;
				margin-bottom: 6px;
				transition: background 0.2s, border-color 0.2s;
			}

			.cleanSlate-file-row:hover {
				background: rgba(255, 255, 255, 0.06);
				border-color: rgba(255, 255, 255, 0.15);
			}

			.file-status-group {
				display: flex;
				align-items: center;
				gap: 8px;
			}

			.file-name-group {
				display: flex;
				align-items: center;
				gap: 8px;
				flex: 1;
				justify-content: flex-end;
			}

			.file-right-group {
				display: flex;
				align-items: center;
				gap: 8px;
				min-width: 60px;
				justify-content: flex-end;
			}

			.cleanSlate-file-row .monaco-icon-label {
				width: 16px;
				height: 16px;
				min-width: 16px;
				flex-shrink: 0;
				line-height: 16px;
				position: relative;
			}

			.file-status-label {
				font-size: 11px;
				font-weight: 700;
				text-transform: capitalize;
				letter-spacing: 0.3px;
				color: var(--vscode-foreground);
				opacity: 0.9;
				width: 70px;
				flex-shrink: 0;
			}

			.file-status-label.created { color: var(--vscode-notebookStatusSuccessIcon-foreground); }
			.file-status-label.edited { color: var(--vscode-notebookStatusSuccessIcon-foreground); }
			.file-status-label.analyzed { color: var(--vscode-descriptionForeground); }

			.file-name {
				font-size: 13px;
				font-weight: 450;
				color: var(--vscode-foreground);
				white-space: nowrap;
			}

			.file-stats {
				display: flex;
				gap: 6px;
				font-size: 11px;
				font-family: var(--vscode-editor-font-family);
				font-weight: 600;
			}

			.stat-added {
				color: #4CAF50;
			}

			.stat-deleted {
				color: #F44336;
			}

			.file-markers {
				display: flex;
				align-items: center;
				gap: 4px;
				color: var(--vscode-notificationsWarningIcon-foreground);
				font-size: 11px;
			}

			.cleanSlate-code-block {
				margin-top: 12px;
				background-color: #1e1e1e;
				border: 1px solid #333;
				border-radius: 6px;
				padding: 12px;
				overflow-x: auto;
				font-family: var(--vscode-editor-font-family);
				font-size: 12px;
			}

				.cleanSlate-message-content {
					font-size: 13px;
					line-height: 1.6;
					color: var(--vscode-foreground);
					margin-bottom: 12px;
				}

				.cleanSlate-message-transcript {
				display: flex;
				flex-direction: column;
				gap: 10px;
			}

			.cleanSlate-finish-card {
				display: flex;
				flex-direction: column;
				gap: 8px;
				margin-top: 4px;
			}

			.cleanSlate-finish-status {
				font-size: 13px;
				font-weight: 600;
				color: var(--vscode-foreground);
			}

			.cleanSlate-finish-summary {
				font-size: 13px;
				line-height: 1.45;
				color: var(--vscode-foreground);
			}

			.cleanSlate-finish-changes-card {
				border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.12));
				border-radius: 8px;
				overflow: hidden;
				background: var(--vscode-editorWidget-background);
				width: 720px;
				max-width: 100%;
			}

			.cleanSlate-finish-changes-header {
				display: flex;
				align-items: center;
				gap: 8px;
				padding: 9px 12px;
				font-size: 13px;
				font-weight: 600;
				color: var(--vscode-foreground);
				user-select: none;
				list-style: none;
				border-bottom: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.12));
				background: rgba(255, 255, 255, 0.03);
			}

			.cleanSlate-finish-changes-title {
				white-space: nowrap;
			}

			.cleanSlate-finish-total-stats {
				display: flex;
				gap: 6px;
				font-family: var(--vscode-editor-font-family);
				font-weight: 600;
			}

			.cleanSlate-finish-header-spacer {
				flex: 1;
			}

			.cleanSlate-finish-file-list {
				display: flex;
				flex-direction: column;
			}

			.cleanSlate-finish-file-diff {
				border-top: 1px solid rgba(255, 255, 255, 0.06);
			}

			.cleanSlate-finish-file-diff:first-child {
				border-top: 0;
			}

			.cleanSlate-finish-file-diff.is-hidden-extra {
				display: none;
			}

			.cleanSlate-finish-file-row {
				display: flex;
				align-items: center;
				gap: 8px;
				width: 100%;
				min-height: 34px;
				padding: 7px 12px;
				font-size: 13px;
				user-select: none;
				border: 0;
				background: transparent;
				color: inherit;
				text-align: left;
				cursor: pointer;
			}

			.cleanSlate-finish-file-row:hover {
				background: rgba(255, 255, 255, 0.03);
			}

			.cleanSlate-finish-file-row:disabled {
				cursor: default;
			}

			.cleanSlate-finish-file-row .codicon {
				opacity: 0.75;
				font-size: 13px;
			}

			.cleanSlate-finish-file-name {
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
				color: var(--vscode-foreground);
			}

			.cleanSlate-finish-file-spacer {
				flex: 1;
			}

			.cleanSlate-finish-file-chevron {
				color: var(--vscode-descriptionForeground);
				transition: transform 0.16s ease;
			}

			.cleanSlate-finish-file-row.is-open .cleanSlate-finish-file-chevron {
				transform: rotate(90deg);
			}

			.cleanSlate-finish-diff-editor,
            .cleanSlate-file-diff-editor {
				width: 100%;
				background: var(--vscode-editor-background);
				border-top: 1px solid rgba(255, 255, 255, 0.06);
				overflow: hidden;
			}

			.cleanSlate-finish-diff-editor[hidden],
            .cleanSlate-file-diff-editor[hidden] {
				display: none;
			}

			.cleanSlate-finish-diff-editor.review-inline,
            .cleanSlate-file-diff-editor.review-inline {
				max-height: min(52vh, 520px);
				overflow: auto;
			}

			.cleanSlate-review-inline {
				width: 100%;
				min-width: 0;
			}

			.cleanSlate-review-inline .cleanSlate-review-diff {
				max-height: none;
				border-top: 0;
			}

			.cleanSlate-finish-more-row {
				display: block;
				width: 100%;
				padding: 8px 12px;
				color: var(--vscode-descriptionForeground);
				font-size: 12px;
				text-align: left;
				border: 0;
				background: transparent;
				cursor: pointer;
			}

			.cleanSlate-finish-more-row:hover {
				color: var(--vscode-foreground);
				background: rgba(255, 255, 255, 0.03);
			}

			.cleanSlate-timeline-file {
				display: flex;
				align-items: center;
				gap: 10px;
				padding: 8px 12px;
				background: rgba(255, 255, 255, 0.03);
				border: 1px solid rgba(255, 255, 255, 0.07);
				border-radius: 8px;
				font-size: 13px;
				transition: background 0.2s;
			}

			.cleanSlate-timeline-file:hover {
				background: rgba(255, 255, 255, 0.06);
			}

			.cleanSlate-timeline-file .file-icon {
				width: 16px;
				height: 16px;
				opacity: 0.8;
			}

			.cleanSlate-timeline-file .file-path {
				flex: 1;
				font-weight: 450;
				color: var(--vscode-foreground);
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.cleanSlate-timeline-file .file-status-badge {
				font-size: 10px;
				font-weight: 700;
				text-transform: uppercase;
				padding: 1px 4px;
				border-radius: 3px;
				background: rgba(255, 255, 255, 0.05);
				color: rgba(255, 255, 255, 0.6);
			}

			.cleanSlate-timeline-file .file-stats {
				font-family: var(--vscode-editor-font-family);
				font-size: 11px;
				font-weight: 600;
				display: flex;
				gap: 6px;
			}

			.cleanSlate-terminal-group {
				margin: 5px 0 8px;
			}

			.cleanSlate-terminal-group-summary {
				display: flex;
				align-items: center;
				gap: 8px;
				box-sizing: border-box;
				width: 100%;
				min-width: 0;
				padding: 4px 3px;
				color: var(--vscode-descriptionForeground);
				font-family: var(--vscode-font-family, sans-serif);
				font-size: 13px;
				line-height: 20px;
				list-style: none;
				cursor: pointer;
				user-select: none;
			}

			.cleanSlate-terminal-group-summary::-webkit-details-marker {
				display: none;
			}

			.cleanSlate-terminal-group-summary:hover {
				color: var(--vscode-foreground);
			}

			.cleanSlate-terminal-group-summary:focus-visible {
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: 2px;
				border-radius: 3px;
			}

			.cleanSlate-terminal-group-summary > .codicon-terminal {
				flex: 0 0 auto;
				font-size: 15px;
			}

			.cleanSlate-terminal-group-chevron {
				flex: 0 0 auto;
				margin-left: auto;
				font-size: 15px;
				transition: transform 100ms ease;
			}

			.cleanSlate-terminal-group[open] .cleanSlate-terminal-group-chevron {
				transform: rotate(90deg);
			}

			.cleanSlate-terminal-group-events {
				min-width: 0;
				padding: 4px 0 0 24px;
			}

			.cleanSlate-terminal-activity {
				box-sizing: border-box;
				min-width: 0;
				margin: 5px 0 8px;
			}

			.cleanSlate-terminal-activity .terminal-summary-toggle {
				display: flex;
				align-items: center;
				gap: 8px;
				box-sizing: border-box;
				width: 100%;
				min-width: 0;
				padding: 4px 3px;
				border: 0;
				background: transparent;
				color: var(--vscode-descriptionForeground);
				font-family: var(--vscode-font-family, sans-serif);
				font-size: 13px;
				line-height: 20px;
				text-align: left;
				cursor: pointer;
			}

			.cleanSlate-terminal-activity .terminal-summary-toggle:hover {
				color: var(--vscode-foreground);
			}

			.cleanSlate-terminal-activity .terminal-summary-toggle:focus-visible {
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: 2px;
				border-radius: 3px;
			}

			.cleanSlate-terminal-activity .terminal-summary-icon {
				flex: 0 0 auto;
				font-size: 15px;
			}

			.cleanSlate-terminal-activity .terminal-summary-label {
				flex: 0 0 auto;
			}

			.cleanSlate-terminal-activity .terminal-summary-command {
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.cleanSlate-terminal-activity .terminal-summary-chevron {
				flex: 0 0 auto;
				margin-left: auto;
				font-size: 15px;
			}

			.cleanSlate-terminal-block {
				--cleanSlate-terminal-surface: color-mix(
					in srgb,
					var(--vscode-editor-background) 92%,
					var(--vscode-foreground) 8%
				);
				box-sizing: border-box;
				min-width: 0;
				background: var(--cleanSlate-terminal-surface);
				border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.18));
				border-radius: 10px;
				margin: 8px 0 0;
				display: flex;
				flex-direction: column;
				overflow: hidden;
				color: var(--vscode-terminal-foreground, var(--vscode-foreground));
				font-family: var(--vscode-editor-font-family, 'Menlo', 'Monaco', 'Courier New', monospace);
				font-size: var(--vscode-editor-font-size, 13px);
			}

			.cleanSlate-terminal-block .terminal-shell-heading {
				padding: 11px 16px 0;
				color: var(--vscode-foreground);
				font-family: var(--vscode-font-family, sans-serif);
				font-size: 14px;
				font-weight: 500;
				line-height: 20px;
				user-select: none;
			}

			.cleanSlate-terminal-block .terminal-shell-viewport {
				position: relative;
				min-width: 0;
			}

			.cleanSlate-terminal-block .terminal-shell-scroll {
				--cleanSlate-terminal-viewport-height: clamp(112px, 14vh, 140px);
				box-sizing: border-box;
				flex: 0 0 var(--cleanSlate-terminal-viewport-height);
				width: 100%;
				height: var(--cleanSlate-terminal-viewport-height);
				min-height: 0;
				max-height: var(--cleanSlate-terminal-viewport-height);
				padding: 20px 16px 16px;
				overflow: auto;
				overscroll-behavior: contain;
				scrollbar-gutter: stable;
				outline: none;
			}

			.cleanSlate-terminal-block .terminal-shell-fade {
				position: absolute;
				z-index: 1;
				right: 0;
				left: 0;
				height: 24px;
				opacity: 0;
				pointer-events: none;
				transition: opacity 100ms ease-out;
			}

			.cleanSlate-terminal-block .terminal-shell-fade-top {
				top: 0;
				background: linear-gradient(
					to bottom,
					var(--cleanSlate-terminal-surface),
					transparent
				);
			}

			.cleanSlate-terminal-block .terminal-shell-fade-bottom {
				bottom: 0;
				background: linear-gradient(
					to top,
					var(--cleanSlate-terminal-surface),
					transparent
				);
			}

			.cleanSlate-terminal-block .terminal-shell-viewport.has-overflow-above .terminal-shell-fade-top,
			.cleanSlate-terminal-block .terminal-shell-viewport.has-overflow-below .terminal-shell-fade-bottom {
				opacity: 1;
			}

			.cleanSlate-terminal-block .terminal-shell-status {
				display: flex;
				align-items: center;
				justify-content: flex-end;
				gap: 6px;
				min-height: 20px;
				padding: 0 16px 12px;
				font-family: var(--vscode-font-family, sans-serif);
				font-size: 13px;
				line-height: 20px;
				color: var(--vscode-descriptionForeground);
			}

			.cleanSlate-terminal-block .terminal-shell-status .codicon {
				font-size: 14px;
			}

			.cleanSlate-terminal-block .terminal-shell-status.failed {
				color: var(--vscode-testing-iconFailed, var(--vscode-errorForeground));
			}

			.cleanSlate-terminal-block .terminal-shell-status.running {
				color: var(--vscode-progressBar-background, var(--vscode-descriptionForeground));
			}

			.cleanSlate-terminal-block .terminal-shell-scroll:focus-visible {
				box-shadow: inset 0 0 0 1px var(--vscode-focusBorder);
			}

			.cleanSlate-terminal-block .terminal-cmd-row {
				display: flex;
				align-items: baseline;
				gap: 10px;
				min-width: max-content;
				color: var(--vscode-terminal-foreground, var(--vscode-foreground));
				line-height: 1.55;
			}

			.cleanSlate-terminal-block .terminal-prompt {
				flex: 0 0 auto;
				color: var(--vscode-descriptionForeground);
				user-select: none;
			}

			.cleanSlate-terminal-block .terminal-cmd-text {
				color: var(--vscode-terminal-foreground, var(--vscode-foreground));
				white-space: pre;
			}

			.cleanSlate-terminal-block .terminal-pre-output {
				min-width: max-content;
				margin: 0;
				padding: 0;
				background: transparent;
				color: var(--vscode-terminal-foreground, var(--vscode-foreground));
				font-family: inherit;
				font-size: inherit;
				line-height: 1.5;
				white-space: pre;
				word-break: normal;
				overflow-wrap: normal;
			}

			.cleanSlate-terminal-block .terminal-cmd-row + .terminal-pre-output {
				margin-top: 16px;
			}

			.cleanSlate-terminal-block .terminal-shell-scroll::-webkit-scrollbar {
				width: 8px;
				height: 8px;
			}

			.cleanSlate-terminal-block .terminal-shell-scroll::-webkit-scrollbar-thumb {
				background: var(--vscode-scrollbarSlider-background);
				border-radius: 4px;
			}

			.cleanSlate-terminal-block .terminal-shell-scroll::-webkit-scrollbar-thumb:hover {
				background: var(--vscode-scrollbarSlider-hoverBackground);
			}

			.cleanSlate-terminal-block .terminal-shell-scroll::-webkit-scrollbar-track {
				background: transparent;
			}

			.cleanSlate-message-content strong {
				color: var(--vscode-foreground);
				font-weight: 600;
			}

			.cleanSlate-tool-activity-row {
				display: inline-flex;
				align-items: center;
				gap: 8px;
				max-width: 100%;
				min-height: 22px;
				color: var(--vscode-descriptionForeground);
				font-size: 13px;
				line-height: 1.4;
				user-select: none;
			}

			.cleanSlate-tool-activity-row .codicon {
				font-size: 13px;
				opacity: 0.82;
				flex: 0 0 auto;
			}

			.cleanSlate-tool-activity-label {
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.cleanSlate-tool-activity-status {
				color: var(--vscode-disabledForeground, rgba(255, 255, 255, 0.38));
				font-size: 12px;
				flex: 0 0 auto;
			}

			.cleanSlate-tool-activity-row.status-failed,
			.cleanSlate-tool-activity-row.status-failed .cleanSlate-tool-activity-status {
				color: var(--vscode-errorForeground);
			}

			.cleanSlate-message-content em {
				font-style: italic;
				color: var(--vscode-descriptionForeground);
			}

			.cleanSlate-message-content code {
				font-family: var(--vscode-editor-font-family, 'Menlo', 'Courier New', monospace);
				/* em-based so inline code tracks the surface's body size
				   (13px sidebar → ~11.7px, 15px agent manager → ~13.5px). */
				font-size: 0.9em;
				background: var(--vscode-textCodeBlock-background, color-mix(in srgb, var(--vscode-foreground) 8%, transparent));
				color: var(--vscode-textPreformat-foreground, var(--vscode-editor-foreground, var(--vscode-foreground)));
				font-weight: 600;
				padding: 1px 5px;
				border-radius: 4px;
				border: 1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
			}

			.cleanSlate-message-content .rendered-markdown {
				color: inherit;
				font-family: inherit;
				font-size: inherit;
				line-height: inherit;
			}

			.cleanSlate-message-content .rendered-markdown p {
				margin: 0 0 10px;
			}

				.cleanSlate-message-content .rendered-markdown > :last-child {
					margin-bottom: 0;
				}

			.cleanSlate-message-content ul,
			.cleanSlate-message-content ol {
				padding-left: 20px;
				margin: 6px 0;
			}

			.cleanSlate-message-content li {
				margin-bottom: 3px;
			}

			.cleanSlate-message-content hr {
				border: none;
				border-top: 1px solid var(--vscode-widget-border, color-mix(in srgb, var(--vscode-foreground) 12%, transparent));
				margin: 10px 0;
			}

			.cleanSlate-settings-popup {
				position: absolute;
				bottom: 60px;
				right: 12px;
				width: 240px;
				background: var(--vscode-menu-background);
				border: 1px solid var(--vscode-widget-border);
				border-radius: 8px;
				padding: 12px;
				box-shadow: 0 4px 12px rgba(0,0,0,0.3);
				display: none;
				flex-direction: column;
				gap: 12px;
				z-index: 1000;
			}

			.cleanSlate-settings-popup.visible {
				display: flex;
			}

			.cleanSlate-settings-popup .cleanSlate-settings-row {
				display: flex;
				flex-direction: column;
				gap: 4px;
			}

			.cleanSlate-settings-popup .cleanSlate-settings-label {
				font-size: 11px;
				font-weight: 600;
				color: var(--vscode-descriptionForeground);
				text-transform: uppercase;
			}

			.cleanSlate-settings-popup .cleanSlate-settings-input {
				background: var(--vscode-input-background);
				color: var(--vscode-input-foreground);
				border: 1px solid var(--vscode-input-border);
				border-radius: 4px;
				padding: 4px 8px;
				font-size: 12px;
				outline: none;
			}

			.cleanSlate-settings-popup .cleanSlate-settings-input:focus {
				border-color: var(--vscode-focusBorder);
			}
			.cleanSlate-footer-right {
				display: flex;
				align-items: center;
				gap: 4px;
				justify-content: flex-end;
				flex-shrink: 0;
			}

            .cleanSlate-history-overlay {
                position: relative;
                max-width: calc(100vw - 24px);
                max-height: 320px;
                box-sizing: border-box;
                display: none;
                flex-direction: column;
                background: var(--vscode-menu-background, rgba(24, 24, 24, 0.96));
                backdrop-filter: blur(28px) saturate(180%);
                -webkit-backdrop-filter: blur(28px) saturate(180%);
                border: 1px solid var(--vscode-widget-border, var(--vscode-menu-border, rgba(255, 255, 255, 0.14)));
                border-radius: 9px;
                box-shadow: 0 18px 48px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.45));
                color: var(--vscode-menu-foreground, var(--vscode-foreground));
                z-index: 10000;
                overflow: hidden;
                animation: premium-fade-in-up 0.16s cubic-bezier(0.16, 1, 0.3, 1);
            }

            @keyframes premium-fade-in-up {
                from { opacity: 0; transform: translateY(4px) scale(0.99); }
                to { opacity: 1; transform: translateY(0) scale(1); }
            }

            .cleanSlate-history-overlay.visible {
                display: flex;
            }

            .cleanSlate-history-header {
                padding: 8px 8px 6px;
            }

            .cleanSlate-history-search-container {
                position: relative;
                display: flex;
                align-items: center;
                background: transparent;
                border: none;
                border-radius: 6px;
                padding: 0 8px;
                transition: background 0.16s ease;
            }

            .cleanSlate-history-search-container i.codicon-search {
                font-size: 15px;
                color: var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground, var(--vscode-menu-foreground, var(--vscode-foreground))));
                margin-right: 8px;
            }

            .cleanSlate-history-search {
                flex: 1;
                background: transparent;
                color: var(--vscode-input-foreground, var(--vscode-menu-foreground, var(--vscode-foreground)));
                border: none;
                padding: 6px 0;
                font-size: 13px;
                line-height: 20px;
                outline: none !important;
                box-shadow: none !important;
            }

            .cleanSlate-history-search::placeholder {
                color: var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground, var(--vscode-menu-foreground, var(--vscode-foreground))));
            }

            .cleanSlate-history-search-container:focus-within {
                background: color-mix(in srgb, var(--vscode-menu-foreground, var(--vscode-foreground)) 7%, transparent);
            }

            .cleanSlate-history-list {
                overflow-y: auto;
                padding: 0 6px 6px;
                display: flex;
                flex-direction: column;
                gap: 0;
            }

            .cleanSlate-history-list::-webkit-scrollbar {
                width: 10px;
            }
            .cleanSlate-history-list::-webkit-scrollbar-track {
                background: transparent;
            }
            .cleanSlate-history-list::-webkit-scrollbar-thumb {
                background: #000000;
                border: 3px solid transparent;
                background-clip: padding-box;
                border-radius: 10px;
            }
            .cleanSlate-history-list::-webkit-scrollbar-thumb:hover {
                background: #111111;
            }

            .cleanSlate-history-section {
                display: flex;
                flex-direction: column;
                gap: 3px;
            }

            .cleanSlate-history-section-title {
                font-size: 12px;
                font-weight: 600;
                color: var(--vscode-descriptionForeground, var(--vscode-menu-foreground, var(--vscode-foreground)));
                padding: 6px 9px 5px;
                letter-spacing: 0;
                text-transform: none;
            }

            .cleanSlate-history-item {
                display: flex;
                align-items: center;
                min-height: 46px;
                padding: 0 9px;
                border-radius: 6px;
                cursor: pointer;
                transition: background 0.12s ease, color 0.12s ease;
                gap: 9px;
            }

            .cleanSlate-history-item:hover {
                background: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.08));
            }

            .cleanSlate-history-item.active {
                background: var(--vscode-list-activeSelectionBackground, rgba(255, 255, 255, 0.13));
            }

            .cleanSlate-history-active-indicator {
                width: 14px;
                height: 14px;
                display: flex;
                align-items: center;
                justify-content: center;
                flex: 0 0 auto;
                color: var(--vscode-descriptionForeground, var(--vscode-menu-foreground, var(--vscode-foreground)));
                border: 1.2px solid transparent;
                border-radius: 50%;
                font-size: 6px;
                line-height: 1;
                opacity: 0.58;
                transition: opacity 0.16s ease;
            }

            .cleanSlate-history-item.active .cleanSlate-history-active-indicator {
                opacity: 1;
                color: var(--vscode-list-activeSelectionForeground, var(--vscode-menu-selectionForeground, #ffffff));
            }

            .cleanSlate-history-active-indicator i {
                font-size: 6px;
            }

            .cleanSlate-history-item.running .cleanSlate-history-active-indicator i {
                font-size: 12px;
            }

            .cleanSlate-history-item-left {
                display: flex;
                flex-direction: column;
                flex: 1;
                overflow: hidden;
            }

            .cleanSlate-history-item-right {
                display: flex;
                align-items: center;
                gap: 4px;
                opacity: 0;
                transition: opacity 0.16s ease;
            }

            .cleanSlate-history-item:hover .cleanSlate-history-item-right {
                opacity: 1;
            }

            .cleanSlate-history-delete-btn {
                width: 24px;
                height: 24px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 4px;
                color: var(--vscode-descriptionForeground, var(--vscode-icon-foreground, var(--vscode-menu-foreground, var(--vscode-foreground))));
                transition: all 0.12s ease;
            }

            .cleanSlate-history-delete-btn:hover {
                background: rgba(239, 68, 68, 0.22);
                color: #EF4444;
            }

            .cleanSlate-history-delete-btn i {
                font-size: 13px;
            }

            .cleanSlate-history-item-title {
                font-size: 13px;
                font-weight: 600;
                color: var(--vscode-menu-foreground, var(--vscode-foreground));
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .cleanSlate-history-item.active .cleanSlate-history-item-title,
            .cleanSlate-history-item.active .cleanSlate-history-item-context {
                color: var(--vscode-list-activeSelectionForeground, var(--vscode-menu-selectionForeground, #ffffff));
            }

            .cleanSlate-history-item-context {
                margin-top: 2px;
                font-size: 11px;
                line-height: 14px;
                color: var(--vscode-descriptionForeground, var(--vscode-menu-foreground, var(--vscode-foreground)));
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .cleanSlate-history-empty {
                padding: 14px 12px 16px;
                color: var(--vscode-descriptionForeground, var(--vscode-menu-foreground, var(--vscode-foreground)));
                font-size: 13px;
            }

            .cleanSlate-model-selector-overlay {
                position: fixed;
                width: min(340px, calc(100vw - 24px));
                max-height: min(360px, calc(100vh - 24px));
                background: var(--vscode-editorWidget-background, var(--vscode-menu-background));
                border: 1px solid var(--vscode-widget-border, var(--vscode-input-border));
                border-radius: 8px;
                box-shadow: 0 12px 36px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36));
                z-index: 20000;
                padding: 6px;
                display: flex;
                flex-direction: column;
                gap: 4px;
                box-sizing: border-box;
                color: var(--vscode-foreground);
                overflow: hidden;
                animation: cleanSlate-fade-in-up 0.16s cubic-bezier(0.16, 1, 0.3, 1);
            }

            .cleanSlate-agent-popup {
                position: absolute;
                bottom: var(--cleanSlate-agent-popup-bottom, calc(100% + 10px));
                left: var(--cleanSlate-agent-popup-left, 6px);
                right: var(--cleanSlate-agent-popup-right, 6px);
                width: auto;
                max-height: var(--cleanSlate-agent-popup-max-height, min(420px, calc(100vh - 180px)));
                background: color-mix(in srgb, var(--vscode-editorWidget-background, var(--vscode-menu-background)) 97%, transparent);
                border: 1px solid color-mix(in srgb, var(--vscode-widget-border, var(--vscode-input-border)) 70%, transparent);
                border-radius: 8px;
                box-shadow: 0 16px 44px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.24));
                display: flex;
                flex-direction: column;
                z-index: 12000;
                opacity: 0;
                pointer-events: none;
                transform: translateY(8px) scale(0.99);
                transition: opacity 0.14s ease, transform 0.14s ease;
                overflow-x: hidden;
                overflow-y: auto;
                overscroll-behavior: contain;
                scrollbar-gutter: stable;
                padding: 6px;
                box-sizing: border-box;
                backdrop-filter: blur(18px);
            }

            .cleanSlate-agent-popup.visible {
                opacity: 1;
                pointer-events: auto;
                transform: translateY(0) scale(1);
            }

            .cleanSlate-agent-popup-header {
                padding: 14px 16px 10px;
                font-size: 13px;
                font-weight: 650;
                color: var(--vscode-descriptionForeground);
                letter-spacing: 0;
            }

            .cleanSlate-agent-popup-item {
                display: flex;
                align-items: center;
                gap: 10px;
                min-height: 40px;
                padding: 5px 8px;
                cursor: pointer;
                border-radius: 6px;
                box-sizing: border-box;
            }

            .cleanSlate-agent-popup-item:hover {
                background: color-mix(in srgb, var(--vscode-list-hoverBackground) 86%, transparent);
            }

            .cleanSlate-agent-popup-item.active {
                background: color-mix(in srgb, var(--vscode-list-hoverBackground) 92%, transparent);
            }

            .cleanSlate-agent-popup-icon {
                width: 18px;
                min-width: 18px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                font-size: 15px;
                color: var(--vscode-descriptionForeground);
            }

            .cleanSlate-agent-popup-content {
                min-width: 0;
                flex: 1 1 auto;
                display: flex;
                flex-direction: column;
                gap: 1px;
            }

            .cleanSlate-agent-popup-item.active .cleanSlate-agent-popup-icon,
            .cleanSlate-agent-popup-item.active .cleanSlate-agent-popup-title {
                color: var(--vscode-foreground);
            }

            .cleanSlate-agent-popup-item.active .cleanSlate-agent-popup-desc {
                color: var(--vscode-descriptionForeground);
                opacity: 0.72;
            }

            .cleanSlate-agent-popup-title-row {
                display: flex;
                align-items: baseline;
                gap: 8px;
                min-width: 0;
            }

            .cleanSlate-agent-popup-title {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                font-size: 13px;
                color: var(--vscode-foreground);
                font-weight: 600;
                line-height: 17px;
                white-space: nowrap;
            }

            .cleanSlate-agent-popup-command {
                flex: 0 0 auto;
                font-size: 12px;
                color: var(--vscode-descriptionForeground);
                opacity: 0.6;
                white-space: nowrap;
            }

            .cleanSlate-agent-popup-desc {
                font-size: 12px;
                color: var(--vscode-descriptionForeground);
                line-height: 16px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                opacity: 0.72;
            }

            .cleanSlate-selection-ref {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                min-width: 0;
                max-width: 100%;
                height: 24px;
                padding: 3px 8px;
                border: 1px solid var(--vscode-input-border, rgba(255,255,255,.16));
                border-radius: 6px;
                background: color-mix(in srgb, var(--vscode-button-secondaryBackground, rgba(255,255,255,.08)) 86%, transparent);
                color: var(--vscode-foreground);
                font-size: 12px;
                line-height: 16px;
                box-sizing: border-box;
            }

            .cleanSlate-selection-ref span {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .cleanSlate-selection-ref .codicon-symbol-file {
                color: var(--vscode-textLink-foreground);
                font-size: 13px;
            }

            .cleanSlate-selection-ref-delete {
                border: 0;
                background: transparent;
                color: inherit;
                padding: 0;
                margin: 0 0 0 2px;
                width: 16px;
                height: 16px;
                display: inline-grid;
                place-items: center;
                cursor: pointer;
                opacity: 0.72;
            }

            .cleanSlate-selection-ref-delete:hover {
                opacity: 1;
            }

            @keyframes fade-in-up {
                from { opacity: 0; transform: translateY(10px); }
                to { opacity: 1; transform: translateY(0); }
            }

            .cleanSlate-model-selector-overlay .selector-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                padding: 6px 8px 8px;
                border-bottom: 0;
            }

            .cleanSlate-model-selector-overlay .selector-row span {
                font-size: 11px;
                font-weight: 600;
                color: var(--vscode-descriptionForeground);
                text-transform: uppercase;
                letter-spacing: 0;
            }

            .cleanSlate-model-selector-overlay .model-list-container {
                flex: 1 1 auto;
                max-height: min(260px, calc(100vh - 128px));
                overflow-x: hidden;
                overflow-y: auto;
                overscroll-behavior: contain;
                scrollbar-gutter: stable;
                display: flex;
                flex-direction: column;
                gap: 1px;
                min-height: 0;
            }

			.cleanSlate-model-selector-overlay .model-list-container.status {
				overflow: hidden;
				scrollbar-gutter: auto;
				margin: 0;
			}

            .cleanSlate-model-selector-overlay .model-item {
                width: 100%;
                min-width: 0;
                height: 28px;
                min-height: 28px;
                padding: 0 10px;
                box-sizing: border-box;
                cursor: pointer;
                border-radius: 6px;
                font-size: 13px;
                line-height: 28px;
                color: var(--vscode-foreground);
                display: flex;
                align-items: center;
				gap: 9px;
                transition: background 0.15s, color 0.15s;
            }

			.cleanSlate-model-selector-overlay .model-item-provider-logo {
				width: 16px;
				height: 16px;
				flex-basis: 16px;
			}

            .cleanSlate-model-selector-overlay .model-item-label {
                display: block;
                flex: 1 1 auto;
                min-width: 0;
                max-width: 100%;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .cleanSlate-model-selector-overlay .model-item:hover {
                background-color: var(--vscode-list-hoverBackground);
                color: var(--vscode-list-hoverForeground, var(--vscode-foreground));
            }

            .cleanSlate-model-selector-overlay .model-item.active {
                background-color: var(--vscode-list-activeSelectionBackground);
                color: var(--vscode-list-activeSelectionForeground);
                font-weight: 500;
            }

            .cleanSlate-model-selector-overlay .model-item.is-credits-locked {
                cursor: default;
                opacity: 0.55;
            }

            .cleanSlate-model-selector-overlay .model-item.is-credits-locked:hover {
                background-color: transparent;
                color: var(--vscode-foreground);
            }

            .cleanSlate-model-selector-overlay .model-item-credits-badge {
                flex: 0 0 auto;
                display: inline-flex;
                align-items: center;
                gap: 4px;
                font-size: 11px;
                line-height: 1;
                opacity: 0.9;
                color: var(--vscode-descriptionForeground, var(--vscode-foreground));
            }

            .cleanSlate-model-selector-overlay .model-item-credits-badge .codicon {
                font-size: 12px;
            }

            .cleanSlate-model-selector-overlay .cleanSlate-provider-select {
                display: flex;
                align-items: center;
                gap: 6px;
                max-width: 180px;
                padding: 3px 6px 3px 9px;
                background: transparent;
                border: 1px solid transparent;
                border-radius: 6px;
                color: var(--vscode-foreground);
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                outline: none;
                transition: background 0.15s, border-color 0.15s;
            }

            .cleanSlate-model-selector-overlay .cleanSlate-provider-select:hover,
            .cleanSlate-model-selector-overlay .cleanSlate-provider-select.open {
                background: var(--vscode-list-hoverBackground);
                border-color: var(--vscode-widget-border, var(--vscode-input-border));
            }

            .cleanSlate-model-selector-overlay .cleanSlate-provider-select-label {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .cleanSlate-model-selector-overlay .cleanSlate-provider-select-chevron {
                flex: 0 0 auto;
                font-size: 14px;
                color: var(--vscode-descriptionForeground);
                transition: transform 0.15s ease;
            }

            .cleanSlate-model-selector-overlay .cleanSlate-provider-select.open .cleanSlate-provider-select-chevron {
                transform: rotate(180deg);
            }

            .cleanSlate-model-selector-overlay .model-status-item {
                padding: 14px 12px;
                font-size: 13px;
                color: var(--vscode-foreground);
                background: color-mix(in srgb, var(--vscode-list-hoverBackground, var(--vscode-foreground)) 55%, transparent);
                border-radius: 8px;
                border: 1px solid var(--vscode-widget-border, var(--vscode-input-border));
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                text-align: center;
                gap: 12px;
                margin-top: 8px;
            }

            .cleanSlate-model-selector-overlay .model-status-item.is-loading {
                min-height: 76px;
                margin-top: 0;
            }

            .cleanSlate-model-selector-overlay .model-status-icon {
                font-size: 24px;
                color: var(--vscode-notificationsWarningIcon-foreground);
            }

            .cleanSlate-model-selector-overlay .model-status-title {
                font-weight: 600;
                font-size: 14px;
            }

            .cleanSlate-model-selector-overlay .model-status-description {
                color: var(--vscode-descriptionForeground);
                font-size: 12px;
                line-height: 1.4;
            }

            .cleanSlate-model-selector-overlay .settings-button {
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                padding: 6px 16px;
                border: 0;
                border-radius: 6px;
                cursor: pointer;
                font-size: 12px;
				font-weight: 400;
                margin-top: 4px;
                transition: background 0.15s;
            }

            .cleanSlate-model-selector-overlay .settings-button:hover {
                background: var(--vscode-button-hoverBackground);
            }

            .cleanSlate-loading-overlay {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(30, 30, 30, 0.7);
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                display: none;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                z-index: 10000;
                animation: fade-in 0.3s ease;
            }

            .cleanSlate-loading-overlay.visible {
                display: flex;
            }

            .loading-content {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 20px;
                text-align: center;
                padding: 40px;
            }

            .loading-spinner {
                width: 40px;
                height: 40px;
                border: 3px solid rgba(255, 255, 255, 0.1);
                border-top-color: var(--vscode-progressBar-background, #0078d4);
                border-radius: 50%;
                animation: cleanSlate-spin 1s cubic-bezier(0.5, 0.1, 0.4, 0.9) infinite;
            }

            .loading-text {
                font-size: 18px;
                font-weight: 600;
                color: #fff;
                letter-spacing: -0.02em;
            }

            .loading-subtext {
                font-size: 13px;
                color: rgba(255, 255, 255, 0.5);
                max-width: 240px;
                line-height: 1.5;
            }

            .cleanSlate-working-placeholder {
                margin-bottom: 8px;
                padding: 8px 0;
                color: var(--vscode-descriptionForeground);
                font-size: 12px;
                box-sizing: border-box;
                min-height: 34px;
            }

            .cleanSlate-working-row {
                display: flex;
                align-items: center;
                user-select: none;
                min-height: 18px;
                box-sizing: border-box;
            }

            .cleanSlate-tool-call,
            .cleanSlate-browser-action-item,
            .cleanSlate-web-block {
                min-height: 34px;
                box-sizing: border-box;
            }

            .cleanSlate-working-label,
            .cleanSlate-timeline-block.is-active .cleanSlate-activity-label,
            .cleanSlate-timeline-block.is-active .cleanSlate-file-analyzed .analyzed-label,
            .cleanSlate-timeline-block.is-active .cleanSlate-file-analyzed .file-name,
            .cleanSlate-timeline-block.is-active .cleanSlate-tool-activity-label,
            .cleanSlate-timeline-block.is-active .cleanSlate-tool-activity-status,
            .cleanSlate-timeline-block.is-active .cleanSlate-web-activity-text,
            .cleanSlate-timeline-block.is-active .cleanSlate-browser-action {
                position: relative;
                color: var(--vscode-descriptionForeground);
                background: linear-gradient(
                    90deg,
                    color-mix(in srgb, var(--vscode-descriptionForeground) 72%, transparent) 0%,
                    color-mix(in srgb, var(--vscode-descriptionForeground) 72%, transparent) 38%,
                    var(--vscode-foreground) 50%,
                    color-mix(in srgb, var(--vscode-descriptionForeground) 72%, transparent) 62%,
                    color-mix(in srgb, var(--vscode-descriptionForeground) 72%, transparent) 100%
                );
                background-size: 280% 100%;
                background-position: 120% 0;
                -webkit-background-clip: text;
                background-clip: text;
                -webkit-text-fill-color: transparent;
                animation: cleanSlate-working-sheen 2.8s ease-in-out infinite alternate;
            }

            @keyframes cleanSlate-working-sheen {
                from {
                    background-position: 120% 0;
                }
                to {
                    background-position: -120% 0;
                }
            }

            .cleanSlate-working-placeholder {
                transition: opacity 0.12s ease;
            }

            .cleanSlate-working-placeholder.is-exiting {
                opacity: 0;
            }

            @media (prefers-reduced-motion: reduce) {
                .cleanSlate-working-label,
                .cleanSlate-timeline-block,
                .cleanSlate-timeline-block.is-active .cleanSlate-activity-label,
                .cleanSlate-timeline-block.is-active .cleanSlate-file-analyzed .analyzed-label,
                .cleanSlate-timeline-block.is-active .cleanSlate-file-analyzed .file-name,
                .cleanSlate-timeline-block.is-active .cleanSlate-tool-activity-label,
                .cleanSlate-timeline-block.is-active .cleanSlate-tool-activity-status,
                .cleanSlate-timeline-block.is-active .cleanSlate-web-activity-text,
                .cleanSlate-timeline-block.is-active .cleanSlate-browser-action,
                .cleanSlate-web-activity.is-running .cleanSlate-web-activity-status::before,
                .cleanSlate-web-activity.is-running .cleanSlate-web-activity-rule::after,
                .cleanSlate-web-block.is-running .cleanSlate-web-favicon,
                .cleanSlate-web-block.is-running .cleanSlate-web-activity-symbol,
                .cleanSlate-activity-content .activity-detail-item:last-child,
                .cleanSlate-assistant-text-block {
                    animation: none;
                }
            }

            .cleanSlate-system-confirmation {
                width: 100%;
                max-width: 760px;
                margin: 8px 0;
                padding: 1px;
                background: linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.04));
                border-radius: 2px;
                position: relative;
                overflow: hidden;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
                flex-shrink: 0;
                align-self: center;
                box-sizing: border-box;
            }

            .cleanSlate-system-confirmation-inner {
                background: rgba(25, 25, 25, 0.85);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                border-radius: 1px;
                padding: 8px 14px;
                display: flex;
                flex-direction: column;
                gap: 8px;
                border: 1px solid rgba(255, 255, 255, 0.06);
            }

            .cleanSlate-system-confirmation-header {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .cleanSlate-system-confirmation-icon {
                width: 20px;
                height: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
                color: #4EC9B0;
                font-size: 14px;
            }

            .cleanSlate-system-confirmation-title {
                font-size: 13px;
                font-weight: 600;
                color: #fff;
                letter-spacing: -0.01em;
            }

            .cleanSlate-system-confirmation-body {
                font-size: 12px;
                line-height: 1.5;
                color: rgba(255, 255, 255, 0.7);
            }

            .cleanSlate-system-confirmation-glow {
                position: absolute;
                top: -50%;
                left: -50%;
                width: 200%;
                height: 200%;
                background: transparent;
                pointer-events: none;
                z-index: 0;
            }

            .cleanSlate-global-status-container {
                display: none;
                flex-direction: column;
                padding: 4px 10px 6px;
                width: 100%;
                max-width: 760px;
                margin: 0 auto;
                box-sizing: border-box;
                background: color-mix(in srgb, var(--vscode-editorWidget-background, var(--vscode-sideBar-background)) 48%, transparent);
                border: 1px solid color-mix(in srgb, var(--vscode-foreground) 7%, transparent);
                border-radius: 12px;
                box-shadow: 0 8px 24px color-mix(in srgb, var(--vscode-editor-background) 35%, transparent);
                backdrop-filter: blur(18px);
                -webkit-backdrop-filter: blur(18px);
            }

            .cleanSlate-global-status-container.visible {
                display: flex;
            }

            .cleanSlate-file-diff-list {
                display: flex;
                flex-direction: column;
                gap: 0;
                padding: 0;
                background: transparent;
                border: none;
                border-radius: 0;
                margin: 0;
                width: 100%;
                max-width: 760px;
                max-height: 132px;
                overflow-y: auto;
                box-sizing: border-box;
                box-shadow: none;
            }

            .cleanSlate-global-actions-bar {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 3px 4px 0;
                width: 100%;
                max-width: 760px;
                margin: 0 auto;
            }

            .global-actions-left {
                display: flex;
                align-items: center;
                gap: 6px;
                color: var(--vscode-foreground);
                flex: 1;
                min-width: 0;
            }

            .global-actions-left i.codicon-file-submodule {
                font-size: 14px;
                color: var(--vscode-descriptionForeground);
            }

            .global-actions-text {
                font-size: 12px;
                font-weight: 450;
                letter-spacing: -0.01em;
                flex: 1;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .global-actions-buttons {
                display: flex;
                align-items: center;
                gap: 6px;
                flex-shrink: 0;
                margin-left: 8px;
            }

            .cleanSlate-text-button.reject-all-btn,
            .cleanSlate-text-button.review-btn {
                background: none;
                border: none;
                color: var(--vscode-descriptionForeground);
                font-size: 12px;
                font-weight: 400;
                cursor: pointer;
                transition: color 0.2s;
            }

            .cleanSlate-text-button.reject-all-btn:hover,
            .cleanSlate-text-button.review-btn:hover {
                color: var(--vscode-foreground);
            }

            .cleanSlate-primary-button.accept-btn.premium-blue {
                background: var(--vscode-button-background, #0078D4);
                color: var(--vscode-button-foreground, #ffffff);
                border-radius: 6px;
                padding: 3px 8px;
                font-size: 12px;
                font-weight: 500;
                display: flex;
                align-items: center;
                gap: 6px;
                border: none;
                cursor: pointer;
                white-space: nowrap;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
                transition: background 0.15s, transform 0.1s;
            }

            .cleanSlate-primary-button.premium-blue:hover {
                background: #106ebe;
            }
            .cleanSlate-primary-button.premium-blue:active { transform: scale(0.98); }

            .file-diff-item {
                display: flex;
                align-items: center;
                gap: 12px;
            }

            .file-diff-icon {
                color: #D18435;
                font-size: 11px;
                opacity: 0.9;
            }

            .file-diff-stats {
                display: flex;
                gap: 8px;
                font-family: var(--vscode-editor-font-family);
                font-size: 12px;
                font-weight: 700;
            }

            .stat-added { color: #4EC9B0; }
            .stat-deleted { color: #F44747; }

            .file-diff-name {
                color: var(--vscode-foreground);
                font-size: 13px;
                font-weight: 400;
            }

            .file-diff-path {
                color: var(--vscode-descriptionForeground);
                font-size: 12px;
                font-weight: 350;
            }

            .cleanSlate-file-row {
                display: flex;
                align-items: center;
                flex-wrap: nowrap;
                gap: 5px;
                padding: 1px 4px;
                background: transparent;
                border-radius: 6px;
                margin-top: 0;
                border: 1px solid transparent;
                transition: background 0.2s, border 0.2s;
                min-width: 0;
            }

            .cleanSlate-file-row:hover {
                background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
                border: 1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
            }

            .cleanSlate-file-row .cleanSlate-file-icon {
                width: 16px;
                height: 16px;
                flex: 0 0 16px;
                margin: 0 2px;
                overflow: visible;
                font-size: 15px;
                line-height: 16px;
                text-align: center;
                color: var(--vscode-descriptionForeground);
            }

            .file-status-label {
                font-size: 11px;
                font-weight: 600;
                padding: 1px 0;
                border-radius: 4px;
                text-transform: capitalize;
                margin-right: 2px;
            }

            .file-status-label.edited,
            .file-status-label.created,
            .file-status-label.analyzed {
                color: var(--vscode-foreground);
            }

            .cleanSlate-file-row .monaco-icon-label {
                width: 16px;
                height: 16px;
                background-size: contain;
                background-repeat: no-repeat;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                margin: 0 4px;
                background: transparent;
                border-radius: 0;
                margin-top: 0;
                align-self: center;
            }

            .cleanSlate-file-row .file-name {
                font-size: 12px;
                font-weight: 450;
                color: var(--vscode-foreground);
                flex: 1;
                line-height: 16px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .cleanSlate-review-panel {
                display: none;
                width: 100%;
                max-width: 760px;
                min-height: 220px;
                max-height: min(58vh, 620px);
                margin: 0 auto 8px;
                border: 1px solid color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
                border-radius: 10px;
                background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
                overflow: hidden;
                box-sizing: border-box;
            }

            .cleanSlate-review-panel.visible {
                display: flex;
                flex-direction: column;
            }

            .cleanSlate-review {
                width: 100%;
                height: 100%;
                min-width: 0;
                min-height: 0;
                display: flex;
                flex-direction: column;
                background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
            }

            .cleanSlate-review-summary {
                flex: 0 0 auto;
                min-height: 44px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                padding: 0 12px;
                box-sizing: border-box;
                border-bottom: 1px solid color-mix(in srgb, var(--vscode-foreground) 9%, transparent);
            }

            /* Review toolbar: scope dropdown + total diffstat. */
            .cleanSlate-review-toolbar {
                position: relative;
                flex: 0 0 auto;
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 10px 12px 0;
                margin-bottom: 8px;
            }

            .cleanSlate-review-scope {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                height: 28px;
                padding: 0 10px;
                border: 0;
                border-radius: 7px;
                background: color-mix(in srgb, var(--vscode-foreground) 6%, transparent);
                color: var(--vscode-foreground);
                font-family: var(--vscode-font-family);
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                transition: background-color 120ms ease;
            }

            .cleanSlate-review-scope:hover {
                background: color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
            }

            .cleanSlate-review-scope-chevron {
                font-size: 12px;
                color: var(--vscode-descriptionForeground);
            }

            .cleanSlate-review-scope-menu {
                position: absolute;
                top: calc(100% + 6px);
                left: 0;
                z-index: 40;
                min-width: 180px;
                padding: 4px;
                border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
                border-radius: 10px;
                background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
                color: var(--vscode-menu-foreground, var(--vscode-foreground));
                box-shadow: 0 8px 24px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.35));
                display: flex;
                flex-direction: column;
                gap: 1px;
            }

            .cleanSlate-review-scope-menu.hidden {
                display: none;
            }

            .cleanSlate-review-scope-item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                width: 100%;
                height: 30px;
                padding: 0 10px;
                border: 0;
                border-radius: 6px;
                background: transparent;
                color: inherit;
                font-family: var(--vscode-font-family);
                font-size: 13px;
                text-align: left;
                cursor: pointer;
                box-sizing: border-box;
            }

            .cleanSlate-review-scope-item:hover {
                background: var(--vscode-list-hoverBackground);
            }

            .cleanSlate-review-scope-item .codicon {
                font-size: 13px;
                color: var(--vscode-descriptionForeground);
            }

            .cleanSlate-review-filter {
                flex: 0 0 auto;
                display: flex;
                align-items: center;
                gap: 8px;
                height: 28px;
                padding: 0 10px;
                margin: 0 12px 8px;
                border: 1px solid color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
                border-radius: 7px;
                background: color-mix(in srgb, var(--vscode-foreground) 4%, transparent);
                color: var(--vscode-descriptionForeground);
                box-sizing: border-box;
                transition: border-color 120ms ease;
            }

            .cleanSlate-review-filter:focus-within {
                border-color: color-mix(in srgb, var(--vscode-foreground) 22%, transparent);
            }

            .cleanSlate-review-filter .codicon {
                font-size: 13px;
                flex: 0 0 auto;
            }

            .cleanSlate-review-filter input {
                flex: 1 1 auto;
                min-width: 0;
                border: 0;
                outline: 0;
                background: transparent;
                color: var(--vscode-foreground);
                font-family: var(--vscode-font-family);
                font-size: 13px;
            }

            .cleanSlate-review-filter input::placeholder {
                color: var(--vscode-descriptionForeground);
            }

            .cleanSlate-review-filter-empty {
                padding: 12px 4px;
                color: var(--vscode-descriptionForeground);
                font-size: 12.5px;
            }

            .cleanSlate-review-file[hidden],
            .cleanSlate-review-filter-empty[hidden] {
                display: none !important;
            }

            .cleanSlate-review-summary-left,
            .cleanSlate-review-summary-stats,
            .cleanSlate-review-file-stats {
                display: flex;
                align-items: center;
            }

            .cleanSlate-review-summary-left {
                min-width: 0;
                gap: 8px;
                color: var(--vscode-foreground);
                font-size: 13px;
                font-weight: 650;
            }

            .cleanSlate-review-summary-left .codicon {
                color: var(--vscode-descriptionForeground);
                font-size: 15px;
            }

            .cleanSlate-review-count {
                min-width: 22px;
                height: 20px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 0 7px;
                border-radius: 999px;
                background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
                color: var(--vscode-descriptionForeground);
                font-size: 11px;
                font-weight: 700;
                box-sizing: border-box;
            }

            .cleanSlate-review-summary-stats,
            .cleanSlate-review-file-stats {
                gap: 7px;
                flex: 0 0 auto;
                font-family: var(--vscode-editor-font-family, monospace);
                font-size: 11.5px;
                font-weight: 500;
                font-variant-numeric: tabular-nums;
            }

            .cleanSlate-review-toolbar .cleanSlate-review-summary-stats {
                font-size: 12.5px;
            }

            .cleanSlate-review .stat-added {
                color: var(--vscode-gitDecoration-addedResourceForeground, #4ec9b0);
            }

            .cleanSlate-review .stat-deleted {
                color: var(--vscode-gitDecoration-deletedResourceForeground, #f44747);
            }

            .cleanSlate-review-files {
                flex: 1 1 auto;
                min-height: 0;
                overflow: auto;
                overscroll-behavior: contain;
                scrollbar-gutter: stable;
                scrollbar-width: thin;
                scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
            }

            /* Borderless single-line rows: basename first,
               muted relative directory after, compact diffstat right-aligned. */
            .cleanSlate-review-file {
                margin: 0 8px 1px;
                border-radius: 7px;
            }

            .cleanSlate-review-file.is-open {
                background: color-mix(in srgb, var(--vscode-foreground) 3%, transparent);
            }

            .cleanSlate-review-file-header {
                width: 100%;
                min-width: 0;
                min-height: 30px;
                display: flex;
                align-items: center;
                gap: 7px;
                padding: 3px 8px;
                box-sizing: border-box;
                border: 0;
                border-radius: 7px;
                background: transparent;
                color: var(--vscode-foreground);
                font-family: var(--vscode-font-family);
                text-align: left;
                cursor: pointer;
                transition: background-color 100ms ease;
            }

            .cleanSlate-review-file-header:hover {
                background: color-mix(in srgb, var(--vscode-foreground) 5%, transparent);
            }

            .cleanSlate-review-file-chevron,
            .cleanSlate-review-file-icon {
                flex: 0 0 auto;
                color: var(--vscode-descriptionForeground);
                font-size: 13px;
            }

            .cleanSlate-review-file-chevron {
                font-size: 12px;
                transition: transform 120ms ease;
            }

            .cleanSlate-review-file.is-open .cleanSlate-review-file-chevron {
                transform: rotate(90deg);
            }

            .cleanSlate-review-file-labels {
                min-width: 0;
                flex: 1 1 auto;
                display: flex;
                flex-direction: row;
                align-items: center;
                gap: 8px;
            }

            .cleanSlate-review-file-name,
            .cleanSlate-review-file-path {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .cleanSlate-review-file-name {
                flex: 0 1 auto;
                font-size: 13px;
                font-weight: 500;
                color: var(--vscode-foreground);
            }

            .cleanSlate-review-file-path {
                flex: 1 1 auto;
                font-size: 12px;
                color: var(--vscode-descriptionForeground);
            }

            .cleanSlate-review-diff {
                max-height: 520px;
                overflow: auto;
                border-top: 1px solid color-mix(in srgb, var(--vscode-foreground) 7%, transparent);
                background: var(--vscode-editor-background);
                font-family: var(--vscode-editor-font-family, monospace);
                font-size: 12px;
                line-height: 19px;
                tab-size: 4;
                border-radius: 0 0 7px 7px;
            }

            .cleanSlate-review-diff[hidden] {
                display: none;
            }

            .cleanSlate-review-diff-line {
                width: max-content;
                min-width: 100%;
                display: grid;
                grid-template-columns: 44px 44px 22px minmax(220px, 1fr);
                min-height: 20px;
                white-space: pre;
                color: var(--vscode-editor-foreground);
            }

            .cleanSlate-review-diff-line.added {
                background: color-mix(in srgb, var(--vscode-gitDecoration-addedResourceForeground, #2ea043) 18%, transparent);
            }

            .cleanSlate-review-diff-line.deleted {
                background: color-mix(in srgb, var(--vscode-gitDecoration-deletedResourceForeground, #f85149) 16%, transparent);
            }

            .cleanSlate-review-diff-line .line-number,
            .cleanSlate-review-diff-line .line-sign {
                user-select: none;
                color: var(--vscode-editorLineNumber-foreground);
                text-align: right;
                padding: 0 7px;
                box-sizing: border-box;
                font-variant-numeric: tabular-nums;
            }

            .cleanSlate-review-diff-line .line-sign {
                text-align: center;
                padding: 0;
            }

            .cleanSlate-review-diff-line.added .line-sign,
            .cleanSlate-review-diff-line.added code {
                color: var(--vscode-gitDecoration-addedResourceForeground, #73c991);
            }

            .cleanSlate-review-diff-line.deleted .line-sign,
            .cleanSlate-review-diff-line.deleted code {
                color: var(--vscode-gitDecoration-deletedResourceForeground, #f85149);
            }

            .cleanSlate-review-diff-line code {
                display: block;
                padding-right: 16px;
                font-family: inherit;
                font-size: inherit;
                line-height: inherit;
                color: inherit;
                background: transparent;
                border: 0;
            }

            .cleanSlate-review-diff-separator,
            .cleanSlate-review-diff-empty,
            .cleanSlate-review-empty {
                min-height: 28px;
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 0 12px;
                box-sizing: border-box;
                color: var(--vscode-descriptionForeground);
                background: color-mix(in srgb, var(--vscode-foreground) 4%, transparent);
                font-size: 12px;
                font-family: var(--vscode-font-family);
            }

            .cleanSlate-review-empty {
                min-height: 160px;
                flex-direction: column;
                justify-content: center;
                background: transparent;
            }

            .cleanSlate-review-empty-icon {
                font-size: 20px;
            }

            .cleanSlate-file-row .file-stats {
                display: flex;
                gap: 5px;
                font-family: var(--vscode-editor-font-family);
                font-size: 11px;
                font-weight: 400;
                margin-left: 5px;
            }

            .cleanSlate-file-row .file-markers {
                display: flex;
                align-items: center;
                gap: 3px;
                margin-left: 7px;
                color: #D18435;
                font-size: 10px;
                font-weight: 400;
                padding: 0 4px;
                background: rgba(209, 132, 53, 0.1);
                border-radius: 4px;
            }

            .cleanSlate-file-row .file-markers .codicon-warning {
                font-size: 12px;
            }

            .cleanSlate-mode-selector-overlay {
                position: fixed;
                width: min(220px, calc(100vw - 24px));
                background: var(--vscode-editorWidget-background, var(--vscode-menu-background));
                border: 1px solid var(--vscode-widget-border, var(--vscode-input-border));
                border-radius: 8px;
                padding: 4px;
                display: flex;
                flex-direction: column;
                gap: 2px;
                box-sizing: border-box;
                box-shadow: 0 12px 36px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36));
                color: var(--vscode-foreground);
                z-index: 20000;
                animation: cleanSlate-fade-in-up 0.16s cubic-bezier(0.16, 1, 0.3, 1);
            }

            .cleanSlate-mode-selector-overlay.cleanSlate-reasoning-effort-overlay {
                --cleanSlate-reasoning-fill: 0%;
                width: min(236px, calc(100vw - 24px));
                padding: 10px 12px 12px;
                gap: 10px;
                border-radius: 10px;
                background: color-mix(in srgb, var(--vscode-editorWidget-background, var(--vscode-menu-background)) 95%, white 5%);
            }

            .reasoning-effort-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                min-width: 0;
                color: var(--vscode-descriptionForeground);
            }

            .reasoning-effort-heading {
                display: flex;
                align-items: baseline;
                gap: 6px;
                min-width: 0;
                font-size: 12px;
                font-weight: 500;
            }

            .reasoning-effort-value {
                overflow: hidden;
                color: var(--vscode-foreground);
                font-size: 11px;
                font-weight: 600;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .reasoning-effort-icon {
                flex: 0 0 auto;
                font-size: 14px;
                opacity: 0.82;
            }

            .reasoning-effort-slider-shell {
                position: relative;
                width: 100%;
                height: 32px;
            }

            .reasoning-effort-track {
                position: absolute;
                inset: 0;
                overflow: hidden;
                border: 1px solid color-mix(in srgb, var(--vscode-foreground) 13%, transparent);
                border-radius: 999px;
                background: color-mix(in srgb, var(--vscode-foreground) 13%, transparent);
                box-sizing: border-box;
            }

            .reasoning-effort-track-fill {
                position: absolute;
                inset: 0 auto 0 0;
                width: var(--cleanSlate-reasoning-fill);
                border-radius: inherit;
                background: var(--vscode-progressBar-background, var(--vscode-focusBorder));
                transition: width 80ms ease-out;
            }

            .reasoning-effort-ticks {
                position: absolute;
                inset: 0 15px;
                z-index: 1;
                display: flex;
                align-items: center;
                justify-content: space-between;
                pointer-events: none;
            }

            .reasoning-effort-tick {
                width: 5px;
                height: 5px;
                border-radius: 50%;
                background: color-mix(in srgb, var(--vscode-foreground) 46%, transparent);
                box-shadow: 0 0 0 1px color-mix(in srgb, var(--vscode-editorWidget-background) 20%, transparent);
            }

            .reasoning-effort-slider {
                position: absolute;
                inset: 0;
                z-index: 2;
                width: 100%;
                height: 32px;
                margin: 0;
                appearance: none;
                -webkit-appearance: none;
                background: transparent;
                cursor: pointer;
            }

            .reasoning-effort-slider::-webkit-slider-runnable-track {
                height: 32px;
                border: 0;
                background: transparent;
            }

            .reasoning-effort-slider::-webkit-slider-thumb {
                width: 28px;
                height: 28px;
                margin-top: 2px;
                appearance: none;
                -webkit-appearance: none;
                border: 0;
                border-radius: 50%;
                background: var(--vscode-foreground);
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.32);
            }

            .reasoning-effort-slider:focus-visible::-webkit-slider-thumb {
                box-shadow: 0 0 0 2px var(--vscode-focusBorder), 0 2px 8px rgba(0, 0, 0, 0.32);
            }

            .reasoning-effort-slider:disabled {
                cursor: default;
                opacity: 0.72;
                pointer-events: none;
            }

            .cleanSlate-reasoning-effort-overlay.is-unavailable .reasoning-effort-slider-shell {
                cursor: not-allowed;
            }

            .cleanSlate-reasoning-effort-overlay.is-unavailable .reasoning-effort-value,
            .cleanSlate-reasoning-effort-overlay.is-unavailable .reasoning-effort-icon {
                color: var(--vscode-notificationsWarningIcon-foreground);
            }

            .cleanSlate-reasoning-effort-overlay.is-unavailable .reasoning-effort-track {
                border-color: color-mix(in srgb, var(--vscode-notificationsWarningIcon-foreground) 48%, transparent);
                opacity: 0.7;
            }

            .cleanSlate-reasoning-effort-overlay.show-unavailable-feedback {
                animation: cleanSlate-reasoning-unavailable-shake 420ms cubic-bezier(0.36, 0.07, 0.19, 0.97);
            }

            .cleanSlate-reasoning-effort-overlay.show-unavailable-feedback .reasoning-effort-track {
                animation: cleanSlate-reasoning-unavailable-pulse 520ms ease-out;
            }

            @keyframes cleanSlate-reasoning-unavailable-shake {
                0%, 100% { transform: translateX(0); }
                20% { transform: translateX(-4px); }
                40% { transform: translateX(4px); }
                60% { transform: translateX(-3px); }
                80% { transform: translateX(2px); }
            }

            @keyframes cleanSlate-reasoning-unavailable-pulse {
                0%, 100% { box-shadow: none; }
                35% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--vscode-notificationsWarningIcon-foreground) 28%, transparent); }
            }

            .cleanSlate-mode-selector-overlay .mode-item {
                padding: 8px 12px;
                border-radius: 6px;
                cursor: pointer;
                display: flex;
                flex-direction: column;
                gap: 2px;
                transition: background 0.15s;
            }

            .cleanSlate-mode-selector-overlay .mode-item:hover {
                background: var(--vscode-list-hoverBackground);
            }

            .cleanSlate-mode-selector-overlay .mode-item.disabled {
                cursor: default;
                opacity: 0.45;
            }

            .cleanSlate-mode-selector-overlay .mode-item.disabled:hover {
                background: transparent;
            }

            .cleanSlate-mode-selector-overlay .mode-item.active {
                background: var(--vscode-list-activeSelectionBackground);
            }

            .cleanSlate-mode-selector-overlay .mode-item.active .mode-item-label,
            .cleanSlate-mode-selector-overlay .mode-item.active .mode-item-description {
                color: var(--vscode-list-activeSelectionForeground);
            }

            .cleanSlate-mode-selector-overlay .mode-item-label {
                font-size: 13px;
                font-weight: 600;
                color: var(--vscode-foreground);
            }

            .cleanSlate-mode-selector-overlay .mode-item-description {
                font-size: 11px;
                color: var(--vscode-descriptionForeground);
                line-height: 1.4;
            }

            .cleanSlate-mode-selector-overlay.cleanSlate-edit-mode-overlay {
                width: min(260px, calc(100vw - 24px));
            }

            .cleanSlate-edit-mode-overlay .edit-mode-header {
                padding: 6px 8px 4px;
            }

            .cleanSlate-edit-mode-overlay .edit-mode-heading {
                font-size: 11px;
                font-weight: 600;
                letter-spacing: 0.04em;
                text-transform: uppercase;
                color: var(--vscode-descriptionForeground);
            }

            .cleanSlate-edit-mode-overlay .edit-mode-option {
                appearance: none;
                display: flex;
                align-items: flex-start;
                gap: 8px;
                width: 100%;
                padding: 8px 10px;
                border: 0;
                border-radius: 6px;
                background: transparent;
                color: inherit;
                font-family: inherit;
                text-align: left;
                cursor: pointer;
                transition: background 0.15s;
            }

            .cleanSlate-edit-mode-overlay .edit-mode-option:hover {
                background: var(--vscode-list-hoverBackground);
            }

            .cleanSlate-edit-mode-overlay .edit-mode-option:focus-visible {
                outline: 1px solid var(--vscode-focusBorder);
                outline-offset: -1px;
            }

            .cleanSlate-edit-mode-overlay .edit-mode-option.selected {
                background: var(--vscode-list-activeSelectionBackground);
            }

            .cleanSlate-edit-mode-overlay .edit-mode-option.selected .edit-mode-option-label,
            .cleanSlate-edit-mode-overlay .edit-mode-option.selected .edit-mode-option-description {
                color: var(--vscode-list-activeSelectionForeground);
            }

            .cleanSlate-edit-mode-overlay .edit-mode-option-text {
                flex: 1 1 auto;
                min-width: 0;
                display: flex;
                flex-direction: column;
                gap: 2px;
            }

            .cleanSlate-edit-mode-overlay .edit-mode-option-label {
                font-size: 13px;
                font-weight: 600;
                color: var(--vscode-foreground);
            }

            .cleanSlate-edit-mode-overlay .edit-mode-option-description {
                font-size: 11px;
                color: var(--vscode-descriptionForeground);
                line-height: 1.4;
            }

            .cleanSlate-edit-mode-overlay .edit-mode-option-check {
                flex: 0 0 auto;
                align-self: center;
                font-size: 14px;
            }

            @keyframes cleanSlate-fade-in-up {
                from {
                    opacity: 0;
                    transform: translateY(10px) scale(0.98);
                }
                to {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }

            /* ================================================================
               Plan Dropup — floats above chat input, collapses/expands
               ================================================================ */

            .cleanSlate-plan-dropup {
                display: none;
                flex-direction: column;
                width: 100%;
                max-width: 760px;
                margin: 6px auto 0;
                padding: 0 6px 6px;
                box-sizing: border-box;
            }

            /* The visual card — unified border so header + body share one outline */
            .cleanSlate-plan-dropup-card {
                border: 1px solid rgba(255, 255, 255, 0.09);
                border-radius: 10px;
                overflow: hidden;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.45);
                background: #1a1a1a;
            }

            .cleanSlate-plan-dropup.visible {
                display: flex;
            }

            /* One-shot entrance animation — class is removed after 300ms */
            .cleanSlate-plan-dropup.animate-in {
                animation: cleanSlate-fade-in-up 0.22s cubic-bezier(0.16, 1, 0.3, 1);
            }

            /* ── Header ──────────────────────────────────────────────────── */
            .cleanSlate-plan-dropup-header {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 7px 12px;
                background: transparent;
                cursor: pointer;
                user-select: none;
                border-bottom: 1px solid rgba(255, 255, 255, 0.06);
                transition: background 0.15s;
                min-width: 0;
            }

            .cleanSlate-plan-dropup-header:hover {
                background: #222;
            }

            .cleanSlate-plan-dropup-header.all-done {
                background: rgba(52, 168, 83, 0.08);
                border-color: rgba(52, 168, 83, 0.18);
            }

            .plan-dropup-header-left {
                display: flex;
                align-items: center;
                gap: 6px;
                flex-shrink: 0;
            }

            .plan-status-icon {
                font-size: 13px;
                color: var(--vscode-testing-iconPassed);
                align-items: center;
                justify-content: center;
            }

            .plan-dropup-title {
                font-size: 12px;
                font-weight: 600;
                color: rgba(255, 255, 255, 0.85);
                white-space: nowrap;
                letter-spacing: 0.01em;
            }

            /* Progress bar track */
            .plan-dropup-progress-track {
                flex: 1;
                height: 4px;
                background: rgba(255, 255, 255, 0.08);
                border-radius: 999px;
                overflow: hidden;
                min-width: 40px;
            }

            .plan-dropup-progress-fill {
                height: 100%;
                background: var(--vscode-progressBar-background, #0078d4);
                border-radius: 999px;
                transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                width: 0%;
            }

            .plan-dropup-progress-fill.complete {
                background: var(--vscode-testing-iconPassed, #34A853);
            }

            /* Chevron toggle button */
            .plan-dropup-chevron {
                background: transparent;
                border: none;
                cursor: pointer;
                color: rgba(255, 255, 255, 0.4);
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0;
                flex-shrink: 0;
                transition: color 0.15s;
            }

            .plan-dropup-chevron:hover {
                color: rgba(255, 255, 255, 0.8);
            }

            .plan-dropup-chevron .codicon {
                font-size: 13px;
                transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }

            /* Rotated when expanded (default) */
            .cleanSlate-plan-dropup[data-collapsed="false"] .plan-dropup-chevron .codicon {
                transform: rotate(180deg);
            }

            .cleanSlate-plan-dropup[data-collapsed="true"] .plan-dropup-chevron .codicon {
                transform: rotate(0deg);
            }

            /* ── Body (task list) ────────────────────────────────────────── */
            .cleanSlate-plan-dropup-body {
                display: flex;
                flex-direction: column;
                gap: 0;
                background: transparent;
                /* Collapse animation via max-height */
                max-height: 260px;
                overflow-y: auto;
                transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                            opacity 0.25s ease;
                opacity: 1;
                scrollbar-width: thin;
                padding: 6px 0;
            }

            .cleanSlate-plan-dropup[data-collapsed="true"] .cleanSlate-plan-dropup-body {
                max-height: 0 !important;
                opacity: 0;
                padding: 0;
                overflow: hidden;
            }

            /* ── Task items ──────────────────────────────────────────────── */
            .plan-dropup-item {
                display: flex;
                align-items: flex-start;
                gap: 10px;
                padding: 5px 14px;
                font-size: 12.5px;
                color: rgba(255, 255, 255, 0.75);
                transition: background 0.12s;
                min-width: 0;
            }

            .plan-dropup-item:hover {
                background: rgba(255, 255, 255, 0.03);
            }

            .plan-dropup-item.active {
                background: rgba(0, 120, 212, 0.06);
            }

            .plan-dropup-item.done {
                opacity: 0.7;
            }

            .plan-dropup-item .codicon {
                font-size: 13px;
                flex-shrink: 0;
                margin-top: 1px;
            }

            .plan-dropup-item-label {
                flex: 1;
                min-width: 0;
                word-break: break-word;
                line-height: 1.5;
            }

            .cleanSlate-timeline-block.type-web-group {
                margin: 10px 0 12px;
                width: 100%;
                max-width: 100%;
            }

            .cleanSlate-web-activity {
                width: 100%;
                max-width: 100%;
                color: var(--vscode-descriptionForeground);
            }

            .cleanSlate-web-activity-status {
                display: flex;
                align-items: center;
                gap: 8px;
                min-height: 22px;
                margin-bottom: 8px;
                font-size: 13px;
                line-height: 1.35;
                color: var(--vscode-descriptionForeground);
            }

            .cleanSlate-web-activity-title {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                transition: color 0.18s ease, opacity 0.18s ease;
            }

            .cleanSlate-web-activity.is-running .cleanSlate-web-activity-status::before {
                content: '';
                width: 6px;
                height: 6px;
                border-radius: 50%;
                flex: 0 0 auto;
                background: currentColor;
                opacity: 0.5;
                animation: cleanSlate-web-pulse 1.2s ease-in-out infinite;
            }

            .cleanSlate-web-activity-meta {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                color: var(--vscode-disabledForeground, rgba(255, 255, 255, 0.38));
                font-size: 12px;
                transition: opacity 0.18s ease;
            }

            .cleanSlate-web-activity-meta[hidden] {
                display: none;
            }

            .cleanSlate-web-activity-rule {
                position: relative;
                overflow: hidden;
                height: 1px;
                margin: 0 0 12px;
                background: var(--vscode-widget-border, rgba(255, 255, 255, 0.16));
            }

            .cleanSlate-web-activity.is-running .cleanSlate-web-activity-rule::after {
                content: '';
                position: absolute;
                inset: 0;
                width: 42%;
                background: linear-gradient(
                    90deg,
                    transparent,
                    color-mix(in srgb, var(--vscode-foreground) 32%, transparent),
                    transparent
                );
                animation: cleanSlate-web-rule-sweep 1.55s ease-in-out infinite;
            }

			.cleanSlate-web-group-events {
				display: flex;
				flex-direction: column;
				gap: 10px;
				min-width: 0;
			}

            .cleanSlate-web-group-events > .cleanSlate-timeline-block {
                animation: cleanSlate-web-event-in 0.22s ease-out both;
                transform-origin: top left;
            }

			.cleanSlate-web-block {
				width: 100%;
				max-width: 100%;
				min-width: 0;
                color: var(--vscode-descriptionForeground);
                transition: opacity 0.18s ease, transform 0.18s ease;
            }

            .cleanSlate-web-activity-row {
                display: flex;
                align-items: center;
                gap: 10px;
                min-width: 0;
                min-height: 28px;
                color: var(--vscode-descriptionForeground);
                font-size: 13px;
                line-height: 1.45;
                text-decoration: none;
            }

            .cleanSlate-web-link:hover {
                color: var(--vscode-foreground);
            }

            .cleanSlate-web-activity-row .cleanSlate-web-favicon,
            .cleanSlate-web-activity-symbol {
                flex: 0 0 auto;
            }

            .cleanSlate-web-activity-symbol {
                display: inline-grid;
                place-items: center;
                width: 22px;
                height: 22px;
                border-radius: 50%;
                color: var(--vscode-descriptionForeground);
            }

            .cleanSlate-web-activity-symbol .codicon {
                font-size: 16px;
                opacity: 0.82;
            }

            .cleanSlate-web-block.status-failed .cleanSlate-web-activity-symbol {
                color: var(--vscode-errorForeground, #f85149);
            }

            .cleanSlate-web-activity-text {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                transition: color 0.18s ease, opacity 0.18s ease;
            }

            .cleanSlate-web-row-meta {
                flex: 0 1 auto;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                color: var(--vscode-disabledForeground, rgba(255, 255, 255, 0.38));
                font-size: 12px;
                transition: opacity 0.18s ease;
            }

            .cleanSlate-web-favicon {
                position: relative;
                display: inline-grid;
                place-items: center;
                width: 22px;
                height: 22px;
                border-radius: 50%;
                overflow: hidden;
                border: 1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
                background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
                color: var(--vscode-descriptionForeground);
                font-size: 11px;
                font-weight: 700;
                line-height: 1;
                transition: border-color 0.18s ease, background-color 0.18s ease, transform 0.18s ease;
            }

            .cleanSlate-web-block.is-running .cleanSlate-web-favicon,
            .cleanSlate-web-block.is-running .cleanSlate-web-activity-symbol {
                animation: cleanSlate-web-pulse 1.2s ease-in-out infinite;
            }

            .cleanSlate-web-favicon img {
                position: absolute;
                inset: 2px;
                width: 18px;
                height: 18px;
                object-fit: contain;
                border-radius: 50%;
                background: var(--vscode-editor-background);
            }

            .cleanSlate-web-favicon-fallback {
                z-index: 0;
            }

			.cleanSlate-web-page-read {
				display: flex;
				align-items: center;
				min-width: 0;
				min-height: 28px;
				color: var(--vscode-descriptionForeground);
				text-decoration: none;
			}

			.cleanSlate-web-page-read:hover {
				color: var(--vscode-foreground);
			}

			.cleanSlate-web-external-icon {
				flex: 0 0 auto;
				color: var(--vscode-descriptionForeground);
				font-size: 12px;
				opacity: 0.72;
			}

            .cleanSlate-web-detail-list {
                display: flex;
                flex-direction: column;
                gap: 4px;
                margin: 4px 0 0 32px;
                color: var(--vscode-errorForeground, #f85149);
                font-size: 12px;
                line-height: 1.45;
            }

            .cleanSlate-web-detail {
                word-break: break-word;
            }

            @keyframes cleanSlate-web-event-in {
                from {
                    opacity: 0;
                    transform: translateY(5px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }

            @keyframes cleanSlate-web-pulse {
                0%, 100% {
                    opacity: 0.46;
                    transform: scale(0.96);
                }
                50% {
                    opacity: 1;
                    transform: scale(1);
                }
            }

            @keyframes cleanSlate-web-rule-sweep {
                from {
                    transform: translateX(-120%);
                }
                to {
                    transform: translateX(260%);
                }
            }

            .cleanSlate-browser-block {
                border: none;
                border-top: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.08));
                background: transparent;
                border-radius: 0;
                overflow: hidden;
                margin: 0;
            }

            .cleanSlate-browser-inspection-activity {
                border-top: 0;
                overflow: visible;
                margin: 4px 0;
            }

            .cleanSlate-browser-inspection-header.cleanSlate-tool-activity-row {
                width: fit-content;
                padding: 0;
                border-bottom: 0;
                cursor: pointer;
            }

            .cleanSlate-browser-inspection-header.cleanSlate-tool-activity-row .codicon {
                color: inherit;
            }

            .cleanSlate-browser-inspection-header .cleanSlate-browser-event-chevron {
                margin-left: 1px;
                font-size: 12px;
            }

            .cleanSlate-browser-inspection-activity[open] .cleanSlate-browser-inspection-header {
                border-bottom-color: transparent;
            }

            .cleanSlate-browser-inspection-activity .cleanSlate-browser-body {
                margin: 8px 0 0 21px;
                padding: 0;
            }

            .cleanSlate-timeline-block.type-browser-group {
                margin: 8px 0;
            }

            .cleanSlate-browser-group {
                border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.12));
                background: color-mix(in srgb, var(--vscode-editorWidget-background, #252526) 76%, transparent);
                border-radius: 8px;
                overflow: hidden;
            }

            .cleanSlate-browser-group-summary {
                display: flex;
                align-items: center;
                gap: 10px;
                min-width: 0;
                padding: 10px 12px;
                cursor: pointer;
                list-style: none;
                user-select: none;
            }

            .cleanSlate-browser-group-summary::-webkit-details-marker {
                display: none;
            }

            .cleanSlate-browser-group-main {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                min-width: 0;
                flex: 1 1 auto;
            }

            .cleanSlate-browser-group-main .codicon {
                flex: 0 0 auto;
                color: var(--vscode-progressBar-background, #0078d4);
                opacity: 0.9;
            }

            .cleanSlate-browser-group-title {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-weight: 600;
                color: var(--vscode-foreground);
            }

            .cleanSlate-browser-group-status {
                flex: 0 0 auto;
                padding: 2px 6px;
                border-radius: 999px;
                font-size: 11px;
                color: var(--vscode-descriptionForeground);
                background: color-mix(in srgb, var(--vscode-foreground) 9%, transparent);
            }

            .cleanSlate-browser-group-meta {
                display: inline-flex;
                align-items: center;
                justify-content: flex-end;
                gap: 8px;
                min-width: 0;
                max-width: 42%;
                color: var(--vscode-descriptionForeground);
                font-size: 12px;
            }

            .cleanSlate-browser-group-meta span {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .cleanSlate-browser-group-chevron {
                flex: 0 0 auto;
                color: var(--vscode-descriptionForeground);
                transition: transform 120ms ease;
            }

            .cleanSlate-browser-group[open] .cleanSlate-browser-group-chevron {
                transform: rotate(180deg);
            }

            .cleanSlate-browser-group-body {
                border-top: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.08));
                padding: 0;
            }

            .cleanSlate-browser-group-events {
                display: flex;
                flex-direction: column;
                gap: 0;
            }

            .cleanSlate-browser-group-events > .cleanSlate-timeline-block {
                margin: 0;
            }

            .cleanSlate-browser-group-events > .cleanSlate-timeline-block:first-child .cleanSlate-browser-block {
                border-top: none;
            }

            .cleanSlate-browser-group-events .cleanSlate-browser-block {
                margin: 0;
                background: transparent;
            }

            .cleanSlate-browser-header {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 9px 12px;
                min-width: 0;
                border-bottom: 1px solid transparent;
                list-style: none;
            }

            summary.cleanSlate-browser-header {
                cursor: pointer;
                user-select: none;
            }

            summary.cleanSlate-browser-header::-webkit-details-marker {
                display: none;
            }

            .cleanSlate-browser-header .codicon {
                flex: 0 0 auto;
                color: var(--vscode-progressBar-background, #0078d4);
                opacity: 0.9;
            }

            .cleanSlate-browser-block.status-failed .cleanSlate-browser-header .codicon {
                color: var(--vscode-errorForeground, #f85149);
            }

            .cleanSlate-browser-action {
                font-weight: 600;
                color: var(--vscode-foreground);
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .cleanSlate-browser-meta {
                margin-left: auto;
                display: inline-flex;
                align-items: center;
                justify-content: flex-end;
                gap: 8px;
                min-width: 0;
                max-width: 48%;
                color: var(--vscode-descriptionForeground);
            }

            .cleanSlate-browser-url,
            .cleanSlate-browser-title {
                font-size: 12px;
                color: var(--vscode-descriptionForeground);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                min-width: 0;
            }

            .cleanSlate-browser-event-chevron {
                color: var(--vscode-descriptionForeground);
                transition: transform 120ms ease;
            }

            .cleanSlate-browser-block[open] .cleanSlate-browser-event-chevron {
                transform: rotate(90deg);
            }

            .cleanSlate-browser-url {
                font-family: var(--vscode-editor-font-family);
            }

            .cleanSlate-browser-block[open] .cleanSlate-browser-header {
                border-bottom-color: var(--vscode-widget-border, rgba(255, 255, 255, 0.08));
            }

            .cleanSlate-browser-body {
                padding: 8px 12px 12px;
            }

            .cleanSlate-browser-details {
                display: flex;
                flex-direction: column;
                gap: 4px;
                padding: 0;
            }

            .cleanSlate-browser-detail {
                font-size: 12px;
                line-height: 1.35;
                color: var(--vscode-descriptionForeground);
                word-break: break-word;
            }

            .cleanSlate-browser-detail-error {
                color: var(--vscode-errorForeground, #f85149);
            }

            .cleanSlate-browser-details.is-dom-snapshot {
                gap: 5px;
            }

            .cleanSlate-browser-dom-row {
                display: grid;
                grid-template-columns: 22px max-content minmax(0, 1fr);
                align-items: start;
                column-gap: 8px;
                min-width: 0;
                padding: 2px 0;
            }

            .cleanSlate-browser-dom-index {
                color: var(--vscode-disabledForeground, rgba(255, 255, 255, 0.36));
                font-family: var(--vscode-editor-font-family, monospace);
                font-size: 11px;
                line-height: 18px;
                text-align: right;
                font-variant-numeric: tabular-nums;
            }

            .cleanSlate-browser-dom-tag {
                min-width: 42px;
                padding: 1px 6px;
                border: 1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
                border-radius: 5px;
                color: color-mix(in srgb, var(--vscode-foreground) 76%, transparent);
                background: color-mix(in srgb, var(--vscode-foreground) 5%, transparent);
                font-family: var(--vscode-editor-font-family, monospace);
                font-size: 11px;
                line-height: 16px;
                text-align: center;
                white-space: nowrap;
            }

            .cleanSlate-browser-dom-text {
                min-width: 0;
                color: color-mix(in srgb, var(--vscode-foreground) 72%, transparent);
                line-height: 18px;
                overflow: hidden;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
            }

            .cleanSlate-browser-dom-text .is-empty {
                color: var(--vscode-disabledForeground, rgba(255, 255, 255, 0.36));
                font-style: italic;
            }

            .cleanSlate-browser-detail-more {
                display: block;
                margin-left: 30px;
                min-height: 24px;
                padding: 3px 4px;
                border: 0;
                border-radius: 4px;
                background: transparent;
                color: var(--vscode-descriptionForeground);
                font: inherit;
                font-size: 12px;
                line-height: 18px;
                text-align: left;
                opacity: 0.78;
                cursor: pointer;
            }

            .cleanSlate-browser-detail-more:hover {
                color: var(--vscode-foreground);
                background: color-mix(in srgb, var(--vscode-foreground) 6%, transparent);
                opacity: 1;
            }

            .cleanSlate-browser-detail-more:focus-visible {
                outline: 1px solid var(--vscode-focusBorder);
                outline-offset: 1px;
                opacity: 1;
            }

            .cleanSlate-browser-hidden-details[hidden] {
                display: none;
            }

            .cleanSlate-browser-block.compact .cleanSlate-browser-details {
                padding-top: 0;
            }

            .cleanSlate-browser-shots {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                gap: 8px;
                padding: 0 0 2px;
            }

            .cleanSlate-browser-shots.count-1 {
                grid-template-columns: minmax(180px, 360px);
            }

            .cleanSlate-browser-shot {
                margin: 0;
                min-width: 0;
                border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.08));
                border-radius: 6px;
                overflow: hidden;
                background: var(--vscode-editor-background);
            }

            .cleanSlate-browser-shot img {
                display: block;
                width: 100%;
                height: 128px;
                object-fit: contain;
                background: #111;
            }

            .cleanSlate-browser-shot-unavailable {
                display: flex;
                align-items: center;
                justify-content: center;
                height: 128px;
                padding: 12px;
                box-sizing: border-box;
                color: var(--vscode-descriptionForeground);
                background: #111;
                font-size: 12px;
                text-align: center;
            }

            .cleanSlate-browser-shots.count-1 .cleanSlate-browser-shot img {
                height: 170px;
            }

            .cleanSlate-browser-shots.count-1 .cleanSlate-browser-shot-unavailable {
                height: 170px;
            }

            .cleanSlate-browser-shot figcaption {
                padding: 5px 7px;
                font-size: 11px;
                color: var(--vscode-descriptionForeground);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            /* ---- Transcript hierarchy tiers ----
               Three visual tiers: muted
               rows for tool activity, secondary text for mid-run narration and
               plan echoes, full weight reserved for the final answer. Purely
               presentational — block order, content, and streaming behavior are
               untouched. Kept at the end of this sheet so the tier rules win the
               cascade over the base block styles above. */

            /* A plan/router echo that introduces further work reads as process
               text. Completion summaries (followed only by finish cards) keep
               full answer weight. */
            .cleanSlate-timeline-block.type-summary.cleanSlate-message-content:has(~ .cleanSlate-timeline-block:not(.type-summary):not(.type-finish)) {
                color: var(--vscode-descriptionForeground);
                font-size: 0.94em;
            }

            /* Mid-run narration: any assistant text block with a later one after
               it — the last text block is the answer and stays full weight.
               Opacity and margins transition in place, so the timeline compacts
               smoothly as new blocks land instead of jumping. */
            .cleanSlate-timeline-block.type-assistant_text:has(~ .cleanSlate-timeline-block.type-assistant_text) {
                opacity: 0.66;
                margin-top: 1px !important;
                margin-bottom: 1px !important;
                transition: opacity 0.3s ease, margin 0.2s ease;
            }

            /* Answer heading rhythm: modest scale, tight to the content it
               introduces, em-based so it tracks the surface's body size. */
            .cleanSlate-message-content .rendered-markdown h1,
            .cleanSlate-message-content .rendered-markdown h2,
            .cleanSlate-message-content .rendered-markdown h3,
            .cleanSlate-message-content .rendered-markdown h4 {
                font-weight: 600;
                letter-spacing: -0.012em;
                line-height: 1.35;
                margin: 1.1em 0 0.45em;
            }

            .cleanSlate-message-content .rendered-markdown h1 { font-size: 1.5em; }
            .cleanSlate-message-content .rendered-markdown h2 { font-size: 1.3em; }
            .cleanSlate-message-content .rendered-markdown h3 { font-size: 1.12em; }
            .cleanSlate-message-content .rendered-markdown h4 { font-size: 1em; }
`;

export function ensureCleanSlateChatStyles(container: HTMLElement): void {
    const existingStyle = container.querySelector('style[data-cleanSlate-chat-styles="true"]') as HTMLStyleElement | null;
    if (existingStyle) {
        if (existingStyle.textContent !== CLEANSLATE_CHAT_STYLES) {
            existingStyle.textContent = CLEANSLATE_CHAT_STYLES;
        }
        return;
    }

    const style = mainWindow.document.createElement('style');
    style.dataset.cleanSlateChatStyles = 'true';
    style.textContent = CLEANSLATE_CHAT_STYLES;
    container.appendChild(style);
}
