/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { CleanSlateArtifactInput } from './cleanSlateArtifactInput.js';
import * as dom from '../../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { ICleanSlateArtifactService, type IArtifact } from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { IMarkdownRendererService } from '../../../../../platform/markdown/browser/markdownRenderer.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { IDisposable, dispose } from '../../../../../base/common/lifecycle.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';

export class CleanSlateArtifactEditor extends EditorPane {

    static readonly ID = 'workbench.editors.cleanSlateArtifactEditor';

    private container!: HTMLElement;
    private header!: HTMLElement;
    private body!: HTMLElement;
    private currentInput: CleanSlateArtifactInput | undefined;
    private rendererDisposables: IDisposable[] = [];

    constructor(
        group: IEditorGroup,
        @ITelemetryService telemetryService: ITelemetryService,
        @IThemeService themeService: IThemeService,
        @IStorageService storageService: IStorageService,
        @ICleanSlateArtifactService private readonly artifactService: ICleanSlateArtifactService,
        @IMarkdownRendererService private readonly markdownRenderer: IMarkdownRendererService,
        @IClipboardService private readonly clipboardService: IClipboardService
    ) {
        super(CleanSlateArtifactEditor.ID, group, telemetryService, themeService, storageService);
        this._register(this.artifactService.onDidArtifactChange((artifact: IArtifact) => {
            if (this.currentInput?.getArtifactId() === artifact.id) {
                this.renderArtifact(artifact);
            }
        }));
    }

    protected createEditor(parent: HTMLElement): void {
        this.container = dom.append(parent, dom.$('.cleanSlate-artifact-editor'));
        this.container.style.display = 'flex';
        this.container.style.flexDirection = 'column';
        this.container.style.height = '100%';
        this.container.style.backgroundColor = 'var(--vscode-editor-background)';
        this.container.style.color = 'var(--vscode-editor-foreground, var(--vscode-foreground))';
        this.container.style.overflow = 'hidden';
        this.container.style.position = 'relative';

        // Header
        this.header = dom.append(this.container, dom.$('.artifact-header'));
        this.header.style.padding = '40px 60px 20px 60px';
        this.header.style.display = 'flex';
        this.header.style.flexDirection = 'column';
        this.header.style.gap = '8px';

        this.body = dom.append(this.container, dom.$('.artifact-body'));
        this.body.style.flex = '1';
        this.body.style.padding = '0 60px 60px 60px';
        this.body.style.overflowY = 'auto';
        this.body.style.lineHeight = '1.6';
        this.body.style.fontSize = '15px';
		this.body.style.userSelect = 'text';
		this.body.style.webkitUserSelect = 'text';

        this.injectStyles();
    }


    private injectStyles(): void {
        const style = dom.$('style');
        style.textContent = `
            .cleanSlate-artifact-editor {
                color: var(--vscode-editor-foreground, var(--vscode-foreground));
            }
            .cleanSlate-artifact-editor h1 {
                font-size: 32px;
                font-weight: 700;
                margin-bottom: 24px;
                color: var(--vscode-editor-foreground, var(--vscode-foreground));
                letter-spacing: -0.5px;
            }
            .cleanSlate-artifact-editor h2 {
                font-size: 20px;
                font-weight: 600;
                margin-top: 32px;
                margin-bottom: 16px;
                color: var(--vscode-editor-foreground, var(--vscode-foreground));
            }
            .cleanSlate-artifact-editor h3 {
                font-size: 16px;
                font-weight: 600;
                margin-top: 24px;
                margin-bottom: 8px;
                color: var(--vscode-editor-foreground, var(--vscode-foreground));
                opacity: 0.9;
            }
            .cleanSlate-artifact-editor p {
                margin-bottom: 16px;
                color: var(--vscode-editor-foreground, var(--vscode-foreground));
            }
            .cleanSlate-artifact-editor ul, .cleanSlate-artifact-editor ol {
                margin-bottom: 24px;
                padding-left: 20px;
            }
            .cleanSlate-artifact-editor li {
                margin-bottom: 8px;
                color: var(--vscode-editor-foreground, var(--vscode-foreground));
            }
            .cleanSlate-artifact-editor code {
                background-color: var(--vscode-textCodeBlock-background, color-mix(in srgb, var(--vscode-editor-foreground, var(--vscode-foreground)) 8%, transparent));
                padding: 2px 6px;
                border-radius: 4px;
                font-family: 'JetBrains Mono', 'Menlo', monospace;
                font-size: 13px;
                color: var(--vscode-textPreformat-foreground, var(--vscode-editor-foreground, var(--vscode-foreground)));
                font-weight: 700;
                border: 1px solid color-mix(in srgb, var(--vscode-editor-foreground, var(--vscode-foreground)) 12%, transparent);
            }
            .artifact-badge {
                padding: 4px 8px;
                border-radius: 4px;
                background-color: var(--vscode-badge-background);
                color: var(--vscode-badge-foreground);
                font-size: 11px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 1px;
                width: fit-content;
            }
            .artifact-timestamp {
                font-size: 12px;
                color: var(--vscode-descriptionForeground);
                opacity: 0.6;
            }
			.artifact-copy-button {
				display: inline-flex;
				align-items: center;
				gap: 6px;
				padding: 6px 10px;
				border: 1px solid var(--vscode-button-border, transparent);
				border-radius: 5px;
				background: var(--vscode-button-secondaryBackground);
				color: var(--vscode-button-secondaryForeground);
				font: inherit;
				font-size: 12px;
				cursor: pointer;
			}
			.artifact-copy-button:hover {
				background: var(--vscode-button-secondaryHoverBackground);
			}
			.artifact-copy-button:focus-visible {
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: 2px;
			}

            /* Themed Scrollbar for Artifact Body */
            .artifact-body::-webkit-scrollbar {
                width: 10px;
                height: 10px;
            }
            .artifact-body::-webkit-scrollbar-track {
                background: transparent;
            }
            .artifact-body::-webkit-scrollbar-thumb {
                background: var(--vscode-scrollbarSlider-background);
                border-radius: 5px;
                border: 2px solid var(--vscode-editor-background);
            }
            .artifact-body::-webkit-scrollbar-thumb:hover {
                background: var(--vscode-scrollbarSlider-hoverBackground);
            }
            .artifact-body::-webkit-scrollbar-thumb:active {
                background: var(--vscode-scrollbarSlider-activeBackground);
            }

            /* Mermaid Styling */
            .mermaid {
                background: color-mix(in srgb, var(--vscode-editor-foreground, var(--vscode-foreground)) 5%, transparent);
                border-radius: 8px;
                padding: 20px;
                margin: 20px 0;
                display: flex;
                justify-content: center;
                border: 1px solid color-mix(in srgb, var(--vscode-editor-foreground, var(--vscode-foreground)) 10%, transparent);
            }
            .cleanSlate-artifact-editor h4 {
                font-size: 14px;
                font-weight: 600;
                margin-top: 16px;
                margin-bottom: 8px;
                color: var(--vscode-editor-foreground, var(--vscode-foreground));
                opacity: 0.8;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .cleanSlate-artifact-editor strong {
                font-weight: 700;
                color: var(--vscode-editor-foreground, var(--vscode-foreground));
            }
            .cleanSlate-artifact-editor blockquote {
                border-left: 4px solid color-mix(in srgb, var(--vscode-editor-foreground, var(--vscode-foreground)) 16%, transparent);
                margin: 16px 0;
                padding: 8px 16px;
                background: color-mix(in srgb, var(--vscode-editor-foreground, var(--vscode-foreground)) 4%, transparent);
                border-radius: 0 4px 4px 0;
            }
            .cleanSlate-artifact-editor table {
                width: 100%;
                max-width: 100%;
                margin: 16px 0 24px;
                border-collapse: collapse;
                border-spacing: 0;
                color: var(--vscode-editor-foreground, var(--vscode-foreground));
                font-size: 14px;
                line-height: 1.45;
            }
            .cleanSlate-artifact-editor th,
            .cleanSlate-artifact-editor td {
                padding: 8px 10px;
                border: 1px solid var(--vscode-widget-border, color-mix(in srgb, var(--vscode-editor-foreground, var(--vscode-foreground)) 14%, transparent));
                text-align: left;
                vertical-align: top;
                overflow-wrap: anywhere;
            }
            .cleanSlate-artifact-editor th {
                background: color-mix(in srgb, var(--vscode-editor-foreground, var(--vscode-foreground)) 8%, transparent);
                font-weight: 700;
            }
            .cleanSlate-artifact-editor tbody tr:nth-child(even) {
                background: color-mix(in srgb, var(--vscode-editor-foreground, var(--vscode-foreground)) 4%, transparent);
            }
            .cleanSlate-artifact-editor td code,
            .cleanSlate-artifact-editor th code {
                white-space: normal;
                overflow-wrap: anywhere;
            }
            /* Alerts */
            .artifact-alert {
                margin: 20px 0;
                padding: 12px 16px;
                border-radius: 8px;
                border: 1px solid transparent;
            }
            .artifact-alert .alert-header {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 12px;
                font-weight: 700;
                margin-bottom: 8px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .artifact-alert p {
                margin-bottom: 0;
                font-size: 14px;
                opacity: 0.9;
                color: inherit !important;
            }
            .artifact-alert-important {
                background: rgba(186, 58, 58, 0.1);
                border-color: rgba(186, 58, 58, 0.2);
                color: #ff8a8a;
            }
            .artifact-alert-note {
                background: rgba(58, 134, 255, 0.1);
                border-color: rgba(58, 134, 255, 0.2);
                color: #8ac2ff;
            }
            .artifact-alert-warning {
                background: rgba(255, 186, 58, 0.1);
                border-color: rgba(255, 186, 58, 0.2);
                color: #ffd98a;
            }
            .artifact-alert-tip {
                background: rgba(58, 255, 134, 0.1);
                border-color: rgba(58, 255, 134, 0.2);
                color: #8affad;
            }
            .artifact-alert-caution {
                background: rgba(255, 58, 58, 0.15);
                border-color: rgba(255, 58, 58, 0.3);
                color: #ff7070;
            }
            .cleanSlate-artifact-editor pre {
                background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background));
                color: var(--vscode-textPreformat-foreground, var(--vscode-editor-foreground, var(--vscode-foreground)));
                padding: 16px;
                border-radius: 8px;
                overflow-x: auto;
                margin: 16px 0;
                border: 1px solid var(--vscode-widget-border, color-mix(in srgb, var(--vscode-editor-foreground, var(--vscode-foreground)) 12%, transparent));
            }
            .cleanSlate-artifact-editor pre code {
                background: transparent;
                border: none;
                padding: 0;
                color: inherit;
            }
        `;
        this.container.appendChild(style);
    }

    override async setInput(input: CleanSlateArtifactInput, options: IEditorOptions | undefined, context: any, token: CancellationToken): Promise<void> {
        await super.setInput(input, options, context, token);
        this.currentInput = input;
        const artifact = input.getArtifact();
        if (!artifact) return;

        this.renderArtifact(artifact);
    }

    private renderArtifact(artifact: any): void {
        try {
            dom.clearNode(this.header);
            dom.clearNode(this.body);

            // Top Row for Badge and Actions
            const topRow = dom.append(this.header, dom.$('.artifact-header-top'));
            topRow.style.display = 'flex';
            topRow.style.justifyContent = 'space-between';
            topRow.style.alignItems = 'center';

            const badge = dom.append(topRow, dom.$('.artifact-badge'));
            badge.textContent = artifact.type === 'implementation_plan' ? 'Implementation Plan'
                : artifact.type === 'walkthrough' ? 'Walkthrough'
                    : 'Research Analysis';

			const copyButton = dom.append(topRow, dom.$('button.artifact-copy-button')) as HTMLButtonElement;
			copyButton.type = 'button';
			copyButton.title = 'Copy artifact';
			copyButton.setAttribute('aria-label', copyButton.title);
			const copyIcon = dom.append(copyButton, dom.$('span.codicon.codicon-copy'));
			dom.append(copyButton, dom.$('span')).textContent = 'Copy';
			copyButton.onclick = async () => {
				try {
					await this.clipboardService.writeText(artifact.content);
					copyIcon.classList.replace('codicon-copy', 'codicon-check');
					copyButton.title = 'Artifact copied';
					copyButton.setAttribute('aria-label', copyButton.title);
					dom.getWindow(copyButton).setTimeout(() => {
						copyIcon.classList.replace('codicon-check', 'codicon-copy');
						copyButton.title = 'Copy artifact';
						copyButton.setAttribute('aria-label', copyButton.title);
					}, 1500);
				} catch {
					copyButton.title = 'Could not copy artifact';
					copyButton.setAttribute('aria-label', copyButton.title);
				}
			};

            const time = dom.append(this.header, dom.$('.artifact-timestamp'));
            time.textContent = `created ${this.getRelativeTime(artifact.timestamp)}`;

            // Use Official Markdown Renderer Service
            this.rendererDisposables = dispose(this.rendererDisposables);
            
            // Pre-process alerts before official rendering
            const processedContent = this.preProcessAlerts(artifact.content);
            const markdownString = new MarkdownString(processedContent, { isTrusted: false, supportHtml: true });
            const rendered = this.markdownRenderer.render(markdownString);
            
            this.rendererDisposables.push(rendered);
            this.body.appendChild(rendered.element);
            
            // Apply Mermaid rendering if needed
            this.renderMermaid();
        } catch (error) {
            console.error('Failed to render artifact:', error);
            this.body.textContent = 'Error rendering artifact content. Please check the console for details.';
        }
    }

    private async renderMermaid(): Promise<void> {
        const mermaid = (window as any).mermaid;
        if (!mermaid || typeof mermaid.run !== 'function') {
            // The workbench does not expose Mermaid globally by default. Keep the
            // fenced source visible instead of creating an endless retry timer.
            return;
        }

        const elements = this.body.querySelectorAll('.mermaid');
        if (elements.length > 0) {
            try {
                await mermaid.run({
                    nodes: elements
                });
            } catch (e) {
                console.error('Mermaid rendering failed:', e);
            }
        }
    }

    private preProcessAlerts(text: string): string {
        // Convert [!IMPORTANT] style alerts to HTML divs that the renderer will preserve
        // since we enabled supportHtml: true
        return text.replace(/^> \[!(IMPORTANT|NOTE|WARNING|TIP|CAUTION)\](.*?)(?=\n\n|\n[^> ]|$)/gms, (match, type, content) => {
            const lines = content.split('\n').map((l: string) => l.replace(/^> /, '').trim()).filter((l: string) => l !== '');
            const body = lines.join(' ');
            return `<div class="artifact-alert artifact-alert-${type.toLowerCase()}">
                <div class="alert-header"><i class="codicon codicon-info"></i> ${type}</div>
                <p>${body}</p>
            </div>`;
        });
    }

    override dispose(): void {
        this.rendererDisposables = dispose(this.rendererDisposables);
        super.dispose();
    }

    private getRelativeTime(timestamp: number): string {
        const diff = Date.now() - timestamp;
        if (diff < 60000) return 'just now';
        const mins = Math.floor(diff / 60000);
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.floor(mins / 60);
        return `${hours}h ago`;
    }

    override layout(dimension: dom.Dimension): void {
        this.container.style.width = `${dimension.width}px`;
        this.container.style.height = `${dimension.height}px`;
    }
}
